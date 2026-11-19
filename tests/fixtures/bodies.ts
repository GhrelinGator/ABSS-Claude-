// Scripted bodies for tests (docs/DESIGN.md §3.8). Nothing under src/ may
// import this file: scripted behaviour never enters a real run.

import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { StreamDomain, globalStreamOffset, nextChance, nextFloat, nextInt } from '../../src/sim/core/rng.ts';
import { BODY_COLUMNS, Effort, Sex, formBody, ingest } from '../../src/sim/body/metabolism.ts';
import type { BodySpec } from '../../src/sim/body/metabolism.ts';
import { spawnAgent } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { HEAT_COLUMNS, drink } from '../../src/sim/body/heat.ts';

const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

/**
 * Hadza-like adults, approximately as Pontzer et al. (2012) describe them
 * (body mass about 51 kg for men at about 13.5% fat, about 43 kg for women at
 * about 21%; from memory: the paper could not be fetched in session 20).
 */
export const HADZA_MAN: BodySpec = { sex: Sex.MALE, ageYears: 28, leanKg: 44.0, fatKg: 6.9 };
export const HADZA_WOMAN: BodySpec = { sex: Sex.FEMALE, ageYears: 28, leanKg: 34.0, fatKg: 9.0 };

/** Spawn an agent and give it a body in one step, as founder placement will. */
export function spawnWithBody(sim: Sim, x: number, y: number, spec: BodySpec = HADZA_MAN): number {
  const slot = spawnAgent(sim, x, y);
  formBody(sim, slot, spec);
  return slot;
}

/** Spawn `n` adults of alternating sex in a line from (x0, y0). */
export function populateWithBodies(sim: Sim, n: number, x0: number, y0: number, dx = 1, dy = 0): number[] {
  const slots: number[] = [];
  for (let i = 0; i < n; i++) {
    slots.push(spawnWithBody(sim, x0 + i * dx, y0 + i * dy, i % 2 === 0 ? HADZA_MAN : HADZA_WOMAN));
  }
  return slots;
}

/**
 * Scripted activity, food and water for every agent with a body: a random
 * effort, random walks and runs, loads, climbs, meals now and then, and drinks
 * when the pipeline has body.heat. It exercises every input of the metabolism,
 * starvation included (some agents get little food).
 */
export const fxBodyWork: SystemDef = defineSystem({
  name: 'fixture.bodyWork',
  create(sim: Sim) {
    const { state } = sim;
    const agents = state.agents;
    const streams = state.streams;
    const o = globalStreamOffset(StreamDomain.FIXTURE);
    const secondsPerTick = 86_400 / sim.config.time.ticksPerDay;
    const drinks = agents.hasColumn(HEAT_COLUMNS.water.name);
    return () => {
      const sex = agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data;
      const effort = agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
      const moved = agents.column<Float64Array>(BODY_COLUMNS.movedM.name).data;
      const moving = agents.column<Float64Array>(BODY_COLUMNS.movingS.name).data;
      const climbed = agents.column<Float64Array>(BODY_COLUMNS.climbedM.name).data;
      const load = agents.column<Float64Array>(BODY_COLUMNS.loadKg.name).data;
      const ids = agents.id.data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (!agents.isAlive(slot) || sex[slot] === Sex.NONE) continue;
        effort[slot] = nextInt(streams, o, 5);
        if (nextChance(streams, o, 0.3)) {
          const seconds = nextFloat(streams, o) * secondsPerTick;
          moving[slot] = seconds;
          moved[slot] = seconds * nextFloat(streams, o) * 4;
          climbed[slot] = nextChance(streams, o, 0.3) ? nextFloat(streams, o) * 20 : 0;
        }
        if (nextChance(streams, o, 0.1)) load[slot] = nextFloat(streams, o) * 25;
        // Agents with even ids find more food than odd ones, so some fatten and some starve.
        const mealChance = ids[slot] % 2 === 0 ? 0.03 : 0.004;
        if (nextChance(streams, o, mealChance)) ingest(sim, slot, nextFloat(streams, o) * 1500);
        // Water, where the pipeline keeps it (body.heat): about 4 kg a day, all the same for odd and even.
        if (drinks && nextChance(streams, o, 0.05)) drink(sim, slot, nextFloat(streams, o) * 1.1);
      }
    };
  },
});

/** One step of a scripted day, by tick of day. */
export interface Step {
  effort: number;
  metres?: number;
  load?: number;
  climb?: number;
  meal?: number;
  /** Water drunk, kg (needs body.heat in the pipeline). */
  drink?: number;
}

/** A scripted day, repeated every day, for every agent with a body. Runs before metabolism. */
export function dayScript(plan: readonly Step[]): SystemDef {
  return defineSystem({
    name: 'fixture.day',
    create: (sim) => () => {
      const agents = sim.state.agents;
      const step = plan[sim.state.tick % plan.length];
      const secondsPerTick = 86_400 / sim.config.time.ticksPerDay;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (!agents.isAlive(slot)) continue;
        agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data[slot] = step.effort;
        if (step.metres) {
          f64(sim, BODY_COLUMNS.movedM.name)[slot] = step.metres;
          f64(sim, BODY_COLUMNS.movingS.name)[slot] = secondsPerTick;
        }
        if (step.load) f64(sim, BODY_COLUMNS.loadKg.name)[slot] = step.load;
        if (step.climb) f64(sim, BODY_COLUMNS.climbedM.name)[slot] = step.climb;
        if (step.meal) ingest(sim, slot, step.meal);
        if (step.drink) drink(sim, slot, step.drink);
      }
    },
  });
}

export function repeat(n: number, step: Step): Step[] {
  return Array.from({ length: n }, () => ({ ...step }));
}

/**
 * A Hadza-like day (§9: men walk about 11 km a day, women about 6): 9 hours'
 * sleep, an outing on foot with a stretch of digging or butchering in the
 * middle and a load on the way back, the rest of the day sitting.
 */
export const MAN_DAY: Step[] = [
  ...repeat(36, { effort: Effort.SLEEP }),
  ...repeat(6, { effort: Effort.STILL }),
  ...repeat(8, { effort: Effort.STILL, metres: 760, climb: 5 }),
  ...repeat(12, { effort: Effort.MODERATE }),
  ...repeat(7, { effort: Effort.STILL, metres: 760, climb: 5, load: 10 }),
  ...repeat(57, { effort: Effort.STILL }),
  ...repeat(18, { effort: Effort.SLEEP }),
];
MAN_DAY[40].meal = 900;
MAN_DAY[80].meal = 900;
MAN_DAY[120].meal = 800;

export const WOMAN_DAY: Step[] = [
  ...repeat(36, { effort: Effort.SLEEP }),
  ...repeat(6, { effort: Effort.STILL }),
  ...repeat(5, { effort: Effort.STILL, metres: 645, climb: 5, load: 8 }),
  ...repeat(18, { effort: Effort.MODERATE }),
  ...repeat(4, { effort: Effort.STILL, metres: 645, climb: 5, load: 15 }),
  ...repeat(57, { effort: Effort.STILL }),
  ...repeat(18, { effort: Effort.SLEEP }),
];
WOMAN_DAY[40].meal = 700;
WOMAN_DAY[80].meal = 600;
WOMAN_DAY[120].meal = 600;

export { Effort };
