// Perception (docs/DESIGN.md §4.8): the class catalogue, the neighbour grid, what a look returns by
// light, plants, terrain and concealment, persons by id and by shape, animals, objects and fire, and
// the still view kept per cell and hour, saved so a run loaded mid-hour sees what the unbroken run sees.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { NeighbourGrid } from '../../src/sim/core/spatial.ts';
import {
  CLASS,
  CueKind,
  DayLength,
  LightBand,
  PERCEIVED_CLASSES,
  PlantLook,
  SightGroup,
  animalClass,
  cue,
  cueKind,
  cuePayload,
  materialClass,
  plantClass,
} from '../../src/sim/mind/cues.ts';
import { PERCEPTION, PerceptSource, Percepts, createPerception, declarePerception } from '../../src/sim/mind/perception.ts';
import type { Perception } from '../../src/sim/mind/perception.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, spawnEntity, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { ANIMAL_STORE, AnimalKind, AnimalMode, CARCASS_LAYER, HARE_LAYER } from '../../src/sim/world/animals.ts';
import { FIRE_FIELDS, FIRE_PARTS } from '../../src/sim/world/fire.ts';
import { ambientLight } from '../../src/sim/world/light.ts';
import { MATERIALS, MATERIAL_LAYERS, Material, OBJECT_STORE, STONE_MATERIALS, spawnObject, stoneLayer } from '../../src/sim/world/materials.ts';
import { WATER_PATHOGEN_LAYER } from '../../src/sim/world/pathogens.ts';
import { PLANT_SPECIES, coverLayer, foodLayer } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';
import { spawnWithBody } from '../fixtures/bodies.ts';

/** Every agent in a real pipeline has a body. */
const spawnAgent = (sim: Sim, x: number, y: number) => spawnWithBody(sim, x, y);

const species = (name: string) => PLANT_SPECIES.findIndex((sp) => sp.name === name);
const classCue = (c: number) => cue(CueKind.CLASS, c);

/** Declares the still view, as the system that owns minds will (3.3). */
const fxDeclare: SystemDef = defineSystem({
  name: 'fixture.perceptionDeclare',
  declare: declarePerception,
  create: () => () => {},
});

function world(seed: number, extra: SystemDef[] = [], cells = 48): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = 0.2;
  const pipeline = [...SIM_PIPELINE];
  pipeline.splice(pipeline.findIndex((d) => d.name === 'body.exposure'), 0, fxDeclare, ...extra);
  return createSim(validateConfig(raw), pipeline);
}

/** A dry cell whose square of radius r is all dry land, as far from the map edge as possible. */
function dryCentre(sim: Sim, r: number): number {
  const W = sim.config.world.widthCells;
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  for (let ring = 0; ring < W / 2 - r; ring++) {
    for (let j = W / 2 - ring; j <= W / 2 + ring; j++) {
      for (let i = W / 2 - ring; i <= W / 2 + ring; i++) {
        let dry = true;
        for (let dj = -r; dj <= r && dry; dj++) for (let di = -r; di <= r && dry; di++) dry = water[(j + dj) * W + i + di] === Water.DRY;
        if (dry) return j * W + i;
      }
    }
  }
  throw new Error('no dry square on this map');
}

/** Clear everything still and visible in the square of radius r around cell k, and flatten it. */
function clearAround(sim: Sim, k: number, r: number): void {
  const W = sim.config.world.widthCells;
  const w = sim.state.world;
  const layers = [
    ...PLANT_SPECIES.flatMap((sp) => [coverLayer(sp), foodLayer(sp)]),
    ...STONE_MATERIALS.map((m) => stoneLayer(m)),
    MATERIAL_LAYERS.smallWood,
    MATERIAL_LAYERS.longWood,
    MATERIAL_LAYERS.litter,
    CARCASS_LAYER,
    HARE_LAYER,
  ].map((name) => w.layer<Float32Array>(name));
  const elevation = w.layer<Float32Array>(TERRAIN_LAYERS.elevation);
  const ki = k % W;
  const kj = (k - ki) / W;
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const c = (kj + dj) * W + ki + di;
      for (const layer of layers) layer[c] = 0;
      elevation[c] = elevation[k];
    }
  }
  const animals = sim.state.store(ANIMAL_STORE);
  for (let s = 0; s < animals.highWater; s++) if (animals.alive.data[s] === 1) animals.remove(s);
}

const setLayer = (sim: Sim, name: string, cell: number, value: number) => {
  sim.state.world.layer<Float32Array>(name)[cell] = value;
};

function centreOf(sim: Sim, k: number): [number, number] {
  const W = sim.config.world.widthCells;
  const cs = sim.config.world.cellSizeM;
  return [((k % W) + 0.5) * cs, (Math.floor(k / W) + 0.5) * cs];
}

/** The percepts with this cue, as [distance, ref, source]. */
function find(out: Percepts, c: number): Array<[number, number, number]> {
  const found: Array<[number, number, number]> = [];
  for (let n = 0; n < out.n; n++) if (out.cue[n] === c) found.push([out.dist[n], out.ref[n], out.source[n]]);
  return found;
}

/** Step to the first tick at or after `from` with ambient light inside [lo, hi). */
function stepToLight(sim: Sim, lo: number, hi: number): void {
  let t = sim.state.tick;
  while (!(ambientLight(sim.config, t) >= lo && ambientLight(sim.config, t) < hi)) t++;
  stepSim(sim, t - sim.state.tick);
}

test('the class catalogue: still classes first and under 64, every plant in three looks, cues pack and unpack', () => {
  assert.ok(CLASS.stillCount <= 64);
  for (let c = 0; c < PERCEIVED_CLASSES.length; c++) assert.equal(PERCEIVED_CLASSES[c].still, c < CLASS.stillCount, PERCEIVED_CLASSES[c].name);
  const names = new Set(PERCEIVED_CLASSES.map((c) => c.name));
  assert.equal(names.size, PERCEIVED_CLASSES.length, 'class names are distinct');
  for (let s = 0; s < PLANT_SPECIES.length; s++) {
    const looks = [PlantLook.BARE, PlantLook.LEAF, PlantLook.BEARING].map((l) => plantClass(s, l));
    assert.equal(new Set(looks).size, 3);
    for (const c of looks) assert.ok(PERCEIVED_CLASSES[c].name.startsWith(PLANT_SPECIES[s].name));
  }
  assert.equal(PERCEIVED_CLASSES[plantClass(species('nut'), PlantLook.LEAF)].group, SightGroup.TREE);
  assert.equal(PERCEIVED_CLASSES[plantClass(species('berry'), PlantLook.LEAF)].group, SightGroup.BUSH);
  assert.equal(PERCEIVED_CLASSES[plantClass(species('tuber'), PlantLook.LEAF)].group, SightGroup.GROUND);
  for (const m of STONE_MATERIALS) {
    const plain = materialClass(m.id, false, false);
    const edged = materialClass(m.id, true, false);
    assert.ok(plain >= 0 && plain < CLASS.stillCount, `${m.name} lying is still`);
    assert.ok(edged >= CLASS.stillCount, `${m.name} with an edge is only an object`);
  }
  assert.equal(materialClass(Material.WOOD, false, true), CLASS.longWood);
  assert.equal(materialClass(Material.HIDE, false, false), CLASS.hide);
  assert.equal(MATERIALS.filter((m) => materialClass(m.id, false, false) < 0).length, 0, 'every material has a class');
  for (const kind of [AnimalKind.DEER, AnimalKind.AUROCHS, AnimalKind.WOLF, AnimalKind.CAT]) assert.ok(animalClass(kind) >= 0);
  const c = cue(CueKind.INDIVIDUAL, 0xabcdef);
  assert.equal(cueKind(c), CueKind.INDIVIDUAL);
  assert.equal(cuePayload(c), 0xabcdef);
  assert.ok(c < 2 ** 28, 'a cue leaves 4 bits for the act kind');
  assert.throws(() => cue(CueKind.PLACE, 2 ** 24));
});

test('the neighbour grid finds exactly what a brute-force search finds, in a fixed order, from its own copy of the positions', () => {
  let s = 12345;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const n = 600;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Half in a tight clump, as a group of bodies would be.
    x[i] = i % 2 === 0 ? 2000 + rand() * 30 : rand() * 5000;
    y[i] = i % 2 === 0 ? 3000 + rand() * 30 : rand() * 5000;
  }
  const keep = (i: number) => i % 7 !== 3;
  const grid = new NeighbourGrid(5000, 5000, 200);
  grid.build(x, y, n, keep);
  for (const r of [0.5, 3, 40, 450]) {
    for (let q = 0; q < 50; q++) {
      const px = q < 25 ? x[q * 2] : rand() * 5000;
      const py = q < 25 ? y[q * 2] : rand() * 5000;
      const want: number[] = [];
      for (let i = 0; i < n; i++) if (keep(i) && (x[i] - px) ** 2 + (y[i] - py) ** 2 <= r * r) want.push(i);
      const found = grid.query(px, py, r);
      const got = Array.from(grid.result.subarray(0, found));
      assert.deepEqual([...got].sort((a, b) => a - b), want, `radius ${r}`);
      // Inside each bucket by x, then by slot.
      for (let i = 1; i < got.length; i++) {
        const [a, b] = [got[i - 1], got[i]];
        const same = Math.floor(x[a] / 200) === Math.floor(x[b] / 200) && Math.floor(y[a] / 200) === Math.floor(y[b] / 200);
        if (same) assert.ok(x[a] < x[b] || (x[a] === x[b] && a < b));
      }
    }
  }
  const nBefore = grid.query(2015, 3015, 20);
  const before = Array.from(grid.result.subarray(0, nBefore));
  for (let i = 0; i < n; i++) x[i] += 1000;
  const nAfter = grid.query(2015, 3015, 20);
  assert.deepEqual(Array.from(grid.result.subarray(0, nAfter)), before, 'moving after the build changes nothing');
});

test('a look sees plants by their look, never food underground, and nothing of pathogens; darkness shortens the eye', () => {
  const sim = world(5);
  const W = sim.config.world.widthCells;
  const k = dryCentre(sim, 6);
  clearAround(sim, k, 6);
  stepSim(sim, 72); // noon on the first day: spring equinox, deciduous leaves not yet out
  clearAround(sim, k, 6);
  const berry = species('berry');
  const tuber = species('tuber');
  const nut = species('nut');
  const east = k + 1;
  setLayer(sim, coverLayer(PLANT_SPECIES[berry]), east, 0.3);
  setLayer(sim, foodLayer(PLANT_SPECIES[berry]), east, 4);
  setLayer(sim, coverLayer(PLANT_SPECIES[tuber]), k, 0.4);
  setLayer(sim, foodLayer(PLANT_SPECIES[tuber]), k, 900);
  setLayer(sim, coverLayer(PLANT_SPECIES[nut]), k + 3 * W, 0.5);
  setLayer(sim, stoneLayer(STONE_MATERIALS[0]), k, 40);
  const [x, y] = centreOf(sim, k);
  const me = spawnAgent(sim, x, y);
  const eye = createPerception(sim);
  const out = new Percepts();
  eye.perceive(me, out);
  assert.equal(cueKind(out.light), CueKind.LIGHT);
  assert.equal(cuePayload(out.light), LightBand.BRIGHT);
  assert.equal(cuePayload(out.dayLength), DayLength.LENGTHENING);
  const bearing = find(out, classCue(plantClass(berry, PlantLook.BEARING)));
  assert.equal(bearing.length, 1, 'the berries next door are seen');
  assert.deepEqual([bearing[0][0], bearing[0][1], bearing[0][2]], [50, east, PerceptSource.CELL]);
  assert.equal(find(out, classCue(plantClass(tuber, PlantLook.BEARING))).length, 0, 'tubers are underground');
  assert.equal(find(out, classCue(plantClass(tuber, PlantLook.LEAF))).length + find(out, classCue(plantClass(tuber, PlantLook.BARE))).length, 1);
  assert.equal(find(out, classCue(plantClass(nut, PlantLook.BARE))).length, 1, 'a nut tree 250 m off, bare in early spring');
  assert.equal(find(out, classCue(materialClass(STONE_MATERIALS[0].id, false, false)))[0][0], 0, 'stone in its own cell is at distance 0');

  // Pathogens in water are not on the surface of anything: a look cannot tell.
  const before = Array.from(out.cue.subarray(0, out.n));
  sim.state.world.layer<Float32Array>(WATER_PATHOGEN_LAYER).fill(1);
  eye.invalidate(east);
  eye.perceive(me, out);
  assert.deepEqual(Array.from(out.cue.subarray(0, out.n)), before);

  // Dark: a new-moon night. The tuber leaves underfoot still show; berries 50 m off do not.
  stepToLight(sim, 0, 0.005);
  clearAround(sim, k, 0);
  setLayer(sim, coverLayer(PLANT_SPECIES[tuber]), k, 0.4);
  setLayer(sim, coverLayer(PLANT_SPECIES[berry]), east, 0.3);
  setLayer(sim, foodLayer(PLANT_SPECIES[berry]), east, 4);
  eye.perceive(me, out);
  assert.equal(cuePayload(out.light), LightBand.DARK);
  assert.ok(Math.abs(out.rangeFactor - PERCEPTION.darkFactor) < 1e-12);
  assert.equal(find(out, classCue(plantClass(berry, PlantLook.BEARING))).length, 0, 'not in the dark');
  assert.equal(find(out, classCue(plantClass(tuber, PlantLook.LEAF))).length + find(out, classCue(plantClass(tuber, PlantLook.BARE))).length, 1);
});

test('trees around the eye and a ridge in between shorten what it sees', () => {
  const sim = world(6);
  const W = sim.config.world.widthCells;
  const k = dryCentre(sim, 6);
  stepSim(sim, 72);
  clearAround(sim, k, 6);
  const nut = species('nut');
  const nutBare = classCue(plantClass(nut, PlantLook.BARE));
  // Nut trees 3 cells east (250 m to the nearest point) and 3 cells north behind a ridge.
  setLayer(sim, coverLayer(PLANT_SPECIES[nut]), k + 3, 0.5);
  setLayer(sim, coverLayer(PLANT_SPECIES[nut]), k + 3 * W, 0.5);
  sim.state.world.layer<Float32Array>(TERRAIN_LAYERS.elevation)[k + 2 * W] += 30;
  const [x, y] = centreOf(sim, k);
  const me = spawnAgent(sim, x, y);
  const eye = createPerception(sim);
  const out = new Percepts();
  eye.perceive(me, out);
  const seen = find(out, nutBare);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1], k + 3, 'the trees behind the ridge are hidden; the ones in the open are seen');

  // Standing in a wood: the eye sees about a third as far, and 250 m is beyond it.
  setLayer(sim, coverLayer(PLANT_SPECIES[nut]), k, 1);
  eye.invalidate(k);
  eye.perceive(me, out);
  assert.ok(Math.abs(out.rangeFactor - (1 - PERCEPTION.vegetationLoss)) < 1e-9);
  assert.deepEqual(find(out, nutBare).map((p) => p[1]), [k], 'only the wood it stands in');
});

test('persons: who they are up close, a shape farther off, nothing beyond; tall plants hide them', () => {
  const sim = world(7);
  const W = sim.config.world.widthCells;
  const k = dryCentre(sim, 8);
  stepSim(sim, 72);
  clearAround(sim, k, 8);
  const [x, y] = centreOf(sim, k);
  const me = spawnAgent(sim, x, y);
  const near = spawnAgent(sim, x + 40, y);
  const close = spawnAgent(sim, x - 140, y);
  const far = spawnAgent(sim, x, y + 400);
  const tooFar = spawnAgent(sim, x + 700, y);
  const id = (slot: number) => sim.state.agents.id.data[slot];
  const eye = createPerception(sim);
  const out = new Percepts();
  eye.perceive(me, out);
  const persons = [];
  for (let n = 0; n < out.n; n++) if (cueKind(out.cue[n]) === CueKind.INDIVIDUAL) persons.push(cuePayload(out.cue[n]));
  assert.deepEqual(persons, [id(near), id(close)], 'nearest first, by id');
  const shape = find(out, classCue(CLASS.figure));
  assert.equal(shape.length, 1);
  assert.equal(shape[0][1], id(far));
  assert.ok(!persons.includes(id(tooFar)) && shape[0][1] !== id(tooFar));

  // The one 140 m off steps into reeds: now only a shape.
  const reedCell = Math.floor(y / 100) * W + Math.floor((x - 140) / 100);
  setLayer(sim, coverLayer(PLANT_SPECIES[species('reed')]), reedCell, 1);
  eye.perceive(me, out);
  const again = [];
  for (let n = 0; n < out.n; n++) if (cueKind(out.cue[n]) === CueKind.INDIVIDUAL) again.push(cuePayload(out.cue[n]));
  assert.deepEqual(again, [id(near)]);
});

test('animals by kind, a cat lying in reeds is hard to see; lying objects by material and edge; fire from afar at night', () => {
  const sim = world(8);
  const W = sim.config.world.widthCells;
  const k = dryCentre(sim, 8);
  stepSim(sim, 72);
  clearAround(sim, k, 8);
  const [x, y] = centreOf(sim, k);
  const me = spawnAgent(sim, x, y);
  const animals = sim.state.store(ANIMAL_STORE);
  const group = (kind: number, gx: number, gy: number, mode: number) => {
    const s = spawnEntity(sim.state, animals);
    animals.column<Uint8Array>('kind').data[s] = kind;
    animals.column<Float32Array>('x').data[s] = gx;
    animals.column<Float32Array>('y').data[s] = gy;
    animals.column<Uint16Array>('count').data[s] = 5;
    animals.column<Uint8Array>('mode').data[s] = mode;
    return animals.id.data[s];
  };
  const deer = group(AnimalKind.DEER, x + 450, y, AnimalMode.MOVE);
  group(AnimalKind.DEER, x - 520, y, AnimalMode.MOVE);
  const cat = group(AnimalKind.CAT, x, y + 150, AnimalMode.AMBUSH);
  setLayer(sim, coverLayer(PLANT_SPECIES[species('reed')]), Math.floor((y + 150) / 100) * W + Math.floor(x / 100), 1);
  const flake = spawnObject(sim, Material.FLINT, x + 3, y, 0.05, 0.06, 0.95);
  const cobble = spawnObject(sim, Material.FLINT, x + 1, y + 1, 0.8, 0.1, 0.1);
  const pole = spawnObject(sim, Material.WOOD, x - 2, y, 3, 2.2, 0);
  const objects = sim.state.store(OBJECT_STORE);
  const oid = (slot: number) => objects.id.data[slot];
  const eye = createPerception(sim);
  const out = new Percepts();
  eye.perceive(me, out);
  assert.deepEqual(find(out, classCue(animalClass(AnimalKind.DEER))), [[450, deer, PerceptSource.ANIMAL]], 'the nearer deer group');
  assert.equal(find(out, classCue(animalClass(AnimalKind.CAT))).length, 0, 'a cat lying in reeds 150 m off is not seen');
  assert.deepEqual(find(out, classCue(materialClass(Material.FLINT, true, false))).map((p) => p[1]), [oid(flake)]);
  assert.deepEqual(find(out, classCue(materialClass(Material.FLINT, false, false))).map((p) => p[1]), [oid(cobble)]);
  assert.deepEqual(find(out, classCue(CLASS.longWood)).map((p) => p[1]), [oid(pole)]);

  assert.ok(cat > 0);

  // A new-moon night: a cat moving 2 m off is seen, and a stick burning 1.5 km off.
  stepToLight(sim, 0, 0.005);
  clearAround(sim, k, 8);
  const cat2 = group(AnimalKind.CAT, x, y + 2, AnimalMode.MOVE);
  const stick = spawnObject(sim, Material.WOOD, x + 1500, y, 0.5, 1, 0);
  objects.column<Float32Array>('burnKw').data[stick] = 20;
  (sim.state.parts.find((p) => p.name === FIRE_PARTS.counts)!.readings!() as Float64Array)[FIRE_FIELDS.burningObjects] += 1;
  eye.perceive(me, out);
  assert.equal(cuePayload(out.light), LightBand.DARK);
  assert.deepEqual(find(out, classCue(animalClass(AnimalKind.CAT))).map((p) => p[1]), [cat2], 'a cat 2 m off in the dark');
  const fire = find(out, classCue(CLASS.flaming));
  assert.equal(fire.length, 1, 'a burning stick 1.5 km off at night');
  assert.deepEqual([fire[0][1], fire[0][2]], [oid(stick), PerceptSource.OBJECT]);
});

test('the still view is kept per cell and hour, and saved, so a run loaded mid-hour sees what the unbroken run sees', () => {
  // A looker: every agent looks every tick; its percepts are folded into a checksum per tick.
  // At tick 13 it eats a cell's berries without telling perception, as nothing should.
  function looker(sums: number[], berryCell: () => number, bearing: boolean[] = []): SystemDef {
    return defineSystem({
      name: 'fixture.looker',
      create: (sim) => {
        const eye: Perception = createPerception(sim);
        const out = new Percepts();
        return () => {
          let h = 0;
          const agents = sim.state.agents;
          for (let s = 0; s < agents.highWater; s++) {
            if (agents.alive.data[s] !== 1) continue;
            eye.perceive(s, out);
            for (let n = 0; n < out.n; n++) h = (Math.imul(h, 31) + out.cue[n] + Math.round(out.dist[n])) >>> 0;
            if (s === 0) {
              let seen = false;
              for (let n = 0; n < out.n; n++) seen ||= out.cue[n] === classCue(plantClass(species('berry'), PlantLook.BEARING)) && out.ref[n] === berryCell();
              bearing.push(seen);
            }
          }
          sums.push(h);
          if (sim.state.tick === 13) sim.state.world.layer<Float32Array>(foodLayer(PLANT_SPECIES[species('berry')]))[berryCell()] = 0;
        };
      },
    });
  }
  let cell = -1;
  const sumsA: number[] = [];
  const bearingA: boolean[] = [];
  const a = world(9, [looker(sumsA, () => cell, bearingA)]);
  cell = dryCentre(a, 3);
  const berry = species('berry');
  setLayer(a, coverLayer(PLANT_SPECIES[berry]), cell, 0.5);
  setLayer(a, foodLayer(PLANT_SPECIES[berry]), cell, 30);
  const [x, y] = centreOf(a, cell);
  for (let n = 0; n < 4; n++) spawnAgent(a, x + 30 * n, y);
  stepSim(a, 15);
  const saved = saveSim(a);
  const sumsB: number[] = [];
  const b = loadSim(saved, [...a.pipeline.slice(0, a.pipeline.findIndex((d) => d.name === 'fixture.looker')), looker(sumsB, () => cell), ...a.pipeline.slice(a.pipeline.findIndex((d) => d.name === 'fixture.looker') + 1)]);
  stepSim(a, 15);
  stepSim(b, 15);
  assert.deepEqual(sumsB, sumsA.slice(15), 'the same looks after loading at tick 15, mid-hour');
  assert.equal(hashSim(b), hashSim(a));
  // The berries eaten at tick 13 looked bearing until the next hour began at tick 18.
  assert.deepEqual(bearingA.slice(12, 20), [true, true, true, true, true, true, false, false]);
});
