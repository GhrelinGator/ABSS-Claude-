// Drives, acts, choice and founders (docs/DESIGN.md §4.9): interoception from the body; the stomach,
// plant poisons, sleep pressure and tiredness; what each solo act does to the body and the world;
// choice through a predictor, uniform when it has learned nothing; founders; and the mind system in the
// real pipeline: deterministic, audited, and within its decision budget.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig, canonicalJson } from '../../src/sim/config.ts';
import { auditConserved, learnedContentProblems } from '../../src/sim/core/audit.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { STREAM_WORDS, StreamDomain, seedStream } from '../../src/sim/core/rng.ts';
import { FITNESS, FITNESS_COLUMNS } from '../../src/sim/body/fitness.ts';
import { GUT, GUT_COLUMNS, gut, poison, poisonStrength } from '../../src/sim/body/gut.ts';
import { HEAT_COLUMNS, fullWaterKg } from '../../src/sim/body/heat.ts';
import { INJURY_COLUMNS, injure } from '../../src/sim/body/injury.ts';
import { BODY_COLUMNS, BODY_PARTS, DeathCause, Effort, METABOLISM, Sex, fatKgOf, metabolism } from '../../src/sim/body/metabolism.ts';
import { SLEEP, SLEEP_COLUMNS, sleep, sleepiness } from '../../src/sim/body/sleep.ts';
import { GENETICS_COLUMNS } from '../../src/sim/body/genetics.ts';
import { ACTS, ACT_COLUMNS, Act, ActEnd, ActTally, createActs } from '../../src/sim/mind/acts.ts';
import type { Acts } from '../../src/sim/mind/acts.ts';
import { BLANK_PREDICTOR, CHOICE, Candidates, PREDICTION_LENGTH, choose, gatherCandidates, interrupts, valueOf } from '../../src/sim/mind/choice.ts';
import type { Predictor } from '../../src/sim/mind/choice.ts';
import { CueKind, SELF_CUE, cue, materialClass, plantClass, PlantLook, CLASS } from '../../src/sim/mind/cues.ts';
import { FOUNDERS } from '../../src/sim/mind/founders.ts';
import { CHANNELS, Channel, createInteroception } from '../../src/sim/mind/interoception.ts';
import { MIND_PARTS, blankMind, mindSystem } from '../../src/sim/mind/mind.ts';
import { PerceptSource, Percepts, createPerception } from '../../src/sim/mind/perception.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { CARCASS_LAYER, CARCASS_LOAD_LAYER } from '../../src/sim/world/animals.ts';
import { MATERIALS, Material, OBJECT_STORE, STONE_MATERIALS, spawnObject, stoneLayer } from '../../src/sim/world/materials.ts';
import { PLANT_SPECIES, foodLayer } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';
import { HADZA_MAN, spawnWithBody } from '../fixtures/bodies.ts';

const species = (name: string) => PLANT_SPECIES.findIndex((sp) => sp.name === name);
const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

function config(seed: number, cells = 48, founders?: { count: number; radiusM: number }) {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = 0.2;
  if (founders) raw.founders = founders;
  return validateConfig(raw);
}

function world(seed: number, cells = 48): Sim {
  return createSim(config(seed, cells), SIM_PIPELINE);
}

/** A handle on the acts of a real sim, driven by the test rather than by the mind system. */
function handOn(sim: Sim): { acts: Acts; tally: Float64Array } {
  const tally = new Float64Array(ActTally.LENGTH);
  const acts = createActs(sim, createPerception(sim), tally);
  acts.refresh();
  return { acts, tally };
}

const NO_DRIVES = new Float64Array(CHANNELS);

function centre(sim: Sim, k: number): [number, number] {
  const { widthCells: W, cellSizeM: cs } = sim.config.world;
  return [((k % W) + 0.5) * cs, (Math.floor(k / W) + 0.5) * cs];
}

/** The cell with the most of a layer, among cells passing `ok`. */
function richest(layer: ArrayLike<number>, ok: (k: number) => boolean = () => true): number {
  let best = -1;
  for (let k = 0; k < layer.length; k++) if (ok(k) && (best < 0 || layer[k] > layer[best])) best = k;
  return best;
}

test('interoception reads the body: hunger by gut and fat, thirst by deficit, cold by shivering, pain by wounds, fatigue by sleep pressure', () => {
  const sim = world(3, 24);
  const slot = spawnWithBody(sim, 1200, 1200);
  stepSim(sim, 1);
  const intero = createInteroception(sim);
  const d = new Float64Array(CHANNELS);
  const read = () => {
    intero.refresh();
    intero.read(slot, d, 0);
    return d;
  };
  // Empty gut, a forager's fat (6.9 kg ≈ 45 fat-days): about half hungry, from the gut alone.
  f64(sim, BODY_COLUMNS.gut.name)[slot] = 0;
  f64(sim, GUT_COLUMNS.stomachKg.name)[slot] = 0;
  assert.ok(Math.abs(read()[Channel.HUNGER] - 0.5) < 0.05, `hunger empty ${d[Channel.HUNGER]}`);
  // A full stomach of bulk sates the short signal.
  f64(sim, GUT_COLUMNS.stomachKg.name)[slot] = GUT.stomachMostKg;
  assert.ok(read()[Channel.HUNGER] < 0.05, `hunger full ${d[Channel.HUNGER]}`);
  f64(sim, GUT_COLUMNS.stomachKg.name)[slot] = 0;

  // Thirst: a deficit of 7.5% of mass is half the fatal 15%.
  const lean = f64(sim, BODY_COLUMNS.leanKg.name)[slot];
  const mass = lean + fatKgOf(f64(sim, BODY_COLUMNS.energy.name)[slot], 0, lean);
  f64(sim, HEAT_COLUMNS.water.name)[slot] = fullWaterKg(lean) - 0.075 * mass;
  assert.ok(Math.abs(read()[Channel.THIRST] - 0.5) < 1e-9, `thirst ${d[Channel.THIRST]}`);

  // Cold: shivering at its most is felt at once, the core still at 37 °C.
  f64(sim, HEAT_COLUMNS.shiverShare.name)[slot] = 1;
  assert.equal(read()[Channel.COLD], 1);
  f64(sim, HEAT_COLUMNS.shiverShare.name)[slot] = 0;
  f64(sim, HEAT_COLUMNS.coreC.name)[slot] = 37 - 5.5;
  assert.ok(Math.abs(read()[Channel.COLD] - 0.5) < 1e-9, `cold core ${d[Channel.COLD]}`);
  f64(sim, HEAT_COLUMNS.coreC.name)[slot] = 37;

  // Pain: none, then a 50 cm² wound is half the most.
  assert.ok(read()[Channel.PAIN] < 1e-9);
  injure(sim, slot, { openCm2: 50 });
  assert.ok(Math.abs(read()[Channel.PAIN] - 0.5) < 1e-9, `pain ${d[Channel.PAIN]}`);

  // Fatigue: sleep pressure at 1 is felt whatever the hour.
  f64(sim, SLEEP_COLUMNS.sleepPressure.name)[slot] = 1;
  f64(sim, FITNESS_COLUMNS.acuteLoad.name)[slot] = 0;
  assert.ok(read()[Channel.FATIGUE] > 0.85, `fatigue ${d[Channel.FATIGUE]}`);
  assert.equal(d[Channel.MATING], 0);
  assert.equal(d[Channel.SEPARATION], 0);
});

test('the stomach passes its bulk on; a poison is felt after its delay, makes the body vomit, and kills at its lethal strength', () => {
  const sim = createSim(config(5, 8), [gut, metabolism]);
  const a = spawnWithBody(sim, 100, 100);
  const b = spawnWithBody(sim, 300, 300);
  const c = spawnWithBody(sim, 500, 500);
  const perHour = sim.config.time.ticksPerDay / 24;
  // Bulk: 1.5 kg passes on at 0.3 kg an hour.
  f64(sim, GUT_COLUMNS.stomachKg.name)[a] = 1.5;
  stepSim(sim, 2 * perHour);
  assert.ok(Math.abs(f64(sim, GUT_COLUMNS.stomachKg.name)[a] - 0.9) < 1e-9);

  // A poison of strength 1 in a's body, felt 3 hours on.
  const lean = f64(sim, BODY_COLUMNS.leanKg.name)[a];
  const massOf = (s: number) => {
    const l = f64(sim, BODY_COLUMNS.leanKg.name)[s];
    return l + fatKgOf(f64(sim, BODY_COLUMNS.energy.name)[s], f64(sim, BODY_COLUMNS.gut.name)[s], l);
  };
  poison(sim, a, massOf(a) / GUT.strengthAtKg, 3);
  stepSim(sim, 2 * perHour);
  assert.equal(f64(sim, GUT_COLUMNS.poisonActive.name)[a], 0, 'not felt before its delay');
  stepSim(sim, perHour + 1);
  const active = f64(sim, GUT_COLUMNS.poisonActive.name)[a];
  assert.ok(Math.abs(poisonStrength(active, massOf(a)) - 1) < 0.05, `felt on time: ${poisonStrength(active, massOf(a))}`);
  // Cleared with a 6-hour half-life.
  stepSim(sim, 6 * perHour);
  assert.ok(Math.abs(f64(sim, GUT_COLUMNS.poisonActive.name)[a] / active - 0.5) < 0.03);
  assert.ok(lean > 0);

  // Strength 3: b vomits what its gut held, and the books still balance.
  f64(sim, BODY_COLUMNS.gut.name)[b] += 800;
  f64(sim, BODY_COLUMNS.energy.name)[b] += 800;
  f64(sim, BODY_COLUMNS.energyIn.name)[b] += 800;
  f64(sim, GUT_COLUMNS.stomachKg.name)[b] = 1;
  poison(sim, b, (3 * massOf(b)) / GUT.strengthAtKg, 1);
  stepSim(sim, perHour + 1);
  assert.equal(f64(sim, BODY_COLUMNS.gut.name)[b], 0, 'vomited');
  assert.equal(f64(sim, GUT_COLUMNS.stomachKg.name)[b], 0);
  assert.deepEqual(auditConserved(sim.state.agents), []);

  // Strength 9: c dies of poisoning.
  const deaths = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths)!.readings!() as Float64Array;
  poison(sim, c, (9 * massOf(c)) / GUT.strengthAtKg, 1);
  stepSim(sim, perHour + 1);
  assert.equal(sim.state.agents.isAlive(c), false);
  assert.equal(deaths[DeathCause.POISONING], 1);
});

test('sleep pressure rises awake and falls asleep with the two-process time constants; sleepiness follows the hour', () => {
  const sleeper = defineSystem({
    name: 'fixture.sleeper',
    create: (sim) => () => {
      const effort = sim.state.agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
      effort[1] = Effort.SLEEP;
    },
  });
  const sim = createSim(config(6, 8), [sleeper, sleep, metabolism]);
  const awake = spawnWithBody(sim, 100, 100);
  const asleep = spawnWithBody(sim, 200, 200);
  assert.equal(asleep, 1);
  f64(sim, SLEEP_COLUMNS.sleepPressure.name)[asleep] = 1;
  const day = sim.config.time.ticksPerDay;
  stepSim(sim, Math.round((18.2 / 24) * day));
  // One time constant: 1 − e^(−1) awake, e^(−18.2 / 4.2) asleep.
  assert.ok(Math.abs(f64(sim, SLEEP_COLUMNS.sleepPressure.name)[awake] - (1 - Math.exp(-1))) < 0.01);
  assert.ok(Math.abs(f64(sim, SLEEP_COLUMNS.sleepPressure.name)[asleep] - Math.exp(-18.2 / 4.2)) < 0.002);
  // The circadian part: least sleepy at 17:00, most at 05:00.
  const c = sim.config;
  const at = (h: number) => sleepiness(c, Math.round((h / 24) * day), 0.5);
  assert.ok(Math.abs(at(17) - (0.5 - SLEEP.circadianAmplitude)) < 1e-9);
  assert.ok(Math.abs(at(5) - (0.5 + SLEEP.circadianAmplitude)) < 1e-9);
});

test('eating a plant moves food from the cell to the gut and the stomach at a novice\'s rate by hand; a cell with none fails', () => {
  const sim = world(7);
  const { acts, tally } = handOn(sim);
  const s = species('tuber');
  const layer = sim.state.world.layer<Float32Array>(foodLayer(PLANT_SPECIES[s]));
  const k = richest(layer);
  assert.ok(layer[k] > 50, `a cell rich in tubers: ${layer[k]}`);
  const [x, y] = centre(sim, k);
  const slot = spawnWithBody(sim, x, y);
  acts.refresh();
  const before = layer[k];
  const gutBefore = f64(sim, BODY_COLUMNS.gut.name)[slot];
  acts.begin(slot, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.LEAF)), PerceptSource.CELL, k, x, y, NO_DRIVES, 0);
  acts.run(slot);
  const eaten = tally[ActTally.PLANT_KG + s];
  assert.ok(Math.abs(before - layer[k] - eaten) < 1e-3);
  const sp = PLANT_SPECIES[s];
  const density = before / ((sim.config.world.cellSizeM * sim.config.world.cellSizeM) / 10_000);
  // A novice's rate (§4.12): nothing is practised before the first act.
  const expected = ((ACTS.plantKgPerHour.tuber * ACTS.plantNoviceShare.tuber * density) / (density + ACTS.halfRateKgHa)) * (600 / 3600);
  assert.ok(Math.abs(eaten - expected) < 1e-3, `ate ${eaten} kg, expected ${expected}`);
  assert.ok(Math.abs(f64(sim, BODY_COLUMNS.gut.name)[slot] - gutBefore - eaten * sp.kcalPerKg * sp.rawDigestible) < 1e-3);
  assert.ok(Math.abs(f64(sim, GUT_COLUMNS.stomachKg.name)[slot] - eaten) < 1e-6);
  assert.equal(sim.state.agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data[slot], Effort.MODERATE, 'digging');
  assert.equal(sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[slot], ActEnd.GOING);

  // A cell with none of it: the act fails after a look around.
  const none = richest(layer, (q) => layer[q] === 0 && sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind)[q] === Water.DRY);
  const [nx, ny] = centre(sim, none);
  const other = spawnWithBody(sim, nx, ny);
  acts.refresh();
  acts.begin(other, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.BARE)), PerceptSource.CELL, none, nx, ny, NO_DRIVES, 0);
  acts.run(other);
  assert.equal(sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[other], ActEnd.FAILED);
});

test('poisonous plants go through the poison door; meat is cut faster with a keen edge; drinking makes up the deficit and swallows the water', () => {
  const sim = world(8);
  const { acts } = handOn(sim);
  // Bitter root, eaten raw: its poison waits for 4 hours.
  const s = species('bitterRoot');
  const layer = sim.state.world.layer<Float32Array>(foodLayer(PLANT_SPECIES[s]));
  const k = richest(layer);
  assert.ok(layer[k] > 10);
  const [x, y] = centre(sim, k);
  const eater = spawnWithBody(sim, x, y);
  acts.refresh();
  acts.begin(eater, Act.CONSUME, cue(CueKind.CLASS, plantClass(s, PlantLook.LEAF)), PerceptSource.CELL, k, x, y, NO_DRIVES, 0);
  acts.run(eater);
  const eaten = f64(sim, GUT_COLUMNS.stomachKg.name)[eater];
  const due = sim.state.agents.column<Float32Array>(GUT_COLUMNS.poisonDue.name).data;
  let waiting = 0;
  for (let h = 0; h < GUT.ringHours; h++) waiting += due[eater * GUT.ringHours + h];
  assert.ok(eaten > 0 && Math.abs(waiting - eaten * PLANT_SPECIES[s].toxin!.dosePerKg) < 1e-4, `${waiting} units for ${eaten} kg`);

  // Meat: by hand, then with a flake held.
  const meat = sim.state.world.layer<Float32Array>(CARCASS_LAYER);
  const load = sim.state.world.layer<Float32Array>(CARCASS_LOAD_LAYER);
  const m = richest(layer, (q) => q !== k && sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind)[q] === Water.DRY);
  meat[m] = 100;
  load[m] = 0.5;
  const [mx, my] = centre(sim, m);
  const hand = spawnWithBody(sim, mx, my);
  const knife = spawnWithBody(sim, mx + 1, my);
  const flake = spawnObject(sim, Material.FLINT, mx + 1, my, 0.05, 0.06, 0.9);
  sim.state.store(OBJECT_STORE).column<Uint32Array>('holder').data[flake] = sim.state.agents.id.data[knife];
  sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data[knife * 2] = sim.state.store(OBJECT_STORE).id.data[flake];
  acts.refresh();
  for (const who of [hand, knife]) {
    acts.begin(who, Act.CONSUME, cue(CueKind.CLASS, CLASS.carcass), PerceptSource.CELL, m, mx, my, NO_DRIVES, 0);
    acts.run(who);
  }
  const byHand = f64(sim, GUT_COLUMNS.stomachKg.name)[hand];
  const byEdge = f64(sim, GUT_COLUMNS.stomachKg.name)[knife];
  const novices = (ACTS.meatKgPerHourEdge * ACTS.meatNoviceShareEdge) / (ACTS.meatKgPerHourHand * ACTS.meatNoviceShareHand);
  assert.ok(Math.abs(byEdge / byHand - novices) < 1e-6, `${byHand} by hand, ${byEdge} with an edge`);
  assert.ok(f64(sim, INJURY_COLUMNS.gutDose.name)[hand] > 0, 'foul meat swallowed');

  // Water: a body short of 2 kg drinks it back, and the cell's pathogens with it.
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const w = richest(water, (q) => water[q] === Water.RIVER);
  assert.ok(water[w] === Water.RIVER);
  const [wx, wy] = centre(sim, w);
  const drinker = spawnWithBody(sim, wx, wy);
  stepSim(sim, 1);
  acts.refresh();
  const full = fullWaterKg(f64(sim, BODY_COLUMNS.leanKg.name)[drinker]);
  f64(sim, HEAT_COLUMNS.water.name)[drinker] = full - 2;
  sim.state.agents.column<Float64Array>('x').data[drinker] = wx;
  sim.state.agents.column<Float64Array>('y').data[drinker] = wy;
  acts.begin(drinker, Act.CONSUME, cue(CueKind.CLASS, CLASS.flowing), PerceptSource.CELL, w, wx, wy, NO_DRIVES, 0);
  acts.run(drinker);
  assert.ok(Math.abs(f64(sim, HEAT_COLUMNS.water.name)[drinker] - (full + ACTS.sipKg)) < 1e-9);
  assert.equal(sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[drinker], ActEnd.DONE);
});

test('walking: by mobility and tiredness, never into a lake, carrying what is held; avoid keeps its distance; explore walks a heading', () => {
  const sim = world(9, 64);
  stepSim(sim, 1);
  const { acts } = handOn(sim);
  const { widthCells: W, cellSizeM: cs } = sim.config.world;
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  // A long walk: a tick at 1.2 m/s at most.
  const walker = spawnWithBody(sim, 1000, 1000);
  stepSim(sim, 1);
  acts.refresh();
  const target = (W - 2) * W + (W - 2);
  acts.begin(walker, Act.APPROACH, cue(CueKind.CLASS, CLASS.cave), PerceptSource.CELL, target, 0, 0, NO_DRIVES, 0);
  const moved0 = f64(sim, BODY_COLUMNS.movedM.name)[walker];
  acts.run(walker);
  const moved = f64(sim, BODY_COLUMNS.movedM.name)[walker] - moved0;
  assert.ok(moved > 0 && moved <= ACTS.walkMs * 600 + 1e-6, `walked ${moved} m`);
  // Tired, it walks slower.
  const tiredOne = spawnWithBody(sim, 1000, 1200);
  stepSim(sim, 1);
  acts.refresh();
  f64(sim, FITNESS_COLUMNS.acuteLoad.name)[tiredOne] = 100;
  acts.begin(tiredOne, Act.APPROACH, cue(CueKind.CLASS, CLASS.cave), PerceptSource.CELL, target, 0, 0, NO_DRIVES, 0);
  const before = f64(sim, BODY_COLUMNS.movedM.name)[tiredOne];
  acts.run(tiredOne);
  const slow = f64(sim, BODY_COLUMNS.movedM.name)[tiredOne] - before;
  assert.ok(slow > 0 && slow < 0.55 * ACTS.walkMs * 600, `tired: ${slow} m`);
  assert.ok(FITNESS.acuteHours > 0);

  // Never into a lake: walk across one from its west shore.
  let lake = -1;
  for (let k = 0; k < water.length && lake < 0; k++) {
    const i = k % W;
    if (water[k] === Water.LAKE && i >= 2 && i < W - 8 && water[k - 1] !== Water.LAKE) lake = k;
  }
  if (lake >= 0) {
    const [lx, ly] = centre(sim, lake);
    const shore = spawnWithBody(sim, lx - cs + 1, ly);
    stepSim(sim, 1);
    sim.state.agents.column<Float64Array>('x').data[shore] = lx - cs + 1;
    sim.state.agents.column<Float64Array>('y').data[shore] = ly;
    acts.refresh();
    for (let t = 0; t < 6; t++) {
      acts.begin(shore, Act.APPROACH, cue(CueKind.CLASS, CLASS.cave), PerceptSource.CELL, lake + 6, 0, 0, NO_DRIVES, 0);
      acts.run(shore);
      const ax = sim.state.agents.column<Float64Array>('x').data[shore];
      const ay = sim.state.agents.column<Float64Array>('y').data[shore];
      assert.notEqual(water[Math.floor(ay / cs) * W + Math.floor(ax / cs)], Water.LAKE, 'stood in a lake');
    }
  }

  // Avoid: ends 300 m from the thing; a held stone goes along.
  const runner = spawnWithBody(sim, 3000, 3000);
  stepSim(sim, 1);
  const stone = spawnObject(sim, Material.GRANITE, 3000, 3000, 1, 0.1, 0);
  const objects = sim.state.store(OBJECT_STORE);
  objects.column<Uint32Array>('holder').data[stone] = sim.state.agents.id.data[runner];
  sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data[runner * 2] = objects.id.data[stone];
  sim.state.agents.column<Float64Array>('x').data[runner] = 3000;
  sim.state.agents.column<Float64Array>('y').data[runner] = 3000;
  const other = spawnWithBody(sim, 3050, 3000);
  acts.refresh();
  acts.begin(runner, Act.AVOID, cue(CueKind.INDIVIDUAL, sim.state.agents.id.data[other]), PerceptSource.AGENT, sim.state.agents.id.data[other], 3050, 3000, NO_DRIVES, 0);
  acts.run(runner);
  const rx = sim.state.agents.column<Float64Array>('x').data[runner];
  assert.ok(rx < 3000 - 200, `ran away to x = ${rx}`);
  assert.equal(objects.column<Float64Array>('x').data[stone], rx, 'the stone went along');
  assert.ok(f64(sim, BODY_COLUMNS.loadKg.name)[runner] >= 1, 'and weighed on it');

  // Explore: a heading for half an hour.
  const explorer = spawnWithBody(sim, 2500, 2500);
  stepSim(sim, 1);
  acts.refresh();
  acts.begin(explorer, Act.EXPLORE, SELF_CUE, 0, 0, 0, 0, NO_DRIVES, 0);
  acts.run(explorer);
  assert.ok(f64(sim, BODY_COLUMNS.movedM.name)[explorer] > 0);
});

test('hands: picking up from a cell and lying objects, two at most, dropping, striking flakes off, and a novice rubbing wood', () => {
  const sim = world(10, 64);
  stepSim(sim, 1);
  const { acts, tally } = handOn(sim);
  const flint = STONE_MATERIALS.find((m) => m.id === Material.FLINT)!;
  const stones = sim.state.world.layer<Float32Array>(stoneLayer(flint));
  const k = richest(stones);
  stones[k] = 50;
  const [x, y] = centre(sim, k);
  const slot = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  sim.state.agents.column<Float64Array>('x').data[slot] = x;
  sim.state.agents.column<Float64Array>('y').data[slot] = y;
  acts.refresh();
  const objects = sim.state.store(OBJECT_STORE);
  // Whatever its mind picked up in that tick goes back on the ground: the test fills the hands itself.
  const heldNow = sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data;
  for (let h = 0; h < 2; h++) {
    const o = objects.slotOf(heldNow[slot * 2 + h]);
    if (o >= 0) objects.column<Uint32Array>('holder').data[o] = 0;
    heldNow[slot * 2 + h] = 0;
  }
  const flintCue = cue(CueKind.CLASS, materialClass(Material.FLINT, false, false));
  for (let n = 0; n < 3; n++) {
    acts.begin(slot, Act.PICK_UP, flintCue, PerceptSource.CELL, k, x, y, NO_DRIVES, 0);
    acts.run(slot);
  }
  const end = sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data;
  assert.equal(end[slot], ActEnd.FAILED, 'a third stone: hands full');
  const ids = new Float64Array(2);
  assert.equal(acts.heldBy(slot, ids), 2);
  assert.ok(stones[k] < 50, 'taken from the cell');
  const holder = objects.column<Uint32Array>('holder').data;
  for (let h = 0; h < 2; h++) assert.equal(holder[objects.slotOf(ids[h])], sim.state.agents.id.data[slot]);

  // Drop the lighter, then strike a lying nodule with the other (pieces taken from a cell vary in size).
  const mass = objects.column<Float32Array>('mass').data;
  const lighter = mass[objects.slotOf(ids[0])] < mass[objects.slotOf(ids[1])] ? ids[0] : ids[1];
  acts.begin(slot, Act.DROP, flintCue, PerceptSource.OBJECT, lighter, 0, 0, NO_DRIVES, 0);
  acts.run(slot);
  assert.equal(holder[objects.slotOf(lighter)], 0);
  const nodule = spawnObject(sim, Material.FLINT, x + 1, y, 2, 0.15, 0);
  const noduleId = objects.id.data[nodule];
  acts.refresh();
  let pieces = 0;
  for (let n = 0; n < 6; n++) {
    acts.begin(slot, Act.STRIKE, flintCue, PerceptSource.OBJECT, noduleId, x + 1, y, NO_DRIVES, 0);
    acts.run(slot);
    pieces = tally[ActTally.PIECES];
  }
  assert.ok(pieces > 0, 'struck flakes off');

  // A novice rubbing two dry sticks for ten minutes gets no ember (§4.9.3: precision 0.5).
  const rubber = spawnWithBody(sim, x + 5, y);
  stepSim(sim, 1);
  for (let n = 0; n < 2; n++) {
    const stick = spawnObject(sim, Material.WOOD, x + 5, y, 0.3, 0.6, 0);
    objects.column<Uint32Array>('holder').data[stick] = sim.state.agents.id.data[rubber];
    sim.state.agents.column<Uint32Array>(ACT_COLUMNS.held.name).data[rubber * 2 + n] = objects.id.data[stick];
  }
  acts.refresh();
  acts.begin(rubber, Act.MANIPULATE, cue(CueKind.CLASS, CLASS.smallWood), PerceptSource.OBJECT, 0, 0, 0, NO_DRIVES, 0);
  acts.run(rubber);
  assert.equal(sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[rubber], ActEnd.DONE);
  assert.equal(tally[ActTally.EMBERS], 0);
  assert.equal(sim.state.agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data[rubber], Effort.HEAVY);
  assert.ok(MATERIALS.length > 0);
});

test('choice: the blank predictor values every candidate alike, so choice is uniform; a predictor foreseeing relief is followed; interrupts', () => {
  const cands = new Candidates();
  const look = new Percepts();
  look.push(cue(CueKind.CLASS, plantClass(species('berry'), PlantLook.BEARING)), 30, 10, 10, 5, PerceptSource.CELL);
  look.push(cue(CueKind.CLASS, CLASS.flowing), 80, 20, 20, 6, PerceptSource.CELL);
  look.push(cue(CueKind.CLASS, materialClass(Material.FLINT, true, false)), 5, 1, 1, 77, PerceptSource.OBJECT);
  for (let n = 0; n < 8; n++) look.push(cue(CueKind.INDIVIDUAL, 100 + n), 10 + n, 0, 0, 100 + n, PerceptSource.AGENT);
  const order = new Int32Array(Percepts.CAPACITY);
  gatherCandidates(look, new Float64Array([9]), new Uint32Array([cue(CueKind.CLASS, CLASS.smallWood)]), 1, order, cands);
  const acts = Array.from(cands.act.subarray(0, cands.n));
  const count = (a: number) => acts.filter((x) => x === a).length;
  assert.equal(count(Act.CONSUME), 2, 'berries and water');
  assert.equal(count(Act.PICK_UP), 1);
  assert.equal(count(Act.STRIKE), 1, 'a lying object, with something in hand');
  assert.equal(count(Act.DROP), 1);
  assert.equal(count(Act.MANIPULATE), 0, 'one thing held');
  assert.equal(count(Act.APPROACH), 3 + CHOICE.persons, 'persons capped');
  for (const a of [Act.REST, Act.SLEEP, Act.EXPLORE]) assert.equal(count(a), 1);

  // Blank: uniform.
  const s = new Uint32Array(STREAM_WORDS);
  seedStream(s, 0, 1, StreamDomain.FIXTURE, 1);
  const scratch = new Float64Array(PREDICTION_LENGTH);
  const drives = new Float64Array(CHANNELS);
  drives[Channel.HUNGER] = 0.7;
  const picks = new Float64Array(cands.n);
  const draws = 20_000;
  for (let n = 0; n < draws; n++) picks[choose(cands, BLANK_PREDICTOR, drives, 0, scratch, s, 0)] += 1;
  for (let i = 0; i < cands.n; i++) assert.ok(Math.abs(picks[i] / draws - 1 / cands.n) < 0.015, `candidate ${i}: ${picks[i]}`);

  // Value (§4.7.10): relief counts more the worse the drive; nothing for eating when full; harm always costs.
  const p = new Float64Array(PREDICTION_LENGTH);
  p[Channel.HUNGER] = -0.5;
  assert.ok(Math.abs(valueOf(drives, 0, p, 0, 0) - (0.49 - 0.04)) < 1e-12);
  const fed = new Float64Array(CHANNELS);
  assert.equal(valueOf(fed, 0, p, 0, 0), 0);
  const hurt = new Float64Array(PREDICTION_LENGTH);
  hurt[Channel.PAIN] = 0.2;
  assert.ok(valueOf(fed, 0, hurt, 0, 0) < 0);

  // A predictor that foresees relief from eating is followed nearly always.
  const knows: Predictor = {
    begin() {},
    predict(_c, act, _d, out) {
      BLANK_PREDICTOR.predict(_c, act, _d, out);
      if (act === Act.CONSUME) out[Channel.HUNGER] = -0.5;
    },
  };
  let ate = 0;
  for (let n = 0; n < 2000; n++) if (cands.act[choose(cands, knows, drives, 0, scratch, s, 0)] === Act.CONSUME) ate++;
  assert.ok(ate > 1990, `${ate} of 2000`);

  // Interrupts: pain rising by more than 0.1, or a drive crossing into its top fifth.
  const was = new Float32Array(CHANNELS);
  const now = new Float64Array(CHANNELS);
  assert.equal(interrupts(was, 0, now, 0), false);
  now[Channel.PAIN] = 0.15;
  assert.equal(interrupts(was, 0, now, 0), true);
  now[Channel.PAIN] = 0;
  now[Channel.THIRST] = 0.85;
  assert.equal(interrupts(was, 0, now, 0), true);
  was[Channel.THIRST] = 0.82;
  assert.equal(interrupts(was, 0, now, 0), false);
});

test('founders: at tick 0, near flowing water, independent points of a disc, adult bodies conditioned to work, genomes, nothing learned', () => {
  const none = createSim(config(12, 64), SIM_PIPELINE);
  stepSim(none, 2);
  assert.equal(none.state.agents.count, 0, 'no founders without the config');
  assert.equal(canonicalJson(config(12, 64)).includes('founders'), false, 'configs without founders are unchanged');
  assert.throws(() => config(12, 64, { count: -1, radiusM: 100 }));

  const sim = createSim(config(12, 64, { count: 40, radiusM: 1500 }), SIM_PIPELINE);
  assert.equal(sim.state.agents.count, 0);
  stepSim(sim, 1);
  const agents = sim.state.agents;
  assert.equal(agents.count, 40);
  const { widthCells: W, cellSizeM: cs } = sim.config.world;
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const xs: number[] = [];
  const ys: number[] = [];
  const sexes = new Set<number>();
  for (let slot = 0; slot < agents.highWater; slot++) {
    if (!agents.isAlive(slot)) continue;
    const x = agents.column<Float64Array>('x').data[slot];
    const y = agents.column<Float64Array>('y').data[slot];
    xs.push(x);
    ys.push(y);
    sexes.add(agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data[slot]);
    assert.equal(agents.column<Uint8Array>(GENETICS_COLUMNS.genomeFormed.name).data[slot], 1);
    const age = (sim.state.tick - f64(sim, BODY_COLUMNS.born.name)[slot]) / (sim.config.time.ticksPerDay * sim.config.time.daysPerYear);
    assert.ok(age >= FOUNDERS.youngestYears && age <= FOUNDERS.oldestYears + 0.01, `age ${age}`);
    assert.equal(f64(sim, FITNESS_COLUMNS.fitness.name)[slot] > 7, true, 'conditioned to a forager load');
    assert.deepEqual(learnedContentProblems(sim.state, slot), [], 'blank');
  }
  assert.deepEqual([...sexes].sort(), [Sex.FEMALE, Sex.MALE]);
  // All within one disc of the radius: the spread between any two is at most its diameter.
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  assert.ok(span <= 2 * 1500 + ACTS.walkMs * 600 * 2, `spread ${span} m`);
  // Someone is near flowing water at the start: the centre is within 300 m of it.
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let nearest = Infinity;
  for (let k = 0; k < water.length; k++) {
    if (water[k] !== Water.RIVER && water[k] !== Water.SPRING) continue;
    const dx = ((k % W) + 0.5) * cs - mx;
    const dy = (Math.floor(k / W) + 0.5) * cs - my;
    nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
  }
  assert.ok(nearest < 1500 + FOUNDERS.nearWaterM, `founders' middle is ${nearest} m from flowing water`);
  assert.equal(HADZA_MAN.leanKg, FOUNDERS.man.leanKg);
});

test('minds in the real pipeline: deterministic, the same after save and load, energy and water audited, within the decision budget', () => {
  const make = () => createSim(config(13, 64, { count: 30, radiusM: 2000 }), SIM_PIPELINE);
  const a = make();
  const b = make();
  stepSim(a, 300);
  stepSim(b, 150);
  const resumed = loadSim(saveSim(b), SIM_PIPELINE);
  stepSim(resumed, 150);
  assert.equal(hashSim(resumed), hashSim(a));
  stepSim(a, 144 * 4);
  assert.deepEqual(auditConserved(a.state.agents), []);
  const tally = a.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
  // The decision rate of 30 agents over five days spreads from about 0.2 to 0.32 between seeds (3.6,
  // on main and with skills alike), so it is pooled over four seeds; bench/acts.ts at 500 agents is
  // the measure of record (§4.9.7).
  let decisions = tally[ActTally.DECISIONS];
  let awake = tally[ActTally.AWAKE_TICKS];
  for (const seed of [14, 15, 16]) {
    const other = createSim(config(seed, 64, { count: 30, radiusM: 2000 }), SIM_PIPELINE);
    stepSim(other, 300 + 144 * 4);
    const t = other.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
    decisions += t[ActTally.DECISIONS];
    awake += t[ActTally.AWAKE_TICKS];
  }
  const rate = decisions / awake;
  assert.ok(rate > 0.05 && rate <= 0.3, `decisions per awake agent-tick ${rate}`);
  let ate = 0;
  for (let s = 0; s < PLANT_SPECIES.length; s++) ate += tally[ActTally.PLANT_KG + s];
  assert.ok(ate > 0, 'blank minds still eat what they try');
  assert.ok(METABOLISM.absorbKcalPerMinute > 0);
});

test('a predictor plugged into the mind system steers what agents do', () => {
  // A stand-in for 3.4's memory: it foresees sleep relieving fatigue and nothing else.
  const sleepy: Predictor = {
    begin() {},
    predict(c, act, d, out) {
      BLANK_PREDICTOR.predict(c, act, d, out);
      if (act === Act.SLEEP) out[Channel.FATIGUE] = -0.5;
      out[CHANNELS] = 0;
    },
  };
  const swap = (p: readonly SystemDef[]) => p.map((s) => (s.name === 'mind' ? mindSystem(() => sleepy) : s));
  const blank = (p: readonly SystemDef[]) => p.map((s) => (s.name === 'mind' ? blankMind : s));
  const sleeps = (pipeline: readonly SystemDef[]) => {
    const sim = createSim(config(14, 48, { count: 10, radiusM: 1000 }), pipeline);
    stepSim(sim, 288);
    const tally = sim.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
    return tally[ActTally.BEGUN + Act.SLEEP] / tally[ActTally.DECISIONS];
  };
  const unsteered = sleeps(blank(SIM_PIPELINE));
  const steered = sleeps(swap(SIM_PIPELINE));
  assert.ok(steered > 3 * unsteered, `share of choices that were sleep: ${steered} steered, ${unsteered} blank`);
});
