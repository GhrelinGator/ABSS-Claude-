// Guardrail: agents start knowing nothing (CLAUDE.md rule 4, docs/GUARDRAILS.md
// T5 and T6). Founders and newborns alike hold no learned content when their
// slot is assigned, nothing leaks through a reused slot, and no system writes
// learned content for an agent during the tick it was spawned.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshSpawnProblems, learnedContentProblems } from '../../src/sim/core/audit.ts';
import { CATEGORIES } from '../../src/sim/core/store.ts';
import { defaultConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { SimState, createSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim, StatePart } from '../../src/sim/sim.ts';
import { FIXTURE_PIPELINE, fxBurn, fxChurn, fxLearn, fxSeedKnowledge, fxWander } from '../fixtures/systems.ts';
import { checkSpawnSites, readSources } from './lib/scan.ts';
import { populateWithBodies } from '../fixtures/bodies.ts';

function liveSlots(sim: Sim): number[] {
  const slots: number[] = [];
  for (let slot = 0; slot < sim.state.agents.highWater; slot++) {
    if (sim.state.agents.isAlive(slot)) slots.push(slot);
  }
  return slots;
}

test('a newly spawned agent holds no learned content (real pipeline)', () => {
  const sim = createSim(defaultConfig(1), SIM_PIPELINE);
  for (let i = 0; i < 300; i++) {
    const slot = spawnAgent(sim, 100 + i, 200 + i);
    assert.deepEqual(learnedContentProblems(sim.state, slot), []);
  }
  assert.deepEqual(freshSpawnProblems(sim.state, 0), []);
});

test('every column declares what kind of state it holds', () => {
  for (const pipeline of [SIM_PIPELINE, FIXTURE_PIPELINE]) {
    const sim = createSim(defaultConfig(1), pipeline);
    for (const store of sim.state.stores) {
      for (const column of store.columns) {
        assert.ok(CATEGORIES.includes(column.category), `${store.name}.${column.name} has no category`);
      }
    }
  }
});

test('a reused slot keeps nothing from its previous occupant', () => {
  const sim = createSim(defaultConfig(4), FIXTURE_PIPELINE);
  stepSim(sim, 600);
  const agents = sim.state.agents;
  const occupied = liveSlots(sim).filter((slot) => learnedContentProblems(sim.state, slot).length === 2);
  assert.ok(occupied.length > 50, 'the fixture should have filled both the learned column and the learned part');

  for (const victim of occupied.slice(0, 25)) {
    const previousId = agents.id.data[victim];
    agents.remove(victim);
    assert.deepEqual(learnedContentProblems(sim.state, victim), [], 'content survived removal');
    let slot = -1;
    for (let guard = 0; guard < 1000 && slot !== victim; guard++) {
      slot = spawnAgent(sim, 500, 500);
      assert.deepEqual(learnedContentProblems(sim.state, slot), [], `slot ${slot} was not blank at spawn`);
    }
    assert.equal(slot, victim, 'the freed slot was never reused');
    assert.notEqual(agents.id.data[victim], previousId, 'ids must never be reused');
    for (const column of agents.columns) {
      if (column.category === 'learned' || column.category === 'genome') {
        for (let k = 0; k < column.width; k++) assert.equal(column.data[victim * column.width + k], 0);
      }
    }
  }
});

for (const [label, pipeline] of [
  ['fixture pipeline', FIXTURE_PIPELINE],
  ['real pipeline', SIM_PIPELINE],
] as const) {
  test(`${label}: no agent holds learned content during the tick it was spawned`, () => {
    const sim = createSim(defaultConfig(6), pipeline);
    if (pipeline === SIM_PIPELINE) populateWithBodies(sim, 50, 100, 100);
    assert.deepEqual(freshSpawnProblems(sim.state, 0), []);
    for (let t = 0; t < 2_000; t++) {
      stepSim(sim, 1);
      const problems = freshSpawnProblems(sim.state, sim.state.tick - 1);
      assert.deepEqual(problems, [], `after tick ${sim.state.tick - 1}`);
    }
  });
}

test('the check catches a system that hands newborns ready-made knowledge', () => {
  const sim = createSim(defaultConfig(6), [fxChurn, fxWander, fxBurn, fxLearn, fxSeedKnowledge]);
  let caught = 0;
  for (let t = 0; t < 50; t++) {
    stepSim(sim, 1);
    caught += freshSpawnProblems(sim.state, sim.state.tick - 1).length;
  }
  assert.ok(caught > 0);
});

test('a state part that holds learned content must say when it is empty', () => {
  const state = new SimState(defaultConfig(1));
  const silent = { name: 'fx.silent', holdsLearned: true, write() {}, read() {} } as StatePart;
  assert.throws(() => state.addPart(silent), /learnedEmptyFor/);
});

test('only the kernel assigns agent slots', () => {
  assert.ok(checkSpawnSites('src/sim/mind/sample.ts', 'const slot = state.agents.spawn();').length > 0);
  assert.deepEqual(checkSpawnSites('src/sim/mind/sample.ts', '// agents.spawn() is off limits here'), []);
  const problems: string[] = [];
  for (const { path, text } of readSources('src/sim')) problems.push(...checkSpawnSites(path, text));
  assert.deepEqual(problems, []);
});
