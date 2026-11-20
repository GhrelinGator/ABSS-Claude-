// Interoception: the eight drive channels a mind feels, read from its body (docs/DESIGN.md §4.7.4,
// §4.9.1). Each is 0 to 1, with 1 at the body's own limit, so the scale is physiology, not a weighting
// anyone chose. Fear and curiosity are not channels (§4.7.4).

import { ticksPerYear } from '../core/clock.ts';
import type { Sim } from '../sim.ts';
import { capacity as capacityFrom, FITNESS_COLUMNS, tiredness } from '../body/fitness.ts';
import { GUT, GUT_COLUMNS, poisonStrength } from '../body/gut.ts';
import { HEAT, HEAT_COLUMNS, fullWaterKg } from '../body/heat.ts';
import { INJURY_COLUMNS } from '../body/injury.ts';
import { capacityAtAge } from '../body/lifecourse.ts';
import { BODY_COLUMNS, METABOLISM, basalKcalPerDay, fatKgOf } from '../body/metabolism.ts';
import { SLEEP_COLUMNS, sleepiness } from '../body/sleep.ts';

/** The channels, by index (§4.7.4). */
export const Channel = { HUNGER: 0, THIRST: 1, COLD: 2, HEAT: 3, PAIN: 4, FATIGUE: 5, MATING: 6, SEPARATION: 7 } as const;
export const CHANNELS = 8;

export const INTEROCEPTION = {
  /** Hours of absorption a full gut holds (§3.8's rate): 1,080 kcal at 3 kcal a minute. */
  fullGutHours: 6,
  /** Fat-days (fat's energy ÷ basal kcal a day) at which depletion is 0 [estimate]. */
  fatDaysFull: 40,
  /** Pain: open wound cm² at the most pain; burned share of skin × this [estimates]. */
  woundMostCm2: 100,
  burnPerShare: 5,
} as const;
const K = INTEROCEPTION;

/** Body state the channels read: the mind system needs the whole body stack of Phase 2 and 3.3. */
const NEEDED = [
  BODY_COLUMNS.gut.name,
  GUT_COLUMNS.stomachKg.name,
  HEAT_COLUMNS.coreC.name,
  HEAT_COLUMNS.shiverShare.name,
  INJURY_COLUMNS.woundCm2.name,
  FITNESS_COLUMNS.acuteLoad.name,
  SLEEP_COLUMNS.sleepPressure.name,
];

export interface Interoception {
  /** Fetch the columns afresh: call once a tick before reading (stores can grow between ticks). */
  refresh(): void;
  /** Write agent `slot`'s eight channels into `out` from `offset`. */
  read(slot: number, out: Float32Array | Float64Array, offset: number): void;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function createInteroception(sim: Sim): Interoception {
  const { config, state } = sim;
  const agents = state.agents;
  for (const name of NEEDED) {
    if (!agents.hasColumn(name)) throw new Error(`Interoception needs the body column "${name}" (the whole body stack).`);
  }
  const fullGutKcal = METABOLISM.absorbKcalPerMinute * 60 * K.fullGutHours;
  const perYear = ticksPerYear(config);
  const basalScaleName = 'basalScale';
  const f = (name: string) => agents.column<Float64Array>(name).data;
  let sex = agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data;
  let born = f(BODY_COLUMNS.born.name);
  let lean = f(BODY_COLUMNS.leanKg.name);
  let gut = f(BODY_COLUMNS.gut.name);
  let energy = f(BODY_COLUMNS.energy.name);
  let stomach = f(GUT_COLUMNS.stomachKg.name);
  let poisonActive = f(GUT_COLUMNS.poisonActive.name);
  let water = f(HEAT_COLUMNS.water.name);
  let core = f(HEAT_COLUMNS.coreC.name);
  let shiverShare = f(HEAT_COLUMNS.shiverShare.name);
  let sweatShare = f(HEAT_COLUMNS.sweatShare.name);
  let fever = f(INJURY_COLUMNS.feverC.name);
  let wound = f(INJURY_COLUMNS.woundCm2.name);
  let burn = f(INJURY_COLUMNS.burnShare.name);
  let leg = f(INJURY_COLUMNS.legBroken.name);
  let arm = f(INJURY_COLUMNS.armBroken.name);
  let strain = f(INJURY_COLUMNS.strain.name);
  let woundInf = f(INJURY_COLUMNS.woundInfection.name);
  let gutInf = f(INJURY_COLUMNS.gutInfection.name);
  let fitness = f(FITNESS_COLUMNS.fitness.name);
  let fatigue = f(FITNESS_COLUMNS.fatigue.name);
  let acute = f(FITNESS_COLUMNS.acuteLoad.name);
  let pressure = f(SLEEP_COLUMNS.sleepPressure.name);
  let basalScale: Float64Array | null = agents.hasColumn(basalScaleName) ? f(basalScaleName) : null;

  return {
    refresh() {
      sex = agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data;
      born = f(BODY_COLUMNS.born.name);
      lean = f(BODY_COLUMNS.leanKg.name);
      gut = f(BODY_COLUMNS.gut.name);
      energy = f(BODY_COLUMNS.energy.name);
      stomach = f(GUT_COLUMNS.stomachKg.name);
      poisonActive = f(GUT_COLUMNS.poisonActive.name);
      water = f(HEAT_COLUMNS.water.name);
      core = f(HEAT_COLUMNS.coreC.name);
      shiverShare = f(HEAT_COLUMNS.shiverShare.name);
      sweatShare = f(HEAT_COLUMNS.sweatShare.name);
      fever = f(INJURY_COLUMNS.feverC.name);
      wound = f(INJURY_COLUMNS.woundCm2.name);
      burn = f(INJURY_COLUMNS.burnShare.name);
      leg = f(INJURY_COLUMNS.legBroken.name);
      arm = f(INJURY_COLUMNS.armBroken.name);
      strain = f(INJURY_COLUMNS.strain.name);
      woundInf = f(INJURY_COLUMNS.woundInfection.name);
      gutInf = f(INJURY_COLUMNS.gutInfection.name);
      fitness = f(FITNESS_COLUMNS.fitness.name);
      fatigue = f(FITNESS_COLUMNS.fatigue.name);
      acute = f(FITNESS_COLUMNS.acuteLoad.name);
      pressure = f(SLEEP_COLUMNS.sleepPressure.name);
      basalScale = agents.hasColumn(basalScaleName) ? f(basalScaleName) : null;
    },
    read(slot, out, offset) {
      const tick = state.tick;
      const leanKg = lean[slot];
      const fatKg = fatKgOf(energy[slot], gut[slot], leanKg);
      const mass = leanKg + (fatKg > 0 ? fatKg : 0);
      const age = (tick - born[slot]) / perYear;

      // Hunger: the gut's fill and the fat's depletion, half each.
      const fillKcal = gut[slot] / fullGutKcal;
      const fillBulk = stomach[slot] / GUT.stomachMostKg;
      const fill = clamp01(fillKcal > fillBulk ? fillKcal : fillBulk);
      let basal = basalKcalPerDay(sex[slot], age, mass);
      if (basalScale && basalScale[slot] > 0) basal *= basalScale[slot];
      const fatDays = ((fatKg > 0 ? fatKg : 0) * METABOLISM.fatKcalPerKg) / basal;
      const depletion = clamp01(1 - fatDays / K.fatDaysFull);
      out[offset + Channel.HUNGER] = 0.5 * (1 - fill) + 0.5 * depletion;

      // Thirst, cold and heat: until body.heat has seen the body (core 0), it is at 37 °C with its full water.
      const t = core[slot];
      if (t === 0) {
        out[offset + Channel.THIRST] = 0;
        out[offset + Channel.COLD] = 0;
        out[offset + Channel.HEAT] = 0;
      } else {
        out[offset + Channel.THIRST] = clamp01((fullWaterKg(leanKg) - water[slot]) / (HEAT.fatalDeficitShare * mass));
        const setPoint = HEAT.coreC + fever[slot];
        const coldCore = (setPoint - t) / (setPoint - HEAT.hypothermiaC);
        const hotCore = (t - setPoint) / (HEAT.hyperthermiaC - setPoint);
        out[offset + Channel.COLD] = clamp01(coldCore > shiverShare[slot] ? coldCore : shiverShare[slot]);
        out[offset + Channel.HEAT] = clamp01(hotCore > sweatShare[slot] ? hotCore : sweatShare[slot]);
      }

      // Pain: each kind as a share of the most it can hurt, combined as independent.
      let free = 1 - clamp01(wound[slot] / K.woundMostCm2);
      free *= 1 - clamp01(burn[slot] * K.burnPerShare);
      free *= 1 - clamp01(leg[slot] > arm[slot] ? leg[slot] : arm[slot]);
      free *= 1 - clamp01(strain[slot]);
      free *= 1 - clamp01(woundInf[slot] + gutInf[slot]);
      free *= 1 - clamp01(poisonStrength(poisonActive[slot], mass) / GUT.painAt);
      out[offset + Channel.PAIN] = 1 - free;

      // Fatigue: sleepiness and the last hours' tiredness.
      const sleepy = clamp01(sleepiness(config, tick, pressure[slot]));
      const cap = capacityFrom(fitness[slot], fatigue[slot]) * capacityAtAge(age);
      const tired = tiredness(acute[slot], cap);
      out[offset + Channel.FATIGUE] = 1 - (1 - sleepy) * (1 - tired);

      out[offset + Channel.MATING] = 0;
      out[offset + Channel.SEPARATION] = 0;
    },
  };
}
