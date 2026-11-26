// Skills in acts (docs/DESIGN.md §4.12): an act that works on a thing achieves what the body's skill at
// it allows, between a novice's and an expert's, and adds the seconds it worked as practice to that
// act on that kind of thing; skill never changes the act's effort.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { FITNESS_COLUMNS, strength as strengthFrom } from '../../src/sim/body/fitness.ts';
import { GUT_COLUMNS } from '../../src/sim/body/gut.ts';
import { INJURY_COLUMNS } from '../../src/sim/body/injury.ts';
import { BODY_COLUMNS, Effort } from '../../src/sim/body/metabolism.ts';
import { SKILL_COLUMNS, SKILL_PAIRS, SkillAct, SkillKind, animalKind, bySkill, materialKind, plantKind, practice, practiceHours, skillLevel } from '../../src/sim/body/skills.ts';
import { ACTS, ACT_COLUMNS, Act, ActEnd, ActTally, createActs } from '../../src/sim/mind/acts.ts';
import type { Acts } from '../../src/sim/mind/acts.ts';
import { CHANNELS } from '../../src/sim/mind/interoception.ts';
import { CLASS, CueKind, PlantLook, animalClass, cue, materialClass, plantClass } from '../../src/sim/mind/cues.ts';
import { PerceptSource, createPerception } from '../../src/sim/mind/perception.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { ANIMAL_STORE, AnimalKind, CARCASS_LAYER, placeGroup } from '../../src/sim/world/animals.ts';
import { MOISTURE_LAYER } from '../../src/sim/world/climate.ts';
import { FIRE_CONSTANTS, fireConditions } from '../../src/sim/world/fire.ts';
import { Material, OBJECT_STORE, spawnObject } from '../../src/sim/world/materials.ts';
import { PLANT_SPECIES, foodLayer } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';
import { spawnWithBody } from '../fixtures/bodies.ts';

const NO_DRIVES = new Float64Array(CHANNELS);
/** Enough practice to be an expert: skill 0.99. */
const EXPERT_S = 3600 * 1_000_000;

function world(seed: number, cells = 48): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = 0.2;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

function handOn(sim: Sim): { acts: Acts; tally: Float64Array } {
  const tally = new Float64Array(ActTally.LENGTH);
  const acts = createActs(sim, createPerception(sim), tally);
  acts.refresh();
  return { acts, tally };
}

function centre(sim: Sim, k: number): [number, number] {
  const { widthCells: W, cellSizeM: cs } = sim.config.world;
  return [((k % W) + 0.5) * cs, (Math.floor(k / W) + 0.5) * cs];
}

function richest(layer: ArrayLike<number>, ok: (k: number) => boolean = () => true): number {
  let best = -1;
  for (let k = 0; k < layer.length; k++) if (ok(k) && (best < 0 || layer[k] > layer[best])) best = k;
  return best;
}

const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

/** Put a body back where a test wants it, rested (the mind system moved it during the step). */
function place(sim: Sim, slot: number, x: number, y: number): void {
  f64(sim, 'x')[slot] = x;
  f64(sim, 'y')[slot] = y;
  f64(sim, FITNESS_COLUMNS.acuteLoad.name)[slot] = 0;
}

/** All practice a body holds, life-hours, over every act and kind. */
function allPractice(sim: Sim, slot: number): number {
  const hours = sim.state.agents.column<Float32Array>(SKILL_COLUMNS.skillPractice.name).data;
  let sum = 0;
  for (let i = 0; i < SKILL_PAIRS; i++) sum += hours[slot * SKILL_PAIRS + i];
  return sum;
}

/** Life-hours a real second of practice counts (§3.11). */
const lifePerSecond = (sim: Sim) => 365.25 / sim.config.time.daysPerYear / 3600;

function hold(sim: Sim, slot: number, hand: number, object: number): void {
  const objects = sim.state.store(OBJECT_STORE);
  objects.column<Uint32Array>('holder').data[object] = sim.state.agents.id.data[slot];
  sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data[slot * 2 + hand] = objects.id.data[object];
}

test('an expert eats faster than a novice at the same stand, by bySkill; the same effort; eating is practice of consume × that species', () => {
  const sim = world(7);
  const s = PLANT_SPECIES.findIndex((sp) => sp.name === 'tuber');
  const layer = sim.state.world.layer<Float32Array>(foodLayer(PLANT_SPECIES[s]));
  const k = richest(layer);
  assert.ok(layer[k] > 50, `a cell rich in tubers: ${layer[k]}`);
  const [x, y] = centre(sim, k);
  const novice = spawnWithBody(sim, x, y);
  const expert = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  const kind = plantKind(s);
  practice(sim, expert, SkillAct.CONSUME, kind, EXPERT_S);
  const sk = skillLevel(sim, expert, SkillAct.CONSUME, kind);
  assert.ok(sk > 0.98, `expert's skill ${sk}`);
  assert.equal(skillLevel(sim, novice, SkillAct.CONSUME, kind), 0);
  const noviceBefore = allPractice(sim, novice);
  assert.equal(noviceBefore, 0, 'nothing practised yet');

  const { acts, tally } = handOn(sim);
  const stand = layer[k];
  const eat = (slot: number): number => {
    layer[k] = stand;
    place(sim, slot, x, y);
    // Empty hands: the mind ran a tick and may have picked something up, and a stick digs faster (§4.15.5).
    sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data.fill(0, slot * 2, slot * 2 + 2);
    const before = tally[ActTally.PLANT_KG + s];
    acts.begin(slot, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.LEAF)), PerceptSource.CELL, k, x, y, NO_DRIVES, 0);
    acts.run(slot);
    return tally[ActTally.PLANT_KG + s] - before;
  };
  const byNovice = eat(novice);
  const byExpert = eat(expert);
  const share = ACTS.plantNoviceShare.tuber;
  assert.ok(byNovice > 0);
  assert.ok(Math.abs(byExpert / byNovice - bySkill(share, 1, sk) / share) < 1e-6, `novice ${byNovice} kg, expert ${byExpert} kg`);
  const effort = sim.state.agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
  assert.equal(effort[novice], Effort.MODERATE);
  assert.equal(effort[expert], effort[novice], 'skill does not change the effort');

  // The novice worked the whole tick at the stand: 600 s of practice at consume × tuber, and nothing else.
  const got = practiceHours(sim, novice, SkillAct.CONSUME, kind);
  assert.ok(Math.abs(got - 600 * lifePerSecond(sim)) < 1e-4, `practice ${got} life-hours`);
  assert.ok(Math.abs(allPractice(sim, novice) - got) < 1e-6, 'no other pair practised');

  // Nothing is counted in the tick a body is spawned, though it eats.
  const newborn = spawnWithBody(sim, x, y);
  acts.refresh();
  layer[k] = stand;
  acts.begin(newborn, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.LEAF)), PerceptSource.CELL, k, x, y, NO_DRIVES, 0);
  acts.run(newborn);
  assert.ok(sim.state.agents.column<Float64Array>(ACT_COLUMNS.actGot.name).data[newborn] > 0, 'it ate');
  assert.equal(allPractice(sim, newborn), 0);

  // Searching a cell with none of it is not practice.
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const none = richest(layer, (q) => layer[q] === 0 && water[q] === Water.DRY);
  const [nx, ny] = centre(sim, none);
  const searcher = spawnWithBody(sim, nx, ny);
  stepSim(sim, 1);
  acts.refresh();
  place(sim, searcher, nx, ny);
  acts.begin(searcher, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.BARE)), PerceptSource.CELL, none, nx, ny, NO_DRIVES, 0);
  acts.run(searcher);
  assert.equal(sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[searcher], ActEnd.FAILED);
  assert.equal(allPractice(sim, searcher), 0);

  // Picking up loose wood gets no skill and records no practice (§4.12).
  const lifter = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  acts.refresh();
  place(sim, lifter, x, y);
  const stick = spawnObject(sim, Material.WOOD, x, y, 0.3, 0.6, 0);
  acts.begin(lifter, Act.PICK_UP, cue(CueKind.CLASS, CLASS.smallWood), PerceptSource.OBJECT, sim.state.store(OBJECT_STORE).id.data[stick], x, y, NO_DRIVES, 0);
  acts.run(lifter);
  assert.equal(sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[lifter], ActEnd.DONE);
  assert.equal(allPractice(sim, lifter), 0);
});

test('meat: an expert cuts faster than a novice with the same edge, and practises consume × carcass', () => {
  const sim = world(8);
  const meat = sim.state.world.layer<Float32Array>(CARCASS_LAYER);
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const m = richest(water, (q) => water[q] === Water.DRY);
  const [x, y] = centre(sim, m);
  const novice = spawnWithBody(sim, x, y);
  const expert = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  practice(sim, expert, SkillAct.CONSUME, SkillKind.CARCASS, EXPERT_S);
  const sk = skillLevel(sim, expert, SkillAct.CONSUME, SkillKind.CARCASS);
  for (const slot of [novice, expert]) hold(sim, slot, 0, spawnObject(sim, Material.FLINT, x, y, 0.05, 0.06, 0.9));
  const { acts } = handOn(sim);
  const stomach = (slot: number) => f64(sim, GUT_COLUMNS.stomachKg.name)[slot];
  const cut = (slot: number): number => {
    meat[m] = 100;
    place(sim, slot, x, y);
    const before = stomach(slot);
    acts.begin(slot, Act.CONSUME, cue(CueKind.CLASS, CLASS.carcass), PerceptSource.CELL, m, x, y, NO_DRIVES, 0);
    acts.run(slot);
    return stomach(slot) - before;
  };
  const byNovice = cut(novice);
  const byExpert = cut(expert);
  const share = ACTS.meatNoviceShareEdge;
  assert.ok(Math.abs(byExpert / byNovice - bySkill(share, 1, sk) / share) < 1e-6, `novice ${byNovice} kg, expert ${byExpert} kg`);
  assert.ok(Math.abs(practiceHours(sim, novice, SkillAct.CONSUME, SkillKind.CARCASS) - 600 * lifePerSecond(sim)) < 1e-4);
});

test('rubbing dry wood: a novice never makes an ember, an expert does; rubbing is practice of manipulate × wood', () => {
  const sim = world(7);
  stepSim(sim, 144 * 16); // a dry day in spring (seed 7)
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const k = richest(water, (q) => water[q] === Water.DRY);
  const [x, y] = centre(sim, k);
  const novice = spawnWithBody(sim, x, y);
  const expert = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  sim.state.world.layer<Float32Array>(MOISTURE_LAYER)[k] = 0.05;
  const moisture = fireConditions(sim).stickMoisture(k);
  practice(sim, expert, SkillAct.MANIPULATE, materialKind(Material.WOOD), EXPERT_S);
  const p = bySkill(ACTS.precisionNovice, ACTS.precisionExpert, skillLevel(sim, expert, SkillAct.MANIPULATE, materialKind(Material.WOOD)));
  for (const slot of [novice, expert]) for (let h = 0; h < 2; h++) hold(sim, slot, h, spawnObject(sim, Material.WOOD, x, y, 0.3, 0.6, 0));
  const { acts, tally } = handOn(sim);
  // The arithmetic of §4.12: an expert's rub delivers enough heat for these sticks, a novice's never does.
  const strength = strengthFrom(f64(sim, BODY_COLUMNS.leanKg.name)[expert], f64(sim, INJURY_COLUMNS.strain.name)[expert]);
  const rubJ = ACTS.rubS * ACTS.rubW * strength;
  const needed = FIRE_CONSTANTS.emberEnergyJ * (1 + FIRE_CONSTANTS.emberPerMoisture * Math.max(0, moisture - FIRE_CONSTANTS.emberDryMoisture));
  assert.ok(moisture <= FIRE_CONSTANTS.emberMostMoisture && rubJ * p * p > needed * 1.02, `sticks at ${moisture}: ${rubJ * p * p} J against ${needed}`);
  assert.ok(rubJ * ACTS.precisionNovice ** 2 < FIRE_CONSTANTS.emberEnergyJ);
  const rub = (slot: number): number => {
    place(sim, slot, x, y);
    const before = tally[ActTally.EMBERS];
    acts.begin(slot, Act.MANIPULATE, cue(CueKind.CLASS, CLASS.smallWood), PerceptSource.OBJECT, 0, 0, 0, NO_DRIVES, 0);
    acts.run(slot);
    return tally[ActTally.EMBERS] - before;
  };
  assert.equal(rub(novice), 0);
  assert.ok(rub(expert) >= 1, 'an expert made an ember');
  const effort = sim.state.agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
  assert.equal(effort[novice], Effort.HEAVY);
  assert.equal(effort[expert], Effort.HEAVY);
  // The novice rubbed five 2-minute attempts in its tick.
  const got = practiceHours(sim, novice, SkillAct.MANIPULATE, materialKind(Material.WOOD));
  assert.ok(Math.abs(got - 5 * ACTS.rubS * lifePerSecond(sim)) < 1e-4, `practice ${got}`);
});

test('striking stone: an expert flakes more often than a novice; striking is practice of strike × the struck material', () => {
  const sim = world(9);
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const k = richest(water, (q) => water[q] === Water.DRY);
  const [x, y] = centre(sim, k);
  const novice = spawnWithBody(sim, x, y);
  const expert = spawnWithBody(sim, x + 10, y);
  stepSim(sim, 1);
  practice(sim, expert, SkillAct.STRIKE, materialKind(Material.FLINT), EXPERT_S);
  const { acts, tally } = handOn(sim);
  const objects = sim.state.store(OBJECT_STORE);
  const flakes = (slot: number, at: number): number => {
    hold(sim, slot, 0, spawnObject(sim, Material.FLINT, at, y, 2, 0.15, 0));
    const nodule = objects.id.data[spawnObject(sim, Material.FLINT, at, y, 10, 0.25, 0)];
    const before = tally[ActTally.PIECES];
    for (let n = 0; n < 3; n++) {
      acts.refresh();
      place(sim, slot, at, y);
      acts.begin(slot, Act.STRIKE, cue(CueKind.CLASS, materialClass(Material.FLINT, false, false)), PerceptSource.OBJECT, nodule, at, y, NO_DRIVES, 0);
      acts.run(slot);
    }
    return tally[ActTally.PIECES] - before;
  };
  const byNovice = flakes(novice, x);
  const byExpert = flakes(expert, x + 10);
  assert.ok(byNovice > 0 && byExpert > 1.3 * byNovice, `pieces from 15 blows: novice ${byNovice}, expert ${byExpert}`);
  const got = practiceHours(sim, novice, SkillAct.STRIKE, materialKind(Material.FLINT));
  assert.ok(Math.abs(got - 15 * ACTS.blowS * lifePerSecond(sim)) < 1e-4, `practice ${got}`);
  assert.equal(practiceHours(sim, novice, SkillAct.MANIPULATE, materialKind(Material.FLINT)), 0);
});

test('striking an animal: an expert lands more of each blow; practice goes to strike × its kind', () => {
  const sim = world(13, 32);
  const animals = sim.state.store(ANIMAL_STORE);
  for (let g = 0; g < animals.highWater; g++) if (animals.isAlive(g)) animals.remove(g);
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const k = richest(water, (q) => water[q] === Water.DRY);
  const [x, y] = centre(sim, k);
  const novice = spawnWithBody(sim, x, y);
  const expert = spawnWithBody(sim, x, y + 20);
  stepSim(sim, 1);
  const kind = animalKind(AnimalKind.AUROCHS);
  practice(sim, expert, SkillAct.STRIKE, kind, EXPERT_S);
  const p = bySkill(ACTS.precisionNovice, ACTS.precisionExpert, skillLevel(sim, expert, SkillAct.STRIKE, kind));
  const { acts, tally } = handOn(sim);
  const strike = (slot: number, at: number): number => {
    for (let g = 0; g < animals.highWater; g++) if (animals.isAlive(g)) animals.remove(g);
    hold(sim, slot, 0, spawnObject(sim, Material.FLINT, x, at, 1, 0.12, 0.8));
    const group = placeGroup(sim, AnimalKind.AUROCHS, x, at, 4, 0.9);
    acts.refresh();
    place(sim, slot, x, at);
    acts.begin(slot, Act.STRIKE, cue(CueKind.CLASS, animalClass(AnimalKind.AUROCHS)), PerceptSource.ANIMAL, animals.id.data[group], x, at, NO_DRIVES, 0);
    acts.run(slot);
    return animals.column<Float32Array>('hurt').data[group];
  };
  const byNovice = strike(novice, y);
  const byExpert = strike(expert, y + 20);
  assert.equal(tally[ActTally.BLOWS_ON_ANIMALS], 10);
  assert.ok(byNovice > 0);
  // A blow's energy is by strength, which differs a little between two bodies; precision is by skill.
  const strengthOf = (slot: number) => strengthFrom(f64(sim, BODY_COLUMNS.leanKg.name)[slot], f64(sim, INJURY_COLUMNS.strain.name)[slot]);
  const expected = (p * strengthOf(expert)) / (ACTS.precisionNovice * strengthOf(novice));
  assert.ok(Math.abs(byExpert / byNovice - expected) < 1e-4, `hurt: novice ${byNovice}, expert ${byExpert}, ratio expected ${expected}`);
  const got = practiceHours(sim, novice, SkillAct.STRIKE, kind);
  assert.ok(Math.abs(got - 5 * ACTS.blowS * lifePerSecond(sim)) < 1e-4, `practice ${got}`);
  assert.equal(practiceHours(sim, novice, SkillAct.STRIKE, animalKind(AnimalKind.DEER)), 0, 'not at another kind');
});

test('a held stick of 0.5 m digs roots at the stick rate, a shorter piece does not, and a stick does nothing for picked food (§4.15.5)', () => {
  const sim = world(7);
  stepSim(sim, 1);
  const { acts, tally } = handOn(sim);
  const objects = sim.state.store(OBJECT_STORE);
  const held = sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data;
  const stands = new Map<number, [number, number]>();
  const rateOf = (name: string, length: number | null): number => {
    const s = PLANT_SPECIES.findIndex((sp) => sp.name === name);
    const layer = sim.state.world.layer<Float32Array>(foodLayer(PLANT_SPECIES[s]));
    // The same stand every time, as it was first found.
    if (!stands.has(s)) {
      const r = richest(layer);
      stands.set(s, [r, layer[r]]);
    }
    const [k, stand] = stands.get(s) as [number, number];
    layer[k] = stand;
    const [x, y] = centre(sim, k);
    const slot = spawnWithBody(sim, x, y);
    acts.refresh();
    held.fill(0, slot * 2, slot * 2 + 2);
    if (length !== null) hold(sim, slot, 0, spawnObject(sim, Material.WOOD, x, y, 0.4, length, 0));
    acts.refresh();
    place(sim, slot, x, y);
    const before = tally[ActTally.PLANT_KG + s];
    acts.begin(slot, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.LEAF)), PerceptSource.CELL, k, x, y, NO_DRIVES, 0);
    acts.run(slot);
    return tally[ActTally.PLANT_KG + s] - before;
  };
  // Every body here is a novice: by hand 0.4 × 0.5 kg an hour, with a stick 0.4 × 1.8 (the stand is the same).
  const byHand = rateOf('tuber', null);
  const stick = rateOf('tuber', 0.6);
  const short = rateOf('tuber', 0.3);
  assert.ok(byHand > 0);
  const expected = (ACTS.stickKgPerHour * ACTS.stickNoviceShare) / (ACTS.plantKgPerHour.tuber * ACTS.plantNoviceShare.tuber);
  assert.ok(Math.abs(stick / byHand - expected) < 0.02, `stick ${stick} kg, by hand ${byHand} kg, ratio ${stick / byHand} against ${expected}`);
  assert.ok(Math.abs(short - byHand) < 1e-9, 'a 0.3 m piece digs as hands do');
  assert.ok(tally[ActTally.STICK_KG] > 0 && Math.abs(tally[ActTally.STICK_KG] - stick) < 1e-9, 'only what the stick dug is counted as dug with one');
  const berries = rateOf('berry', null);
  const berriesStick = rateOf('berry', 0.6);
  assert.ok(berries === 0 || Math.abs(berriesStick - berries) < 1e-9, 'a stick does nothing for picked food');
});

test('hand work keeps its pace below tiredness 1 and falls to 0.75 of it at 1 (§4.15.4)', () => {
  const sim = world(7);
  stepSim(sim, 1);
  const { acts, tally } = handOn(sim);
  const s = PLANT_SPECIES.findIndex((sp) => sp.name === 'tuber');
  const layer = sim.state.world.layer<Float32Array>(foodLayer(PLANT_SPECIES[s]));
  const k = richest(layer);
  const stand = layer[k];
  const [x, y] = centre(sim, k);
  const slot = spawnWithBody(sim, x, y);
  acts.refresh();
  const held = sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data;
  const acute = f64(sim, FITNESS_COLUMNS.acuteLoad.name);
  const eatWith = (load: number): number => {
    layer[k] = stand;
    place(sim, slot, x, y);
    held.fill(0, slot * 2, slot * 2 + 2);
    acute[slot] = load;
    const before = tally[ActTally.PLANT_KG + s];
    acts.begin(slot, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.LEAF)), PerceptSource.CELL, k, x, y, NO_DRIVES, 0);
    acts.run(slot);
    return tally[ActTally.PLANT_KG + s] - before;
  };
  const rested = eatWith(0);
  const tired = eatWith(2); // tiredness about 0.5 at capacity 1
  const spent = eatWith(100); // tiredness 1
  assert.ok(rested > 0);
  assert.ok(Math.abs(tired - rested) < 1e-12, `the pace holds below the endurance time: ${tired} against ${rested}`);
  assert.ok(Math.abs(spent / rested - ACTS.handsPastEndurance) < 1e-9, `past it, ${spent / rested}`);
});
