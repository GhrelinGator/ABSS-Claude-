// Heat and water (docs/DESIGN.md §3.9): the thermoneutral zone, shivering in
// the cold, sweat and survival without water in the heat, overheating at work,
// what fire, hides and other bodies do on a cold night, water bookkeeping, and
// body.exposure reading the world.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { auditConserved } from '../../src/sim/core/audit.ts';
import { cosTurn } from '../../src/sim/core/dmath.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { EXPOSURE } from '../../src/sim/body/exposure.ts';
import { HEAT, HEAT_COLUMNS, SURROUNDINGS, drink, fullWaterKg, heat, saturationKPa, skinAreaM2 } from '../../src/sim/body/heat.ts';
import { BODY_COLUMNS, BODY_PARTS, DeathCause, Effort, Sex, basalKcalPerDay, metabolism } from '../../src/sim/body/metabolism.ts';
import type { BodySpec } from '../../src/sim/body/metabolism.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { CLIMATE_PARTS, airTemperatureC } from '../../src/sim/world/climate.ts';
import { FIRE_FIELDS, FIRE_PARTS, fireConditions } from '../../src/sim/world/fire.ts';
import { Material, OBJECT_STORE, ROCK_SHELTER_STORE, RockShelterKind, spawnObject } from '../../src/sim/world/materials.ts';
import { TERRAIN_LAYERS } from '../../src/sim/world/terrain.ts';
import { HADZA_MAN, MAN_DAY, dayScript, spawnWithBody } from '../fixtures/bodies.ts';
import type { Step } from '../fixtures/bodies.ts';
import { fxSurroundings, still } from '../fixtures/surroundings.ts';
import type { Weather } from '../fixtures/surroundings.ts';

const TPD = 144;
/** A man of about 70 kg, the size of the soldiers behind the survival table. */
const MAN_70: BodySpec = { sex: Sex.MALE, ageYears: 30, leanKg: 58, fatKg: 12 };

const col = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

function deathsBy(sim: Sim, cause: number): number {
  const part = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths);
  return part && part.readings ? part.readings()[cause] : Number.NaN;
}

/** Every body holds the same effort every tick. */
function hold(effort: number): SystemDef {
  return defineSystem({
    name: 'fixture.effort',
    create: (sim) => () => {
      const e = sim.state.agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
      for (let slot = 0; slot < sim.state.agents.highWater; slot++) e[slot] = effort;
    },
  });
}

/** Adds up the shivering body.heat asks for, per slot, before metabolism charges and clears it (W × ticks). */
function shiverMeter(): { system: SystemDef; total: Float64Array } {
  const total = new Float64Array(64);
  const system = defineSystem({
    name: 'fixture.shiverMeter',
    create: (sim) => () => {
      const shiver = col(sim, BODY_COLUMNS.shiverW.name);
      for (let slot = 0; slot < sim.state.agents.highWater; slot++) total[slot] += shiver[slot];
    },
  });
  return { system, total };
}

/** A body (or several) in scripted surroundings, holding one effort. */
function inWeather(weather: (tick: number, slot: number) => Weather, effort: number, specs: BodySpec[] = [HADZA_MAN]) {
  const meter = shiverMeter();
  const sim = createSim(defaultConfig(3), [hold(effort), fxSurroundings(weather), heat, meter.system, metabolism]);
  const slots = specs.map((spec, n) => spawnWithBody(sim, 100 + 10 * n, 100, spec));
  return { sim, slots, shivered: meter.total };
}

/** Daily cycle between `top` (at 15:00) and `top` − 15 °C, in shade, dry air, a light breeze, lightly clothed. */
function desertShade(top: number) {
  return (tick: number): Weather => {
    const t = top - 7.5 + 7.5 * cosTurn((tick % TPD) / TPD - 15 / 24);
    return { airC: t, radiantC: t, humidity: 0.2, windMs: 1, hideClo: 1 };
  };
}

test('the pieces: vapour pressure, skin area', () => {
  assert.ok(Math.abs(saturationKPa(20) - 2.339) < 0.01, `${saturationKPa(20)} kPa at 20 °C`);
  assert.ok(Math.abs(saturationKPa(35) - 5.62) < 0.03, `${saturationKPa(35)} kPa at 35 °C`);
  // DuBois gives about 1.85 m² for 70 kg at 1.75 m, about 1.5 m² for 51 kg at 1.6 m.
  assert.ok(Math.abs(skinAreaM2(70) - 1.85) < 0.1 && Math.abs(skinAreaM2(51) - 1.5) < 0.1);
});

test('a naked sleeper in still shade neither shivers nor sweats somewhere between 26 and 33 °C (§3.9)', (t) => {
  const neutral: number[] = [];
  let coldShiver = 0;
  let hotSweat = 0;
  for (let air = 20; air <= 36; air++) {
    const { sim, slots, shivered } = inWeather(() => still(air), Effort.SLEEP);
    stepSim(sim, TPD);
    const before = col(sim, HEAT_COLUMNS.waterOut.name)[slots[0]];
    const shiverBefore = shivered[slots[0]];
    stepSim(sim, TPD);
    const out = col(sim, HEAT_COLUMNS.waterOut.name)[slots[0]] - before;
    const shiverKcal = ((shivered[slots[0]] - shiverBefore) * 600) / 4184;
    // Insensible loss plus the least urine is about 1 kg a day; more than 1.1 is sweat.
    if (shiverKcal < 5 && out < 1.1) neutral.push(air);
    if (air === 20) coldShiver = shiverKcal;
    if (air === 36) hotSweat = out;
  }
  t.diagnostic(`neither shivering nor sweating at ${neutral.join(', ')} °C; at 20 °C shivering costs ${coldShiver.toFixed(0)} kcal a day; at 36 °C ${hotSweat.toFixed(2)} kg of water a day`);
  assert.ok(neutral.length > 0 && neutral.every((a) => a >= 26 && a <= 33), `neutral at ${neutral}`);
  assert.ok(coldShiver > 200, 'a naked sleeper shivers at 20 °C');
  assert.ok(hotSweat > 1.5, 'a naked sleeper sweats at 36 °C');
});

test('naked, sitting in still air at 5 °C for two hours: 1.5–3.5 × the resting rate, core within 1.5 °C (§3.9)', (t) => {
  const { sim, slots } = inWeather(() => still(5), Effort.STILL);
  const slot = slots[0];
  stepSim(sim, 1);
  const before = col(sim, BODY_COLUMNS.energyOut.name)[slot];
  stepSim(sim, 12);
  const spent = col(sim, BODY_COLUMNS.energyOut.name)[slot] - before;
  const resting = (1.4 * basalKcalPerDay(Sex.MALE, 28, HADZA_MAN.leanKg + HADZA_MAN.fatKg) * 2) / 24;
  const core = col(sim, HEAT_COLUMNS.coreC.name)[slot];
  t.diagnostic(`${(spent / resting).toFixed(2)} × resting; core ${core.toFixed(2)} °C`);
  assert.ok(spent / resting > 1.5 && spent / resting < 3.5, `${spent / resting} × resting`);
  assert.ok(core > 35.5, `core ${core}`);
});

test('resting in shade with no water: dies of dehydration in about the days of the survival table (§3.9)', (t) => {
  const days: number[] = [];
  for (const top of [49, 43, 38, 32, 27, 21]) {
    const { sim, slots } = inWeather(desertShade(top), Effort.STILL, [MAN_70]);
    let ticks = 0;
    while (sim.state.agents.isAlive(slots[0]) && ticks < TPD * 40) {
      stepSim(sim, 1);
      ticks++;
    }
    assert.equal(deathsBy(sim, DeathCause.DEHYDRATION), 1, `top ${top} °C: should die of dehydration`);
    days.push(ticks / TPD);
  }
  t.diagnostic(`days to death at tops of 49, 43, 38, 32, 27, 21 °C: ${days.map((d) => d.toFixed(1)).join(', ')} (table: 2, 3, 5, 7, 9, 10)`);
  for (let n = 1; n < days.length; n++) assert.ok(days[n] > days[n - 1], 'survival shortens as the heat rises');
  assert.ok(days[1] > 0.6 * 3 && days[1] < 1.6 * 3, `top 43 °C: ${days[1]} days`);
  assert.ok(days[5] > 0.6 * 10 && days[5] < 1.6 * 10, `top 21 °C: ${days[5]} days`);
  assert.ok(days[5] < 30, 'dehydration kills well before starvation');
});

test("a Hadza-like day in warm weather turns over 2–6 kg of water (§3.9)", (t) => {
  // The outing (ticks 42 to 75 of the day) is in the sun; the rest in shade. Every hour the body
  // drinks back what it is short, so what leaves is what the day costs, not surplus passed.
  const plan: Step[] = MAN_DAY;
  const topUp = defineSystem({
    name: 'fixture.topUp',
    create: (sim) => () => {
      if (sim.state.tick % 6 !== 0) return;
      for (let slot = 0; slot < sim.state.agents.highWater; slot++) {
        if (!sim.state.agents.isAlive(slot)) continue;
        const short = fullWaterKg(col(sim, BODY_COLUMNS.leanKg.name)[slot]) - col(sim, HEAT_COLUMNS.water.name)[slot];
        if (short > 0) drink(sim, slot, short);
      }
    },
  });
  const weather = (tick: number): Weather => {
    const of = tick % TPD;
    const air = 26 + 6 * cosTurn(of / TPD - 15 / 24);
    return { airC: air, radiantC: air, humidity: 0.4, windMs: 1, sunWm2: of >= 42 && of < 76 ? 700 : 0 };
  };
  const sim = createSim(defaultConfig(3), [dayScript(plan), fxSurroundings(weather), heat, topUp, metabolism]);
  const slot = spawnWithBody(sim, 100, 100, HADZA_MAN);
  stepSim(sim, TPD * 2);
  const out0 = col(sim, HEAT_COLUMNS.waterOut.name)[slot];
  const kcal0 = col(sim, BODY_COLUMNS.energyOut.name)[slot];
  stepSim(sim, TPD);
  const out = col(sim, HEAT_COLUMNS.waterOut.name)[slot] - out0;
  const kcal = col(sim, BODY_COLUMNS.energyOut.name)[slot] - kcal0;
  const core = col(sim, HEAT_COLUMNS.coreC.name)[slot];
  t.diagnostic(`water out ${out.toFixed(2)} kg a day; energy ${kcal.toFixed(0)} kcal a day; core ${core.toFixed(2)} °C`);
  assert.ok(out > 2 && out < 6, `${out} kg a day`);
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('heavy work in hot, humid sun overheats a body within a day; in shade at 20 °C it does not (§3.9)', (t) => {
  const hot = inWeather(() => ({ airC: 35, radiantC: 35, humidity: 0.7, windMs: 0.5, sunWm2: 800 }), Effort.HEAVY);
  let ticks = 0;
  while (hot.sim.state.agents.isAlive(hot.slots[0]) && ticks < TPD) {
    stepSim(hot.sim, 1);
    ticks++;
  }
  t.diagnostic(`in the hot sun: dead after ${(ticks / 6).toFixed(1)} hours`);
  assert.equal(deathsBy(hot.sim, DeathCause.HYPERTHERMIA), 1);

  const cool = inWeather(() => ({ ...still(20), windMs: 0.5 }), Effort.HEAVY);
  let hottest = 0;
  for (let n = 0; n < TPD; n++) {
    if (n % 6 === 0) drink(cool.sim, cool.slots[0], 0.3);
    stepSim(cool.sim, 1);
    const core = col(cool.sim, HEAT_COLUMNS.coreC.name)[cool.slots[0]];
    if (core > hottest) hottest = core;
  }
  t.diagnostic(`in shade at 20 °C: hottest core ${hottest.toFixed(2)} °C`);
  assert.ok(cool.sim.state.agents.isAlive(cool.slots[0]) && hottest < 38.5, `hottest core ${hottest}`);
});

test('on a clear, calm night at 0 °C a naked sleeper shivers; a fire, a hide, or bodies against it cut what the cold costs (§3.9)', (t) => {
  const night = (extra: Partial<Weather>) => (): Weather => ({ airC: 0, radiantC: -EXPOSURE.clearSkyC, humidity: 0.8, windMs: 0.5, ...extra });
  /** What 12 hours of the night cost, kcal: heat made by shivering plus heat drawn from the core. */
  const shiverOver12Hours = (extra: Partial<Weather>): number => {
    const { sim, slots, shivered } = inWeather(night(extra), Effort.SLEEP);
    stepSim(sim, 72);
    assert.ok(sim.state.agents.isAlive(slots[0]), `alive after 12 hours with ${JSON.stringify(extra)}`);
    const mass = HADZA_MAN.leanKg + HADZA_MAN.fatKg;
    const drawn = (HEAT.heatCapacityJPerKgK * mass * (HEAT.coreC - col(sim, HEAT_COLUMNS.coreC.name)[slots[0]])) / 4184;
    return (shivered[slots[0]] * 600) / 4184 + drawn;
  };
  const alone = shiverOver12Hours({});
  // A 20 kW fire 1.5 m away: 30% of its heat spread over a sphere (DESIGN.md §2.16).
  const fire = shiverOver12Hours({ fireWm2: (0.3 * 20_000) / (4 * Math.PI * 1.5 * 1.5) });
  const hide = shiverOver12Hours({ hideClo: EXPOSURE.hideCloPerKg * 3 });
  const huddled = shiverOver12Hours({ contact: 2 * EXPOSURE.contactShare });
  const soaked = shiverOver12Hours({ hideClo: EXPOSURE.hideCloPerKg * 3, rainMmH: 2 });
  t.diagnostic(
    `shivering and core heat lost over 12 hours, kcal: alone ${alone.toFixed(0)}, by a fire ${fire.toFixed(0)}, in a 3 kg hide ${hide.toFixed(0)} (soaked ${soaked.toFixed(0)}), between two others ${huddled.toFixed(0)}`,
  );
  assert.ok(alone > 500, `alone ${alone}`);
  assert.ok(fire < alone && hide < alone && huddled < alone);
  assert.ok(soaked > hide, 'a soaked hide keeps less heat in');
});

test('drinking, urine and the water made by burning fuel keep the books; a surplus passes within hours', () => {
  const { sim, slots } = inWeather(() => still(29), Effort.STILL);
  const slot = slots[0];
  stepSim(sim, 1);
  const water = col(sim, HEAT_COLUMNS.water.name);
  const full = fullWaterKg(col(sim, BODY_COLUMNS.leanKg.name)[slot]);
  assert.ok(Math.abs(water[slot] - full) < 0.01, 'a body starts with its full water');
  drink(sim, slot, 1.5);
  stepSim(sim, 18);
  assert.ok(water[slot] - full < 0.4, `three hours after drinking 1.5 kg the surplus is ${water[slot] - full} kg`);
  assert.deepEqual(auditConserved(sim.state.agents), []);
  assert.ok(col(sim, HEAT_COLUMNS.waterIn.name)[slot] > full + 1.5, 'burning fuel makes water');

  const bare = createSim(defaultConfig(3), [metabolism]);
  assert.throws(() => drink(bare, spawnWithBody(bare, 10, 10), 1), /no body.heat/);
  assert.throws(() => drink(sim, slot, -1), RangeError);
  assert.throws(() => drink(sim, spawnAgent(sim, 20, 20), 1), /has no body/);
  assert.throws(() => createSim(defaultConfig(3), [heat]), /needs body.metabolism/);
});

test('bodies in the cold and heat run identically after a save and load', () => {
  const weather = (tick: number, slot: number): Weather => ({
    airC: 10 + 20 * cosTurn(tick / TPD) + slot,
    radiantC: 5 + slot,
    humidity: 0.5,
    windMs: slot % 3,
    rainMmH: slot % 4 === 0 ? 1 : 0,
    sunWm2: slot % 2 ? 400 : 0,
    contact: slot % 5 === 0 ? 0.12 : 0,
  });
  const make = () => [hold(Effort.LIGHT), fxSurroundings(weather), heat, metabolism];
  const sim = createSim(defaultConfig(5), make());
  for (let n = 0; n < 12; n++) spawnWithBody(sim, 100 + n, 100, n % 2 ? MAN_70 : HADZA_MAN);
  stepSim(sim, 500);
  const resumed = loadSim(saveSim(sim), make());
  assert.equal(hashSim(resumed), hashSim(sim));
  stepSim(sim, 1500);
  stepSim(resumed, 1500);
  assert.equal(hashSim(resumed), hashSim(sim));
  assert.deepEqual(auditConserved(sim.state.agents), []);
  assert.ok(deathsBy(sim, DeathCause.DEHYDRATION) > 0, 'nobody drinks, so some should have died of thirst by day 14');
});

function smallWorld(seed: number, cells = 48, circumscription = 0.9): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = circumscription;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

test('body.exposure reads air, wind, sky, hides, fire and neighbours from the world at each body', () => {
  const sim = smallWorld(11);
  const cs = sim.config.world.cellSizeM;
  const elevation = sim.state.world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
  // Three bodies close together on the same spot, one alone; a hide for the first; a burning stick by the last.
  const together = [0, 1, 2].map((n) => spawnWithBody(sim, 1000 + 0.3 * n, 1000));
  const apart = spawnWithBody(sim, 2000, 2000);
  const hide = spawnObject(sim, Material.HIDE, 1000, 1000, 2.5, 1.5, 0);
  const objects = sim.state.store(OBJECT_STORE);
  objects.column<Uint32Array>('holder').data[hide] = sim.state.agents.id.data[together[0]];
  const stick = spawnObject(sim, Material.WOOD, 2001, 2000, 0.5, 1, 0);
  objects.column<Float32Array>('burnKw').data[stick] = 20;
  (sim.state.parts.find((p) => p.name === FIRE_PARTS.counts)!.readings!() as Float64Array)[FIRE_FIELDS.burningObjects] += 1;

  // A cave on this walled map, with a body in it.
  const shelters = sim.state.store(ROCK_SHELTER_STORE);
  const kind = shelters.column<Uint8Array>('kind').data;
  let cave = -1;
  for (let s = 0; s < shelters.highWater && cave < 0; s++) if (shelters.alive.data[s] === 1 && kind[s] === RockShelterKind.CAVE) cave = s;
  assert.ok(cave >= 0, 'this walled map has a cave');
  const inCave = spawnWithBody(sim, shelters.column<Float64Array>('x').data[cave], shelters.column<Float64Array>('y').data[cave]);

  stepSim(sim, 1);
  const tick = sim.state.tick - 1;
  const weather = sim.state.parts.find((p) => p.name === CLIMATE_PARTS.weather)!.readings!();
  const air = col(sim, SURROUNDINGS.airC.name);
  for (const slot of [together[0], apart, inCave]) {
    const x = col(sim, 'x')[slot];
    const y = col(sim, 'y')[slot];
    const k = Math.floor(y / cs) * sim.config.world.widthCells + Math.floor(x / cs);
    assert.ok(Math.abs(air[slot] - airTemperatureC(sim.config, tick, weather, elevation[k])) < 1e-9, 'air temperature at the cell height');
  }
  const conditions = fireConditions(sim);
  conditions.refresh(tick);
  const wind = col(sim, SURROUNDINGS.windMs.name);
  assert.ok(wind[apart] <= (EXPOSURE.bodyHeightWind * conditions.windKmh) / 3.6 + 1e-9);
  assert.ok(wind[inCave] <= 0.051 * ((EXPOSURE.bodyHeightWind * conditions.windKmh) / 3.6) + 1e-9, 'a cave keeps off the wind');
  assert.equal(col(sim, SURROUNDINGS.sunWm2.name)[inCave], 0, 'a cave hides the sky');
  assert.equal(col(sim, SURROUNDINGS.radiantC.name)[inCave], air[inCave], 'inside a cave the radiant surroundings are at air temperature');
  assert.ok(Math.abs(col(sim, SURROUNDINGS.hideClo.name)[together[0]] - 2.5 * EXPOSURE.hideCloPerKg) < 1e-6, 'the held hide insulates its holder');
  assert.equal(col(sim, SURROUNDINGS.hideClo.name)[together[1]], 0);
  const contact = col(sim, SURROUNDINGS.contact.name);
  assert.ok(Math.abs(contact[together[1]] - 2 * EXPOSURE.contactShare) < 1e-9, 'the middle body touches two others');
  assert.ok(Math.abs(contact[together[0]] - EXPOSURE.contactShare) < 1e-9, 'the first touches only the second: the third is 0.6 m away');
  assert.equal(contact[apart], 0);
  assert.ok(col(sim, SURROUNDINGS.fireWm2.name)[apart] > 10, 'a burning stick 1 m away warms');
  assert.equal(col(sim, SURROUNDINGS.fireWm2.name)[together[0]], 0, 'it does not reach a kilometre and a half');
  const humidity = col(sim, SURROUNDINGS.humidity.name);
  assert.ok(humidity[apart] >= 0.1 && humidity[apart] <= 1);
  assert.deepEqual(auditConserved(sim.state.agents), []);
  assert.ok(Math.abs(col(sim, HEAT_COLUMNS.coreC.name)[apart] - HEAT.coreC) < 0.5);
});
