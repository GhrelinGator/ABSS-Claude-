// Weather: seasons, daily rain, year-to-year swings, storms, lightning, wind, and
// soil moisture. Design: docs/DESIGN.md §2.11 (wind: §2.16). Draws only from the
// CLIMATE stream (and the wind from its own WIND stream) and reads only the
// landscape and the clock.

import type { SimConfig } from '../config.ts';
import type { Sink, Source } from '../core/codec.ts';
import { dayFraction, minutesPerTick } from '../core/clock.ts';
import { cosTurn, exp, sinTurn } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextChance, nextExponential, nextFloat, nextNormal } from '../core/rng.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { seasonFraction } from './light.ts';
import { TERRAIN_LAYERS, Water } from './terrain.ts';

/** Every number the climate uses, in one place. Rates are per real day (docs/DESIGN.md §2.11). */
export const CLIMATE_CONSTANTS = {
  meanTemperatureC: 12,
  seasonalSwingC: 9,
  dailySwingC: 5,
  /** Hour of the warmest moment of the day. */
  warmestHour: 15,
  referenceElevationM: 400,
  lapseRatePerM: 0.0065,
  dailyAnomalyPersistence: 0.75,
  dailyAnomalySpreadC: 2.5,
  slowPersistence: 0.7,
  slowTemperatureSpreadC: 1.2,
  wetnessPersistence: 0.75,
  wetnessSpread: 0.45,
  wetAfterWet: 0.6,
  wetAfterDry: 0.25,
  maxWetChance: 0.95,
  meanWetDayRainMm: 6,
  rainSeasonality: 0.25,
  /** Season fraction of the wettest time of year (late spring). */
  wettestSeason: 0.15,
  stormMinTemperatureC: 8,
  stormFullTemperatureC: 23,
  maxStormChance: 0.3,
  stormEarliestHour: 12,
  stormLatestHour: 20,
  stormMinHours: 1,
  stormMaxHours: 3,
  stormMinRadiusM: 4000,
  stormMaxRadiusM: 12000,
  stormMinRainMm: 5,
  stormMaxRainMm: 25,
  /** Cloud-to-ground strikes per minute while a storm is active. */
  strikesPerMinute: 1.2,
  evaporationPerDegreeMm: 0.2,
  evaporationOffsetC: 3,
  maxEvaporationMm: 7,
  /** Water the ground holds, by soil type (rock, thin, loam, alluvium, sand), in mm. */
  soilCapacityMm: [15, 50, 120, 160, 60],
  initialMoisturePerRain: 0.6,
  /**
   * Water drawn up from the water table into the soil, mm per day: this much where the table is at
   * the surface, shrinking by e for every `tableSupplyDepthM` deeper (docs/DESIGN.md §2.11). An
   * estimate after the steep fall of capillary rise with depth (Gardner 1958).
   */
  tableSupplyMm: 6,
  tableSupplyDepthM: 0.6,
  /** Wind at 10 m (docs/DESIGN.md §2.16): a prevailing westerly, m/s, and the daily AR(1) around it. */
  prevailingWindEastMs: 2,
  windPersistence: 0.6,
  windSpreadMs: 2.5,
  /** Speed swings by this share through the day, strongest at `windiestHour`. */
  windDailySwing: 0.4,
  windiestHour: 14,
  /** Wind under an active storm, as a multiple of the day's wind. */
  stormWindFactor: 2,
} as const;

const K = CLIMATE_CONSTANTS;

/** Positions of the climate's stored numbers, in the array its readings() returns. */
export const CLIMATE_FIELDS = {
  /** Day-to-day temperature anomaly, °C. */
  dailyAnomalyC: 0,
  /** Year-scale temperature anomaly, °C. */
  slowAnomalyC: 1,
  /** Year-scale wetness anomaly; a wet day's rain is multiplied by exp(wetness - spread²/2). */
  wetness: 2,
  /** 1 if today is a wet day. */
  wetToday: 3,
  /** Today's rain in mm where mean rainfall is 1 (before storms). */
  rainTodayMm: 4,
  /** Tick the current or next storm starts, or -1. */
  stormStart: 5,
  /** Tick the storm ends (exclusive), or -1. */
  stormEnd: 6,
  stormX: 7,
  stormY: 8,
  stormRadiusM: 9,
  stormRainMm: 10,
  /** Every cloud-to-ground strike since the run began. */
  strikesTotal: 11,
  /** Days of weather so far. */
  days: 12,
  /** Today's mean wind at 10 m toward the east and toward the south (map +x and +y), m/s. */
  windEastMs: 13,
  windSouthMs: 14,
} as const;

const FIELD_COUNT = 15;

/**
 * Share of a storm's mean rain that falls at squared distance `d2` from its centre, for a storm of
 * squared radius `r2`: twice the mean at the centre, none at the edge, the mean over the whole
 * circle (thunderstorm rain is heaviest under the core; lightning reaches its light-rain edge). T-007.
 */
export function stormRainShare(d2: number, r2: number): number {
  return d2 >= r2 || !(r2 > 0) ? 0 : 2 * (1 - d2 / r2);
}

export const CLIMATE_PARTS = { weather: 'climate.weather', strikes: 'climate.strikes' } as const;
export const MOISTURE_LAYER = 'water.soilMoisture';

/** The climate's stored numbers. */
export class WeatherState implements StatePart {
  readonly name = CLIMATE_PARTS.weather;
  readonly holdsLearned = false;
  readonly values = new Float64Array(FIELD_COUNT);

  readings(): Float64Array {
    return this.values;
  }

  write(sink: Sink): void {
    sink.array(this.values);
  }

  read(source: Source): void {
    const values = source.array('f64');
    if (values.length !== FIELD_COUNT) throw new Error('Snapshot climate state has the wrong length.');
    this.values.set(values);
  }
}

/** Cells struck by lightning during the current tick. Cleared at the start of every tick. */
export class StrikeState implements StatePart {
  readonly name = CLIMATE_PARTS.strikes;
  readonly holdsLearned = false;
  cells = new Int32Array(64);
  count = 0;

  push(cell: number): void {
    if (this.count === this.cells.length) {
      const bigger = new Int32Array(this.cells.length * 2);
      bigger.set(this.cells);
      this.cells = bigger;
    }
    this.cells[this.count++] = cell;
  }

  readings(): Int32Array {
    return this.cells.subarray(0, this.count);
  }

  write(sink: Sink): void {
    sink.array(this.cells.subarray(0, this.count));
  }

  read(source: Source): void {
    const cells = source.array('i32') as Int32Array;
    this.cells = new Int32Array(Math.max(64, cells.length));
    this.cells.set(cells);
    this.count = cells.length;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Average temperature over a whole day at a given height, with the given anomalies, in °C. */
export function dailyMeanTemperatureC(config: SimConfig, tick: number, values: ArrayLike<number>, elevationM: number): number {
  return (
    K.meanTemperatureC +
    K.seasonalSwingC * sinTurn(seasonFraction(config, tick)) -
    K.lapseRatePerM * (elevationM - K.referenceElevationM) +
    values[CLIMATE_FIELDS.dailyAnomalyC] +
    values[CLIMATE_FIELDS.slowAnomalyC]
  );
}

/** Air temperature at a given height at this moment, in °C (docs/DESIGN.md §2.11). */
export function airTemperatureC(config: SimConfig, tick: number, values: ArrayLike<number>, elevationM: number): number {
  const diurnal = K.dailySwingC * cosTurn(dayFraction(config, tick) - K.warmestHour / 24);
  return dailyMeanTemperatureC(config, tick, values, elevationM) + diurnal;
}

/** True if a storm is active at this tick. */
export function stormActive(values: ArrayLike<number>, tick: number): boolean {
  return values[CLIMATE_FIELDS.stormEnd] > tick && values[CLIMATE_FIELDS.stormStart] <= tick;
}

/**
 * Wind at 10 m at this moment, m/s, into `out` as [toward the east, toward the south]: the day's
 * wind, stronger in the early afternoon and calmer before dawn, doubled under an active storm.
 */
export function windAt(config: SimConfig, tick: number, values: ArrayLike<number>, out: Float64Array): void {
  let scale = 1 + K.windDailySwing * cosTurn(dayFraction(config, tick) - K.windiestHour / 24);
  if (stormActive(values, tick)) scale *= K.stormWindFactor;
  out[0] = values[CLIMATE_FIELDS.windEastMs] * scale;
  out[1] = values[CLIMATE_FIELDS.windSouthMs] * scale;
}

/** Seasonal factor on rain: 1 ± seasonality, wettest in late spring. */
function rainSeason(config: SimConfig, tick: number): number {
  return 1 + K.rainSeasonality * cosTurn(seasonFraction(config, tick) - K.wettestSeason);
}

/** One step of a first-order autoregressive process with the given persistence and long-run spread. */
function ar1(s: Uint32Array, o: number, x: number, persistence: number, spread: number): number {
  return persistence * x + spread * Math.sqrt(1 - persistence * persistence) * nextNormal(s, o);
}

function startWeather(sim: Sim, weather: WeatherState): void {
  const { config, state } = sim;
  const s = state.streams;
  const o = globalStreamOffset(StreamDomain.CLIMATE);
  const v = weather.values;
  const variability = config.climate.variability;
  // Start the anomalies from their long-run distribution, so the first year is not special.
  v[CLIMATE_FIELDS.dailyAnomalyC] = K.dailyAnomalySpreadC * nextNormal(s, o);
  v[CLIMATE_FIELDS.slowAnomalyC] = K.slowTemperatureSpreadC * variability * nextNormal(s, o);
  v[CLIMATE_FIELDS.wetness] = K.wetnessSpread * variability * nextNormal(s, o);
  const longRunWet = K.wetAfterDry / (1 - K.wetAfterWet + K.wetAfterDry);
  v[CLIMATE_FIELDS.wetToday] = nextChance(s, o, longRunWet) ? 1 : 0;
  v[CLIMATE_FIELDS.stormStart] = -1;
  v[CLIMATE_FIELDS.stormEnd] = -1;
  // Wind draws from its own stream, so the rest of the weather is what it was before wind existed.
  const w = globalStreamOffset(StreamDomain.WIND);
  v[CLIMATE_FIELDS.windEastMs] = K.prevailingWindEastMs + K.windSpreadMs * nextNormal(s, w);
  v[CLIMATE_FIELDS.windSouthMs] = K.windSpreadMs * nextNormal(s, w);

  const world = state.world;
  const rainfall = world.layer<Float32Array>(TERRAIN_LAYERS.rainfall);
  const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const moisture = world.layer<Float32Array>(MOISTURE_LAYER);
  for (let k = 0; k < moisture.length; k++) {
    moisture[k] = kind[k] !== Water.DRY ? 1 : clamp01(K.initialMoisturePerRain * rainfall[k]);
  }
}

// ALIBI: rain, heat, cold, storms and lightning happen whether or not anything lives under them.
export const climate: SystemDef = defineSystem({
  name: 'world.climate',
  declare(state: SimState) {
    state.addPart(new WeatherState());
    state.addPart(new StrikeState());
    state.world.ensureLayer(MOISTURE_LAYER, 'f32');
    // Read from the landscape (declared by world.terrain, which runs first).
    state.world.ensureLayer(TERRAIN_LAYERS.elevation, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.rainfall, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.soil, 'u8');
    state.world.ensureLayer(TERRAIN_LAYERS.waterKind, 'u8');
    state.world.ensureLayer(TERRAIN_LAYERS.tableDepth, 'f32');
  },
  init(sim: Sim) {
    startWeather(sim, sim.state.parts.find((p) => p.name === CLIMATE_PARTS.weather) as WeatherState);
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather) as WeatherState;
    const strikes = state.parts.find((p) => p.name === CLIMATE_PARTS.strikes) as StrikeState;
    const s = state.streams;
    const o = globalStreamOffset(StreamDomain.CLIMATE);
    const ow = globalStreamOffset(StreamDomain.WIND);
    const v = weather.values;
    const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
    const widthM = W * cs;
    const heightM = H * cs;
    const ticksPerDay = config.time.ticksPerDay;
    const seasonDays = Math.max(1, Math.round(config.time.daysPerYear / 4));
    const variability = config.climate.variability;
    const world = state.world;
    const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const rainfall = world.layer<Float32Array>(TERRAIN_LAYERS.rainfall);
    const soil = world.layer<Uint8Array>(TERRAIN_LAYERS.soil);
    const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    const moisture = world.layer<Float32Array>(MOISTURE_LAYER);
    const capacity = new Float64Array(5);
    for (let t = 0; t < 5; t++) capacity[t] = K.soilCapacityMm[t];
    // Water each cell draws up from the water table a day, mm. Derived from the landscape on first
    // use (the landscape is built after systems are created) and never saved (§1.5).
    let fromBelow: Float64Array | null = null;
    function tableSupply(): Float64Array {
      if (fromBelow) return fromBelow;
      const table = world.layer<Float32Array>(TERRAIN_LAYERS.tableDepth);
      fromBelow = new Float64Array(table.length);
      for (let k = 0; k < table.length; k++) fromBelow[k] = K.tableSupplyMm * exp(-table[k] / K.tableSupplyDepthM);
      return fromBelow;
    }

    // Poisson draws of strikes per tick (Knuth's method); the threshold is fixed for the run.
    const strikeMean = K.strikesPerMinute * minutesPerTick(config);
    const strikeThreshold = exp(-strikeMean);
    const tickHours = 24 / ticksPerDay;
    const wetnessSpread = K.wetnessSpread * variability;
    const halfWetnessVariance = (wetnessSpread * wetnessSpread) / 2;

    function newDay(tick: number): void {
      const day = v[CLIMATE_FIELDS.days];
      v[CLIMATE_FIELDS.days] = day + 1;
      if (day % seasonDays === 0) {
        v[CLIMATE_FIELDS.slowAnomalyC] = ar1(s, o, v[CLIMATE_FIELDS.slowAnomalyC], K.slowPersistence, K.slowTemperatureSpreadC * variability);
        v[CLIMATE_FIELDS.wetness] = ar1(s, o, v[CLIMATE_FIELDS.wetness], K.wetnessPersistence, K.wetnessSpread * variability);
      }
      v[CLIMATE_FIELDS.dailyAnomalyC] = ar1(s, o, v[CLIMATE_FIELDS.dailyAnomalyC], K.dailyAnomalyPersistence, K.dailyAnomalySpreadC);
      v[CLIMATE_FIELDS.windEastMs] = K.prevailingWindEastMs + ar1(s, ow, v[CLIMATE_FIELDS.windEastMs] - K.prevailingWindEastMs, K.windPersistence, K.windSpreadMs);
      v[CLIMATE_FIELDS.windSouthMs] = ar1(s, ow, v[CLIMATE_FIELDS.windSouthMs], K.windPersistence, K.windSpreadMs);

      const season = rainSeason(config, tick);
      const base = v[CLIMATE_FIELDS.wetToday] === 1 ? K.wetAfterWet : K.wetAfterDry;
      const chance = base * season > K.maxWetChance ? K.maxWetChance : base * season;
      const wet = nextChance(s, o, chance);
      v[CLIMATE_FIELDS.wetToday] = wet ? 1 : 0;
      // The wetness anomaly scales how much falls on a wet day. Subtracting half its variance
      // keeps the long-run average at 1, so turning variability up changes how unequal the
      // years are without making the climate wetter or drier on average (docs/DESIGN.md §2.11).
      const drought = exp(v[CLIMATE_FIELDS.wetness] - halfWetnessVariance);
      v[CLIMATE_FIELDS.rainTodayMm] = wet ? K.meanWetDayRainMm * season * drought * nextExponential(s, o) : 0;

      // A thunderstorm, on warm wet days.
      v[CLIMATE_FIELDS.stormStart] = -1;
      v[CLIMATE_FIELDS.stormEnd] = -1;
      v[CLIMATE_FIELDS.stormRainMm] = 0;
      if (wet) {
        const warmth = clamp01(
          (dailyMeanTemperatureC(config, tick, v, K.referenceElevationM) - K.stormMinTemperatureC) /
            (K.stormFullTemperatureC - K.stormMinTemperatureC),
        );
        if (nextChance(s, o, K.maxStormChance * warmth)) {
          const startHour = K.stormEarliestHour + nextFloat(s, o) * (K.stormLatestHour - K.stormEarliestHour);
          const hours = K.stormMinHours + nextFloat(s, o) * (K.stormMaxHours - K.stormMinHours);
          const start = tick + Math.floor(startHour / tickHours);
          v[CLIMATE_FIELDS.stormStart] = start;
          v[CLIMATE_FIELDS.stormEnd] = start + Math.max(1, Math.round(hours / tickHours));
          v[CLIMATE_FIELDS.stormX] = nextFloat(s, o) * widthM;
          v[CLIMATE_FIELDS.stormY] = nextFloat(s, o) * heightM;
          v[CLIMATE_FIELDS.stormRadiusM] = K.stormMinRadiusM + nextFloat(s, o) * (K.stormMaxRadiusM - K.stormMinRadiusM);
          v[CLIMATE_FIELDS.stormRainMm] = K.stormMinRainMm + nextFloat(s, o) * (K.stormMaxRainMm - K.stormMinRainMm);
        }
      }
      updateMoisture(tick);
    }

    function updateMoisture(tick: number): void {
      const rainMm = v[CLIMATE_FIELDS.rainTodayMm];
      const stormRain = v[CLIMATE_FIELDS.stormRainMm];
      const sx = v[CLIMATE_FIELDS.stormX];
      const sy = v[CLIMATE_FIELDS.stormY];
      const r2 = v[CLIMATE_FIELDS.stormRadiusM] * v[CLIMATE_FIELDS.stormRadiusM];
      const meanAtReference = dailyMeanTemperatureC(config, tick, v, K.referenceElevationM);
      const supply = tableSupply();
      for (let j = 0; j < H; j++) {
        const dy = (j + 0.5) * cs - sy;
        for (let i = 0; i < W; i++) {
          const k = j * W + i;
          if (kind[k] !== Water.DRY) {
            moisture[k] = 1;
            continue;
          }
          const cap = capacity[soil[k]];
          let rain = rainMm;
          if (stormRain > 0) {
            const dx = (i + 0.5) * cs - sx;
            rain += stormRain * stormRainShare(dx * dx + dy * dy, r2);
          }
          // Storms, like ordinary rain, drop less where the climate is drier. A shallow water table
          // tops the soil up from below.
          let held = moisture[k] * cap + rain * rainfall[k] + supply[k];
          if (held > cap) held = cap;
          const temperature = meanAtReference - K.lapseRatePerM * (elevation[k] - K.referenceElevationM);
          let demand = K.evaporationPerDegreeMm * (temperature + K.evaporationOffsetC);
          if (demand < 0) demand = 0;
          else if (demand > K.maxEvaporationMm) demand = K.maxEvaporationMm;
          held -= demand * (held / cap);
          moisture[k] = held <= 0 ? 0 : held / cap;
        }
      }
    }

    function lightning(): void {
      // Count of strikes this tick: Knuth's Poisson method.
      let count = -1;
      let product = 1;
      do {
        count++;
        product *= nextFloat(s, o);
      } while (product > strikeThreshold);
      const sx = v[CLIMATE_FIELDS.stormX];
      const sy = v[CLIMATE_FIELDS.stormY];
      const r = v[CLIMATE_FIELDS.stormRadiusM];
      for (let n = 0; n < count; n++) {
        let ux = 0;
        let uy = 0;
        do {
          ux = nextFloat(s, o) * 2 - 1;
          uy = nextFloat(s, o) * 2 - 1;
        } while (ux * ux + uy * uy > 1);
        const x = sx + ux * r;
        const y = sy + uy * r;
        // Strikes beyond the edge of the map fall outside the world.
        if (x < 0 || y < 0 || x >= widthM || y >= heightM) continue;
        strikes.push(Math.floor(y / cs) * W + Math.floor(x / cs));
        v[CLIMATE_FIELDS.strikesTotal] += 1;
      }
    }

    return () => {
      const tick = state.tick;
      strikes.count = 0;
      if (tick % ticksPerDay === 0) newDay(tick);
      if (stormActive(v, tick)) lightning();
    };
  },
});
