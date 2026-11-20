// Prepared learning about food and gut illness (docs/DESIGN.md §4.13, the owner's answer to Q12, D-056):
// the owner's condition that starving agents are not picky, shown on a mind whose aversion was learned
// through the second kernel; the kernel's reach for the gut's part of pain, and only for acts of eating
// and drinking; the place left to the general kernel; the dial at 0 giving 3.5's mind exactly; the
// interoceptive reading the kernel needs; and the dial on the genome.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { STREAM_WORDS } from '../../src/sim/core/rng.ts';
import { GENETICS_COLUMNS, GENE_DIALS } from '../../src/sim/body/genetics.ts';
import { GUT_COLUMNS } from '../../src/sim/body/gut.ts';
import { INJURY_COLUMNS } from '../../src/sim/body/injury.ts';
import { ACT_COLUMNS, Act, ActEnd } from '../../src/sim/mind/acts.ts';
import { Candidates, PREDICTION_LENGTH, choose, valueOf } from '../../src/sim/mind/choice.ts';
import { CLASS, CueKind, SELF_CUE, cue } from '../../src/sim/mind/cues.ts';
import { GUT_TRACE_HALF_LIFE, MIND_DIAL_DEFAULTS } from '../../src/sim/mind/dials.ts';
import { CHANNELS, Channel, createInteroception } from '../../src/sim/mind/interoception.ts';
import { ENTRY_LENGTH, MEMORY, MEMORY_COLUMNS, createMemory, keyOf } from '../../src/sim/mind/memory.ts';
import type { Memory } from '../../src/sim/mind/memory.ts';
import { PerceptSource, Percepts } from '../../src/sim/mind/perception.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { spawnWithBody } from '../fixtures/bodies.ts';

const G = GENETICS_COLUMNS;
const thing = (n: number) => cue(CueKind.CLASS, n);
const LIGHT = cue(CueKind.LIGHT, 2);
const DAY = cue(CueKind.DAY_LENGTH, 1);
const WARM = cue(CueKind.WARMTH, 1);
const PLACE = cue(CueKind.PLACE, 7);

function world(seed = 3, cells = 24, founders?: { count: number; radiusM: number }): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = 0.2;
  if (founders) raw.founders = founders;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

type Dials = Partial<Record<keyof typeof MIND_DIAL_DEFAULTS, number>>;

/** Agents with known dials (one set each), and a memory driven by hand (nothing is stepped). */
function minds(sets: Dials[]): { sim: Sim; mem: Memory; slots: number[] } {
  const sim = world();
  const slots: number[] = [];
  sets.forEach((dials, i) => {
    const slot = spawnWithBody(sim, 1000 + 10 * i, 1000);
    const set = { ...MIND_DIAL_DEFAULTS, traceHalfLife: 1, ...dials };
    for (const [name, v] of Object.entries(set)) sim.state.agents.column<Float64Array>(name).data[slot] = v;
    slots.push(slot);
  });
  const mem = createMemory(sim);
  mem.refresh();
  return { sim, mem, slots };
}

function look(): Percepts {
  const l = new Percepts();
  l.place = PLACE;
  l.light = LIGHT;
  l.dayLength = DAY;
  l.warmth = WARM;
  return l;
}

/** The keys of one act on `target`, in this test's context. */
function actKeys(target: number, act: number): Uint32Array {
  return Uint32Array.from([keyOf(target, act), keyOf(LIGHT, act), keyOf(LIGHT, 0), keyOf(DAY, act), keyOf(DAY, 0), keyOf(WARM, act), keyOf(WARM, 0)]);
}

function channels(values: Partial<Record<number, number>>): Float64Array {
  const o = new Float64Array(CHANNELS);
  for (const [ch, v] of Object.entries(values)) o[Number(ch)] = v ?? 0;
  return o;
}

const e = new Float64Array(ENTRY_LENGTH);
function laterOf(mem: Memory, slot: number, k: number, channel: number): number {
  return mem.entry(slot, k, e) ? e[CHANNELS + channel] : 0;
}

/** 24 acts on things nothing else here mentions push every earlier record out of the buffer. */
function flush(mem: Memory, slot: number, tick: number): number {
  for (let n = 0; n < MEMORY.records; n++) mem.push(slot, keyOf(thing(200 + n), Act.APPROACH), 0, tick + n);
  return tick + MEMORY.records;
}

test('the owner\'s condition: a starving agent eats a food it learned makes it ill when nothing else is in reach, a mildly hungry one does not, and starving with a harmless food in reach it eats that', () => {
  const { sim, mem, slots } = minds([{ gutTraceHalfLife: 6 }]);
  const [a] = slots;
  const perHour = sim.config.time.ticksPerDay / 24;
  const F = thing(30); // eaten, relieves hunger, its poison felt 4 hours later
  const H = thing(31); // eaten, relieves hunger as much, nothing follows
  const hungry = channels({ [Channel.HUNGER]: 0.6 });
  let tick = 10;
  // Both relieve hunger by about 0.25 when eaten.
  for (let n = 0; n < 8; n++) {
    for (const food of [F, H]) {
      const ks = actKeys(food, Act.CONSUME);
      mem.update(a, ks, ks.length, channels({ [Channel.HUNGER]: -0.25 }), tick++, 0, hungry, 0);
    }
  }
  // Two meals of F, each followed 4 hours later by a rise of 0.4 in the gut's pain; H twice, nothing follows.
  const ill = channels({ [Channel.PAIN]: 0.4 });
  for (let n = 0; n < 2; n++) {
    mem.readDials(a);
    mem.push(a, keyOf(F, Act.CONSUME), 0, tick);
    tick += 4 * perHour;
    mem.credit(a, ill, tick, 0.4);
    tick = flush(mem, a, tick);
    mem.push(a, keyOf(H, Act.CONSUME), 0, tick);
    tick = flush(mem, a, tick + 4 * perHour);
  }
  const aversion = laterOf(mem, a, keyOf(F, Act.CONSUME), Channel.PAIN);
  assert.ok(aversion > 0.18, `F's later pain ${aversion.toFixed(3)}`);
  assert.equal(laterOf(mem, a, keyOf(H, Act.CONSUME), Channel.PAIN), 0);

  const rng = sim.state.agents.column<Uint32Array>('rng').data;
  const scratch = new Float64Array(PREDICTION_LENGTH);
  const at = look();
  const offer = (foods: number[]): Candidates => {
    const c = new Candidates();
    foods.forEach((food, i) => {
      c.add(Act.CONSUME, food, PerceptSource.CELL, 100 + i, 0, 0, 0);
      c.add(Act.APPROACH, food, PerceptSource.CELL, 100 + i, 0, 0, 0);
      c.add(Act.AVOID, food, PerceptSource.CELL, 100 + i, 0, 0, 0);
    });
    c.add(Act.REST, SELF_CUE, 0, 0, 0, 0, 0);
    c.add(Act.SLEEP, SELF_CUE, 0, 0, 0, 0, 0);
    c.add(Act.EXPLORE, SELF_CUE, 0, 0, 0, 0, 0);
    return c;
  };
  const valued = (c: Candidates, d: Float64Array) => {
    mem.begin(a, at);
    const out: number[] = [];
    for (let i = 0; i < c.n; i++) {
      mem.predict(c.cue[i], c.act[i], c.dist[i], scratch, c.place[i]);
      out.push(valueOf(d, 0, scratch, mem.dials.curiosity, mem.dials.riskTolerance));
    }
    return out;
  };
  const best = (values: number[]) => values.indexOf(Math.max(...values));
  const picked = (c: Candidates, d: Float64Array) => {
    mem.begin(a, at);
    return choose(c, mem, d, 0, scratch, rng, a * STREAM_WORDS, mem.dials);
  };

  // Starving, only F in reach: F is eaten.
  const starving = channels({ [Channel.HUNGER]: 0.95 });
  const onlyF = offer([F]);
  const vs = valued(onlyF, starving);
  assert.equal(best(vs), 0, `starving: eating F is worth ${vs[0].toFixed(3)}, the best else ${Math.max(...vs.slice(1)).toFixed(3)}`);
  for (let n = 0; n < 20; n++) assert.equal(picked(offer([F]), starving), 0, 'and it is chosen');

  // Mildly hungry, only F in reach: F is passed by.
  const mild = channels({ [Channel.HUNGER]: 0.25 });
  const vm = valued(offer([F]), mild);
  assert.ok(best(vm) !== 0, `mildly hungry: eating F is worth ${vm[0].toFixed(3)}, the best else ${Math.max(...vm.slice(1)).toFixed(3)}`);
  for (let n = 0; n < 20; n++) assert.notEqual(picked(offer([F]), mild), 0);

  // Starving, F and H in reach: H is eaten (the aversion is real).
  const both = offer([F, H]);
  const vb = valued(both, starving);
  assert.equal(best(vb), 3, `starving with H too: F ${vb[0].toFixed(3)}, H ${vb[3].toFixed(3)}`);
});

/**
 * One agent's meal of `food` by act `act`, then 4 hours later an act (resting) that ends with pain risen
 * by 0.4, learned through learn() with the gut's part of pain `gutNow`; then the meal's record is closed.
 */
function mealThenPain(sim: Sim, mem: Memory, slot: number, food: number, act: number, gutNow: number): void {
  const agents = sim.state.agents;
  const perHour = sim.config.time.ticksPerDay / 24;
  sim.state.tick = 100;
  mem.readDials(slot);
  mem.push(slot, keyOf(food, act), keyOf(PLACE, 0), sim.state.tick);
  sim.state.tick += 4 * perHour;
  // The act that just ended: resting, begun with no pain and the gut at 0.
  agents.column<Uint8Array>(ACT_COLUMNS.actKind.name).data[slot] = Act.REST;
  agents.column<Uint32Array>(ACT_COLUMNS.actCue.name).data[slot] = SELF_CUE;
  agents.column<Uint8Array>(ACT_COLUMNS.actSource.name).data[slot] = 0;
  agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[slot] = ActEnd.DONE;
  for (let ch = 0; ch < CHANNELS; ch++) agents.column<Float32Array>(ACT_COLUMNS.actDrives.name).data[slot * CHANNELS + ch] = 0;
  agents.column<Float32Array>(MEMORY_COLUMNS.actGutPain.name).data[slot] = 0;
  mem.learn(slot, look(), channels({ [Channel.PAIN]: 0.4 }), 0, gutNow);
  flush(mem, slot, sim.state.tick + 1);
}

test('the second kernel reaches back hours to a meal for the gut\'s part of pain, not for a wound, and leaves the meal\'s place to the general kernel', () => {
  const { sim, mem, slots } = minds([{ gutTraceHalfLife: 6 }, { gutTraceHalfLife: 6 }, { gutTraceHalfLife: 0 }]);
  const [gut, wound, off] = slots;
  const F = thing(30);
  const meal = keyOf(F, Act.CONSUME);
  mealThenPain(sim, mem, gut, F, Act.CONSUME, 0.4);
  mealThenPain(sim, mem, wound, F, Act.CONSUME, 0);
  mealThenPain(sim, mem, off, F, Act.CONSUME, 0.4);
  // A novel key's "later" takes 0.8 of its credit (gain V₀ ÷ (V₀ + R)); the pain error is about 0.4 less
  // the little the context keys predicted (nothing yet).
  const general = 0.4 * 2 ** -4 * 0.8;
  const reach = 0.4 * 2 ** (-4 / 6) * 0.8;
  const byGut = laterOf(mem, gut, meal, Channel.PAIN);
  const byWound = laterOf(mem, wound, meal, Channel.PAIN);
  const byOff = laterOf(mem, off, meal, Channel.PAIN);
  assert.ok(Math.abs(byGut - reach) < 0.01, `gut pain 4 hours after the meal: ${byGut.toFixed(4)} against ${reach.toFixed(4)}`);
  assert.ok(Math.abs(byWound - general) < 0.003, `a wound 4 hours after it: ${byWound.toFixed(4)} against ${general.toFixed(4)}`);
  assert.equal(byOff, byWound, 'at gutTraceHalfLife 0 the gut gets only the general kernel, like a wound');
  // The place where it was eaten gets the general credit only, whatever hurt.
  const place = keyOf(PLACE, 0);
  assert.equal(laterOf(mem, gut, place, Channel.PAIN), laterOf(mem, wound, place, Channel.PAIN));
  assert.ok(laterOf(mem, gut, place, Channel.PAIN) < byGut / 5);
});

test('at gutTraceHalfLife 0, or no longer than traceHalfLife, the mind learns exactly what it learned before 3.6b', () => {
  const { sim, mem, slots } = minds([{ gutTraceHalfLife: 0 }, { gutTraceHalfLife: 1 }, { gutTraceHalfLife: 0.5 }, { gutTraceHalfLife: 6 }]);
  const F = thing(30);
  for (const slot of slots) mealThenPain(sim, mem, slot, F, Act.CONSUME, 0.4);
  const later = slots.map((s) => laterOf(mem, s, keyOf(F, Act.CONSUME), Channel.PAIN));
  assert.equal(later[1], later[0]);
  assert.equal(later[2], later[0]);
  assert.ok(later[3] > 5 * later[0]);
  // And the record's extra credit is never written.
  const extra = sim.state.agents.column<Float32Array>(MEMORY_COLUMNS.epiGut.name).data;
  for (const slot of slots.slice(0, 3)) for (let r = 0; r < MEMORY.records; r++) assert.equal(extra[slot * MEMORY.records + r], 0);
});

test('drinking counts as swallowing; approaching the same thing does not', () => {
  const { sim, mem, slots } = minds([{ gutTraceHalfLife: 6 }, { gutTraceHalfLife: 6 }]);
  const [drank, walked] = slots;
  const W = thing(CLASS.standing);
  mealThenPain(sim, mem, drank, W, Act.CONSUME, 0.4);
  mealThenPain(sim, mem, walked, W, Act.APPROACH, 0.4);
  const d = laterOf(mem, drank, keyOf(W, Act.CONSUME), Channel.PAIN);
  const w = laterOf(mem, walked, keyOf(W, Act.APPROACH), Channel.PAIN);
  assert.ok(d > 5 * w, `drinking ${d.toFixed(4)}, approaching ${w.toFixed(4)}`);
});

test('interoception reports the part of pain the gut adds: poison and gut infection, not wounds', () => {
  const sim = world();
  const [poisoned, wounded, both] = [0, 1, 2].map((i) => spawnWithBody(sim, 1000 + 10 * i, 1000));
  const agents = sim.state.agents;
  const f64 = (name: string) => agents.column<Float64Array>(name).data;
  f64(GUT_COLUMNS.poisonActive.name)[poisoned] = 1;
  f64(INJURY_COLUMNS.woundCm2.name)[wounded] = 30;
  f64(GUT_COLUMNS.poisonActive.name)[both] = 1;
  f64(INJURY_COLUMNS.gutInfection.name)[both] = 0.1;
  f64(INJURY_COLUMNS.woundCm2.name)[both] = 30;
  const intero = createInteroception(sim);
  intero.refresh();
  const d = new Float64Array(CHANNELS);
  intero.read(poisoned, d, 0);
  assert.ok(intero.gutPain(poisoned) > 0.1);
  assert.ok(Math.abs(intero.gutPain(poisoned) - d[Channel.PAIN]) < 1e-12, 'all of a poisoned body\'s pain is the gut\'s');
  assert.equal(intero.gutPain(wounded), 0);
  intero.read(wounded, d, 0);
  const woundPain = d[Channel.PAIN];
  intero.read(both, d, 0);
  assert.ok(Math.abs(d[Channel.PAIN] - woundPain - intero.gutPain(both)) < 1e-12, 'pain is the wound\'s plus what the gut adds');
});

test('gutTraceHalfLife is on the genome: neutral 0, founders drawn wide from 0 to 12 hours', () => {
  assert.ok(GENE_DIALS.some((g) => g.dial === GUT_TRACE_HALF_LIFE));
  assert.equal(GUT_TRACE_HALF_LIFE.neutral, 0);
  assert.equal(GUT_TRACE_HALF_LIFE.min, 0);
  assert.equal(MIND_DIAL_DEFAULTS.gutTraceHalfLife, 0, 'a mind without a genome is 3.5\'s');
  const sim = world(5, 64, { count: 400, radiusM: 2000 });
  stepSim(sim, 1);
  const agents = sim.state.agents;
  const v: number[] = [];
  for (let s = 0; s < agents.highWater; s++) if (agents.isAlive(s)) v.push(agents.column<Float64Array>(G.gutTraceHalfLife.name).data[s]);
  v.sort((x, y) => x - y);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  // The mean of two uniform alleles on 0–12 h: mean 6, sd about 2.45; 400 founders' sample mean within ±0.4 in far more than 999 of 1,000.
  assert.ok(Math.abs(mean - 6) < 0.4 && v[0] >= 0 && v[v.length - 1] <= 12.8, `gutTraceHalfLife mean ${mean.toFixed(2)} h, ${v[0].toFixed(2)}–${v[v.length - 1].toFixed(2)}`);
});
