// Guardrail: conserved quantities balance for every live entity
// (docs/GUARDRAILS.md §1 and T11). Since Phase 2.1 the audit checks real
// bodies (docs/DESIGN.md §3.8) as well as the fixture's bookkeeping, and a
// tripwire makes sure body columns that look like energy or water cannot
// appear without the bookkeeping the audit needs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditConserved, conservedLayoutProblems } from '../../src/sim/core/audit.ts';
import { EntityStore } from '../../src/sim/core/store.ts';
import { defaultConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import { BODY_COLUMNS, metabolism } from '../../src/sim/body/metabolism.ts';
import { fxBodyWork, populateWithBodies } from '../fixtures/bodies.ts';
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

test('the real pipeline balances bodies that eat, work, fatten and starve, and cannot hold untracked energy or water', () => {
  const sim = createSim(defaultConfig(13), [...SIM_PIPELINE, fxBodyWork]);
  populateWithBodies(sim, 50, 100, 100);
  for (let t = 0; t < 6_000; t += 500) {
    stepSim(sim, 500);
    assert.deepEqual(auditConserved(sim.state.agents), [], `at tick ${sim.state.tick}`);
  }
  const agents = sim.state.agents;
  const eaten = agents.column<Float64Array>(BODY_COLUMNS.energyIn.name).data;
  const spent = agents.column<Float64Array>(BODY_COLUMNS.energyOut.name).data;
  let fed = 0;
  let burned = 0;
  for (let slot = 0; slot < agents.highWater; slot++) {
    if (!agents.isAlive(slot)) continue;
    if (spent[slot] > 50_000) burned++;
    if (eaten[slot] > 160_000) fed++;
  }
  assert.ok(burned > 5 && fed > 5, `the bodies should actually be spending and eating (${burned}, ${fed})`);
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

test('the audit catches a body system that conjures energy', () => {
  const leak = defineSystem({
    name: 'fixture.bodyLeak',
    create: (sim) => () => {
      const energy = sim.state.agents.column<Float64Array>(BODY_COLUMNS.energy.name).data;
      if (sim.state.agents.isAlive(0)) energy[0] += 1;
    },
  });
  const sim = createSim(defaultConfig(13), [metabolism, leak]);
  populateWithBodies(sim, 3, 100, 100);
  stepSim(sim, 3);
  const problems = auditConserved(sim.state.agents);
  assert.ok(problems.length > 0);
  assert.match(problems[0], /energy does not balance/);
});
