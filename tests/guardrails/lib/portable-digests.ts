// State hashes of a short run of the fixture pipeline, for comparing two
// JavaScript engines (tests/cross-engine/print-digests.ts). They are not
// pinned to recorded values, because the fixture and the snapshot layout may
// change; they only have to agree between engines.
//
// This file must not use any Node-only API: it has to run on any engine.

import { defaultConfig } from '../../../src/sim/config.ts';
import { createSim, hashSim, stepSim } from '../../../src/sim/sim.ts';
import { FIXTURE_PIPELINE } from '../../fixtures/systems.ts';

export function fixtureRunHashes(): string[] {
  const sim = createSim(defaultConfig(31), FIXTURE_PIPELINE);
  const hashes: string[] = [];
  for (let i = 0; i < 4; i++) {
    stepSim(sim, 500);
    hashes.push(hashSim(sim));
  }
  return hashes;
}
