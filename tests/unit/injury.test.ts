// Injury, healing and infection (docs/DESIGN.md §3.10): bleeding and shock,
// a clean cut healing, wound infections in fed and thin bodies, gut illness
// from foul water and the protection it leaves, fever, a broken leg, burns
// from fire, lightning, and the books kept across a save and load.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig } from '../../src/sim/config.ts';
import { auditConserved } from '../../src/sim/core/audit.ts';
import { StreamDomain, globalStreamOffset, nextFloat } from '../../src/sim/core/rng.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { HEAT_COLUMNS, heat } from '../../src/sim/body/heat.ts';
import {
  INJURY,
  INJURY_COLUMNS,
  INJURY_PARTS,
  InjuryKind,
  bloodVolumeL,
  conditionOf,
  exposeGut,
  feverOf,
  injure,
  injury,
  meatDose,
  waterDose,
} from '../../src/sim/body/injury.ts';
import { BODY_COLUMNS, BODY_PARTS, DeathCause, Effort, Sex, metabolism } from '../../src/sim/body/metabolism.ts';
import type { BodySpec } from '../../src/sim/body/metabolism.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { StrikeState } from '../../src/sim/world/climate.ts';
import { FIRE_LAYERS, FireStage } from '../../src/sim/world/fire.ts';
import { HADZA_MAN, fxKeeper, spawnWithBody } from '../fixtures/bodies.ts';
import { fxSurroundings, still } from '../fixtures/surroundings.ts';
import type { Weather } from '../fixtures/surroundings.ts';

const TPD = 144;
/** A Hadza-like man kept at about 3% body fat. */
const THIN_MAN: BodySpec = { sex: Sex.MALE, ageYears: 28, leanKg: 44.0, fatKg: 1.4 };

const col = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

function deathsBy(sim: Sim, cause: number): number {
  const part = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths);
  return part && part.readings ? part.readings()[cause] : Number.NaN;
}

function injuries(sim: Sim, kind: number): number {
  const part = sim.state.parts.find((p) => p.name === INJURY_PARTS.injuries);
  return part && part.readings ? part.readings()[kind] : Number.NaN;
}

/** Every body sits still every tick. */
const sitStill: SystemDef = defineSystem({
  name: 'fixture.still',
  create: (sim) => () => {
    const e = sim.state.agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
    for (let slot = 0; slot < sim.state.agents.highWater; slot++) e[slot] = Effort.STILL;
  },
});

/** Records, per slot, the highest value a column reached and the first and last tick it was above a level. */
function meter(name: string, level: number) {
  const most = new Float64Array(4096);
  const first = new Float64Array(4096).fill(-1);
  const last = new Float64Array(4096).fill(-1);
  const system = defineSystem({
    name: `fixture.meter.${name}`,
    create: (sim) => () => {
      const v = sim.state.agents.column<Float64Array>(name).data;
      const tick = sim.state.tick;
      for (let slot = 0; slot < sim.state.agents.highWater; slot++) {
        if (!sim.state.agents.isAlive(slot)) continue;
        if (v[slot] > most[slot]) most[slot] = v[slot];
        if (v[slot] > level) {
          if (first[slot] < 0) first[slot] = tick;
          last[slot] = tick;
        }
      }
    },
  });
  return { system, most, first, last };
}

/** Bodies in thermoneutral shade, kept fed and watered, with the given extra systems after body.injury. */
function ward(weather: (tick: number, slot: number) => Weather = () => still(30), after: SystemDef[] = [], before: SystemDef[] = []) {
  return createSim(defaultConfig(5), [sitStill, fxKeeper, ...before, fxSurroundings(weather), injury, ...after, heat, metabolism]);
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v.length === 0 ? Number.NaN : v[Math.floor(v.length / 2)];
}

test('the pieces: doses, condition, fever, blood volume', () => {
  assert.equal(waterDose(1, 1), INJURY.waterDosePerKg);
  assert.equal(meatDose(0.5, 0.5), INJURY.meatDosePerKg * 0.25);
  assert.equal(conditionOf(0.2), 1);
  assert.equal(conditionOf(0.005), INJURY.leastCondition);
  assert.ok(conditionOf(0.03) > 0.4 && conditionOf(0.03) < 0.7);
  assert.equal(feverOf(0), 0);
  assert.ok(feverOf(1) < INJURY.feverMostC && feverOf(1) > 2);
  assert.ok(Math.abs(bloodVolumeL(58) - 4.93) < 0.01, 'about 5 L for a 70 kg man');
  const sim = ward();
  const slot = spawnWithBody(sim, 100, 100);
  assert.throws(() => injure(sim, slot, { dirt: 1.5 }), RangeError);
  assert.throws(() => injure(sim, slot, { openCm2: -1 }), RangeError);
  assert.throws(() => exposeGut(sim, slot, Number.NaN), RangeError);
  const bare = createSim(defaultConfig(5), [heat, metabolism]);
  const other = spawnWithBody(bare, 100, 100);
  assert.throws(() => injure(bare, other, { openCm2: 1 }), /no body.injury/);
});

test('a small clean cut on a fed body closes within 3 weeks; its lost blood is rebuilt within about two months (§3.10)', () => {
  const sim = ward();
  const slot = spawnWithBody(sim, 100, 100);
  const leanBefore = col(sim, BODY_COLUMNS.leanKg.name)[slot];
  injure(sim, slot, { openCm2: 2, bleedMlMin: 20, dirt: 0.05 });
  stepSim(sim, 6);
  const owed = col(sim, INJURY_COLUMNS.rebuildKg.name)[slot];
  assert.ok(owed > 0.08 && owed < 0.12, `about 100 mL of blood lost (${owed} kg owed)`);
  assert.equal(col(sim, INJURY_COLUMNS.bleedMlMin.name)[slot], 0, 'the bleeding has stopped');
  stepSim(sim, 21 * TPD);
  assert.ok(sim.state.agents.isAlive(slot));
  assert.equal(col(sim, INJURY_COLUMNS.woundCm2.name)[slot], 0, 'closed within 3 weeks');
  stepSim(sim, 39 * TPD);
  assert.ok(col(sim, INJURY_COLUMNS.rebuildKg.name)[slot] < 0.1 * owed, 'rebuilt within two months');
  assert.ok(Math.abs(col(sim, BODY_COLUMNS.leanKg.name)[slot] - leanBefore) < 0.05);
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('a wound bleeding 600 mL a minute kills by shock within the hour; one bleeding 100 mL a minute does not (§3.10)', () => {
  const sim = ward();
  const heavy = spawnWithBody(sim, 100, 100);
  const light = spawnWithBody(sim, 110, 100);
  injure(sim, heavy, { openCm2: 20, bleedMlMin: 600 });
  injure(sim, light, { openCm2: 20, bleedMlMin: 100 });
  stepSim(sim, 6);
  assert.ok(!sim.state.agents.isAlive(heavy), 'the heavy bleeder is dead');
  assert.equal(deathsBy(sim, DeathCause.SHOCK), 1);
  stepSim(sim, TPD);
  assert.ok(sim.state.agents.isAlive(light));
  const mobility = col(sim, INJURY_COLUMNS.mobility.name)[light];
  assert.ok(mobility > 0.5 && mobility <= 1, `bleeding 0.5 L weakens a little (${mobility})`);
  assert.equal(injuries(sim, InjuryKind.WOUND), 2);
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('wound infections kill 2–15% of fed bodies, at least twice as many thin ones; cleared ones last 1–4 weeks (§3.10)', (t) => {
  const course = meter(INJURY_COLUMNS.woundInfection.name, 0);
  const sim = ward(undefined, [course.system]);
  const fed: number[] = [];
  const thin: number[] = [];
  for (let i = 0; i < 600; i++) {
    fed.push(spawnWithBody(sim, 100 + i, 100, HADZA_MAN));
    thin.push(spawnWithBody(sim, 100 + i, 200, THIN_MAN));
  }
  for (const slot of [...fed, ...thin]) injure(sim, slot, { openCm2: 60, dirt: 1 });
  stepSim(sim, 45 * TPD);
  const agents = sim.state.agents;
  let infectedFed = 0;
  let deadFed = 0;
  let infectedThin = 0;
  let deadThin = 0;
  const lasted: number[] = [];
  for (const slot of fed) {
    if (course.first[slot] >= 0) infectedFed++;
    if (course.first[slot] >= 0 && !agents.isAlive(slot)) deadFed++;
    if (agents.isAlive(slot) && course.first[slot] >= 0 && col(sim, INJURY_COLUMNS.woundInfection.name)[slot] === 0) {
      lasted.push((course.last[slot] - course.first[slot]) / TPD);
    }
  }
  for (const slot of thin) {
    if (course.first[slot] >= 0) infectedThin++;
    if (course.first[slot] >= 0 && !agents.isAlive(slot)) deadThin++;
  }
    const fedRate = deadFed / infectedFed;
  const thinRate = deadThin / infectedThin;
  t.diagnostic(
    `fed: ${deadFed} of ${infectedFed} infected died (${(100 * fedRate).toFixed(1)}%); thin: ${deadThin} of ${infectedThin} (${(100 * thinRate).toFixed(1)}%); ` +
      `cleared courses lasted a median ${median(lasted).toFixed(1)} days`,
  );
  assert.ok(infectedFed > 500 && infectedThin > 500, 'a dirty 60 cm² wound nearly always infects');
  assert.ok(fedRate >= 0.02 && fedRate <= 0.15, `fed death rate ${fedRate}`);
  assert.ok(thinRate >= 2 * fedRate, `thin death rate ${thinRate} against fed ${fedRate}`);
  assert.equal(deathsBy(sim, DeathCause.INFECTION), deadFed + deadThin);
  const m = median(lasted);
  assert.ok(m >= 7 && m <= 28, `cleared courses last ${m} days`);
  assert.deepEqual(auditConserved(agents), []);
});

test('foul water makes 50–80% ill for 2–10 days; with water to drink almost all live; the same water soon after makes few ill (§3.10)', (t) => {
  const course = meter(INJURY_COLUMNS.gutInfection.name, 0.05);
  const sim = ward(undefined, [course.system]);
  const slots: number[] = [];
  for (let i = 0; i < 400; i++) slots.push(spawnWithBody(sim, 100 + i, 100, HADZA_MAN));
  for (const slot of slots) exposeGut(sim, slot, waterDose(1, 1));
  stepSim(sim, 25 * TPD);
  const agents = sim.state.agents;
  const ill = slots.filter((slot) => course.first[slot] >= 0);
  const share = ill.length / slots.length;
  const days = ill.filter((slot) => agents.isAlive(slot)).map((slot) => (course.last[slot] - course.first[slot] + 1) / TPD);
  const died = slots.filter((slot) => !agents.isAlive(slot)).length;
  // Diarrhoea above 0.3 kg a day is a severity above 0.03; the meter's 0.05 is a little stricter.
  const peakWater = Math.max(...ill.map((slot) => course.most[slot])) * INJURY.diarrhoeaKgPerDay;
  t.diagnostic(
    `${ill.length} of ${slots.length} ill (${(100 * share).toFixed(0)}%); median ${median(days).toFixed(1)} days above 0.5 kg a day; ` +
      `${died} died; worst diarrhoea ${peakWater.toFixed(1)} kg a day; ${injuries(sim, InjuryKind.GUT_ILLNESS)} caught`,
  );
  assert.ok(share >= 0.5 && share <= 0.8, `ill share ${share}`);
  const m = median(days);
  assert.ok(m >= 2 && m <= 10, `median illness ${m} days`);
  assert.ok(died < 0.02 * slots.length, `${died} died`);

  // Drunk again, 25 days after the first.
  for (const slot of slots) {
    course.first[slot] = -1;
  }
  for (const slot of slots) if (agents.isAlive(slot)) exposeGut(sim, slot, waterDose(1, 1));
  stepSim(sim, 15 * TPD);
  const again = ill.filter((slot) => agents.isAlive(slot) && course.first[slot] >= 0).length;
  const fresh = slots.filter((slot) => agents.isAlive(slot) && !ill.includes(slot) && course.first[slot] >= 0).length;
  const neverIll = slots.filter((slot) => agents.isAlive(slot) && !ill.includes(slot)).length;
  t.diagnostic(`second drink: ${again} of ${ill.length} who were ill fell ill again; ${fresh} of ${neverIll} who were not`);
  assert.ok(again / ill.length < share / 3, 'recent illness protects');
  assert.ok(fresh / neverIll > 0.4, 'those never ill are as open as before');
  assert.deepEqual(auditConserved(agents), []);
});

test('an infected body runs a fever and spends more than its twin (§3.10)', () => {
  const sim = ward();
  const sick = spawnWithBody(sim, 100, 100);
  const twin = spawnWithBody(sim, 110, 100);
  // A course already at a severity of 0.3, held there by a strain as fast as the response.
  col(sim, INJURY_COLUMNS.woundInfection.name)[sick] = 0.3;
  col(sim, INJURY_COLUMNS.woundVirulence.name)[sick] = 0.5;
  stepSim(sim, TPD);
  const core = col(sim, HEAT_COLUMNS.coreC.name);
  assert.ok(core[sick] - core[twin] >= 0.5, `fever ${core[sick] - core[twin]} °C`);
  const spent = col(sim, BODY_COLUMNS.energyOut.name);
  assert.ok(spent[sick] > 1.2 * spent[twin], `${spent[sick]} kcal against ${spent[twin]}`);
  assert.ok(col(sim, INJURY_COLUMNS.mobility.name)[sick] < 0.9, 'fever slows');
});

test('a leg broken to 0.9 leaves mobility under 0.2, and above 0.85 after 8 weeks (§3.10)', () => {
  const sim = ward();
  const slot = spawnWithBody(sim, 100, 100);
  injure(sim, slot, { leg: 0.9, arm: 0.5 });
  stepSim(sim, 1);
  assert.ok(col(sim, INJURY_COLUMNS.mobility.name)[slot] < 0.2);
  assert.ok(Math.abs(col(sim, INJURY_COLUMNS.armUse.name)[slot] - 0.55) < 0.01);
  stepSim(sim, 56 * TPD);
  assert.ok(col(sim, INJURY_COLUMNS.mobility.name)[slot] > 0.85);
  assert.ok(col(sim, INJURY_COLUMNS.armUse.name)[slot] > 0.95);
});

/** Radiant heat (W/m²) that gives a heat dose of `dose` in one tick. */
function fluxFor(dose: number): number {
  const secondsPerTick = 86_400 / TPD;
  return 1000 * (INJURY.skinCarriesKwM2 + Math.pow(dose / secondsPerTick, 0.75));
}

test('burns: 10% of the skin is survived with water to drink; 40% kills by shock within two days; a flaming cell burns through (§3.10)', (t) => {
  // One tick of fire all round, at a dose that burns a chosen share of the skin, then cool shade.
  const share = (burned: number) => INJURY.partialBurnDose * (1 + burned / INJURY.surroundedShare);
  const doses = [share(0.1), share(0.4), 6 * INJURY.fullBurnDose];
  const weather = (tick: number, slot: number): Weather =>
    tick === 0 ? { ...still(30), fireWm2: fluxFor(doses[slot]), inFire: 1 } : still(30);
  const sim = ward(weather);
  const slots = doses.map((_, n) => spawnWithBody(sim, 100 + 10 * n, 100));
  stepSim(sim, 1);
  const burns = col(sim, INJURY_COLUMNS.burnShare.name);
  assert.ok(Math.abs(burns[slots[0]] - 0.1) < 0.005, `${burns[slots[0]]}`);
  assert.ok(Math.abs(burns[slots[1]] - 0.4) < 0.005, `${burns[slots[1]]}`);
  const skinCm2 = 10_000 * 0.11 * Math.pow(HADZA_MAN.leanKg + HADZA_MAN.fatKg, 2 / 3);
  assert.ok(col(sim, INJURY_COLUMNS.woundCm2.name)[slots[2]] > 0.7 * skinCm2, 'burned through over most of the skin');
  assert.equal(injuries(sim, InjuryKind.BURN), 3);
  stepSim(sim, 2 * TPD);
  const lost = col(sim, INJURY_COLUMNS.bloodLostL.name);
  t.diagnostic(`after two days: 10% burn alive ${sim.state.agents.isAlive(slots[0])} with ${lost[slots[0]].toFixed(2)} L missing; 40% burn alive ${sim.state.agents.isAlive(slots[1])}`);
  assert.ok(sim.state.agents.isAlive(slots[0]));
  assert.ok(!sim.state.agents.isAlive(slots[1]), 'the 40% burn died');
  assert.ok(!sim.state.agents.isAlive(slots[2]), 'the body burned through died');
  assert.equal(deathsBy(sim, DeathCause.SHOCK), 2);
  stepSim(sim, 3 * TPD);
  assert.ok(sim.state.agents.isAlive(slots[0]), 'the 10% burn lives five days on');
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('a body standing in a flaming cell is surrounded by fire', () => {
  const config = defaultConfig(11);
  const small = { ...config, world: { ...config.world, widthCells: 64, heightCells: 64 } };
  const at = SIM_PIPELINE.findIndex((system) => system.name === 'body.exposure');
  const kindle = defineSystem({
    name: 'fixture.kindle',
    create: (sim) => () => {
      const stage = sim.state.world.layer<Uint8Array>(FIRE_LAYERS.stage);
      stage[10 * 64 + 10] = FireStage.FLAMING;
    },
  });
  const sim = createSim(small, [...SIM_PIPELINE.slice(0, at), kindle, ...SIM_PIPELINE.slice(at)]);
  const cs = small.world.cellSizeM;
  const inside = spawnWithBody(sim, 10.5 * cs, 10.5 * cs);
  const outside = spawnWithBody(sim, 20.5 * cs, 20.5 * cs);
  stepSim(sim, 1);
  const inFire = col(sim, 'inFire');
  assert.equal(inFire[inside], 1);
  assert.equal(inFire[outside], 0);
});

test('lightning kills 3–20% of the bodies it strikes within 10 m (§3.10)', (t) => {
  // A fixture standing in for the climate: one strike in cell 0 every tick.
  const storm = defineSystem({
    name: 'fixture.storm',
    declare: (state) => state.addPart(new StrikeState()),
    create: (sim) => {
      const strikes = sim.state.parts.find((p) => p.name === 'climate.strikes') as StrikeState;
      return () => {
        strikes.count = 0;
        strikes.push(0);
      };
    },
  });
  const sim = ward(undefined, [], [storm]);
  const s = sim.state.streams;
  const o = globalStreamOffset(StreamDomain.FIXTURE);
  const cs = sim.config.world.cellSizeM;
  for (let i = 0; i < 3000; i++) spawnWithBody(sim, nextFloat(s, o) * cs, nextFloat(s, o) * cs);
  stepSim(sim, 30);
  const struck = injuries(sim, InjuryKind.LIGHTNING);
  const killed = deathsBy(sim, DeathCause.LIGHTNING);
  t.diagnostic(`${struck} struck, ${killed} killed (${((100 * killed) / struck).toFixed(1)}%)`);
  assert.ok(struck > 300, 'the disc of 10 m round each strike holds bodies');
  assert.ok(killed >= 0.03 * struck && killed <= 0.2 * struck);
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('injured, burned and infected bodies run identically after a save and load', () => {
  const build = () => {
    const sim = ward((tick) => (tick < 3 ? { ...still(25), fireWm2: 2600 } : still(25)));
    for (let i = 0; i < 12; i++) {
      const slot = spawnWithBody(sim, 100 + 2 * i, 100);
      injure(sim, slot, { openCm2: 5 * i, bleedMlMin: 30 * i, dirt: i / 12, leg: i % 3 === 0 ? 0.5 : 0 });
      exposeGut(sim, slot, waterDose(2, i / 12));
    }
    return sim;
  };
  const a = build();
  stepSim(a, 3 * TPD);
  const b = loadSim(saveSim(a), a.pipeline);
  stepSim(a, 5 * TPD);
  stepSim(b, 5 * TPD);
  assert.equal(hashSim(a), hashSim(b));
  assert.deepEqual(auditConserved(a.state.agents), []);
  assert.ok(injuries(a, InjuryKind.WOUND_INFECTION) + injuries(a, InjuryKind.GUT_ILLNESS) > 0);
});
