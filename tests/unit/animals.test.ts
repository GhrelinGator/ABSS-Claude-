// Animals (docs/DESIGN.md §2.13), checked against their own rules and against
// calibration bands. Bands are wide on purpose; the ecology review (1.10) judges the numbers.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import {
  ANIMAL_FIELDS as F,
  ANIMAL_PARTS,
  ANIMAL_STORE,
  ANIMAL_CONSTANTS,
  AnimalKind,
  CARCASS_LAYER,
  GROUP_KINDS,
  HARE,
  HARE_LAYER,
  habitatKm2,
} from '../../src/sim/world/animals.ts';
import { PLANT_CONSTANTS, PLANT_SPECIES, SEED_RAIN_LAYER, coverLayer } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

function makeSim(seed: number, cells: number): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

const days = (sim: Sim, n: number) => stepSim(sim, n * sim.config.time.ticksPerDay);
const counts = (sim: Sim) => sim.state.parts.find((p) => p.name === ANIMAL_PARTS.counts)!.readings!();

/** Animals of each kind, and groups of each kind, now. */
function census(sim: Sim) {
  const store = sim.state.store(ANIMAL_STORE);
  const kind = store.column('kind').data;
  const count = store.column('count').data;
  const animals: Record<number, number> = {};
  const groups: Record<number, number> = {};
  for (const spec of GROUP_KINDS) {
    animals[spec.kind] = 0;
    groups[spec.kind] = 0;
  }
  for (let s = 0; s < store.highWater; s++) {
    if (!store.isAlive(s)) continue;
    animals[kind[s]] += count[s];
    groups[kind[s]] += 1;
  }
  const hareLayer = sim.state.world.layer<Float32Array>(HARE_LAYER);
  let hares = 0;
  for (let k = 0; k < hareLayer.length; k++) hares += hareLayer[k];
  return { animals, groups, hares };
}

test('setup: starting densities per km² of habitat, groups on land, predators spread out', () => {
  const sim = makeSim(7, 192);
  const km2 = habitatKm2(sim);
  const { animals, hares } = census(sim);
  for (const spec of GROUP_KINDS) {
    const density = animals[spec.kind] / km2;
    assert.ok(Math.abs(density - spec.startPerKm2) <= 0.25 * spec.startPerKm2 + 1 / km2, `${spec.name}: ${density} per km²`);
  }
  // Hares start in proportion to forage, up to twice the density on the richest land.
  assert.ok(hares / km2 > 0.75 * HARE.startPerKm2 && hares / km2 < 2 * HARE.startPerKm2, `hares ${hares / km2} per km² of habitat`);
  const store = sim.state.store(ANIMAL_STORE);
  const c = (n: string) => store.column(n).data;
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const W = sim.config.world.widthCells;
  const cs = sim.config.world.cellSizeM;
  const wolves: Array<[number, number]> = [];
  for (let s = 0; s < store.highWater; s++) {
    if (!store.isAlive(s)) continue;
    const cell = Math.floor(c('y')[s] / cs) * W + Math.floor(c('x')[s] / cs);
    assert.equal(kind[cell], Water.DRY, `group ${s} starts in water`);
    if (c('kind')[s] === AnimalKind.WOLF) wolves.push([c('x')[s], c('y')[s]]);
  }
  for (let a = 0; a < wolves.length; a++) {
    for (let b = a + 1; b < wolves.length; b++) {
      const d = Math.hypot(wolves[a][0] - wolves[b][0], wolves[a][1] - wolves[b][1]);
      assert.ok(d >= ANIMAL_CONSTANTS.wolfPackSpacingM, `wolf packs ${d.toFixed(0)} m apart`);
    }
  }
});

test('grazers reach water every day or so', () => {
  const sim = makeSim(7, 160);
  const store = sim.state.store(ANIMAL_STORE);
  let worst = 0;
  for (let h = 0; h < 72; h++) {
    stepSim(sim, sim.config.time.ticksPerDay / 24);
    const kind = store.column('kind').data;
    const thirst = store.column('thirst').data;
    for (let s = 0; s < store.highWater; s++) {
      if (!store.isAlive(s) || (kind[s] !== AnimalKind.DEER && kind[s] !== AnimalKind.AUROCHS)) continue;
      if (thirst[s] > worst) worst = thirst[s];
    }
  }
  assert.ok(worst < 40, `a group went ${worst} hours without water`);
});

test('predators: kill rates in the field range, cats strike at night, only wolf packs take aurochs', () => {
  const sim = makeSim(2, 256);
  const before = census(sim);
  const year = sim.config.time.daysPerYear;
  days(sim, 2 * year);
  const after = census(sim);
  const v = counts(sim);
  const wolfDays = ((before.animals[AnimalKind.WOLF] + after.animals[AnimalKind.WOLF]) / 2) * 2 * year;
  const catDays = ((before.animals[AnimalKind.CAT] + after.animals[AnimalKind.CAT]) / 2) * 2 * year;
  const wolfRate = (v[F.wolfKillsDeer] + v[F.wolfKillsAurochs]) / wolfDays;
  const catRate = v[F.catKillsDeer] / catDays;
  // Field studies: 0.018 (moose and caribou) to 0.12 (red deer) ungulates per wolf per day.
  assert.ok(wolfRate > 0.02 && wolfRate < 0.25, `wolves killed ${wolfRate.toFixed(3)} ungulates per wolf per day`);
  assert.ok(catRate > 0.02 && catRate < 0.25, `cats killed ${catRate.toFixed(3)} deer per cat per day`);
  const success = v[F.wolfKillsDeer] / v[F.wolfChases];
  assert.ok(success > 0.05 && success < 0.4, `wolf chase success ${success.toFixed(2)}`);
  assert.equal(v[F.catKillsAtNight], v[F.catKillsDeer], 'every cat kill should be at night');
  assert.equal(v[F.catKillsAurochs], 0, 'a lone cat should never bring down an aurochs');
  assert.ok(v[F.wolfKillsHare] + v[F.catKillsHare] > 0, 'nobody ever caught a hare');
});

test('carcasses are eaten or rot away within weeks', () => {
  const sim = makeSim(7, 128);
  const carcass = sim.state.world.layer<Float32Array>(CARCASS_LAYER);
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  let cell = 0;
  while (kind[cell] !== Water.DRY) cell++;
  carcass[cell] += 100;
  days(sim, 20);
  assert.ok(carcass[cell] < 20, `${carcass[cell].toFixed(1)} kg left after 20 days`);
});

test('grazers carry seeds, and a seed that lands where the habitat allows starts a patch', () => {
  const sim = makeSim(7, 128);
  days(sim, 1);
  const rain = sim.state.world.layer<Uint8Array>(SEED_RAIN_LAYER);
  let landed = 0;
  for (let k = 0; k < rain.length; k++) if (rain[k] !== 0) landed++;
  assert.ok(landed > 0, 'no seeds dropped anywhere');
  // A berry patch removed, then seeded again: it comes back as a founder.
  const berry = PLANT_SPECIES.findIndex((s) => s.name === 'berry');
  const cover = sim.state.world.layer<Float32Array>(coverLayer(PLANT_SPECIES[berry]));
  let cell = 0;
  while (cover[cell] <= 0.01) cell++;
  cover[cell] = 0;
  rain[cell] |= 1 << berry;
  days(sim, 4);
  assert.ok(cover[cell] >= PLANT_CONSTANTS.founderCover, `berry cover ${cover[cell]} after seeding`);
});

test('every kind persists for twenty years, and nothing grows without bound', () => {
  const sim = makeSim(2, 192);
  const start = census(sim);
  days(sim, 20 * sim.config.time.daysPerYear);
  const end = census(sim);
  for (const spec of GROUP_KINDS) {
    const a = end.animals[spec.kind];
    assert.ok(a > 0, `${spec.name} died out`);
    assert.ok(a < 4 * start.animals[spec.kind] + 10, `${spec.name} grew from ${start.animals[spec.kind]} to ${a}`);
  }
  assert.ok(end.hares > 0.2 * start.hares && end.hares < 4 * start.hares, `hares ${start.hares.toFixed(0)} → ${end.hares.toFixed(0)}`);
  for (const s of PLANT_SPECIES) {
    const cover = sim.state.world.layer<Float32Array>(coverLayer(s));
    let total = 0;
    for (let k = 0; k < cover.length; k++) total += cover[k];
    assert.ok(total > 0, `${s.name} died out`);
  }
});
