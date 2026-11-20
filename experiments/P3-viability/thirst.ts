// Phase 3.7: why learners die of thirst (docs/GUARDRAILS.md §4, the nudge protocol's step 4: measure each
// link). A diagnostic, not an experiment: it reads the run and changes nothing in it.
//
//   node experiments/P3-viability/thirst.ts [founders=100] [days=40] [seed=7] [--blank]
//
// For every founder it follows, tick by tick: how far the nearest water is (river, spring or lake cell;
// perception sees water up to 400 m, DESIGN.md §4.8), its thirst, every tick it spends drinking, and
// whether its memory holds water: the (water, consume) association's predicted change in thirst, and a
// remembered water cell (§4.10.4). At the end it groups the founders by how they died and prints the
// links of the chain "thirsty → water in reach → drinks → learns that drinking quenches thirst →
// remembers where → goes back when thirsty".

import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { Act, ACT_COLUMNS } from '../../src/sim/mind/acts.ts';
import { blankMind } from '../../src/sim/mind/mind.ts';
import { CHANNELS, Channel, createInteroception } from '../../src/sim/mind/interoception.ts';
import { MEMORY_COLUMNS } from '../../src/sim/mind/memory.ts';
import { CLASS, CueKind, cue } from '../../src/sim/mind/cues.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';
import { HEAT_COLUMNS } from '../../src/sim/body/heat.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const blank = process.argv.includes('--blank');
const N = Number(args[0] ?? 100);
const DAYS = Number(args[1] ?? 40);
const seed = Number(args[2] ?? 7);

const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
raw.founders = { count: N, radiusM: 3000 };
const config = validateConfig(raw);
const pipeline = blank ? SIM_PIPELINE.map((s) => (s.name === 'mind' ? blankMind : s)) : SIM_PIPELINE;
const sim = createSim(config, pipeline);
const W = config.world.widthCells;
const H = config.world.heightCells;
const cellM = config.world.cellSizeM;
const perDay = config.time.ticksPerDay;
const perHour = perDay / 24;

// Distance to the nearest water cell, metres (a two-pass chamfer transform, 3-4 weights).
const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
const dist = new Float64Array(W * H).fill(1e9);
for (let k = 0; k < W * H; k++) if (kind[k] !== Water.DRY) dist[k] = 0;
const D1 = cellM;
const D2 = cellM * Math.SQRT2;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (x > 0) dist[k] = Math.min(dist[k], dist[k - 1] + D1);
    if (y > 0) {
      dist[k] = Math.min(dist[k], dist[k - W] + D1);
      if (x > 0) dist[k] = Math.min(dist[k], dist[k - W - 1] + D2);
      if (x < W - 1) dist[k] = Math.min(dist[k], dist[k - W + 1] + D2);
    }
  }
for (let y = H - 1; y >= 0; y--)
  for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x;
    if (x < W - 1) dist[k] = Math.min(dist[k], dist[k + 1] + D1);
    if (y < H - 1) {
      dist[k] = Math.min(dist[k], dist[k + W] + D1);
      if (x < W - 1) dist[k] = Math.min(dist[k], dist[k + W + 1] + D2);
      if (x > 0) dist[k] = Math.min(dist[k], dist[k + W - 1] + D2);
    }
  }
function waterDist(x: number, y: number): number {
  const cx = Math.min(W - 1, Math.max(0, Math.floor(x / cellM)));
  const cy = Math.min(H - 1, Math.max(0, Math.floor(y / cellM)));
  return dist[cy * W + cx];
}

const waterCues = [cue(CueKind.CLASS, CLASS.flowing), cue(CueKind.CLASS, CLASS.standing)];
const drinkKeys = waterCues.map((c) => c * 16 + Act.CONSUME);

stepSim(sim, 1);
const agents = sim.state.agents;
const intero = createInteroception(sim);
const drives = new Float64Array(CHANNELS);
const n = agents.highWater;
const col = <T>(name: string) => agents.column<T & { length: number }>(name).data as unknown as T;
const xs = () => col<Float64Array>('x');
const ys = () => col<Float64Array>('y');

type Rec = {
  startDist: number;
  drinkTicks: number;
  firstDrinkH: number;
  thirstyTicks: number; // thirst > 0.3
  thirstyNearTicks: number; // ... and water within 400 m
  thirstyDrinkTicks: number;
  maxThirst: number;
  lastThirst: number;
  lastHunger: number;
  diedH: number;
  learnedQuench: number; // most negative thirst "now" held by a (water, consume) key, ever
  rememberedWater: boolean; // a water cell in place memory, ever
  lastDist: number;
  meanDist: number;
  distN: number;
  outKgPerDay: number;
  begunThirsty: Float64Array; // acts begun while thirst > 0.5, by kind
};
const recs: Rec[] = [];
for (let s = 0; s < n; s++) {
  recs.push({
    startDist: waterDist(xs()[s], ys()[s]),
    drinkTicks: 0,
    firstDrinkH: -1,
    thirstyTicks: 0,
    thirstyNearTicks: 0,
    thirstyDrinkTicks: 0,
    maxThirst: 0,
    lastThirst: 0,
    lastHunger: 0,
    diedH: -1,
    learnedQuench: 0,
    rememberedWater: false,
    lastDist: 0,
    meanDist: 0,
    distN: 0,
    outKgPerDay: 0,
    begunThirsty: new Float64Array(16),
  });
}
const lastStart = new Float64Array(n).fill(-1);
const T = MEMORY_COLUMNS.memKey.width;
const PT = MEMORY_COLUMNS.placeKey.width;

for (let tick = 1; tick < DAYS * perDay; tick++) {
  stepSim(sim, 1);
  intero.refresh();
  const alive = agents.alive.data;
  const actKind = col<Uint8Array>(ACT_COLUMNS.actKind.name);
  const actCue = col<Uint32Array>(ACT_COLUMNS.actCue.name);
  const actStart = col<Float64Array>(ACT_COLUMNS.actStart.name);
  const x = xs();
  const y = ys();
  const hour = tick / perHour;
  for (let s = 0; s < n; s++) {
    const r = recs[s];
    if (r.diedH >= 0) continue;
    if (alive[s] !== 1) {
      r.diedH = hour;
      continue;
    }
    intero.read(s, drives, 0);
    const thirst = drives[Channel.THIRST];
    const d = waterDist(x[s], y[s]);
    r.lastThirst = thirst;
    r.lastHunger = drives[Channel.HUNGER];
    r.lastDist = d;
    r.meanDist += d;
    r.distN += 1;
    if (thirst > r.maxThirst) r.maxThirst = thirst;
    const drinking = actKind[s] === Act.CONSUME && waterCues.includes(actCue[s]);
    if (drinking) {
      r.drinkTicks++;
      if (r.firstDrinkH < 0) r.firstDrinkH = hour;
    }
    if (thirst > 0.3) {
      r.thirstyTicks++;
      if (d <= 400) r.thirstyNearTicks++;
      if (drinking) r.thirstyDrinkTicks++;
    }
    if (actStart[s] !== lastStart[s]) {
      lastStart[s] = actStart[s];
      if (thirst > 0.5) r.begunThirsty[actKind[s]] += 1;
    }
    if (!blank && tick % perHour === 0) {
      const keys = col<Uint32Array>(MEMORY_COLUMNS.memKey.name);
      const now = col<Float32Array>(MEMORY_COLUMNS.memNow.name);
      for (let q = 0; q < T; q++) {
        const key = keys[s * T + q];
        if (key === drinkKeys[0] || key === drinkKeys[1]) {
          const v = now[(s * T + q) * CHANNELS + Channel.THIRST];
          if (v < r.learnedQuench) r.learnedQuench = v;
        }
      }
      const pk = col<Uint32Array>(MEMORY_COLUMNS.placeKey.name);
      for (let q = 0; q < PT; q++) if (drinkKeys.includes(pk[s * PT + q])) r.rememberedWater = true;
    }
  }
}
const out = col<Float64Array>(HEAT_COLUMNS.waterOut.name);
for (let s = 0; s < n; s++) {
  const r = recs[s];
  const lifeH = r.diedH >= 0 ? r.diedH : DAYS * 24;
  if (agents.alive.data[s] === 1) r.outKgPerDay = out[s] / (lifeH / 24);
}

// Group by the drive at the limit when the body died (thirst ≥ 0.95 → thirst; else hunger; else other).
function groupOf(r: Rec): string {
  if (r.diedH < 0) return 'alive';
  if (r.lastThirst >= 0.9) return 'thirst';
  if (r.lastHunger >= 0.9) return 'hunger';
  return 'other';
}
const groups = new Map<string, Rec[]>();
for (const r of recs) {
  const g = groupOf(r);
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g)!.push(r);
}
const med = (a: number[]) => {
  if (a.length === 0) return NaN;
  const b = [...a].sort((p, q) => p - q);
  return b[Math.floor(b.length / 2)];
};
const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
console.log(`thirst diagnosis: ${N} founders, ${DAYS} days, seed ${seed}, ${blank ? 'blank minds' : 'memory'}`);
const kinds = Object.keys(Act);
for (const [g, rs] of groups) {
  const share = (p: (r: Rec) => boolean) => `${rs.filter(p).length}/${rs.length}`;
  const begun = new Float64Array(16);
  for (const r of rs) for (let k = 0; k < 16; k++) begun[k] += r.begunThirsty[k];
  const bt = begun.reduce((a, b) => a + b, 0);
  const mix = kinds
    .map((name, k) => [name, begun[k]] as const)
    .filter(([, v]) => v > 0)
    .map(([name, v]) => `${name.toLowerCase()} ${((100 * v) / bt).toFixed(0)}%`)
    .join(', ');
  const thirstyNear = rs.reduce((a, r) => a + r.thirstyNearTicks, 0) / Math.max(1, rs.reduce((a, r) => a + r.thirstyTicks, 0));
  console.log(`\n[${g}] ${rs.length} founders; died at day (median) ${f(med(rs.map((r) => r.diedH / 24)), 1)}`);
  console.log(`  start: median ${f(med(rs.map((r) => r.startDist)))} m from water; within 400 m ${share((r) => r.startDist <= 400)}`);
  console.log(`  ever drank ${share((r) => r.drinkTicks > 0)}; first drink at hour (median of drinkers) ${f(med(rs.filter((r) => r.firstDrinkH >= 0).map((r) => r.firstDrinkH)), 1)}; drinking ticks a life (median) ${f(med(rs.map((r) => r.drinkTicks)))}`);
  console.log(`  learned that drinking quenches (a (water, consume) key predicting thirst < −0.02) ${share((r) => r.learnedQuench < -0.02)}; remembered a water cell ${share((r) => r.rememberedWater)}`);
  console.log(`  thirsty (> 0.3) ticks with water within 400 m: ${(100 * thirstyNear).toFixed(0)}%; mean distance from water over life (median) ${f(med(rs.map((r) => r.meanDist / Math.max(1, r.distN))))} m; at the end ${f(med(rs.map((r) => r.lastDist)))} m`);
  console.log(`  acts begun while thirst > 0.5: ${mix || '—'} (${bt})`);
}
