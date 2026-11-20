// Phase 3.7b: why learners starve (docs/GUARDRAILS.md §4, the nudge protocol's step 4: measure each link).
// A diagnostic, not an experiment: it reads the run and changes nothing in it.
//
//   node experiments/P3-viability/starvation.ts [founders=100] [days=40] [seed=7] [--blank]
//
// For every founder it follows, tick by tick, the chain "hungry → food in reach → chooses to eat it →
// eats it at some rate → eats enough for what the body spends" (DESIGN.md §4.14.4):
//   - energy: kcal taken in (energyIn) and spent (energyOut), per day alive;
//   - time: hours a day in each act kind, and hours in which food went down (energyIn rose);
//   - rate: kcal per hour in which food went down (the handling rate, which skill and tiredness set),
//     against the best rate the founder could have had, at its own skill and rested, from food within
//     400 m (the range plants are seen at, §4.8) and within 1.5 km, and an expert's best within 400 m;
//   - failure: consume acts begun and failed (nothing eaten in the first tick of work);
//   - search: the acts begun while hunger > 0.5, and consume acts begun on a cell beyond 400 m (a
//     remembered place, "go there", §4.10.4).
// At the end it groups the founders by how they died (the drive at its limit when the body died) and prints
// the links. Where in a 600 s tick food went down is not resolved: an hour "eating" is six ticks in which
// energyIn rose, so handling rates are a little low.

import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { ACT_KINDS, ACT_COLUMNS, Act, ActTally } from '../../src/sim/mind/acts.ts';
import { MIND_PARTS, blankMind } from '../../src/sim/mind/mind.ts';
import { CHANNELS, Channel, createInteroception } from '../../src/sim/mind/interoception.ts';
import { PLANT_SPECIES, foodLayer } from '../../src/sim/world/plants.ts';
import { BODY_COLUMNS, fatKgOf } from '../../src/sim/body/metabolism.ts';
import { SkillAct, bySkill, plantKind, skillLevel } from '../../src/sim/body/skills.ts';
import { ACTS } from '../../src/sim/mind/acts.ts';
import { FITNESS_COLUMNS } from '../../src/sim/body/fitness.ts';

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
const ha = (cellM * cellM) / 10000;
const perDay = config.time.ticksPerDay;
const perHour = perDay / 24;
const tickH = 1 / perHour;

const food = PLANT_SPECIES.map((sp) => sim.state.world.layer<Float32Array>(foodLayer(sp)));
const kcalPerKg = PLANT_SPECIES.map((sp) => sp.kcalPerKg * sp.rawDigestible);
const expert = PLANT_SPECIES.map((sp) => ACTS.plantKgPerHour[sp.name]);
const novice = PLANT_SPECIES.map((sp, i) => expert[i] * ACTS.plantNoviceShare[sp.name]);
const toxic = PLANT_SPECIES.map((sp) => sp.toxin !== null);

/** The best rate, kcal an hour of work, rested, from plant food within `radiusM`, at skill levels `lv`. */
function bestRate(x: number, y: number, radiusM: number, lv: Float64Array, safeOnly: boolean): number {
  const cx = Math.floor(x / cellM);
  const cy = Math.floor(y / cellM);
  const r = Math.ceil(radiusM / cellM);
  let best = 0;
  for (let dy = -r; dy <= r; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= H) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= W || (dx * dx + dy * dy) * cellM * cellM > radiusM * radiusM) continue;
      const k = yy * W + xx;
      for (let s = 0; s < PLANT_SPECIES.length; s++) {
        if (safeOnly && toxic[s]) continue;
        const stock = food[s][k];
        if (!(stock > 0.001)) continue;
        const d = stock / ha;
        const rate = ((bySkill(novice[s], expert[s], lv[s]) * d) / (d + ACTS.halfRateKgHa)) * kcalPerKg[s];
        if (rate > best) best = rate;
      }
    }
  }
  return best;
}

stepSim(sim, 1);
const agents = sim.state.agents;
const intero = createInteroception(sim);
const drives = new Float64Array(CHANNELS);
const n = agents.highWater;
const f64 = (name: string) => agents.column<Float64Array>(name).data;
const u8 = (name: string) => agents.column<Uint8Array>(name).data;
const tally = sim.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;

type Rec = {
  diedH: number;
  lastHunger: number;
  lastThirst: number;
  in0: number;
  out0: number;
  inLast: number;
  outLast: number;
  fat0: number;
  fatLast: number;
  actTicks: Float64Array; // awake ticks in each act kind
  sleepTicks: number;
  eatTicks: number;
  eatKcal: number;
  hungryTicks: number; // hunger > 0.5
  hungryEatTicks: number;
  best400: number; // summed over hours, for a mean
  best400safe: number;
  best1500: number;
  expert400: number;
  hours: number;
  hours6: number;
  begunHungry: Float64Array;
  consumeBegun: number;
  consumeFar: number; // consume begun on a target beyond 400 m
  leanShare: number; // lean ÷ built lean, last seen alive (starvation kills below 2/3, §3.8)
  tiredEat: number; // summed acute-load tiredness (capacity taken as 1) over ticks food went down
};
const recs: Rec[] = [];
const energy = f64(BODY_COLUMNS.energy.name);
const gutK = f64(BODY_COLUMNS.gut.name);
const lean = f64(BODY_COLUMNS.leanKg.name);
for (let s = 0; s < n; s++) {
  const fat = fatKgOf(energy[s], gutK[s], lean[s]);
  recs.push({
    diedH: -1,
    lastHunger: 0,
    lastThirst: 0,
    in0: f64(BODY_COLUMNS.energyIn.name)[s],
    out0: f64(BODY_COLUMNS.energyOut.name)[s],
    inLast: 0,
    outLast: 0,
    fat0: fat,
    fatLast: fat,
    actTicks: new Float64Array(ACT_KINDS),
    sleepTicks: 0,
    eatTicks: 0,
    eatKcal: 0,
    hungryTicks: 0,
    hungryEatTicks: 0,
    best400: 0,
    best400safe: 0,
    best1500: 0,
    expert400: 0,
    hours: 0,
    hours6: 0,
    begunHungry: new Float64Array(ACT_KINDS),
    consumeBegun: 0,
    consumeFar: 0,
    leanShare: 1,
    tiredEat: 0,
  });
}
const prevIn = new Float64Array(n);
for (let s = 0; s < n; s++) prevIn[s] = recs[s].in0;
const lastStart = new Float64Array(n).fill(-1);
const lv = new Float64Array(PLANT_SPECIES.length);
const ones = new Float64Array(PLANT_SPECIES.length).fill(1);
// Population, by day: consume begun and failed (the mind's tally).
const daily: string[] = [];
let lastBegun = tally[ActTally.BEGUN + Act.CONSUME];
let lastFailed = tally[ActTally.FAILED + Act.CONSUME];

for (let tick = 1; tick < DAYS * perDay; tick++) {
  stepSim(sim, 1);
  intero.refresh();
  const alive = agents.alive.data;
  const kind = u8(ACT_COLUMNS.actKind.name);
  const start = f64(ACT_COLUMNS.actStart.name);
  const ax = f64(ACT_COLUMNS.actX.name);
  const ay = f64(ACT_COLUMNS.actY.name);
  const x = f64('x');
  const y = f64('y');
  const eIn = f64(BODY_COLUMNS.energyIn.name);
  const eOut = f64(BODY_COLUMNS.energyOut.name);
  const en = f64(BODY_COLUMNS.energy.name);
  const gk = f64(BODY_COLUMNS.gut.name);
  const ln = f64(BODY_COLUMNS.leanKg.name);
  const built = f64(BODY_COLUMNS.leanBuiltKg.name);
  const acute = f64(FITNESS_COLUMNS.acuteLoad.name);
  const hourly = tick % perHour === 0;
  const sixHourly = tick % (6 * perHour) === 0;
  for (let s = 0; s < n; s++) {
    const r = recs[s];
    if (r.diedH >= 0) continue;
    if (alive[s] !== 1) {
      r.diedH = tick / perHour;
      continue;
    }
    intero.read(s, drives, 0);
    const hunger = drives[Channel.HUNGER];
    r.lastHunger = hunger;
    r.lastThirst = drives[Channel.THIRST];
    r.inLast = eIn[s];
    r.outLast = eOut[s];
    r.fatLast = fatKgOf(en[s], gk[s], ln[s]);
    r.leanShare = ln[s] / built[s];
    const k = kind[s];
    if (k === Act.SLEEP) r.sleepTicks++;
    else r.actTicks[k]++;
    const ate = eIn[s] > prevIn[s] + 1e-9;
    if (ate) {
      r.eatTicks++;
      r.eatKcal += eIn[s] - prevIn[s];
      r.tiredEat += Math.min(1, acute[s] / 4);
    }
    prevIn[s] = eIn[s];
    if (hunger > 0.5) {
      r.hungryTicks++;
      if (ate) r.hungryEatTicks++;
    }
    if (start[s] !== lastStart[s]) {
      lastStart[s] = start[s];
      if (hunger > 0.5) r.begunHungry[k] += 1;
      if (k === Act.CONSUME) {
        r.consumeBegun++;
        const dx = ax[s] - x[s];
        const dy = ay[s] - y[s];
        if (dx * dx + dy * dy > 400 * 400) r.consumeFar++;
      }
    }
    if (hourly) {
      for (let q = 0; q < PLANT_SPECIES.length; q++) lv[q] = skillLevel(sim, s, SkillAct.CONSUME, plantKind(q));
      r.best400 += bestRate(x[s], y[s], 400, lv, false);
      r.best400safe += bestRate(x[s], y[s], 400, lv, true);
      r.expert400 += bestRate(x[s], y[s], 400, ones, false);
      r.hours++;
      if (sixHourly) {
        r.best1500 += bestRate(x[s], y[s], 1500, lv, false);
        r.hours6++;
      }
    }
  }
  if (tick % perDay === 0) {
    const b = tally[ActTally.BEGUN + Act.CONSUME];
    const fl = tally[ActTally.FAILED + Act.CONSUME];
    const d = tick / perDay;
    if (d % 5 === 0) daily.push(`${d}: ${b - lastBegun > 0 ? ((100 * (fl - lastFailed)) / (b - lastBegun)).toFixed(0) : '—'}% of ${b - lastBegun}`);
    lastBegun = b;
    lastFailed = fl;
  }
}

// Starved: lean last seen alive within 2% of starvation's line (2/3 of built lean, §3.8). Interoception's
// hunger is half the gut's emptiness, so a body eating to the end can starve at a hunger near 0.5.
function groupOf(r: Rec): string {
  if (r.diedH < 0) return 'alive';
  if (r.leanShare < 0.68) return 'starved';
  if (r.lastThirst >= 0.9) return 'thirst';
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
const kinds = Object.keys(Act);
console.log(`starvation diagnosis: ${N} founders, ${DAYS} days, seed ${seed}, ${blank ? 'blank minds' : 'memory'}`);
console.log(`consume acts failed, by 5-day stretch (whole population): ${daily.join('; ')}`);
for (const g of ['starved', 'other', 'thirst', 'alive']) {
  const rs = groups.get(g);
  if (rs === undefined) continue;
  const days = (r: Rec) => (r.diedH >= 0 ? r.diedH : DAYS * 24) / 24;
  const awakeH = (r: Rec) => r.actTicks.reduce((a, b) => a + b, 0) * tickH;
  const per = (r: Rec, v: number) => v / days(r);
  console.log(`\n[${g}] ${rs.length} founders; ${g === 'alive' ? 'alive at the end' : `died at day (median) ${f(med(rs.map(days)), 1)}`}`);
  console.log(`  energy a day (median): in ${f(med(rs.map((r) => per(r, r.inLast - r.in0))))} kcal, out ${f(med(rs.map((r) => per(r, r.outLast - r.out0))))} kcal; fat ${f(med(rs.map((r) => r.fat0)), 1)} kg at the start, ${f(med(rs.map((r) => r.fatLast)), 1)} at the end`);
  console.log(`  hours a day (median): awake ${f(med(rs.map((r) => per(r, awakeH(r)))), 1)}, asleep ${f(med(rs.map((r) => per(r, r.sleepTicks * tickH))), 1)}, food going down ${f(med(rs.map((r) => per(r, r.eatTicks * tickH))), 1)}`);
  const mix = (v: (r: Rec) => Float64Array) => {
    const sum = new Float64Array(ACT_KINDS);
    for (const r of rs) for (let k = 0; k < ACT_KINDS; k++) sum[k] += v(r)[k];
    const all = sum.reduce((a, b) => a + b, 0);
    return kinds
      .map((name, k) => [name, sum[k]] as const)
      .filter(([, v]) => v > 0)
      .map(([name, v]) => `${name.toLowerCase()} ${((100 * v) / all).toFixed(0)}%`)
      .join(', ');
  };
  console.log(`  awake time by act: ${mix((r) => r.actTicks)}`);
  console.log(`  handling rate (kcal an hour food went down, median) ${f(med(rs.filter((r) => r.eatTicks > 0).map((r) => r.eatKcal / (r.eatTicks * tickH))))}; best rate in reach at its own skill, rested (mean over hours, median): within 400 m ${f(med(rs.map((r) => r.best400 / Math.max(1, r.hours))))} (not poisonous ${f(med(rs.map((r) => r.best400safe / Math.max(1, r.hours))))}), within 1.5 km ${f(med(rs.map((r) => r.best1500 / Math.max(1, r.hours6))))}; an expert's within 400 m ${f(med(rs.map((r) => r.expert400 / Math.max(1, r.hours))))}`);
  console.log(`  tiredness while food went down (mean) ${f(rs.reduce((a, r) => a + r.tiredEat, 0) / Math.max(1, rs.reduce((a, r) => a + r.eatTicks, 0)), 2)}; hunger last seen (median) ${f(med(rs.map((r) => r.lastHunger)), 2)}`);
  console.log(`  hours of work a day to cover what it spent at the best rate in 400 m (median) ${f(med(rs.map((r) => per(r, r.outLast - r.out0) / Math.max(1, r.best400 / Math.max(1, r.hours)))), 1)}; food going down in ${f(100 * (rs.reduce((a, r) => a + r.hungryEatTicks, 0) / Math.max(1, rs.reduce((a, r) => a + r.hungryTicks, 0))))}% of hungry (> 0.5) ticks`);
  console.log(`  acts begun while hunger > 0.5: ${mix((r) => r.begunHungry)}`);
  console.log(`  consume acts begun on a target beyond 400 m: ${rs.reduce((a, r) => a + r.consumeFar, 0)} of ${rs.reduce((a, r) => a + r.consumeBegun, 0)}`);
}
