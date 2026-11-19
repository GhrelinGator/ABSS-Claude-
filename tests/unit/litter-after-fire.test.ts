// A fire burns the year's dead grass and herbs where they stand, so they can't also fall as
// litter later that year (T-006). Without this, burned meadows refuelled within days.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { FIRE_LAYERS } from '../../src/sim/world/fire.ts';
import { LAST_BURN_LAYER, MATERIAL_LAYERS } from '../../src/sim/world/materials.ts';
import { PLANT_SPECIES, coverLayer } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

function makeSim(): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(7)));
  raw.world.widthCells = 128;
  raw.world.heightCells = 128;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

test('the burn layer read by materials is the one fire writes', () => {
  assert.equal(LAST_BURN_LAYER, FIRE_LAYERS.lastBurnDay);
});

test('a meadow burned before the litter falls gets almost no litter that year', () => {
  const burnedSim = makeSim();
  const twin = makeSim();
  const perDay = burnedSim.config.time.ticksPerDay;
  // Day 21 is season 0.4375, just before the dying-back season (0.45-0.7) when litter falls.
  stepSim(burnedSim, 21 * perDay);
  stepSim(twin, 21 * perDay);
  const world = burnedSim.state.world;
  const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const cover = (name: string) => world.layer<Float32Array>(coverLayer(PLANT_SPECIES.find((s) => s.name === name)!));
  const grass = cover('grass');
  const nut = cover('nut');
  const berry = cover('berry');
  let meadow = -1;
  for (let k = 0; k < kind.length && meadow < 0; k++) {
    if (kind[k] === Water.DRY && grass[k] > 0.2 && nut[k] + berry[k] < 0.02) meadow = k;
  }
  assert.ok(meadow >= 0, 'no open meadow on this map');
  const litter = world.layer<Float32Array>(MATERIAL_LAYERS.litter);
  const twinLitter = twin.state.world.layer<Float32Array>(MATERIAL_LAYERS.litter);
  world.layer<Float32Array>(LAST_BURN_LAYER)[meadow] = 21 + 1;
  litter[meadow] = 0;
  twinLitter[meadow] = 0;
  stepSim(burnedSim, 14 * perDay);
  stepSim(twin, 14 * perDay);
  assert.ok(twinLitter[meadow] > 100, `the unburned twin should gather litter (${twinLitter[meadow].toFixed(1)} kg)`);
  // Only the few bushes and trees (under 2% cover against over 20% grass) still drop leaves.
  assert.ok(litter[meadow] < 0.15 * twinLitter[meadow], `burned meadow gathered ${litter[meadow].toFixed(1)} kg vs ${twinLitter[meadow].toFixed(1)}`);
});
