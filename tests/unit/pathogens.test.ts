// Pathogens (docs/DESIGN.md §2.14): foul standing water in summer, clean running water,
// meat that goes bad with warmth, and loads that stay in their range.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { CARCASS_LAYER, CARCASS_LOAD_LAYER, dilutedLoad } from '../../src/sim/world/animals.ts';
import { WATER_PATHOGEN_LAYER } from '../../src/sim/world/pathogens.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

function makeSim(seed: number, cells: number): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}
const days = (sim: Sim, n: number) => stepSim(sim, n * sim.config.time.ticksPerDay);
const layer = (sim: Sim, name: string) => sim.state.world.layer<Float32Array>(name);

function meanBy(sim: Sim, water: number): number {
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const load = layer(sim, WATER_PATHOGEN_LAYER);
  let sum = 0;
  let n = 0;
  for (let k = 0; k < kind.length; k++) {
    if (kind[k] !== water) continue;
    sum += load[k];
    n++;
  }
  return n > 0 ? sum / n : NaN;
}

test('standing water fouls in summer and clears in winter; running water stays cleaner', () => {
  const sim = makeSim(7, 256);
  assert.ok(meanBy(sim, Water.LAKE) > 0, 'this map should have lakes');
  let summer = 0;
  let winter = Infinity;
  let river = 0;
  let spring = 0;
  for (let d = 0; d < sim.config.time.daysPerYear; d++) {
    days(sim, 1);
    const lake = meanBy(sim, Water.LAKE);
    if (d >= 10 && d < 26 && lake > summer) {
      summer = lake;
      river = meanBy(sim, Water.RIVER);
      spring = meanBy(sim, Water.SPRING);
    }
    if (d >= 38 && lake < winter) winter = lake;
  }
  assert.ok(summer > 0.3, `lakes reached only ${summer.toFixed(3)} in summer`);
  assert.ok(winter < 0.5 * summer, `lakes ${winter.toFixed(3)} in winter vs ${summer.toFixed(3)} in summer`);
  assert.ok(river < 0.25 * summer, `rivers ${river.toFixed(3)} vs lakes ${summer.toFixed(3)}`);
  if (!Number.isNaN(spring)) assert.ok(spring <= river + 1e-6, `springs ${spring.toFixed(4)} vs rivers ${river.toFixed(4)}`);
});

test('a carcass beside a river fouls it, and the river runs clean again once it is gone', () => {
  const sim = makeSim(7, 192);
  const { widthCells: W } = sim.config.world;
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  let bank = -1;
  let river = -1;
  for (let k = W; k < kind.length - W && bank < 0; k++) {
    if (kind[k] === Water.RIVER && kind[k + 1] === Water.DRY && k % W < W - 1) {
      river = k;
      bank = k + 1;
    }
  }
  assert.ok(bank >= 0, 'no river bank found');
  const meat = layer(sim, CARCASS_LAYER);
  const load = layer(sim, WATER_PATHOGEN_LAYER);
  const clean = load[river];
  meat[bank] += 300;
  days(sim, 2);
  assert.ok(load[river] > clean + 0.3, `river load ${load[river].toFixed(3)} beside 300 kg of carcass`);
  meat[bank] = 0;
  days(sim, 6);
  assert.ok(load[river] < 0.05, `river load ${load[river].toFixed(3)} six days after the carcass went`);
});

test('meat goes foul with warmth, and fresh meat dilutes it by weight', () => {
  const sim = makeSim(7, 128);
  days(sim, 12); // early summer
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const elevation = layer(sim, TERRAIN_LAYERS.elevation);
  let low = -1;
  for (let k = 0; k < kind.length; k++) if (kind[k] === Water.DRY && (low < 0 || elevation[k] < elevation[low])) low = k;
  const meat = layer(sim, CARCASS_LAYER);
  const foul = layer(sim, CARCASS_LOAD_LAYER);
  meat[low] = 1000;
  foul[low] = 0;
  days(sim, 5);
  assert.ok(meat[low] > 0, 'the meat should not be gone yet');
  assert.ok(foul[low] > 0.5, `meat only ${foul[low].toFixed(3)} foul after five summer days`);
  assert.equal(dilutedLoad(0.8, 30, 90), 0.2);
  assert.equal(dilutedLoad(0.8, 0, 90), 0.8);
  meat[low] = 0;
  days(sim, 1);
  assert.equal(foul[low], 0, 'no meat, no load');
});

test('loads stay between 0 and 1, and dry land carries no water load', () => {
  const sim = makeSim(3, 128);
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  for (let step = 0; step < 6; step++) {
    days(sim, 8);
    const load = layer(sim, WATER_PATHOGEN_LAYER);
    const foul = layer(sim, CARCASS_LOAD_LAYER);
    for (let k = 0; k < kind.length; k++) {
      assert.ok(load[k] >= 0 && load[k] <= 1 && foul[k] >= 0 && foul[k] <= 1, `cell ${k} out of range`);
      if (kind[k] === Water.DRY) assert.equal(load[k], 0);
    }
  }
});
