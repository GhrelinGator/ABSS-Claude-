// Plants: eight species growing, dying back, spreading, and bearing food.
// Design: docs/DESIGN.md §2.12. Plants are environment. They respond to
// soil, rain, warmth and each other, never to agents.

import { dayIndex } from '../core/clock.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import type { Sim, SimState } from '../sim.ts';
import { CLIMATE_CONSTANTS, CLIMATE_PARTS, MOISTURE_LAYER, dailyMeanTemperatureC } from './climate.ts';
import { seasonFraction } from './light.ts';
import { fieldKey, noise2 } from './noise.ts';
import { TERRAIN_LAYERS, Water } from './terrain.ts';

/** A range with a plateau: 0 below lo, rising to 1 at optLo, 1 until optHi, falling to 0 at hi. */
export interface Window4 {
  readonly lo: number;
  readonly optLo: number;
  readonly optHi: number;
  readonly hi: number;
}

export interface SeasonalFood {
  readonly kind: 'seasonal';
  /** Season fractions (0 spring equinox, 0.25 midsummer) between which the food ripens. */
  readonly start: number;
  readonly end: number;
  /** A real year's yield at full cover, kg per hectare; spread over the window per real day (§2.12). */
  readonly annualYieldKgHa: number;
  /** Share of the food on the plant that drops or rots each real day. */
  readonly lossPerDay: number;
}

export interface StandingFood {
  readonly kind: 'stock';
  /** Edible stock at full cover, kg per hectare. */
  readonly stockKgHa: number;
  /**
   * Share of the gap to a full stock refilled per real year (365 days). Storing food in a
   * root is daily physiology, so it is not compressed with the year (docs/DESIGN.md §2.12).
   */
  readonly refillPerRealYear: number;
}

export interface Toxin {
  /** Dose per kg eaten raw, in the units bodies will use (Phase 2). */
  readonly dosePerKg: number;
  /** Hours between eating and feeling it. */
  readonly delayHours: number;
  /** True if soaking or cooking removes it. */
  readonly removedByProcessing: boolean;
}

export interface PlantSpecies {
  readonly name: string;
  /** How well it grows on each soil: rock, thin, loam, alluvium, sand. */
  readonly soilFit: readonly [number, number, number, number, number];
  /** Fit to the long-term mean rainfall (terrain.rainfall). */
  readonly rainfall: Window4;
  /** Fit to today's soil moisture (water.soilMoisture). */
  readonly moisture: Window4;
  /** Grows only within this distance of open water, if set. */
  readonly nearWaterM: number | null;
  readonly maxElevationM: number;
  readonly maxCover: number;
  /** Logistic growth rate of cover, per (compressed) year. */
  readonly growthPerYear: number;
  /** Below this daily mean temperature it does not grow. */
  readonly minTemperatureC: number;
  /** Share of cover lost per day when soil moisture is far below its tolerance. */
  readonly diebackPerDay: number;
  /** Colonisation of unclaimed ground from neighbouring cells, per spreading step. */
  readonly spread: number;
  /** Size of its patches, in metres, and how sharply patches are bounded (0 to 1). */
  readonly patchM: number;
  readonly patchContrast: number;
  readonly food: SeasonalFood | StandingFood;
  readonly kcalPerKg: number;
  /** Real days for half of a gathered amount to spoil. */
  readonly storageHalfLifeDays: number;
  readonly visible: boolean;
  /** Share of its calories a body gets eating it raw, and after pounding, cracking, soaking or cooking. */
  readonly rawDigestible: number;
  readonly processedDigestible: number;
  readonly toxin: Toxin | null;
  /** Leaves and stems an animal can eat, standing at full cover, kg per hectare (§2.13). */
  readonly forageKgHa: number;
  /** Which forage it is: 'graze' (grass-like, eaten by grazers) or 'browse' (leaves and shoots). */
  readonly forageKind: 'graze' | 'browse';
  /** Woody plants survive being eaten bare; soft ones die back (overgrazing). */
  readonly woody: boolean;
}

// The catalogue. Order is part of what a seed means: never reorder, only append.
export const PLANT_SPECIES: readonly PlantSpecies[] = Object.freeze([
  {
    name: 'grass',
    soilFit: [0, 0.4, 1, 1, 0.3],
    rainfall: { lo: 0.35, optLo: 0.7, optHi: 1.4, hi: 2.2 },
    moisture: { lo: 0.15, optLo: 0.35, optHi: 0.85, hi: 1.01 },
    nearWaterM: null,
    maxElevationM: 1500,
    maxCover: 0.8,
    growthPerYear: 3,
    minTemperatureC: 6,
    diebackPerDay: 0.02,
    spread: 0.15,
    patchM: 3000,
    patchContrast: 0.6,
    food: { kind: 'seasonal', start: 0.2, end: 0.26, annualYieldKgHa: 500, lossPerDay: 0.35 },
    kcalPerKg: 3400,
    storageHalfLifeDays: 2000,
    visible: true,
    rawDigestible: 0.4,
    processedDigestible: 0.85,
    toxin: null,
    forageKgHa: 300,
    forageKind: 'graze',
    woody: false,
  },
  {
    name: 'tuber',
    soilFit: [0, 0.5, 1, 0.6, 0.9],
    rainfall: { lo: 0.2, optLo: 0.5, optHi: 1.2, hi: 1.9 },
    moisture: { lo: 0.05, optLo: 0.2, optHi: 0.7, hi: 1.01 },
    nearWaterM: null,
    maxElevationM: 1800,
    maxCover: 0.3,
    growthPerYear: 1.5,
    minTemperatureC: 4,
    diebackPerDay: 0.005,
    spread: 0.05,
    patchM: 2000,
    patchContrast: 0.8,
    food: { kind: 'stock', stockKgHa: 2500, refillPerRealYear: 1 },
    kcalPerKg: 1000,
    storageHalfLifeDays: 20,
    visible: false,
    rawDigestible: 0.6,
    processedDigestible: 0.9,
    toxin: null,
    forageKgHa: 40,
    forageKind: 'browse',
    woody: false,
  },
  {
    name: 'berry',
    soilFit: [0.1, 0.7, 1, 1, 0.4],
    rainfall: { lo: 0.4, optLo: 0.8, optHi: 1.6, hi: 2.4 },
    moisture: { lo: 0.2, optLo: 0.4, optHi: 0.9, hi: 1.01 },
    nearWaterM: null,
    maxElevationM: 1600,
    maxCover: 0.35,
    growthPerYear: 1,
    minTemperatureC: 6,
    diebackPerDay: 0.01,
    spread: 0.06,
    patchM: 1500,
    patchContrast: 0.9,
    food: { kind: 'seasonal', start: 0.3, end: 0.45, annualYieldKgHa: 400, lossPerDay: 0.15 },
    kcalPerKg: 600,
    storageHalfLifeDays: 4,
    visible: true,
    rawDigestible: 0.9,
    processedDigestible: 0.9,
    toxin: null,
    forageKgHa: 80,
    forageKind: 'browse',
    woody: true,
  },
  {
    name: 'nut',
    soilFit: [0, 1, 1, 0.5, 0.2],
    rainfall: { lo: 0.5, optLo: 0.8, optHi: 1.5, hi: 2.4 },
    moisture: { lo: 0.2, optLo: 0.35, optHi: 0.9, hi: 1.01 },
    nearWaterM: null,
    maxElevationM: 1400,
    maxCover: 0.6,
    growthPerYear: 0.25,
    minTemperatureC: 5,
    diebackPerDay: 0.003,
    spread: 0.02,
    patchM: 4000,
    patchContrast: 0.8,
    food: { kind: 'seasonal', start: 0.55, end: 0.62, annualYieldKgHa: 1200, lossPerDay: 0.01 },
    kcalPerKg: 3000,
    storageHalfLifeDays: 300,
    visible: true,
    rawDigestible: 0.5,
    processedDigestible: 0.95,
    toxin: null,
    forageKgHa: 120,
    forageKind: 'browse',
    woody: true,
  },
  {
    name: 'greens',
    soilFit: [0, 0.3, 1, 1, 0.2],
    rainfall: { lo: 0.5, optLo: 0.9, optHi: 2, hi: 3 },
    moisture: { lo: 0.3, optLo: 0.5, optHi: 1, hi: 1.01 },
    nearWaterM: null,
    maxElevationM: 1800,
    maxCover: 0.5,
    growthPerYear: 4,
    minTemperatureC: 5,
    diebackPerDay: 0.03,
    spread: 0.2,
    patchM: 1000,
    patchContrast: 0.5,
    food: { kind: 'seasonal', start: 0, end: 0.45, annualYieldKgHa: 2000, lossPerDay: 0.2 },
    kcalPerKg: 300,
    storageHalfLifeDays: 2,
    visible: true,
    rawDigestible: 0.7,
    processedDigestible: 0.8,
    toxin: null,
    forageKgHa: 200,
    forageKind: 'browse',
    woody: false,
  },
  {
    name: 'bitterRoot',
    soilFit: [0.1, 1, 0.6, 0.2, 1],
    rainfall: { lo: 0.1, optLo: 0.25, optHi: 0.8, hi: 1.4 },
    moisture: { lo: 0, optLo: 0.1, optHi: 0.6, hi: 0.95 },
    nearWaterM: null,
    maxElevationM: 2000,
    maxCover: 0.25,
    growthPerYear: 1,
    minTemperatureC: 4,
    diebackPerDay: 0.004,
    spread: 0.04,
    patchM: 2500,
    patchContrast: 0.8,
    food: { kind: 'stock', stockKgHa: 3000, refillPerRealYear: 0.8 },
    kcalPerKg: 1500,
    storageHalfLifeDays: 30,
    visible: false,
    rawDigestible: 0.8,
    processedDigestible: 0.85,
    toxin: { dosePerKg: 1, delayHours: 4, removedByProcessing: true },
    forageKgHa: 0,
    forageKind: 'browse',
    woody: false,
  },
  {
    name: 'nightshade',
    soilFit: [0, 0.4, 1, 0.8, 0.3],
    rainfall: { lo: 0.4, optLo: 0.8, optHi: 1.6, hi: 2.4 },
    moisture: { lo: 0.25, optLo: 0.45, optHi: 0.95, hi: 1.01 },
    nearWaterM: null,
    maxElevationM: 1500,
    maxCover: 0.15,
    growthPerYear: 2,
    minTemperatureC: 7,
    diebackPerDay: 0.02,
    spread: 0.12,
    patchM: 1200,
    patchContrast: 1,
    food: { kind: 'seasonal', start: 0.32, end: 0.47, annualYieldKgHa: 300, lossPerDay: 0.2 },
    kcalPerKg: 400,
    storageHalfLifeDays: 4,
    visible: true,
    rawDigestible: 0.9,
    processedDigestible: 0.9,
    toxin: { dosePerKg: 2, delayHours: 3, removedByProcessing: false },
    forageKgHa: 0,
    forageKind: 'browse',
    woody: false,
  },
  {
    name: 'reed',
    soilFit: [0, 0.3, 1, 1, 0.6],
    rainfall: { lo: 0, optLo: 0, optHi: 3, hi: 3.01 },
    moisture: { lo: 0.3, optLo: 0.5, optHi: 1, hi: 1.01 },
    nearWaterM: 200,
    maxElevationM: 2000,
    maxCover: 0.7,
    growthPerYear: 2,
    minTemperatureC: 5,
    diebackPerDay: 0.02,
    spread: 0.1,
    patchM: 800,
    patchContrast: 0.4,
    food: { kind: 'stock', stockKgHa: 1500, refillPerRealYear: 1.5 },
    kcalPerKg: 900,
    storageHalfLifeDays: 10,
    visible: false,
    rawDigestible: 0.6,
    processedDigestible: 0.8,
    toxin: null,
    forageKgHa: 250,
    forageKind: 'graze',
    woody: false,
  },
] satisfies PlantSpecies[]);

export function coverLayer(species: PlantSpecies): string {
  return `plants.${species.name}.cover`;
}

export function foodLayer(species: PlantSpecies): string {
  return `plants.${species.name}.food`;
}

/** Grass-like forage (grass, reed) grazers can eat, kg per cell (§2.13). Refills on real days. */
export const FORAGE_LAYER = 'plants.forage';
/** Leaves and shoots browsers can eat (greens, berry, nut, tuber leaves), kg per cell. Refills on real days. */
export const BROWSE_LAYER = 'plants.browse';
/** One bit per species (bit s for catalogue entry s): seeds that arrived since the cell last updated (§2.13). */
export const SEED_RAIN_LAYER = 'plants.seedRain';

export const PLANT_CONSTANTS = {
  /**
   * Each cell's cover and standing stocks update once every this many days, with that many
   * days of change; a different quarter of the cells each day, so the cost is even. Fixed at 4:
   * the quarters are a 2 × 2 pattern in which no two neighbouring cells share a quarter.
   */
  coverEveryDays: 4,
  /** Fruit or seed below this many kilograms in a cell counts as gone. */
  leastFoodKg: 0.001,
  /** Share of the gap to full forage refilled per real year (365 days). An estimate; see T-004. */
  forageRefillPerRealYear: 6,
  /** Share of its full forage no animal can eat: the base of the plant, which it regrows from. */
  ungrazableShare: 0.25,
  /** Below this share of its full forage, a patch counts as overgrazed and its soft plants die back. */
  overgrazedBelow: 0.3,
  /** Daily dieback of an overgrazed species with 300 kg/ha of forage (scaled by its own forage). */
  overgrazingDiebackPerDay: 0.01,
  /** Cover a species starts with where its seed arrives and its habitat allows it. */
  founderCover: 0.002,
  /** Starting cover as a share of each cell's capacity. */
  initialShare: 0.8,
  /** Warmth response rises from 0 to 1 over this many degrees above the species' minimum. */
  warmthRampC: 8,
} as const;

const P = PLANT_CONSTANTS;
const SALT_PATCHES = 100;

function trapezoid(x: number, w: Window4): number {
  if (x <= w.lo || x >= w.hi) return 0;
  if (x < w.optLo) return (x - w.lo) / (w.optLo - w.lo);
  if (x > w.optHi) return (w.hi - x) / (w.hi - w.optHi);
  return 1;
}

function inWindow(season: number, start: number, end: number): boolean {
  return season >= start && season < end;
}

/** Carrying capacity of every cell for every species: the habitat, fixed for the run (docs/DESIGN.md §2.12, step 1). */
function capacities(sim: Sim): Float32Array[] {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const N = W * H;
  const world = state.world;
  const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
  const rainfall = world.layer<Float32Array>(TERRAIN_LAYERS.rainfall);
  const soil = world.layer<Uint8Array>(TERRAIN_LAYERS.soil);
  const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);

  // Ground within reach of open water, one ring of cells at a time.
  let wet = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (kind[k] !== Water.DRY) wet[k] = 1;
  const reachByRings: Uint8Array[] = [wet];
  const maxRings = 3;
  for (let r = 0; r < maxRings; r++) {
    const grown = wet.slice();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (wet[j * W + i] !== 1) continue;
        if (i > 0) grown[j * W + i - 1] = 1;
        if (i < W - 1) grown[j * W + i + 1] = 1;
        if (j > 0) grown[(j - 1) * W + i] = 1;
        if (j < H - 1) grown[(j + 1) * W + i] = 1;
      }
    }
    wet = grown;
    reachByRings.push(wet);
  }

  return PLANT_SPECIES.map((species, index) => {
    const K = new Float32Array(N);
    const key = fieldKey(config.seed, SALT_PATCHES + index);
    const scale = cs / species.patchM;
    const contrast = species.patchContrast;
    const rings = species.nearWaterM === null ? -1 : Math.min(maxRings, Math.max(1, Math.round(species.nearWaterM / cs)));
    const near = rings < 0 ? null : reachByRings[rings];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (kind[k] !== Water.DRY) continue;
        if (near !== null && near[k] !== 1) continue;
        const soilFit = species.soilFit[soil[k]] ?? 0;
        const rainFit = trapezoid(rainfall[k], species.rainfall);
        const top = species.maxElevationM;
        const heightFit = elevation[k] >= top ? 0 : elevation[k] <= top - 300 ? 1 : (top - elevation[k]) / 300;
        const n = noise2(key, (i + 0.5) * scale, (j + 0.5) * scale);
        let patch = 1 - contrast + contrast * (2 * (0.5 + 0.5 * n) - 0.3);
        if (patch < 0) patch = 0;
        else if (patch > 1) patch = 1;
        K[k] = species.maxCover * soilFit * rainFit * heightFit * patch;
      }
    }
    return K;
  });
}

function startPlants(sim: Sim): void {
  const world = sim.state.world;
  const K = capacities(sim);
  const N = K[0].length;
  const areaHa = (sim.config.world.cellSizeM * sim.config.world.cellSizeM) / 10_000;
  const cover = PLANT_SPECIES.map((s) => world.layer<Float32Array>(coverLayer(s)));
  const food = PLANT_SPECIES.map((s) => world.layer<Float32Array>(foodLayer(s)));
  const forage = world.layer<Float32Array>(FORAGE_LAYER);
  const browse = world.layer<Float32Array>(BROWSE_LAYER);
  for (let k = 0; k < N; k++) {
    let total = 0;
    for (let s = 0; s < PLANT_SPECIES.length; s++) total += P.initialShare * K[s][k];
    const squeeze = total > 1 ? 1 / total : 1;
    for (let s = 0; s < PLANT_SPECIES.length; s++) {
      const c = P.initialShare * K[s][k] * squeeze;
      cover[s][k] = c;
      const f = PLANT_SPECIES[s].food;
      food[s][k] = f.kind === 'stock' ? f.stockKgHa * c * areaHa : 0;
      const pool = PLANT_SPECIES[s].forageKind === 'graze' ? forage : browse;
      pool[k] += PLANT_SPECIES[s].forageKgHa * c * areaHa;
    }
  }
}

// ALIBI: plants grow, fruit, spread and die back with soil, rain and warmth, whether or not
// anything ever eats them.
export const plants: SystemDef = defineSystem({
  name: 'world.plants',
  declare(state: SimState) {
    for (const species of PLANT_SPECIES) {
      state.world.ensureLayer(coverLayer(species), 'f32');
      state.world.ensureLayer(foodLayer(species), 'f32');
    }
    state.world.ensureLayer(FORAGE_LAYER, 'f32');
    state.world.ensureLayer(BROWSE_LAYER, 'f32');
    state.world.ensureLayer(SEED_RAIN_LAYER, 'u8');
    // Read from the landscape and the climate, which run first.
    state.world.ensureLayer(TERRAIN_LAYERS.elevation, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.waterKind, 'u8');
    state.world.ensureLayer(MOISTURE_LAYER, 'f32');
  },
  init: startPlants,
  create(sim: Sim) {
    const { config, state } = sim;
    const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
    const N = W * H;
    const S = PLANT_SPECIES.length;
    const ticksPerDay = config.time.ticksPerDay;
    const daysPerYear = config.time.daysPerYear;
    const areaHa = (cs * cs) / 10_000;
    const world = state.world;
    const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const moisture = world.layer<Float32Array>(MOISTURE_LAYER);
    const cover = PLANT_SPECIES.map((s) => world.layer<Float32Array>(coverLayer(s)));
    const food = PLANT_SPECIES.map((s) => world.layer<Float32Array>(foodLayer(s)));
    const forage = world.layer<Float32Array>(FORAGE_LAYER);
    const browse = world.layer<Float32Array>(BROWSE_LAYER);
    const seedRain = world.layer<Uint8Array>(SEED_RAIN_LAYER);
    const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weather || !weather.readings) throw new Error('world.plants needs world.climate earlier in the pipeline.');
    const weatherValues = weather.readings();

    // Derived from the landscape and the seed; rebuilt, never saved (docs/DESIGN.md §1.5).
    // Built on the first run, not here: create runs before setup and before a snapshot is read,
    // so the landscape is still blank at this point.
    let K: Float32Array[] = [];
    let anyHabitat = new Uint8Array(0);

    // The catalogue as flat arrays, so the daily loop reads plain numbers.
    const growth = new Float64Array(S);
    const mLo = new Float64Array(S);
    const mOptLo = new Float64Array(S);
    const mOptHi = new Float64Array(S);
    const mHi = new Float64Array(S);
    const minT = new Float64Array(S);
    const dieback = new Float64Array(S);
    const isStock = new Uint8Array(S);
    const seasonStart = new Float64Array(S);
    const seasonEnd = new Float64Array(S);
    /** Seasonal: kg ripening per cell per day at full cover. Stock: kg held per cell at full cover. */
    const amount = new Float64Array(S);
    /** Seasonal: share lost per day. Stock: share of the gap refilled per day. */
    const rate = new Float64Array(S);
    /** Colonisation per unit of neighbouring cover, scaled so a cell's whole capacity counts as 1. */
    const reach = new Float64Array(S);
    /** Forage per cell at full cover of each species, kg. */
    const foragePerCover = new Float64Array(S);
    const isBrowse = new Uint8Array(S);
    const isWoody = new Uint8Array(S);
    const forageRefill = P.forageRefillPerRealYear / 365;
    for (let s = 0; s < S; s++) {
      const species = PLANT_SPECIES[s];
      growth[s] = species.growthPerYear / daysPerYear;
      reach[s] = species.spread / species.maxCover / 4;
      foragePerCover[s] = species.forageKgHa * areaHa;
      isBrowse[s] = species.forageKind === 'browse' ? 1 : 0;
      isWoody[s] = species.woody ? 1 : 0;
      mLo[s] = species.moisture.lo;
      mOptLo[s] = species.moisture.optLo;
      mOptHi[s] = species.moisture.optHi;
      mHi[s] = species.moisture.hi;
      minT[s] = species.minTemperatureC;
      dieback[s] = species.diebackPerDay;
      const f = species.food;
      if (f.kind === 'stock') {
        isStock[s] = 1;
        amount[s] = f.stockKgHa * areaHa;
        rate[s] = f.refillPerRealYear / 365;
      } else {
        seasonStart[s] = f.start;
        seasonEnd[s] = f.end;
        amount[s] = (f.annualYieldKgHa / ((f.end - f.start) * 365)) * areaHa;
        rate[s] = f.lossPerDay;
      }
    }

    const lapse = CLIMATE_CONSTANTS.lapseRatePerM;
    const reference = CLIMATE_CONSTANTS.referenceElevationM;
    const days = P.coverEveryDays;
    const want = new Float64Array(S);
    // Whether a seasonal species may have fruit left anywhere. Only lets the loop skip
    // all-zero work, so it is safe to start at 1 after a snapshot is read.
    const holding = new Uint8Array(S).fill(1);

    function refilled(now: number, target: number, growing: number): number {
      if (now < target) return now + (target - now) * forageRefill * P.coverEveryDays * (growing / target);
      return target;
    }

    function moistureFit(s: number, m: number): number {
      if (m <= mLo[s] || m >= mHi[s]) return 0;
      if (m < mOptLo[s]) return (m - mLo[s]) / (mOptLo[s] - mLo[s]);
      if (m > mOptHi[s]) return (mHi[s] - m) / (mHi[s] - mOptHi[s]);
      return 1;
    }

    function warmthOf(s: number, temperature: number): number {
      const w = (temperature - minT[s]) / P.warmthRampC;
      return w <= 0 ? 0 : w >= 1 ? 1 : w;
    }

    /** Fruit and seeds ripen in their window and drop or rot every day (step 6). */
    function ripen(tick: number): void {
      const season = seasonFraction(config, tick);
      for (let s = 0; s < S; s++) {
        if (isStock[s] === 1) continue;
        const inSeason = inWindow(season, seasonStart[s], seasonEnd[s]);
        if (!inSeason && holding[s] === 0) continue;
        const c = cover[s];
        const f = food[s];
        const keep = 1 - rate[s];
        const ripe = amount[s];
        let any = 0;
        for (let k = 0; k < N; k++) {
          const held = f[k];
          let next = held * keep;
          if (inSeason && c[k] > 0) next += ripe * c[k] * moistureFit(s, moisture[k]);
          if (next < P.leastFoodKg) next = 0;
          else any = 1;
          if (next !== held) f[k] = next;
        }
        holding[s] = any;
      }
    }

    /**
     * Cover and standing stocks for one quarter of the cells, with four days of change
     * (steps 2 to 5). No two neighbouring cells are in the same quarter, so a cell's
     * neighbours stay fixed while it updates, whatever order the cells are visited in.
     */
    function tend(tick: number, quarter: number): void {
      const atReference = dailyMeanTemperatureC(config, tick, weatherValues, reference);
      for (let j = quarter >> 1; j < H; j += 2) {
        for (let i = quarter & 1; i < W; i += 2) {
          const k = j * W + i;
          if (anyHabitat[k] === 0) continue;
          const temperature = atReference - lapse * (elevation[k] - reference);
          const m = moisture[k];
          let total = 0;
          for (let s = 0; s < S; s++) total += cover[s][k];

          // Seeds carried in since the last update start small patches where the habitat allows.
          const arrived = seedRain[k];
          if (arrived !== 0) {
            seedRain[k] = 0;
            for (let s = 0; s < S; s++) {
              if ((arrived & (1 << s)) === 0 || K[s][k] <= 0) continue;
              const c = cover[s][k];
              if (c < P.founderCover && total + P.founderCover - c <= 1) {
                total += P.founderCover - c;
                cover[s][k] = P.founderCover;
              }
            }
          }
          const room = 1 - total;
          let fullGraze = 0;
          let fullBrowse = 0;
          for (let s = 0; s < S; s++) {
            if (isBrowse[s] === 1) fullBrowse += cover[s][k] * foragePerCover[s];
            else fullGraze += cover[s][k] * foragePerCover[s];
          }
          const grazedBare = fullGraze > 0 && forage[k] < P.overgrazedBelow * fullGraze;
          const browsedBare = fullBrowse > 0 && browse[k] < P.overgrazedBelow * fullBrowse;

          // Growth and colonisation wanted by each species, shared fairly if they exceed the room.
          let wanted = 0;
          for (let s = 0; s < S; s++) {
            want[s] = 0;
            if (room <= 0) continue;
            const capacity = K[s][k];
            if (capacity <= 0) continue;
            const c = cover[s][k];
            if (c >= capacity) continue;
            let g = 0;
            if (c > 0) g = growth[s] * days * c * (1 - c / capacity) * moistureFit(s, m) * warmthOf(s, temperature);
            if (m > mLo[s]) {
              const here = cover[s];
              let seeds = 0;
              if (i > 0) seeds += here[k - 1];
              if (i < W - 1) seeds += here[k + 1];
              if (j > 0) seeds += here[k - W];
              if (j < H - 1) seeds += here[k + W];
              g += reach[s] * seeds * capacity * room;
            }
            if (g > capacity - c) g = capacity - c;
            if (g > 0) {
              want[s] = g;
              wanted += g;
            }
          }
          const share = wanted <= 0 ? 0 : wanted > room ? room / wanted : 1;

          for (let s = 0; s < S; s++) {
            const capacity = K[s][k];
            if (capacity <= 0) continue;
            let c = cover[s][k] + want[s] * share;
            // Back toward capacity if above it.
            if (c > capacity) c -= (c - capacity) * growth[s] * days;
            // Dieback in dry ground, in proportion to how far below the species' tolerance.
            const lo = mLo[s];
            if (m < lo && c > 0) c -= c * dieback[s] * days * ((lo - m) / lo);
            // Dieback of soft plants where animals have eaten the patch bare.
            if (c > 0 && foragePerCover[s] > 0 && isWoody[s] === 0 && (isBrowse[s] === 1 ? browsedBare : grazedBare)) {
              c -= c * P.overgrazingDiebackPerDay * days * (PLANT_SPECIES[s].forageKgHa / 300);
            }
            if (c < 1e-6) c = 0;
            cover[s][k] = c;

            if (isStock[s] === 0) continue;
            const target = amount[s] * c;
            const held = food[s][k];
            if (held < target) {
              food[s][k] = held + (target - held) * rate[s] * days * warmthOf(s, temperature) * moistureFit(s, m);
            } else if (held > target) {
              food[s][k] = target + (held - target) * 0.7;
            }
          }

          // Both kinds of forage refill toward what the cover can carry, as fast as the plants grow.
          let grazeTarget = 0;
          let grazeGrowing = 0;
          let browseTarget = 0;
          let browseGrowing = 0;
          for (let s = 0; s < S; s++) {
            const f = cover[s][k] * foragePerCover[s];
            if (f <= 0) continue;
            const g = f * warmthOf(s, temperature) * moistureFit(s, m);
            if (isBrowse[s] === 1) {
              browseTarget += f;
              browseGrowing += g;
            } else {
              grazeTarget += f;
              grazeGrowing += g;
            }
          }
          forage[k] = refilled(forage[k], grazeTarget, grazeGrowing);
          browse[k] = refilled(browse[k], browseTarget, browseGrowing);
        }
      }
    }

    return () => {
      const tick = state.tick;
      if (tick % ticksPerDay !== 0) return;
      if (K.length === 0) {
        K = capacities(sim);
        anyHabitat = new Uint8Array(N);
        for (let s = 0; s < S; s++) for (let k = 0; k < N; k++) if (K[s][k] > 0) anyHabitat[k] = 1;
      }
      ripen(tick);
      tend(tick, dayIndex(config, tick) % P.coverEveryDays);
    };
  },
});
