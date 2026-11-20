// Reproduction (docs/DESIGN.md §3.6, §3.13): conception, pregnancy, birth,
// milk, infancy, and the interbirth interval of scripted mothers against §9.
// Targets were written in DESIGN.md §3.13 before the first run; where one
// fails, the test says so and checks the measured value instead (D-046).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditConserved, freshSpawnProblems } from '../../src/sim/core/audit.ts';
import { defaultConfig } from '../../src/sim/config.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { createSim, hashSim, loadSim, saveSim, stepSim } from '../../src/sim/sim.ts';
import { viewOf } from '../../src/sim/readonly.ts';
import { bodies } from '../../src/analysis/observers/bodies.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { aging, AGING_COLUMNS } from '../../src/sim/body/aging.ts';
import { fitness } from '../../src/sim/body/fitness.ts';
import { heat } from '../../src/sim/body/heat.ts';
import { INJURY_COLUMNS, injury, mobilityOf } from '../../src/sim/body/injury.ts';
import { fecundityAtAge, solidsAtAge, walkingAtAge } from '../../src/sim/body/lifecourse.ts';
import { BODY_COLUMNS, BODY_PARTS, DeathCause, Sex, fatKgOf, ingest, metabolism } from '../../src/sim/body/metabolism.ts';
import {
  BirthEvent,
  REPRODUCTION,
  REPRODUCTION_COLUMNS,
  REPRODUCTION_PARTS,
  balanceFactor,
  birthMassKg,
  lossChanceAt,
  mate,
  reproduction,
} from '../../src/sim/body/reproduction.ts';
import { HADZA_MAN, HADZA_WOMAN, fxKeeper, spawnWithBody } from '../fixtures/bodies.ts';
import { fxSurroundings, still } from '../fixtures/surroundings.ts';
import { FORAGER_REARING, fxRearing } from '../fixtures/rearing.ts';
import type { Rearing } from '../fixtures/rearing.ts';

const TPD = 144;
const TPY = TPD * 48;
const R = REPRODUCTION_COLUMNS;
const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;
const u8 = (sim: Sim, name: string) => sim.state.agents.column<Uint8Array>(name).data;
const part = (sim: Sim, name: string) => sim.state.parts.find((p) => p.name === name)!.readings!() as Float64Array;
const fatOf = (sim: Sim, slot: number) =>
  fatKgOf(f64(sim, BODY_COLUMNS.energy.name)[slot], f64(sim, BODY_COLUMNS.gut.name)[slot], f64(sim, BODY_COLUMNS.leanKg.name)[slot]);
const massOf = (sim: Sim, slot: number) => f64(sim, BODY_COLUMNS.leanKg.name)[slot] + fatOf(sim, slot);
const spare = (sim: Sim) => {
  const a = sim.state.agents;
  for (let s = 0; s < a.highWater; s++) if (a.isAlive(s)) f64(sim, AGING_COLUMNS.oldAgeAtYears.name)[s] = 1000;
};

/** Mild surroundings; bodies under two are held (other bodies against a third of their skin). */
function mild(simRef: () => Sim): SystemDef {
  return fxSurroundings((tick, slot) => {
    const born = f64(simRef(), BODY_COLUMNS.born.name)[slot];
    return (tick - born) / TPY < 2 ? { ...still(26), contact: 0.3 } : still(26);
  });
}

/** The whole body stack with scripted surroundings and `first` before it. */
function bodySim(seed: number, first: SystemDef[]): Sim {
  let ref: Sim | null = null;
  const sim = createSim(defaultConfig(seed), [...first, mild(() => ref!), injury, heat, reproduction, metabolism, fitness, aging]);
  ref = sim;
  return sim;
}

/** Mate `female` with `male` every tick until she conceives (at most `tries`); the tick it took. */
function conceive(sim: Sim, female: number, male: number, tries = 2000): number {
  for (let t = 0; t < tries; t++) {
    mate(sim, female, male);
    if (u8(sim, R.pregnant.name)[female] === 1) return t;
    stepSim(sim, 1);
  }
  return -1;
}

test('the pieces: fertility by age and energy, birth mass, loss by age, what a young body cannot do', () => {
  assert.equal(fecundityAtAge(Sex.FEMALE, 12), 0);
  assert.equal(fecundityAtAge(Sex.FEMALE, 25), 1);
  assert.equal(fecundityAtAge(Sex.FEMALE, 52), 0);
  assert.ok(fecundityAtAge(Sex.FEMALE, 42) > 0.3 && fecundityAtAge(Sex.FEMALE, 42) < 0.6);
  assert.equal(fecundityAtAge(Sex.MALE, 12), 0);
  assert.ok(fecundityAtAge(Sex.MALE, 70) > 0.5);
  assert.equal(balanceFactor(50), 1);
  assert.equal(balanceFactor(-75), 0.5);
  assert.equal(balanceFactor(-400), 0);
  // A Hadza-like mother's newborns: 3.0 kg girls, 3.3 kg boys.
  assert.ok(Math.abs(birthMassKg(Sex.FEMALE, 34) - 2.97) < 0.05);
  assert.ok(Math.abs(birthMassKg(Sex.MALE, 44) - 3.33) < 0.05);
  assert.ok(lossChanceAt(25) > 0.08 && lossChanceAt(25) < 0.13 && lossChanceAt(44) > 0.6);
  assert.equal(solidsAtAge(0.1), 0);
  assert.equal(solidsAtAge(3), 1);
  assert.equal(walkingAtAge(0.5), 0);
  assert.equal(walkingAtAge(12), 1);
});

test('mating: a fed woman conceives in about half a year; a girl, a woman past fifty, a hungry woman and a same-sex pair do not', (t) => {
  // Forty well-fed women and one man, mated every two days.
  const sim = bodySim(21, [fxKeeper]);
  const man = spawnWithBody(sim, 100, 100, HADZA_MAN);
  const women: number[] = [];
  for (let i = 0; i < 40; i++) women.push(spawnWithBody(sim, 100, 100, { ...HADZA_WOMAN, ageYears: 20 + (i % 10) }));
  stepSim(sim, 1);
  spare(sim);
  const waited: number[] = [];
  for (let day = 0; day < 48 * 3; day++) {
    if (day % 2 === 0) for (const w of women) if (u8(sim, R.pregnant.name)[w] === 0 && waited[w] === undefined) mate(sim, w, man);
    for (const w of women) if (u8(sim, R.pregnant.name)[w] === 1 && waited[w] === undefined) waited[w] = day / 48;
    stepSim(sim, TPD);
  }
  const waits = women.map((w) => waited[w] ?? 3);
  const mean = waits.reduce((s, x) => s + x, 0) / waits.length;
  t.diagnostic(`40 fed women mated every two days: mean wait to conception ${mean.toFixed(2)} years`);
  assert.ok(mean >= 0.25 && mean <= 0.8, `mean wait ${mean.toFixed(2)} years`);

  // Each of these is mated 300 times and never conceives.
  const girl = spawnWithBody(sim, 100, 100, { ...HADZA_WOMAN, ageYears: 12, leanKg: 15, fatKg: 3 });
  const old = spawnWithBody(sim, 100, 100, { ...HADZA_WOMAN, ageYears: 52 });
  const hungry = spawnWithBody(sim, 100, 100, HADZA_WOMAN);
  const other = spawnWithBody(sim, 100, 100, HADZA_MAN);
  for (let i = 0; i < 300; i++) {
    f64(sim, R.balancePerDay.name)[hungry] = -400;
    for (const w of [girl, old, hungry]) mate(sim, w, man);
    mate(sim, other, man);
  }
  for (const w of [girl, old, hungry]) assert.equal(u8(sim, R.pregnant.name)[w], 0);
  assert.throws(() => mate(sim, man, man));
});

test('a fed pregnancy: a newborn on its curve, costs within range, audits balanced, a blank newborn, a clean snapshot', (t) => {
  const sim = bodySim(5, [fxKeeper]);
  const man = spawnWithBody(sim, 100, 100, HADZA_MAN);
  const mother = spawnWithBody(sim, 100, 100, { ...HADZA_WOMAN, ageYears: 24 });
  const twin = spawnWithBody(sim, 100, 100, { ...HADZA_WOMAN, ageYears: 24 });
  stepSim(sim, 1);
  spare(sim);
  // Find a conception carried to term (the chance of a loss is drawn at conception).
  let tries = 0;
  for (;;) {
    assert.ok(conceive(sim, mother, man) >= 0, 'she should conceive');
    if (f64(sim, R.lossAt.name)[mother] === 0) break;
    stepSim(sim, Math.ceil(0.45 * 0.75 * TPY));
    assert.equal(u8(sim, R.pregnant.name)[mother], 0, 'the pregnancy should have been lost');
    stepSim(sim, Math.ceil(0.1 * TPY) + 1);
    assert.ok(++tries < 10);
  }
  const start = sim.state.tick;
  const out = f64(sim, BODY_COLUMNS.energyOut.name);
  let mark = out[mother] - out[twin];
  let worstDay = 0;
  let worstAt = 0;
  let snapshotChecked = false;
  const id = sim.state.agents.id.data[mother];
  const sexOfFetus = u8(sim, R.fetusSex.name)[mother];
  const fetusFrame = f64(sim, R.fetusFrameKg.name)[mother];
  while (sim.state.tick - start < 0.75 * TPY + 2) {
    stepSim(sim, 1);
    const t = sim.state.tick - start;
    if (t % TPD === 0) {
      const now = f64(sim, BODY_COLUMNS.energyOut.name)[mother] - f64(sim, BODY_COLUMNS.energyOut.name)[twin];
      if (now - mark > worstDay) worstAt = t / TPD;
      worstDay = Math.max(worstDay, now - mark);
      mark = now;
      assert.deepEqual(auditConserved(sim.state.agents), [], `at day ${t / TPD}`);
    }
    if (!snapshotChecked && t === Math.round(0.6 * TPY)) {
      const resumed = loadSim(saveSim(sim), sim.pipeline);
      stepSim(sim, TPD);
      stepSim(resumed, TPD);
      assert.equal(hashSim(resumed), hashSim(sim), 'a snapshot mid-pregnancy resumes identically');
      snapshotChecked = true;
      mark = f64(sim, BODY_COLUMNS.energyOut.name)[mother] - f64(sim, BODY_COLUMNS.energyOut.name)[twin];
    }
    if (sim.state.agents.highWater > 3 && sim.state.agents.isAlive(3)) {
      assert.deepEqual(freshSpawnProblems(sim.state, sim.state.tick - 1), [], 'a newborn holds no learned content');
      break;
    }
  }
  const child = 3;
  assert.ok(sim.state.agents.isAlive(child), 'a newborn');
  assert.equal(sim.state.agents.column<Uint32Array>(R.motherId.name).data[child], id);
  const extra = f64(sim, BODY_COLUMNS.energyOut.name)[mother] - f64(sim, BODY_COLUMNS.energyOut.name)[twin];
  const born = massOf(sim, child);
  const want = birthMassKg(sexOfFetus, fetusFrame);
  t.diagnostic(`newborn ${born.toFixed(2)} kg (curve ${want.toFixed(2)}); pregnancy cost ${extra.toFixed(0)} kcal more than her twin, worst day ${worstDay.toFixed(0)} (day ${worstAt} of 36)`);
  assert.ok(Math.abs(born / want - 1) < 0.05, `newborn ${born.toFixed(2)} kg against ${want.toFixed(2)}`);
  assert.ok(extra >= 10_000 && extra <= 20_000, `pregnancy cost ${extra.toFixed(0)} kcal`);
  assert.ok(worstDay <= 1300, `worst day ${worstDay.toFixed(0)} kcal`);
  assert.equal(part(sim, REPRODUCTION_PARTS.births)[BirthEvent.BIRTH], 1);
  assert.ok(f64(sim, INJURY_COLUMNS.bleedMlMin.name)[mother] > 0, 'the mother bleeds');
  assert.ok(f64(sim, R.milkOnset.name)[mother] > 0, 'milk begins');
  assert.equal(mobilityOf(sim, child), 0, 'a newborn cannot walk');
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('births at scale: few mothers bleed to death, lost pregnancies by age, no stillbirths when fed', (t) => {
  const sim = bodySim(8, [fxKeeper]);
  const man = spawnWithBody(sim, 100, 100, HADZA_MAN);
  const women: number[] = [];
  for (let i = 0; i < 300; i++) women.push(spawnWithBody(sim, 100, 100, { ...HADZA_WOMAN, ageYears: 20 + (i % 9) }));
  stepSim(sim, 1);
  spare(sim);
  for (let t = 0; t < 400; t++) {
    for (const w of women) if (sim.state.agents.isAlive(w) && u8(sim, R.pregnant.name)[w] === 0) mate(sim, w, man);
    stepSim(sim, 1);
  }
  stepSim(sim, Math.ceil(0.8 * TPY));
  const b = part(sim, REPRODUCTION_PARTS.births);
  const deaths = part(sim, BODY_PARTS.deaths);
  const lostShare = b[BirthEvent.LOST] / b[BirthEvent.CONCEPTION];
  t.diagnostic(`${b[BirthEvent.CONCEPTION]} conceptions, ${b[BirthEvent.BIRTH]} births, ${b[BirthEvent.LOST]} lost (${(100 * lostShare).toFixed(1)}%), ${b[BirthEvent.STILLBIRTH]} stillborn; deaths by shock ${deaths[DeathCause.SHOCK]}`);
  assert.ok(b[BirthEvent.CONCEPTION] > 250);
  assert.ok(lostShare >= 0.05 && lostShare <= 0.2, `lost ${(100 * lostShare).toFixed(1)}%`);
  assert.equal(b[BirthEvent.STILLBIRTH], 0);
  assert.ok(deaths[DeathCause.SHOCK] <= 0.02 * b[BirthEvent.BIRTH], `${deaths[DeathCause.SHOCK]} mothers bled to death`);
  assert.deepEqual(auditConserved(sim.state.agents), []);
  const seen = bodies.observe(viewOf(sim));
  assert.equal(seen['births.live'], b[BirthEvent.BIRTH]);
  assert.equal(seen['births.lost'], b[BirthEvent.LOST]);
  assert.ok((seen.lactatingShare as number) > 0.5, 'the bodies observer sees mothers making milk');
});

test('milk: made as it is taken, at its cost; it stops without suckling; a newborn cannot live on solid food', (t) => {
  // A mother whose newborn is nursed on demand (the forager schedule), and one whose newborn is not.
  const sim = bodySim(3, [fxRearing({ ...FORAGER_REARING, mateEveryDays: 0, extraPerDay: 300 })]);
  const man = spawnWithBody(sim, 100, 100, HADZA_MAN);
  const mother = spawnWithBody(sim, 100, 100, { ...HADZA_WOMAN, ageYears: 24 });
  stepSim(sim, 1);
  spare(sim);
  conceive(sim, mother, man);
  while (u8(sim, R.pregnant.name)[mother] === 1) stepSim(sim, TPD);
  assert.ok(sim.state.agents.highWater > 2 && sim.state.agents.isAlive(2), 'born');
  const child = 2;
  const bornAt = f64(sim, BODY_COLUMNS.born.name)[child];
  spare(sim);
  const takenAt = (age: number) => {
    stepSim(sim, Math.max(0, Math.round(bornAt + age * TPY) - sim.state.tick));
    return { milk: f64(sim, R.milkOutKg.name)[mother], made: f64(sim, R.milkMadeKg.name)[mother], out: f64(sim, BODY_COLUMNS.energyOut.name)[mother] };
  };
  const a = takenAt(0.1);
  const b = takenAt(0.5);
  const days = 0.4 * 48;
  const perDay = (b.milk - a.milk) / days;
  const cost = ((b.made - a.made) * REPRODUCTION.milkKcalPerKg) / REPRODUCTION.milkEfficiency / days;
  const lean = f64(sim, BODY_COLUMNS.leanBuiltKg.name)[child];
  const curve = (sx: number) => (sx === Sex.MALE ? 0.065 + 0.5 * (0.18 - 0.065) : 0.075 + 0.5 * (0.19 - 0.075));
  const frame = f64(sim, BODY_COLUMNS.adultFrameKg.name)[child] * curve(u8(sim, BODY_COLUMNS.sex.name)[child]);
  t.diagnostic(`nursed alone, 0.1–0.5 years: ${perDay.toFixed(2)} kg of milk a day, costing the mother ${cost.toFixed(0)} kcal a day; frame at 0.5 ${lean.toFixed(2)} kg against ${frame.toFixed(2)}`);
  assert.ok(perDay >= 0.6 && perDay <= 1.1, `milk taken ${perDay.toFixed(2)} kg a day`);
  assert.ok(cost >= 500 && cost <= 900, `milk's cost ${cost.toFixed(0)} kcal a day`);
  assert.ok(Math.abs(lean / frame - 1) < 0.1, 'a nursed newborn grows along its curve');
  assert.deepEqual(auditConserved(sim.state.agents), []);

  // Unnursed: milk making stops within 20 days of a birth.
  const sim2 = bodySim(4, [fxKeeper]);
  const man2 = spawnWithBody(sim2, 100, 100, HADZA_MAN);
  const m2 = spawnWithBody(sim2, 100, 100, { ...HADZA_WOMAN, ageYears: 24 });
  stepSim(sim2, 1);
  spare(sim2);
  conceive(sim2, m2, man2);
  while (u8(sim2, R.pregnant.name)[m2] === 1) stepSim(sim2, 1);
  const birth = sim2.state.tick;
  stepSim(sim2, 1);
  while (f64(sim2, R.milkRate.name)[m2] >= REPRODUCTION.milkEndsBelowPerDay && sim2.state.tick - birth < 40 * TPD) stepSim(sim2, TPD);
  const stopped = (sim2.state.tick - birth) / TPD;
  t.diagnostic(`unnursed: milk stopped ${stopped.toFixed(0)} days after the birth`);
  assert.ok(stopped <= 20, `milk stopped after ${stopped} days`);
  stepSim(sim2, 10 * TPD);
  assert.ok(f64(sim2, R.milkKg.name)[m2] < 0.01, `what was left was taken back (${f64(sim2, R.milkKg.name)[m2].toFixed(3)} kg left, rate ${f64(sim2, R.milkRate.name)[m2]})`);
  assert.deepEqual(auditConserved(sim2.state.agents), []);

  // A newborn given only solid food (plenty of it) digests none before 0.3 years, lives on the fat it was
  // born with, and then on the share it digests: it grows far less than a nursed one.
  const solidsOnly = defineSystem({
    name: 'fixture.solidsOnly',
    create: (s) => () => {
      if (s.state.tick % 6 !== 0 || !s.state.agents.isAlive(0)) return;
      const taken = ingest(s, 0, 100);
      if (s.state.tick < 0.3 * TPY) assert.equal(taken, 0, 'nothing digested before 0.3 years');
    },
  });
  const sim3 = createSim(defaultConfig(5), [solidsOnly, metabolism, aging]);
  spawnWithBody(sim3, 100, 100, { sex: Sex.FEMALE, ageYears: 0, leanKg: 2.55, fatKg: 0.42, adultFrameKg: 34 });
  stepSim(sim3, 1);
  spare(sim3);
  let lowest = 1;
  for (let day = 0; day < 24 && sim3.state.agents.isAlive(0); day++) {
    stepSim(sim3, TPD);
    if (sim3.state.agents.isAlive(0)) lowest = Math.min(lowest, fatOf(sim3, 0) / massOf(sim3, 0));
  }
  const alive = sim3.state.agents.isAlive(0);
  const grown = alive ? f64(sim3, BODY_COLUMNS.leanBuiltKg.name)[0] / (34 * (0.075 + 0.5 * (0.19 - 0.075))) : 0;
  t.diagnostic(`given only solid food: ${alive ? `alive at 0.5 years, frame ${(100 * grown).toFixed(0)}% of its curve, fat as low as ${(100 * lowest).toFixed(1)}%` : 'died'}`);
  assert.ok(!alive || grown < 0.85, 'it grows less than a nursed newborn');
});

/** Eight Hadza-like mothers of 20 and one man on a regime for eight years: every interval between births. */
function intervals(r: Rearing, seed: number): { gaps: number[]; mothersAlive: number; audit: string[]; births: number } {
  const sim = bodySim(seed, [fxRearing(r)]);
  spawnWithBody(sim, 100, 100, HADZA_MAN);
  const mothers: number[] = [];
  for (let i = 0; i < 8; i++) mothers.push(spawnWithBody(sim, 100 + 3 * i, 100, { ...HADZA_WOMAN, ageYears: 20 }));
  stepSim(sim, 1);
  spare(sim);
  const a = sim.state.agents;
  const ids = mothers.map((s) => a.id.data[s]);
  const births = new Map<number, number[]>(ids.map((id) => [id, []]));
  const seen = new Set<number>();
  for (let d = 0; d < 48 * 8; d++) {
    stepSim(sim, TPD);
    const motherOf = a.column<Uint32Array>(R.motherId.name).data;
    for (let s = 0; s < a.highWater; s++) {
      if (!a.isAlive(s) || motherOf[s] === 0 || seen.has(a.id.data[s])) continue;
      seen.add(a.id.data[s]);
      f64(sim, AGING_COLUMNS.oldAgeAtYears.name)[s] = 1000;
      births.get(motherOf[s])!.push(f64(sim, BODY_COLUMNS.born.name)[s] / TPY);
    }
  }
  const gaps: number[] = [];
  for (const b of births.values()) for (let i = 1; i < b.length; i++) gaps.push(b[i] - b[i - 1]);
  return { gaps, mothersAlive: ids.filter((id) => a.slotOf(id) >= 0).length, audit: auditConserved(a), births: seen.size };
}

test('interbirth intervals: about 3–4 years for a forager mother; closer when fed for what she gives, further when she has no surplus', (t) => {
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const forager = intervals(FORAGER_REARING, 1);
  const fed = intervals({ ...FORAGER_REARING, extraPerDay: 0, refeedYoung: true }, 1);
  const lean = intervals({ ...FORAGER_REARING, extraPerDay: 0 }, 1);
  t.diagnostic(
    `mean interval: forager ${mean(forager.gaps).toFixed(2)} years (${forager.gaps.length}, ${forager.mothersAlive} of 8 mothers alive), ` +
      `fed ${mean(fed.gaps).toFixed(2)} (${fed.mothersAlive} alive), no surplus ${mean(lean.gaps).toFixed(2)} (${lean.gaps.length}, ${lean.mothersAlive} alive)`,
  );
  assert.ok(forager.gaps.length >= 8);
  assert.ok(mean(forager.gaps) >= 2.5 && mean(forager.gaps) <= 4.5, `forager ${mean(forager.gaps).toFixed(2)}`);
  assert.ok(mean(fed.gaps) < 2.5, `fed ${mean(fed.gaps).toFixed(2)}`);
  assert.ok(lean.gaps.length === 0 || mean(lean.gaps) > mean(forager.gaps), `no surplus ${mean(lean.gaps).toFixed(2)}`);
  assert.equal(forager.mothersAlive, 8);
  for (const r of [forager, fed, lean]) assert.deepEqual(r.audit, []);
});
