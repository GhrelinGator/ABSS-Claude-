// Metabolism (docs/DESIGN.md §3.8): the basal rate, what moving and working
// cost, absorption, Forbes's split between fat and lean, starvation, and the
// calibration targets of §9 hit by scripted bodies.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig } from '../../src/sim/config.ts';
import { auditConserved } from '../../src/sim/core/audit.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import {
  BODY_COLUMNS,
  BODY_PARTS,
  DeathCause,
  Effort,
  METABOLISM,
  Sex,
  basalKcalPerDay,
  fatKgOf,
  formBody,
  ingest,
  metabolism,
  motionKcal,
} from '../../src/sim/body/metabolism.ts';
import type { BodySpec } from '../../src/sim/body/metabolism.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { HADZA_MAN, HADZA_WOMAN, MAN_DAY, WOMAN_DAY, dayScript, fxBodyWork, repeat, spawnWithBody } from '../fixtures/bodies.ts';
import type { Step } from '../fixtures/bodies.ts';

const col = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

function fatOf(sim: Sim, slot: number): number {
  return fatKgOf(col(sim, BODY_COLUMNS.energy.name)[slot], col(sim, BODY_COLUMNS.gut.name)[slot], col(sim, BODY_COLUMNS.leanKg.name)[slot]);
}

function massOf(sim: Sim, slot: number): number {
  return fatOf(sim, slot) + col(sim, BODY_COLUMNS.leanKg.name)[slot];
}

function deaths(sim: Sim): number {
  const part = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths);
  return part && part.readings ? part.readings()[DeathCause.STARVATION] : Number.NaN;
}

/** A day with water and no food: sleep, sitting, a little standing about. */
const FAST_DAY: Step[] = [
  ...repeat(54, { effort: Effort.SLEEP }),
  ...repeat(70, { effort: Effort.STILL }),
  ...repeat(20, { effort: Effort.LIGHT }),
];

function bodySim(plan: readonly Step[], spec: BodySpec): { sim: Sim; slot: number } {
  const sim = createSim(defaultConfig(3), [dayScript(plan), metabolism]);
  const slot = spawnWithBody(sim, 100, 100, spec);
  return { sim, slot };
}

test('the basal rate follows the Schofield equations (FAO/WHO/UNU 2004, Table 5.2)', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} against ${b}`);
  near(basalKcalPerDay(Sex.MALE, 25, 60), 15.057 * 60 + 692.2);
  near(basalKcalPerDay(Sex.MALE, 45, 60), 11.472 * 60 + 873.1);
  near(basalKcalPerDay(Sex.MALE, 70, 60), 11.711 * 60 + 587.7);
  near(basalKcalPerDay(Sex.FEMALE, 25, 50), 14.818 * 50 + 486.6);
  near(basalKcalPerDay(Sex.FEMALE, 45, 50), 8.126 * 50 + 845.6);
  near(basalKcalPerDay(Sex.FEMALE, 12, 35), 13.384 * 35 + 692.6);
  near(basalKcalPerDay(Sex.MALE, 1, 10), 59.512 * 10 - 30.4);
  near(basalKcalPerDay(Sex.FEMALE, 5, 18), 20.315 * 18 + 485.9);
  assert.throws(() => basalKcalPerDay(0, 25, 60), /no such sex/);
});

test('moving costs what walking, running, climbing and carrying cost', () => {
  // Level walking at 1.25 m/s: net about half a kcal per kg per km.
  const walk = motionKcal(70, 0, 1000, 800, 0) / 70;
  assert.ok(walk > 0.4 && walk < 0.7, `walking ${walk} kcal/kg/km`);
  // Running: about 1 kcal per kg per km, whatever the speed.
  assert.ok(Math.abs(motionKcal(70, 0, 1000, 300, 0) / 70 - 1) < 1e-9);
  assert.ok(Math.abs(motionKcal(70, 0, 1000, 200, 0) / 70 - 1) < 1e-9);
  // Climbing: about 25% efficient lifting (9.81 J per kg per metre of useful work).
  const climb = (motionKcal(70, 0, 0, 0, 100) * 4184) / (70 * 100);
  assert.ok(9.81 / climb > 0.2 && 9.81 / climb < 0.3, `climbing ${climb} J/kg/m`);
  // A load makes the same walk dearer.
  assert.ok(motionKcal(60, 15, 1000, 800, 0) > motionKcal(60, 0, 1000, 800, 0) * 1.2);
  // Walking at 1.25 m/s costs about 3.2 × the basal rate in all (FAO's "walking at varying paces").
  const basalPerSecond = basalKcalPerDay(Sex.MALE, 25, 60) / 86_400;
  const ratio = (METABOLISM.movingRatio * basalPerSecond * 600 + motionKcal(60, 0, 750, 600, 0)) / (basalPerSecond * 600);
  assert.ok(ratio > 2.7 && ratio < 3.7, `walking ${ratio} × basal`);
});

test("a Hadza-like day costs about what Hadza adults spend (§9: ~2,600 kcal men, ~1,900 women)", (t) => {
  for (const [label, plan, spec, target] of [
    ['man', MAN_DAY, HADZA_MAN, 2600],
    ['woman', WOMAN_DAY, HADZA_WOMAN, 1900],
  ] as const) {
    const { sim, slot } = bodySim(plan, spec);
    stepSim(sim, 144 * 2);
    const before = col(sim, BODY_COLUMNS.energyOut.name)[slot];
    stepSim(sim, 144);
    const spent = col(sim, BODY_COLUMNS.energyOut.name)[slot] - before;
    // Pontzer et al. (2012) give PAL against BMR from Henry's (2005) equations, 18–30 years (from
    // memory: men 0.0669 W + 2.28 MJ, women 0.0546 W + 2.33 MJ). Reported beside their 2.26 ± 0.48
    // (men) and 1.78 ± 0.30 (women), not asserted (T-014).
    const mass = spec.leanKg + spec.fatKg;
    const henry = ((label === 'man' ? 0.0669 * mass + 2.28 : 0.0546 * mass + 2.33) * 1000) / 4.184;
    t.diagnostic(`${label}: ${spent.toFixed(0)} kcal a day; PAL ${(spent / henry).toFixed(2)} against a Henry BMR of ${henry.toFixed(0)}`);
    assert.ok(Math.abs(spent / target - 1) < 0.15, `${label}: ${spent.toFixed(0)} kcal a day against ${target}`);
    assert.deepEqual(auditConserved(sim.state.agents), []);
  }
});

test('a lean adult with no food dies of starvation in 30–80 days, having lost 30–50% of body mass', (t) => {
  for (const spec of [HADZA_MAN, HADZA_WOMAN]) {
    const { sim, slot } = bodySim(FAST_DAY, spec);
    const startMass = spec.leanKg + spec.fatKg;
    let lastMass = startMass;
    let lastFat = spec.fatKg;
    let day = 0;
    while (sim.state.agents.isAlive(slot) && day < 200) {
      lastMass = massOf(sim, slot);
      lastFat = fatOf(sim, slot);
      stepSim(sim, 144);
      day++;
    }
    const lost = 1 - lastMass / startMass;
    t.diagnostic(`sex ${spec.sex}: died on day ${day}, ${(lost * 100).toFixed(0)}% of body mass lost, ${lastFat.toFixed(2)} kg of fat left`);
    assert.ok(day >= 30 && day <= 80, `died on day ${day}`);
    assert.ok(lost > 0.3 && lost < 0.5, `lost ${(lost * 100).toFixed(0)}% of body mass`);
    assert.ok(lastFat > 0 && lastFat < 0.5 * spec.fatKg, `fat at death ${lastFat.toFixed(2)} kg`);
    assert.equal(deaths(sim), 1);
    assert.equal(sim.state.agents.count, 0);
  }
});

test("Forbes's rule: a lean body loses more of a deficit from lean tissue than a fat one", () => {
  const leanShare = (spec: BodySpec): number => {
    const { sim, slot } = bodySim(FAST_DAY, spec);
    stepSim(sim, 144 * 10);
    const lostLean = spec.leanKg - col(sim, BODY_COLUMNS.leanKg.name)[slot];
    const lostFat = spec.fatKg - fatOf(sim, slot);
    return lostLean / (lostLean + lostFat);
  };
  const thin = leanShare({ sex: Sex.MALE, ageYears: 30, leanKg: 50, fatKg: 5 });
  const fat = leanShare({ sex: Sex.MALE, ageYears: 30, leanKg: 50, fatKg: 30 });
  assert.ok(thin > 0.5 && fat < 0.35 && thin > fat * 2, `lean share of loss ${thin} (thin) against ${fat} (fat)`);
});

test('refeeding after a famine restores the lean mass it took', () => {
  const famine = repeat(144, { effort: Effort.STILL });
  const feast = repeat(144, { effort: Effort.STILL });
  for (let k = 0; k < 144; k += 6) feast[k].meal = 180; // 4,320 kcal a day, as fast as the gut absorbs
  let fasting = true;
  const switcher = defineSystem({
    name: 'fixture.switch',
    create: (sim) => {
      const fast = dayScript(famine).create(sim);
      const eat = dayScript(feast).create(sim);
      return () => (fasting ? fast() : eat());
    },
  });
  const sim = createSim(defaultConfig(3), [switcher, metabolism]);
  const slot = spawnWithBody(sim, 100, 100, HADZA_MAN);
  stepSim(sim, 144 * 20);
  const thinLean = col(sim, BODY_COLUMNS.leanKg.name)[slot];
  assert.ok(thinLean < HADZA_MAN.leanKg - 3, `the famine should take lean mass (${thinLean})`);
  fasting = false;
  let days = 0;
  while (fatOf(sim, slot) < HADZA_MAN.fatKg && days < 200) {
    stepSim(sim, 144);
    days++;
  }
  // The body travels back along Forbes's curve, L − C ln F = constant (stepping a day at a time overshoots a little).
  const lean = col(sim, BODY_COLUMNS.leanKg.name)[slot];
  const curve = (l: number, f: number) => l - METABOLISM.forbesKg * Math.log(f);
  assert.ok(Math.abs(curve(lean, fatOf(sim, slot)) - curve(HADZA_MAN.leanKg, HADZA_MAN.fatKg)) < 0.01, 'off the curve');
  assert.ok(days < 60 && Math.abs(lean - HADZA_MAN.leanKg) < 0.5, `lean ${lean} after ${days} days of food`);
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('food is absorbed over hours, and absorbing it costs nothing beyond the activity ratios (T-014)', () => {
  const sim = createSim(defaultConfig(3), [metabolism]);
  const fed = spawnWithBody(sim, 100, 100);
  const unfed = spawnWithBody(sim, 200, 100);
  ingest(sim, fed, 1500);
  const gut = col(sim, BODY_COLUMNS.gut.name);
  stepSim(sim, 10);
  assert.ok(Math.abs(gut[fed] - (1500 - 10 * 30)) < 1e-9, `gut ${gut[fed]} after 100 minutes`);
  stepSim(sim, 50);
  assert.equal(gut[fed], 0);
  const out = col(sim, BODY_COLUMNS.energyOut.name);
  // Same body, same day: FAO's activity ratios carry the response to food, so the only difference is
  // the slightly heavier body's basal share (a few kcal).
  const extra = out[fed] - out[unfed];
  assert.ok(extra > 0 && extra < 10, `absorbing 1,500 kcal cost ${extra}`);
});

test('the doors refuse a missing or second body, and odd inputs stop the run', () => {
  const sim = createSim(defaultConfig(3), [metabolism]);
  const bare = spawnAgent(sim, 10, 10);
  assert.throws(() => ingest(sim, bare, 100), /has no body/);
  assert.throws(() => stepSim(sim, 1), /has no body/);

  const other = createSim(defaultConfig(3), [metabolism]);
  const slot = spawnWithBody(other, 10, 10);
  assert.throws(() => formBody(other, slot, HADZA_WOMAN), /already has a body/);
  assert.throws(() => ingest(other, slot, -5), RangeError);
  assert.throws(() => formBody(other, spawnAgent(other, 20, 20), { ...HADZA_MAN, fatKg: 0 }), RangeError);
  col(other, BODY_COLUMNS.movedM.name)[slot] = 50;
  assert.throws(() => stepSim(other, 1), /in no time/);
});

test('bodies at work run identically after a save and load', () => {
  const sim = createSim(defaultConfig(5), [fxBodyWork, metabolism]);
  for (let i = 0; i < 30; i++) spawnWithBody(sim, 100 + i, 100, i % 2 ? HADZA_WOMAN : HADZA_MAN);
  stepSim(sim, 1000);
  const resumed = loadSim(saveSim(sim), [fxBodyWork, metabolism]);
  assert.equal(hashSim(resumed), hashSim(sim));
  stepSim(sim, 3000);
  stepSim(resumed, 3000);
  assert.equal(hashSim(resumed), hashSim(sim));
  assert.deepEqual(auditConserved(sim.state.agents), []);
  assert.ok(deaths(sim) > 0, 'the underfed agents should have starved by day 28');
  assert.equal(deaths(resumed), deaths(sim));
});
