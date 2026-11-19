// Injury, healing and infection: wounds and bleeding, broken bones, strains,
// burns from fire, lightning, infections of wounds and of the gut, the fever
// and the heat they make, and death by shock, infection or lightning
// (docs/DESIGN.md §3.3, §3.10).
//
// What deals an injury calls a door (injure, exposeGut); fire's heat on a body
// arrives in the surroundings columns body.exposure writes; lightning is read
// from the climate's strikes this tick. Everything else is the body's own
// physiology, in real days like all daily physiology (D-024, D-026).

import { exp, pow } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextFloat, nextNormal } from '../core/rng.ts';
import { BucketGrid } from '../core/spatial.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sink, Source } from '../core/codec.ts';
import { ticksPerYear } from '../core/clock.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { CLIMATE_PARTS } from '../world/climate.ts';
import { BODY_COLUMNS, DeathCause, METABOLISM, Sex, basalKcalPerDay, deathDoor, fatKgOf } from './metabolism.ts';
import { HEAT, HEAT_COLUMNS, SURROUNDINGS, fullWaterKg, skinAreaM2 } from './heat.ts';

/** Every number injury uses, in one place. Estimates unless a source is named (docs/RESEARCH.md, *Bodies*). */
export const INJURY = {
  /** Blood volume, litres per kg of lean mass (about 5 L for a 70 kg man) [estimate]. */
  bloodLPerLeanKg: 0.085,
  /** Mass of a litre of blood, kg. */
  bloodKgPerL: 1.06,
  /** Circulating volume missing at which the body dies of shock, share of blood volume (ATLS class IV). */
  fatalVolumeShare: 0.4,
  /** Bleeding slows as it clots with this time constant, s [bleeding time 2–9 minutes]. */
  clotSeconds: 300,
  /** Below this, bleeding has stopped, mL a minute. */
  bleedStopMlMin: 0.1,
  /** The vessels refill from the body's water with this time constant, s [a day or two]. */
  refillSeconds: 12 * 3600,
  /** Plasma pushed out of the vessels by burns: litres per kg of body per unit share burned (half of Parkland's 4 mL/kg/%), and its time constant, s. */
  burnLeakLPerKg: 0.2,
  burnLeakSeconds: 8 * 3600,

  /** Infectious units taken in per kg of water, and per kg of meat, at a full bloom (load 1, §2.14). */
  waterDosePerKg: 1,
  meatDosePerKg: 4,
  /** Units taken into an open wound per cm² × dirt when it is dealt, and per cm² per day while it stays open. */
  woundDosePerCm2: 0.05,
  openDosePerCm2Day: 0.001,
  /** Partial burns take in this share of an open wound's dose per cm². */
  partialBurnDoseShare: 0.25,

  /**
   * Infection courses: starting severity; virulence g (per day): log-normal median and spread; rise
   * of the response per day; its half-life once over, days; whether growth slows as severity nears 1
   * (the gut's lining is finite; an infection spreading through the body is not bounded, T-010).
   */
  wound: { start: 0.01, virulence: 0.5, spread: 0.5, rise: 0.1, fadeDays: 30, bounded: false },
  gut: { start: 0.03, virulence: 0.9, spread: 0.3, rise: 0.3, fadeDays: 60, bounded: true },
  /** A course below this severity that its response holds down is over. */
  overBelow: 0.0001,
  /** A wound infection at this severity kills (sepsis). */
  fatalSeverity: 1,
  /** Nourishment rises from 0 at this fat share to 1 at this one; condition = least + (1 − least) × nourishment. */
  nourishedFrom: 0.01,
  nourishedAt: 0.06,
  leastCondition: 0.2,

  /** Thermal dose: radiant heat the skin carries away indefinitely, kW/m²; doses (kW/m²)^(4/3)·s for partial and full-thickness burns. */
  skinCarriesKwM2: 1.7,
  partialBurnDose: 250,
  fullBurnDose: 1000,
  /** Share of the skin facing a fire; inside a flaming cell. */
  facingShare: 0.25,
  surroundedShare: 0.75,

  /** Lightning: reach, m; the distance inside which the heart stops with the most probability, m; that probability; superficial burns, share of skin, at that distance. */
  strikeReachM: 10,
  strikeNearM: 2,
  strikeArrest: 0.5,
  strikeBurn: 0.03,

  /** Healing: an open wound's edge advance, cm a day; infected (severity ≥ this) it heals at this share. */
  edgeCmPerDay: 0.07,
  infectedSlows: 0.3,
  infectedHealShare: 0.2,
  /** Half-lives, days: partial burns, broken bones, strains. */
  burnHalfDays: 7,
  boneHalfDays: 14,
  strainHalfDays: 7,
  /** Lean tissue rebuilt per day, as a share of what is owed; extra heat, as a share of the energy rebuilt; least fat kept, kg. */
  rebuildPerDay: 1 / 20,
  rebuildCost: 0.2,
  rebuildKeepsFatKg: 0.5,

  /** Water evaporated through burned and open skin: mL an hour per percent of skin per m² of skin. Diarrhoea: kg a day at full severity. */
  burnWaterMlPerPctM2H: 1,
  diarrhoeaKgPerDay: 10,

  /** Fever: most °C, and the severity at half of it. */
  feverMostC: 3,
  feverHalfAt: 0.25,
  /** Heat of healing, × basal: per unit of broken bone (at most 1 counted), per unit share of skin burned or open (at most 1 in all), and infection's most and half-severity; all together at most. */
  boneHeat: 0.25,
  burnHeat: 2,
  infectionHeat: 0.7,
  infectionHeatHalfAt: 0.15,
  mostHeat: 1.5,
  /** Mobility: share lost per unit of broken leg, of strain, of shock, of fever's share of its most. Arm use: per unit of broken arm. */
  legLoss: 0.9,
  strainLoss: 0.5,
  shockLoss: 0.5,
  feverLoss: 0.5,
  armLoss: 0.9,
} as const;
const K = INJURY;
const JOULES_PER_KCAL = 4184;

/**
 * What an injury tally counts (`body.injuries`, index = kind): wounds dealt through `injure` (an
 * open wound, bleeding or a broken bone), burns, bodies struck by lightning, infections caught, and
 * strains dealt through `injure` with nothing else (overexertion, §3.11).
 */
export const InjuryKind = { WOUND: 1, BURN: 2, LIGHTNING: 3, WOUND_INFECTION: 4, GUT_ILLNESS: 5, STRAIN: 6 } as const;
const INJURY_SLOTS = 7;
export const INJURY_PARTS = { injuries: 'body.injuries' } as const;

export const INJURY_COLUMNS = {
  /** Bleeding now, mL a minute. */
  bleedMlMin: { name: 'bleedMlMin', dtype: 'f64', category: 'body' },
  /** Circulating volume missing, L: blood lost and plasma leaked after burns, not yet refilled. */
  bloodLostL: { name: 'bloodLostL', dtype: 'f64', category: 'body' },
  /** Plasma still to leak out of the vessels after burns, L. */
  burnLeakL: { name: 'burnLeakL', dtype: 'f64', category: 'body' },
  /** Open wound, cm²: cuts, punctures, torn skin, full-thickness burns. */
  woundCm2: { name: 'woundCm2', dtype: 'f64', category: 'body' },
  /** Partial-thickness burns, share of the skin. */
  burnShare: { name: 'burnShare', dtype: 'f64', category: 'body' },
  /** The skin's heat dose in the current exposure to fire, (kW/m²)^(4/3)·s. */
  burnDose: { name: 'burnDose', dtype: 'f64', category: 'body' },
  /** Broken bones, share of the limb's use lost. */
  legBroken: { name: 'legBroken', dtype: 'f64', category: 'body' },
  armBroken: { name: 'armBroken', dtype: 'f64', category: 'body' },
  /** Torn muscle or tendon, share of capacity for hard effort lost. */
  strain: { name: 'strain', dtype: 'f64', category: 'body' },
  /** Lean tissue lost and owed back by healing, kg. */
  rebuildKg: { name: 'rebuildKg', dtype: 'f64', category: 'body' },
  /** Infection courses: severity, the response against it, the strain's virulence (per day), and the dose waiting. */
  woundInfection: { name: 'woundInfection', dtype: 'f64', category: 'body' },
  woundResponse: { name: 'woundResponse', dtype: 'f64', category: 'body' },
  woundVirulence: { name: 'woundVirulence', dtype: 'f64', category: 'body' },
  woundDose: { name: 'woundDose', dtype: 'f64', category: 'body' },
  gutInfection: { name: 'gutInfection', dtype: 'f64', category: 'body' },
  gutResponse: { name: 'gutResponse', dtype: 'f64', category: 'body' },
  gutVirulence: { name: 'gutVirulence', dtype: 'f64', category: 'body' },
  gutDose: { name: 'gutDose', dtype: 'f64', category: 'body' },
  /** Raise of the body's temperature set-point, °C: read by body.heat. */
  feverC: { name: 'feverC', dtype: 'f64', category: 'body' },
  /** Heat made by healing and fighting infection this tick, W: charged and cleared by body.metabolism. */
  healW: { name: 'healW', dtype: 'f64', category: 'body' },
  /** Share of walking, and of handling, the body can still do: for the acts of Phase 3. */
  mobility: { name: 'mobility', dtype: 'f64', category: 'body' },
  armUse: { name: 'armUse', dtype: 'f64', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const C = INJURY_COLUMNS;
const B = BODY_COLUMNS;

/** Infectious units in `kg` of water at pathogen load `load` (§2.14). */
export function waterDose(kg: number, load: number): number {
  return K.waterDosePerKg * kg * load;
}

/** Infectious units in `kg` of meat at pathogen load `load` (§2.14). */
export function meatDose(kg: number, load: number): number {
  return K.meatDosePerKg * kg * load;
}

/** Blood volume of a body with this lean mass, L. */
export function bloodVolumeL(leanKg: number): number {
  return K.bloodLPerLeanKg * leanKg;
}

/** Condition for healing and fighting infection, from the share of the body that is fat. */
export function conditionOf(fatShare: number): number {
  let n = (fatShare - K.nourishedFrom) / (K.nourishedAt - K.nourishedFrom);
  n = n < 0 ? 0 : n > 1 ? 1 : n;
  return K.leastCondition + (1 - K.leastCondition) * n;
}

/** Fever, °C, at an infection severity `s` (wound plus half the gut's). */
export function feverOf(s: number): number {
  return (K.feverMostC * s) / (s + K.feverHalfAt);
}

function injuryTally(): StatePart {
  const counts = new Float64Array(INJURY_SLOTS);
  return {
    name: INJURY_PARTS.injuries,
    holdsLearned: false,
    readings: () => counts,
    write(sink: Sink) {
      sink.array(counts);
    },
    read(source: Source) {
      const saved = source.array('f64');
      if (saved.length !== counts.length) throw new Error('body.injuries: snapshot has the wrong length.');
      counts.set(saved);
    },
  };
}

function tallyOf(state: SimState): Float64Array {
  const part = state.parts.find((p) => p.name === INJURY_PARTS.injuries);
  if (!part || !part.readings) throw new Error('The pipeline has no body.injury.');
  return part.readings() as Float64Array;
}

function bodySlot(sim: Sim, slot: number, door: string): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`${door}: slot ${slot} holds no agent.`);
  if (!agents.hasColumn(C.woundDose.name)) throw new Error(`${door}: the pipeline has no body.injury.`);
  if (agents.column<Uint8Array>(B.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`${door}: agent id ${agents.id.data[slot]} has no body.`);
  }
}

/** An injury dealt to a body. Every field is optional; shares combine with what is already there. */
export interface Injury {
  /** Open wound, cm². */
  readonly openCm2?: number;
  /** Bleeding it starts, mL a minute (outside or inside the body). */
  readonly bleedMlMin?: number;
  /** Dirt carried into the open wound: 0 for a clean edge, 1 for an animal's mouth or soil. */
  readonly dirt?: number;
  /** Broken bone: share of the leg's or the arm's use lost. */
  readonly leg?: number;
  readonly arm?: number;
  /** Torn muscle or tendon: share of capacity for hard effort lost. */
  readonly strain?: number;
}

function share(value: number | undefined, door: string, field: string): number {
  const v = value ?? 0;
  if (!(v >= 0 && v <= 1)) throw new RangeError(`${door}: ${field} ${v} is not a share between 0 and 1.`);
  return v;
}

/**
 * Deal an injury to a body: whatever wounds, bites, breaks or strains it calls this in the tick it
 * happens. Infection from the dirt is resolved by body.injury in the same tick.
 */
export function injure(sim: Sim, slot: number, injury: Injury): void {
  bodySlot(sim, slot, 'injure');
  const open = injury.openCm2 ?? 0;
  const bleed = injury.bleedMlMin ?? 0;
  if (!(open >= 0 && Number.isFinite(open))) throw new RangeError(`injure: open wound ${open} cm².`);
  if (!(bleed >= 0 && Number.isFinite(bleed))) throw new RangeError(`injure: bleeding ${bleed} mL a minute.`);
  const dirt = share(injury.dirt, 'injure', 'dirt');
  const leg = share(injury.leg, 'injure', 'leg');
  const arm = share(injury.arm, 'injure', 'arm');
  const strain = share(injury.strain, 'injure', 'strain');
  const agents = sim.state.agents;
  const col = (name: string) => agents.column<Float64Array>(name).data;
  col(C.woundCm2.name)[slot] += open;
  col(C.bleedMlMin.name)[slot] += bleed;
  col(C.woundDose.name)[slot] += K.woundDosePerCm2 * open * dirt;
  const legs = col(C.legBroken.name);
  legs[slot] = 1 - (1 - legs[slot]) * (1 - leg);
  const arms = col(C.armBroken.name);
  arms[slot] = 1 - (1 - arms[slot]) * (1 - arm);
  const strains = col(C.strain.name);
  strains[slot] = 1 - (1 - strains[slot]) * (1 - strain);
  if (open > 0 || bleed > 0 || leg > 0 || arm > 0) tallyOf(sim.state)[InjuryKind.WOUND] += 1;
  else if (strain > 0) tallyOf(sim.state)[InjuryKind.STRAIN] += 1;
}

/** Pathogens swallowed: `dose` infectious units (waterDose, meatDose), from what the world has already given up. */
export function exposeGut(sim: Sim, slot: number, dose: number): void {
  bodySlot(sim, slot, 'exposeGut');
  if (!(dose >= 0 && Number.isFinite(dose))) throw new RangeError(`exposeGut: dose ${dose}.`);
  sim.state.agents.column<Float64Array>(C.gutDose.name).data[slot] += dose;
}

/** Share of a burn of facing skin burned (partial or worse), and burned through, at heat dose `d`. */
function burnedAt(d: number, threshold: number): number {
  const x = (d - threshold) / threshold;
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

// ALIBI: a body is cut, bitten, broken and burned by the world it moves through, bleeds, takes in
// microbes through wounds and the gut, fights them off or dies of them, and heals slowly at a cost,
// whether or not any other body is near it.
export const injury: SystemDef = defineSystem({
  name: 'body.injury',
  declare(state: SimState) {
    for (const spec of Object.values(INJURY_COLUMNS)) state.agents.ensureColumn(spec);
    for (const spec of Object.values(SURROUNDINGS)) state.agents.ensureColumn(spec);
    state.addPart(injuryTally());
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    if (!agents.hasColumn(HEAT_COLUMNS.water.name)) throw new Error('body.injury needs body.heat in the pipeline.');
    const dies = deathDoor(sim, 'body.injury');
    const tally = tallyOf(state);
    const strikes = state.parts.find((part) => part.name === CLIMATE_PARTS.strikes);
    const { widthCells: W, heightCells: Hc, cellSizeM: cs } = config.world;
    const grid = new BucketGrid(W * cs, Hc * cs, 200);
    const dt = 86_400 / config.time.ticksPerDay;
    const days = dt / 86_400;
    const perYear = ticksPerYear(config);
    const s = state.streams;
    const o = globalStreamOffset(StreamDomain.BODY);
    const clotKeep = exp(-dt / K.clotSeconds);
    const ln2 = 0.6931471805599453;
    const woundFade = exp((-ln2 * days) / K.wound.fadeDays);
    const gutFade = exp((-ln2 * days) / K.gut.fadeDays);
    const burnRate = (ln2 / K.burnHalfDays) * days;
    const boneRate = (ln2 / K.boneHalfDays) * days;
    const strainRate = (ln2 / K.strainHalfDays) * days;
    const leakShare = 1 - exp(-dt / K.burnLeakSeconds);
    const leanWater = HEAT.leanWaterShare;
    const leanDensity = METABOLISM.leanKcalPerKg;
    const fatDensity = METABOLISM.fatKcalPerKg;

    /** The course of one infection over a tick: the new severity and response, into `out`. */
    function course(sev: number, response: number, virulence: number, rise: number, bounded: boolean, condition: number, out: Float64Array): void {
      const growth = bounded ? virulence * (1 - sev) : virulence;
      let sNew = sev + days * (growth - response) * sev;
      let mNew = response + days * rise * condition;
      if (sNew < K.overBelow && response > virulence) {
        sNew = 0;
        mNew = response;
      }
      out[0] = sNew > 0 ? sNew : 0;
      out[1] = mNew;
    }
    const pair = new Float64Array(2);

    function catches(dose: number): boolean {
      return dose > 0 && nextFloat(s, o) < 1 - exp(-dose);
    }

    function virulenceOf(median: number, spread: number): number {
      return median * exp(spread * nextNormal(s, o));
    }

    return () => {
      const tick = state.tick;
      const n = agents.highWater;
      const alive = agents.alive.data;
      const ids = agents.id.data;
      const f64 = (name: string) => agents.column<Float64Array>(name).data;
      const sex = agents.column<Uint8Array>(B.sex.name).data;
      const born = f64(B.born.name);
      const lean = f64(B.leanKg.name);
      const gut = f64(B.gut.name);
      const energy = f64(B.energy.name);
      const energyOut = f64(B.energyOut.name);
      const water = f64(HEAT_COLUMNS.water.name);
      const waterOut = f64(HEAT_COLUMNS.waterOut.name);
      const fireWm2 = f64(SURROUNDINGS.fireWm2.name);
      const inFire = f64(SURROUNDINGS.inFire.name);
      const bleed = f64(C.bleedMlMin.name);
      const lost = f64(C.bloodLostL.name);
      const leak = f64(C.burnLeakL.name);
      const wound = f64(C.woundCm2.name);
      const burns = f64(C.burnShare.name);
      const burnDose = f64(C.burnDose.name);
      const leg = f64(C.legBroken.name);
      const arm = f64(C.armBroken.name);
      const strain = f64(C.strain.name);
      const rebuild = f64(C.rebuildKg.name);
      const wInf = f64(C.woundInfection.name);
      const wResp = f64(C.woundResponse.name);
      const wVir = f64(C.woundVirulence.name);
      const wDose = f64(C.woundDose.name);
      const gInf = f64(C.gutInfection.name);
      const gResp = f64(C.gutResponse.name);
      const gVir = f64(C.gutVirulence.name);
      const gDose = f64(C.gutDose.name);
      const fever = f64(C.feverC.name);
      const healW = f64(C.healW.name);
      const mobility = f64(C.mobility.name);
      const armUse = f64(C.armUse.name);
      const x = f64('x');
      const y = f64('y');

      // 3. Lightning: every strike lands at a point in its cell, whoever is near.
      const struck = strikes && strikes.readings ? (strikes.readings() as Int32Array) : null;
      if (struck && struck.length > 0) {
        let bodies = 0;
        for (let slot = 0; slot < n; slot++) if (alive[slot] === 1 && sex[slot] !== Sex.NONE) bodies++;
        if (bodies > 0) grid.build(x, y, alive, n);
        for (let q = 0; q < struck.length; q++) {
          const k = struck[q];
          const i = k % W;
          const px = (i + nextFloat(s, o)) * cs;
          const py = ((k - i) / W + nextFloat(s, o)) * cs;
          if (bodies === 0) continue;
          const found = grid.query(px, py, K.strikeReachM, x, y);
          for (let r = 0; r < found; r++) {
            const slot = grid.result[r];
            if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
            const dx = x[slot] - px;
            const dy = y[slot] - py;
            const d2 = dx * dx + dy * dy;
            if (d2 > K.strikeReachM * K.strikeReachM) continue;
            const near = d2 <= K.strikeNearM * K.strikeNearM ? 1 : (K.strikeNearM * K.strikeNearM) / d2;
            tally[InjuryKind.LIGHTNING] += 1;
            if (nextFloat(s, o) < K.strikeArrest * near) {
              dies(slot, DeathCause.LIGHTNING);
              continue;
            }
            const burned = K.strikeBurn * near;
            burns[slot] += burned;
            const mass = lean[slot] + fatKgOf(energy[slot], gut[slot], lean[slot]);
            leak[slot] += K.burnLeakLPerKg * mass * burned;
          }
        }
      }

      for (let slot = 0; slot < n; slot++) {
        if (alive[slot] !== 1) continue;
        const sx = sex[slot];
        if (sx === Sex.NONE) {
          throw new Error(`body.injury: agent id ${ids[slot]} has no body; call formBody right after spawnAgent.`);
        }
        let leanKg = lean[slot];
        const fatKg = fatKgOf(energy[slot], gut[slot], leanKg);
        const mass = leanKg + fatKg;
        const condition = conditionOf(fatKg / mass);
        const nourished = (condition - K.leastCondition) / (1 - K.leastCondition);
        const skinM2 = skinAreaM2(mass);
        const skinCm2 = skinM2 * 10_000;

        // 1. Doses: an open wound keeps taking in microbes while it is open.
        wDose[slot] += K.openDosePerCm2Day * days * (wound[slot] + K.partialBurnDoseShare * burns[slot] * skinCm2);
        if (wInf[slot] === 0 && catches(wDose[slot])) {
          wInf[slot] = K.wound.start;
          wVir[slot] = virulenceOf(K.wound.virulence, K.wound.spread);
          tally[InjuryKind.WOUND_INFECTION] += 1;
        }
        wDose[slot] = 0;
        if (gInf[slot] === 0 && catches(gDose[slot])) {
          gInf[slot] = K.gut.start;
          gVir[slot] = virulenceOf(K.gut.virulence, K.gut.spread);
          tally[InjuryKind.GUT_ILLNESS] += 1;
        }
        gDose[slot] = 0;

        // 2. Fire: thermal dose on the skin facing it.
        const q = fireWm2[slot] / 1000 - K.skinCarriesKwM2;
        if (q > 0) {
          const before = burnDose[slot];
          const after = before + pow(q, 4 / 3) * dt;
          burnDose[slot] = after;
          const facing = inFire[slot] > 0 ? K.surroundedShare : K.facingShare;
          const burned = facing * (burnedAt(after, K.partialBurnDose) - burnedAt(before, K.partialBurnDose));
          const through = facing * (burnedAt(after, K.fullBurnDose) - burnedAt(before, K.fullBurnDose));
          if (burned > 0 || through > 0) {
            if (before < K.partialBurnDose) tally[InjuryKind.BURN] += 1;
            let partial = burns[slot] + burned - through;
            partial = partial < 0 ? 0 : partial > 1 ? 1 : partial;
            burns[slot] = partial;
            wound[slot] += through * skinCm2;
            leak[slot] += K.burnLeakLPerKg * mass * burned;
          }
        } else {
          burnDose[slot] = 0;
        }

        // 4. Blood: bleeding, plasma leaking after burns, refilling from the body's water.
        const volume = bloodVolumeL(leanKg);
        if (bleed[slot] > 0) {
          const rate = bleed[slot];
          const litres = (rate / 60_000) * K.clotSeconds * (1 - clotKeep);
          const next = rate * clotKeep;
          bleed[slot] = next < K.bleedStopMlMin ? 0 : next;
          lost[slot] += litres;
          // Lost blood is lost lean tissue: its mass, energy and water leave the body.
          let kg = litres * K.bloodKgPerL;
          if (kg > leanKg * 0.5) kg = leanKg * 0.5;
          leanKg -= kg;
          lean[slot] = leanKg;
          energy[slot] -= leanDensity * kg;
          energyOut[slot] += leanDensity * kg;
          water[slot] -= leanWater * kg;
          waterOut[slot] += leanWater * kg;
          rebuild[slot] += kg;
        }
        if (leak[slot] > 0) {
          const leaked = leak[slot] * leakShare;
          leak[slot] -= leaked;
          if (leak[slot] < 1e-6) leak[slot] = 0;
          lost[slot] += leaked;
        }
        if (lost[slot] > 0) {
          let hydrated = 1 - (fullWaterKg(leanKg) - water[slot]) / (HEAT.fatalDeficitShare * mass);
          hydrated = hydrated < 0 ? 0 : hydrated > 1 ? 1 : hydrated;
          lost[slot] -= lost[slot] * (dt / K.refillSeconds) * hydrated;
          if (lost[slot] < 1e-6) lost[slot] = 0;
        }

        // 5. Infection courses.
        if (wInf[slot] > 0) {
          course(wInf[slot], wResp[slot], wVir[slot], K.wound.rise, K.wound.bounded, condition, pair);
          wInf[slot] = pair[0];
          wResp[slot] = pair[1];
        } else if (wResp[slot] > 0) {
          wResp[slot] *= woundFade;
        }
        if (gInf[slot] > 0) {
          course(gInf[slot], gResp[slot], gVir[slot], K.gut.rise, K.gut.bounded, condition, pair);
          gInf[slot] = pair[0];
          gResp[slot] = pair[1];
        } else if (gResp[slot] > 0) {
          gResp[slot] *= gutFade;
        }

        // 6. Healing, slowed by poor condition.
        const heal = condition;
        if (wound[slot] > 0) {
          const slowed = wInf[slot] >= K.infectedSlows ? K.infectedHealShare : 1;
          const area = wound[slot] - 2 * Math.sqrt(Math.PI * wound[slot]) * K.edgeCmPerDay * days * heal * slowed;
          wound[slot] = area < 0.01 ? 0 : area;
        }
        if (burns[slot] > 0) {
          burns[slot] -= burns[slot] * burnRate * heal;
          if (burns[slot] < 1e-5) burns[slot] = 0;
        }
        if (leg[slot] > 0) leg[slot] = leg[slot] < 1e-3 ? 0 : leg[slot] * (1 - boneRate * heal);
        if (arm[slot] > 0) arm[slot] = arm[slot] < 1e-3 ? 0 : arm[slot] * (1 - boneRate * heal);
        if (strain[slot] > 0) strain[slot] = strain[slot] < 1e-3 ? 0 : strain[slot] * (1 - strainRate * heal);
        let rebuiltKcal = 0;
        if (rebuild[slot] > 0 && nourished > 0) {
          // Energy moves from fat to lean inside the stock; only the cost of rebuilding leaves as heat.
          let kg = rebuild[slot] * K.rebuildPerDay * days * nourished;
          const spareFat = fatKg - K.rebuildKeepsFatKg;
          const most = spareFat > 0 ? (spareFat * fatDensity) / (leanDensity * (1 + K.rebuildCost)) : 0;
          if (kg > most) kg = most;
          if (kg > 0) {
            leanKg += kg;
            lean[slot] = leanKg;
            rebuild[slot] -= kg;
            if (rebuild[slot] < 1e-6) rebuild[slot] = 0;
            rebuiltKcal = leanDensity * kg;
          }
        }

        // 7. Water: through burned and open skin, and diarrhoea.
        const openShare = burns[slot] + wound[slot] / skinCm2;
        const openPct = openShare > 1 ? 100 : 100 * openShare;
        const drained =
          (K.burnWaterMlPerPctM2H * openPct * skinM2 * dt) / 3_600_000 + K.diarrhoeaKgPerDay * gInf[slot] * days;
        if (drained > 0) {
          water[slot] -= drained;
          waterOut[slot] += drained;
        }

        // 8. Outputs.
        let sick = wInf[slot] + 0.5 * gInf[slot];
        if (sick > 1) sick = 1;
        const feverNow = feverOf(sick);
        fever[slot] = feverNow;
        const basalW = (basalKcalPerDay(sx, (tick - born[slot]) / perYear, mass) * JOULES_PER_KCAL) / 86_400;
        let bones = leg[slot] + arm[slot];
        if (bones > 1) bones = 1;
        let skin = K.burnHeat * openShare;
        if (skin > 1) skin = 1;
        let extra = K.boneHeat * bones + skin + (K.infectionHeat * sick) / (sick + K.infectionHeatHalfAt);
        if (extra > K.mostHeat) extra = K.mostHeat;
        healW[slot] = extra * basalW + (K.rebuildCost * rebuiltKcal * JOULES_PER_KCAL) / dt;
        let shock = lost[slot] / (K.fatalVolumeShare * volume);
        if (shock > 1) shock = 1;
        mobility[slot] =
          (1 - K.legLoss * leg[slot]) *
          (1 - K.strainLoss * strain[slot]) *
          (1 - K.shockLoss * shock) *
          (1 - (K.feverLoss * feverNow) / K.feverMostC);
        armUse[slot] = 1 - K.armLoss * arm[slot];

        // 9. Death.
        let cause = 0;
        if (lost[slot] >= K.fatalVolumeShare * bloodVolumeL(leanKg)) cause = DeathCause.SHOCK;
        else if (wInf[slot] >= K.fatalSeverity) cause = DeathCause.INFECTION;
        if (cause !== 0) dies(slot, cause);
      }
    };
  },
});
