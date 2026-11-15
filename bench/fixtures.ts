// Stand-in agent load for the Phase 0 benchmark. These systems are scripted
// placeholders with roughly the shape of real work (movement drawn from each
// agent's stream, energy bookkeeping, a perception-style neighbour scan).
// They are not part of the simulation and nothing under src/ may import them.

import { defineSystem } from '../src/sim/core/registry.ts';
import type { SystemDef } from '../src/sim/core/registry.ts';
import { STREAM_WORDS, StreamDomain, globalStreamOffset, nextFloat } from '../src/sim/core/rng.ts';
import { BucketGrid } from '../src/sim/core/spatial.ts';
import type { ColumnSpec } from '../src/sim/core/store.ts';
import { worldHeightM, worldWidthM } from '../src/sim/config.ts';
import { spawnAgent } from '../src/sim/sim.ts';
import type { Sim, SimState } from '../src/sim/sim.ts';

const ANCHOR_X: ColumnSpec = { name: 'bench.anchorX', dtype: 'f64', category: 'body' };
const ANCHOR_Y: ColumnSpec = { name: 'bench.anchorY', dtype: 'f64', category: 'body' };
const MOVED: ColumnSpec = { name: 'bench.moved', dtype: 'f64', category: 'body' };
const KCAL: ColumnSpec = { name: 'bench.kcal', dtype: 'f64', category: 'body', conserved: { quantity: 'energy', role: 'stock' } };
const KCAL_IN: ColumnSpec = { name: 'bench.kcalIn', dtype: 'f64', category: 'body', conserved: { quantity: 'energy', role: 'inflow' } };
const KCAL_OUT: ColumnSpec = { name: 'bench.kcalOut', dtype: 'f64', category: 'body', conserved: { quantity: 'energy', role: 'outflow' } };
const SEEN: ColumnSpec = { name: 'bench.seen', dtype: 'u32', category: 'body' };
const NEAREST: ColumnSpec = { name: 'bench.nearest', dtype: 'f64', category: 'body' };

const STEP_M = 80; // longest step per tick
const TETHER_M = 150; // agents drift back when this far from their group's anchor
const SIGHT_M = 300; // radius of the neighbour scan
const BUCKET_M = 300;
export const GROUP_SIZE = 30;

/** Random step from the agent's own stream, tethered to the group's anchor so groups stay together. */
export const benchWander: SystemDef = defineSystem({
  name: 'bench.wander',
  declare(state: SimState) {
    state.agents.ensureColumn(ANCHOR_X);
    state.agents.ensureColumn(ANCHOR_Y);
    state.agents.ensureColumn(MOVED);
  },
  create(sim: Sim) {
    const agents = sim.state.agents;
    const maxX = worldWidthM(sim.config) - 1;
    const maxY = worldHeightM(sim.config) - 1;
    const X = agents.column<Float64Array>('x');
    const Y = agents.column<Float64Array>('y');
    const AX = agents.column<Float64Array>(ANCHOR_X.name);
    const AY = agents.column<Float64Array>(ANCHOR_Y.name);
    const MOVE = agents.column<Float64Array>(MOVED.name);
    const RNG = agents.column<Uint32Array>('rng');
    return () => {
      const x = X.data;
      const y = Y.data;
      const ax = AX.data;
      const ay = AY.data;
      const moved = MOVE.data;
      const rng = RNG.data;
      const alive = agents.alive.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        const o = slot * STREAM_WORDS;
        let ux: number;
        let uy: number;
        do {
          ux = nextFloat(rng, o) * 2 - 1;
          uy = nextFloat(rng, o) * 2 - 1;
        } while (ux * ux + uy * uy > 1);
        let nx = x[slot] + ux * STEP_M;
        let ny = y[slot] + uy * STEP_M;
        const dx = nx - ax[slot];
        const dy = ny - ay[slot];
        if (dx * dx + dy * dy > TETHER_M * TETHER_M) {
          nx -= dx * 0.3;
          ny -= dy * 0.3;
        }
        if (nx < 0) nx = 0;
        else if (nx > maxX) nx = maxX;
        if (ny < 0) ny = 0;
        else if (ny > maxY) ny = maxY;
        const mx = nx - x[slot];
        const my = ny - y[slot];
        moved[slot] = Math.sqrt(mx * mx + my * my);
        x[slot] = nx;
        y[slot] = ny;
      }
    };
  },
});

/** Energy bookkeeping: a resting cost plus a cost per metre moved, and a meal when reserves run low. */
export const benchBurn: SystemDef = defineSystem({
  name: 'bench.burn',
  declare(state: SimState) {
    state.agents.ensureColumn(MOVED);
    state.agents.ensureColumn(KCAL);
    state.agents.ensureColumn(KCAL_IN);
    state.agents.ensureColumn(KCAL_OUT);
  },
  create(sim: Sim) {
    const agents = sim.state.agents;
    const MOVE = agents.column<Float64Array>(MOVED.name);
    const STOCK = agents.column<Float64Array>(KCAL.name);
    const IN = agents.column<Float64Array>(KCAL_IN.name);
    const OUT = agents.column<Float64Array>(KCAL_OUT.name);
    return () => {
      const moved = MOVE.data;
      const stock = STOCK.data;
      const inflow = IN.data;
      const outflow = OUT.data;
      const alive = agents.alive.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        if (inflow[slot] === 0) {
          stock[slot] += 2000;
          inflow[slot] += 2000;
        }
        const burn = 11 + moved[slot] * 0.05;
        stock[slot] -= burn;
        outflow[slot] += burn;
        if (stock[slot] < 800) {
          stock[slot] += 1200;
          inflow[slot] += 1200;
        }
      }
    };
  },
});

/** Perception-style scan: every agent finds everyone within sight and does a little arithmetic per neighbour. */
export const benchSense: SystemDef = defineSystem({
  name: 'bench.sense',
  declare(state: SimState) {
    state.agents.ensureColumn(SEEN);
    state.agents.ensureColumn(NEAREST);
  },
  create(sim: Sim) {
    const agents = sim.state.agents;
    const grid = new BucketGrid(worldWidthM(sim.config), worldHeightM(sim.config), BUCKET_M);
    const X = agents.column<Float64Array>('x');
    const Y = agents.column<Float64Array>('y');
    const COUNT = agents.column<Uint32Array>(SEEN.name);
    const NEAR = agents.column<Float64Array>(NEAREST.name);
    return () => {
      const x = X.data;
      const y = Y.data;
      const seen = COUNT.data;
      const nearest = NEAR.data;
      const alive = agents.alive.data;
      grid.build(x, y, alive, agents.highWater);
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        const px = x[slot];
        const py = y[slot];
        const found = grid.query(px, py, SIGHT_M, x, y);
        const result = grid.result;
        let best = SIGHT_M * SIGHT_M;
        let count = 0;
        for (let k = 0; k < found; k++) {
          const other = result[k];
          if (other === slot) continue;
          const dx = x[other] - px;
          const dy = y[other] - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
          count++;
        }
        seen[slot] = count;
        nearest[slot] = Math.sqrt(best);
      }
    };
  },
});

export const BENCH_PIPELINE: readonly SystemDef[] = [benchWander, benchBurn, benchSense];

/** Place `n` agents in groups of GROUP_SIZE, each group within 100 m of a random anchor. */
export function populateGroups(sim: Sim, n: number): void {
  const { state, config } = sim;
  const streams = state.streams;
  const o = globalStreamOffset(StreamDomain.FIXTURE);
  const width = worldWidthM(config);
  const height = worldHeightM(config);
  const ax = state.agents.column<Float64Array>(ANCHOR_X.name);
  const ay = state.agents.column<Float64Array>(ANCHOR_Y.name);
  let anchorX = 0;
  let anchorY = 0;
  for (let i = 0; i < n; i++) {
    if (i % GROUP_SIZE === 0) {
      anchorX = 2000 + nextFloat(streams, o) * (width - 4000);
      anchorY = 2000 + nextFloat(streams, o) * (height - 4000);
    }
    const slot = spawnAgent(
      sim,
      anchorX + (nextFloat(streams, o) - 0.5) * 200,
      anchorY + (nextFloat(streams, o) - 0.5) * 200,
    );
    ax.data[slot] = anchorX;
    ay.data[slot] = anchorY;
  }
}
