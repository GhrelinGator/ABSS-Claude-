// Fire: ignition, spread, fuel and its moisture, smouldering, burnout, burning objects that can
// be carried, and the light and heat a fire gives. Design: docs/DESIGN.md §2.9 and §2.16.
//
// Fire is physics. It needs dry fine fuel, it spreads with the wind and up slopes, and it dies
// when the fuel is gone or wet. Nothing here depends on who is near it.

import type { Sink, Source } from '../core/codec.ts';
import { dayFraction, dayIndex, minutesPerTick } from '../core/clock.ts';
import { cosTurn, exp, pow } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextFloat } from '../core/rng.ts';
import { BucketGrid } from '../core/spatial.ts';
import { spawnEntity } from '../sim.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { CLIMATE_CONSTANTS, CLIMATE_FIELDS, CLIMATE_PARTS, MOISTURE_LAYER, airTemperatureC, dailyMeanTemperatureC, stormActive, windAt } from './climate.ts';
import { MATERIAL_CONSTANTS, MATERIAL_LAYERS, Material, OBJECT_STORE, materialById, thicknessOf } from './materials.ts';
import { seasonFraction } from './light.ts';
import { BROWSE_LAYER, FORAGE_LAYER, PLANT_SPECIES, coverLayer, foodLayer } from './plants.ts';
import { TERRAIN_LAYERS, Water } from './terrain.ts';

// ---------------------------------------------------------------- names and constants

/** What a cell's fire is doing. */
export const FireStage = { NONE: 0, FLAMING: 1, SMOULDERING: 2 } as const;

export const FIRE_LAYERS = {
  /** FireStage of each cell. */
  stage: 'fire.stage',
  /** Day number + 1 of the last time the cell flamed; 0 if it never has. */
  lastBurnDay: 'fire.lastBurnDay',
} as const;

/** One entity per burning cell. */
export const FIRE_STORE = 'fires';
export const FIRE_PARTS = { counts: 'fire.counts', wetting: 'fire.wetting' } as const;

/** Running totals since the start of the run, plus the burning objects now. Indices are fixed. */
export const FIRE_FIELDS = {
  /** Lightning strikes that started a fire (flaming or smouldering). */
  lightningIgnitions: 0,
  /** Of those, the ones that started smouldering in wood ("holdovers"). */
  holdovers: 1,
  /** Cells whose fine fuel was lit by a spark, by an ember from rubbing, or by a burning object lying there. */
  sparkIgnitions: 2,
  emberIgnitions: 3,
  objectIgnitions: 4,
  /** Every time a cell started flaming, whatever lit it. */
  cellsIgnited: 5,
  /** Smouldering cells that burst into flame again. */
  flareUps: 6,
  /** Wood objects that caught fire. */
  objectsCaught: 7,
  /** Objects burning now. */
  burningObjects: 8,
  /** Embers made by rubbing wood. */
  embers: 9,
} as const;
const FIELD_COUNT = 10;

/** Every number fire uses, in one place. Sources and estimates: docs/RESEARCH.md (*Fire*). */
export const FIRE_CONSTANTS = {
  /** Estimated relative humidity near the ground: base, per unit of soil moisture, on a wet day, and its daily swing. */
  humidityBase: 0.5,
  humidityPerSoilMoisture: 0.3,
  humidityWetDay: 0.15,
  humidityDailySwing: 0.2,
  /** Fine fuel under full tree cover is shaded: this much more moisture. */
  shadeMoisture: 0.05,
  /**
   * Dew on fine fuel under open sky: none at an estimated humidity of `dewFrom`, `dewMoisture` more
   * moisture from `dewFull` (surfaces are wet with dew at about 90%; Sentelhas et al. 2008). T-007.
   */
  dewFrom: 0.88,
  dewFull: 0.92,
  dewMoisture: 0.15,
  /** Hour the air is driest. */
  driestHour: 15,
  /** Points of moisture (as a share) added per mm of rain on the cell today: fine fuel, sticks. Poles follow the soil instead. */
  fineWetPerMm: 0.06,
  stickWetPerMm: 0.03,
  /**
   * Rain water held in the fine fuel after the day it fell shrinks by e every this many hours
   * (the Fine Fuel Moisture Code's nominal time lag of two-thirds of a day; Van Wagner 1987). The
   * fire system remembers the last `wettingStorms` storms for this. T-007.
   */
  wettingLagHours: 16,
  wettingStorms: 4,
  /** Sticks sit this far above the fine fuel's daily-mean equilibrium. */
  stickAboveEquilibrium: 0.02,
  /** Poles and trunks follow the soil: base + slope × soil moisture. */
  logMoistureBase: 0.08,
  logMoisturePerSoil: 0.25,
  /**
   * Fine fuel this wet or wetter does not carry flame (Cheney et al. 1998): 24% in a wind of
   * `lightWindKmh` or more at 10 m, 20% in a lighter one (T-007).
   */
  extinctionMoisture: 0.24,
  extinctionMoistureLightWind: 0.2,
  lightWindKmh: 10,
  /** Moisture damping: exp(−dampPerPoint × M%) up to `dampLinearFrom`%, then linear to 0 at extinction. */
  dampPerPoint: 0.108,
  dampLinearFrom: 12,
  /** Curing: greenness from warmth (°C, daily mean) and soil moisture; spread from 40% cured, full at 90%. */
  greenFromC: 5,
  greenFullC: 13,
  greenFromMoisture: 0.25,
  greenFullMoisture: 0.55,
  curedFrom: 0.4,
  curedFull: 0.9,
  /** During the dying-back season (the litter fall, materials) plants keep only this share of their greenness. */
  dyingBackGreen: 0.6,
  /** Fine fuel (litter, t/ha): no spread below `fuelFrom`, full above `fuelFull`. */
  fuelFromTpha: 0.5,
  fuelFullTpha: 2,
  /** Under full tree cover: share of the open wind that reaches the fire, and how much slower the leaf bed burns. */
  canopyWindCut: 0.75,
  canopyBedSlowdown: 0.6,
  /** Spread with no wind, km/h, and the steeper slope of the low-wind relation (Cheney et al. 1998). */
  noWindKmh: 0.054,
  lowWindPerKmh: 0.269,
  /** Above `highWindFromKmh`: 1.4 + 0.838 (U − 5)^0.844 km/h. */
  highWindFromKmh: 5,
  highWindBaseKmh: 1.4,
  highWindCoefficient: 0.838,
  highWindExponent: 0.844,
  /** Fire shape: length-to-breadth ratio 1 + lbScale (1 − e^(−lbRate U))^lbExponent, U the 10 m wind in km/h (Alexander 1985). */
  lbScale: 8.729,
  lbRate: 0.03,
  lbExponent: 2.155,
  /** Up a slope s: × (1 + slopeDoubling × s); down: × 1 / (1 + slopeDoubling × |s|). |s| is capped. */
  slopeDoubling: 5.7,
  slopeMost: 0.6,
  /** Each burning cell's spread rates are scaled by a vigour drawn between these when it starts flaming. */
  vigourLeast: 0.7,
  vigourMost: 1.3,
  /** A cell flames for 1.5 cell widths ÷ its slowest spread rate, within these limits, minutes. */
  flameLeastMinutes: 10,
  flameMostMinutes: 240,
  /** Share of fine fuel left unburnt after flaming, and share of the sticks burnt in the flames. */
  litterLeft: 0.05,
  sticksInFlames: 0.4,
  /** Heat of burning, kJ/kg: fine plant matter, and wood (from the materials catalogue). */
  litterKjPerKg: 18000,
  /** Smouldering: share of sticks and of poles burnt per hour when dry; nothing burns at `smoulderWetMoisture`. */
  smoulderSticksPerHour: 0.15,
  smoulderPolesPerHour: 0.03,
  smoulderDryMoisture: 0.1,
  smoulderWetMoisture: 0.45,
  /** A cell needs this much wood, kg, to smoulder. Smouldering dies out by itself at this rate per hour (embers cool). */
  smoulderLeastKg: 5,
  smoulderOutPerHour: 0.06,
  /** Chance per hour that a smouldering cell with dry, cured fine fuel flares, times the moisture factor. */
  flarePerHour: 0.3,
  /**
   * Rain puts a smouldering cell out: a storm with chance per tick per mm/h falling (at most
   * `rainOutMost`); a wet day's rain with chance `wetDayOutPerMm` per mm on the cell over the
   * day (at most `wetDayOutMost`), spread over the day's ticks.
   */
  rainOutPerMmPerHour: 0.01,
  rainOutMost: 0.2,
  wetDayOutPerMm: 0.1,
  wetDayOutMost: 0.95,
  /** Lightning: chance per strike × wood present (full at `strikeWoodFullTpha`) × pole dryness; or × fine-fuel readiness. */
  strikeChance: 0.03,
  strikeWoodFullTpha: 5,
  strikeDryMoisture: 0.15,
  strikeWetMoisture: 0.45,
  /** Severity of a flaming front: intensity ÷ (intensity + this), kW/m (Byram's fireline intensity). */
  severityHalfKwPerM: 2000,
  /** Grass forage burnt, and browse burnt at full severity. */
  forageBurnt: 0.9,
  browseBurnt: 0.6,
  /** Sparks: chance each catches = this × heat × tinder readiness. An ember from rubbing: this × readiness. */
  sparkCatch: 0.04,
  emberCatch: 0.5,
  /** A small flame at a point lights wood within this distance, m, and the cell with this chance × readiness. */
  kindleReachM: 0.5,
  kindleCellChance: 0.3,
  /** Rubbing: energy × precision² needed for an ember at 8% moisture, J; extra per point of moisture above 8%; no ember above. */
  emberEnergyJ: 2500,
  emberPerMoisture: 8,
  emberDryMoisture: 0.08,
  emberMostMoisture: 0.22,
  dustKgPerKj: 0.001,
  /** Burning objects: radius lost per minute alone and in a pile, m; a pile is this many other burning pieces within reach. */
  burnAloneMPerMin: 0.00025,
  burnPileMPerMin: 0.0008,
  pileReachM: 0.5,
  pileOthers: 2,
  /** Gone below this radius, m. */
  burntOutRadiusM: 0.002,
  /** A lone piece thicker than this, m, goes out with `loneOutChance` per tick. */
  loneOutThicknessM: 0.025,
  loneOutChance: 0.08,
  /** Catching from a burning neighbour within reach: chance per tick = this ÷ thickness (m) × dryness; in a flaming cell: twice that. */
  catchPerThickness: 0.015,
  /** Rain puts a burning object out with chance per tick per mm on the cell today (at most `rainOutObjectMost`), or `stormOutObject` under a storm. */
  rainOutObjectPerMm: 0.02,
  rainOutObjectMost: 0.5,
  stormOutObject: 0.5,
  /** A burning object lying on the ground lights the cell with chance this × readiness × heat ÷ `escapeRefKw`. */
  escapeChance: 0.05,
  escapeRefKw: 20,
  /** Hides in a flaming cell lose this much integrity. */
  hideScorch: 0.5,
  /** Light: a fire of `lightRefKw` lights things `lightRefM` away as brightly as the full moon (`lightAtRef`). */
  lightRefKw: 20,
  lightRefM: 8,
  lightAtRef: 0.06,
  /** Share of a fire's heat given off as radiation. */
  radiantShare: 0.3,
  /** How far burning cells and burning objects are looked for, m. */
  cellReachM: 3000,
  objectReachM: 100,
  /** Animals keep this far from a fire of `avoidRefKw`, m, scaling with the fourth root of its heat. */
  avoidRefM: 25,
  avoidRefKw: 20,
  /** Fires at least this hot, kW, are kept away from by every animal; predators keep away from all fire. */
  everyAnimalAvoidsKw: 1000,
} as const;
const K = FIRE_CONSTANTS;

/** How fire treats each plant species: share of cover killed at full severity, share of the standing food above ground burnt. */
export const FIRE_PLANT_RESPONSE: Readonly<Record<string, { readonly topKill: number; readonly foodBurnt: number }>> = {
  grass: { topKill: 0.15, foodBurnt: 0.9 },
  tuber: { topKill: 0.05, foodBurnt: 0 },
  berry: { topKill: 0.5, foodBurnt: 0.8 },
  nut: { topKill: 0.6, foodBurnt: 0.5 },
  greens: { topKill: 0.4, foodBurnt: 0.8 },
  bitterRoot: { topKill: 0.05, foodBurnt: 0 },
  nightshade: { topKill: 0.5, foodBurnt: 0.8 },
  reed: { topKill: 0.15, foodBurnt: 0 },
};


// ---------------------------------------------------------------- pure physics

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Equilibrium moisture of fine dead fuel, as a share of dry mass, at an air temperature (°C)
 * and relative humidity (0 to 1). Simard (1968), as used in the US National Fire Danger Rating System.
 */
export function equilibriumMoisture(temperatureC: number, humidity: number): number {
  const h = clamp01(humidity) * 100;
  const t = temperatureC * 1.8 + 32;
  let m: number;
  if (h < 10) m = 0.03229 + 0.281073 * h - 0.000578 * h * t;
  else if (h < 50) m = 2.22749 + 0.160107 * h - 0.01478 * t;
  else m = 21.0606 + 0.005565 * h * h - 0.00035 * h * t - 0.483199 * h;
  return m < 0.5 ? 0.005 : m / 100;
}

/** Relative humidity near the ground (0.1 to 1), estimated from soil moisture, a wet day, and the hour. */
export function airHumidity(soilMoisture: number, wetDay: boolean, hourCos: number): number {
  const h = K.humidityBase + K.humidityPerSoilMoisture * soilMoisture + (wetDay ? K.humidityWetDay : 0) - K.humidityDailySwing * hourCos;
  return h < 0.1 ? 0.1 : h > 1 ? 1 : h;
}

/** Moisture added to fine fuel under open sky by dew at an estimated relative humidity (0 to 1). */
export function dewMoisture(humidity: number): number {
  return K.dewMoisture * clamp01((humidity - K.dewFrom) / (K.dewFull - K.dewFrom));
}

/**
 * How much fuel moisture slows a fire: about 1 when bone dry, 0 at the moisture of extinction,
 * which is lower in a light wind (Cheney et al. 1998; Eq. 3.7 in Cruz et al. 2015). `windKmh` is
 * the wind reaching the fire; leave it out for a strong wind.
 */
export function moistureFactor(moisture: number, windKmh: number = K.lightWindKmh): number {
  const m = moisture * 100;
  const x = (windKmh < K.lightWindKmh ? K.extinctionMoistureLightWind : K.extinctionMoisture) * 100;
  if (m >= x) return 0;
  if (m <= K.dampLinearFrom) return exp(-K.dampPerPoint * (m < 0 ? 0 : m));
  return (exp(-K.dampPerPoint * K.dampLinearFrom) * (x - m)) / (x - K.dampLinearFrom);
}

/** Head-fire spread in open, cured, continuous fine fuel at no moisture damping, km/h, for a 10 m wind in km/h (Cheney et al. 1998). */
export function openSpreadKmh(windKmh: number): number {
  if (windKmh < K.highWindFromKmh) return K.noWindKmh + K.lowWindPerKmh * (windKmh > 0 ? windKmh : 0);
  return K.highWindBaseKmh + K.highWindCoefficient * pow(windKmh - K.highWindFromKmh, K.highWindExponent);
}

/** Curing factor from the share of the cell's fine fuel that is dead and dry. */
export function curingFactor(cured: number): number {
  return clamp01((cured - K.curedFrom) / (K.curedFull - K.curedFrom));
}

/** Fuel continuity factor from fine fuel in t/ha. */
export function fuelFactor(tonnesPerHa: number): number {
  return clamp01((tonnesPerHa - K.fuelFromTpha) / (K.fuelFullTpha - K.fuelFromTpha));
}

/** Length-to-breadth ratio of a fire spreading in a 10 m wind of `windKmh` (Alexander 1985). */
export function lengthToBreadth(windKmh: number): number {
  const u = windKmh > 0 ? windKmh : 0;
  return 1 + K.lbScale * pow(1 - exp(-K.lbRate * u), K.lbExponent);
}

/**
 * Spread rate at angle θ from the wind as a share of the head rate, for an elliptical fire with
 * the ignition at its rear focus: (1 − e) / (1 − e cos θ), e from the length-to-breadth ratio.
 */
export function shareOfHead(cosTheta: number, lb: number): number {
  const e = lb > 1 ? Math.sqrt(1 - 1 / (lb * lb)) : 0;
  return (1 - e) / (1 - e * cosTheta);
}

/** How a slope (rise over run, positive uphill) changes the spread rate. */
export function slopeFactor(rise: number): number {
  const s = rise > K.slopeMost ? K.slopeMost : rise < -K.slopeMost ? -K.slopeMost : rise;
  return s >= 0 ? 1 + K.slopeDoubling * s : 1 / (1 - K.slopeDoubling * s);
}

/** Distance animals keep from a fire giving off `kw`, m. */
export function avoidDistanceM(kw: number): number {
  return K.avoidRefM * Math.sqrt(Math.sqrt(kw > 0 ? kw / K.avoidRefKw : 0));
}

/** Light at `distanceM` from a fire giving off `kw`, as a share of full sun. */
export function fireLight(kw: number, distanceM: number): number {
  const d = distanceM < 1 ? 1 : distanceM;
  const r = K.lightRefM / d;
  return K.lightAtRef * (kw / K.lightRefKw) * r * r;
}

// ---------------------------------------------------------------- conditions in a cell

export interface FuelReading {
  /** Moisture of the fine fuel, sticks, and poles, as shares of dry mass. */
  fine: number;
  sticks: number;
  poles: number;
  /** Fine fuel, t/ha (litter plus a share of the sticks). */
  fineTpha: number;
  /** Curing factor, 0 (green) to 1 (cured). */
  curing: number;
  /** 0 to 1: how readily the fine fuel here takes a spark or a flame. */
  readiness: number;
  /** Head-fire and backing spread rates if it burned now, m per minute. */
  headMPerMin: number;
  backMPerMin: number;
}

/**
 * Reads the weather and the fuel to give fuel moisture and spread rates in any cell at the
 * current tick. Holds no state of its own; `refresh(tick)` re-reads the weather.
 */
export class FireConditions {
  private readonly sim: Sim;
  private readonly W: number;
  private readonly areaHa: number;
  private readonly weather: ArrayLike<number>;
  private readonly elevation: Float32Array;
  private readonly rainfall: Float32Array;
  private readonly water: Uint8Array;
  private readonly moisture: Float32Array;
  private readonly litter: Float32Array;
  private readonly tree: Float32Array;
  private readonly covers: Float32Array[];
  private tick = -1;
  private airRef = 0;
  private meanRef = 0;
  private hourCos = 0;
  private phenology = 1;
  private wet = false;
  private rainMm = 0;
  private stormRainMm = 0;
  private stormX = 0;
  private stormY = 0;
  private stormR2 = 0;
  private stormNow = false;
  private stormMmPerHour = 0;
  private readonly wetting: ArrayLike<number> | null;
  /** Earlier days' rain still in the fine fuel now: the map-wide amount, and each kept storm's (x, y, radius², amount). */
  private carriedDay = 0;
  private readonly carriedStorms = new Float64Array(4 * K.wettingStorms);
  /** Wind at 10 m now, km/h, and its direction as a unit vector (toward which it blows). */
  windKmh = 0;
  windUx = 1;
  windUy = 0;
  private readonly wind = new Float64Array(2);

  constructor(sim: Sim) {
    this.sim = sim;
    const { config, state } = sim;
    this.W = config.world.widthCells;
    this.areaHa = (config.world.cellSizeM * config.world.cellSizeM) / 10_000;
    const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weather || !weather.readings) throw new Error('Fire needs world.climate.');
    this.weather = weather.readings();
    const world = state.world;
    this.elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    this.rainfall = world.layer<Float32Array>(TERRAIN_LAYERS.rainfall);
    this.water = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    this.moisture = world.layer<Float32Array>(MOISTURE_LAYER);
    this.litter = world.layer<Float32Array>(MATERIAL_LAYERS.litter);
    this.covers = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
    const nut = PLANT_SPECIES.findIndex((sp) => sp.name === 'nut');
    this.tree = this.covers[nut];
    const wetting = state.parts.find((p) => p.name === FIRE_PARTS.wetting);
    this.wetting = wetting && wetting.readings ? wetting.readings() : null;
  }

  /** Re-read the weather for this tick (cheap; does nothing if already current). */
  refresh(tick: number): void {
    if (tick === this.tick) return;
    this.tick = tick;
    const { config } = this.sim;
    const v = this.weather;
    const ref = CLIMATE_CONSTANTS.referenceElevationM;
    this.airRef = airTemperatureC(config, tick, v, ref);
    this.meanRef = dailyMeanTemperatureC(config, tick, v, ref);
    this.hourCos = cosTurn(dayFraction(config, tick) - K.driestHour / 24);
    const season = seasonFraction(config, tick);
    this.phenology = season >= MATERIAL_CONSTANTS.litterFallStart && season < MATERIAL_CONSTANTS.litterFallEnd ? K.dyingBackGreen : 1;
    this.wet = v[CLIMATE_FIELDS.wetToday] === 1;
    this.rainMm = v[CLIMATE_FIELDS.rainTodayMm];
    const start = v[CLIMATE_FIELDS.stormStart];
    // Storm rain counts from the moment the storm starts.
    this.stormRainMm = start >= 0 && start <= tick ? v[CLIMATE_FIELDS.stormRainMm] : 0;
    this.stormX = v[CLIMATE_FIELDS.stormX];
    this.stormY = v[CLIMATE_FIELDS.stormY];
    this.stormR2 = v[CLIMATE_FIELDS.stormRadiusM] * v[CLIMATE_FIELDS.stormRadiusM];
    this.stormNow = stormActive(v, tick);
    const hours = ((v[CLIMATE_FIELDS.stormEnd] - start) * minutesPerTick(config)) / 60;
    this.stormMmPerHour = this.stormNow && hours > 0 ? v[CLIMATE_FIELDS.stormRainMm] / hours : 0;
    const w = this.wetting;
    if (w) {
      const perTick = minutesPerTick(config);
      this.carriedDay = w[0] * wettingLeft(tick - w[1], perTick);
      for (let n = 0; n < K.wettingStorms; n++) {
        const o = 2 + 5 * n;
        this.carriedStorms[4 * n] = w[o];
        this.carriedStorms[4 * n + 1] = w[o + 1];
        this.carriedStorms[4 * n + 2] = w[o + 2] * w[o + 2];
        this.carriedStorms[4 * n + 3] = w[o + 3] * wettingLeft(tick - w[o + 4], perTick);
      }
    }
    windAt(config, tick, v, this.wind);
    const speed = Math.sqrt(this.wind[0] * this.wind[0] + this.wind[1] * this.wind[1]);
    this.windKmh = speed * 3.6;
    this.windUx = speed > 0 ? this.wind[0] / speed : 1;
    this.windUy = speed > 0 ? this.wind[1] / speed : 0;
  }

  private insideStorm(k: number): boolean {
    const cs = this.sim.config.world.cellSizeM;
    const i = k % this.W;
    const dx = (i + 0.5) * cs - this.stormX;
    const dy = ((k - i) / this.W + 0.5) * cs - this.stormY;
    return dx * dx + dy * dy <= this.stormR2;
  }

  /** Rain that has fallen on cell k today so far, mm (storm rain from the storm's start). */
  rainOn(k: number): number {
    let mm = this.rainMm;
    if (this.stormRainMm > 0 && this.insideStorm(k)) mm += this.stormRainMm;
    return mm * this.rainfall[k];
  }

  /** Moisture (share of dry mass) the fine fuel in cell k still holds from earlier days' rain. */
  carriedWater(k: number): number {
    let m = this.carriedDay;
    const cs = this.sim.config.world.cellSizeM;
    const i = k % this.W;
    const x = (i + 0.5) * cs;
    const y = ((k - i) / this.W + 0.5) * cs;
    const st = this.carriedStorms;
    for (let n = 0; n < K.wettingStorms; n++) {
      const amount = st[4 * n + 3];
      if (!(amount > 1e-4)) continue;
      const dx = x - st[4 * n];
      const dy = y - st[4 * n + 1];
      if (dx * dx + dy * dy <= st[4 * n + 2]) m += amount;
    }
    return m * this.rainfall[k];
  }

  /** A storm's rain falling on cell k right now, mm per hour (0 with no storm overhead). */
  stormRateNow(k: number): number {
    return this.stormNow && this.insideStorm(k) ? this.stormMmPerHour * this.rainfall[k] : 0;
  }

  /** A wet day's ordinary rain on cell k today, mm (storms apart). */
  dayRainOn(k: number): number {
    return this.rainMm * this.rainfall[k];
  }

  private airAt(k: number): number {
    return this.airRef - CLIMATE_CONSTANTS.lapseRatePerM * (this.elevation[k] - CLIMATE_CONSTANTS.referenceElevationM);
  }

  /** Moisture of the fine fuel in cell k now, share of dry mass. */
  fineMoisture(k: number): number {
    const h = airHumidity(this.moisture[k], this.wet, this.hourCos);
    const tree = this.tree[k];
    // Dew settles where the ground sees the open sky; a canopy keeps the ground below it warmer.
    const m = equilibriumMoisture(this.airAt(k), h) + K.shadeMoisture * tree + dewMoisture(h) * (1 - (tree > 1 ? 1 : tree)) + K.fineWetPerMm * this.rainOn(k) + this.carriedWater(k);
    return m > 0.6 ? 0.6 : m;
  }

  /** Moisture of sticks in cell k now: the day's mean equilibrium, a little above, wetted by today's rain. */
  stickMoisture(k: number): number {
    const h = airHumidity(this.moisture[k], this.wet, 0);
    const mean = this.meanRef - CLIMATE_CONSTANTS.lapseRatePerM * (this.elevation[k] - CLIMATE_CONSTANTS.referenceElevationM);
    const m = equilibriumMoisture(mean, h) + K.stickAboveEquilibrium + K.stickWetPerMm * this.rainOn(k);
    return m > 0.6 ? 0.6 : m;
  }

  /** Moisture of poles and trunks in cell k: they follow the soil over weeks, not a day's rain. */
  poleMoisture(k: number): number {
    return K.logMoistureBase + K.logMoisturePerSoil * this.moisture[k];
  }

  /** Curing factor in cell k: green, growing plants hold a fire back. */
  curing(k: number): number {
    const temperature = this.meanRef - CLIMATE_CONSTANTS.lapseRatePerM * (this.elevation[k] - CLIMATE_CONSTANTS.referenceElevationM);
    const warm = clamp01((temperature - K.greenFromC) / (K.greenFullC - K.greenFromC));
    const moist = clamp01((this.moisture[k] - K.greenFromMoisture) / (K.greenFullMoisture - K.greenFromMoisture));
    let live = 0;
    for (let sp = 0; sp < this.covers.length; sp++) live += this.covers[sp][k];
    return curingFactor(1 - warm * moist * this.phenology * (live > 1 ? 1 : live));
  }

  /** Fine fuel in cell k, t/ha. */
  fineTpha(k: number): number {
    return this.litter[k] / 1000 / this.areaHa;
  }

  /** Fill `out` with everything about burning in cell k now. */
  read(k: number, out: FuelReading): void {
    out.fine = this.fineMoisture(k);
    out.sticks = this.stickMoisture(k);
    out.poles = this.poleMoisture(k);
    out.fineTpha = this.fineTpha(k);
    out.curing = this.water[k] === Water.DRY ? this.curing(k) : 0;
    const tree = this.tree[k];
    const windKmh = this.windKmh * (1 - K.canopyWindCut * tree);
    const damp = moistureFactor(out.fine, windKmh);
    const fuel = this.water[k] === Water.DRY ? fuelFactor(out.fineTpha) : 0;
    const dry = moistureFactor(0.05);
    out.readiness = fuel * out.curing * (damp >= dry ? 1 : damp / dry);
    if (out.readiness <= 0) {
      out.readiness = 0;
      out.headMPerMin = 0;
      out.backMPerMin = 0;
      return;
    }
    const base = damp * out.curing * fuel * (1 - K.canopyBedSlowdown * tree);
    const toMPerMin = 1000 / 60;
    out.headMPerMin = openSpreadKmh(windKmh) * base * toMPerMin;
    out.backMPerMin = K.noWindKmh * base * toMPerMin;
  }
}

/** Fire conditions for a simulation, for reading (the viewer, tests, later phases). */
export function fireConditions(sim: Sim): FireConditions {
  const c = new FireConditions(sim);
  c.refresh(sim.state.tick);
  return c;
}

// ---------------------------------------------------------------- stored state

export class FireCounts implements StatePart {
  readonly name = FIRE_PARTS.counts;
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
    if (values.length !== FIELD_COUNT) throw new Error('Snapshot fire counts have the wrong length.');
    this.values.set(values);
  }
}

/**
 * Rain water still held in the fine fuel from earlier days (T-007): the ordinary rain of wet days
 * as one amount for the whole map (times each cell's share of mean rainfall), and each of the last
 * few storms with its place, size and amount. Amounts are in moisture (share of dry mass) as of
 * the tick stamped beside them, and shrink with `wettingLagHours` from then.
 */
export class FireWetting implements StatePart {
  readonly name = FIRE_PARTS.wetting;
  readonly holdsLearned = false;
  /** [day amount, its tick, then per storm: x, y, radius, amount, tick]. */
  readonly values = new Float64Array(2 + 5 * K.wettingStorms);

  readings(): Float64Array {
    return this.values;
  }

  write(sink: Sink): void {
    sink.array(this.values);
  }

  read(source: Source): void {
    const values = source.array('f64');
    if (values.length !== this.values.length) throw new Error('Snapshot fire wetting has the wrong length.');
    this.values.set(values);
  }
}

/** Share of a wetting left `ticks` after it was stamped. */
function wettingLeft(ticks: number, minutesEachTick: number): number {
  return ticks < 0 ? 0 : exp(-(ticks * minutesEachTick) / 60 / K.wettingLagHours);
}

function countsOf(state: SimState): Float64Array {
  return (state.parts.find((p) => p.name === FIRE_PARTS.counts) as FireCounts).values;
}

function cellOf(sim: Sim, x: number, y: number): number {
  const { widthCells: W, heightCells: H, cellSizeM } = sim.config.world;
  let i = Math.floor(x / cellSizeM);
  let j = Math.floor(y / cellSizeM);
  if (i < 0) i = 0;
  else if (i >= W) i = W - 1;
  if (j < 0) j = 0;
  else if (j >= H) j = H - 1;
  return j * W + i;
}

/**
 * Ask for the fine fuel of cell k to be lit. The fire system takes it up on its next run: it
 * flames if the fuel can, smoulders if only wood can, and otherwise goes out.
 */
function requestIgnition(sim: Sim, k: number): void {
  const stage = sim.state.world.layer<Uint8Array>(FIRE_LAYERS.stage);
  if (stage[k] === FireStage.FLAMING) return;
  const store = sim.state.store(FIRE_STORE);
  let slot = -1;
  if (stage[k] === FireStage.SMOULDERING) {
    const cells = store.column<Int32Array>('cell').data;
    for (let s = 0; s < store.highWater; s++) {
      if (store.alive.data[s] === 1 && cells[s] === k) {
        slot = s;
        break;
      }
    }
  }
  if (slot < 0) {
    slot = spawnEntity(sim.state, store);
    store.column<Int32Array>('cell').data[slot] = k;
  }
  store.column<Uint8Array>('fresh').data[slot] = 1;
  stage[k] = FireStage.FLAMING;
}

/** Thickness of a wood object, m. */
function woodThickness(mass: number, length: number): number {
  return thicknessOf(mass, length, materialById(Material.WOOD).densityKgM3);
}

/** Dryness of sticks for catching fire: 1 at 10% moisture or drier, 0 at 30%. */
function stickDryness(moisture: number): number {
  return clamp01((0.3 - moisture) / 0.2);
}

/**
 * A small flame at (x, y) for a moment (a caught spark or an ember): it lights wood objects
 * within reach, thin ones easily, and the fine fuel of the cell with a chance. Returns true if
 * anything caught.
 */
function kindle(sim: Sim, x: number, y: number, readiness: number, conditions: FireConditions, s: Uint32Array, o: number): boolean {
  let caught = false;
  const objects = sim.state.store(OBJECT_STORE);
  if (objects.count > 0) {
    const material = objects.column<Uint8Array>('material').data;
    const ox = objects.column<Float64Array>('x').data;
    const oy = objects.column<Float64Array>('y').data;
    const mass = objects.column<Float32Array>('mass').data;
    const length = objects.column<Float32Array>('length').data;
    const burn = objects.column<Float32Array>('burnKw').data;
    const reach2 = K.kindleReachM * K.kindleReachM;
    const counts = countsOf(sim.state);
    for (let slot = 0; slot < objects.highWater; slot++) {
      if (objects.alive.data[slot] !== 1 || material[slot] !== Material.WOOD || burn[slot] > 0) continue;
      const dx = ox[slot] - x;
      const dy = oy[slot] - y;
      if (dx * dx + dy * dy > reach2) continue;
      const d = woodThickness(mass[slot], length[slot]);
      const p = ((2 * K.catchPerThickness) / (d > 0.001 ? d : 0.001)) * stickDryness(conditions.stickMoisture(cellOf(sim, ox[slot], oy[slot])));
      if (nextFloat(s, o) < p) {
        burn[slot] = 0.1;
        counts[FIRE_FIELDS.objectsCaught] += 1;
        counts[FIRE_FIELDS.burningObjects] += 1;
        caught = true;
      }
    }
  }
  if (nextFloat(s, o) < K.kindleCellChance * readiness) {
    requestIgnition(sim, cellOf(sim, x, y));
    caught = true;
  }
  return caught;
}

/**
 * Hot sparks landing at (x, y), from striking iron sulfide (`strikeObjects` reports how many and
 * how hot). Each may catch the fine fuel on the ground there, if it is dry and cured enough; a
 * spark that catches is a small flame for a moment. Draws from the given stream (the striking
 * body's own). Returns true if anything caught.
 */
// ALIBI: burning particles of iron sulfide land on dry plant matter and set it smouldering; this
// happens wherever such stone is struck, by a rockfall, a hoof, or a hand.
export function sparksAt(sim: Sim, x: number, y: number, sparks: number, heat: number, s: Uint32Array, o: number): boolean {
  if (!(sparks > 0) || !(heat > 0)) return false;
  const conditions = fireConditions(sim);
  const k = cellOf(sim, x, y);
  const reading = emptyReading();
  conditions.read(k, reading);
  const p = K.sparkCatch * (heat > 1 ? 1 : heat) * reading.readiness;
  for (let n = 0; n < sparks; n++) {
    if (nextFloat(s, o) < p) {
      countsOf(sim.state)[FIRE_FIELDS.sparkIgnitions] += 1;
      kindle(sim, x, y, reading.readiness, conditions, s, o);
      return true;
    }
  }
  return false;
}

export interface RubOutcome {
  /** True if the rubbing made a glowing ember. */
  readonly ember: boolean;
  /** True if the ember lit anything (the fine fuel on the ground, or wood within reach). */
  readonly caught: boolean;
  /** Wood ground off as dust, kg. */
  readonly dustKg: number;
}

/**
 * Rub wood object `a` against wood object `b` with `energyJ` of work; `precision` (0 to 1) is how
 * steadily, which concentrates the heat. Friction turns the work into heat in the dust; enough of it,
 * in dry enough wood, makes an ember at `a`, which may light the fine fuel and nearby wood.
 * Draws from the given stream (the rubbing body's own).
 */
// ALIBI: friction turns work into heat, and wood dust heated far enough glows; branches rubbing in
// a wind do the same, more weakly.
export function rubWood(sim: Sim, a: number, b: number, energyJ: number, precision: number, s: Uint32Array, o: number): RubOutcome {
  const objects = sim.state.store(OBJECT_STORE);
  if (a === b || !objects.isAlive(a) || !objects.isAlive(b)) throw new RangeError('rubWood needs two different live objects.');
  const material = objects.column<Uint8Array>('material').data;
  if (material[a] !== Material.WOOD || material[b] !== Material.WOOD) return { ember: false, caught: false, dustKg: 0 };
  if (!(energyJ >= 0) || !(precision >= 0 && precision <= 1)) throw new RangeError('rubWood: bad energy or precision.');
  const mass = objects.column<Float32Array>('mass').data;
  let dust = (K.dustKgPerKj * energyJ) / 1000;
  if (dust > 0.5 * mass[b]) dust = 0.5 * mass[b];
  mass[b] -= dust;
  const x = objects.column<Float64Array>('x').data[a];
  const y = objects.column<Float64Array>('y').data[a];
  const conditions = fireConditions(sim);
  const k = cellOf(sim, x, y);
  const moisture = conditions.stickMoisture(k);
  if (moisture > K.emberMostMoisture) return { ember: false, caught: false, dustKg: dust };
  const wet = moisture > K.emberDryMoisture ? moisture - K.emberDryMoisture : 0;
  const needed = K.emberEnergyJ * (1 + K.emberPerMoisture * wet);
  if (energyJ * precision * precision < needed) return { ember: false, caught: false, dustKg: dust };
  const counts = countsOf(sim.state);
  counts[FIRE_FIELDS.embers] += 1;
  const reading = emptyReading();
  conditions.read(k, reading);
  let caught = false;
  // An ember needs fine dry plant matter around it to grow into a flame.
  if (nextFloat(s, o) < K.emberCatch * reading.readiness) {
    counts[FIRE_FIELDS.emberIgnitions] += 1;
    kindle(sim, x, y, reading.readiness, conditions, s, o);
    caught = true;
  }
  return { ember: true, caught, dustKg: dust };
}

function emptyReading(): FuelReading {
  return { fine: 0, sticks: 0, poles: 0, fineTpha: 0, curing: 0, readiness: 0, headMPerMin: 0, backMPerMin: 0 };
}

// ---------------------------------------------------------------- fires as points: light, heat, and keeping away

/**
 * Every fire as a point with its heat: burning cells at their centres, then burning objects.
 * A derived cache, rebuilt at most once a tick and never saved.
 */
export class FirePoints {
  private readonly sim: Sim;
  x = new Float64Array(64);
  y = new Float64Array(64);
  kw = new Float64Array(64);
  /** 1 for a burning cell, 0 for a burning object. */
  isCell = new Uint8Array(64);
  count = 0;
  private live = new Uint8Array(64);
  private readonly grid: BucketGrid;
  private builtTick = -1;
  private builtFires = -1;
  private builtObjects = -1;

  constructor(sim: Sim) {
    this.sim = sim;
    const { widthCells: W, heightCells: H, cellSizeM } = sim.config.world;
    this.grid = new BucketGrid(W * cellSizeM, H * cellSizeM, 500);
  }

  private push(x: number, y: number, kw: number, cell: number): void {
    if (this.count === this.x.length) {
      const n = this.x.length * 2;
      const grow = <T extends Float64Array | Uint8Array>(a: T, make: (n: number) => T): T => {
        const b = make(n);
        b.set(a);
        return b;
      };
      this.x = grow(this.x, (m) => new Float64Array(m));
      this.y = grow(this.y, (m) => new Float64Array(m));
      this.kw = grow(this.kw, (m) => new Float64Array(m));
      this.isCell = grow(this.isCell, (m) => new Uint8Array(m));
      this.live = new Uint8Array(n);
    }
    this.x[this.count] = x;
    this.y[this.count] = y;
    this.kw[this.count] = kw;
    this.isCell[this.count] = cell;
    this.count++;
  }

  /** Bring the points up to date with the simulation; returns how many fires there are. */
  refresh(): number {
    const { state, config } = this.sim;
    const fires = state.stores.find((st) => st.name === FIRE_STORE);
    const objects = state.stores.find((st) => st.name === OBJECT_STORE);
    const fireCount = fires ? fires.count : 0;
    const burning = objects && objects.hasColumn('burnKw') ? countsOf(state)[FIRE_FIELDS.burningObjects] : 0;
    if (state.tick === this.builtTick && fireCount === this.builtFires && burning === this.builtObjects) return this.count;
    this.builtTick = state.tick;
    this.builtFires = fireCount;
    this.builtObjects = burning;
    this.count = 0;
    const W = config.world.widthCells;
    const cs = config.world.cellSizeM;
    if (fires && fires.count > 0) {
      const cell = fires.column<Int32Array>('cell').data;
      const heat = fires.column<Float32Array>('heat').data;
      for (let s = 0; s < fires.highWater; s++) {
        if (fires.alive.data[s] !== 1 || !(heat[s] > 0)) continue;
        const k = cell[s];
        const i = k % W;
        this.push((i + 0.5) * cs, ((k - i) / W + 0.5) * cs, heat[s], 1);
      }
    }
    if (objects && burning > 0) {
      const burn = objects.column<Float32Array>('burnKw').data;
      const ox = objects.column<Float64Array>('x').data;
      const oy = objects.column<Float64Array>('y').data;
      for (let s = 0; s < objects.highWater; s++) {
        if (objects.alive.data[s] === 1 && burn[s] > 0) this.push(ox[s], oy[s], burn[s], 0);
      }
    }
    if (this.count > 0) {
      if (this.live.length < this.count) this.live = new Uint8Array(this.x.length);
      this.live.fill(1, 0, this.count);
      this.grid.build(this.x, this.y, this.live, this.count);
    }
    return this.count;
  }

  /**
   * The point of a fire of at least `minKw` that (x, y) is too close to by the distance animals
   * keep (`avoidDistanceM`), or -1. A burning cell is a square, so its distance counts from its edge.
   */
  tooClose(x: number, y: number, minKw: number): number {
    if (this.count === 0) return -1;
    const half = this.sim.config.world.cellSizeM / 2;
    const n = this.grid.query(x, y, 400 + half, this.x, this.y);
    let best = -1;
    let bestGap = 0;
    for (let q = 0; q < n; q++) {
      const p = this.grid.result[q];
      if (this.kw[p] < minKw) continue;
      const dx = this.x[p] - x;
      const dy = this.y[p] - y;
      const d = Math.sqrt(dx * dx + dy * dy) - (this.isCell[p] === 1 ? half : 0);
      const gap = avoidDistanceM(this.kw[p]) - d;
      if (gap > bestGap || (gap > 0 && gap === bestGap && p < best)) {
        bestGap = gap;
        best = p;
      }
    }
    return best;
  }

  /** Light (share of full sun) and radiant heat (W/m²) at (x, y) from every fire, into `out`. */
  lightAndHeat(x: number, y: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    if (this.count === 0) return;
    const half = this.sim.config.world.cellSizeM / 2;
    const n = this.grid.query(x, y, K.cellReachM, this.x, this.y);
    for (let q = 0; q < n; q++) {
      const p = this.grid.result[q];
      const dx = this.x[p] - x;
      const dy = this.y[p] - y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (this.isCell[p] === 1) {
        // Inside a burning cell the fire is all around: count it from a little way off.
        d = d < half / 5 ? half / 5 : d;
      } else {
        if (d > K.objectReachM) continue;
        d = d < 0.5 ? 0.5 : d;
      }
      out[0] += fireLight(this.kw[p], d);
      out[1] += (K.radiantShare * this.kw[p] * 1000) / (4 * Math.PI * d * d);
    }
    if (out[0] > 1) out[0] = 1;
  }
}

export interface FireProbe {
  /** Light from fires at (x, y) as a share of full sun (add it to the ambient light, §2.4), and radiant heat in W/m², into `out`. */
  at(x: number, y: number, out: Float64Array): void;
}

// ALIBI: a fire glows and radiates heat whether or not anything is near it.
/** A reusable query of fire light and heat for one simulation. It never writes state. */
export function createFireProbe(sim: Sim): FireProbe {
  const points = new FirePoints(sim);
  return {
    at(x: number, y: number, out: Float64Array): void {
      points.refresh();
      points.lightAndHeat(x, y, out);
    },
  };
}

// ---------------------------------------------------------------- the system

// ALIBI: lightning sets dry plant matter alight, and fire spreads through dry fuel with the wind and
// up slopes, smoulders in wood, and dies in rain or when the fuel is gone, with or without anyone
// near. Burning wood stays alight for a while wherever it is.
export const fire: SystemDef = defineSystem({
  name: 'world.fire',
  declare(state: SimState) {
    const store = state.addStore(FIRE_STORE);
    store.ensureColumn({ name: 'cell', dtype: 'i32', category: 'identity' });
    store.ensureColumn({ name: 'flameLeft', dtype: 'f32', category: 'body' });
    // Minutes this cell has flamed since it last started, and how vigorously it burns (scales its spread).
    store.ensureColumn({ name: 'age', dtype: 'f32', category: 'body' });
    store.ensureColumn({ name: 'vigour', dtype: 'f32', category: 'body' });
    store.ensureColumn({ name: 'heat', dtype: 'f32', category: 'body' });
    // Set when something outside the fire system lit the cell; taken up on the system's next run.
    store.ensureColumn({ name: 'fresh', dtype: 'u8', category: 'body' });
    state.store(OBJECT_STORE).ensureColumn({ name: 'burnKw', dtype: 'f32', category: 'body' });
    state.addPart(new FireCounts());
    state.addPart(new FireWetting());
    const world = state.world;
    world.ensureLayer(FIRE_LAYERS.stage, 'u8');
    world.ensureLayer(FIRE_LAYERS.lastBurnDay, 'f32');
    world.ensureLayer(MATERIAL_LAYERS.litter, 'f32');
    world.ensureLayer(FORAGE_LAYER, 'f32');
    world.ensureLayer(BROWSE_LAYER, 'f32');
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
    const N = W * H;
    const areaHa = (cs * cs) / 10_000;
    const tickMinutes = minutesPerTick(config);
    const ticksPerHour = Math.max(1, Math.round(60 / tickMinutes));
    const hoursPerTick = tickMinutes / 60;
    const ticksPerDay = config.time.ticksPerDay;
    const world = state.world;
    const stage = world.layer<Uint8Array>(FIRE_LAYERS.stage);
    const lastBurn = world.layer<Float32Array>(FIRE_LAYERS.lastBurnDay);
    const water = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const litter = world.layer<Float32Array>(MATERIAL_LAYERS.litter);
    const small = world.layer<Float32Array>(MATERIAL_LAYERS.smallWood);
    const long = world.layer<Float32Array>(MATERIAL_LAYERS.longWood);
    const forage = world.layer<Float32Array>(FORAGE_LAYER);
    const browse = world.layer<Float32Array>(BROWSE_LAYER);
    const cover = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
    const food = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(foodLayer(sp)));
    const topKill = PLANT_SPECIES.map((sp) => (FIRE_PLANT_RESPONSE[sp.name] ?? { topKill: 0.3 }).topKill);
    const foodBurnt = PLANT_SPECIES.map((sp) => (FIRE_PLANT_RESPONSE[sp.name] ?? { foodBurnt: 0.5 }).foodBurnt);
    const woodKjPerKg = materialById(Material.WOOD).fuelMJPerKg * 1000;
    const fires = state.store(FIRE_STORE);
    const objects = state.store(OBJECT_STORE);
    const counts = countsOf(state);
    const strikes = state.parts.find((p) => p.name === CLIMATE_PARTS.strikes);
    if (!strikes || !strikes.readings) throw new Error('world.fire needs world.climate earlier in the pipeline.');
    const strikeReadings = strikes.readings.bind(strikes);
    const strikeCells = (): ArrayLike<number> => strikeReadings();
    const s = state.streams;
    const o = globalStreamOffset(StreamDomain.FIRE);
    const random = (): number => nextFloat(s, o);
    const conditions = new FireConditions(sim);
    const dryDamp = moistureFactor(0.05);

    // The eight neighbours: offsets, distances, and unit directions.
    const DI = [1, 1, 0, -1, -1, -1, 0, 1];
    const DJ = [0, 1, 1, 1, 0, -1, -1, -1];
    const DIST = DI.map((di, n) => (di !== 0 && DJ[n] !== 0 ? cs * Math.SQRT2 : cs));
    const UX = DI.map((di, n) => di / Math.sqrt(di * di + DJ[n] * DJ[n]));
    const UY = DJ.map((dj, n) => dj / Math.sqrt(DI[n] * DI[n] + dj * dj));
    const toward = new Float64Array(8);

    // Derived caches, allocated on the first fire and never saved (§1.5).
    let scratch = false;
    let slotOfCell = new Int32Array(0);
    let evalTick = new Int32Array(0);
    let headRate = new Float32Array(0);
    let backRate = new Float32Array(0);
    let readyAt = new Float32Array(0);
    let startAt = new Float32Array(256);
    let heapT = new Float64Array(256);
    let heapC = new Int32Array(256);
    let heapSize = 0;
    let popT = 0;
    let popC = 0;
    /** Length-to-breadth ratio of fires under this tick's wind. */
    let currentLb = 1;
    const reading = emptyReading();
    let objectGrid: BucketGrid | null = null;
    let objectMask = new Uint8Array(256);

    function ensureScratch(): void {
      if (scratch) return;
      scratch = true;
      slotOfCell = new Int32Array(N).fill(-1);
      evalTick = new Int32Array(N).fill(-1);
      headRate = new Float32Array(N);
      backRate = new Float32Array(N);
      readyAt = new Float32Array(N);
    }

    /** Spread rates and readiness of cell k for this tick, computed once a tick. */
    function evaluate(k: number, tick: number): void {
      if (evalTick[k] === tick) return;
      evalTick[k] = tick;
      if (water[k] !== Water.DRY) {
        headRate[k] = 0;
        backRate[k] = 0;
        readyAt[k] = 0;
        return;
      }
      conditions.read(k, reading);
      headRate[k] = reading.headMPerMin;
      backRate[k] = reading.backMPerMin;
      readyAt[k] = reading.readiness;
    }

    /** Room in the per-slot scratch of start times for `slot`. */
    function fitBurned(slot: number): void {
      if (startAt.length > slot) return;
      let n = startAt.length;
      while (n <= slot) n *= 2;
      const bigger = new Float32Array(n);
      bigger.set(startAt);
      startAt = bigger;
    }

    /** Chance this tick that rain puts out a smouldering cell k: a storm by its rate, a wet day by its total. */
    function rainOutChance(k: number, perMmPerHour: number, most: number): number {
      const storm = perMmPerHour * conditions.stormRateNow(k);
      let day = K.wetDayOutPerMm * conditions.dayRainOn(k);
      if (day > K.wetDayOutMost) day = K.wetDayOutMost;
      return (storm < most ? storm : most) + day / ticksPerDay;
    }

    function woodKg(k: number): number {
      return small[k] + long[k];
    }

    function rebuildSlotMap(): void {
      const cell = fires.column<Int32Array>('cell').data;
      for (let slot = 0; slot < fires.highWater; slot++) {
        if (fires.alive.data[slot] === 1) slotOfCell[cell[slot]] = slot;
      }
    }

    function removeFire(slot: number): void {
      const k = fires.column<Int32Array>('cell').data[slot];
      stage[k] = FireStage.NONE;
      slotOfCell[k] = -1;
      fires.remove(slot);
    }

    /** Plants, food and forage in cell k as a front of the given intensity (kW/m) passes. */
    function burnPlants(k: number, intensityKwPerM: number): void {
      const severity = intensityKwPerM / (intensityKwPerM + K.severityHalfKwPerM);
      for (let sp = 0; sp < cover.length; sp++) {
        cover[sp][k] *= 1 - topKill[sp] * severity;
        food[sp][k] *= 1 - foodBurnt[sp];
      }
      forage[k] *= 1 - K.forageBurnt;
      browse[k] *= 1 - K.browseBurnt * severity;
    }

    /**
     * Start cell k flaming if its fine fuel can carry flame now; returns false if it can't. It
     * flames until the fire has left it in every direction: 1.5 cell widths ÷ its slowest rate.
     */
    function flame(k: number, tick: number): boolean {
      evaluate(k, tick);
      if (!(headRate[k] > 0) || !(backRate[k] > 0)) return false;
      let slot = slotOfCell[k];
      if (slot < 0) {
        slot = spawnEntity(state, fires);
        fires.column<Int32Array>('cell').data[slot] = k;
        slotOfCell[k] = slot;
      }
      const backing = headRate[k] * shareOfHead(-1, currentLb);
      let minutes = (1.5 * cs) / (backing > backRate[k] ? backing : backRate[k]);
      minutes = minutes < K.flameLeastMinutes ? K.flameLeastMinutes : minutes > K.flameMostMinutes ? K.flameMostMinutes : minutes;
      fires.column<Float32Array>('flameLeft').data[slot] = minutes;
      fires.column<Float32Array>('age').data[slot] = 0;
      fires.column<Float32Array>('vigour').data[slot] = K.vigourLeast + (K.vigourMost - K.vigourLeast) * random();
      fires.column<Uint8Array>('fresh').data[slot] = 0;
      stage[k] = FireStage.FLAMING;
      lastBurn[k] = dayIndex(config, tick) + 1;
      counts[FIRE_FIELDS.cellsIgnited] += 1;
      // Byram's fireline intensity: heat of burning × fine fuel per m² × head rate (m/s).
      const fuelPerM2 = litter[k] / (cs * cs);
      burnPlants(k, K.litterKjPerKg * fuelPerM2 * (headRate[k] / 60));
      return true;
    }

    /** Cell k smoulders in its wood, if it has enough; returns false if not. */
    function smoulder(k: number): boolean {
      if (woodKg(k) < K.smoulderLeastKg) return false;
      let slot = slotOfCell[k];
      if (slot < 0) {
        slot = spawnEntity(state, fires);
        fires.column<Int32Array>('cell').data[slot] = k;
        slotOfCell[k] = slot;
      }
      fires.column<Float32Array>('flameLeft').data[slot] = 0;
      fires.column<Uint8Array>('fresh').data[slot] = 0;
      stage[k] = FireStage.SMOULDERING;
      return true;
    }

    /** Flaming in the cell of `slot` stops: it smoulders on if it has wood, otherwise it is out. */
    function stopFlaming(slot: number): void {
      const k = fires.column<Int32Array>('cell').data[slot];
      if (!smoulder(k)) removeFire(slot);
    }

    function lightning(tick: number): void {
      const cells = strikeCells();
      for (let n = 0; n < cells.length; n++) {
        const k = cells[n];
        if (water[k] !== Water.DRY || stage[k] === FireStage.FLAMING) continue;
        evaluate(k, tick);
        const woodT = woodKg(k) / 1000 / areaHa;
        const dryPoles = clamp01((K.strikeWetMoisture - conditions.poleMoisture(k)) / (K.strikeWetMoisture - K.strikeDryMoisture));
        const pWood = K.strikeChance * clamp01(woodT / K.strikeWoodFullTpha) * dryPoles;
        const pFine = K.strikeChance * readyAt[k];
        const p = 1 - (1 - pWood) * (1 - pFine);
        if (!(random() < p)) continue;
        if (flame(k, tick)) {
          counts[FIRE_FIELDS.lightningIgnitions] += 1;
        } else if (stage[k] === FireStage.NONE && smoulder(k)) {
          counts[FIRE_FIELDS.lightningIgnitions] += 1;
          counts[FIRE_FIELDS.holdovers] += 1;
        }
      }
    }

    /** Push a candidate arrival of the fire at cell `b`, `t` minutes into the tick. */
    function heapPush(t: number, b: number): void {
      if (heapSize === heapT.length) {
        const biggerT = new Float64Array(heapT.length * 2);
        biggerT.set(heapT);
        heapT = biggerT;
        const biggerC = new Int32Array(heapC.length * 2);
        biggerC.set(heapC);
        heapC = biggerC;
      }
      let n = heapSize++;
      while (n > 0) {
        const up = (n - 1) >> 1;
        if (heapT[up] < t || (heapT[up] === t && heapC[up] < b)) break;
        heapT[n] = heapT[up];
        heapC[n] = heapC[up];
        n = up;
      }
      heapT[n] = t;
      heapC[n] = b;
    }

    /** Remove the earliest candidate (ties go to the lower cell) into popT and popC. */
    function heapPop(): void {
      popT = heapT[0];
      popC = heapC[0];
      const t = heapT[--heapSize];
      const c = heapC[heapSize];
      let n = 0;
      for (;;) {
        let child = 2 * n + 1;
        if (child >= heapSize) break;
        if (child + 1 < heapSize && (heapT[child + 1] < heapT[child] || (heapT[child + 1] === heapT[child] && heapC[child + 1] < heapC[child]))) child++;
        if (t < heapT[child] || (t === heapT[child] && c < heapC[child])) break;
        heapT[n] = heapT[child];
        heapC[n] = heapC[child];
        n = child;
      }
      heapT[n] = t;
      heapC[n] = c;
    }

    /**
     * The fire in cell a (flaming in `slot`, started `startedAt` minutes into this tick, negative if
     * before it) reaches each neighbour one distance ÷ the rate toward it later. Arrivals within this
     * tick, and while a still flames, become candidates.
     */
    function reachNeighbours(slot: number, a: number, startedAt: number, tick: number): void {
      const i = a % W;
      const j = (a - i) / W;
      const vigour = fires.column<Float32Array>('vigour').data[slot];
      // It flames until `flameLeft` minutes after the later of its start and the start of the tick.
      const until = (startedAt > 0 ? startedAt : 0) + fires.column<Float32Array>('flameLeft').data[slot];
      for (let n = 0; n < 8; n++) {
        const ni = i + DI[n];
        const nj = j + DJ[n];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const b = nj * W + ni;
        if (stage[b] === FireStage.FLAMING || water[b] !== Water.DRY) continue;
        // A diagonal step that would pass between water cells would have to cross the water.
        if (DI[n] !== 0 && DJ[n] !== 0 && (water[j * W + ni] !== Water.DRY || water[nj * W + i] !== Water.DRY)) continue;
        evaluate(b, tick);
        if (!(headRate[b] > 0)) continue;
        const along = headRate[b] * toward[n];
        const rate = (along > backRate[b] ? along : backRate[b]) * slopeFactor((elevation[b] - elevation[a]) / DIST[n]) * vigour;
        let arrival = startedAt + DIST[n] / rate;
        if (arrival < 0) arrival = 0;
        if (arrival < tickMinutes && arrival <= until) heapPush(arrival, b);
      }
    }

    function cellFires(tick: number): void {
      const cellCol = fires.column<Int32Array>('cell').data;
      const fresh = fires.column<Uint8Array>('fresh').data;
      // Fires lit from outside since the last run, and flaming cells under this tick's weather.
      for (let slot = 0; slot < fires.highWater; slot++) {
        if (fires.alive.data[slot] !== 1) continue;
        const k = cellCol[slot];
        if (fresh[slot] === 1) {
          stage[k] = FireStage.NONE;
          if (!flame(k, tick)) {
            if (!smoulder(k)) removeFire(slot);
          }
        } else if (stage[k] === FireStage.FLAMING) {
          evaluate(k, tick);
          if (!(headRate[k] > 0)) stopFlaming(slot);
        }
      }
      fitBurned(fires.highWater);
      startAt.fill(0);

      // Spread by minimum travel time: each neighbour starts burning when the fire, travelling at the
      // rate toward it, gets there. Arrivals are taken in time order within the tick.
      for (let n = 0; n < 8; n++) toward[n] = shareOfHead(UX[n] * conditions.windUx + UY[n] * conditions.windUy, currentLb);
      heapSize = 0;
      for (let slot = 0; slot < fires.highWater; slot++) {
        if (fires.alive.data[slot] !== 1) continue;
        const a = fires.column<Int32Array>('cell').data[slot];
        if (stage[a] === FireStage.FLAMING) reachNeighbours(slot, a, -fires.column<Float32Array>('age').data[slot], tick);
      }
      while (heapSize > 0) {
        heapPop();
        const b = popC;
        const t = popT;
        if (stage[b] === FireStage.FLAMING || !flame(b, tick)) continue;
        const slot = slotOfCell[b];
        fitBurned(slot);
        startAt[slot] = t;
        reachNeighbours(slot, b, t, tick);
      }

      // Burn the fuel: fine fuel and some sticks in the flames, wood while smouldering.
      for (let slot = 0; slot < fires.highWater; slot++) {
        if (fires.alive.data[slot] !== 1) continue;
        const k = fires.column<Int32Array>('cell').data[slot];
        const heat = fires.column<Float32Array>('heat').data;
        const left = fires.column<Float32Array>('flameLeft').data;
        if (stage[k] === FireStage.FLAMING) {
          // Minutes of flame this tick: from when it started (0 if before the tick) to the end of the tick or of its flame.
          const before = left[slot] > 0 ? left[slot] : 0;
          let burned = tickMinutes - startAt[slot];
          if (burned > before) burned = before;
          const share = before > 0 ? burned / before : 1;
          left[slot] = before - burned;
          fires.column<Float32Array>('age').data[slot] += burned;
          const fine = litter[k] * share * (1 - K.litterLeft);
          const sticks = small[k] * share * K.sticksInFlames;
          litter[k] -= fine;
          small[k] -= sticks;
          const kw = (fine * K.litterKjPerKg + sticks * woodKjPerKg) / (tickMinutes * 60);
          heat[slot] = kw > 0.1 ? kw : 0.1;
          if (!(left[slot] > 0)) stopFlaming(slot);
          continue;
        }
        // Smouldering.
        const poles = conditions.poleMoisture(k);
        const dry = clamp01((K.smoulderWetMoisture - poles) / (K.smoulderWetMoisture - K.smoulderDryMoisture));
        const rainOut = rainOutChance(k, K.rainOutPerMmPerHour, K.rainOutMost);
        if (dry <= 0 || random() < rainOut + K.smoulderOutPerHour * hoursPerTick) {
          removeFire(slot);
          continue;
        }
        const sticks = small[k] * K.smoulderSticksPerHour * hoursPerTick * dry;
        const logs = long[k] * K.smoulderPolesPerHour * hoursPerTick * dry;
        small[k] -= sticks;
        long[k] -= logs;
        heat[slot] = ((sticks + logs) * woodKjPerKg) / (tickMinutes * 60);
        if (woodKg(k) < K.smoulderLeastKg) {
          removeFire(slot);
          continue;
        }
        // Once an hour, dry cured fine fuel around the embers may burst into flame.
        if ((tick + k) % ticksPerHour === 0) {
          evaluate(k, tick);
          if (headRate[k] > 0) {
            const damp = moistureFactor(conditions.fineMoisture(k));
            if (random() < K.flarePerHour * (damp >= dryDamp ? 1 : damp / dryDamp) && flame(k, tick)) counts[FIRE_FIELDS.flareUps] += 1;
          }
        }
      }
    }

    function objectFires(tick: number): void {
      const material = objects.column<Uint8Array>('material').data;
      const ox = objects.column<Float64Array>('x').data;
      const oy = objects.column<Float64Array>('y').data;
      const mass = objects.column<Float32Array>('mass').data;
      const length = objects.column<Float32Array>('length').data;
      const holder = objects.column<Uint32Array>('holder').data;
      const integrity = objects.column<Float32Array>('integrity').data;
      const burn = objects.column<Float32Array>('burnKw').data;
      const high = objects.highWater;
      // Which pieces were burning as the tick began.
      if (objectMask.length < high) {
        let n = objectMask.length;
        while (n < high) n *= 2;
        objectMask = new Uint8Array(n);
      }
      let burningAtStart = 0;
      for (let slot = 0; slot < high; slot++) {
        const on = objects.alive.data[slot] === 1 && burn[slot] > 0 ? 1 : 0;
        objectMask[slot] = on;
        burningAtStart += on;
      }
      if (burningAtStart > 0) {
        if (!objectGrid) objectGrid = new BucketGrid(W * cs, H * cs, cs);
        objectGrid.build(ox, oy, objectMask, high);
      }
      const reach = K.pileReachM;
      let burning = 0;
      for (let slot = 0; slot < high; slot++) {
        if (objects.alive.data[slot] !== 1) continue;
        const k = cellOf(sim, ox[slot], oy[slot]);
        const id = material[slot];
        if (id === Material.HIDE) {
          if (stage[k] === FireStage.FLAMING && holder[slot] === 0) {
            integrity[slot] -= K.hideScorch;
            if (!(integrity[slot] > 0)) objects.remove(slot);
          }
          continue;
        }
        if (id !== Material.WOOD) continue;
        const thick = woodThickness(mass[slot], length[slot]);
        if (objectMask[slot] === 1) {
          // Burning: count the other burning pieces close by.
          let others = 0;
          if (objectGrid) {
            const n = objectGrid.query(ox[slot], oy[slot], reach, ox, oy);
            for (let q = 0; q < n; q++) if (objectGrid.result[q] !== slot) others++;
          }
          const r = thick / 2;
          const r2 = r - (others >= K.pileOthers ? K.burnPileMPerMin : K.burnAloneMPerMin) * tickMinutes;
          if (r2 <= K.burntOutRadiusM) {
            objects.remove(slot);
            continue;
          }
          const left = mass[slot] * (r2 / r) * (r2 / r);
          const kw = ((mass[slot] - left) * woodKjPerKg) / (tickMinutes * 60);
          mass[slot] = left;
          burn[slot] = kw > 0.1 ? kw : 0.1;
          const inFlames = stage[k] === FireStage.FLAMING;
          let out = others === 0 && !inFlames && thick > K.loneOutThicknessM && random() < K.loneOutChance;
          const dayP = K.rainOutObjectPerMm * conditions.dayRainOn(k);
          const rainP = conditions.stormRateNow(k) > 0 ? K.stormOutObject : dayP < K.rainOutObjectMost ? dayP : K.rainOutObjectMost;
          if (!out && rainP > 0 && random() < rainP) out = true;
          if (out) {
            burn[slot] = 0;
            continue;
          }
          burning++;
          // A burning piece lying on the ground may light the fine fuel around it.
          if (holder[slot] === 0 && stage[k] !== FireStage.FLAMING) {
            evaluate(k, tick);
            const heatShare = burn[slot] / K.escapeRefKw;
            if (headRate[k] > 0 && random() < K.escapeChance * readyAt[k] * (heatShare > 1 ? 1 : heatShare)) {
              requestIgnition(sim, k);
              counts[FIRE_FIELDS.objectIgnitions] += 1;
            }
          }
          continue;
        }
        // Not burning: wood catches from flames in its cell or from burning pieces within reach.
        const d = thick > 0.001 ? thick : 0.001;
        let p = 0;
        if (stage[k] === FireStage.FLAMING) {
          p = (2 * K.catchPerThickness) / d;
        } else if (objectGrid && burningAtStart > 0) {
          const n = objectGrid.query(ox[slot], oy[slot], reach, ox, oy);
          if (n > 0) p = (K.catchPerThickness / d) * stickDryness(conditions.stickMoisture(k));
        }
        if (p > 0 && random() < p) {
          burn[slot] = 0.1;
          counts[FIRE_FIELDS.objectsCaught] += 1;
          burning++;
        }
      }
      counts[FIRE_FIELDS.burningObjects] = burning;
    }

    const wetting = (state.parts.find((p) => p.name === FIRE_PARTS.wetting) as FireWetting).values;
    const weatherPart = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weatherPart || !weatherPart.readings) throw new Error('world.fire needs world.climate earlier in the pipeline.');
    const weather = weatherPart.readings();

    /** At the end of each day, today's rain joins the water the fine fuel carries into the next days. */
    function carryRain(tick: number): void {
      const end = tick + 1;
      if (weather[CLIMATE_FIELDS.wetToday] === 1 && weather[CLIMATE_FIELDS.rainTodayMm] > 0) {
        wetting[0] = wetting[0] * wettingLeft(end - wetting[1], tickMinutes) + K.fineWetPerMm * weather[CLIMATE_FIELDS.rainTodayMm];
        wetting[1] = end;
      }
      const start = weather[CLIMATE_FIELDS.stormStart];
      if (start >= 0 && start <= tick && weather[CLIMATE_FIELDS.stormRainMm] > 0) {
        // Replace the storm with the least water left.
        let slot = 0;
        let least = Infinity;
        for (let n = 0; n < K.wettingStorms; n++) {
          const o = 2 + 5 * n;
          const left = wetting[o + 3] * wettingLeft(end - wetting[o + 4], tickMinutes);
          if (left < least) {
            least = left;
            slot = n;
          }
        }
        const o = 2 + 5 * slot;
        wetting[o] = weather[CLIMATE_FIELDS.stormX];
        wetting[o + 1] = weather[CLIMATE_FIELDS.stormY];
        wetting[o + 2] = weather[CLIMATE_FIELDS.stormRadiusM];
        wetting[o + 3] = K.fineWetPerMm * weather[CLIMATE_FIELDS.stormRainMm];
        wetting[o + 4] = end;
      }
    }

    function burn(tick: number): void {
      const struck = strikeCells().length > 0;
      const anyObjects = objects.count > 0 && counts[FIRE_FIELDS.burningObjects] > 0;
      if (!struck && fires.count === 0 && !anyObjects) return;
      ensureScratch();
      conditions.refresh(tick);
      currentLb = lengthToBreadth(conditions.windKmh);
      if (fires.count > 0) rebuildSlotMap();
      if (struck) lightning(tick);
      if (fires.count > 0) cellFires(tick);
      if (objects.count > 0 && (counts[FIRE_FIELDS.burningObjects] > 0 || fires.count > 0)) objectFires(tick);
    }

    return () => {
      const tick = state.tick;
      burn(tick);
      if (tick % ticksPerDay === ticksPerDay - 1) carryRain(tick);
    };
  },
});
