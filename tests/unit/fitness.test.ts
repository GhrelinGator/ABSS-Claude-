// Fitness, fatigue, load injuries, muscle and skills (docs/DESIGN.md §3.11):
// the calibration targets written before the first run, the doors, and the
// books kept across a save and load.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig } from '../../src/sim/config.ts';
import { auditConserved, learnedContentProblems } from '../../src/sim/core/audit.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { heat } from '../../src/sim/body/heat.ts';
import { INJURY_COLUMNS, INJURY_PARTS, InjuryKind, injury } from '../../src/sim/body/injury.ts';
import { BODY_COLUMNS, Effort, basalKcalPerDay, fatKgOf, metabolism } from '../../src/sim/body/metabolism.ts';
import type { BodySpec } from '../../src/sim/body/metabolism.ts';
import {
  FITNESS,
  FITNESS_COLUMNS,
  capacity,
  capacityOf,
  fitness,
  muscleTarget,
  riskFactor,
  strength,
  strengthOf,
} from '../../src/sim/body/fitness.ts';
import {
  SKILL_COLUMNS,
  SkillAct,
  SkillKind,
  animalKind,
  bySkill,
  materialKind,
  plantKind,
  practice,
  practiceHours,
  skillIndex,
  skillLevel,
  skillOf,
} from '../../src/sim/body/skills.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { AnimalKind } from '../../src/sim/world/animals.ts';
import { Material } from '../../src/sim/world/materials.ts';
import { HADZA_MAN, HADZA_WOMAN, MAN_DAY, WOMAN_DAY, fxKeeper, repeat, spawnWithBody } from '../fixtures/bodies.ts';
import type { Step } from '../fixtures/bodies.ts';
import { fxSurroundings, still } from '../fixtures/surroundings.ts';

const TPD = 144;
const UNTRAINED_MAN: BodySpec = { ...HADZA_MAN, conditionedTo: 0 };
const col = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

/** A day's plan without its meals: the keeper feeds the bodies instead. */
function unfed(plan: readonly Step[]): Step[] {
  return plan.map(({ meal: _meal, ...rest }) => rest);
}
const FORAGER_MAN = unfed(MAN_DAY);
const FORAGER_WOMAN = unfed(WOMAN_DAY);
/** About twice the forager's load: longer walks, part of them loaded, and twice the digging. */
const HARD_DAY: Step[] = [
  ...repeat(36, { effort: Effort.SLEEP }),
  ...repeat(16, { effort: Effort.STILL, metres: 760, climb: 5 }),
  ...repeat(24, { effort: Effort.MODERATE }),
  ...repeat(14, { effort: Effort.STILL, metres: 760, climb: 5, load: 10 }),
  ...repeat(36, { effort: Effort.STILL }),
  ...repeat(18, { effort: Effort.SLEEP }),
];
const REST_DAY: Step[] = [...repeat(54, { effort: Effort.SLEEP }), ...repeat(90, { effort: Effort.STILL })];

/**
 * Each body follows a plan chosen by day and slot (whatever plan it is given, repeated by tick of day).
 * Runs before the bodies' systems.
 */
function plans(choose: (day: number, slot: number) => readonly Step[]): SystemDef {
  return defineSystem({
    name: 'fixture.plans',
    create: (sim) => () => {
      const agents = sim.state.agents;
      const tick = sim.state.tick;
      const day = Math.floor(tick / TPD);
      const secondsPerTick = 86_400 / TPD;
      const effort = agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (!agents.isAlive(slot)) continue;
        const step = choose(day, slot)[tick % TPD];
        effort[slot] = step.effort;
        if (step.metres) {
          col(sim, BODY_COLUMNS.movedM.name)[slot] = step.metres;
          col(sim, BODY_COLUMNS.movingS.name)[slot] = secondsPerTick;
        }
        if (step.load) col(sim, BODY_COLUMNS.loadKg.name)[slot] = step.load;
        if (step.climb) col(sim, BODY_COLUMNS.climbedM.name)[slot] = step.climb;
      }
    },
  });
}

/** Bodies on their plans in thermoneutral shade, kept fed and watered, with the whole body stack. */
function gym(choose: (day: number, slot: number) => readonly Step[], seed = 5): Sim {
  return createSim(defaultConfig(seed), [plans(choose), fxKeeper, fxSurroundings(() => still(28)), injury, heat, metabolism, fitness]);
}

function strains(sim: Sim): number {
  const part = sim.state.parts.find((p) => p.name === INJURY_PARTS.injuries);
  return part && part.readings ? part.readings()[InjuryKind.STRAIN] : Number.NaN;
}

test('the pieces: capacity, the risk factor, the muscle target, strength, the practice curve', () => {
  assert.equal(capacity(8, 8), 1);
  assert.ok(Math.abs(capacity(0, 0) - 0.8) < 1e-12, 'a rested body that never worked');
  assert.ok(Math.abs(capacity(16, 16) - 1.2) < 1e-12, 'conditioned to twice the reference');
  assert.equal(capacity(100, 0), FITNESS.mostCapacity);
  assert.equal(capacity(0, 100), FITNESS.leastCapacity);
  assert.equal(riskFactor(8, 8), 1);
  assert.equal(riskFactor(4, 8), 1);
  assert.equal(riskFactor(12, 8), 2, 'a ratio of 1.5');
  assert.equal(riskFactor(16, 8), 5, 'a ratio of 2');
  assert.equal(riskFactor(30, 0), FITNESS.mostRisk, 'a body that never worked is not infinitely fragile');
  assert.equal(riskFactor(0.9, 0), 1, 'the floor of ordinary walking');
  assert.equal(muscleTarget(40, 0), 0);
  assert.ok(Math.abs(muscleTarget(40, 8) - 4 * (1 - Math.exp(-1))) < 1e-9);
  assert.ok(Math.abs(strength(50, 0) - 1) < 1e-12);
  assert.ok(strength(44, 0) < 1 && strength(44, 0) > strength(34, 0));
  assert.ok(Math.abs(strength(50, 0.5) - 0.75) < 1e-12);
  assert.ok(Math.abs(skillOf(100) - (1 - Math.SQRT1_2)) < 1e-12, '0.29 after 100 life-hours');
  assert.ok(Math.abs(skillOf(300) - 0.5) < 1e-12, '0.5 after 300');
  assert.ok(Math.abs(skillOf(9_900) - 0.9) < 1e-12, '0.9 after about 10,000');
  assert.equal(skillOf(0), 0);
  assert.equal(bySkill(0.2, 0.8, 0.5), 0.5);
  assert.equal(skillIndex(SkillAct.STRIKE, materialKind(Material.FLINT)), 0);
  assert.notEqual(plantKind(0), animalKind(AnimalKind.DEER));
  assert.throws(() => skillIndex(4, 0), RangeError);
  assert.throws(() => skillIndex(0, SkillKind.AGENT + 1), RangeError);
  assert.throws(() => materialKind(0), RangeError);
});

test("a forager's day comes to about 8 load-hours for both sexes", () => {
  const sim = gym((_day, slot) => (slot === 0 ? FORAGER_MAN : FORAGER_WOMAN));
  spawnWithBody(sim, 100, 100, HADZA_MAN);
  spawnWithBody(sim, 101, 100, HADZA_WOMAN);
  const load = [0, 0];
  for (let t = 0; t < TPD; t++) {
    stepSim(sim, 1);
    const exertion = col(sim, BODY_COLUMNS.exertion.name);
    for (const slot of [0, 1]) if (exertion[slot] > FITNESS.lightRatio) load[slot] += (exertion[slot] - FITNESS.lightRatio) / 6;
  }
  assert.ok(load[0] > 7.5 && load[0] < 9.5, `man ${load[0].toFixed(2)}`);
  assert.ok(load[1] > 7.5 && load[1] < 9.5, `woman ${load[1].toFixed(2)}`);
});

test('a conditioned body holds its capacity; an untrained one dips, then climbs toward it over weeks', () => {
  const sim = gym(() => FORAGER_MAN);
  const conditioned = spawnWithBody(sim, 100, 100, HADZA_MAN);
  const untrained = spawnWithBody(sim, 101, 100, UNTRAINED_MAN);
  stepSim(sim, 1);
  const start = capacityOf(sim, untrained);
  assert.ok(Math.abs(start - 0.8) < 0.005, `untrained starts at ${start.toFixed(3)}`);
  let worst = 0;
  let lowest = 1;
  let halfway = -1;
  for (let day = 0; day < 60; day++) {
    for (let t = 0; t < TPD; t++) {
      stepSim(sim, 1);
      const c = capacityOf(sim, conditioned);
      if (Math.abs(c - 1) > worst) worst = Math.abs(c - 1);
    }
    const u = capacityOf(sim, untrained);
    if (u < lowest) lowest = u;
    if (halfway < 0 && u >= 0.9) halfway = day + 1;
  }
  assert.ok(worst < 0.02, `the conditioned body strays ${worst.toFixed(4)} from 1`);
  assert.ok(lowest < start, 'fatigue comes before fitness');
  assert.ok(halfway >= 21 && halfway <= 70, `half the gap closed on day ${halfway}`);
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test("rest after a hard block leaves capacity higher than at the block's end (the taper)", () => {
  const sim = gym((day) => (day < 28 ? HARD_DAY : REST_DAY));
  const slot = spawnWithBody(sim, 100, 100, HADZA_MAN);
  stepSim(sim, 1);
  const before = capacityOf(sim, slot);
  stepSim(sim, 7 * TPD - 1);
  const week = capacityOf(sim, slot);
  stepSim(sim, 21 * TPD);
  const end = capacityOf(sim, slot);
  const trainedAtEnd = col(sim, FITNESS_COLUMNS.trainedKg.name)[slot];
  stepSim(sim, 7 * TPD);
  const rested = capacityOf(sim, slot);
  assert.ok(week < before, `a week into the block ${week.toFixed(3)} against ${before.toFixed(3)}`);
  assert.ok(rested > end, `after a week's rest ${rested.toFixed(3)} against ${end.toFixed(3)} at the block's end`);
  assert.ok(trainedAtEnd > col(sim, FITNESS_COLUMNS.trainedKg.name)[slot], 'a week of rest loses some of the muscle the block built');
});

test('conditioned bodies strain now and then; untrained ones starting the same work strain more often', () => {
  // A year of real days at the forager's load.
  const year = gym(() => FORAGER_MAN, 11);
  for (let i = 0; i < 100; i++) spawnWithBody(year, 100 + i, 100, HADZA_MAN);
  stepSim(year, 365 * TPD);
  const perYear = strains(year) / 100;
  assert.ok(perYear >= 0.2 && perYear <= 1, `${perYear.toFixed(2)} strains a body-year`);

  // The first four weeks of the same work, for bodies used to it and bodies that never worked:
  // count the bodies strained at least once (a strain heals with a half-life of a week).
  const strained = new Uint8Array(800);
  let a = 0;
  let b = 0;
  const watch = defineSystem({
    name: 'fixture.strainWatch',
    create: (sim) => () => {
      const strain = col(sim, INJURY_COLUMNS.strain.name);
      for (let slot = 0; slot < 800; slot++) {
        if (strain[slot] <= 0 || strained[slot] === 1) continue;
        strained[slot] = 1;
        if (slot < 400) a++;
        else b++;
      }
    },
  });
  const month = createSim(defaultConfig(12), [...gym(() => FORAGER_MAN).pipeline, watch]);
  for (let i = 0; i < 400; i++) spawnWithBody(month, 100 + i, 100, HADZA_MAN);
  for (let i = 0; i < 400; i++) spawnWithBody(month, 100 + i, 300, UNTRAINED_MAN);
  stepSim(month, 28 * TPD);
  assert.ok(a >= 5, `conditioned bodies strained: ${a}`);
  const ratio = b / a;
  assert.ok(ratio >= 2 && ratio <= 8, `untrained ${b} against conditioned ${a}: ${ratio.toFixed(2)} times`);
});

test('bed rest loses muscle; twice the work builds it, and the basal rate follows', () => {
  // A conditioned man lying still for 14 days, fed and watered.
  const rest = gym(() => REST_DAY);
  const resting = spawnWithBody(rest, 100, 100, HADZA_MAN);
  const leanBefore = col(rest, BODY_COLUMNS.leanKg.name)[resting];
  stepSim(rest, 14 * TPD);
  const lost = leanBefore - col(rest, BODY_COLUMNS.leanKg.name)[resting];
  assert.ok(lost >= 0.5 && lost <= 2, `${lost.toFixed(2)} kg of lean lost in 14 days of bed rest`);

  // An untrained man doing twice the forager's load for 12 weeks, fed and watered.
  const work = gym(() => HARD_DAY);
  const worker = spawnWithBody(work, 100, 100, UNTRAINED_MAN);
  const lean0 = col(work, BODY_COLUMNS.leanKg.name)[worker];
  const fat0 = fatKgOf(col(work, BODY_COLUMNS.energy.name)[worker], 0, lean0);
  const basal0 = basalKcalPerDay(HADZA_MAN.sex, HADZA_MAN.ageYears, lean0 + fat0);
  stepSim(work, 84 * TPD);
  const lean1 = col(work, BODY_COLUMNS.leanKg.name)[worker];
  const fat1 = fatKgOf(col(work, BODY_COLUMNS.energy.name)[worker], col(work, BODY_COLUMNS.gut.name)[worker], lean1);
  const gained = lean1 - lean0;
  assert.ok(gained >= 0.5 && gained <= 2.5, `${gained.toFixed(2)} kg of lean gained in 12 weeks`);
  assert.ok(Math.abs(col(work, FITNESS_COLUMNS.trainedKg.name)[worker] - gained) < 0.05, 'the gain is trained muscle');
  assert.ok(
    Math.abs(col(work, BODY_COLUMNS.leanBuiltKg.name)[worker] - (HADZA_MAN.leanKg + col(work, FITNESS_COLUMNS.trainedKg.name)[worker])) < 1e-9,
    'built lean mass moves with the muscle',
  );
  assert.ok(basalKcalPerDay(HADZA_MAN.sex, HADZA_MAN.ageYears + 84 / 48, lean1 + fat1) > basal0, 'the basal rate rises with the muscle');
  assert.ok(strengthOf(work, worker) > strength(lean0, 0) || col(work, INJURY_COLUMNS.strain.name)[worker] > 0);
  assert.deepEqual(auditConserved(rest.state.agents), []);
  assert.deepEqual(auditConserved(work.state.agents), []);
});

test('skill climbs with practice, keeps through use, and fades slowly with disuse', () => {
  const sim = gym(() => REST_DAY);
  const slot = spawnWithBody(sim, 100, 100, HADZA_MAN);
  const flint = materialKind(Material.FLINT);
  const tuber = plantKind(1);
  // Nothing is learned in the tick a body is spawned.
  practice(sim, slot, SkillAct.MANIPULATE, flint, 3600);
  assert.equal(practiceHours(sim, slot, SkillAct.MANIPULATE, flint), 0);
  assert.deepEqual(learnedContentProblems(sim.state, slot), []);
  stepSim(sim, 1);
  // An hour of real practice counts as 365.25 / 48 life-hours.
  practice(sim, slot, SkillAct.MANIPULATE, flint, 3600);
  assert.ok(Math.abs(practiceHours(sim, slot, SkillAct.MANIPULATE, flint) - 365.25 / 48) < 1e-4);
  assert.equal(skillLevel(sim, slot, SkillAct.STRIKE, flint), 0, 'skills are kept apart by act');
  assert.equal(skillLevel(sim, slot, SkillAct.MANIPULATE, materialKind(Material.QUARTZITE)), 0, 'and by kind');

  // Half an hour a real day: skill after 13 compressed years against after 28 (from age 5 to 18 and to 33).
  const perYear = 48 * TPD;
  const daily = defineSystem({
    name: 'fixture.dailyPractice',
    create: (s) => () => {
      if (s.state.tick % TPD === 60 && s.state.agents.isAlive(slot)) practice(s, slot, SkillAct.PICK_UP, tuber, 1800);
    },
  });
  const learner = createSim(defaultConfig(5), [...sim.pipeline, daily]);
  const pupil = spawnWithBody(learner, 100, 100, HADZA_MAN);
  assert.equal(pupil, slot);
  stepSim(learner, 13 * perYear);
  const at18 = skillLevel(learner, pupil, SkillAct.PICK_UP, tuber);
  stepSim(learner, 15 * perYear);
  const at33 = skillLevel(learner, pupil, SkillAct.PICK_UP, tuber);
  const share = at18 / at33;
  assert.ok(share >= 0.8 && share <= 0.95, `skill at 18 is ${(100 * share).toFixed(1)}% of skill at 33 (${at18.toFixed(3)}, ${at33.toFixed(3)})`);
  assert.ok(learner.state.agents.isAlive(pupil));

  // An expert who stops.
  practice(sim, slot, SkillAct.STRIKE, SkillKind.AGENT, (9_900 / (365.25 / 48)) * 3600);
  const expert = skillLevel(sim, slot, SkillAct.STRIKE, SkillKind.AGENT);
  assert.ok(Math.abs(expert - 0.9) < 1e-3, `expert ${expert}`);
  stepSim(sim, 5 * perYear);
  const after5 = skillLevel(sim, slot, SkillAct.STRIKE, SkillKind.AGENT);
  stepSim(sim, 15 * perYear);
  const after20 = skillLevel(sim, slot, SkillAct.STRIKE, SkillKind.AGENT);
  assert.ok(after5 > 0.85 && after5 < expert, `after 5 years of disuse ${after5.toFixed(3)}`);
  assert.ok(after20 > 0.6 && after20 < after5, `after 20 years of disuse ${after20.toFixed(3)}`);
  assert.ok(sim.state.agents.isAlive(slot));
});

test('the doors refuse what is not a body or not a number; the system needs the body stack', () => {
  const sim = gym(() => REST_DAY);
  const slot = spawnWithBody(sim, 100, 100, HADZA_MAN);
  const bare = spawnAgent(sim, 50, 50);
  assert.throws(() => practice(sim, bare, 0, 0, 10), /has no body/);
  assert.throws(() => practice(sim, slot, 0, 0, -1), RangeError);
  assert.throws(() => practice(sim, slot, 0, 0, Number.NaN), RangeError);
  assert.throws(() => capacityOf(sim, 999), /holds no agent/);
  assert.throws(() => createSim(defaultConfig(5), [heat, metabolism, fitness]), /needs body.injury/);
  assert.throws(() => createSim(defaultConfig(5), [fitness]), /needs body.metabolism/);
  const noSkills = createSim(defaultConfig(5), [metabolism]);
  const lone = spawnWithBody(noSkills, 10, 10, HADZA_MAN);
  assert.throws(() => practice(noSkills, lone, 0, 0, 10), /keeps no skills/);
  assert.equal(sim.state.agents.column(SKILL_COLUMNS.skillPractice.name).category, 'learned');
  assert.equal(sim.state.agents.column(SKILL_COLUMNS.skillTick.name).category, 'learned');
});

test('fitness, muscle and skills survive a save and load mid-run', () => {
  const make = () => {
    const sim = gym((day, slot) => ((day + slot) % 3 === 0 ? HARD_DAY : FORAGER_MAN), 21);
    for (let i = 0; i < 20; i++) spawnWithBody(sim, 100 + i, 100, i % 2 === 0 ? HADZA_MAN : UNTRAINED_MAN);
    return sim;
  };
  const a = make();
  stepSim(a, 3 * TPD);
  for (let slot = 0; slot < 20; slot++) practice(a, slot, slot % 4, slot, 600 * (slot + 1));
  stepSim(a, 2 * TPD);
  const b = loadSim(saveSim(a), a.pipeline);
  stepSim(a, 10 * TPD);
  stepSim(b, 10 * TPD);
  assert.equal(hashSim(a), hashSim(b));
  assert.ok(practiceHours(a, 3, 3, 3) > 0);
  assert.deepEqual(auditConserved(a.state.agents), []);
});
