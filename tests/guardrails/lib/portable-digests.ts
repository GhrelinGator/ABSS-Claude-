// State hashes of short runs, for comparing two JavaScript engines
// (tests/cross-engine/print-digests.ts). They are not pinned to recorded
// values, because the fixture, the landscape, and the snapshot layout may
// change; they only have to agree between engines.
//
// This file must not use any Node-only API: it has to run on any engine.

import { defaultConfig, validateConfig } from '../../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../../src/sim/pipeline.ts';
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

/** Hashes of freshly generated landscapes: the real pipeline, at three circumscription settings, on a 192-cell map. */
export function worldHashes(): string[] {
  return [0, 0.6, 1].map((circumscription) => {
    const raw = JSON.parse(JSON.stringify(defaultConfig(41)));
    raw.world.widthCells = 192;
    raw.world.heightCells = 192;
    raw.world.circumscription = circumscription;
    return hashSim(createSim(validateConfig(raw), SIM_PIPELINE));
  });
}
