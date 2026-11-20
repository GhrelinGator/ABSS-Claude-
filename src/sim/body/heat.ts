// Heat and water: a body's temperature, what holding it costs in shivering and
// sweat, the body's water, and death by dehydration, heat, or cold
// (docs/DESIGN.md §3.2, §3.9).
//
// What the body is in (air, sky, sun, wind, rain, fire, hides, other bodies
// against it) arrives in the surroundings columns, written each tick by
// body.exposure (exposure.ts) or by a test fixture. This system only does the
// body's physics; it never reads the world.

import { ticksPerYear } from '../core/clock.ts';
import { exp, pow } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sim, SimState } from '../sim.ts';
import { BODY_COLUMNS, DeathCause, Effort, METABOLISM, Sex, basalKcalPerDay, deathDoor, fatKgOf } from './metabolism.ts';

export const HEAT = {
  /** Core temperature a body starts at and returns to, °C. */
  coreC: 37,
  /** Heat capacity of the body, J per kg per °C. */
  heatCapacityJPerKgK: 3470,
  /** The body aims to undo a core temperature error over this long, s [estimate]. */
  restoreSeconds: 1800,
  /** Skin area = this × mass^(2/3), m² (Meeh's form, fitted to DuBois's formula for adults) [estimate]. */
  skinAreaPerKg23: 0.11,
  /** Convection: W/m²K per √(m/s) of air speed past the body; the slowest air counted, m/s. */
  convectionPerRootMs: 8.3,
  slowestAirMs: 0.2,
  /** Long-wave radiation between skin and surroundings, W/m²K. */
  radiationWPerM2K: 4.7,
  /** Share of the skin facing a source of sun or fire, and the shares of each it absorbs. */
  facingShare: 0.25,
  sunAbsorbed: 0.7,
  fireAbsorbed: 0.95,
  /** One clo of insulation, m²K/W. */
  cloM2KPerW: 0.155,
  /** Share of a hide's insulation lost when soaked, and the rain on the body that soaks it, mm/h [estimates]. */
  wetHideLoss: 0.5,
  soakingRainMmH: 1,
  /** Breath (ISO 7933): warming, W per W made per °C below 34; evaporation, per W made per kPa below 5.87. */
  breathWarming: 0.0014,
  breathWarmingC: 34,
  breathEvaporation: 0.0173,
  breathVapourKPa: 5.87,
  /** Water diffusing through dry skin, W/m² per kPa below 5.32 (Fanger's form, halved) [estimate]. */
  skinDiffusionWPerM2KPa: 1.7,
  skinDiffusionKPa: 5.32,
  /** Rain warmed to skin temperature on this share of the skin, °C. */
  rainWettedShare: 0.25,
  rainSkinC: 34,
  waterJPerKgK: 4186,
  /** Tissue insulation, m²K/W: open skin vessels; closed, base plus per unit of fat share [estimates]. */
  tissueOpen: 0.03,
  tissueClosed: 0.08,
  tissueClosedPerFatShare: 0.3,
  /** Most shivering, × the basal rate [estimate; peak about 4.9 × resting, Eyolfson et al. 2001]. */
  shiverMostBasal: 2.5,
  /** Vapour pressure at sweating skin, kPa; the Lewis relation, K/kPa; share of vapour hides pass (ISO 9920). */
  sweatingSkinKPa: 5.6,
  lewisKPerKPa: 16.5,
  hidePermeability: 0.38,
  /**
   * Most sweat, kg an hour, for sweatMostAtSkinM2 of skin, in proportion to skin area (T-012) [estimate],
   * and the share of it lost at the fatal water deficit [estimate].
   */
  sweatMostKgPerHour: 1,
  sweatMostAtSkinM2: 1.5,
  dehydratedSweatLoss: 0.5,
  /** Heat taken by evaporating a kg of water at skin temperature, J. */
  latentJPerKg: 2.43e6,
  /** Water in a kg of fat-free mass (Wang et al. 1999). */
  leanWaterShare: 0.73,
  /** Water made by burning fuel, kg per kcal spent [estimate]. */
  metabolicWaterKgPerKcal: 0.00012,
  /**
   * Urine: the least a day, kg, for a body whose basal rate is urineLeastAtBasalKcal a day, in proportion
   * to the basal rate (the solutes it carries come from food burned; T-012) [estimate]; a surplus passes
   * over this many s, at most this many kg an hour.
   */
  urineLeastKgPerDay: 0.5,
  urineLeastAtBasalKcal: 1500,
  surplusSeconds: 3600,
  urineMostKgPerHour: 1,
  /** Death: water deficit as a share of body mass; core temperatures, °C [estimates, DESIGN.md §3.9]. */
  fatalDeficitShare: 0.15,
  hyperthermiaC: 42,
  hypothermiaC: 26,
} as const;
const H = HEAT;
const JOULES_PER_KCAL = 4184;

/** Saturation vapour pressure of water over a flat surface at `temperatureC`, kPa (Tetens). */
export function saturationKPa(temperatureC: number): number {
  return 0.6108 * exp((17.27 * temperatureC) / (temperatureC + 237.3));
}

/** Skin area of a body of `massKg`, m². */
export function skinAreaM2(massKg: number): number {
  return H.skinAreaPerKg23 * pow(massKg, 2 / 3);
}

/**
 * What a body is in, written each tick by body.exposure or a test fixture. Nobody writing them
 * leaves 0: 0 °C, still, dry, dark air.
 */
export const SURROUNDINGS = {
  /** Air temperature, °C. */
  airC: { name: 'airC', dtype: 'f64', category: 'body' },
  /** Mean radiant temperature from sky and ground, °C (sun and fire apart). */
  radiantC: { name: 'radiantC', dtype: 'f64', category: 'body' },
  /** Relative humidity, 0 to 1. */
  humidity: { name: 'humidity', dtype: 'f64', category: 'body' },
  /** Wind at body height, m/s. */
  windMs: { name: 'windMs', dtype: 'f64', category: 'body' },
  /** Rain reaching the body, mm an hour. */
  rainMmH: { name: 'rainMmH', dtype: 'f64', category: 'body' },
  /** Sunlight reaching the body, W/m². */
  sunWm2: { name: 'sunWm2', dtype: 'f64', category: 'body' },
  /** Radiant heat from fires, W/m². */
  fireWm2: { name: 'fireWm2', dtype: 'f64', category: 'body' },
  /** Insulation of hides the body holds, clo. */
  hideClo: { name: 'hideClo', dtype: 'f64', category: 'body' },
  /** Share of the skin against other bodies, 0 to 1. */
  contact: { name: 'contact', dtype: 'f64', category: 'body' },
  /** 1 if the body stands in a flaming cell (fire all round it), else 0: read by body.injury for burns. */
  inFire: { name: 'inFire', dtype: 'f64', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const S = SURROUNDINGS;

export const HEAT_COLUMNS = {
  /** Core temperature, °C; 0 until body.heat first sees the body. */
  coreC: { name: 'coreC', dtype: 'f64', category: 'body' },
  /** Total body water, kg: the conserved stock. */
  /**
   * Shivering and sweat in the last tick, each as a share of its most (§4.9.1): what the body felt of
   * keeping its temperature, read by interoception.
   */
  shiverShare: { name: 'shiverShare', dtype: 'f64', category: 'body' },
  sweatShare: { name: 'sweatShare', dtype: 'f64', category: 'body' },
  water: { name: 'water', dtype: 'f64', category: 'body', conserved: { quantity: 'water', role: 'stock' } },
  waterIn: { name: 'waterIn', dtype: 'f64', category: 'body', conserved: { quantity: 'water', role: 'inflow' } },
  waterOut: { name: 'waterOut', dtype: 'f64', category: 'body', conserved: { quantity: 'water', role: 'outflow' } },
} as const satisfies Record<string, ColumnSpec>;
const C = HEAT_COLUMNS;
const B = BODY_COLUMNS;
/** body.injury's fever column (§3.10), named here so heat need not import injury. */
const FEVER_COLUMN = 'feverC';

/** Water a body of this lean mass holds when neither short nor in surplus, kg. */
export function fullWaterKg(leanKg: number): number {
  return H.leanWaterShare * leanKg;
}

function declareHeat(state: SimState): void {
  for (const spec of Object.values(SURROUNDINGS)) state.agents.ensureColumn(spec);
  for (const spec of Object.values(HEAT_COLUMNS)) state.agents.ensureColumn(spec);
}

/**
 * Put water into an agent's body: `kg` drunk, which the world has already given up. The pipeline
 * must hold body.heat.
 */
export function drink(sim: Sim, slot: number, kg: number): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`drink: slot ${slot} holds no agent.`);
  if (!agents.hasColumn(C.water.name)) throw new Error('drink: the pipeline has no body.heat.');
  if (agents.column<Uint8Array>(B.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`drink: agent id ${agents.id.data[slot]} has no body.`);
  }
  if (!(kg >= 0 && Number.isFinite(kg))) throw new RangeError(`drink: ${kg} kg.`);
  agents.column<Float64Array>(C.water.name).data[slot] += kg;
  agents.column<Float64Array>(C.waterIn.name).data[slot] += kg;
}

// ALIBI: a warm body loses heat to cold air, wind, rain and a clear sky and gains it from sun and
// fire; it shivers, sweats, loses water by breath, skin and urine, and dies when it overheats,
// chills, or dries out, whether or not any other body is near it.
export const heat: SystemDef = defineSystem({
  name: 'body.heat',
  declare: declareHeat,
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    const dt = 86_400 / config.time.ticksPerDay;
    const perYear = ticksPerYear(config);
    const dies = deathDoor(sim, 'body.heat');
    const restingRatio = METABOLISM.effortRatio[Effort.STILL];
    const urineLeastPerBasalW = (H.urineLeastKgPerDay * dt) / (H.urineLeastAtBasalKcal * JOULES_PER_KCAL);
    const urineMost = (H.urineMostKgPerHour / 3600) * dt;
    const sweatMostPerM2 = H.sweatMostKgPerHour / (3600 * H.sweatMostAtSkinM2);
    const fevered = agents.hasColumn(FEVER_COLUMN);

    return () => {
      const tick = state.tick;
      const alive = agents.alive.data;
      const ids = agents.id.data;
      const sex = agents.column<Uint8Array>(B.sex.name).data;
      const born = agents.column<Float64Array>(B.born.name).data;
      const lean = agents.column<Float64Array>(B.leanKg.name).data;
      const gut = agents.column<Float64Array>(B.gut.name).data;
      const energy = agents.column<Float64Array>(B.energy.name).data;
      const moved = agents.column<Float64Array>(B.movedM.name).data;
      const shiver = agents.column<Float64Array>(B.shiverW.name).data;
      const made = agents.column<Float64Array>(B.heatW.name).data;
      const core = agents.column<Float64Array>(C.coreC.name).data;
      const shiverShare = agents.column<Float64Array>(C.shiverShare.name).data;
      const sweatShare = agents.column<Float64Array>(C.sweatShare.name).data;
      const water = agents.column<Float64Array>(C.water.name).data;
      const waterIn = agents.column<Float64Array>(C.waterIn.name).data;
      const waterOut = agents.column<Float64Array>(C.waterOut.name).data;
      const airC = agents.column<Float64Array>(S.airC.name).data;
      const radiantC = agents.column<Float64Array>(S.radiantC.name).data;
      const humidity = agents.column<Float64Array>(S.humidity.name).data;
      const windMs = agents.column<Float64Array>(S.windMs.name).data;
      const rainMmH = agents.column<Float64Array>(S.rainMmH.name).data;
      const sunWm2 = agents.column<Float64Array>(S.sunWm2.name).data;
      const fireWm2 = agents.column<Float64Array>(S.fireWm2.name).data;
      const hideClo = agents.column<Float64Array>(S.hideClo.name).data;
      const contact = agents.column<Float64Array>(S.contact.name).data;
      // A fever raises the temperature the body regulates toward (body.injury, §3.10).
      const fever = fevered ? agents.column<Float64Array>(FEVER_COLUMN).data : null;

      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        const s = sex[slot];
        if (s === Sex.NONE) {
          throw new Error(`body.heat: agent id ${ids[slot]} has no body; call formBody right after spawnAgent.`);
        }
        const leanKg = lean[slot];
        const fatKg = fatKgOf(energy[slot], gut[slot], leanKg);
        const mass = leanKg + fatKg;
        const basalW = (basalKcalPerDay(s, (tick - born[slot]) / perYear, mass) * JOULES_PER_KCAL) / 86_400;
        if (core[slot] === 0) {
          // The first tick this system sees the body: it is at 37 °C and holds its full water.
          core[slot] = H.coreC;
          const full = fullWaterKg(leanKg);
          water[slot] += full;
          waterIn[slot] += full;
          if (made[slot] === 0) made[slot] = restingRatio * basalW;
        }
        const t = core[slot];
        const madeW = made[slot];
        const air = airC[slot];
        const rain = rainMmH[slot];
        const touching = contact[slot];
        if (!(touching >= 0 && touching < 1 && rain >= 0 && hideClo[slot] >= 0 && humidity[slot] >= 0)) {
          throw new RangeError(`body.heat: agent id ${ids[slot]} has impossible surroundings.`);
        }

        // 1. Exchange with the air.
        const area = skinAreaM2(mass);
        const exposed = area * (1 - touching);
        const walk = moved[slot] / dt;
        const wind = windMs[slot];
        let airSpeed = Math.sqrt(wind * wind + walk * walk);
        if (airSpeed < H.slowestAirMs) airSpeed = H.slowestAirMs;
        const hc = H.convectionPerRootMs * Math.sqrt(airSpeed);
        const h = hc + H.radiationWPerM2K;
        const absorbed = H.facingShare * area * (H.sunAbsorbed * sunWm2[slot] + H.fireAbsorbed * fireWm2[slot]);
        const operative = (H.radiationWPerM2K * radiantC[slot] + hc * air) / h + absorbed / (area * h);
        const rAir = 1 / h;
        const soaked = rain >= H.soakingRainMmH ? 1 : rain / H.soakingRainMmH;
        const rHide = H.cloM2KPerW * hideClo[slot] * (1 - H.wetHideLoss * soaked);

        // 2. Fixed losses: breath, skin diffusion, rain.
        const vapour = humidity[slot] * saturationKPa(air);
        let breathWet = H.breathEvaporation * madeW * (H.breathVapourKPa - vapour);
        if (breathWet < 0) breathWet = 0;
        const breathDry = H.breathWarming * madeW * (H.breathWarmingC - air);
        const gradient = H.sweatingSkinKPa - vapour;
        const evapMost = gradient > 0 ? (exposed * gradient) / (1 / (H.lewisKPerKPa * hc) + rHide / (H.hidePermeability * H.lewisKPerKPa)) : 0;
        let diffusion = H.skinDiffusionWPerM2KPa * (H.skinDiffusionKPa - vapour) * exposed;
        if (diffusion < 0) diffusion = 0;
        if (diffusion > evapMost) diffusion = evapMost;
        let rainCool = (rain / 3600) * H.rainWettedShare * area * H.waterJPerKgK * (H.rainSkinC - air);
        if (rainCool < 0) rainCool = 0;
        const spare = madeW - breathDry - breathWet - diffusion - rainCool;

        // 3. Regulation: insulation first, then shivering or sweat.
        const capacity = mass * H.heatCapacityJPerKgK;
        const target = fever ? H.coreC + fever[slot] : H.coreC;
        const want = (capacity * (target - t)) / H.restoreSeconds;
        const closed = H.tissueClosed + H.tissueClosedPerFatShare * (fatKg / mass);
        const netClosed = spare - (exposed * (t - operative)) / (closed + rHide + rAir);
        let shiverW = 0;
        let sweatKgS = 0;
        let stored: number;
        if (netClosed < want) {
          shiverW = want - netClosed;
          const most = H.shiverMostBasal * basalW;
          if (shiverW > most) shiverW = most;
          stored = netClosed + shiverW;
        } else {
          // Opening the skin's vessels helps only while the surroundings are cooler than the body.
          const loose = operative < t ? H.tissueOpen : closed;
          const netLoose = spare - (exposed * (t - operative)) / (loose + rHide + rAir);
          if (netLoose > want) {
            const needed = netLoose - want;
            // Sweat that cannot evaporate drips (ISO 7933's efficiency of sweating).
            const wetted = evapMost > 0 ? (needed + diffusion) / evapMost : Infinity;
            let efficiency = wetted <= 1 ? 1 - (wetted * wetted) / 2 : wetted < 2 ? ((2 - wetted) * (2 - wetted)) / 2 : 0;
            if (efficiency < 0.05) efficiency = 0.05;
            const deficitShare = (fullWaterKg(leanKg) - water[slot]) / (H.fatalDeficitShare * mass);
            const cut = deficitShare <= 0 ? 0 : deficitShare >= 1 ? H.dehydratedSweatLoss : H.dehydratedSweatLoss * deficitShare;
            sweatKgS = needed / (H.latentJPerKg * efficiency);
            const sweatMost = sweatMostPerM2 * area;
            if (sweatKgS > sweatMost * (1 - cut)) sweatKgS = sweatMost * (1 - cut);
            let evaporated = sweatKgS * H.latentJPerKg * efficiency;
            const room = evapMost - diffusion;
            if (evaporated > room) evaporated = room > 0 ? room : 0;
            stored = netLoose - evaporated;
          } else {
            stored = want;
          }
        }
        const newCore = t + (stored * dt) / capacity;
        core[slot] = newCore;
        shiver[slot] = shiverW;
        shiverShare[slot] = shiverW > 0 ? shiverW / (H.shiverMostBasal * basalW) : 0;
        sweatShare[slot] = sweatKgS > 0 ? sweatKgS / (sweatMostPerM2 * area) : 0;

        // 4. Water.
        const fuel = (((madeW + shiverW) * dt) / JOULES_PER_KCAL) * H.metabolicWaterKgPerKcal;
        const full = fullWaterKg(leanKg);
        const surplus = water[slot] - full;
        let urine = urineLeastPerBasalW * basalW;
        if (surplus > 0) {
          const pass = (surplus * dt) / H.surplusSeconds;
          urine += pass < urineMost ? pass : urineMost;
        }
        const lost = ((breathWet + diffusion) / H.latentJPerKg + sweatKgS) * dt + urine;
        water[slot] += fuel - lost;
        waterIn[slot] += fuel;
        waterOut[slot] += lost;

        // 5. Death.
        let cause = 0;
        if (full - water[slot] >= H.fatalDeficitShare * mass) cause = DeathCause.DEHYDRATION;
        else if (newCore >= H.hyperthermiaC) cause = DeathCause.HYPERTHERMIA;
        else if (newCore <= H.hypothermiaC) cause = DeathCause.HYPOTHERMIA;
        if (cause !== 0) dies(slot, cause);
      }
    };
  },
});
