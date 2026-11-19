// Metabolism: what keeping a body alive and moving costs, where the energy is
// stored, and starvation (docs/DESIGN.md §3.1, §3.8).
//
// The body's energy is one conserved stock: the gut's contents, fat, and lean
// tissue, counted at the energy densities of their change. Fat is never stored
// on its own; it is whatever the stock leaves after the gut and the lean mass,
// so no part of the body can hold energy the stock didn't account for.

import { ticksPerYear } from '../core/clock.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sink, Source } from '../core/codec.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';

export const Sex = { NONE: 0, FEMALE: 1, MALE: 2 } as const;

/**
 * How hard the body worked while it wasn't moving from place to place, as an
 * index into METABOLISM.effortRatio. STILL is 0, so a tick nobody describes is
 * spent lying or sitting awake.
 */
export const Effort = { STILL: 0, SLEEP: 1, LIGHT: 2, MODERATE: 3, HEAVY: 4 } as const;

/**
 * Causes of death counted in `body.deaths` (index = cause). Starvation is metabolism's;
 * dehydration, hyperthermia and hypothermia body.heat's (§3.9); shock (blood or plasma lost),
 * infection and lightning body.injury's (§3.10).
 */
export const DeathCause = {
  STARVATION: 1,
  DEHYDRATION: 2,
  HYPERTHERMIA: 3,
  HYPOTHERMIA: 4,
  SHOCK: 5,
  INFECTION: 6,
  LIGHTNING: 7,
} as const;

export const METABOLISM = {
  /** Energy density of fat, kcal per kg (39.5 MJ/kg; Hall 2008). */
  fatKcalPerKg: 39_500 / 4.184,
  /** Energy density of a change in lean mass, kcal per kg (7.6 MJ/kg; Hall 2008). */
  leanKcalPerKg: 7_600 / 4.184,
  /** Forbes's constant: dL/dF = forbesKg / F (Hall 2008, after Forbes). */
  forbesKg: 10.4,
  /** Fastest the gut passes food into the tissues, kcal per minute [estimate]. */
  absorbKcalPerMinute: 3,
  /** Share of absorbed energy spent as heat in absorbing it: the thermic effect of food [estimate]. */
  thermicShare: 0.1,
  /** Below this share of its built lean mass, a body dies of starvation [estimate, DESIGN §3.8]. */
  starveLeanShare: 2 / 3,
  /**
   * Physical activity ratios, multiples of the basal rate, by Effort index
   * (FAO/WHO/UNU 2004, Table 5.1; HEAVY is an estimate).
   */
  effortRatio: [1.4, 1.0, 2.2, 4.1, 6.0] as readonly number[],
  /** The upright body's share while moving, as a multiple of the basal rate. */
  movingRatio: 1.4,
  /** Below this speed the body walks; at or above it, it runs (m/s). */
  runFromMps: 2.0,
  /** Pandolf's terrain factor (light brush), the same everywhere for now. */
  terrainFactor: 1.2,
  /** Pandolf's walking term: watts per kg per (m/s)². */
  walkWattsPerKg: 1.5,
  /** Net cost of running, kcal per kg per km. */
  runKcalPerKgKm: 1.0,
  /** Pandolf's grade term, as joules per kg per metre climbed (0.35 W/kg per m/s per percent). */
  climbJoulesPerKgM: 35,
  /** Pandolf's load term: watts per kg of body and load per (load ÷ body mass)². */
  loadWattsPerKg: 2.0,
} as const;
const M = METABOLISM;
const JOULES_PER_KCAL = 4184;

/**
 * Schofield equations, kcal a day from body mass in kg (FAO/WHO/UNU 2004,
 * Table 5.2): [upper age of the band in years, slope, intercept].
 */
const SCHOFIELD: Readonly<Record<1 | 2, ReadonlyArray<readonly [number, number, number]>>> = {
  [Sex.FEMALE]: [
    [3, 58.317, -31.1],
    [10, 20.315, 485.9],
    [18, 13.384, 692.6],
    [30, 14.818, 486.6],
    [60, 8.126, 845.6],
    [Infinity, 9.082, 658.5],
  ],
  [Sex.MALE]: [
    [3, 59.512, -30.4],
    [10, 22.706, 504.3],
    [18, 17.686, 658.2],
    [30, 15.057, 692.2],
    [60, 11.472, 873.1],
    [Infinity, 11.711, 587.7],
  ],
};

/** Basal metabolic rate, kcal a day, for a body of this sex, age (years) and mass (kg). */
export function basalKcalPerDay(sex: number, ageYears: number, massKg: number): number {
  const bands = SCHOFIELD[sex as 1 | 2];
  if (!bands) throw new RangeError(`basalKcalPerDay: no such sex ${sex}.`);
  let band = bands[bands.length - 1];
  for (const candidate of bands) {
    if (ageYears < candidate[0]) {
      band = candidate;
      break;
    }
  }
  const rate = band[1] * massKg + band[2];
  return rate > 1 ? rate : 1;
}

/** Fat in kg from the energy stock, the gut and the lean mass. */
export function fatKgOf(energyKcal: number, gutKcal: number, leanKg: number): number {
  return (energyKcal - gutKcal - M.leanKcalPerKg * leanKg) / M.fatKcalPerKg;
}

export const BODY_COLUMNS = {
  sex: { name: 'sex', dtype: 'u8', category: 'genome' },
  born: { name: 'born', dtype: 'f64', category: 'identity' },
  leanKg: { name: 'leanKg', dtype: 'f64', category: 'body' },
  leanBuiltKg: { name: 'leanBuiltKg', dtype: 'f64', category: 'body' },
  /** Food eaten and not yet absorbed, kcal: a share of `energy`, not a store of its own. */
  gut: { name: 'gut', dtype: 'f64', category: 'body' },
  energy: { name: 'energy', dtype: 'f64', category: 'body', conserved: { quantity: 'energy', role: 'stock' } },
  energyIn: { name: 'energyIn', dtype: 'f64', category: 'body', conserved: { quantity: 'energy', role: 'inflow' } },
  energyOut: { name: 'energyOut', dtype: 'f64', category: 'body', conserved: { quantity: 'energy', role: 'outflow' } },
  // What the body did this tick: written by whatever makes it act, cleared by metabolism.
  effort: { name: 'effort', dtype: 'u8', category: 'body' },
  movedM: { name: 'movedM', dtype: 'f64', category: 'body' },
  movingS: { name: 'movingS', dtype: 'f64', category: 'body' },
  climbedM: { name: 'climbedM', dtype: 'f64', category: 'body' },
  loadKg: { name: 'loadKg', dtype: 'f64', category: 'body' },
  /** Heat made by shivering this tick, W: asked for by body.heat (§3.9), charged and cleared by metabolism. */
  shiverW: { name: 'shiverW', dtype: 'f64', category: 'body' },
  /** Heat made in the last tick apart from shivering, W: written by metabolism, read by body.heat. */
  heatW: { name: 'heatW', dtype: 'f64', category: 'body' },
  /**
   * What the body spent on its activity in the last tick, in multiples of its basal rate (effort,
   * standing while moving, the motion, the load; not food's thermic effect, healing or shivering):
   * written by metabolism, read by body.fitness (§3.11).
   */
  exertion: { name: 'exertion', dtype: 'f64', category: 'body' },
  /**
   * The daily load, in load-hours, the body was used to when it formed (§3.11): written by formBody,
   * read once and cleared by body.fitness.
   */
  conditionedTo: { name: 'conditionedTo', dtype: 'f64', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const C = BODY_COLUMNS;
/** body.injury's heat of healing (§3.10), named here so metabolism need not import injury. */
const HEAL_COLUMN = 'healW';

export const BODY_PARTS = { deaths: 'body.deaths' } as const;
/** Readings of `body.deaths`: index = DeathCause, value = deaths so far. */
const DEATH_SLOTS = 8;

function declareBody(state: SimState): void {
  for (const spec of Object.values(BODY_COLUMNS)) state.agents.ensureColumn(spec);
}

function deathTally(): StatePart {
  const counts = new Float64Array(DEATH_SLOTS);
  return {
    name: BODY_PARTS.deaths,
    holdsLearned: false,
    readings: () => counts,
    write(sink: Sink) {
      sink.array(counts);
    },
    read(source: Source) {
      const saved = source.array('f64');
      if (saved.length !== counts.length) throw new Error('body.deaths: snapshot has the wrong length.');
      counts.set(saved);
    },
  };
}

export interface BodySpec {
  readonly sex: 1 | 2;
  readonly ageYears: number;
  readonly leanKg: number;
  readonly fatKg: number;
  /**
   * The daily load, in load-hours, the body has been living at (§3.11): an adult formed after a
   * forager's life comes with that life's fitness and trained muscle. 0, the default, is a body that
   * has never worked, like a newborn.
   */
  readonly conditionedTo?: number;
}

/**
 * Give a newly spawned agent its body. Call it right after spawnAgent: sex is
 * fixed at conception, so a slot that already has a body is refused. The
 * body's energy is recorded as the first inflow, which keeps the audit's
 * identity from the first tick.
 */
export function formBody(sim: Sim, slot: number, spec: BodySpec): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`formBody: slot ${slot} holds no agent.`);
  const sex = agents.column<Uint8Array>(C.sex.name).data;
  if (sex[slot] !== Sex.NONE) throw new Error(`formBody: agent id ${agents.id.data[slot]} already has a body.`);
  if (spec.sex !== Sex.FEMALE && spec.sex !== Sex.MALE) throw new RangeError(`formBody: no such sex ${spec.sex}.`);
  if (!(spec.ageYears >= 0 && spec.ageYears < 200)) throw new RangeError(`formBody: age ${spec.ageYears}.`);
  if (!(spec.leanKg > 0 && spec.leanKg < 500)) throw new RangeError(`formBody: lean mass ${spec.leanKg}.`);
  if (!(spec.fatKg > 0 && spec.fatKg < 500)) throw new RangeError(`formBody: fat ${spec.fatKg}.`);
  const conditioned = spec.conditionedTo ?? 0;
  if (!(conditioned >= 0 && conditioned < 1000)) throw new RangeError(`formBody: conditioned to ${conditioned}.`);
  const energy = M.fatKcalPerKg * spec.fatKg + M.leanKcalPerKg * spec.leanKg;
  sex[slot] = spec.sex;
  agents.column<Float64Array>(C.born.name).data[slot] = sim.state.tick - spec.ageYears * ticksPerYear(sim.config);
  agents.column<Float64Array>(C.leanKg.name).data[slot] = spec.leanKg;
  agents.column<Float64Array>(C.leanBuiltKg.name).data[slot] = spec.leanKg;
  agents.column<Float64Array>(C.gut.name).data[slot] = 0;
  agents.column<Float64Array>(C.energy.name).data[slot] = energy;
  agents.column<Float64Array>(C.energyIn.name).data[slot] = energy;
  agents.column<Float64Array>(C.energyOut.name).data[slot] = 0;
  agents.column<Float64Array>(C.conditionedTo.name).data[slot] = conditioned;
}

/** Put food into an agent's gut: `kcal` of metabolizable energy, which the world has already given up. */
export function ingest(sim: Sim, slot: number, kcal: number): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`ingest: slot ${slot} holds no agent.`);
  if (agents.column<Uint8Array>(C.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`ingest: agent id ${agents.id.data[slot]} has no body.`);
  }
  if (!(kcal >= 0 && Number.isFinite(kcal))) throw new RangeError(`ingest: ${kcal} kcal.`);
  agents.column<Float64Array>(C.gut.name).data[slot] += kcal;
  agents.column<Float64Array>(C.energy.name).data[slot] += kcal;
  agents.column<Float64Array>(C.energyIn.name).data[slot] += kcal;
}

/**
 * Energy (kcal) a body of mass `massKg` carrying `loadKg` spends on moving
 * `movedM` metres in `movingS` seconds and climbing `climbedM` metres, over and
 * above its basal share. Pandolf et al. (1977) for walking, climbing and load;
 * the net cost of running above METABOLISM.runFromMps.
 */
export function motionKcal(massKg: number, loadKg: number, movedM: number, movingS: number, climbedM: number): number {
  const total = massKg + loadKg;
  let joules = 0;
  if (movedM > 0) {
    const speed = movedM / movingS;
    if (speed < M.runFromMps) joules += M.terrainFactor * total * M.walkWattsPerKg * speed * movedM;
    else joules += M.runKcalPerKgKm * total * (movedM / 1000) * JOULES_PER_KCAL;
  }
  if (climbedM > 0) joules += M.climbJoulesPerKgM * M.terrainFactor * total * climbedM;
  return joules / JOULES_PER_KCAL;
}

// ALIBI: a body burns energy to stay alive and more to move and work, stores the surplus as fat
// and lean tissue, draws on them when food runs short, and dies when they run out, whether or not
// it ever meets another body.
export const metabolism: SystemDef = defineSystem({
  name: 'body.metabolism',
  declare(state: SimState) {
    declareBody(state);
    state.addPart(deathTally());
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    const secondsPerTick = 86_400 / config.time.ticksPerDay;
    const perYear = ticksPerYear(config);
    const absorbPerTick = (M.absorbKcalPerMinute * secondsPerTick) / 60;
    const fatDensity = M.fatKcalPerKg;
    const leanDensity = M.leanKcalPerKg;
    const forbes = M.forbesKg;
    const ratios = M.effortRatio;
    const deaths = state.parts.find((part) => part.name === BODY_PARTS.deaths);
    if (!deaths || !deaths.readings) throw new Error('body.metabolism: its death tally is missing.');
    const deathCounts = deaths.readings() as Float64Array;
    // The heat of healing and fighting infection, when the pipeline holds body.injury (§3.10).
    const healing = agents.hasColumn(HEAL_COLUMN);

    return () => {
      const tick = state.tick;
      const alive = agents.alive.data;
      const ids = agents.id.data;
      const sex = agents.column<Uint8Array>(C.sex.name).data;
      const born = agents.column<Float64Array>(C.born.name).data;
      const lean = agents.column<Float64Array>(C.leanKg.name).data;
      const leanBuilt = agents.column<Float64Array>(C.leanBuiltKg.name).data;
      const gut = agents.column<Float64Array>(C.gut.name).data;
      const energy = agents.column<Float64Array>(C.energy.name).data;
      const energyOut = agents.column<Float64Array>(C.energyOut.name).data;
      const effort = agents.column<Uint8Array>(C.effort.name).data;
      const moved = agents.column<Float64Array>(C.movedM.name).data;
      const moving = agents.column<Float64Array>(C.movingS.name).data;
      const climbed = agents.column<Float64Array>(C.climbedM.name).data;
      const load = agents.column<Float64Array>(C.loadKg.name).data;
      const shiver = agents.column<Float64Array>(C.shiverW.name).data;
      const heat = agents.column<Float64Array>(C.heatW.name).data;
      const exertion = agents.column<Float64Array>(C.exertion.name).data;
      const heal = healing ? agents.column<Float64Array>(HEAL_COLUMN).data : null;

      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        const s = sex[slot];
        if (s === Sex.NONE) {
          throw new Error(`body.metabolism: agent id ${ids[slot]} has no body; call formBody right after spawnAgent.`);
        }
        const leanKg = lean[slot];
        const fatKg = fatKgOf(energy[slot], gut[slot], leanKg);
        if (!(fatKg > 0)) throw new Error(`body.metabolism: agent id ${ids[slot]} has ${fatKg} kg of fat.`);
        const mass = leanKg + fatKg;

        // 1. Absorption.
        const inGut = gut[slot];
        const absorbed = inGut < absorbPerTick ? inGut : absorbPerTick;
        gut[slot] = inGut - absorbed;

        // 2. Spending.
        const ratio = ratios[effort[slot]];
        if (ratio === undefined) throw new RangeError(`body.metabolism: agent id ${ids[slot]} has effort ${effort[slot]}.`);
        let movingSeconds = moving[slot];
        const metres = moved[slot];
        const carried = load[slot];
        const shivering = shiver[slot];
        if (!(movingSeconds >= 0 && metres >= 0 && climbed[slot] >= 0 && carried >= 0 && shivering >= 0)) {
          throw new RangeError(`body.metabolism: agent id ${ids[slot]} reports a negative or missing movement.`);
        }
        if (movingSeconds > secondsPerTick) movingSeconds = secondsPerTick;
        if (metres > 0 && movingSeconds === 0) {
          throw new RangeError(`body.metabolism: agent id ${ids[slot]} moved ${metres} m in no time.`);
        }
        const basalPerSecond = basalKcalPerDay(s, (tick - born[slot]) / perYear, mass) / 86_400;
        let active =
          basalPerSecond * (ratio * (secondsPerTick - movingSeconds) + M.movingRatio * movingSeconds) +
          motionKcal(mass, carried, metres, movingSeconds, climbed[slot]);
        if (carried > 0) {
          const share = carried / mass;
          active += (M.loadWattsPerKg * (mass + carried) * share * share * secondsPerTick) / JOULES_PER_KCAL;
        }
        exertion[slot] = active / (basalPerSecond * secondsPerTick);
        let spent = active + M.thermicShare * absorbed;
        if (heal) {
          const healingW = heal[slot];
          if (!(healingW >= 0)) throw new RangeError(`body.metabolism: agent id ${ids[slot]} reports healing heat ${healingW}.`);
          spent += (healingW * secondsPerTick) / JOULES_PER_KCAL;
          heal[slot] = 0;
        }
        heat[slot] = (spent * JOULES_PER_KCAL) / secondsPerTick;
        // Shivering: the heat body.heat asked for (DESIGN.md §3.9).
        spent += (shivering * secondsPerTick) / JOULES_PER_KCAL;
        energy[slot] -= spent;
        energyOut[slot] += spent;

        // 3. Tissues: Forbes's rule splits the net change between fat and lean.
        const net = absorbed - spent;
        const leanPerFat = forbes / fatKg;
        const fatChange = net / (fatDensity + leanDensity * leanPerFat);
        const newLean = leanKg + leanPerFat * fatChange;
        lean[slot] = newLean;

        effort[slot] = Effort.STILL;
        moved[slot] = 0;
        moving[slot] = 0;
        climbed[slot] = 0;
        load[slot] = 0;
        shiver[slot] = 0;

        // 4. Starvation.
        if (newLean < M.starveLeanShare * leanBuilt[slot]) {
          deathCounts[DeathCause.STARVATION] += 1;
          agents.remove(slot);
        }
      }
    };
  },
});
