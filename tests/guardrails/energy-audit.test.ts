// Guardrail: conserved quantities balance for every live entity
// (docs/GUARDRAILS.md §1 and T11). Real energy and water arrive in Phase 2;
// until then the audit runs against the fixture's bookkeeping, and a tripwire
// makes sure body columns that look like energy or water cannot appear
// without the bookkeeping the audit needs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditConserved, conservedLayoutProblems } from '../../src/sim/core/audit.ts';
import { EntityStore } from '../../src/sim/core/store.ts';
import { defaultConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import { FIXTURE_PIPELINE, FX_KCAL, fxBurn, fxChurn, fxLeak, fxWander } from '../fixtures/systems.ts';
import { splitWords } from './lib/scan.ts';

test('balanced bookkeeping passes the audit over a long run', () => {
  const sim = createSim(defaultConfig(13), FIXTURE_PIPELINE);
  for (let t = 0; t < 20_000; t += 500) {
    stepSim(sim, 500);
    assert.deepEqual(auditConserved(sim.state.agents), [], `at tick ${sim.state.tick}`);
  }
  const stock = sim.state.agents.column<Float64Array>(FX_KCAL.name).data;
  let positive = 0;
  for (let slot = 0; slot < sim.state.agents.highWater; slot++) if (stock[slot] > 0) positive++;
  assert.ok(positive > 50, 'the fixture should actually be moving energy around');
});

test('the audit catches energy that appears from nowhere', () => {
  const sim = createSim(defaultConfig(13), [fxChurn, fxWander, fxBurn, fxLeak]);
  stepSim(sim, 10);
  const problems = auditConserved(sim.state.agents);
  assert.ok(problems.length > 0);
  assert.match(problems[0], /energy does not balance/);
});

test('the audit catches NaN in the books', () => {
  const sim = createSim(defaultConfig(13), [fxChurn, fxWander, fxBurn]);
  stepSim(sim, 10);
  const agents = sim.state.agents;
  let slot = 0;
  while (!agents.isAlive(slot)) slot++;
  agents.column<Float64Array>(FX_KCAL.name).data[slot] = Number.NaN;
  assert.ok(auditConserved(agents).length > 0);
});

test('a conserved quantity needs a stock, an inflow, and an outflow', () => {
  const store = new EntityStore('fixtureStore');
  store.ensureColumn({ name: 'water', dtype: 'f64', category: 'body', conserved: { quantity: 'water', role: 'stock' } });
  assert.ok(conservedLayoutProblems(store).length > 0);
  store.ensureColumn({ name: 'waterIn', dtype: 'f64', category: 'body', conserved: { quantity: 'water', role: 'inflow' } });
  store.ensureColumn({ name: 'waterOut', dtype: 'f32', category: 'body', conserved: { quantity: 'water', role: 'outflow' } });
  assert.ok(conservedLayoutProblems(store).length > 0, 'an f32 column should be rejected');
});

test('the real pipeline balances, and cannot hold untracked energy or water', () => {
  const sim = createSim(defaultConfig(13), SIM_PIPELINE);
  for (let i = 0; i < 50; i++) spawnAgent(sim, 100 + i, 100);
  stepSim(sim, 5_000);
  const suspicious = new Set(['kcal', 'energy', 'calorie', 'calories', 'joule', 'joules', 'fat', 'water', 'hydration']);
  for (const store of sim.state.stores) {
    assert.deepEqual(auditConserved(store), []);
    for (const column of store.columns) {
      const looksConserved = splitWords(column.name).some(({ word }) => suspicious.has(word));
      if (column.category !== 'body' || !looksConserved) continue;
      assert.ok(
        column.conserved !== null,
        `${store.name}.${column.name} looks like energy or water but is not tagged as a conserved stock, inflow, or outflow`,
      );
    }
  }
});
