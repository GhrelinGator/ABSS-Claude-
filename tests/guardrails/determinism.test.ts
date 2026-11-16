// Guardrail: same seed + same config = bit-identical state, across runs and
// across a save/load round trip (CLAUDE.md, docs/DESIGN.md §1.4).
//
// The fixture pipeline exercises the kernel hard (random births and removals,
// slot reuse, store growth, per-agent streams, periodic systems, a sparse
// state part). The same checks then run against the real pipeline, so every
// system added in later phases is covered without touching this file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nonFiniteProblems } from '../../src/sim/core/audit.ts';
import { hashEncodedBytes } from '../../src/sim/core/codec.ts';
import { Hasher } from '../../src/sim/core/hash.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { FIXTURE_PIPELINE, fxChurn, fxWander, makeClimateRecorder } from '../fixtures/systems.ts';

const TICKS = 10_000;
const CHECK_EVERY = 1_000;

function populate(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) spawnAgent(sim, 1000 + i * 37.5, 2000 + i * 11.25);
}

function hashesOver(sim: Sim, ticks: number, every: number): string[] {
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t += every) {
    stepSim(sim, every);
    hashes.push(hashSim(sim));
  }
  return hashes;
}

const PIPELINES: Array<{ label: string; pipeline: readonly SystemDef[]; setup: (sim: Sim) => void }> = [
  { label: 'fixture pipeline', pipeline: FIXTURE_PIPELINE, setup: () => {} },
  { label: 'real pipeline', pipeline: SIM_PIPELINE, setup: (sim) => populate(sim, 40) },
];

for (const { label, pipeline, setup } of PIPELINES) {
  const fresh = (seed: number): Sim => {
    const sim = createSim(defaultConfig(seed), pipeline);
    setup(sim);
    return sim;
  };

  test(`${label}: two runs with the same seed stay bit-identical for ${TICKS} ticks`, () => {
    const a = hashesOver(fresh(7), TICKS, CHECK_EVERY);
    const b = hashesOver(fresh(7), TICKS, CHECK_EVERY);
    assert.deepEqual(a, b);
    assert.equal(new Set(a).size, a.length, 'the state should change between checkpoints');
  });

  test(`${label}: a different seed gives a different run`, () => {
    const a = fresh(7);
    const b = fresh(8);
    stepSim(a, 500);
    stepSim(b, 500);
    assert.notEqual(hashSim(a), hashSim(b));
  });

  test(`${label}: saving and loading mid-run changes nothing`, () => {
    const straight = fresh(21);
    stepSim(straight, TICKS);

    const first = fresh(21);
    stepSim(first, 3_333);
    const bytes = saveSim(first);
    const resumed = loadSim(bytes, pipeline);
    assert.equal(hashSim(resumed), hashSim(first), 'state differs right after loading');
    assert.deepEqual(saveSim(resumed), bytes, 'saving a loaded sim gives different bytes');
    stepSim(resumed, TICKS - 3_333);

    assert.equal(resumed.state.tick, TICKS);
    assert.equal(hashSim(resumed), hashSim(straight));
  });

  test(`${label}: the state hash is the hash of the snapshot bytes`, () => {
    const sim = fresh(5);
    stepSim(sim, 250);
    const hasher = new Hasher();
    hashEncodedBytes(hasher, saveSim(sim));
    assert.equal(hasher.digest(), hashSim(sim));
  });

  test(`${label}: one long step equals many short ones`, () => {
    const a = fresh(3);
    const b = fresh(3);
    stepSim(a, 600);
    for (let i = 0; i < 600; i++) stepSim(b, 1);
    assert.equal(hashSim(a), hashSim(b));
  });

  test(`${label}: state never holds NaN or infinite values over ${TICKS} ticks`, () => {
    // Long enough for a full compressed year: rare cases (a cell's plant cover rounding
    // past 1, say) take weeks of simulated time to turn up.
    const sim = fresh(11);
    for (let t = 0; t < TICKS; t += CHECK_EVERY) {
      stepSim(sim, CHECK_EVERY);
      assert.deepEqual(nonFiniteProblems(sim.state), [], `at tick ${sim.state.tick}`);
    }
  });
}

test('config is part of a run\'s identity', () => {
  const base = defaultConfig(1);
  const other = validateConfig({ ...base, time: { ...base.time, daysPerYear: 60 } });
  assert.notEqual(hashSim(createSim(base, SIM_PIPELINE)), hashSim(createSim(other, SIM_PIPELINE)));
});

test('a snapshot cannot be loaded into a different pipeline', () => {
  const sim = createSim(defaultConfig(1), FIXTURE_PIPELINE);
  stepSim(sim, 10);
  const bytes = saveSim(sim);
  assert.throws(() => loadSim(bytes, SIM_PIPELINE));
  assert.throws(() => loadSim(bytes, [fxChurn, fxWander]));
  assert.throws(() => loadSim(bytes.subarray(0, bytes.length - 4), FIXTURE_PIPELINE));
});

test('run-wide streams are unaffected by what agents draw', () => {
  const quiet: number[] = [];
  const busy: number[] = [];
  const a = createSim(defaultConfig(9), [makeClimateRecorder(quiet)]);
  const b = createSim(defaultConfig(9), [makeClimateRecorder(busy), fxChurn, fxWander]);
  stepSim(a, 300);
  stepSim(b, 300);
  assert.equal(quiet.length, 300);
  assert.deepEqual(quiet, busy);
  assert.ok(b.state.agents.count > 0);
});

test('a system with "every: N" runs only on ticks divisible by N', () => {
  const sim = createSim(defaultConfig(2), FIXTURE_PIPELINE);
  const memory = sim.state.agents.column<Float64Array>('fx.memory');
  stepSim(sim, 21); // fixture.learn runs at ticks 0, 5, 10, 15, 20; founders skip tick 0
  let maxCount = 0;
  for (let s = 0; s < sim.state.agents.highWater; s++) maxCount = Math.max(maxCount, memory.data[s * 4]);
  assert.equal(maxCount, 4);
});
