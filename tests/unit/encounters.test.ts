// Animals and persons meet (docs/DESIGN.md §2.17): animals keep away from persons by kind, light,
// movement and cover; predators take lone persons (cats at night, wolves only the small or lame);
// bites and holds reach the body through body.injury in the same tick; a body in jaws does not walk;
// blows on animals add up across strikers, and struck animals run or fight back. Each check is one of
// §2.17's calibration targets, written before the code ran.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { STREAM_WORDS, StreamDomain, seedStream } from '../../src/sim/core/rng.ts';
import { INJURY_COLUMNS, INJURY_PARTS, InjuryKind } from '../../src/sim/body/injury.ts';
import { BODY_PARTS, DeathCause, Sex } from '../../src/sim/body/metabolism.ts';
import { ACT_COLUMNS, Act, ActEnd, ActTally, createActs } from '../../src/sim/mind/acts.ts';
import { Candidates, gatherCandidates } from '../../src/sim/mind/choice.ts';
import { CLASS, CueKind, animalClass, cue } from '../../src/sim/mind/cues.ts';
import { CHANNELS } from '../../src/sim/mind/interoception.ts';
import { PerceptSource, Percepts, createPerception } from '../../src/sim/mind/perception.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import {
  ANIMAL_FIELDS,
  ANIMAL_PARTS,
  ANIMAL_STORE,
  AnimalKind,
  AnimalMode,
  CARCASS_LAYER,
  ENCOUNTER,
  GROUP_KINDS,
  bitesOf,
  holdChance,
  noticeFactor,
  placeGroup,
  strikeAnimal,
} from '../../src/sim/world/animals.ts';
import type { StrikeOutcome } from '../../src/sim/world/animals.ts';
import { sunlight } from '../../src/sim/world/light.ts';
import { PLANT_SPECIES, coverLayer } from '../../src/sim/world/plants.ts';
import { Material, OBJECT_STORE, spawnObject } from '../../src/sim/world/materials.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';
import { HADZA_MAN, HADZA_WOMAN, spawnWithBody, withoutMinds } from '../fixtures/bodies.ts';

const F = ANIMAL_FIELDS;
const CHILD = { sex: Sex.MALE, ageYears: 8, leanKg: 18, fatKg: 3 } as const;

function config(seed: number, cells = 32) {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = 0.2;
  return validateConfig(raw);
}

/** The real world and bodies without minds, with `extra` systems right after the animals. */
function makeSim(seed: number, extra: SystemDef[] = [], full = false): Sim {
  const base = full ? [...SIM_PIPELINE] : withoutMinds(SIM_PIPELINE);
  const at = base.findIndex((s) => s.name === 'world.animals') + 1;
  return createSim(config(seed), [...base.slice(0, at), ...extra, ...base.slice(at)]);
}

function clearAnimals(sim: Sim): void {
  const store = sim.state.store(ANIMAL_STORE);
  for (let slot = 0; slot < store.highWater; slot++) if (store.isAlive(slot)) store.remove(slot);
}

/** A point on dry land with dry land for `r` metres around it, nearest the centre of the map. */
function openPoint(sim: Sim, r: number): [number, number] {
  const { widthCells: W, heightCells: H, cellSizeM: cs } = sim.config.world;
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const reach = Math.ceil(r / cs);
  let best: [number, number] = [-1, -1];
  let bestD = Infinity;
  for (let j = reach; j < H - reach; j++) {
    for (let i = reach; i < W - reach; i++) {
      let dry = true;
      for (let b = -reach; b <= reach && dry; b++) for (let a = -reach; a <= reach && dry; a++) if (kind[(j + b) * W + i + a] !== Water.DRY) dry = false;
      if (!dry) continue;
      const d = (i - W / 2) ** 2 + (j - H / 2) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [(i + 0.5) * cs, (j + 0.5) * cs];
      }
    }
  }
  assert.ok(best[0] > 0, 'no open ground on this map');
  return best;
}

/** No plant cover in the cell at (x, y) and its neighbours: open ground, nothing to hide in. */
function bareAround(sim: Sim, x: number, y: number): void {
  const { widthCells: W, cellSizeM: cs } = sim.config.world;
  const i0 = Math.floor(x / cs);
  const j0 = Math.floor(y / cs);
  for (const sp of PLANT_SPECIES) {
    const cover = sim.state.world.layer<Float32Array>(coverLayer(sp));
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) cover[j * W + i] = 0;
  }
}

function counts(sim: Sim): Float64Array {
  return sim.state.parts.find((p) => p.name === ANIMAL_PARTS.counts)!.readings!() as Float64Array;
}

function col<T extends Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array>(sim: Sim, name: string): T {
  return sim.state.store(ANIMAL_STORE).column<T>(name).data;
}

function distTo(sim: Sim, group: number, x: number, y: number): number {
  return Math.hypot(col<Float32Array>(sim, 'x')[group] - x, col<Float32Array>(sim, 'y')[group] - y);
}

/** Step until `ok` holds at the start of a tick (at most a day). */
function stepUntil(sim: Sim, ok: (tick: number) => boolean): void {
  for (let n = 0; n < 144 && !ok(sim.state.tick); n++) stepSim(sim, 1);
  assert.ok(ok(sim.state.tick));
}

test('how far animals notice a person: by kind, day and night, whether it walked, tall cover; and how often a landed attack holds', () => {
  assert.equal(noticeFactor(true, 0), 1);
  assert.equal(noticeFactor(false, 0), ENCOUNTER.stillShare);
  assert.ok(Math.abs(noticeFactor(false, 1) * ENCOUNTER.shyDayM[AnimalKind.DEER] - 12) < 1e-9, 'a still person in full tall cover: 12 m for deer by day');
  assert.ok(Math.abs(noticeFactor(true, 2) - ENCOUNTER.leastConcealed) < 1e-12);
  assert.deepEqual([ENCOUNTER.shyDayM[AnimalKind.DEER], ENCOUNTER.shyNightM[AnimalKind.DEER]], [100, 40]);
  // Holds (§2.17): about half of men, two-thirds of women, 0.9 of children.
  assert.ok(Math.abs(holdChance(AnimalKind.CAT, 1, HADZA_MAN.leanKg) - 0.5) < 1e-9);
  assert.ok(Math.abs(holdChance(AnimalKind.CAT, 1, HADZA_WOMAN.leanKg) - 22 / 34) < 1e-9);
  assert.equal(holdChance(AnimalKind.CAT, 1, 20), 0.9);
  assert.equal(holdChance(AnimalKind.WOLF, 5, CHILD.leanKg), 0.9);
  assert.ok(holdChance(AnimalKind.WOLF, 5, 44) < 0.6);
  for (const k of GROUP_KINDS) assert.ok(k.massKg > k.edibleKg, `${k.name}: a body weighs more than its meat`);
});

test('deer keep away from a person who walks: from 60 m by day, not at night, nor from one standing still', () => {
  for (const [label, night, moved, flees] of [
    ['day, walking', false, 50, true],
    ['day, standing still', false, 0, false],
    ['night, walking', true, 50, false],
  ] as const) {
    // The full pipeline, for the column the acts keep (the person's own acts run after the animals).
    const sim = makeSim(3, [], true);
    stepUntil(sim, (t) => (sunlight(sim.config, t) < 0.02) === night && (night || sunlight(sim.config, t) > 0.3));
    clearAnimals(sim);
    const [x, y] = openPoint(sim, 400);
    bareAround(sim, x, y);
    const person = spawnWithBody(sim, x, y);
    sim.state.agents.column<Float64Array>(ACT_COLUMNS.movedTickM.name).data[person] = moved;
    const near = placeGroup(sim, AnimalKind.DEER, x + 60, y, 8, 0.9);
    const far = placeGroup(sim, AnimalKind.DEER, x - 300, y, 8, 0.9);
    stepSim(sim, 1);
    const dNear = distTo(sim, near, x, y);
    // Leaving puts a group 400 m farther off; grazing moves it at most 2 km/h × 10 min.
    if (flees) assert.ok(dNear >= 455, `${label}: the near group left (${dNear.toFixed(0)} m)`);
    else assert.ok(dNear < 455, `${label}: the near group stayed (${dNear.toFixed(0)} m)`);
    assert.ok(distTo(sim, far, x, y) < 690, `${label}: the group 300 m off did not notice`);
  }
});

test('a hungry cat at night strikes a lone person within reach, not one with company within 50 m', () => {
  for (const company of [false, true]) {
    const sim = makeSim(5);
    stepUntil(sim, (t) => sunlight(sim.config, t) < 0.02);
    clearAnimals(sim);
    const [x, y] = openPoint(sim, 300);
    spawnWithBody(sim, x, y);
    if (company) spawnWithBody(sim, x, y + 30, HADZA_WOMAN);
    const cat = placeGroup(sim, AnimalKind.CAT, x + 120, y, 1, 0.3);
    col<Uint8Array>(sim, 'mode')[cat] = AnimalMode.AMBUSH;
    stepSim(sim, 1);
    const c = counts(sim);
    assert.equal(c[F.catStrikesPerson], company ? 0 : 1, company ? 'two together: no strike' : 'alone: struck');
    if (company) assert.equal(c[F.bitesToPersons], 0);
  }
});

test('wolves never attack a healthy lone adult; a lone child they run down; it dies of the hold, counted as killed by an animal', () => {
  const sim = makeSim(7);
  clearAnimals(sim);
  const [x, y] = openPoint(sim, 500);
  spawnWithBody(sim, x, y);
  placeGroup(sim, AnimalKind.WOLF, x + 400, y, 5, 0.3);
  stepSim(sim, 18);
  assert.equal(counts(sim)[F.wolfAttacksPerson], 0, 'a healthy adult is left alone');
  const child = spawnWithBody(sim, x - 400, y, CHILD);
  const childId = sim.state.agents.id.data[child];
  stepSim(sim, 18);
  const c = counts(sim);
  assert.ok(c[F.wolfAttacksPerson] >= 1, 'the child was attacked');
  assert.ok(c[F.bitesToPersons] >= 5, 'a bite from each wolf');
  const deaths = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths)!.readings!() as Float64Array;
  const injuries = sim.state.parts.find((p) => p.name === INJURY_PARTS.injuries)!.readings!() as Float64Array;
  assert.ok(injuries[InjuryKind.ANIMAL] >= 5, 'the bites reached the body');
  if (c[F.holdsPerson] >= 1) {
    assert.equal(sim.state.agents.slotOf(childId), -1, 'held: dead');
    assert.equal(deaths[DeathCause.ANIMAL], 1);
  }
  assert.equal(deaths[DeathCause.SHOCK], 0);
});

test('a hold kills by shock within the tick; a mauling leaves a fed adult alive a day later; a body in jaws does not walk', () => {
  const wounds: [number, keyof typeof ENCOUNTER][] = [];
  // ALIBI: test fixture: deals chosen animal wounds right after the animals run, as a landed attack would.
  const fxBite = defineSystem({
    name: 'fx.bite',
    create(sim: Sim) {
      return () => {
        const bites = bitesOf(sim.state)!;
        for (const [id, w] of wounds.splice(0)) bites.push(id, ENCOUNTER[w] as never, 0, 0, AnimalKind.CAT);
      };
    },
  });
  const sim = makeSim(9, [fxBite]);
  clearAnimals(sim);
  const [x, y] = openPoint(sim, 300);
  const held = spawnWithBody(sim, x, y);
  const mauled = spawnWithBody(sim, x + 200, y);
  stepSim(sim, 1);
  const ids = sim.state.agents.id.data;
  const heldId = ids[held];
  const mauledId = ids[mauled];
  const meat = sim.state.world.layer<Float32Array>(CARCASS_LAYER);
  const { widthCells: W, cellSizeM: cs } = sim.config.world;
  const k = Math.floor(y / cs) * W + Math.floor(x / cs);
  const before = meat[k];
  wounds.push([heldId, 'hold'], [mauledId, 'catBite'], [mauledId, 'catBite']);
  stepSim(sim, 1);
  assert.equal(sim.state.agents.slotOf(heldId), -1, 'the held body died within the tick');
  const deaths = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths)!.readings!() as Float64Array;
  assert.equal(deaths[DeathCause.ANIMAL], 1);
  assert.ok(meat[k] > before + 10, 'it lies as meat where it was held');
  const m = sim.state.agents.slotOf(mauledId);
  assert.ok(sim.state.agents.column<Float64Array>(INJURY_COLUMNS.woundCm2.name).data[m] >= 49);
  stepSim(sim, 144);
  assert.ok(sim.state.agents.slotOf(mauledId) >= 0, 'a mauled fed adult is alive a day later');

  // In jaws: no walking this tick.
  const full = makeSim(9, [], true);
  clearAnimals(full);
  const [px, py] = openPoint(full, 300);
  const slot = spawnWithBody(full, px, py);
  stepSim(full, 1);
  const acts = createActs(full, createPerception(full), new Float64Array(ActTally.LENGTH));
  acts.refresh();
  const xs = full.state.agents.column<Float64Array>('x').data;
  full.state.agents.column<Float64Array>('y').data[slot] = py;
  xs[slot] = px;
  bitesOf(full.state)!.push(full.state.agents.id.data[slot], ENCOUNTER.catBite, 0, 0, AnimalKind.CAT);
  acts.begin(slot, Act.EXPLORE, 0, 0, 0, 0, 0, new Float64Array(CHANNELS), 0);
  acts.run(slot);
  assert.equal(xs[slot], px, 'pinned');
  bitesOf(full.state)!.clear();
  acts.begin(slot, Act.EXPLORE, 0, 0, 0, 0, 0, new Float64Array(CHANNELS), 0);
  acts.run(slot);
  assert.notEqual(xs[slot], px, 'free again, it walks');
});

test('struck animals: a deer takes one blow and runs; blows on an aurochs add up across strikers until one falls; it gores about four ticks in ten; wolves and cats leave', () => {
  const sim = makeSim(11);
  clearAnimals(sim);
  const [x, y] = openPoint(sim, 300);
  const strikers = [spawnWithBody(sim, x, y), spawnWithBody(sim, x + 1, y), spawnWithBody(sim, x, y + 1)];
  const s = new Uint32Array(STREAM_WORDS);
  seedStream(s, 0, 1, StreamDomain.FIXTURE, 3);
  const out: StrikeOutcome = { landed: 0, killed: false, cell: -1, away: false };
  const bites = bitesOf(sim.state)!;
  const c = counts(sim);

  const deer = placeGroup(sim, AnimalKind.DEER, x, y, 8, 0.9);
  strikeAnimal(sim, deer, strikers[0], 32, 0, 0.5, 5, s, 0, out);
  assert.equal(out.landed, 1);
  assert.ok(out.away && !out.killed);
  assert.equal(col<Uint8Array>(sim, 'mode')[deer], AnimalMode.FLEE);
  assert.ok(Math.abs(col<Float32Array>(sim, 'hurt')[deer] - 16 / (8 * 90)) < 1e-6);

  // Ten blows' worth from three strikers with sharp 1 kg stones: 55 J landed a blow.
  const aurochs = placeGroup(sim, AnimalKind.AUROCHS, x, y, 3, 0.9);
  const per = (64 * 0.5 * (1 + 3 * 0.8)) / (8 * 700);
  let blows = 0;
  let calls = 0;
  for (; calls < 100 && !out.killed; calls++) {
    strikeAnimal(sim, aurochs, strikers[calls % 3], 64, 0.8, 0.5, 5, s, 0, out);
    blows += out.landed;
    assert.ok(!out.away || out.killed, 'it stands its ground');
  }
  assert.ok(out.killed);
  assert.equal(blows, Math.ceil(1 / per - 1e-9), 'every landed blow counts, whoever struck it');
  assert.equal(col<Uint16Array>(sim, 'count')[aurochs], 2);
  assert.equal(col<Float32Array>(sim, 'hurt')[aurochs], 0);
  assert.equal(c[F.killedByPersonsAurochs], 1);
  assert.ok(sim.state.world.layer<Float32Array>(CARCASS_LAYER)[out.cell] >= 350);
  bites.clear();
  let gores = 0;
  const trials = 600;
  for (let t = 0; t < trials; t++) {
    const n = bites.n;
    strikeAnimal(sim, aurochs, strikers[0], 0, 0, 0.5, 5, s, 0, out);
    if (bites.n > n) gores++;
  }
  assert.ok(Math.abs(gores / trials - ENCOUNTER.goreChance) < 0.06, `gores ${gores} of ${trials}`);
  bites.clear();

  const wolves = placeGroup(sim, AnimalKind.WOLF, x, y, 2, 0.3);
  strikeAnimal(sim, wolves, strikers[1], 32, 0, 0.5, 5, s, 0, out);
  assert.ok(out.landed === 1 && out.away);
  assert.equal(col<Uint8Array>(sim, 'mode')[wolves], AnimalMode.FLEE);
  const cat = placeGroup(sim, AnimalKind.CAT, x, y, 1, 0.3);
  strikeAnimal(sim, cat, strikers[2], 32, 0, 0.5, 5, s, 0, out);
  assert.ok(out.landed === 1 && out.away);
  assert.equal(col<Uint8Array>(sim, 'mode')[cat], AnimalMode.MOVE);
  assert.ok(bites.n <= 2, 'at most a bite back from each');
});

test('strike on an animal is a candidate only with something held, never on hares; the act walks to an aurochs and lands blows', () => {
  const look = new Percepts();
  look.push(cue(CueKind.CLASS, animalClass(AnimalKind.AUROCHS)), 40, 1, 1, 7, PerceptSource.ANIMAL);
  look.push(cue(CueKind.CLASS, CLASS.hare), 30, 2, 2, 8, PerceptSource.CELL);
  const order = new Int32Array(Percepts.CAPACITY);
  const cands = new Candidates();
  const strikes = () => Array.from(cands.act.subarray(0, cands.n)).filter((a) => a === Act.STRIKE).length;
  gatherCandidates(look, new Float64Array(0), new Uint32Array(0), 0, order, cands);
  assert.equal(strikes(), 0, 'nothing held');
  gatherCandidates(look, new Float64Array([9]), new Uint32Array([cue(CueKind.CLASS, CLASS.smallWood)]), 1, order, cands);
  assert.equal(strikes(), 1, 'the aurochs, not the hare');

  const sim = makeSim(13, [], true);
  clearAnimals(sim);
  const [x, y] = openPoint(sim, 300);
  const slot = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  const tally = new Float64Array(ActTally.LENGTH);
  const acts = createActs(sim, createPerception(sim), tally);
  acts.refresh();
  const ax = sim.state.agents.column<Float64Array>('x').data;
  const ay = sim.state.agents.column<Float64Array>('y').data;
  ax[slot] = x;
  ay[slot] = y;
  const stone = spawnObject(sim, Material.FLINT, x, y, 1, 0.12, 0.8);
  const objects = sim.state.store(OBJECT_STORE);
  const drives = new Float64Array(CHANNELS);
  acts.begin(slot, Act.PICK_UP, 0, PerceptSource.OBJECT, objects.id.data[stone], x, y, drives, 0);
  acts.run(slot);
  assert.equal(objects.column<Uint32Array>('holder').data[stone], sim.state.agents.id.data[slot]);
  const aurochs = placeGroup(sim, AnimalKind.AUROCHS, x + 50, y, 4, 0.9);
  const g = sim.state.store(ANIMAL_STORE).id.data[aurochs];
  acts.begin(slot, Act.STRIKE, cue(CueKind.CLASS, animalClass(AnimalKind.AUROCHS)), PerceptSource.ANIMAL, g, x + 50, y, drives, 0);
  acts.run(slot);
  assert.ok(Math.abs(ax[slot] - (x + 50)) <= 2.5, 'walked to it');
  assert.equal(tally[ActTally.BLOWS_ON_ANIMALS], 5);
  assert.ok(col<Float32Array>(sim, 'hurt')[aurochs] > 0);
  assert.equal(sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[slot], ActEnd.DONE);
  assert.equal(counts(sim)[F.blowsByPersons], 5);
});
