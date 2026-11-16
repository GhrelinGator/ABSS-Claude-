// Plants (docs/DESIGN.md §2.12), checked against their own rules and against the
// calibration band. Small maps keep it quick.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { MOISTURE_LAYER, climate } from '../../src/sim/world/climate.ts';
import { seasonFraction } from '../../src/sim/world/light.ts';
import { PLANT_SPECIES, coverLayer, foodLayer, plants } from '../../src/sim/world/plants.ts';
import type { PlantSpecies } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water, terrain } from '../../src/sim/world/terrain.ts';

function configFor(seed: number, cells: number, variability = 1) {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.climate.variability = variability;
  return validateConfig(raw);
}

function makeSim(seed: number, cells = 96, pipeline: readonly SystemDef[] = SIM_PIPELINE): Sim {
  return createSim(configFor(seed, cells), pipeline);
}

const cover = (sim: Sim, species: PlantSpecies) => sim.state.world.layer<Float32Array>(coverLayer(species));
const food = (sim: Sim, species: PlantSpecies) => sim.state.world.layer<Float32Array>(foodLayer(species));
const byName = (name: string) => {
  const species = PLANT_SPECIES.find((s) => s.name === name);
  if (!species) throw new Error(`no species ${name}`);
  return species;
};

function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}

function stepDays(sim: Sim, days: number): void {
  stepSim(sim, days * sim.config.time.ticksPerDay);
}

test('the catalogue is well formed', () => {
  assert.equal(PLANT_SPECIES.length, 8);
  assert.equal(new Set(PLANT_SPECIES.map((s) => s.name)).size, 8);
  for (const s of PLANT_SPECIES) {
    for (const w of [s.rainfall, s.moisture]) {
      assert.ok(w.lo <= w.optLo && w.optLo <= w.optHi && w.optHi < w.hi, `${s.name}: window out of order`);
    }
    assert.ok(s.maxCover > 0 && s.maxCover <= 1, s.name);
    assert.ok(s.soilFit.every((f) => f >= 0 && f <= 1), s.name);
    assert.ok(s.kcalPerKg > 0 && s.rawDigestible > 0 && s.rawDigestible <= s.processedDigestible, s.name);
    if (s.food.kind === 'seasonal') {
      assert.ok(s.food.start >= 0 && s.food.start < s.food.end && s.food.end <= 1, `${s.name}: season`);
      assert.ok(s.food.lossPerDay > 0 && s.food.lossPerDay < 1, s.name);
    } else {
      assert.ok(s.food.refillPerRealYear > 0, s.name);
    }
  }
  // Exactly the two delayed-poison species from the design, one of them made safe by processing.
  const toxic = PLANT_SPECIES.filter((s) => s.toxin !== null);
  assert.deepEqual(toxic.map((s) => s.name).sort(), ['bitterRoot', 'nightshade']);
  assert.equal(byName('bitterRoot').toxin?.removedByProcessing, true);
  assert.equal(byName('nightshade').toxin?.removedByProcessing, false);
  // Some kinds are hidden underground and must be found some other way than by looking.
  assert.ok(PLANT_SPECIES.some((s) => !s.visible) && PLANT_SPECIES.some((s) => s.visible));
});

test('setup: cover fills land within limits, standing stocks start full, no fruit yet', () => {
  const sim = makeSim(7);
  const world = sim.state.world;
  const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const N = kind.length;
  const areaHa = (sim.config.world.cellSizeM * sim.config.world.cellSizeM) / 10_000;
  let covered = 0;
  for (let k = 0; k < N; k++) {
    let total = 0;
    for (const s of PLANT_SPECIES) {
      const c = cover(sim, s)[k];
      assert.ok(c >= 0, `${s.name} negative at ${k}`);
      if (kind[k] !== Water.DRY) assert.equal(c, 0, `${s.name} growing in open water at ${k}`);
      total += c;
      const f = food(sim, s)[k];
      if (s.food.kind === 'seasonal') assert.equal(f, 0);
      else assert.ok(Math.abs(f - s.food.stockKgHa * c * areaHa) <= 1e-3 * (1 + f), `${s.name} stock at ${k}`);
    }
    assert.ok(total <= 1 + 1e-6, `cell ${k} over-full: ${total}`);
    if (total > 0.05) covered++;
  }
  assert.ok(covered > 0.5 * N, `only ${covered} of ${N} cells have plants`);
  for (const s of PLANT_SPECIES) assert.ok(sum(cover(sim, s)) > 0, `${s.name} missing from the map`);
});

test('reeds grow only near open water; the other species do not need it', () => {
  const sim = makeSim(7);
  const { widthCells: W, heightCells: H } = sim.config.world;
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const nearWater = (k: number, rings: number) => {
    const i0 = k % W;
    const j0 = Math.floor(k / W);
    for (let j = Math.max(0, j0 - rings); j <= Math.min(H - 1, j0 + rings); j++) {
      for (let i = Math.max(0, i0 - rings); i <= Math.min(W - 1, i0 + rings); i++) {
        if (Math.abs(i - i0) + Math.abs(j - j0) <= rings && kind[j * W + i] !== Water.DRY) return true;
      }
    }
    return false;
  };
  stepDays(sim, 48);
  const reed = cover(sim, byName('reed'));
  let reedCells = 0;
  for (let k = 0; k < reed.length; k++) {
    if (reed[k] <= 0) continue;
    reedCells++;
    assert.ok(nearWater(k, 3), `reed far from water at cell ${k}`);
  }
  assert.ok(reedCells > 0, 'no reeds anywhere');
  const grass = cover(sim, byName('grass'));
  let farGrass = 0;
  for (let k = 0; k < grass.length; k++) if (grass[k] > 0 && !nearWater(k, 3)) farGrass++;
  assert.ok(farGrass > 100, 'grass should grow away from water too');
});

test('dry country is sparse and wet country is dense', () => {
  const sim = makeSim(7, 128);
  stepDays(sim, 48);
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const rainfall = sim.state.world.layer<Float32Array>(TERRAIN_LAYERS.rainfall);
  let dry = 0;
  let dryCells = 0;
  let wet = 0;
  let wetCells = 0;
  for (let k = 0; k < kind.length; k++) {
    if (kind[k] !== Water.DRY) continue;
    let total = 0;
    for (const s of PLANT_SPECIES) total += cover(sim, s)[k];
    if (rainfall[k] < 0.3) {
      dry += total;
      dryCells++;
    } else if (rainfall[k] >= 0.8) {
      wet += total;
      wetCells++;
    }
  }
  assert.ok(dryCells > 50 && wetCells > 50, `too few cells to compare (${dryCells} dry, ${wetCells} wet)`);
  const dryMean = dry / dryCells;
  const wetMean = wet / wetCells;
  assert.ok(dryMean < 0.4 * wetMean, `dry ${dryMean.toFixed(3)} vs wet ${wetMean.toFixed(3)}`);
});

test('fruit and seeds ripen only in their season; nuts keep long after theirs, berries do not', () => {
  const sim = makeSim(7);
  const seasonal = PLANT_SPECIES.filter((s) => s.food.kind === 'seasonal');
  let previous = seasonal.map((s) => sum(food(sim, s)));
  const peakDay = seasonal.map(() => -1);
  const peak = seasonal.map(() => 0);
  const days = sim.config.time.daysPerYear;
  for (let d = 0; d < days; d++) {
    // The plant update for day d runs at its first tick.
    const season = seasonFraction(sim.config, sim.state.tick);
    stepDays(sim, 1);
    seasonal.forEach((s, i) => {
      const f = s.food;
      if (f.kind !== 'seasonal') return;
      const now = sum(food(sim, s));
      const inSeason = season >= f.start && season < f.end;
      if (now > previous[i]) assert.ok(inSeason, `${s.name} gained food on day ${d}, out of season`);
      if (now > peak[i]) {
        peak[i] = now;
        peakDay[i] = d;
      }
      previous[i] = now;
    });
  }
  seasonal.forEach((s, i) => assert.ok(peak[i] > 0, `${s.name} never bore food`));
  // Ten days after the year turns, the autumn nuts are still lying about; the summer berries are long gone.
  stepDays(sim, 10);
  const nutsLeft = sum(food(sim, byName('nut'))) / peak[seasonal.indexOf(byName('nut'))];
  const berriesLeft = sum(food(sim, byName('berry'))) / peak[seasonal.indexOf(byName('berry'))];
  assert.ok(nutsLeft > 0.3, `nuts left ${nutsLeft.toFixed(3)}`);
  assert.ok(berriesLeft < 0.01, `berries left ${berriesLeft.toFixed(4)}`);
});

test('every species persists for fifty years and no cell is ever over-full', () => {
  const sim = makeSim(3, 64);
  const start = PLANT_SPECIES.map((s) => sum(cover(sim, s)));
  for (let year = 0; year < 50; year++) stepDays(sim, sim.config.time.daysPerYear);
  const N = cover(sim, PLANT_SPECIES[0]).length;
  for (let k = 0; k < N; k++) {
    let total = 0;
    for (const s of PLANT_SPECIES) total += cover(sim, s)[k];
    assert.ok(total <= 1 + 1e-5, `cell ${k} over-full: ${total}`);
  }
  PLANT_SPECIES.forEach((s, i) => {
    const now = sum(cover(sim, s));
    assert.ok(now > 0.5 * start[i], `${s.name} fell from ${start[i].toFixed(2)} to ${now.toFixed(2)}`);
  });
});

test('a drought kills back moisture-loving cover, which regrows when the rain returns', () => {
  // A stand-in that dries every patch of land for days 10 to 29, after the real climate has run.
  const DROUGHT_FROM = 10;
  const DROUGHT_TO = 30;
  const drought: SystemDef = defineSystem({
    name: 'fixture.drought',
    create(sim: Sim) {
      const moisture = sim.state.world.layer<Float32Array>(MOISTURE_LAYER);
      const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
      const perDay = sim.config.time.ticksPerDay;
      return () => {
        const tick = sim.state.tick;
        if (tick % perDay !== 0) return;
        const day = tick / perDay;
        if (day < DROUGHT_FROM || day >= DROUGHT_TO) return;
        for (let k = 0; k < moisture.length; k++) if (kind[k] === Water.DRY) moisture[k] = 0.02;
      };
    },
  });
  const sim = makeSim(7, 96, [terrain, climate, drought, plants]);
  const greens = byName('greens');
  const bitterRoot = byName('bitterRoot');
  stepDays(sim, DROUGHT_FROM);
  const before = sum(cover(sim, greens));
  const rootBefore = sum(cover(sim, bitterRoot));
  stepDays(sim, DROUGHT_TO - DROUGHT_FROM);
  const during = sum(cover(sim, greens));
  const rootDuring = sum(cover(sim, bitterRoot));
  assert.ok(during < 0.7 * before, `greens only fell from ${before.toFixed(1)} to ${during.toFixed(1)}`);
  // The dry-tolerant bitter root holds on.
  assert.ok(rootDuring > 0.95 * rootBefore, `bitter root fell from ${rootBefore.toFixed(1)} to ${rootDuring.toFixed(1)}`);
  stepDays(sim, 4 * sim.config.time.daysPerYear);
  const after = sum(cover(sim, greens));
  assert.ok(after > 0.85 * before, `greens only came back to ${after.toFixed(1)} of ${before.toFixed(1)}`);
});

test('a snapshot taken before the first plant update resumes identically', () => {
  // The habitat map is built on the first run, so this is the case most likely to go wrong.
  const straight = makeSim(5);
  stepDays(straight, 30);
  const first = makeSim(5);
  const resumed = loadSim(saveSim(first), SIM_PIPELINE);
  stepDays(resumed, 30);
  assert.equal(hashSim(resumed), hashSim(straight));
});

test('sanity band: the most plant food a square kilometre could give each day', () => {
  // Gather everything edible from every cell every day for a year, after a year untouched,
  // starting from empty so the one-time standing stock is not counted.
  for (const seed of [7, 3]) {
    const sim = makeSim(seed, 128);
    const days = sim.config.time.daysPerYear;
    stepDays(sim, days);
    const edible = PLANT_SPECIES.filter((s) => s.toxin === null || s.toxin.removedByProcessing);
    for (const s of PLANT_SPECIES) food(sim, s).fill(0);
    let kcal = 0;
    for (let d = 0; d < days; d++) {
      stepDays(sim, 1);
      for (const s of edible) {
        const f = food(sim, s);
        kcal += sum(f) * s.kcalPerKg;
        f.fill(0);
      }
    }
    const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    let land = 0;
    for (let k = 0; k < kind.length; k++) if (kind[k] === Water.DRY) land++;
    const km2 = (land * sim.config.world.cellSizeM * sim.config.world.cellSizeM) / 1e6;
    const perKm2Day = kcal / km2 / days;
    assert.ok(perKm2Day > 50_000 && perKm2Day < 1_000_000, `seed ${seed}: ${Math.round(perKm2Day)} kcal/km²/day`);
  }
});
