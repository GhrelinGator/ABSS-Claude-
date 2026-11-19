// Agents' bodies at the moment of sampling (docs/DESIGN.md §3.8, §3.9): how
// many, their mean mass and fat share, the energy they have eaten and spent so
// far, their mean core temperature and water deficit, the water they have taken
// in and lost so far, how many are wounded, burned, broken, infected or ill
// now (§3.10), injuries so far by kind, and deaths so far by cause.

import type { Measurements, Observer } from '../observer.ts';
import {
  BODY_COLUMNS,
  BODY_PARTS,
  DeathCause,
  HEAT_COLUMNS,
  INJURY_COLUMNS,
  INJURY_PARTS,
  InjuryKind,
  Sex,
  fatKgOf,
  fullWaterKg,
} from '../../sim/readonly.ts';

export const bodies: Observer = {
  name: 'bodies',
  observe(view): Measurements {
    const agents = view.agents;
    if (!agents.hasColumn(BODY_COLUMNS.energy.name)) return {};
    const alive = agents.column('alive');
    const sex = agents.column(BODY_COLUMNS.sex.name);
    const energy = agents.column(BODY_COLUMNS.energy.name);
    const energyIn = agents.column(BODY_COLUMNS.energyIn.name);
    const energyOut = agents.column(BODY_COLUMNS.energyOut.name);
    const gut = agents.column(BODY_COLUMNS.gut.name);
    const lean = agents.column(BODY_COLUMNS.leanKg.name);
    const heat = agents.hasColumn(HEAT_COLUMNS.water.name);
    const core = heat ? agents.column(HEAT_COLUMNS.coreC.name) : null;
    const water = heat ? agents.column(HEAT_COLUMNS.water.name) : null;
    const waterIn = heat ? agents.column(HEAT_COLUMNS.waterIn.name) : null;
    const waterOut = heat ? agents.column(HEAT_COLUMNS.waterOut.name) : null;
    const hurt = agents.hasColumn(INJURY_COLUMNS.woundCm2.name);
    const wound = hurt ? agents.column(INJURY_COLUMNS.woundCm2.name) : null;
    const burns = hurt ? agents.column(INJURY_COLUMNS.burnShare.name) : null;
    const leg = hurt ? agents.column(INJURY_COLUMNS.legBroken.name) : null;
    const arm = hurt ? agents.column(INJURY_COLUMNS.armBroken.name) : null;
    const wInf = hurt ? agents.column(INJURY_COLUMNS.woundInfection.name) : null;
    const gInf = hurt ? agents.column(INJURY_COLUMNS.gutInfection.name) : null;
    const mobility = hurt ? agents.column(INJURY_COLUMNS.mobility.name) : null;
    let wounded = 0;
    let burned = 0;
    let broken = 0;
    let infected = 0;
    let ill = 0;
    let moving = 0;
    let warm = 0;
    let coreSum = 0;
    let deficit = 0;
    let drunk = 0;
    let lost = 0;
    let n = 0;
    let mass = 0;
    let fatShare = 0;
    let eaten = 0;
    let spent = 0;
    for (let slot = 0; slot < agents.highWater; slot++) {
      if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
      const fat = fatKgOf(energy[slot], gut[slot], lean[slot]);
      const m = fat + lean[slot];
      n++;
      mass += m;
      fatShare += fat / m;
      eaten += energyIn[slot];
      spent += energyOut[slot];
      if (wound && burns && leg && arm && wInf && gInf && mobility) {
        if (wound[slot] > 0) wounded++;
        if (burns[slot] > 0) burned++;
        if (leg[slot] > 0 || arm[slot] > 0) broken++;
        if (wInf[slot] > 0) infected++;
        if (gInf[slot] > 0) ill++;
        moving += mobility[slot];
      }
      if (core && water && waterIn && waterOut && core[slot] !== 0) {
        warm++;
        coreSum += core[slot];
        deficit += fullWaterKg(lean[slot]) - water[slot];
        drunk += waterIn[slot];
        lost += waterOut[slot];
      }
    }
    const out: Measurements = { withBodies: n };
    if (n > 0) {
      out.meanMassKg = mass / n;
      out.meanFatShare = fatShare / n;
      out.meanKcalIn = eaten / n;
      out.meanKcalOut = spent / n;
    }
    if (hurt && n > 0) {
      out.woundedShare = wounded / n;
      out.burnedShare = burned / n;
      out.brokenShare = broken / n;
      out.woundInfectedShare = infected / n;
      out.gutIllShare = ill / n;
      out.meanMobility = moving / n;
    }
    if (warm > 0) {
      out.meanCoreC = coreSum / warm;
      out.meanWaterDeficitKg = deficit / warm;
      out.meanWaterInKg = drunk / warm;
      out.meanWaterOutKg = lost / warm;
    }
    const deaths = view.readings(BODY_PARTS.deaths);
    if (deaths) {
      out['deaths.starvation'] = deaths[DeathCause.STARVATION];
      if (deaths.length > DeathCause.HYPOTHERMIA) {
        out['deaths.dehydration'] = deaths[DeathCause.DEHYDRATION];
        out['deaths.hyperthermia'] = deaths[DeathCause.HYPERTHERMIA];
        out['deaths.hypothermia'] = deaths[DeathCause.HYPOTHERMIA];
      }
      if (deaths.length > DeathCause.LIGHTNING) {
        out['deaths.shock'] = deaths[DeathCause.SHOCK];
        out['deaths.infection'] = deaths[DeathCause.INFECTION];
        out['deaths.lightning'] = deaths[DeathCause.LIGHTNING];
      }
    }
    const injuries = view.readings(INJURY_PARTS.injuries);
    if (injuries) {
      out['injuries.wounds'] = injuries[InjuryKind.WOUND];
      out['injuries.burns'] = injuries[InjuryKind.BURN];
      out['injuries.lightning'] = injuries[InjuryKind.LIGHTNING];
      out['injuries.woundInfections'] = injuries[InjuryKind.WOUND_INFECTION];
      out['injuries.gutIllnesses'] = injuries[InjuryKind.GUT_ILLNESS];
    }
    return out;
  },
};
