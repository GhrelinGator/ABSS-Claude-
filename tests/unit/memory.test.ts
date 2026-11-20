// Memory (docs/DESIGN.md §4.7.5–§4.7.10, §4.10): hand-built cases for the learning rule (one-trial
// learning, blocking, latent inhibition, extinction and regained plasticity), delays learned and
// unlearned by eligibility, predictions held within what a drive can show, the table's limit, place
// memory and "go there", valuation that follows the drives of now, the mind's dials on the genome, and
// learners in the real pipeline.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { learnedContentProblems } from '../../src/sim/core/audit.ts';
import { GENETICS_COLUMNS, GENE_DIALS } from '../../src/sim/body/genetics.ts';
import { ACT_COLUMNS, Act, ActEnd } from '../../src/sim/mind/acts.ts';
import { Candidates, PREDICTION_LENGTH, valueOf } from '../../src/sim/mind/choice.ts';
import { CueKind, cue } from '../../src/sim/mind/cues.ts';
import { CURIOSITY, EXPLORATION_TEMPERATURE, LEARNING_RATE, MIND_DIAL_DEFAULTS, RISK_TOLERANCE, TRACE_HALF_LIFE } from '../../src/sim/mind/dials.ts';
import { CHANNELS, Channel } from '../../src/sim/mind/interoception.ts';
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

function world(seed = 3, cells = 24, founders?: { count: number; radiusM: number }): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = 0.2;
  if (founders) raw.founders = founders;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

/** Agents with known dials, and a memory to drive by hand (nothing is stepped). */
function minds(n: number, dials: Partial<Record<keyof typeof MIND_DIAL_DEFAULTS, number>> = {}): { sim: Sim; mem: Memory; slots: number[] } {
  const sim = world();
  const slots: number[] = [];
  for (let i = 0; i < n; i++) {
    const slot = spawnWithBody(sim, 1000 + 10 * i, 1000);
    const set = { ...MIND_DIAL_DEFAULTS, traceHalfLife: 2, ...dials };
    for (const [name, v] of Object.entries(set)) sim.state.agents.column<Float64Array>(name).data[slot] = v;
    slots.push(slot);
  }
  const mem = createMemory(sim);
  mem.refresh();
  return { sim, mem, slots };
}

/** The keys of one act on `target`: the thing, and light, day length and warmth with the act and alone. */
function actKeys(target: number, act: number = Act.CONSUME, extra: number[] = []): Uint32Array {
  const ks = [keyOf(target, act), keyOf(LIGHT, act), keyOf(LIGHT, 0), keyOf(DAY, act), keyOf(DAY, 0), keyOf(WARM, act), keyOf(WARM, 0)];
  for (const c of extra) ks.push(keyOf(c, act), keyOf(c, 0));
  return Uint32Array.from(ks);
}

function outcome(channel: number, change: number): Float64Array {
  const o = new Float64Array(CHANNELS);
  o[channel] = change;
  return o;
}

const e = new Float64Array(ENTRY_LENGTH);
function nowOf(mem: Memory, slot: number, k: number, channel: number): number {
  return mem.entry(slot, k, e) ? e[channel] : 0;
}
function laterOf(mem: Memory, slot: number, k: number, channel: number): number {
  return mem.entry(slot, k, e) ? e[CHANNELS + channel] : 0;
}
function predicted(mem: Memory, slot: number, ks: Uint32Array, channel: number): number {
  let p = 0;
  for (const k of ks) p += nowOf(mem, slot, k, channel);
  return p;
}

test('one-trial learning: a novel thing takes most of a surprise, the context a little', () => {
  const { mem, slots } = minds(1);
  const [a] = slots;
  const ks = actKeys(thing(5));
  mem.update(a, ks, ks.length, outcome(Channel.HUNGER, -0.4), 10);
  const target = nowOf(mem, a, ks[0], Channel.HUNGER);
  const total = predicted(mem, a, ks, Channel.HUNGER);
  assert.ok(total < -0.32, `after one trial the keys predict ${total.toFixed(3)} of -0.4`);
  assert.ok(target < -0.2, `the thing holds ${target.toFixed(3)}`);
  for (let i = 1; i < ks.length; i++) assert.ok(Math.abs(nowOf(mem, a, ks[i], Channel.HUNGER)) < Math.abs(target) / 5, 'context takes a tenth as much');
  assert.equal(mem.count(a), ks.length);
});

test('blocking: a thing added to one that already predicts the outcome learns almost nothing', () => {
  const { mem, slots } = minds(2);
  const [a, control] = slots;
  const A = thing(5);
  const B = thing(6);
  let tick = 1;
  for (let n = 0; n < 20; n++) {
    const ks = actKeys(A);
    mem.update(a, ks, ks.length, outcome(Channel.HUNGER, -0.4), tick++);
  }
  for (let n = 0; n < 10; n++) {
    const both = actKeys(A, Act.CONSUME, [B]);
    mem.update(a, both, both.length, outcome(Channel.HUNGER, -0.4), tick++);
    const alone = actKeys(B);
    mem.update(control, alone, alone.length, outcome(Channel.HUNGER, -0.4), tick++);
  }
  const blocked = nowOf(mem, a, keyOf(B, Act.CONSUME), Channel.HUNGER);
  const learned = nowOf(mem, control, keyOf(B, Act.CONSUME), Channel.HUNGER);
  assert.ok(Math.abs(blocked) < 0.03, `B beside a trained A: ${blocked.toFixed(4)}`);
  assert.ok(learned < -0.2, `B alone: ${learned.toFixed(4)}`);
});

test('latent inhibition: a thing met often with nothing following learns slower than a novel one', () => {
  const { mem, slots } = minds(1);
  const [a] = slots;
  const B = thing(7);
  const C = thing(8);
  let tick = 1;
  for (let n = 0; n < 30; n++) {
    const ks = actKeys(B);
    mem.update(a, ks, ks.length, outcome(Channel.HUNGER, 0), tick++);
  }
  const kb = actKeys(B);
  mem.update(a, kb, kb.length, outcome(Channel.PAIN, 0.5), tick++);
  const kc = actKeys(C);
  mem.update(a, kc, kc.length, outcome(Channel.PAIN, 0.5), tick++);
  const familiar = nowOf(mem, a, kb[0], Channel.PAIN);
  const novel = nowOf(mem, a, kc[0], Channel.PAIN);
  assert.ok(novel > 2 * familiar, `pain learned from one trial: familiar ${familiar.toFixed(3)}, novel ${novel.toFixed(3)}`);
});

test('extinction, and plasticity regained after long disuse', () => {
  const { sim, mem, slots } = minds(2);
  const [a, b] = slots;
  const A = thing(9);
  let tick = 1;
  for (const slot of [a, b]) {
    for (let n = 0; n < 15; n++) {
      const ks = actKeys(A);
      mem.update(slot, ks, ks.length, outcome(Channel.THIRST, -0.3), tick++);
    }
    for (let n = 0; n < 40; n++) {
      const ks = actKeys(A);
      mem.update(slot, ks, ks.length, outcome(Channel.THIRST, 0), tick++);
    }
  }
  const ks = actKeys(A);
  const extinguished = predicted(mem, a, ks, Channel.THIRST);
  assert.ok(Math.abs(extinguished) < 0.03, `after extinction the keys predict ${extinguished.toFixed(4)}`);
  // One retraining trial: right away for a, after 20 compressed days unused for b.
  const before = nowOf(mem, a, ks[0], Channel.THIRST);
  mem.update(a, ks, ks.length, outcome(Channel.THIRST, -0.3), tick);
  const soon = nowOf(mem, a, ks[0], Channel.THIRST) - before;
  const beforeB = nowOf(mem, b, ks[0], Channel.THIRST);
  mem.update(b, ks, ks.length, outcome(Channel.THIRST, -0.3), tick + 20 * sim.config.time.ticksPerDay);
  const late = nowOf(mem, b, ks[0], Channel.THIRST) - beforeB;
  assert.ok(late < 2 * soon, `relearning moved the thing by ${soon.toFixed(4)} at once and ${late.toFixed(4)} after disuse`);
});

test('a prediction is held within what a drive between 0 and 1 can show: sated drinking does not teach that water does nothing', () => {
  const { mem, slots } = minds(2);
  const [a, b] = slots;
  const W = thing(40);
  let tick = 1;
  const thirsty = new Float64Array(CHANNELS);
  thirsty[Channel.THIRST] = 0.5;
  const sated = new Float64Array(CHANNELS);
  for (const slot of [a, b]) {
    for (let n = 0; n < 5; n++) {
      const ks = actKeys(W);
      mem.update(slot, ks, ks.length, outcome(Channel.THIRST, -0.5), tick++, 0, thirsty, 0);
    }
  }
  for (let n = 0; n < 20; n++) {
    const ks = actKeys(W);
    mem.update(a, ks, ks.length, outcome(Channel.THIRST, 0), tick, 0, sated, 0);
    mem.update(b, ks, ks.length, outcome(Channel.THIRST, 0), tick++);
  }
  const ks = actKeys(W);
  const held = predicted(mem, a, ks, Channel.THIRST);
  const unheld = predicted(mem, b, ks, Channel.THIRST);
  assert.ok(held < -0.4, `with the start's limits: ${held.toFixed(3)}`);
  assert.ok(unheld > -0.1, `without them: ${unheld.toFixed(3)}`);
});

test('delays: a consequence hours later is credited to the act by eligibility, learned when the record leaves, and unlearned when it stops following', () => {
  const { sim, mem, slots } = minds(2, { traceHalfLife: 2 });
  const [a, off] = slots;
  sim.state.agents.column<Float64Array>(G.traceHalfLife.name).data[off] = 0;
  const perHour = sim.config.time.ticksPerDay / 24;
  const T = keyOf(thing(14), Act.CONSUME);
  const R = keyOf(cue(CueKind.SELF, 0), Act.REST);
  const place = keyOf(cue(CueKind.PLACE, 3), 0);
  const pain = outcome(Channel.PAIN, 0.5);
  let tick = 100;
  const eatThenHurt = (slot: number, hurt: boolean) => {
    mem.readDials(slot);
    mem.push(slot, T, place, tick);
    tick += Math.round(3.5 * perHour);
    mem.push(slot, R, place, tick - 1);
    if (hurt) mem.credit(slot, pain, tick);
    // 24 more acts push the eating and the rest after it out of the buffer.
    for (let n = 0; n < MEMORY.records; n++) mem.push(slot, keyOf(cue(CueKind.SELF, 0), Act.EXPLORE), place, tick + n);
    tick += MEMORY.records;
  };
  eatThenHurt(a, true);
  const e35 = 2 ** (-3.5 / 2);
  const learned = laterOf(mem, a, T, Channel.PAIN);
  assert.ok(Math.abs(learned - 0.5 * e35 * 0.8) < 0.02, `delayed pain learned at ${learned.toFixed(3)} (eligibility ${e35.toFixed(3)} × 0.5, gain 0.8)`);
  const bystander = laterOf(mem, a, R, Channel.PAIN);
  assert.ok(bystander > learned, 'the act just before the pain is blamed more');
  eatThenHurt(off, true);
  assert.equal(laterOf(mem, off, T, Channel.PAIN), 0, 'a trace half-life of 0 credits nothing');
  // Eaten again four times, nothing follows: the delayed association fades.
  for (let n = 0; n < 4; n++) eatThenHurt(a, false);
  const unlearned = laterOf(mem, a, T, Channel.PAIN);
  assert.ok(unlearned < learned / 4, `after four harmless meals ${unlearned.toFixed(4)}`);
});

test('the table keeps at most three quarters of its slots, forgets the least recently learned, and every held key is still found', () => {
  const { mem, slots } = minds(1);
  const [a] = slots;
  const o = outcome(Channel.HUNGER, -0.1);
  const ks = new Uint32Array(1);
  for (let i = 0; i < 1000; i++) {
    ks[0] = keyOf(thing(i % 4000), 1 + (i % 10));
    mem.update(a, ks, 1, o, i + 1);
    assert.ok(mem.count(a) <= MEMORY.most);
  }
  assert.equal(mem.count(a), MEMORY.most);
  let recent = 0;
  for (let i = 900; i < 1000; i++) if (mem.entry(a, keyOf(thing(i % 4000), 1 + (i % 10)), e)) recent++;
  let old = 0;
  for (let i = 0; i < 100; i++) if (mem.entry(a, keyOf(thing(i % 4000), 1 + (i % 10)), e)) old++;
  assert.equal(recent, 100, 'the latest are all held');
  assert.ok(old < 10, `${old} of the first 100 still held`);
  const keys = new Uint32Array(1);
  let found = 0;
  for (let i = 0; i < 1000; i++) {
    keys[0] = keyOf(thing(i % 4000), 1 + (i % 10));
    if (mem.entry(a, keys[0], e)) found++;
  }
  assert.equal(found, MEMORY.most, 'every key in the table is reachable by its probe');
});

test('valuing: learned relief is worth something only to a body that needs it, and the curiosity bonus fades with experience', () => {
  const { mem, slots } = minds(1);
  const [a] = slots;
  const F = thing(20);
  const look = new Percepts();
  look.place = cue(CueKind.PLACE, 7);
  look.light = LIGHT;
  look.dayLength = DAY;
  look.warmth = WARM;
  const p = new Float64Array(PREDICTION_LENGTH);
  mem.begin(a, look);
  mem.predict(F, Act.CONSUME, 0, p);
  const novelBonus = Math.sqrt(p[CHANNELS]);
  for (let n = 0; n < 10; n++) {
    const ks = actKeys(F);
    mem.update(a, ks, ks.length, outcome(Channel.HUNGER, -0.4), n + 1);
  }
  mem.begin(a, look);
  mem.predict(F, Act.CONSUME, 0, p);
  assert.ok(p[Channel.HUNGER] < -0.35, `predicted ${p[Channel.HUNGER]}`);
  assert.ok(Math.sqrt(p[CHANNELS]) < novelBonus / 2, 'uncertainty shrinks with experience');
  const hungry = new Float64Array(CHANNELS);
  hungry[Channel.HUNGER] = 0.6;
  const fed = new Float64Array(CHANNELS);
  assert.ok(valueOf(hungry, 0, p, 0, 0) > 0.25);
  assert.equal(valueOf(fed, 0, p, 0, 0), 0);
  // The trip: the agent's own cost of walking, from what exploring was followed by.
  const self = cue(CueKind.SELF, 0);
  for (let n = 0; n < 10; n++) {
    const ks = actKeys(self, Act.EXPLORE);
    mem.update(a, ks, ks.length, outcome(Channel.FATIGUE, 0.1), 20 + n);
  }
  mem.begin(a, look);
  const near = new Float64Array(PREDICTION_LENGTH);
  const far = new Float64Array(PREDICTION_LENGTH);
  mem.predict(F, Act.CONSUME, 10, near);
  mem.predict(F, Act.CONSUME, 3000, far);
  assert.ok(far[Channel.FATIGUE] - near[Channel.FATIGUE] > 0.05, `three kilometres cost more than ten metres: ${far[Channel.FATIGUE]} against ${near[Channel.FATIGUE]}`);
});

test('place memory: what relieved a drive is remembered where it was, offered from elsewhere when that drive is high, and forgotten when it fails', () => {
  const { sim, mem, slots } = minds(1);
  const [a] = slots;
  const agents = sim.state.agents;
  const W = thing(41);
  const { widthCells: Wc, cellSizeM: cs } = sim.config.world;
  const cell = 5 * Wc + 5;
  // An act of drinking at `cell` ends, done, having taken thirst from 0.5 to 0.
  agents.column<Uint8Array>(ACT_COLUMNS.actKind.name).data[a] = Act.CONSUME;
  agents.column<Uint32Array>(ACT_COLUMNS.actCue.name).data[a] = W;
  agents.column<Uint8Array>(ACT_COLUMNS.actSource.name).data[a] = PerceptSource.CELL;
  agents.column<Float64Array>(ACT_COLUMNS.actRef.name).data[a] = cell;
  agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[a] = ActEnd.DONE;
  agents.column<Float32Array>(ACT_COLUMNS.actDrives.name).data[a * CHANNELS + Channel.THIRST] = 0.5;
  const look = new Percepts();
  look.place = cue(CueKind.PLACE, mem.placeOfCell(cell));
  look.light = LIGHT;
  look.dayLength = DAY;
  look.warmth = WARM;
  const drives = new Float64Array(CHANNELS);
  mem.learn(a, look, drives, 0);
  // Later, elsewhere, thirsty: it is offered; not thirsty: it is not.
  const elsewhere = new Percepts();
  elsewhere.place = cue(CueKind.PLACE, mem.placeOfCell(20 * Wc + 20));
  const cands = new Candidates();
  const thirsty = new Float64Array(CHANNELS);
  thirsty[Channel.THIRST] = 0.6;
  mem.recall(a, elsewhere, cands, thirsty, 0);
  assert.equal(cands.n, 1);
  assert.equal(cands.act[0], Act.CONSUME);
  assert.equal(cands.cue[0], W);
  assert.equal(cands.ref[0], cell);
  assert.equal(cands.x[0], (5 + 0.5) * cs);
  assert.equal(cands.place[0], look.place);
  const none = new Candidates();
  mem.recall(a, elsewhere, none, new Float64Array(CHANNELS), 0);
  assert.equal(none.n, 0, 'not offered to a body that does not need it');
  const here = new Candidates();
  mem.recall(a, look, here, thirsty, 0);
  assert.equal(here.n, 0, 'not offered where it is: there it is seen');
  // The same act fails there: forgotten.
  agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[a] = ActEnd.FAILED;
  mem.learn(a, look, drives, 0);
  const after = new Candidates();
  mem.recall(a, elsewhere, after, thirsty, 0);
  assert.equal(after.n, 0);
});

test('the mind\'s dials are on the genome: founders spread around the toy\'s values, every dial can reach the value at which it does nothing', () => {
  for (const d of [LEARNING_RATE, TRACE_HALF_LIFE, CURIOSITY, EXPLORATION_TEMPERATURE, RISK_TOLERANCE]) {
    assert.ok(GENE_DIALS.some((g) => g.dial === d), `${d.name} on the genome`);
    assert.ok(d.neutral >= d.min && d.neutral <= d.max);
  }
  assert.equal(LEARNING_RATE.neutral, 0);
  assert.equal(TRACE_HALF_LIFE.neutral, 0);
  assert.equal(CURIOSITY.neutral, 0);
  assert.equal(RISK_TOLERANCE.neutral, 0);
  const sim = world(5, 64, { count: 400, radiusM: 2000 });
  stepSim(sim, 1);
  const agents = sim.state.agents;
  const values = (name: string) => {
    const out: number[] = [];
    for (let s = 0; s < agents.highWater; s++) if (agents.isAlive(s)) out.push(agents.column<Float64Array>(name).data[s]);
    return out.sort((x, y) => x - y);
  };
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const median = (xs: number[]) => xs[xs.length >> 1];
  const lr = values(G.learningRate.name);
  const trace = values(G.traceHalfLife.name);
  const cur = values(G.curiosity.name);
  const temp = values(G.explorationTemperature.name);
  const risk = values(G.riskTolerance.name);
  assert.ok(Math.abs(mean(lr) - 1) < 0.05 && lr[0] >= 0.3 && lr[lr.length - 1] <= 1.7, `learningRate ${mean(lr)}`);
  assert.ok(median(trace) > 0.8 && median(trace) < 1.25 && trace[0] > 0.2 && trace[trace.length - 1] < 4.3, `traceHalfLife median ${median(trace)} h`);
  assert.ok(Math.abs(mean(cur) - 0.3) < 0.03 && cur[0] >= 0, `curiosity ${mean(cur)}`);
  assert.ok(median(temp) > 0.008 && median(temp) < 0.0125, `explorationTemperature median ${median(temp)}`);
  assert.ok(Math.abs(mean(risk)) < 0.05 && risk[0] >= -0.6 && risk[risk.length - 1] <= 0.6, `riskTolerance ${mean(risk)}`);

  // At learningRate 0 nothing is learned.
  const { mem, slots } = minds(1, { learningRate: 0 });
  const ks = actKeys(thing(3));
  mem.update(slots[0], ks, ks.length, outcome(Channel.HUNGER, -0.5), 5);
  assert.equal(predicted(mem, slots[0], ks, Channel.HUNGER), 0);
});

test('learners in the real pipeline: memory fills from experience, stays within the table, holds nothing at birth, and is saved with the run', () => {
  const sim = world(13, 64, { count: 30, radiusM: 2000 });
  stepSim(sim, 144 * 3);
  const agents = sim.state.agents;
  const count = agents.column<Uint16Array>(MEMORY_COLUMNS.memCount.name).data;
  const places = agents.column<Uint32Array>(MEMORY_COLUMNS.placeId.name).data;
  let held = 0;
  let remembered = 0;
  let alive = 0;
  for (let s = 0; s < agents.highWater; s++) {
    if (!agents.isAlive(s)) continue;
    alive++;
    held += count[s];
    assert.ok(count[s] <= MEMORY.most);
    for (let r = 0; r < MEMORY.places; r++) if (places[s * MEMORY.places + r] !== 0) remembered++;
  }
  assert.ok(alive > 0);
  assert.ok(held / alive > 40, `${(held / alive).toFixed(0)} associations an agent after 3 days`);
  assert.ok(remembered > 0, 'some things worth acting on are remembered');
  const fresh = spawnWithBody(sim, 1000, 1000);
  assert.deepEqual(learnedContentProblems(sim.state, fresh), []);
});
