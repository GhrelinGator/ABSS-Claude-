// Fire (docs/DESIGN.md §2.9, §2.16): wind, litter, fuel moisture, spread and its shape,
// firebreaks, rain and green fuel stopping fire, lightning holdovers, burning objects, sparks
// and friction, light and heat, animals keeping away, and snapshots mid-fire.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import { STREAM_WORDS, StreamDomain, seedStream } from '../../src/sim/core/rng.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, spawnEntity, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { ANIMAL_STORE, AnimalKind, CARCASS_LAYER, CARCASS_LOAD_LAYER } from '../../src/sim/world/animals.ts';
import { CLIMATE_FIELDS, CLIMATE_PARTS, MOISTURE_LAYER, StrikeState, climate, windAt } from '../../src/sim/world/climate.ts';
import {
  FIRE_FIELDS,
  FIRE_LAYERS,
  FIRE_PARTS,
  FIRE_STORE,
  FireStage,
  avoidDistanceM,
  createFireProbe,
  equilibriumMoisture,
  fire,
  fireConditions,
  fireLight,
  lengthToBreadth,
  moistureFactor,
  openSpreadKmh,
  rubWood,
  shareOfHead,
  slopeFactor,
  sparksAt,
} from '../../src/sim/world/fire.ts';
import { seasonFraction } from '../../src/sim/world/light.ts';
import { MATERIAL_LAYERS, Material, OBJECT_STORE, materials, spawnObject, strikeObjects } from '../../src/sim/world/materials.ts';
import { animals } from '../../src/sim/world/animals.ts';
import { pathogens } from '../../src/sim/world/pathogens.ts';
import { PLANT_SPECIES, coverLayer, foodLayer, plants } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water, terrain } from '../../src/sim/world/terrain.ts';

const TPD = 144;

function makeSim(seed: number, cells: number, circumscription = 0.5, pipeline = SIM_PIPELINE): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = circumscription;
  return createSim(validateConfig(raw), pipeline);
}
function stream(id: number): Uint32Array {
  const s = new Uint32Array(STREAM_WORDS);
  seedStream(s, 0, 77, StreamDomain.FIXTURE, id);
  return s;
}
const f32 = (sim: Sim, name: string) => sim.state.world.layer<Float32Array>(name);
const u8 = (sim: Sim, name: string) => sim.state.world.layer<Uint8Array>(name);
const weather = (sim: Sim) => (sim.state.parts.find((p) => p.name === CLIMATE_PARTS.weather) as { values: Float64Array }).values;
const fireCounts = (sim: Sim) => (sim.state.parts.find((p) => p.name === FIRE_PARTS.counts) as { values: Float64Array }).values;

/**
 * Step to `hour` o'clock on a day at least one day ahead, then fix the day's weather: no rain,
 * no storm, the given wind (m/s toward east and south), and every land cell's soil moisture.
 * Nothing changes them again until midnight.
 */
function setWeather(sim: Sim, opts: { hour: number; soil: number; east: number; south: number; rainMm?: number; dayOfYear?: number }): void {
  let day = Math.floor(sim.state.tick / TPD) + 1;
  if (opts.dayOfYear !== undefined) while (day % sim.config.time.daysPerYear !== opts.dayOfYear) day++;
  stepSim(sim, day * TPD + opts.hour * 6 - sim.state.tick);
  const v = weather(sim);
  const rain = opts.rainMm ?? 0;
  v[CLIMATE_FIELDS.wetToday] = rain > 0 ? 1 : 0;
  v[CLIMATE_FIELDS.rainTodayMm] = rain;
  v[CLIMATE_FIELDS.stormStart] = -1;
  v[CLIMATE_FIELDS.stormEnd] = -1;
  v[CLIMATE_FIELDS.stormRainMm] = 0;
  v[CLIMATE_FIELDS.windEastMs] = opts.east;
  v[CLIMATE_FIELDS.windSouthMs] = opts.south;
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const soil = f32(sim, MOISTURE_LAYER);
  for (let k = 0; k < soil.length; k++) if (water[k] === Water.DRY) soil[k] = opts.soil;
}

/** Light cell k the way an ignition from outside the fire system does (test fixture only). */
function light(sim: Sim, k: number): void {
  const store = sim.state.store(FIRE_STORE);
  const slot = spawnEntity(sim.state, store);
  store.column<Int32Array>('cell').data[slot] = k;
  store.column<Uint8Array>('fresh').data[slot] = 1;
  u8(sim, FIRE_LAYERS.stage)[k] = FireStage.FLAMING;
}

/**
 * A square of dry land of the given half-width (cells) around the map centre, stripped of trees,
 * under uniform litter. With `reshape` false the landscape itself is left alone (systems cache it,
 * so a snapshot test must not change it).
 */
function flatFuelBed(sim: Sim, half: number, litterKg: number, reshape = true): number {
  const W = sim.config.world.widthCells;
  const c = (W >> 1) * W + (W >> 1);
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const elevation = f32(sim, TERRAIN_LAYERS.elevation);
  const litter = f32(sim, MATERIAL_LAYERS.litter);
  const rainfall = f32(sim, TERRAIN_LAYERS.rainfall);
  const nut = f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'nut')!));
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      const k = c + j * W + i;
      if (reshape) {
        water[k] = Water.DRY;
        elevation[k] = 300;
        rainfall[k] = 1;
      }
      litter[k] = litterKg;
      nut[k] = 0;
    }
  }
  return c;
}

test('pure physics: fuel moisture, damping, spread rate, shape, slope, light, and keeping away', () => {
  // Equilibrium moisture (Simard 1968): a hot dry afternoon is dry, a cool damp night is near extinction.
  const hotDry = equilibriumMoisture(30, 0.25);
  assert.ok(hotDry > 0.03 && hotDry < 0.08, `hot dry afternoon ${hotDry}`);
  assert.ok(equilibriumMoisture(8, 0.97) > 0.2);
  assert.ok(equilibriumMoisture(20, 0.4) < equilibriumMoisture(20, 0.7));
  // Damping falls from about 1 to 0 at the moisture of extinction.
  assert.ok(moistureFactor(0.02) > moistureFactor(0.1) && moistureFactor(0.1) > moistureFactor(0.2));
  assert.equal(moistureFactor(0.24), 0);
  assert.equal(moistureFactor(0.4), 0);
  // Grassland at a 20 km/h wind and 10% moisture: a few km/h (Cheney et al. 1998).
  const grass = openSpreadKmh(20) * moistureFactor(0.1);
  assert.ok(grass > 2 && grass < 5, `grass head fire ${grass} km/h`);
  assert.ok(openSpreadKmh(0) < 0.1);
  assert.ok(Math.abs(openSpreadKmh(4.999) - openSpreadKmh(5)) < 0.01, 'the two wind relations meet');
  // Shape: longer than wide in wind; the flanks and back spread slowly.
  const lb = lengthToBreadth(20);
  assert.ok(lb > 2 && lb < 3.2, `length-to-breadth at 20 km/h ${lb}`);
  assert.equal(lengthToBreadth(0), 1);
  assert.ok(Math.abs(shareOfHead(1, lb) - 1) < 1e-12);
  assert.ok(shareOfHead(0, lb) < 0.2 && shareOfHead(-1, lb) < 0.06);
  // Slope: doubles about every 10 degrees up, halves down.
  const tan10 = 0.1763;
  assert.ok(Math.abs(slopeFactor(tan10) - 2) < 0.02 && Math.abs(slopeFactor(-tan10) - 0.5) < 0.01);
  // Light like the full moon at 8 m from 20 kW; animals keep 25 m from it.
  assert.ok(Math.abs(fireLight(20, 8) - 0.06) < 1e-12);
  assert.ok(fireLight(20, 40) < 0.003);
  assert.equal(avoidDistanceM(20), 25);
  assert.ok(avoidDistanceM(100_000) > 150);
});

test('wind: a westerly on average, windier in the afternoon, doubled under a storm', () => {
  const sim = makeSim(4, 48, 0.5, [terrain, climate]);
  const out = new Float64Array(2);
  let east = 0;
  let speed = 0;
  let afternoon = 0;
  let night = 0;
  const days = 2 * sim.config.time.daysPerYear;
  for (let d = 0; d < days; d++) {
    stepSim(sim, 3 * 6);
    windAt(sim.config, sim.state.tick, weather(sim), out);
    night += Math.hypot(out[0], out[1]);
    stepSim(sim, 11 * 6);
    windAt(sim.config, sim.state.tick, weather(sim), out);
    afternoon += Math.hypot(out[0], out[1]);
    east += weather(sim)[CLIMATE_FIELDS.windEastMs];
    speed += Math.hypot(weather(sim)[CLIMATE_FIELDS.windEastMs], weather(sim)[CLIMATE_FIELDS.windSouthMs]);
    stepSim(sim, TPD - 14 * 6);
  }
  assert.ok(east / days > 0.8, `mean wind toward the east ${east / days}`);
  assert.ok(speed / days > 2 && speed / days < 6, `mean daily wind ${speed / days} m/s`);
  assert.ok(afternoon > 1.8 * night, 'afternoons windier than nights');
  const v = weather(sim);
  v[CLIMATE_FIELDS.stormStart] = sim.state.tick;
  v[CLIMATE_FIELDS.stormEnd] = sim.state.tick + 6;
  windAt(sim.config, sim.state.tick, v, out);
  const stormy = Math.hypot(out[0], out[1]);
  v[CLIMATE_FIELDS.stormEnd] = -1;
  windAt(sim.config, sim.state.tick, v, out);
  assert.ok(Math.abs(stormy - 2 * Math.hypot(out[0], out[1])) < 1e-9);
});

test('litter: thick under dense plants, little on sparse ground, none on water, and it falls in the dying-back season', () => {
  const sim = makeSim(2, 96);
  const litter = f32(sim, MATERIAL_LAYERS.litter);
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const covers = PLANT_SPECIES.map((s) => f32(sim, coverLayer(s)));
  let dense = 0;
  let denseN = 0;
  let sparse = 0;
  let sparseN = 0;
  for (let k = 0; k < litter.length; k++) {
    if (water[k] !== Water.DRY) {
      assert.equal(litter[k], 0);
      continue;
    }
    let total = 0;
    for (const c of covers) total += c[k];
    if (total >= 0.8) {
      dense += litter[k];
      denseN++;
    } else if (total < 0.2) {
      sparse += litter[k];
      sparseN++;
    }
  }
  assert.ok(denseN > 100 && sparseN > 100);
  assert.ok(dense / denseN > 10 * (sparse / sparseN), 'dense plants drop far more than sparse ground');
  // Cured grassland and forest floors: a few tonnes per hectare.
  assert.ok(dense / denseN > 1500 && dense / denseN < 15000, `litter under dense plants ${dense / denseN} kg/ha`);
  // Litter on land rises through the dying-back season.
  const sum = () => litter.reduce((a, b) => a + b, 0);
  const year = sim.config.time.daysPerYear;
  stepSim(sim, Math.round(0.45 * year) * TPD);
  const before = sum();
  stepSim(sim, Math.round(0.25 * year) * TPD);
  assert.ok(sum() > 1.1 * before, `litter ${before} before the season, ${sum()} after`);
});

test('a fire on dry, cured fuel runs downwind, stops at a river, and burns the litter', () => {
  const sim = makeSim(5, 64);
  const W = sim.config.world.widthCells;
  setWeather(sim, { hour: 11, soil: 0.15, east: 5, south: 0 });
  const centre = flatFuelBed(sim, 14, 4000);
  // A river ten cells east of the fire, running north–south.
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  for (let j = -14; j <= 14; j++) water[centre + j * W + 10] = Water.RIVER;
  light(sim, centre);
  stepSim(sim, 12);
  const last = f32(sim, FIRE_LAYERS.lastBurnDay);
  let east = 0;
  let west = 0;
  let beyond = 0;
  for (let j = -14; j <= 14; j++) {
    for (let i = -14; i <= 14; i++) {
      if (last[centre + j * W + i] === 0) continue;
      if (i > 10) beyond++;
      else if (i > 0) east = Math.max(east, i);
      else if (i < 0) west = Math.max(west, -i);
    }
  }
  assert.ok(last[centre] > 0, 'the lit cell burned');
  assert.equal(east, 9, 'the head ran east up to the river within two hours');
  assert.ok(west < east, `backed only ${west} cells west`);
  assert.equal(beyond, 0, 'nothing burned beyond the river');
  assert.ok(f32(sim, MATERIAL_LAYERS.litter)[centre + 2] < 0.2 * 4000, 'litter burnt');
  assert.ok(fireCounts(sim)[FIRE_FIELDS.cellsIgnited] >= east);
});

test('green, moist fuel and rain keep fire from spreading', () => {
  // Midsummer, moist soil, dense plants: the fuel is too green.
  const green = makeSim(5, 64);
  setWeather(green, { hour: 14, soil: 0.9, east: 5, south: 0, dayOfYear: 14 });
  assert.ok(seasonFraction(green.config, green.state.tick) > 0.25);
  const cover = PLANT_SPECIES.map((s) => f32(green, coverLayer(s)));
  const conditions = fireConditions(green);
  const reading = { fine: 0, sticks: 0, poles: 0, fineTpha: 0, curing: 0, readiness: 0, headMPerMin: 0, backMPerMin: 0 };
  let checked = 0;
  const water = u8(green, TERRAIN_LAYERS.waterKind);
  for (let k = 0; k < water.length && checked < 50; k++) {
    if (water[k] !== Water.DRY) continue;
    let live = 0;
    for (const c of cover) live += c[k];
    if (live < 0.9) continue;
    conditions.read(k, reading);
    assert.equal(reading.headMPerMin, 0, `cell ${k}: curing ${reading.curing}`);
    checked++;
  }
  assert.ok(checked > 10);
  // A rainy day: fine fuel is soaked past extinction everywhere.
  const wet = makeSim(5, 64);
  setWeather(wet, { hour: 14, soil: 0.15, east: 5, south: 0, rainMm: 10 });
  const centre = flatFuelBed(wet, 6, 4000);
  const c2 = fireConditions(wet);
  c2.read(centre, reading);
  assert.ok(reading.fine >= 0.24 && reading.headMPerMin === 0);
  light(wet, centre);
  stepSim(wet, 12);
  assert.equal(fireCounts(wet)[FIRE_FIELDS.cellsIgnited], 0, 'nothing flamed');
});

test('lightning starts holdovers in dry wood, never on water, and they smoulder before going out', () => {
  let target: number[] = [];
  // ALIBI: test fixture, not part of any real run: puts strikes where the test wants them.
  const injector = defineSystem({
    name: 'test.strikes',
    create(sim) {
      const strikes = sim.state.parts.find((p) => p.name === CLIMATE_PARTS.strikes) as StrikeState;
      return () => {
        for (const k of target) strikes.push(k);
        target = [];
      };
    },
  });
  const sim = makeSim(6, 64, 0.5, [terrain, climate, injector, plants, animals, pathogens, materials, fire]);
  setWeather(sim, { hour: 16, soil: 0.5, east: 2, south: 0, dayOfYear: 14 });
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const small = f32(sim, MATERIAL_LAYERS.smallWood);
  const long = f32(sim, MATERIAL_LAYERS.longWood);
  const wooded: number[] = [];
  const wet: number[] = [];
  for (let k = 0; k < water.length; k++) {
    if (water[k] !== Water.DRY) {
      if (wet.length < 400) wet.push(k);
    } else if (wooded.length < 800) {
      small[k] = 3000;
      long[k] = 8000;
      wooded.push(k);
    }
  }
  assert.ok(wet.length > 50 && wooded.length === 800);
  target = [...wooded, ...wet];
  stepSim(sim, 1);
  const counts = fireCounts(sim);
  const stage = u8(sim, FIRE_LAYERS.stage);
  for (const k of wet) assert.equal(stage[k], FireStage.NONE);
  const started = counts[FIRE_FIELDS.lightningIgnitions];
  assert.ok(started >= 3 && started <= 60, `${started} of 800 strikes into dry wood started a fire`);
  assert.ok(counts[FIRE_FIELDS.holdovers] > 0, 'green summer fuel: they hold over, smouldering');
  const fires = sim.state.store(FIRE_STORE);
  stepSim(sim, 6);
  assert.ok(fires.count > 0, 'still smouldering an hour later');
  let burning = 0;
  const heat = fires.column<Float32Array>('heat').data;
  for (let s = 0; s < fires.highWater; s++) if (fires.alive.data[s] === 1 && heat[s] > 0) burning++;
  assert.ok(burning > 0);
  stepSim(sim, 6 * TPD);
  assert.ok(fires.count < started, 'most go out within days');
});

test('burning objects: a stick burns out, a pile burns faster, fire passes between sticks, rain puts it out', () => {
  const sim = makeSim(5, 64);
  setWeather(sim, { hour: 10, soil: 0.4, east: 1, south: 0 });
  const centre = flatFuelBed(sim, 3, 0);
  const cs = sim.config.world.cellSizeM;
  const W = sim.config.world.widthCells;
  const x = ((centre % W) + 0.5) * cs;
  const y = (Math.floor(centre / W) + 0.5) * cs;
  const objects = sim.state.store(OBJECT_STORE);
  const stick = (dx: number, thick: number, len: number) => spawnObject(sim, Material.WOOD, x + dx, y, 500 * Math.PI * 0.25 * thick * thick * len, len, 0.05);
  const lit = (slot: number) => {
    objects.column<Float32Array>('burnKw').data[slot] = 0.1;
    fireCounts(sim)[FIRE_FIELDS.burningObjects] += 1;
  };
  const twig = stick(0, 0.02, 1);
  const lone = stick(-30, 0.06, 2);
  const pile = [stick(20, 0.06, 2), stick(20.2, 0.06, 2), stick(20.4, 0.06, 2)];
  const unlit = stick(0.3, 0.015, 0.8);
  const far = stick(5, 0.015, 0.8);
  for (const s of [twig, lone, ...pile]) lit(s);
  const mass = objects.column<Float32Array>('mass').data;
  const m0 = mass[lone];
  stepSim(sim, 1);
  const m = objects.column<Float32Array>('mass').data;
  assert.ok(objects.isAlive(twig) && objects.column<Float32Array>('burnKw').data[twig] > 0.5, 'the twig is burning');
  assert.ok(m0 - m[pile[0]] > 2 * (m0 - m[lone]), 'a piece in a pile burns faster than one alone');
  stepSim(sim, 2);
  assert.ok(objects.column<Float32Array>('burnKw').data[unlit] > 0, 'a stick lying against a burning one caught');
  assert.equal(objects.column<Float32Array>('burnKw').data[far], 0, 'one 5 m away did not');
  stepSim(sim, 4);
  assert.ok(!objects.isAlive(twig), 'a 2 cm stick burns out within an hour or so');
  assert.ok(fireCounts(sim)[FIRE_FIELDS.objectsCaught] >= 1);
  // Rain on a day of 25 mm puts a burning stick out within a few ticks.
  const wet = stick(40, 0.03, 1);
  lit(wet);
  weather(sim)[CLIMATE_FIELDS.wetToday] = 1;
  weather(sim)[CLIMATE_FIELDS.rainTodayMm] = 25;
  stepSim(sim, 8);
  assert.ok(!objects.isAlive(wet) || objects.column<Float32Array>('burnKw').data[wet] === 0, 'rain put it out');
});

test('sparks from flint on iron sulfide can light dry litter; soaked litter never takes one', () => {
  const sim = makeSim(5, 64);
  setWeather(sim, { hour: 14, soil: 0.15, east: 2, south: 0 });
  const centre = flatFuelBed(sim, 2, 4000);
  const W = sim.config.world.widthCells;
  const cs = sim.config.world.cellSizeM;
  const x = ((centre % W) + 0.5) * cs;
  const y = (Math.floor(centre / W) + 0.5) * cs;
  const flint = spawnObject(sim, Material.FLINT, x, y, 0.5, 0.08, 0.1);
  const pyrite = spawnObject(sim, Material.PYRITE, x, y, 0.4, 0.06, 0.05);
  const s = stream(1);
  let sparks = 0;
  let caught = 0;
  let strikes = 0;
  // Strike until a caught spark has lit the litter of the cell (a caught spark lights the cell only sometimes).
  for (; strikes < 400 && u8(sim, FIRE_LAYERS.stage)[centre] !== FireStage.FLAMING; strikes++) {
    const out = strikeObjects(sim, flint, pyrite, 30, 0.8, s, 0);
    sparks += out.sparks;
    if (sparksAt(sim, x, y, out.sparks, out.sparkHeat, s, 0)) caught++;
  }
  assert.ok(sparks > strikes, `${sparks} sparks from ${strikes} strikes`);
  assert.ok(caught > 0 && strikes < 400, 'dry litter took a spark');
  assert.ok(fireCounts(sim)[FIRE_FIELDS.sparkIgnitions] === caught);
  // The fire system takes the lit cell up on its next run.
  stepSim(sim, 1);
  assert.ok(fireCounts(sim)[FIRE_FIELDS.cellsIgnited] >= 1);
  const wet = makeSim(5, 64);
  setWeather(wet, { hour: 14, soil: 0.15, east: 2, south: 0, rainMm: 20 });
  flatFuelBed(wet, 2, 4000);
  for (let n = 0; n < 200; n++) assert.equal(sparksAt(wet, x, y, 5, 0.9, s, 0), false);
});

test('rubbing dry wood hard enough makes an ember; weak rubbing or soaked wood does not', () => {
  const sim = makeSim(5, 64);
  setWeather(sim, { hour: 14, soil: 0.15, east: 2, south: 0 });
  const centre = flatFuelBed(sim, 2, 4000);
  const W = sim.config.world.widthCells;
  const cs = sim.config.world.cellSizeM;
  const x = ((centre % W) + 0.5) * cs;
  const y = (Math.floor(centre / W) + 0.5) * cs;
  const drill = spawnObject(sim, Material.WOOD, x, y, 0.15, 0.6, 0.05);
  const board = spawnObject(sim, Material.WOOD, x, y, 0.6, 0.5, 0.05);
  const s = stream(2);
  const weak = rubWood(sim, drill, board, 800, 0.9, s, 0);
  assert.equal(weak.ember, false);
  assert.ok(weak.dustKg > 0);
  let embers = 0;
  for (let n = 0; n < 20; n++) if (rubWood(sim, drill, board, 6000, 0.9, s, 0).ember) embers++;
  assert.equal(embers, 20);
  assert.equal(fireCounts(sim)[FIRE_FIELDS.embers], 20);
  const wet = makeSim(5, 64);
  setWeather(wet, { hour: 14, soil: 0.9, east: 2, south: 0, rainMm: 20 });
  const a = spawnObject(wet, Material.WOOD, x, y, 0.15, 0.6, 0.05);
  const b = spawnObject(wet, Material.WOOD, x, y, 0.6, 0.5, 0.05);
  assert.equal(rubWood(wet, a, b, 20000, 1, s, 0).ember, false, 'soaked wood');
  const stone = spawnObject(wet, Material.FLINT, x, y, 0.5, 0.1, 0.1);
  assert.equal(rubWood(wet, a, stone, 20000, 1, s, 0).ember, false, 'only wood on wood');
});

test('fire light and heat fall with distance; none without fire', () => {
  const sim = makeSim(5, 64);
  const probe = createFireProbe(sim);
  const out = new Float64Array(2);
  probe.at(3000, 3000, out);
  assert.equal(out[0], 0);
  assert.equal(out[1], 0);
  const slot = spawnObject(sim, Material.WOOD, 3000, 3000, 2, 1, 0.05);
  sim.state.store(OBJECT_STORE).column<Float32Array>('burnKw').data[slot] = 20;
  fireCounts(sim)[FIRE_FIELDS.burningObjects] = 1;
  probe.at(3008, 3000, out);
  assert.ok(Math.abs(out[0] - 0.06) < 1e-9, `light at 8 m ${out[0]}`);
  assert.ok(out[1] > 5 && out[1] < 10, `radiant heat at 8 m ${out[1]} W/m²`);
  probe.at(3001, 3000, out);
  assert.ok(out[1] > 300, `radiant heat at 1 m ${out[1]} W/m²`);
  probe.at(3040, 3000, out);
  assert.ok(out[0] < 0.003);
  probe.at(3500, 3000, out);
  assert.equal(out[0], 0, 'a small fire is not seen half a kilometre off');
});

test('predators keep away from a small fire; grazers ignore it but run from a burning cell', () => {
  const sim = makeSim(2, 128);
  setWeather(sim, { hour: 12, soil: 0.5, east: 1, south: 0 });
  const store = sim.state.store(ANIMAL_STORE);
  const kind = store.column<Uint8Array>('kind').data;
  const x = store.column<Float64Array>('x').data;
  const y = store.column<Float64Array>('y').data;
  let wolf = -1;
  let deer = -1;
  for (let s = 0; s < store.highWater && wolf < 0; s++) if (store.isAlive(s) && kind[s] === AnimalKind.WOLF) wolf = s;
  // A deer group far from every wolf, so nothing else makes it run.
  for (let s = 0; s < store.highWater && deer < 0; s++) {
    if (!store.isAlive(s) || kind[s] !== AnimalKind.DEER) continue;
    let near = false;
    for (let t = 0; t < store.highWater; t++) {
      if (store.isAlive(t) && kind[t] === AnimalKind.WOLF && Math.hypot(x[t] - x[s], y[t] - y[s]) < 3000) near = true;
    }
    if (!near) deer = s;
  }
  assert.ok(wolf >= 0 && deer >= 0);
  const fireAt = (slot: number) => {
    const o = spawnObject(sim, Material.WOOD, x[slot] + 10, y[slot], 5, 1, 0.05);
    sim.state.store(OBJECT_STORE).column<Float32Array>('burnKw').data[o] = 20;
    fireCounts(sim)[FIRE_FIELDS.burningObjects] += 1;
    return [x[slot] + 10, y[slot]];
  };
  const [wx, wy] = fireAt(wolf);
  fireAt(deer);
  stepSim(sim, 1);
  const xs = store.column<Float64Array>('x').data;
  const ys = store.column<Float64Array>('y').data;
  assert.ok(Math.hypot(xs[wolf] - wx, ys[wolf] - wy) > avoidDistanceM(20), 'the wolves moved away');
  assert.notEqual(store.column<Uint8Array>('mode').data[deer], 2, 'the deer did not run from a small fire');
  // A burning cell under the deer: it runs.
  const cs = sim.config.world.cellSizeM;
  const W = sim.config.world.widthCells;
  const k = Math.floor(ys[deer] / cs) * W + Math.floor(xs[deer] / cs);
  const fires = sim.state.store(FIRE_STORE);
  const slot = spawnEntity(sim.state, fires);
  fires.column<Int32Array>('cell').data[slot] = k;
  fires.column<Float32Array>('heat').data[slot] = 50_000;
  fires.column<Float32Array>('flameLeft').data[slot] = 60;
  u8(sim, FIRE_LAYERS.stage)[k] = FireStage.FLAMING;
  stepSim(sim, 1);
  const cx = ((k % W) + 0.5) * cs;
  const cy = (Math.floor(k / W) + 0.5) * cs;
  const gap = Math.hypot(store.column<Float64Array>('x').data[deer] - cx, store.column<Float64Array>('y').data[deer] - cy) - cs / 2;
  assert.ok(gap >= avoidDistanceM(50_000), `the deer ran clear of the burning cell (${gap.toFixed(0)} m)`);
});

test('a flaming cell burns seeds, fruit and forage, spares roots, and cooks carcass meat', () => {
  const sim = makeSim(5, 64);
  setWeather(sim, { hour: 12, soil: 0.15, east: 3, south: 0 });
  const centre = flatFuelBed(sim, 2, 5000);
  const grass = PLANT_SPECIES.findIndex((s) => s.name === 'grass');
  const tuber = PLANT_SPECIES.findIndex((s) => s.name === 'tuber');
  const grassFood = f32(sim, foodLayer(PLANT_SPECIES[grass]));
  const tuberFood = f32(sim, foodLayer(PLANT_SPECIES[tuber]));
  grassFood[centre] = 40;
  tuberFood[centre] = 300;
  f32(sim, CARCASS_LAYER)[centre] = 50;
  f32(sim, CARCASS_LOAD_LAYER)[centre] = 0.8;
  const forage = f32(sim, 'plants.forage');
  forage[centre] = 500;
  light(sim, centre);
  stepSim(sim, 3);
  assert.ok(grassFood[centre] < 10, `grass seeds left ${grassFood[centre]}`);
  assert.equal(tuberFood[centre], 300);
  assert.ok(forage[centre] < 100);
  assert.ok(f32(sim, CARCASS_LOAD_LAYER)[centre] < 0.5, 'heat killed microbes in the meat');
});

test('a snapshot taken mid-fire resumes identically', () => {
  const sim = makeSim(5, 64);
  setWeather(sim, { hour: 11, soil: 0.15, east: 4, south: 1 });
  const centre = flatFuelBed(sim, 10, 4000, false);
  light(sim, centre);
  stepSim(sim, 6);
  assert.ok(sim.state.store(FIRE_STORE).count > 1);
  const copy = loadSim(saveSim(sim), SIM_PIPELINE);
  assert.equal(hashSim(copy), hashSim(sim));
  stepSim(sim, 30);
  stepSim(copy, 30);
  assert.equal(hashSim(copy), hashSim(sim));
});
