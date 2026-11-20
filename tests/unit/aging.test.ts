// Growth, aging, death by old age and carcasses (docs/DESIGN.md §3.12), with
// scripted bodies. The calibration targets were written in §3.12 before the
// first run.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { auditConserved } from '../../src/sim/core/audit.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { STREAM_WORDS, nextExponential, seedStream } from '../../src/sim/core/rng.ts';
import { AGING_COLUMNS, aging } from '../../src/sim/body/aging.ts';
import { fitness, capacityOf, strengthOf } from '../../src/sim/body/fitness.ts';
import { heat } from '../../src/sim/body/heat.ts';
import { injure, injury } from '../../src/sim/body/injury.ts';
import {
  LIFECOURSE,
  capacityAtAge,
  frameShare,
  oldAgeDeathAge,
  oldAgeHazard,
  skillAtAge,
  strengthAtAge,
} from '../../src/sim/body/lifecourse.ts';
import {
  BODY_COLUMNS,
  BODY_PARTS,
  DeathCause,
  METABOLISM,
  Sex,
  basalKcalPerDay,
  fatKgOf,
  formBody,
  metabolism,
} from '../../src/sim/body/metabolism.ts';
import type { BodySpec } from '../../src/sim/body/metabolism.ts';
import { SkillAct, plantKind, practice, practiceHours, skillLevel, skillOf } from '../../src/sim/body/skills.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { CARCASS_LAYER, CARCASS_LOAD_LAYER } from '../../src/sim/world/animals.ts';
import { HADZA_MAN, HADZA_WOMAN, feedAsMilk, fxKeeper, spawnWithBody } from '../fixtures/bodies.ts';
import { fxSurroundings, still } from '../fixtures/surroundings.ts';

const TPD = 144;
const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;
const fatOf = (sim: Sim, slot: number) =>
  fatKgOf(f64(sim, BODY_COLUMNS.energy.name)[slot], f64(sim, BODY_COLUMNS.gut.name)[slot], f64(sim, BODY_COLUMNS.leanKg.name)[slot]);
const massOf = (sim: Sim, slot: number) => f64(sim, BODY_COLUMNS.leanKg.name)[slot] + fatOf(sim, slot);
const ageOf = (sim: Sim, slot: number) =>
  (sim.state.tick - f64(sim, BODY_COLUMNS.born.name)[slot]) / (sim.config.time.ticksPerDay * sim.config.time.daysPerYear);
const readings = (sim: Sim, name: string) => {
  const part = sim.state.parts.find((p) => p.name === name);
  if (!part || !part.readings) throw new Error(`no ${name}`);
  return part.readings();
};
const cellOf = (sim: Sim, x: number, y: number) =>
  Math.floor(y / sim.config.world.cellSizeM) * sim.config.world.widthCells + Math.floor(x / sim.config.world.cellSizeM);

/**
 * Feeds every body every six hours what it spent since its last meal, plus a quarter of `extraPerDay`
 * kcal, and, when `fatShare` is given, half of what it is short of that share of its mass in fat, so a
 * growing body has the surplus it needs.
 */
function feeder(fatShare: number | null, extraPerDay = 0): SystemDef {
  return defineSystem({
    name: 'fixture.feeder',
    declare: (state) => state.agents.ensureColumn({ name: 'feedMark', dtype: 'f64', category: 'body' }),
    create: (sim) => () => {
      const agents = sim.state.agents;
      if (sim.state.tick % (sim.config.time.ticksPerDay / 4) !== 0) return;
      const out = f64(sim, BODY_COLUMNS.energyOut.name);
      const mark = f64(sim, 'feedMark');
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (!agents.isAlive(slot)) continue;
        let meal = out[slot] - mark[slot] + extraPerDay / 4;
        if (fatShare !== null) {
          const short = fatShare * massOf(sim, slot) - fatOf(sim, slot);
          if (short > 0) meal += 0.5 * short * METABOLISM.fatKcalPerKg;
        }
        // Young bodies digest solid food only in part (§3.13): before 2 they are fed as if nursed.
        if (meal > 0) feedAsMilk(sim, slot, meal);
        mark[slot] = out[slot];
      }
    },
  });
}

/** Keep a body from dying of old age, so a test can watch it age (the hazard is tested on its own). */
function spareFromOldAge(sim: Sim, slot: number): void {
  f64(sim, AGING_COLUMNS.oldAgeAtYears.name)[slot] = 1000;
}

test('the pieces: the frame curve, the losses after the peak, the hazard of old age', () => {
  for (const sex of [Sex.FEMALE, Sex.MALE]) {
    assert.ok(frameShare(sex, 0) > 0.06 && frameShare(sex, 0) < 0.08, 'a newborn');
    assert.ok(frameShare(sex, 10) >= 0.4 && frameShare(sex, 10) <= 0.45, 'Walker et al. 2006: 40–45% of adult size at 10');
    assert.equal(frameShare(sex, 22), 1);
    assert.equal(frameShare(sex, 35), 1);
    assert.equal(frameShare(sex, 80), 0.82);
    assert.equal(frameShare(sex, 130), 0.7, 'flat beyond the last point');
    for (let age = 0; age < 22; age += 0.5) assert.ok(frameShare(sex, age + 0.5) >= frameShare(sex, age), 'growth never reverses');
  }
  assert.ok(frameShare(Sex.FEMALE, 15) > frameShare(Sex.MALE, 15), 'girls spurt earlier');
  assert.equal(capacityAtAge(20), 1);
  assert.equal(capacityAtAge(80), 0.65);
  assert.equal(strengthAtAge(40), 1);
  assert.equal(skillAtAge(50), 1);
  assert.ok(skillAtAge(56) > 0.95);
  assert.equal(skillAtAge(80), 0.8);
  assert.ok(Math.abs(oldAgeHazard(0) - LIFECOURSE.oldAgeA) < 1e-12);
  assert.ok(Math.abs(oldAgeHazard(70) / oldAgeHazard(70 - Math.log(2) / LIFECOURSE.oldAgeB) - 2) < 1e-6, 'doubles every 8.1 years');
  // The drawn age is where the hazard accumulated since now reaches the draw.
  const b = LIFECOURSE.oldAgeB;
  const a = LIFECOURSE.oldAgeA;
  for (const [age, reserve] of [[0, 1], [30, 0.2], [70, 3]] as const) {
    const at = oldAgeDeathAge(age, reserve);
    assert.ok(at > age);
    assert.ok(Math.abs((a / b) * (Math.exp(b * at) - Math.exp(b * age)) - reserve) < 1e-9);
  }
});

test('old age: rarely before 15, a mode in the 70s, and with a forager background hazard, the modal adult age and e15 of Gurven & Kaplan', () => {
  const s = new Uint32Array(STREAM_WORDS);
  seedStream(s, 0, 7, 99, 0);
  const n = 200_000;
  const alone = new Float64Array(121);
  const together = new Float64Array(121);
  let young = 0;
  let lived = 0;
  for (let i = 0; i < n; i++) {
    const at = oldAgeDeathAge(0, nextExponential(s, 0));
    if (at < 15) young++;
    alone[Math.min(120, Math.floor(at))]++;
    // From 15: old age, or the age-independent hazard of Gurven & Kaplan (2007), 0.013 a year,
    // standing in for the illness, accidents and predation Phase 3 brings.
    const old = oldAgeDeathAge(15, nextExponential(s, 0));
    const other = 15 + nextExponential(s, 0) / 0.013;
    const dead = old < other ? old : other;
    lived += dead - 15;
    together[Math.min(120, Math.floor(dead))]++;
  }
  const modeOf = (bins: Float64Array, from: number) => {
    let mode = from;
    for (let year = from; year < bins.length; year++) if (bins[year] > bins[mode]) mode = year;
    return mode;
  };
  assert.ok(young / n < 0.01, `${((100 * young) / n).toFixed(2)}% die of old age before 15`);
  const mode = modeOf(alone, 15);
  assert.ok(mode >= 70 && mode <= 78, `old age alone: modal age at death ${mode}`);
  const adultMode = modeOf(together, 15);
  assert.ok(adultMode >= 65 && adultMode <= 78, `with the background: modal adult age at death ${adultMode}`);
  const e15 = lived / n;
  assert.ok(e15 >= 33 && e15 <= 43, `with the background: life expectancy at 15 is ${e15.toFixed(1)} more years`);
});

test('fed 70-year-olds die of old age at the hazard\'s rate, each leaving its carcass where it lay', () => {
  const config = validateConfig({ ...defaultConfig(11), time: { ticksPerDay: TPD, daysPerYear: 4 } });
  const sim = createSim(config, [feeder(null), metabolism, aging]);
  const n = 800;
  const W = config.world.widthCells;
  const cs = config.world.cellSizeM;
  const formed: number[] = [];
  const cells: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % W) * cs + 50;
    const y = Math.floor(i / W) * cs + 50;
    const slot = spawnWithBody(sim, x, y, { ...(i % 2 === 0 ? HADZA_MAN : HADZA_WOMAN), ageYears: 70 });
    assert.equal(slot, i);
    formed.push(massOf(sim, slot));
    cells.push(cellOf(sim, x, y));
  }
  stepSim(sim, 10 * 4 * TPD);
  const dead = formed.filter((_, slot) => !sim.state.agents.isAlive(slot)).length;
  const expected = 1 - Math.exp(-(LIFECOURSE.oldAgeA / LIFECOURSE.oldAgeB) * (Math.exp(LIFECOURSE.oldAgeB * 80) - Math.exp(LIFECOURSE.oldAgeB * 70)));
  assert.ok(Math.abs(dead / n - expected) < 0.05, `${dead} of ${n} died in 10 years; the hazard gives ${(100 * expected).toFixed(1)}%`);
  const byCause = readings(sim, BODY_PARTS.deaths);
  assert.equal(byCause[DeathCause.OLD_AGE], dead);
  assert.equal(byCause[DeathCause.STARVATION], 0);
  const byAge = readings(sim, BODY_PARTS.deathAges);
  let counted = 0;
  for (let year = 0; year < byAge.length; year++) {
    if (byAge[year] > 0) assert.ok(year >= 70 && year < 80, `a death at ${year}`);
    counted += byAge[year];
  }
  assert.equal(counted, dead);
  const meat = sim.state.world.layer<Float32Array>(CARCASS_LAYER);
  const load = sim.state.world.layer<Float32Array>(CARCASS_LOAD_LAYER);
  for (let slot = 0; slot < n; slot++) {
    const k = cells[slot];
    if (sim.state.agents.isAlive(slot)) assert.equal(meat[k], 0);
    else {
      const share = meat[k] / formed[slot];
      assert.ok(share > 0.47 && share < 0.53, `body ${slot} left ${meat[k].toFixed(1)} kg of a ${formed[slot].toFixed(1)} kg body`);
      assert.equal(load[k], 0, 'fresh meat is clean');
    }
  }
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('every way to die goes through one door, which leaves the carcass', () => {
  // Starvation, in a body with no food (metabolism alone).
  const hungry = createSim(defaultConfig(3), [metabolism, aging]);
  const starving = spawnWithBody(hungry, 1050, 2050, HADZA_MAN);
  stepSim(hungry, 1);
  spareFromOldAge(hungry, starving);
  let before = 0;
  for (let day = 0; day < 80 && hungry.state.agents.isAlive(starving); day++) {
    before = massOf(hungry, starving);
    stepSim(hungry, TPD);
  }
  assert.ok(!hungry.state.agents.isAlive(starving));
  assert.equal(readings(hungry, BODY_PARTS.deaths)[DeathCause.STARVATION], 1);
  const starved = hungry.state.world.layer<Float32Array>(CARCASS_LAYER)[cellOf(hungry, 1050, 2050)];
  assert.ok(starved > 0.4 * before && starved < 0.5 * before, `a starved body left ${starved.toFixed(1)} kg of about ${before.toFixed(1)}`);

  // Shock, dehydration and old age, in the full body stack.
  const sim = createSim(defaultConfig(3), [fxSurroundings(() => still(28)), injury, heat, metabolism, fitness, aging]);
  const bled = spawnWithBody(sim, 150, 150, HADZA_MAN);
  const dry = spawnWithBody(sim, 350, 150, HADZA_WOMAN);
  const old = spawnWithBody(sim, 550, 150, { ...HADZA_MAN, ageYears: 150 });
  stepSim(sim, 1);
  spareFromOldAge(sim, bled);
  spareFromOldAge(sim, dry);
  const masses = [massOf(sim, bled), massOf(sim, dry), massOf(sim, old)];
  injure(sim, bled, { openCm2: 20, bleedMlMin: 600, dirt: 0 });
  stepSim(sim, 20 * TPD);
  for (const slot of [bled, dry, old]) assert.ok(!sim.state.agents.isAlive(slot), `body ${slot} is still alive`);
  const byCause = readings(sim, BODY_PARTS.deaths);
  assert.equal(byCause[DeathCause.SHOCK], 1);
  assert.equal(byCause[DeathCause.DEHYDRATION], 1);
  assert.equal(byCause[DeathCause.OLD_AGE], 1);
  assert.equal(readings(sim, BODY_PARTS.deathAges)[120], 1, 'the 150-year-old is counted in the last bin');
  const meat = sim.state.world.layer<Float32Array>(CARCASS_LAYER);
  for (const [i, x] of [150, 350, 550].entries()) {
    const kg = meat[cellOf(sim, x, 150)];
    assert.ok(kg > 0.38 * masses[i] && kg <= 0.5 * masses[i], `body ${i} left ${kg.toFixed(1)} kg of a ${masses[i].toFixed(1)} kg body`);
  }

  // Nothing in the body systems removes an agent except the door.
  const dir = new URL('../../src/sim/body/', import.meta.url);
  let removals = 0;
  for (const file of readdirSync(dir)) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    const found = text.split('agents.remove(').length - 1;
    if (found > 0) assert.equal(file, 'metabolism.ts', `${file} removes agents itself`);
    removals += found;
  }
  assert.equal(removals, 1);
});

test('a fed newborn grows along its frame curve; one fed only what it spends grows less and does not starve', () => {
  const runs: Record<string, { at: Record<number, number>; fat: number[]; adult: number; alive: boolean; audit: string[] }> = {};
  const cases = [
    ['fed', 0.15, 0],
    ['short', null, 0],
    ['scant', null, 30],
  ] as const;
  for (const [name, share, extra] of cases) {
    const sim = createSim(defaultConfig(9), [feeder(share, extra), metabolism, aging]);
    const newborn: BodySpec = { sex: Sex.MALE, ageYears: 0, leanKg: 0.065 * 44, fatKg: 0.45, adultFrameKg: 44 };
    const slot = spawnWithBody(sim, 100, 100, newborn);
    stepSim(sim, 1);
    spareFromOldAge(sim, slot);
    const at: Record<number, number> = {};
    const fat: number[] = [];
    let year = 0;
    for (const target of [2, 5, 10, 15, 20, 25]) {
      stepSim(sim, (target - year) * 48 * TPD - (year === 0 ? 1 : 0));
      year = target;
      if (!sim.state.agents.isAlive(slot)) break;
      at[target] = f64(sim, BODY_COLUMNS.leanBuiltKg.name)[slot];
      fat.push(fatOf(sim, slot) / massOf(sim, slot));
    }
    runs[name] = {
      at,
      fat,
      adult: f64(sim, BODY_COLUMNS.adultFrameKg.name)[slot],
      alive: sim.state.agents.isAlive(slot),
      audit: auditConserved(sim.state.agents),
    };
  }
  const fed = runs.fed;
  assert.ok(fed.alive);
  assert.equal(fed.adult, 44);
  for (const age of [2, 5, 10, 15, 20]) {
    const want = frameShare(Sex.MALE, age) * 44;
    assert.ok(Math.abs(fed.at[age] / want - 1) < 0.05, `fed, at ${age}: frame ${fed.at[age].toFixed(2)} kg against ${want.toFixed(2)}`);
  }
  assert.ok(Math.abs(fed.at[25] / 44 - 1) < 0.02, `fed, at 25: frame ${fed.at[25].toFixed(2)} kg`);
  for (const share of fed.fat) assert.ok(share >= 0.08 && share <= 0.25, `fed: body fat ${(100 * share).toFixed(1)}%`);
  assert.deepEqual(fed.audit, []);
  const short = runs.short;
  assert.ok(short.alive, 'a body fed what it spends does not starve');
  assert.ok(short.at[25] < 0.9 * 44, `fed only what it spends, at 25: frame ${short.at[25].toFixed(2)} kg`);
  assert.ok(short.at[25] > 0.065 * 44, 'it grows on the fat it was born with, and no further');
  assert.deepEqual(short.audit, []);
  // Not a target written before the run: 30 kcal a day over what it spends lets it grow, slowly.
  const scant = runs.scant;
  assert.ok(scant.alive);
  assert.ok(scant.at[25] > short.at[25] && scant.at[25] < 0.9 * 44, `30 kcal a day spare, at 25: frame ${scant.at[25].toFixed(2)} kg`);
  for (const age of [5, 10, 15, 20, 25]) assert.ok(scant.at[age] > scant.at[age === 5 ? 2 : age - 5], `scant: still growing at ${age}`);
  assert.deepEqual(scant.audit, []);
});

test('a fed adult from 35 to 80 shrinks along the curve and loses strength, capacity and skill', () => {
  const tuber = plantKind(1);
  const daily = defineSystem({
    name: 'fixture.dailyPractice',
    create: (s) => () => {
      if (s.state.tick % TPD === 60 && s.state.agents.isAlive(0)) practice(s, 0, SkillAct.PICK_UP, tuber, 1800);
    },
  });
  const sim = createSim(defaultConfig(4), [daily, fxKeeper, fxSurroundings(() => still(28)), injury, heat, metabolism, fitness, aging]);
  // Untrained, so no trained muscle is lost on the way and the frame is all there is to shrink.
  const slot = spawnWithBody(sim, 100, 100, { ...HADZA_MAN, ageYears: 35, conditionedTo: 0 });
  stepSim(sim, 1);
  spareFromOldAge(sim, slot);
  const sample = () => ({
    lean: f64(sim, BODY_COLUMNS.leanKg.name)[slot],
    built: f64(sim, BODY_COLUMNS.leanBuiltKg.name)[slot],
    basal: basalKcalPerDay(Sex.MALE, ageOf(sim, slot), massOf(sim, slot)),
    strength: strengthOf(sim, slot),
    capacity: capacityOf(sim, slot),
    skill: skillLevel(sim, slot, SkillAct.PICK_UP, tuber) / skillOf(practiceHours(sim, slot, SkillAct.PICK_UP, tuber)),
  });
  stepSim(sim, 2 * TPD);
  const at35 = sample();
  stepSim(sim, 21 * 48 * TPD);
  const at56 = sample();
  stepSim(sim, 24 * 48 * TPD - 2 * TPD);
  const at80 = sample();
  assert.ok(sim.state.agents.isAlive(slot), 'the frame shrinking does not starve it');
  assert.ok(Math.abs(ageOf(sim, slot) - 80) < 0.01);
  const leanShare = at80.lean / at35.lean;
  assert.ok(Math.abs(leanShare / 0.82 - 1) < 0.03, `lean mass at 80 is ${(100 * leanShare).toFixed(1)}% of at 35`);
  assert.ok(at80.lean >= (2 / 3) * at80.built);
  assert.ok(at80.basal < at35.basal, `basal rate ${at35.basal.toFixed(0)} → ${at80.basal.toFixed(0)} kcal a day`);
  const strength = at80.strength / at35.strength;
  assert.ok(strength >= 0.55 && strength <= 0.75, `strength at 80 is ${(100 * strength).toFixed(1)}% of at 35`);
  const capacity = at80.capacity / at35.capacity;
  assert.ok(capacity >= 0.6 && capacity <= 0.75, `capacity at 80 is ${(100 * capacity).toFixed(1)}% of at 35`);
  assert.ok(at56.skill > 0.95 && Math.abs(at35.skill - 1) < 1e-9, `skill's expression at 56: ${at56.skill.toFixed(3)}`);
  assert.ok(at80.skill >= 0.75 && at80.skill <= 0.9, `skill's expression at 80: ${at80.skill.toFixed(3)}`);
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('the adult frame comes from the spec or from the curve; aging needs metabolism; a save and load mid-run resumes the same', () => {
  const sim = createSim(defaultConfig(6), [feeder(0.15), metabolism, aging]);
  const child = spawnWithBody(sim, 100, 100, { sex: Sex.FEMALE, ageYears: 10, leanKg: 14.6, fatKg: 2.5 });
  const given = spawnWithBody(sim, 200, 100, { sex: Sex.FEMALE, ageYears: 10, leanKg: 14.6, fatKg: 2.5, adultFrameKg: 40 });
  const adult = spawnWithBody(sim, 300, 100, HADZA_WOMAN);
  stepSim(sim, 1);
  const frames = f64(sim, BODY_COLUMNS.adultFrameKg.name);
  assert.ok(Math.abs(frames[child] - 14.6 / frameShare(Sex.FEMALE, 10)) < 1e-6);
  assert.equal(frames[given], 40);
  assert.ok(Math.abs(frames[adult] - HADZA_WOMAN.leanKg) < 1e-9, 'a grown body is its own adult frame');
  assert.ok(f64(sim, AGING_COLUMNS.oldAgeAtYears.name)[adult] > 28);
  assert.throws(() => createSim(defaultConfig(6), [aging]), /needs body.metabolism/);
  const other = createSim(defaultConfig(6), [metabolism, aging]);
  assert.throws(() => formBody(other, spawnAgent(other, 10, 10), { ...HADZA_MAN, adultFrameKg: -1 }), RangeError);

  stepSim(sim, 3 * TPD);
  const b = loadSim(saveSim(sim), sim.pipeline);
  stepSim(sim, 20 * TPD);
  stepSim(b, 20 * TPD);
  assert.equal(hashSim(sim), hashSim(b));
  assert.ok(f64(sim, BODY_COLUMNS.leanBuiltKg.name)[child] > 14.6, 'the child grew');
  assert.deepEqual(auditConserved(sim.state.agents), []);
});
