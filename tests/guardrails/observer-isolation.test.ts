// Guardrail: the analysis layer watches and never touches (CLAUDE.md,
// docs/DESIGN.md §8.1). A run with every observer attached must end in
// exactly the same state as a run with none.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getObserver, observerNames } from '../../src/analysis/index.ts';
import type { Observer } from '../../src/analysis/index.ts';
import { defaultConfig } from '../../src/sim/config.ts';
import { viewOf } from '../../src/sim/readonly.ts';
import { createSim, hashSim, stepSim } from '../../src/sim/sim.ts';
import { FIXTURE_PIPELINE } from '../fixtures/systems.ts';

function run(observers: Observer[]): string[] {
  const sim = createSim(defaultConfig(17), FIXTURE_PIPELINE);
  const view = viewOf(sim);
  const hashes: string[] = [];
  for (let t = 0; t < 2_000; t += 10) {
    stepSim(sim, 10);
    for (const observer of observers) observer.observe(view);
    if (sim.state.tick % 500 === 0) hashes.push(hashSim(sim));
  }
  return hashes;
}

test('attaching every observer leaves the simulation unchanged', () => {
  const names = observerNames();
  assert.ok(names.length > 0);
  assert.deepEqual(run(names.map(getObserver)), run([]));
});

test('the comparison would catch an observer that writes', () => {
  const vandal: Observer = {
    name: 'vandal',
    observe(view) {
      (view.agents.column('x') as unknown as Float64Array)[0] += 1;
      return {};
    },
  };
  assert.notDeepEqual(run([vandal]), run([]));
});

test('observers report through the read-only view', () => {
  const sim = createSim(defaultConfig(17), FIXTURE_PIPELINE);
  stepSim(sim, 50);
  const measured = getObserver('census').observe(viewOf(sim));
  assert.equal(measured.agents, sim.state.agents.count);
  assert.equal(measured.scanned, sim.state.agents.count);
});
