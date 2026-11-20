// Hidden causes (docs/DESIGN.md §4.11): the unexplained residual, positing and strengthening by
// hiddenCauseBias, activity by two of place, light and day length, nodes taking part in learning, delays
// and valuing like things, the weakest replaced with a fresh serial, the dial as a liability, and nodes in
// the real pipeline (none at all at bias 0).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { GENETICS_COLUMNS, GENE_DIALS } from '../../src/sim/body/genetics.ts';
import { ACT_TALLY_PART, Act, ActTally } from '../../src/sim/mind/acts.ts';
import { PREDICTION_LENGTH } from '../../src/sim/mind/choice.ts';
import { CueKind, cue } from '../../src/sim/mind/cues.ts';
import { HIDDEN_CAUSE_BIAS, MIND_DIAL_DEFAULTS } from '../../src/sim/mind/dials.ts';
import { CHANNELS, Channel } from '../../src/sim/mind/interoception.ts';
import { ENTRY_LENGTH, MEMORY, MEMORY_COLUMNS, NODE_LENGTH, createMemory, keyOf } from '../../src/sim/mind/memory.ts';
import type { Memory } from '../../src/sim/mind/memory.ts';
import { Percepts } from '../../src/sim/mind/perception.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { spawnWithBody } from '../fixtures/bodies.ts';

const thing = (n: number) => cue(CueKind.CLASS, n);
const WARM = cue(CueKind.WARMTH, 1);

function world(seed = 3, cells = 24, founders?: { count: number; radiusM: number }): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = 0.2;
  if (founders) raw.founders = founders;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

function minds(biases: number[]): { sim: Sim; mem: Memory; slots: number[] } {
  const sim = world();
  const slots: number[] = [];
  biases.forEach((b, i) => {
    const slot = spawnWithBody(sim, 1000 + 10 * i, 1000);
    const set = { ...MIND_DIAL_DEFAULTS, traceHalfLife: 2, hiddenCauseBias: b };
    for (const [name, v] of Object.entries(set)) sim.state.agents.column<Float64Array>(name).data[slot] = v;
    slots.push(slot);
  });
  const mem = createMemory(sim);
  mem.refresh();
  return { sim, mem, slots };
}

/** A look with no percepts in a given place, light and day length. */
function lookAt(place: number, light: number, day: number): Percepts {
  const look = new Percepts();
  look.place = cue(CueKind.PLACE, place);
  look.light = cue(CueKind.LIGHT, light);
  look.dayLength = cue(CueKind.DAY_LENGTH, day);
  look.warmth = WARM;
  return look;
}

/** The keys learn() would use for an act on `target` in `look` with no percepts, nodes not included. */
function actKeys(target: number, look: Percepts, act: number = Act.CONSUME): Uint32Array {
  return Uint32Array.from([
    keyOf(target, act),
    keyOf(look.light, act),
    keyOf(look.light, 0),
    keyOf(look.dayLength, act),
    keyOf(look.dayLength, 0),
    keyOf(look.warmth, act),
    keyOf(look.warmth, 0),
  ]);
}

function outcome(pairs: [number, number][]): Float64Array {
  const o = new Float64Array(CHANNELS);
  for (const [ch, v] of pairs) o[ch] = v;
  return o;
}

const e = new Float64Array(ENTRY_LENGTH);
function nowOf(mem: Memory, slot: number, k: number, ch: number): number {
  return mem.entry(slot, k, e) ? e[ch] : 0;
}

/** Train `slot` on eating `target` in `look` until its keys are familiar; returns the next tick. */
function familiar(mem: Memory, slot: number, target: number, look: Percepts, tick = 1, trials = 30): number {
  const ks = actKeys(target, look);
  for (let n = 0; n < trials; n++) mem.update(slot, ks, ks.length, outcome([[Channel.HUNGER, -0.4]]), tick++);
  return tick;
}

function tallyOf(sim: Sim): Float64Array {
  return sim.state.parts.find((p) => p.name === ACT_TALLY_PART)!.readings!() as Float64Array;
}

test('the residual is what no key absorbed: large when all is familiar and the outcome surprised, small when a novel thing took the surprise', () => {
  const { mem, slots } = minds([0, 0]);
  const [a, b] = slots;
  const here = lookAt(5, 2, 1);
  const A = thing(5);
  let t = familiar(mem, a, A, here);
  t = familiar(mem, b, A, here, t);
  // a: the familiar thing, then pain from nowhere.
  const ks = actKeys(A, here);
  mem.update(a, ks, ks.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.5]]), t);
  const familiarResidual = mem.residual[Channel.PAIN];
  const err = mem.error[Channel.PAIN];
  assert.ok(familiarResidual > 0.25 && familiarResidual <= err, `familiar: residual ${familiarResidual.toFixed(3)} of error ${err.toFixed(3)}`);
  // b: the same pain, with a novel thing eaten at the same time.
  const withNovel = Uint32Array.from([...actKeys(A, here), keyOf(thing(9), Act.CONSUME), keyOf(thing(9), 0)]);
  mem.update(b, withNovel, withNovel.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.5]]), t);
  const novelResidual = mem.residual[Channel.PAIN];
  assert.ok(novelResidual < 0.1, `novel: residual ${novelResidual.toFixed(3)}`);
  assert.ok(nowOf(mem, b, keyOf(thing(9), Act.CONSUME), Channel.PAIN) > 0.15, 'the novel thing took the pain');
});

test('at bias 0 nothing is ever set aside; above it a node is posited with the signature of now and takes most of the residual', () => {
  const { sim, mem, slots } = minds([0, 4, -1.5]);
  const [none, some, below] = slots;
  const here = lookAt(5, 2, 1);
  const A = thing(5);
  let t = 1;
  const ks = actKeys(A, here);
  const tally = tallyOf(sim);
  const salient0 = tally[ActTally.RESIDUALS_SALIENT];
  for (const s of slots) {
    t = familiar(mem, s, A, here, t);
    mem.update(s, ks, ks.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.5]]), t);
    const r = mem.residual[Channel.PAIN];
    const q = mem.infer(s, here, Act.CONSUME, t);
    if (s === some) {
      assert.equal(q, 0, 'posited in the first slot');
      const nd = new Float64Array(NODE_LENGTH);
      assert.ok(mem.node(s, 0, nd));
      assert.deepEqual([nd[1], nd[2], nd[3]], [5, 2, 1], 'its signature is the place, light and day length of now');
      assert.ok(nd[4] & (1 << Act.CONSUME), 'and the act that had just ended');
      const nc = cue(CueKind.NODE, nd[0]);
      const took = nowOf(mem, s, keyOf(nc, Act.CONSUME), Channel.PAIN) + nowOf(mem, s, keyOf(nc, 0), Channel.PAIN);
      assert.ok(Math.abs(took - 0.889 * r) < 0.01, `the node holds ${took.toFixed(3)} of ${r.toFixed(3)} (expected 0.889 of it)`);
    } else {
      assert.equal(q, -1, 'at bias ≤ 0 nothing is set aside');
    }
  }
  assert.equal(mem.nodeCount(none), 0);
  assert.equal(mem.nodeCount(below), 0, 'a liability below 0 is the same as 0');
  assert.equal(mem.nodeCount(some), 1);
  assert.equal(tally[ActTally.RESIDUALS_SALIENT] - salient0, 3, 'the salient residual is counted whatever the bias');
  assert.equal(tally[ActTally.NODES_POSITED], 1);
});

test('a node is active where two of place, light and day length match; a fitting node is strengthened, a non-fitting context posits another', () => {
  const { mem, slots } = minds([4]);
  const [a] = slots;
  const A = thing(5);
  const at = lookAt(5, 2, 1);
  let t = familiar(mem, a, A, at);
  const hurt = outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.5]]);
  const ks = actKeys(A, at);
  mem.update(a, ks, ks.length, hurt, t);
  mem.infer(a, at, Act.CONSUME, t);
  const out = new Uint32Array(2);
  assert.equal(mem.activeNodes(a, lookAt(5, 2, 3), out), 1, 'place and light');
  assert.equal(mem.activeNodes(a, lookAt(9, 2, 1), out), 1, 'light and day length, elsewhere');
  assert.equal(mem.activeNodes(a, lookAt(5, 0, 3), out), 0, 'place alone');
  assert.equal(mem.activeNodes(a, lookAt(9, 0, 1), out), 0, 'day length alone');

  const nd = new Float64Array(NODE_LENGTH);
  mem.node(a, 0, nd);
  const strength0 = nd[5];
  // The same surprise elsewhere in the same light and season: the node fits and is strengthened.
  const elsewhere = lookAt(9, 2, 1);
  t = familiar(mem, a, thing(6), elsewhere, t + 1);
  const ks2 = actKeys(thing(6), elsewhere);
  mem.update(a, ks2, ks2.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.6]]), t);
  assert.equal(mem.infer(a, elsewhere, Act.CONSUME, t), 0);
  assert.equal(mem.nodeCount(a), 1);
  mem.node(a, 0, nd);
  assert.ok(nd[5] > strength0, `strength ${strength0.toFixed(3)} → ${nd[5].toFixed(3)}`);
  assert.deepEqual([nd[1], nd[2], nd[3]], [5, 2, 1], 'the signature stays where it was posited');
  // In a context matching one of three, a second node.
  const other = lookAt(9, 0, 3);
  t = familiar(mem, a, thing(7), other, t + 1);
  const ks3 = actKeys(thing(7), other);
  mem.update(a, ks3, ks3.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.6]]), t);
  assert.equal(mem.infer(a, other, Act.CONSUME, t), 1);
  assert.equal(mem.nodeCount(a), 2);
});

test('with sixteen nodes the weakest is replaced, under a new serial, so its old associations are never read as the new node\'s', () => {
  const { mem, slots } = minds([4]);
  const [a] = slots;
  const A = thing(5);
  // Contexts that never share two of three (payloads beyond the real bands, which the mind does not interpret).
  let t = 1;
  const nd = new Float64Array(NODE_LENGTH);
  for (let i = 0; i <= MEMORY.nodes; i++) {
    const look = lookAt(i, i, i);
    const ks = actKeys(A, look);
    // Make the context keys familiar too, so the residual is salient.
    for (let n = 0; n < 30; n++) mem.update(a, ks, ks.length, outcome([[Channel.HUNGER, -0.4]]), t++);
    mem.update(a, ks, ks.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.5]]), t);
    const q = mem.infer(a, look, Act.CONSUME, t);
    if (i < MEMORY.nodes) assert.equal(q, i, `node ${i} posited in slot ${i}`);
    else {
      // All were posited with about the same strength; the first has decayed longest, so it is the weakest.
      assert.equal(q, 0, 'the weakest (oldest) replaced');
      mem.node(a, 0, nd);
      assert.equal(nd[0], MEMORY.nodes + 1, 'a new serial');
      assert.deepEqual([nd[1], nd[2], nd[3]], [i, i, i]);
      const old = cue(CueKind.NODE, 1);
      assert.ok(mem.entry(a, keyOf(old, 0), e), 'the old node\'s association is still in the table, unread');
    }
    t += 50;
  }
  assert.equal(mem.nodeCount(a), MEMORY.nodes);
});

test('an active node enters valuation like a thing; for a remembered thing elsewhere the nodes active there replace those here', () => {
  const { mem, slots } = minds([4, 0]);
  const [withNode, without] = slots;
  const A = thing(5);
  const at = lookAt(5, 2, 1);
  let t = 1;
  const ks = actKeys(A, at);
  for (const s of slots) {
    t = familiar(mem, s, A, at, t);
    mem.update(s, ks, ks.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.5]]), t);
    mem.infer(s, at, Act.CONSUME, t);
  }
  const p = new Float64Array(PREDICTION_LENGTH);
  const painOf = (s: number, look: Percepts, act: number, there = 0) => {
    mem.begin(s, look);
    mem.predict(thing(8), act, 0, p, there);
    return p[Channel.PAIN];
  };
  // Here: place and day length match (light differs).
  const here = lookAt(5, 0, 1);
  const nodeCue = cue(CueKind.NODE, 1);
  const alone = nowOf(mem, withNode, keyOf(nodeCue, 0), Channel.PAIN);
  const withAct = nowOf(mem, withNode, keyOf(nodeCue, Act.CONSUME), Channel.PAIN);
  assert.ok(alone > 0.1 && withAct > 0.1);
  const d1 = painOf(withNode, here, Act.CONSUME) - painOf(without, here, Act.CONSUME);
  assert.ok(Math.abs(d1 - (alone + withAct)) < 1e-6, `consume here: +${d1.toFixed(4)} (node alone and with the act)`);
  const d2 = painOf(withNode, here, Act.REST) - painOf(without, here, Act.REST);
  assert.ok(Math.abs(d2 - alone) < 1e-6, `rest here: +${d2.toFixed(4)} (node alone only)`);
  // A remembered thing at place 6: there only day length matches, so the node is not active there.
  const there = cue(CueKind.PLACE, 6);
  const d3 = painOf(withNode, here, Act.CONSUME, there) - painOf(without, here, Act.CONSUME, there);
  assert.ok(Math.abs(d3) < 1e-6, `consume there: ${d3.toFixed(6)}`);
  // From a look where the node is not active, a remembered thing at its place in the same light brings it in.
  const away = lookAt(9, 0, 3);
  const d4 = painOf(withNode, away, Act.CONSUME) - painOf(without, away, Act.CONSUME);
  assert.ok(Math.abs(d4) < 1e-6, 'not active away');
  const d5 = painOf(withNode, lookAt(9, 2, 3), Act.CONSUME, cue(CueKind.PLACE, 5)) - painOf(without, lookAt(9, 2, 3), Act.CONSUME, cue(CueKind.PLACE, 5));
  assert.ok(Math.abs(d5 - (alone + withAct)) < 1e-6, `active there (place and light): +${d5.toFixed(4)}`);
});

test('a node active when an act ended learns what followed it hours later, when the record leaves the buffer', () => {
  const { mem, slots } = minds([4]);
  const [a] = slots;
  const A = thing(5);
  const at = lookAt(5, 2, 1);
  let t = familiar(mem, a, A, at);
  const ks = actKeys(A, at);
  mem.update(a, ks, ks.length, outcome([[Channel.HUNGER, -0.4], [Channel.PAIN, 0.5]]), t);
  mem.infer(a, at, Act.CONSUME, t);
  const nk = keyOf(cue(CueKind.NODE, 1), Act.REST);
  // An act done while the node was active, then pain an hour later, then the record ages out of the buffer.
  mem.update(a, Uint32Array.from([nk]), 1, outcome([]), t + 1);
  mem.push(a, keyOf(thing(20), Act.REST), 0, t + 1, nk, 0);
  mem.credit(a, outcome([[Channel.PAIN, 0.3]]), t + 7);
  for (let i = 0; i < MEMORY.records; i++) mem.push(a, keyOf(thing(30 + i), Act.REST), 0, t + 8 + i);
  assert.ok(mem.entry(a, nk, e));
  const later = e[CHANNELS + Channel.PAIN];
  assert.ok(later > 0.05, `the node's (node, rest) later pain ${later.toFixed(3)}`);
});

test('hiddenCauseBias is a liability on the genome: founders centred on 0, about half setting nothing aside, every value at or below 0 neutral', () => {
  assert.ok(GENE_DIALS.some((g) => g.dial === HIDDEN_CAUSE_BIAS));
  assert.equal(HIDDEN_CAUSE_BIAS.neutral, 0);
  assert.ok(HIDDEN_CAUSE_BIAS.min < 0, 'room below neutral, so mutation moves it both ways');
  const sim = world(5, 64, { count: 400, radiusM: 2000 });
  stepSim(sim, 1);
  const agents = sim.state.agents;
  const xs: number[] = [];
  for (let s = 0; s < agents.highWater; s++) if (agents.isAlive(s)) xs.push(agents.column<Float64Array>(GENETICS_COLUMNS.hiddenCauseBias.name).data[s]);
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const off = xs.filter((x) => x <= 0).length / xs.length;
  assert.ok(Math.abs(mean) < 0.15, `mean ${mean.toFixed(3)}`);
  assert.ok(off > 0.4 && off < 0.6, `share at or below 0: ${off.toFixed(2)}`);
  assert.ok(Math.max(...xs) < 2.4 && Math.min(...xs) > -2.4);
});

test('nodes in the real pipeline: none at all at bias 0; at bias 2 they form from experience, held within sixteen, and none at birth', () => {
  const run = (bias: number) => {
    const sim = world(13, 64, { count: 30, radiusM: 2000 });
    stepSim(sim, 1);
    const col = sim.state.agents.column<Float64Array>(GENETICS_COLUMNS.hiddenCauseBias.name).data;
    for (let s = 0; s < sim.state.agents.highWater; s++) col[s] = bias;
    stepSim(sim, 144 * 8);
    return sim;
  };
  const off = run(0);
  const offTally = tallyOf(off);
  assert.equal(offTally[ActTally.NODES_POSITED], 0);
  assert.ok(offTally[ActTally.RESIDUALS_SALIENT] > 0, 'residuals were salient, but nothing was set aside');
  const ids = off.state.agents.column<Uint32Array>(MEMORY_COLUMNS.nodeId.name).data;
  assert.ok(ids.every((x) => x === 0));

  const on = run(2);
  const tally = tallyOf(on);
  assert.ok(tally[ActTally.NODES_POSITED] > 0, `posited ${tally[ActTally.NODES_POSITED]}, strengthened ${tally[ActTally.NODES_STRENGTHENED]}`);
  const mem = createMemory(on);
  mem.refresh();
  let held = 0;
  for (let s = 0; s < on.state.agents.highWater; s++) {
    if (!on.state.agents.isAlive(s)) continue;
    const n = mem.nodeCount(s);
    assert.ok(n <= MEMORY.nodes);
    held += n;
  }
  assert.ok(held > 0, `the living hold ${held} nodes`);
  for (const spec of [MEMORY_COLUMNS.nodeId, MEMORY_COLUMNS.nodeStrength, MEMORY_COLUMNS.epiNodes, MEMORY_COLUMNS.nodeSerial]) {
    assert.equal(spec.category, 'learned', `${spec.name} is learned content`);
  }
});
