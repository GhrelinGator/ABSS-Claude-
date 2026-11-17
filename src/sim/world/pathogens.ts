// Pathogens in water and rotting meat: real causes agents can't see (docs/DESIGN.md §2.7, §2.14).

import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import type { Sim, SimState } from '../sim.ts';
import { CARCASS_LAYER, CARCASS_LOAD_LAYER } from './animals.ts';
import { CLIMATE_CONSTANTS, CLIMATE_PARTS, dailyMeanTemperatureC } from './climate.ts';
import { TERRAIN_LAYERS, Water } from './terrain.ts';

export const WATER_PATHOGEN_LAYER = 'water.pathogen';

export const PATHOGEN_CONSTANTS = {
  /** Load that drifts into every water cell each day. */
  inflowPerDay: 0.002,
  /** Load added per day per kg of carcass meat in or next to a water cell. */
  perCarcassKgPerDay: 0.002,
  /** Lakes: growth per day at full warmth, the temperature where growth starts, and where it peaks. */
  lakeGrowthPerDay: 0.3,
  lakeGrowthFromC: 8,
  lakeGrowthFullAtC: 23,
  /** Lakes: share of load that dies off each day. */
  lakeDecayPerDay: 0.05,
  /** Share of load flushed away each day: rivers, and springs (which also get half the input). */
  riverFlushPerDay: 0.6,
  springFlushPerDay: 0.8,
  /** Carcass meat: load gained per degree-day above `meatGrowthFromC`. */
  meatPerDegreeDay: 0.015,
  meatGrowthFromC: 4,
  /** Lakes start the run at this load. */
  lakeStart: 0.05,
} as const;
const P = PATHOGEN_CONSTANTS;

// ALIBI: microbes multiply in warm standing water and in dead flesh, and running water carries
// them away, whether or not anything ever drinks or eats there.
export const pathogens: SystemDef = defineSystem({
  name: 'world.pathogens',
  declare(state: SimState) {
    state.world.ensureLayer(WATER_PATHOGEN_LAYER, 'f32');
    state.world.ensureLayer(CARCASS_LOAD_LAYER, 'f32');
    state.world.ensureLayer(CARCASS_LAYER, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.waterKind, 'u8');
    state.world.ensureLayer(TERRAIN_LAYERS.elevation, 'f32');
  },
  init(sim: Sim) {
    const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    const load = sim.state.world.layer<Float32Array>(WATER_PATHOGEN_LAYER);
    for (let k = 0; k < kind.length; k++) load[k] = kind[k] === Water.LAKE ? P.lakeStart : 0;
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const { widthCells: W, heightCells: H } = config.world;
    const N = W * H;
    const ticksPerDay = config.time.ticksPerDay;
    const world = state.world;
    const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const water = world.layer<Float32Array>(WATER_PATHOGEN_LAYER);
    const meat = world.layer<Float32Array>(CARCASS_LAYER);
    const meatLoad = world.layer<Float32Array>(CARCASS_LOAD_LAYER);
    const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weather || !weather.readings) throw new Error('world.pathogens needs world.climate earlier in the pipeline.');
    const weatherValues = weather.readings();
    const lapse = CLIMATE_CONSTANTS.lapseRatePerM;
    const reference = CLIMATE_CONSTANTS.referenceElevationM;
    const growthSpan = P.lakeGrowthFullAtC - P.lakeGrowthFromC;

    /** Carcass meat in the 3 × 3 cells around k, kg. */
    function meatAround(k: number): number {
      const i0 = k % W;
      const j0 = (k - i0) / W;
      let total = 0;
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        if (j < 0 || j >= H) continue;
        for (let i = i0 - 1; i <= i0 + 1; i++) if (i >= 0 && i < W) total += meat[j * W + i];
      }
      return total;
    }

    return () => {
      const tick = state.tick;
      if (tick % ticksPerDay !== 0) return;
      const atReference = dailyMeanTemperatureC(config, tick, weatherValues, reference);
      for (let k = 0; k < N; k++) {
        const temperature = atReference - lapse * (elevation[k] - reference);
        // Rotting meat.
        if (meat[k] <= 0) {
          if (meatLoad[k] !== 0) meatLoad[k] = 0;
        } else if (temperature > P.meatGrowthFromC) {
          const l = meatLoad[k] + P.meatPerDegreeDay * (temperature - P.meatGrowthFromC);
          meatLoad[k] = l < 1 ? l : 1;
        }
        // Water.
        const w = kind[k];
        if (w === Water.DRY) continue;
        let l = water[k];
        const input = P.inflowPerDay + P.perCarcassKgPerDay * meatAround(k);
        if (w === Water.LAKE) {
          let warmth = (temperature - P.lakeGrowthFromC) / growthSpan;
          if (warmth < 0) warmth = 0;
          else if (warmth > 1) warmth = 1;
          l += input + P.lakeGrowthPerDay * warmth * l * (1 - l) - P.lakeDecayPerDay * l;
        } else if (w === Water.RIVER) {
          l = l * (1 - P.riverFlushPerDay) + input;
        } else {
          l = l * (1 - P.springFlushPerDay) + input / 2;
        }
        water[k] = l < 0 ? 0 : l > 1 ? 1 : l;
      }
    };
  },
});
