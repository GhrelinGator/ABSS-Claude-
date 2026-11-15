// Scripted systems used only by tests. They exercise the kernel (streams,
// stores, growth, slot reuse, periodic scheduling, conserved bookkeeping,
// learned-state tracking) without being part of the simulation. Nothing under
// src/ may import this file (tests/guardrails/import-boundary.test.ts).

import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { StreamDomain, STREAM_WORDS, globalStreamOffset, nextChance, nextFloat, nextInt } from '../../src/sim/core/rng.ts';
import type { Sink, Source } from '../../src/sim/core/codec.ts';
import type { ColumnSpec } from '../../src/sim/core/store.ts';
import { worldHeightM, worldWidthM } from '../../src/sim/config.ts';
import { spawnAgent } from '../../src/sim/sim.ts';
import type { Sim, SimState, StatePart } from '../../src/sim/sim.ts';

export const FX_KCAL: ColumnSpec = {
  name: 'fx.kcal',
  dtype: 'f64',
  category: 'body',
  conserved: { quantity: 'energy', role: 'stock' },
};
export const FX_KCAL_IN: ColumnSpec = {
  name: 'fx.kcalIn',
  dtype: 'f64',
  category: 'body',
  conserved: { quantity: 'energy', role: 'inflow' },
};
export const FX_KCAL_OUT: ColumnSpec = {
  name: 'fx.kcalOut',
  dtype: 'f64',
  category: 'body',
  conserved: { quantity: 'energy', role: 'outflow' },
};
export const FX_MEMORY: ColumnSpec = { name: 'fx.memory', dtype: 'f64', category: 'learned', width: 4 };

const START_POPULATION = 300; // above the stores' initial capacity, so growth is exercised

/** Births and removals at random, so slots are reused and the store grows. */
export const fxChurn: SystemDef = defineSystem({
  name: 'fixture.churn',
  create(sim: Sim) {
    const { state, config } = sim;
    const streams = state.streams;
    const o = globalStreamOffset(StreamDomain.FIXTURE);
    const width = worldWidthM(config);
    const height = worldHeightM(config);
    const agents = state.agents;
    return () => {
      if (state.tick === 0) {
        for (let i = 0; i < START_POPULATION; i++) {
          spawnAgent(sim, nextFloat(streams, o) * width, nextFloat(streams, o) * height);
        }
      }
      if (nextChance(streams, o, 0.3)) {
        spawnAgent(sim, nextFloat(streams, o) * width, nextFloat(streams, o) * height);
      }
      if (agents.count > 50 && nextChance(streams, o, 0.3)) {
        let slot = nextInt(streams, o, agents.highWater);
        while (!agents.isAlive(slot)) slot = nextInt(streams, o, agents.highWater);
        agents.remove(slot);
      }
    };
  },
});

/** Each agent takes a random step, drawn from its own stream. */
export const fxWander: SystemDef = defineSystem({
  name: 'fixture.wander',
  create(sim: Sim) {
    const { state, config } = sim;
    const agents = state.agents;
    const maxX = worldWidthM(config) - 1;
    const maxY = worldHeightM(config) - 1;
    const X = agents.column<Float64Array>('x');
    const Y = agents.column<Float64Array>('y');
    const RNG = agents.column<Uint32Array>('rng');
    return () => {
      const x = X.data;
      const y = Y.data;
      const rng = RNG.data;
      const alive = agents.alive.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        const o = slot * STREAM_WORDS;
        let nx = x[slot] + (nextFloat(rng, o) - 0.5) * 200;
        let ny = y[slot] + (nextFloat(rng, o) - 0.5) * 200;
        if (nx < 0) nx = 0;
        else if (nx > maxX) nx = maxX;
        if (ny < 0) ny = 0;
        else if (ny > maxY) ny = maxY;
        x[slot] = nx;
        y[slot] = ny;
      }
    };
  },
});

/** Energy bookkeeping that balances: every change to the stock is recorded as an inflow or an outflow. */
export const fxBurn: SystemDef = defineSystem({
  name: 'fixture.burn',
  declare(state: SimState) {
    state.agents.ensureColumn(FX_KCAL);
    state.agents.ensureColumn(FX_KCAL_IN);
    state.agents.ensureColumn(FX_KCAL_OUT);
  },
  create(sim: Sim) {
    const agents = sim.state.agents;
    const STOCK = agents.column<Float64Array>(FX_KCAL.name);
    const IN = agents.column<Float64Array>(FX_KCAL_IN.name);
    const OUT = agents.column<Float64Array>(FX_KCAL_OUT.name);
    const RNG = agents.column<Uint32Array>('rng');
    return () => {
      const stock = STOCK.data;
      const inflow = IN.data;
      const outflow = OUT.data;
      const rng = RNG.data;
      const alive = agents.alive.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        if (inflow[slot] === 0) {
          // First tick of life: the starting reserve counts as an inflow.
          stock[slot] += 1500;
          inflow[slot] += 1500;
        }
        const burn = 10 + nextFloat(rng, slot * STREAM_WORDS) * 5;
        stock[slot] -= burn;
        outflow[slot] += burn;
        if (stock[slot] < 500) {
          const meal = 800 + nextFloat(rng, slot * STREAM_WORDS) * 400;
          stock[slot] += meal;
          inflow[slot] += meal;
        }
      }
    };
  },
});

/**
 * Stands in for a mind: writes "learned" content, in a column and in a
 * sparse state part. Runs every 5 ticks, and skips agents during the tick
 * they were spawned, as every real mind system must (docs/DESIGN.md §1.5).
 */
export class FxNotes implements StatePart {
  readonly name = 'fx.notes';
  readonly holdsLearned = true;
  readonly bySlot = new Map<number, number[]>();

  learnedEmptyFor(agentSlot: number): boolean {
    return !this.bySlot.has(agentSlot);
  }

  write(sink: Sink): void {
    const slots = [...this.bySlot.keys()].sort((a, b) => a - b);
    sink.u32(slots.length);
    for (const slot of slots) {
      const notes = this.bySlot.get(slot) as number[];
      sink.u32(slot);
      sink.array(Float64Array.from(notes));
    }
  }

  read(source: Source): void {
    this.bySlot.clear();
    const n = source.u32();
    for (let i = 0; i < n; i++) {
      const slot = source.u32();
      this.bySlot.set(slot, Array.from(source.array('f64')));
    }
  }
}

export const FX_NOTES_PART = 'fx.notes';

export const fxLearn: SystemDef = defineSystem({
  name: 'fixture.learn',
  every: 5,
  declare(state: SimState) {
    state.agents.ensureColumn(FX_MEMORY);
    const notes = new FxNotes();
    state.addPart(notes);
    state.agents.onClear((slot) => notes.bySlot.delete(slot));
  },
  create(sim: Sim) {
    const { state } = sim;
    const agents = state.agents;
    const MEMORY = agents.column<Float64Array>(FX_MEMORY.name);
    const X = agents.column<Float64Array>('x');
    const SPAWN = agents.column<Float64Array>('spawnTick');
    const notes = state.parts.find((part) => part.name === FX_NOTES_PART) as FxNotes;
    return () => {
      const memory = MEMORY.data;
      const x = X.data;
      const spawnTick = SPAWN.data;
      const alive = agents.alive.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1 || spawnTick[slot] === state.tick) continue;
        const base = slot * 4;
        memory[base] += 1;
        memory[base + 1] = x[slot];
        memory[base + 2] += x[slot] * 0.001;
        memory[base + 3] = state.tick;
        let list = notes.bySlot.get(slot);
        if (!list) {
          list = [];
          notes.bySlot.set(slot, list);
        }
        if (list.length < 8) list.push(x[slot]);
      }
    };
  },
});

/** The full fixture pipeline. */
export const FIXTURE_PIPELINE: readonly SystemDef[] = [fxChurn, fxWander, fxBurn, fxLearn];

// ---------------------------------------------------------------- deliberately broken fixtures
// Positive controls: each one commits exactly the fault a guardrail exists to catch.

/** Adds energy to the stock without recording an inflow. The energy audit must catch it. */
export const fxLeak: SystemDef = defineSystem({
  name: 'fixture.leak',
  create(sim: Sim) {
    const agents = sim.state.agents;
    const STOCK = agents.column<Float64Array>(FX_KCAL.name);
    return () => {
      const stock = STOCK.data;
      const alive = agents.alive.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] === 1) stock[slot] += 1;
      }
    };
  },
});

/** Hands every newly spawned agent ready-made knowledge. The blank-slate check must catch it. */
export const fxSeedKnowledge: SystemDef = defineSystem({
  name: 'fixture.seedKnowledge',
  create(sim: Sim) {
    const { state } = sim;
    const agents = state.agents;
    const MEMORY = agents.column<Float64Array>(FX_MEMORY.name);
    const SPAWN = agents.column<Float64Array>('spawnTick');
    return () => {
      const memory = MEMORY.data;
      const spawnTick = SPAWN.data;
      const alive = agents.alive.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] === 1 && spawnTick[slot] === state.tick) memory[slot * 4] = 42;
      }
    };
  },
});

/** Draws from the climate stream once per tick and records the draw, to test that streams are isolated. */
export function makeClimateRecorder(log: number[]): SystemDef {
  return defineSystem({
    name: 'fixture.climateRecorder',
    create(sim: Sim) {
      const streams = sim.state.streams;
      const o = globalStreamOffset(StreamDomain.CLIMATE);
      return () => {
        log.push(nextFloat(streams, o));
      };
    },
  });
}
