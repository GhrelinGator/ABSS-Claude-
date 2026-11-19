// Fitness, fatigue, load injuries and muscle (docs/DESIGN.md §3.4, §3.11):
// Banister's fitness–fatigue model over the work a body does, strains when the
// recent load outruns the long-term one, and muscle that the work builds and
// rest loses. The same system declares the skill columns (skills.ts), which
// acts write through their own door.
//
// Everything here is the body's own physiology, in real days like all daily
// physiology (D-024, D-026). It runs after body.metabolism, which writes the
// tick's exertion.

import { ticksPerYear } from '../core/clock.ts';
import { exp, pow } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextFloat } from '../core/rng.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sim, SimState } from '../sim.ts';
import { INJURY, INJURY_COLUMNS, injure } from './injury.ts';
import { BODY_COLUMNS, METABOLISM, Sex, fatKgOf } from './metabolism.ts';
import { capacityAtAge, strengthAtAge } from './lifecourse.ts';
import { declareSkills } from './skills.ts';

/** Every number fitness uses, in one place. Estimates unless a source is named (docs/RESEARCH.md). */
export const FITNESS = {
  /** Exertion (× basal) below which work adds no load: FAO's ratio for standing and handling light things. */
  lightRatio: 2.2,
  /** Load-hours a day of a forager's working day (§3.8's scripted Hadza-like day: about 8.3): the scale's anchor. */
  referencePerDay: 8,
  /** Time constants of the running averages of the daily load, days: Banister's fitness and fatigue, and the chronic load of the acute:chronic ratio. */
  fitnessDays: 42,
  fatigueDays: 7,
  chronicDays: 28,
  /** Banister's gains: performance = fitnessGain × fitnessDays × fitness − fatigueGain × fatigueDays × fatigue. */
  fitnessGain: 1,
  fatigueGain: 2,
  /** Capacity = 1 + spread × (performance − reference) ÷ reference, between least and most. */
  capacitySpread: 0.2,
  leastCapacity: 0.5,
  mostCapacity: 1.3,
  /** Strains per load-hour at an acute:chronic ratio of 1 or less. */
  strainPerLoadHour: 1.7e-4,
  /** The chronic load is counted as at least this, load-hours a day: the walking of ordinary life. */
  chronicFloorPerDay: 1,
  /** Risk factor 1 + rise × (ratio − 1)² above a ratio of 1, at most `mostRisk` (after Gabbett 2016, as remembered). */
  ratioRise: 4,
  mostRisk: 8,
  /** A strain's severity, share of capacity for hard effort lost: least + spread × u², u uniform. */
  strainLeast: 0.05,
  strainSpread: 0.55,
  /** Trained muscle's target: share × frame × (1 − e^(−fatigue ÷ reference)). */
  muscleShare: 0.1,
  /** Time constants, days, of losing muscle above the target and of building it below. */
  muscleLossDays: 20,
  muscleGainDays: 120,
  /** Strength = (lean mass ÷ this)^(2/3) × (1 − strainLoss × strain). */
  strengthLeanKg: 50,
  strengthStrainLoss: 0.5,
} as const;
const K = FITNESS;

export const FITNESS_COLUMNS = {
  /** Running averages of the daily load, load-hours a day: over 42 days, 7 days and 28 days. */
  fitness: { name: 'fitness', dtype: 'f64', category: 'body' },
  fatigue: { name: 'fatigue', dtype: 'f64', category: 'body' },
  chronicLoad: { name: 'chronicLoad', dtype: 'f64', category: 'body' },
  /** Lean mass added by work on top of the frame, kg; built lean mass includes it. */
  trainedKg: { name: 'trainedKg', dtype: 'f64', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const C = FITNESS_COLUMNS;
const B = BODY_COLUMNS;

/** Steady performance at the reference load. */
const REFERENCE_PERFORMANCE = (K.fitnessGain * K.fitnessDays - K.fatigueGain * K.fatigueDays) * K.referencePerDay;

/** Capacity from fitness and fatigue: the share of a conditioned forager's sustained work rate. */
export function capacity(fitness: number, fatigue: number): number {
  const p = K.fitnessGain * K.fitnessDays * fitness - K.fatigueGain * K.fatigueDays * fatigue;
  const c = 1 + (K.capacitySpread * (p - REFERENCE_PERFORMANCE)) / REFERENCE_PERFORMANCE;
  return c < K.leastCapacity ? K.leastCapacity : c > K.mostCapacity ? K.mostCapacity : c;
}

/** How much the acute:chronic ratio multiplies the risk of a strain. */
export function riskFactor(fatigue: number, chronic: number): number {
  const ratio = fatigue / (chronic > K.chronicFloorPerDay ? chronic : K.chronicFloorPerDay);
  if (ratio <= 1) return 1;
  const f = 1 + K.ratioRise * (ratio - 1) * (ratio - 1);
  return f > K.mostRisk ? K.mostRisk : f;
}

/** Trained muscle a body tends toward, kg, from its frame (kg) and its recent load (fatigue). */
export function muscleTarget(frameKg: number, fatigue: number): number {
  return K.muscleShare * frameKg * (1 - exp(-fatigue / K.referencePerDay));
}

/** Strength relative to a body of 50 kg of lean mass, less what a strain takes. */
export function strength(leanKg: number, strain: number): number {
  return pow(leanKg / K.strengthLeanKg, 2 / 3) * (1 - K.strengthStrainLoss * strain);
}

function bodySlot(sim: Sim, slot: number, door: string): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`${door}: slot ${slot} holds no agent.`);
  if (!agents.hasColumn(C.fitness.name)) throw new Error(`${door}: the pipeline has no body.fitness.`);
  if (agents.column<Uint8Array>(B.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`${door}: agent id ${agents.id.data[slot]} has no body.`);
  }
}

/** A body's age in years now. */
function ageOf(sim: Sim, slot: number): number {
  return (sim.state.tick - sim.state.agents.column<Float64Array>(B.born.name).data[slot]) / ticksPerYear(sim.config);
}

/** A body's capacity now, less what age has taken (§3.12), for the acts of Phase 3 to read beside mobility. */
export function capacityOf(sim: Sim, slot: number): number {
  bodySlot(sim, slot, 'capacityOf');
  const f64 = (name: string) => sim.state.agents.column<Float64Array>(name).data;
  return capacity(f64(C.fitness.name)[slot], f64(C.fatigue.name)[slot]) * capacityAtAge(ageOf(sim, slot));
}

/** A body's strength now, less what age has taken beyond its shrinking frame (§3.12), for the acts of Phase 3 to read. */
export function strengthOf(sim: Sim, slot: number): number {
  bodySlot(sim, slot, 'strengthOf');
  const f64 = (name: string) => sim.state.agents.column<Float64Array>(name).data;
  return strength(f64(B.leanKg.name)[slot], f64(INJURY_COLUMNS.strain.name)[slot]) * strengthAtAge(ageOf(sim, slot));
}

// ALIBI: a body that works hard grows fitter and stronger, tires, tears muscle when it works far
// harder than it is used to, and loses what it built when it rests, whether or not it ever meets
// another body.
export const fitness: SystemDef = defineSystem({
  name: 'body.fitness',
  declare(state: SimState) {
    for (const spec of Object.values(FITNESS_COLUMNS)) state.agents.ensureColumn(spec);
    declareSkills(state);
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    if (!agents.hasColumn(B.exertion.name)) throw new Error('body.fitness needs body.metabolism in the pipeline.');
    if (!agents.hasColumn(INJURY_COLUMNS.strain.name)) throw new Error('body.fitness needs body.injury in the pipeline.');
    const ticksPerDay = config.time.ticksPerDay;
    const dt = 86_400 / ticksPerDay;
    const hours = dt / 3600;
    const tickDays = 1 / ticksPerDay;
    const keepFitness = exp(-tickDays / K.fitnessDays);
    const keepFatigue = exp(-tickDays / K.fatigueDays);
    const keepChronic = exp(-tickDays / K.chronicDays);
    const lossShare = 1 - exp(-tickDays / K.muscleLossDays);
    const gainShare = 1 - exp(-tickDays / K.muscleGainDays);
    const leanDensity = METABOLISM.leanKcalPerKg;
    const fatDensity = METABOLISM.fatKcalPerKg;
    const buildCost = INJURY.rebuildCost;
    const s = state.streams;
    const o = globalStreamOffset(StreamDomain.LOAD);

    return () => {
      const alive = agents.alive.data;
      const ids = agents.id.data;
      const f64 = (name: string) => agents.column<Float64Array>(name).data;
      const sex = agents.column<Uint8Array>(B.sex.name).data;
      const lean = f64(B.leanKg.name);
      const leanBuilt = f64(B.leanBuiltKg.name);
      const gut = f64(B.gut.name);
      const energy = f64(B.energy.name);
      const energyOut = f64(B.energyOut.name);
      const exertion = f64(B.exertion.name);
      const conditioned = f64(B.conditionedTo.name);
      const fit = f64(C.fitness.name);
      const tired = f64(C.fatigue.name);
      const chronic = f64(C.chronicLoad.name);
      const trained = f64(C.trainedKg.name);

      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        if (sex[slot] === Sex.NONE) {
          throw new Error(`body.fitness: agent id ${ids[slot]} has no body; call formBody right after spawnAgent.`);
        }

        // A body formed after a working life: its averages and trained muscle, at its lean mass as formed.
        const used = conditioned[slot];
        if (used > 0) {
          fit[slot] = used;
          tired[slot] = used;
          chronic[slot] = used;
          const a = K.muscleShare * (1 - exp(-used / K.referencePerDay));
          trained[slot] = (a * leanBuilt[slot]) / (1 + a);
          conditioned[slot] = 0;
        }

        // 1. The tick's load, and the running averages.
        const ratio = exertion[slot];
        if (!(ratio >= 0)) throw new RangeError(`body.fitness: agent id ${ids[slot]} has exertion ${ratio}.`);
        const load = ratio > K.lightRatio ? (ratio - K.lightRatio) * hours : 0;
        const perDay = load * ticksPerDay;
        fit[slot] = fit[slot] * keepFitness + (1 - keepFitness) * perDay;
        tired[slot] = tired[slot] * keepFatigue + (1 - keepFatigue) * perDay;
        chronic[slot] = chronic[slot] * keepChronic + (1 - keepChronic) * perDay;

        // 3. Strains, while the body works.
        if (load > 0) {
          const chance = 1 - exp(-K.strainPerLoadHour * load * riskFactor(tired[slot], chronic[slot]));
          if (nextFloat(s, o) < chance) {
            const u = nextFloat(s, o);
            injure(sim, slot, { strain: K.strainLeast + K.strainSpread * u * u });
          }
        }

        // 4. Muscle: toward the target the recent load sets; lean and built lean move together.
        const m = trained[slot];
        const target = muscleTarget(leanBuilt[slot] - m, tired[slot]);
        let change = 0;
        if (target < m) {
          // Lost: energy moves from lean to fat inside the stock.
          change = (target - m) * lossShare;
        } else if (target > m) {
          // Built from fat, with nourishment, paying a share of the energy as heat.
          const leanKg = lean[slot];
          const fatKg = fatKgOf(energy[slot], gut[slot], leanKg);
          let nourished = (fatKg / (leanKg + fatKg) - INJURY.nourishedFrom) / (INJURY.nourishedAt - INJURY.nourishedFrom);
          nourished = nourished < 0 ? 0 : nourished > 1 ? 1 : nourished;
          change = (target - m) * gainShare * nourished;
          const spare = fatKg - INJURY.rebuildKeepsFatKg;
          const most = spare > 0 ? (spare * fatDensity) / (leanDensity * (1 + buildCost)) : 0;
          if (change > most) change = most;
          if (change > 0) {
            const heat = buildCost * leanDensity * change;
            energy[slot] -= heat;
            energyOut[slot] += heat;
          }
        }
        if (change !== 0) {
          trained[slot] = m + change;
          lean[slot] += change;
          leanBuilt[slot] += change;
        }
      }
    };
  },
});
