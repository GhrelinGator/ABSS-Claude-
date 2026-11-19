// Breaks in the fuel (docs/DESIGN.md §2.10 steps 11–12, §2.11, §2.16; milestone 1.12): the water
// table, water drawn up from it into the soil, bare ground, and fire meeting patchy fuel.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, spawnEntity, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { CLIMATE_FIELDS, CLIMATE_PARTS, MOISTURE_LAYER, WeatherState } from '../../src/sim/world/climate.ts';
import { FIRE_LAYERS, FIRE_STORE, FireStage, flameLengthM, patchFactor } from '../../src/sim/world/fire.ts';
import { MATERIAL_LAYERS } from '../../src/sim/world/materials.ts';
import { PLANT_SPECIES, coverLayer } from '../../src/sim/world/plants.ts';
import { Soil, TERRAIN_CONSTANTS, TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

const TPD = 144;

function makeSim(seed: number, cells: number, circumscription = 0): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = circumscription;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}
const f32 = (sim: Sim, name: string) => sim.state.world.layer<Float32Array>(name);
const u8 = (sim: Sim, name: string) => sim.state.world.layer<Uint8Array>(name);
const weather = (sim: Sim) => (sim.state.parts.find((p) => p.name === CLIMATE_PARTS.weather) as WeatherState).values;

test('flames bridge gaps in patchy fuel: unbroken fuel always carries, sparse fuel only an intense fire', () => {
  // Byram's flame length: about 1.9 m at 1,000 kW/m, none without a fire.
  assert.ok(Math.abs(flameLengthM(1000) - 1.86) < 0.02, `flame ${flameLengthM(1000)}`);
  assert.equal(flameLengthM(0), 0);
  assert.equal(patchFactor(1, 0), 1);
  assert.equal(patchFactor(0, 5), 0);
  // Below the percolation threshold, patches that don't touch don't carry a fire that can't reach across.
  assert.equal(patchFactor(0.5, 0), 0);
  assert.ok(patchFactor(0.5, 1) > 0, 'flames a metre long bridge the gaps');
  // More fuel, or a longer reach, never makes it harder.
  let last = -1;
  for (let c = 0; c <= 1.0001; c += 0.05) {
    const f = patchFactor(Math.min(c, 1), 0.3);
    assert.ok(f >= last && f >= 0 && f <= 1);
    last = f;
  }
  assert.ok(patchFactor(0.3, 2) > patchFactor(0.3, 0.5));
  // Loam (3% bare) barely slows even a calm fire.
  assert.ok(patchFactor(0.97, 0) > 0.9);
});

test('the water table meets the ground at water and small streams and lies deeper above them', () => {
  const sim = makeSim(3, 128);
  const kind = u8(sim, TERRAIN_LAYERS.waterKind);
  const flow = f32(sim, TERRAIN_LAYERS.flow);
  const drain = sim.state.world.layer<Int32Array>(TERRAIN_LAYERS.drain);
  const elevation = f32(sim, TERRAIN_LAYERS.elevation);
  const table = f32(sim, TERRAIN_LAYERS.tableDepth);
  let shallow = 0;
  let land = 0;
  for (let k = 0; k < table.length; k++) {
    assert.ok(table[k] >= 0 && table[k] <= TERRAIN_CONSTANTS.tableMostM);
    if (kind[k] !== Water.DRY || flow[k] >= TERRAIN_CONSTANTS.streamMinFlowKm2) {
      assert.equal(table[k], 0);
      continue;
    }
    land++;
    if (table[k] < 1) shallow++;
    // Along a flow path the table is level, so the depth changes exactly as the ground does.
    const down = drain[k];
    if (down >= 0 && kind[down] === Water.DRY && flow[down] < TERRAIN_CONSTANTS.streamMinFlowKm2 && table[k] > 0 && table[down] > 0 && table[k] < TERRAIN_CONSTANTS.tableMostM && table[down] < TERRAIN_CONSTANTS.tableMostM) {
      assert.ok(Math.abs(table[k] - table[down] - (elevation[k] - elevation[down])) < 1e-3);
    }
  }
  assert.ok(shallow > 0.03 * land && shallow < 0.6 * land, `water table within 1 m under ${shallow} of ${land} land cells`);
});

test('bare ground follows the soil: rock is mostly bare, loam hardly at all, water none', () => {
  const sim = makeSim(4, 128, 1);
  const kind = u8(sim, TERRAIN_LAYERS.waterKind);
  const soil = u8(sim, TERRAIN_LAYERS.soil);
  const bare = f32(sim, TERRAIN_LAYERS.bareGround);
  const sum = [0, 0, 0, 0, 0];
  const n = [0, 0, 0, 0, 0];
  for (let k = 0; k < bare.length; k++) {
    assert.ok(bare[k] >= 0 && bare[k] <= 1);
    if (kind[k] !== Water.DRY) {
      assert.equal(bare[k], 0);
      continue;
    }
    sum[soil[k]] += bare[k];
    n[soil[k]]++;
  }
  assert.ok(n[Soil.ROCK] > 0 && n[Soil.LOAM] > 0, 'a walled map has rock and loam');
  const mean = (s: number) => sum[s] / n[s];
  assert.ok(mean(Soil.ROCK) > 0.5 && mean(Soil.LOAM) < 0.05 && mean(Soil.THIN) > mean(Soil.LOAM));
});

test('in a drought, ground over a shallow water table stays moist while ground far above it dries', () => {
  const sim = makeSim(3, 96);
  const table = f32(sim, TERRAIN_LAYERS.tableDepth);
  const kind = u8(sim, TERRAIN_LAYERS.waterKind);
  const soil = u8(sim, TERRAIN_LAYERS.soil);
  const moisture = f32(sim, MOISTURE_LAYER);
  // A deep drought in summer: wet days drop almost nothing.
  const v = weather(sim);
  for (let day = 0; day < 30; day++) {
    v[CLIMATE_FIELDS.wetness] = -20;
    stepSim(sim, TPD);
  }
  let near = 0;
  let nNear = 0;
  let far = 0;
  let nFar = 0;
  for (let k = 0; k < table.length; k++) {
    if (kind[k] !== Water.DRY || soil[k] !== Soil.LOAM) continue;
    if (table[k] < 0.3) {
      near += moisture[k];
      nNear++;
    } else if (table[k] > 5) {
      far += moisture[k];
      nFar++;
    }
  }
  assert.ok(nNear > 0 && nFar > 0);
  assert.ok(near / nNear > 0.6, `shallow-table ground ${near / nNear}`);
  assert.ok(far / nFar < near / nNear - 0.25, `deep-table ground ${far / nFar}`);
});

/**
 * Fix the day's weather at `hour` o'clock on a later day: no rain, no storm, the given wind (m/s
 * toward the east), every land cell's soil moisture.
 */
function setWeather(sim: Sim, hour: number, soilMoisture: number, east: number): void {
  const day = Math.floor(sim.state.tick / TPD) + 1;
  stepSim(sim, day * TPD + hour * 6 - sim.state.tick);
  const v = weather(sim);
  v[CLIMATE_FIELDS.wetToday] = 0;
  v[CLIMATE_FIELDS.rainTodayMm] = 0;
  v[CLIMATE_FIELDS.stormStart] = -1;
  v[CLIMATE_FIELDS.stormEnd] = -1;
  v[CLIMATE_FIELDS.stormRainMm] = 0;
  v[CLIMATE_FIELDS.windEastMs] = east;
  v[CLIMATE_FIELDS.windSouthMs] = 0;
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const m = f32(sim, MOISTURE_LAYER);
  for (let k = 0; k < m.length; k++) if (water[k] === Water.DRY) m[k] = soilMoisture;
}

/**
 * A flat square of cured litter round the map centre with no trees and no bare ground, except two
 * rocky bands two cells wide running north–south, at columns `west` and `east` from the centre
 * (bare share `rocky`, holding litter only on the share that isn't bare). Lights the centre.
 */
function rockyBed(sim: Sim, west: number, east: number, rocky: number): number {
  const W = sim.config.world.widthCells;
  const c = (W >> 1) * W + (W >> 1);
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const elevation = f32(sim, TERRAIN_LAYERS.elevation);
  const litter = f32(sim, MATERIAL_LAYERS.litter);
  const rainfall = f32(sim, TERRAIN_LAYERS.rainfall);
  const bare = f32(sim, TERRAIN_LAYERS.bareGround);
  const nut = f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'nut')!));
  const half = 14;
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      const k = c + j * W + i;
      water[k] = Water.DRY;
      elevation[k] = 300;
      rainfall[k] = 1;
      nut[k] = 0;
      const band = i === west || i === west - 1 || i === east || i === east + 1;
      bare[k] = band ? rocky : 0;
      litter[k] = 4000 * (1 - bare[k]);
    }
  }
  const store = sim.state.store(FIRE_STORE);
  const slot = spawnEntity(sim.state, store);
  store.column<Int32Array>('cell').data[slot] = c;
  store.column<Uint8Array>('fresh').data[slot] = 1;
  u8(sim, FIRE_LAYERS.stage)[c] = FireStage.FLAMING;
  return c;
}

/** Furthest columns burned east and west of the centre, within the bed's middle rows. */
function reach(sim: Sim, c: number): { east: number; west: number } {
  const W = sim.config.world.widthCells;
  const last = f32(sim, FIRE_LAYERS.lastBurnDay);
  let east = 0;
  let west = 0;
  for (let j = -6; j <= 6; j++) {
    for (let i = -14; i <= 14; i++) {
      if (last[c + j * W + i] === 0) continue;
      if (i > east) east = i;
      if (-i > west) west = -i;
    }
  }
  return { east, west };
}

test('a wind-driven head fire runs across rocky ground; the fire backing into the wind stops at it', () => {
  const run = (rocky: number) => {
    const sim = makeSim(5, 64);
    setWeather(sim, 10, 0.15, 5);
    const c = rockyBed(sim, -2, 5, rocky);
    stepSim(sim, 36);
    return reach(sim, c);
  };
  const open = run(0);
  const rock = run(0.6);
  assert.ok(open.west >= 4, `on unbroken fuel the back burned ${open.west} cells upwind`);
  assert.ok(rock.east > 6, `the head crossed the eastern band (reached ${rock.east})`);
  assert.ok(rock.west <= 3, `the back stopped at the western band (reached ${rock.west})`);
});
