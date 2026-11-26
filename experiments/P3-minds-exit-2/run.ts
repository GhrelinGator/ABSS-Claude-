// Phase 3's exit checks, run again after 3.7c (experiments/P3-minds-exit-2/preregistration.md): one
// condition on one world. A copy of experiments/P3-minds-exit/run.ts (3.7b) with the same measurements,
// three conditions added as descriptions, and the 3.7c tallies and the living at the end in the output.
//
//   node experiments/P3-minds-exit-2/run.ts <condition> <seed> [founders=100] [days=40] > results/<condition>-<seed>.json
//
// Conditions: learn (founders' genomes as drawn), blank (the mind swapped for one that never learns, the
// random-policy baseline), gut0 (every founder's gutTraceHalfLife set to 0 after tick 0), bias0 and bias1
// (every founder's hiddenCauseBias set to 0 or 1 after tick 0); and, new in 3.7c, need0, rest0 and q14off
// (every founder's needCuriosity, restlessness, or both set to 0 after tick 0). Everything else is the real
// pipeline on the seed's world with founders placed by the config, as bench/founders.ts runs it.
//
// It reads the run and changes nothing in it, with one caveat checked by the preregistration: it calls a
// second perception (the mind's own door) once an hour for every living founder to read its context cues
// (place, light, day length). The still view it shares is a cache of what a cell shows in an hour, so the
// run's outcome must not change; `tallyDigest` lets that be compared with bench/founders.ts.
//
// It prints one JSON object: what the analysis (analyze.ts) needs for the four checks and the births reading.

import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { ACT_COLUMNS, Act, ActTally } from '../../src/sim/mind/acts.ts';
import { MIND_PARTS, blankMind } from '../../src/sim/mind/mind.ts';
import { CHANNELS, Channel, createInteroception } from '../../src/sim/mind/interoception.ts';
import { MEMORY_COLUMNS, keyOf } from '../../src/sim/mind/memory.ts';
import { CueKind, cue, cuePayload } from '../../src/sim/mind/cues.ts';
import { Percepts, STILL_VIEW_PART, createPerception, declarePerception } from '../../src/sim/mind/perception.ts';
import type { Sim, StatePart } from '../../src/sim/sim.ts';
import { PLANT_SPECIES } from '../../src/sim/world/plants.ts';
import { BODY_COLUMNS, BODY_PARTS, DeathCause, Sex, fatKgOf } from '../../src/sim/body/metabolism.ts';
import { GENETICS_COLUMNS } from '../../src/sim/body/genetics.ts';
import { REPRODUCTION, REPRODUCTION_COLUMNS, balanceFactor } from '../../src/sim/body/reproduction.ts';
import { fecundityAtAge } from '../../src/sim/body/lifecourse.ts';
import { INJURY } from '../../src/sim/body/injury.ts';
import { ticksPerYear } from '../../src/sim/core/clock.ts';

const [condition, seedArg, nArg, daysArg] = process.argv.slice(2);
const CONDITIONS = ['learn', 'blank', 'gut0', 'bias0', 'bias1', 'need0', 'rest0', 'q14off'];
if (!CONDITIONS.includes(condition)) throw new Error(`run.ts: condition must be one of ${CONDITIONS.join(', ')}.`);
const seed = Number(seedArg);
const N = Number(nArg ?? 100);
const DAYS = Number(daysArg ?? 40);

const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
raw.founders = { count: N, radiusM: 3000 };
const config = validateConfig(raw);
const blank = condition === 'blank';
const pipeline = blank ? SIM_PIPELINE.map((s) => (s.name === 'mind' ? blankMind : s)) : SIM_PIPELINE;
const sim = createSim(config, pipeline);
const perDay = config.time.ticksPerDay;
const perHour = perDay / 24;
const perYear = ticksPerYear(config);
const agents = sim.state.agents;
const f64 = (name: string) => agents.column<Float64Array>(name).data;

stepSim(sim, 1); // tick 0: founders placed
const n = agents.highWater;
if (condition === 'gut0' || condition === 'bias0' || condition === 'bias1') {
  const name = condition === 'gut0' ? GENETICS_COLUMNS.gutTraceHalfLife.name : GENETICS_COLUMNS.hiddenCauseBias.name;
  const col = f64(name);
  for (let s = 0; s < n; s++) col[s] = condition === 'bias1' ? 1 : 0;
}
if (condition === 'need0' || condition === 'q14off') f64(GENETICS_COLUMNS.needCuriosity.name).fill(0, 0, n);
if (condition === 'rest0' || condition === 'q14off') f64(GENETICS_COLUMNS.restlessness.name).fill(0, 0, n);
const biasOf = Array.from({ length: n }, (_, s) => Math.max(0, f64(GENETICS_COLUMNS.hiddenCauseBias.name)[s]));
const sexOf = Array.from({ length: n }, (_, s) => agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data[s]);

const tally = sim.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
const deaths = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths)!.readings!() as Float64Array;
const intero = createInteroception(sim);
const drives = new Float64Array(CHANNELS);
// A perception of its own, over a still view of its own: the shared still view caches what a cell shows
// from the first look in an hour, so looking from here would change what the minds see (it did, by a few
// acts in a thousand, when this was first written with the shared one).
const ownParts: StatePart[] = [];
declarePerception({ world: sim.state.world, addPart: (p: StatePart) => ownParts.push(p) } as unknown as Sim['state']);
const parts = sim.state.parts.map((p) => (p.name === STILL_VIEW_PART ? ownParts[0] : p));
const ownState = new Proxy(sim.state, { get: (t, k) => (k === 'parts' ? parts : Reflect.get(t, k)) });
const eye = createPerception({ ...sim, state: ownState } as Sim);
const look = new Percepts();

// ---- check 1: acquisition, per founder, in two windows of its life (day 1 and days 16–20)
const W1 = [0, perDay];
const W2 = [15 * perDay, 20 * perDay];
const kcal1 = new Float64Array(n);
const awake1 = new Float64Array(n);
const eat1 = new Float64Array(n);
const kcal2 = new Float64Array(n);
const awake2 = new Float64Array(n);
const eat2 = new Float64Array(n);
const prevIn = new Float64Array(n);
for (let s = 0; s < n; s++) prevIn[s] = f64(BODY_COLUMNS.energyIn.name)[s];

// ---- check 2: plant kg by species in days 1–5 and days 16–20 (the mind's tally)
const plantKg = (): number[] => PLANT_SPECIES.map((_, i) => tally[ActTally.PLANT_KG + i]);
let kgAt0 = plantKg();
let kgW1: number[] = [];
let kgAt15: number[] = [];
let kgW2: number[] = [];

// ---- check 3 and 4: harm events (pain up by at least 0.05 over an hour), per founder; hours by context
const HARM_STEP = 0.05;
const lastPain = new Float64Array(n).fill(-1);
const harmEvents = new Float64Array(n);
const hoursAlive = new Float64Array(n);
let painSum = 0;
let painN = 0;
// Founder-hours: context cues and whether a harm event closed the hour.
const ctxPlace: number[] = [];
const ctxLight: number[] = [];
const ctxDay: number[] = [];
const ctxHarm: number[] = [];
// ... and each drive channel's change over the hour (−9 when the founder's first hour, unknown).
const ctxDelta: number[] = [];
const lastDrives = new Float64Array(n * CHANNELS).fill(-1);

// ---- check 4: nodes held by the living, snapshot every 10 days; latest snapshot of each (slot, node) wins
type NodeRec = { slot: number; id: number; place: number; light: number; day: number; strength: number; now: number[] };
const nodes = new Map<string, NodeRec>();
function snapshotNodes(): void {
  if (blank) return;
  const NW = MEMORY_COLUMNS.nodeId.width;
  const T = MEMORY_COLUMNS.memKey.width;
  const ids = agents.column<Uint32Array>(MEMORY_COLUMNS.nodeId.name).data;
  const pl = agents.column<Uint32Array>(MEMORY_COLUMNS.nodePlace.name).data;
  const li = agents.column<Uint8Array>(MEMORY_COLUMNS.nodeLight.name).data;
  const da = agents.column<Uint8Array>(MEMORY_COLUMNS.nodeDay.name).data;
  const st = agents.column<Float32Array>(MEMORY_COLUMNS.nodeStrength.name).data;
  const keys = agents.column<Uint32Array>(MEMORY_COLUMNS.memKey.name).data;
  const now = agents.column<Float32Array>(MEMORY_COLUMNS.memNow.name).data;
  for (let s = 0; s < n; s++) {
    if (agents.alive.data[s] !== 1) continue;
    for (let q = 0; q < NW; q++) {
      const id = ids[s * NW + q];
      if (id === 0) continue;
      const key = keyOf(cue(CueKind.NODE, id), 0);
      let v = new Array(CHANNELS).fill(0);
      for (let t = 0; t < T; t++) {
        if (keys[s * T + t] !== key) continue;
        v = Array.from(now.subarray((s * T + t) * CHANNELS, (s * T + t + 1) * CHANNELS));
        break;
      }
      nodes.set(`${s}:${id}`, { slot: s, id, place: pl[s * NW + q], light: li[s * NW + q], day: da[s * NW + q], strength: st[s * NW + q], now: v });
    }
  }
}

// ---- births reading: each living woman's fertility factor once a day (what `mate` would multiply by)
let womanDays = 0;
let factorSum = 0;
let factorAboveHalf = 0;
let factorZero = 0;
function nourishment(fat: number, mass: number): number {
  const x = (fat / mass - INJURY.nourishedFrom) / (INJURY.nourishedAt - INJURY.nourishedFrom);
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function birthsReading(): void {
  const born = f64(BODY_COLUMNS.born.name);
  const lean = f64(BODY_COLUMNS.leanKg.name);
  const en = f64(BODY_COLUMNS.energy.name);
  const gk = f64(BODY_COLUMNS.gut.name);
  const bal = f64(REPRODUCTION_COLUMNS.balancePerDay.name);
  for (let s = 0; s < n; s++) {
    if (agents.alive.data[s] !== 1 || sexOf[s] !== Sex.FEMALE) continue;
    const age = (sim.state.tick - born[s]) / perYear;
    const fat = fatKgOf(en[s], gk[s], lean[s]);
    const f = fecundityAtAge(Sex.FEMALE, age) * balanceFactor(bal[s]) * nourishment(fat, lean[s] + fat);
    womanDays++;
    factorSum += f;
    if (f > 0.5) factorAboveHalf++;
    if (f === 0) factorZero++;
  }
}

const aliveByDay: number[] = [];
for (let tick = 1; tick < DAYS * perDay; tick++) {
  stepSim(sim, 1);
  const eIn = f64(BODY_COLUMNS.energyIn.name);
  const kind = agents.column<Uint8Array>(ACT_COLUMNS.actKind.name).data;
  const alive = agents.alive.data;
  const inW1 = tick >= W1[0] && tick < W1[1];
  const inW2 = tick >= W2[0] && tick < W2[1];
  for (let s = 0; s < n; s++) {
    if (alive[s] !== 1) continue;
    const got = eIn[s] - prevIn[s];
    prevIn[s] = eIn[s];
    const awake = kind[s] !== Act.SLEEP ? 1 : 0;
    if (inW1) {
      kcal1[s] += got;
      awake1[s] += awake;
      if (got > 1e-9) eat1[s]++;
    } else if (inW2) {
      kcal2[s] += got;
      awake2[s] += awake;
      if (got > 1e-9) eat2[s]++;
    }
  }
  if (tick % perHour === 0) {
    intero.refresh();
    for (let s = 0; s < n; s++) {
      if (alive[s] !== 1) continue;
      intero.read(s, drives, 0);
      const pain = drives[Channel.PAIN];
      painSum += pain;
      painN++;
      hoursAlive[s]++;
      const harm = lastPain[s] >= 0 && pain - lastPain[s] >= HARM_STEP ? 1 : 0;
      harmEvents[s] += harm;
      lastPain[s] = pain;
      eye.perceive(s, look);
      ctxPlace.push(cuePayload(look.place));
      ctxLight.push(cuePayload(look.light));
      ctxDay.push(cuePayload(look.dayLength));
      ctxHarm.push(harm);
      for (let c = 0; c < CHANNELS; c++) {
        const prev = lastDrives[s * CHANNELS + c];
        ctxDelta.push(prev < 0 ? -9 : drives[c] - prev);
        lastDrives[s * CHANNELS + c] = drives[c];
      }
    }
  }
  if (tick % perDay === 0) {
    const d = tick / perDay;
    birthsReading();
    if (d === 5) kgW1 = plantKg().map((v, i) => v - kgAt0[i]);
    if (d === 15) kgAt15 = plantKg();
    if (d === 20) kgW2 = plantKg().map((v, i) => v - kgAt15[i]);
    if (d % 5 === 0) aliveByDay.push(agents.count);
    if (d % 10 === 0) snapshotNodes();
  }
}
snapshotNodes();
const aliveAt20 = new Array(n).fill(false);
// A founder alive through window 2 has awake or asleep ticks counted to its end: count ticks in it.
// (Awake ticks alone can be zero for no one alive; use hours alive instead.)
for (let s = 0; s < n; s++) aliveAt20[s] = hoursAlive[s] >= 20 * 24 - 1;

// ---- check 4's classification. A node predicts, by its (node, 0) association, a change in its
// dominant channel (the largest |change|) in that direction. Over every founder-hour of the run (ground
// truth the minds cannot see), an event of that channel is a change over the hour of at least EVENT_STEP in
// the predicted direction. Rate where the node is active (two of place, light and day length matching its
// signature, §4.11.2) against the rate over all founder-hours: the ratio decides (analyze.ts).
const EVENT_STEP = 0.05;
const H = ctxHarm.length;
const overallRate = ctxHarm.reduce((a, b) => a + b, 0) / Math.max(1, H);
const eventsAll = new Float64Array(CHANNELS * 2); // [channel*2 + (rise ? 0 : 1)]
const knownAll = new Float64Array(CHANNELS);
for (let i = 0; i < H; i++) {
  for (let c = 0; c < CHANNELS; c++) {
    const d = ctxDelta[i * CHANNELS + c];
    if (d === -9) continue;
    knownAll[c]++;
    if (d >= EVENT_STEP) eventsAll[c * 2]++;
    if (d <= -EVENT_STEP) eventsAll[c * 2 + 1]++;
  }
}
const nodeRows = [...nodes.values()].map((nd) => {
  let dom = 0;
  for (let c = 1; c < CHANNELS; c++) if (Math.abs(nd.now[c]) > Math.abs(nd.now[dom])) dom = c;
  const rise = nd.now[dom] >= 0;
  let hours = 0;
  let events = 0;
  for (let i = 0; i < H; i++) {
    const m = (ctxPlace[i] === nd.place ? 1 : 0) + (ctxLight[i] === nd.light ? 1 : 0) + (ctxDay[i] === nd.day ? 1 : 0);
    if (m < 2) continue;
    const d = ctxDelta[i * CHANNELS + dom];
    if (d === -9) continue;
    hours++;
    if (rise ? d >= EVENT_STEP : d <= -EVENT_STEP) events++;
  }
  const baseRate = eventsAll[dom * 2 + (rise ? 0 : 1)] / Math.max(1, knownAll[dom]);
  return { slot: nd.slot, bias: biasOf[nd.slot], strength: nd.strength, dominant: dom, domNow: nd.now[dom], hours, events, baseRate };
});

const out = {
  condition,
  seed,
  founders: N,
  days: DAYS,
  aliveByDay,
  deaths: Object.fromEntries(Object.entries(DeathCause).map(([k, i]) => [k.toLowerCase(), deaths[i]])),
  founderDays: hoursAlive.reduce((a, b) => a + b, 0) / 24,
  aliveAtEnd: agents.count,
  energyIn: Math.round(tally[ActTally.KCAL]),
  stickKg: tally[ActTally.STICK_KG],
  sleepsUnrefused: tally[ActTally.SLEEPS_UNREFUSED],
  decisionsPerAwakeTick: tally[ActTally.DECISIONS] / Math.max(1, tally[ActTally.AWAKE_TICKS]),
  tallyDigest: { kcal: Math.round(tally[ActTally.KCAL]), consumeBegun: tally[ActTally.BEGUN + Act.CONSUME], posited: tally[ActTally.NODES_POSITED] },
  check1: Array.from({ length: n }, (_, s) => ({
    aliveAt20: aliveAt20[s],
    kcal1: kcal1[s],
    awakeH1: awake1[s] / perHour,
    eatH1: eat1[s] / perHour,
    kcal2: kcal2[s],
    awakeH2: awake2[s] / perHour,
    eatH2: eat2[s] / perHour,
  })),
  check2: { species: PLANT_SPECIES.map((sp) => sp.name), toxic: PLANT_SPECIES.map((sp) => sp.toxin !== null), kgW1, kgW2 },
  check3: {
    harmEvents: harmEvents.reduce((a, b) => a + b, 0),
    founderHours: hoursAlive.reduce((a, b) => a + b, 0),
    meanPain: painSum / Math.max(1, painN),
    perFounder: Array.from({ length: n }, (_, s) => ({ bias: biasOf[s], harm: harmEvents[s], hours: hoursAlive[s] })),
  },
  check4: { overallRate, founderHours: H, posited: tally[ActTally.NODES_POSITED], strengthened: tally[ActTally.NODES_STRENGTHENED], nodes: nodeRows },
  births: { womanDays, meanFactor: factorSum / Math.max(1, womanDays), aboveHalf: factorAboveHalf, zero: factorZero, actChance: REPRODUCTION.actChance },
};
console.log(JSON.stringify(out));
