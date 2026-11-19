// Growth and aging (docs/DESIGN.md §3.5, §3.12): a body's frame grows along
// the frame curve while it is young and shrinks along it when it is old, and
// the body dies of old age at an age drawn once, from a hazard that rises with
// age. What age takes from capacity, strength and skill is applied where they
// are read (fitness.ts, skills.ts); the curve and the hazard are lifecourse.ts.
//
// Runs last, after body.fitness, so the first tick it sees a body formed after
// a working life, that body's trained muscle is already split from its frame.

import { ticksPerYear } from '../core/clock.ts';
import { exp } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextExponential } from '../core/rng.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sim, SimState } from '../sim.ts';
import { INJURY } from './injury.ts';
import { LIFECOURSE, frameShare, oldAgeDeathAge } from './lifecourse.ts';
import { BODY_COLUMNS, DeathCause, METABOLISM, Sex, deathDoor, fatKgOf } from './metabolism.ts';

export const AGING_COLUMNS = {
  /** The age, in years, at which the body dies of old age: drawn the first tick body.aging sees it; 0 until then. */
  oldAgeAtYears: { name: 'oldAgeAtYears', dtype: 'f64', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const C = AGING_COLUMNS;
const B = BODY_COLUMNS;
const K = LIFECOURSE;
/** body.fitness's trained muscle (§3.11), when the pipeline holds it. */
const TRAINED_COLUMN = 'trainedKg';

// ALIBI: a body grows from birth to its adult size when it is fed, wears out with age, and dies of
// it, whether or not it ever meets another body.
export const aging: SystemDef = defineSystem({
  name: 'body.aging',
  declare(state: SimState) {
    for (const spec of Object.values(AGING_COLUMNS)) state.agents.ensureColumn(spec);
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    if (!agents.hasColumn(B.adultFrameKg.name)) throw new Error('body.aging needs body.metabolism in the pipeline.');
    const perYear = ticksPerYear(config);
    const tickDays = 1 / config.time.ticksPerDay;
    const growShare = 1 - exp(-tickDays / K.growthDays);
    const shrinkShare = 1 - exp(-tickDays / K.shrinkDays);
    const leanDensity = METABOLISM.leanKcalPerKg;
    const fatDensity = METABOLISM.fatKcalPerKg;
    const buildCost = INJURY.rebuildCost;
    const s = state.streams;
    const o = globalStreamOffset(StreamDomain.AGING);
    const dies = deathDoor(sim, 'body.aging');
    const training = agents.hasColumn(TRAINED_COLUMN);

    return () => {
      const tick = state.tick;
      const alive = agents.alive.data;
      const ids = agents.id.data;
      const f64 = (name: string) => agents.column<Float64Array>(name).data;
      const sex = agents.column<Uint8Array>(B.sex.name).data;
      const born = f64(B.born.name);
      const lean = f64(B.leanKg.name);
      const leanBuilt = f64(B.leanBuiltKg.name);
      const gut = f64(B.gut.name);
      const energy = f64(B.energy.name);
      const energyOut = f64(B.energyOut.name);
      const adultFrame = f64(B.adultFrameKg.name);
      const oldAgeAt = f64(C.oldAgeAtYears.name);
      const trained = training ? f64(TRAINED_COLUMN) : null;

      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        const sx = sex[slot];
        if (sx === Sex.NONE) {
          throw new Error(`body.aging: agent id ${ids[slot]} has no body; call formBody right after spawnAgent.`);
        }
        const age = (tick - born[slot]) / perYear;
        const frame = leanBuilt[slot] - (trained ? trained[slot] : 0);

        // The first tick: the adult frame, if the body came without one, and the age it dies of old age.
        if (oldAgeAt[slot] === 0) {
          if (adultFrame[slot] === 0) adultFrame[slot] = frame / frameShare(sx, age);
          const at = oldAgeDeathAge(age, nextExponential(s, o));
          oldAgeAt[slot] = at > 0 ? at : 1e-9;
        }

        // 3. Death by old age.
        if (age >= oldAgeAt[slot]) {
          dies(slot, DeathCause.OLD_AGE);
          continue;
        }

        const target = frameShare(sx, age) * adultFrame[slot];
        if (age < K.growthEndsYears) {
          // 1. Growth: toward the curve, with nourishment; first into lean the body already holds above
          // its frame, then built from fat, paying a share of the energy as heat.
          if (target <= frame) continue;
          const leanKg = lean[slot];
          const fatKg = fatKgOf(energy[slot], gut[slot], leanKg);
          const mass = leanKg + fatKg;
          let nourished = (fatKg / mass - INJURY.nourishedFrom) / (INJURY.nourishedAt - INJURY.nourishedFrom);
          nourished = nourished < 0 ? 0 : nourished > 1 ? 1 : nourished;
          const grow = (target - frame) * growShare * nourished;
          if (!(grow > 0)) continue;
          const surplus = leanKg - leanBuilt[slot];
          const claimed = surplus <= 0 ? 0 : surplus < grow ? surplus : grow;
          let built = grow - claimed;
          if (built > 0) {
            const spare = fatKg - K.growthKeepsFatShare * mass;
            const most = spare > 0 ? (spare * fatDensity) / (leanDensity * (1 + buildCost)) : 0;
            if (built > most) built = most;
            const heat = buildCost * leanDensity * built;
            energy[slot] -= heat;
            energyOut[slot] += heat;
            lean[slot] = leanKg + built;
          }
          leanBuilt[slot] += claimed + built;
        } else if (target < frame) {
          // 2. Shrinking: energy moves from lean to fat inside the stock.
          const shrink = (frame - target) * shrinkShare;
          lean[slot] -= shrink;
          leanBuilt[slot] -= shrink;
        }
      }
    };
  },
});
