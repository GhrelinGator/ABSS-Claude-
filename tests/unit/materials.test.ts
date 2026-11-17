// Materials and objects (docs/DESIGN.md §2.15): where stone, wood, bone and skin lie, how
// objects break when struck, sparks from iron sulfide, rot, and cover from rock, trees and piles.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import {
  MATERIALS,
  MATERIAL_CONSTANTS,
  MATERIAL_LAYERS,
  Material,
  OBJECT_STORE,
  RockShelter,
  STONE_KINDS,
  objectColumns,
  placeObject,
  rockShelterSpot,
  shelterAt,
  stoneLayer,
  strikeObjects,
  takePiece,
} from '../../src/sim/world/materials.ts';
import { PLANT_SPECIES, coverLayer } from '../../src/sim/world/plants.ts';
import { Soil, TERRAIN_LAYERS, Water, steepestSlope } from '../../src/sim/world/terrain.ts';

function makeSim(seed: number, cells: number, circumscription = 0.5): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = circumscription;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}
const days = (sim: Sim, n: number) => stepSim(sim, n * sim.config.time.ticksPerDay);
const f32 = (sim: Sim, name: string) => sim.state.world.layer<Float32Array>(name);
const u8 = (sim: Sim, name: string) => sim.state.world.layer<Uint8Array>(name);
const u16 = (sim: Sim, name: string) => sim.state.world.layer<Uint16Array>(name);

/** A fixed sequence of numbers in [0, 1) for the chance part of a strike. */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const objects = (sim: Sim) => objectColumns(sim.state.store(OBJECT_STORE));
const massOf = (sim: Sim, slots: number[]) => slots.reduce((sum, s) => sum + objects(sim).massKg[s], 0);

test('stone lies where the ground and the rock put it, and caves sit on steep ground or limestone', () => {
  const sim = makeSim(3, 256, 0.75);
  const { widthCells: W, heightCells: H, cellSizeM } = sim.config.world;
  const kind = u8(sim, TERRAIN_LAYERS.waterKind);
  const soil = u8(sim, TERRAIN_LAYERS.soil);
  const bedrock = u8(sim, MATERIAL_LAYERS.bedrock);
  const shelter = u8(sim, MATERIAL_LAYERS.rockShelter);
  const slope = steepestSlope(W, H, cellSizeM, sim.state.world.layer<Float32Array>(TERRAIN_LAYERS.elevation));
  const count = (m: number) => u16(sim, stoneLayer(m));
  const nearRiver = (k: number) => {
    const i = k % W;
    const j = (k - i) / W;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < W && nj < H && kind[nj * W + ni] === Water.RIVER) return true;
      }
    }
    return false;
  };
  let caves = 0;
  let overhangs = 0;
  let rockyStones = 0;
  let loamStones = 0;
  let rocky = 0;
  let loam = 0;
  for (let k = 0; k < W * H; k++) {
    const all = STONE_KINDS.reduce((sum, m) => sum + count(m)[k], 0);
    if (kind[k] === Water.LAKE) assert.equal(all, 0, 'stones under a lake');
    if (kind[k] === Water.RIVER) {
      for (const m of [Material.LIMESTONE, Material.SANDSTONE, Material.PYRITE]) assert.equal(count(m)[k], 0, `${MATERIALS[m].name} in a river bed`);
    }
    if (soil[k] === Soil.SAND) assert.equal(bedrock[k], Material.SANDSTONE, 'sand lies on sandstone');
    if (count(Material.FLINT)[k] > 0) assert.ok(bedrock[k] === Material.LIMESTONE || nearRiver(k), 'flint away from limestone and rivers');
    if (count(Material.PYRITE)[k] > 0) assert.ok(bedrock[k] === Material.LIMESTONE || bedrock[k] === Material.SANDSTONE, 'pyrite outside sedimentary rock');
    if (shelter[k] !== RockShelter.NONE) {
      assert.equal(kind[k], Water.DRY, 'a rock shelter in water');
      if (slope[k] <= MATERIAL_CONSTANTS.gentleSlope) {
        assert.equal(shelter[k], RockShelter.CAVE, 'an overhang on gentle ground');
        assert.equal(bedrock[k], Material.LIMESTONE, 'a cave on gentle ground outside limestone');
      }
      if (shelter[k] === RockShelter.CAVE) caves++;
      else overhangs++;
    }
    if (kind[k] === Water.DRY && !nearRiver(k)) {
      if (soil[k] === Soil.ROCK || soil[k] === Soil.THIN) {
        rocky++;
        rockyStones += all;
      } else if (soil[k] === Soil.LOAM) {
        loam++;
        loamStones += all;
      }
    }
  }
  assert.ok(caves > 0 && overhangs > caves, `${caves} caves and ${overhangs} overhangs`);
  assert.ok(rocky > 0 && loam > 0);
  assert.ok(rockyStones / rocky > 5 * (loamStones / loam), 'rocky ground should be far stonier than loam');
});

test('dead wood gathers under trees, stays near its starting balance, and bone and skin follow deaths', () => {
  const sim = makeSim(2, 128);
  const N = sim.config.world.widthCells * sim.config.world.heightCells;
  const wood = f32(sim, MATERIAL_LAYERS.deadwood);
  const trees = f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'nut')!));
  const shrubs = f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'berry')!));
  const total = () => wood.reduce((a, b) => a + b, 0);
  for (let k = 0; k < N; k++) if (trees[k] === 0 && shrubs[k] === 0) assert.equal(wood[k], 0, 'dead wood with no woody plants');
  const start = total();
  assert.ok(start > 0);
  days(sim, 3 * sim.config.time.daysPerYear);
  const end = total();
  assert.ok(Math.abs(end / start - 1) < 0.3, `dead wood went from ${start.toFixed(0)} to ${end.toFixed(0)} kg`);
  let wooded = 0;
  let woodedN = 0;
  let open = 0;
  let openN = 0;
  for (let k = 0; k < N; k++) {
    if (trees[k] > 0.4) {
      wooded += wood[k];
      woodedN++;
    } else if (trees[k] + shrubs[k] < 0.05) {
      open += wood[k];
      openN++;
    }
  }
  assert.ok(woodedN > 0 && openN > 0);
  assert.ok(wooded / woodedN > 5 * (open / openN), 'woods should hold far more dead wood than open ground');
  const bone = f32(sim, MATERIAL_LAYERS.bone).reduce((a, b) => a + b, 0);
  const hide = f32(sim, MATERIAL_LAYERS.hide).reduce((a, b) => a + b, 0);
  assert.ok(bone > 0, 'animals died but left no bone');
  const ratio = MATERIAL_CONSTANTS.hidePerMeatKg / MATERIAL_CONSTANTS.bonePerMeatKg;
  assert.ok(hide < 0.5 * ratio * bone, 'skin should rot much faster than bone weathers');
});

test('skin rots faster in summer than in winter, and stone never does', () => {
  const sim = makeSim(4, 32);
  const { cellSizeM } = sim.config.world;
  const x = 16.5 * cellSizeM;
  days(sim, 6); // the run starts at the spring equinox; midsummer is day 12
  const store = sim.state.store(OBJECT_STORE);
  const idOf = (slot: number) => store.id.data[slot];
  const integrityOf = (id: number) => (store.slotOf(id) >= 0 ? objects(sim).integrity[store.slotOf(id)] : 0);
  const summer = idOf(placeObject(sim, Material.HIDE, x, x, 4, 1.8, 0));
  const flint = idOf(placeObject(sim, Material.FLINT, x, x, 1, 0.1, 0));
  days(sim, 10);
  const afterSummer = integrityOf(summer);
  days(sim, 14); // day 30
  const winter = idOf(placeObject(sim, Material.HIDE, x, x, 4, 1.8, 0));
  days(sim, 10);
  const afterWinter = integrityOf(winter);
  assert.ok(afterSummer < afterWinter, `summer skin at ${afterSummer.toFixed(2)}, winter skin at ${afterWinter.toFixed(2)}`);
  assert.equal(store.slotOf(summer), -1, 'a raw skin should be gone within a month of warm weather');
  assert.equal(integrityOf(flint), 1);
});

test('a struck flint core gives off a sharp flake; a round nodule needs a harder blow; mass is kept', () => {
  const sim = makeSim(5, 32);
  const rand = sequence(1);
  const core = placeObject(sim, Material.FLINT, 100, 100, 2, 0.15, 0.6);
  const cobble = placeObject(sim, Material.QUARTZITE, 100, 100, 0.6, 0.1, 0);
  const before = massOf(sim, [core, cobble]);
  const hit = strikeObjects(sim, cobble, core, 9, rand);
  assert.ok(hit.struckBroke && !hit.strikerBroke, 'the core should flake and the round cobble hold');
  assert.equal(hit.pieces.length, 1);
  const flake = hit.pieces[0];
  assert.ok(objects(sim).edge[flake] >= 0.7, `flake edge ${objects(sim).edge[flake]}`);
  assert.ok(objects(sim).massKg[flake] < 0.3 * objects(sim).massKg[core]);
  assert.ok(Math.abs(massOf(sim, [core, cobble, flake]) + hit.dustKg - before) < 1e-5, 'mass should be conserved');

  const nodule = placeObject(sim, Material.FLINT, 100, 100, 2, 0.15, 0);
  const soft = strikeObjects(sim, cobble, nodule, 9, rand);
  assert.ok(!soft.struckBroke, 'a round nodule should not open at the energy that flakes an edged core');
  const hard = strikeObjects(sim, cobble, nodule, 14, rand);
  assert.ok(hard.struckBroke, `a harder blow (${hard.energyJ.toFixed(0)} J) should open it`);
  assert.ok(objects(sim).edge[nodule] > 0, 'an opened nodule has edges');

  const big = placeObject(sim, Material.FLINT, 100, 100, 1, 0.1, 0.6);
  const boulder = placeObject(sim, Material.GRANITE, 100, 100, 50, 0.4, 0);
  const smash = strikeObjects(sim, boulder, big, 30, rand);
  assert.ok(smash.pieces.length >= 2, 'flint struck far beyond its breaking energy should shatter');
});

test('grainy stone breaks blunt, wood snaps shorter, skin never breaks, and weak strikers break', () => {
  const sim = makeSim(6, 32);
  const rand = sequence(2);
  const granite = placeObject(sim, Material.GRANITE, 50, 50, 2, 0.12, 0);
  const anvil = placeObject(sim, Material.GRANITE, 50, 50, 80, 0.5, 0);
  const a = strikeObjects(sim, granite, anvil, 20, rand);
  assert.ok(a.strikerBroke, 'a granite cobble dropped hard on a boulder should split');
  for (const s of [granite, ...a.pieces]) assert.ok(objects(sim).edge[s] <= MATERIALS[Material.GRANITE].freshEdge + 1e-6);

  const stick = placeObject(sim, Material.WOOD, 50, 50, 3.1, 3, 0);
  const w = strikeObjects(sim, stick, anvil, 12, rand);
  assert.ok(w.strikerBroke && w.pieces.length === 1, 'a pole swung hard into a boulder should snap');
  const lengths = objects(sim).lengthM[stick] + objects(sim).lengthM[w.pieces[0]];
  assert.ok(Math.abs(lengths - 3) < 1e-5, `pieces add up to ${lengths} m`);

  const hide = placeObject(sim, Material.HIDE, 50, 50, 4, 1.8, 0);
  const h = strikeObjects(sim, anvil, hide, 30, rand);
  assert.ok(!h.struckBroke && h.pieces.length === 0);

  const flake = placeObject(sim, Material.FLINT, 50, 50, 0.05, 0.06, 1);
  const f = strikeObjects(sim, flake, anvil, 25, rand);
  assert.ok(f.strikerBroke, 'a thin flake swung hard into a boulder should break');

  const pebble = placeObject(sim, Material.QUARTZITE, 50, 50, 0.3, 0.06, 0);
  const n = sim.state.store(OBJECT_STORE).count;
  const gentle = strikeObjects(sim, pebble, anvil, 1, rand);
  assert.ok(!gentle.struckBroke && !gentle.strikerBroke && gentle.pieces.length === 0);
  assert.equal(sim.state.store(OBJECT_STORE).count, n, 'a tap changes nothing');
});

test('pyrite struck by something harder throws sparks; nothing else does', () => {
  const sim = makeSim(7, 32);
  const rand = sequence(3);
  const pyrite = placeObject(sim, Material.PYRITE, 10, 10, 0.2, 0.05, 0.1);
  const flint = placeObject(sim, Material.FLINT, 10, 10, 0.3, 0.08, 0.8);
  const granite = placeObject(sim, Material.GRANITE, 10, 10, 0.3, 0.06, 0);
  const flint2 = placeObject(sim, Material.FLINT, 10, 10, 0.3, 0.08, 0.8);
  const before = objects(sim).massKg[pyrite];
  const hit = strikeObjects(sim, flint, pyrite, 6, rand);
  assert.ok(hit.sparks > 0, 'flint on pyrite should spark');
  assert.ok(objects(sim).massKg[pyrite] < before, 'striking sparks wears the pyrite');
  assert.equal(strikeObjects(sim, flint, flint2, 6, rand).sparks, 0, 'flint on flint: no hot sparks');
  assert.equal(strikeObjects(sim, granite, pyrite, 6, rand).sparks, 0, 'granite is softer than pyrite');
});

test('pieces come from the ground: stones by count, wood by weight, long poles only where trees grow', () => {
  const sim = makeSim(8, 64);
  const { widthCells: W, cellSizeM } = sim.config.world;
  const rand = sequence(4);
  const flint = u16(sim, stoneLayer(Material.FLINT));
  const k = flint.findIndex((n) => n > 0);
  assert.ok(k >= 0, 'this map should have some flint');
  const x = ((k % W) + 0.5) * cellSizeM;
  const y = (Math.floor(k / W) + 0.5) * cellSizeM;
  const had = flint[k];
  const slot = takePiece(sim, x, y, Material.FLINT, rand);
  assert.ok(slot >= 0);
  assert.equal(flint[k], had - 1);
  assert.equal(objects(sim).material[slot], Material.FLINT);

  const wood = f32(sim, MATERIAL_LAYERS.deadwood);
  const trees = f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'nut')!));
  const shrubs = f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'berry')!));
  const forest = trees.findIndex((t, c) => t > 0.3 && wood[c] > 1000);
  const scrub = shrubs.findIndex((s, c) => s > 0.05 && trees[c] === 0 && wood[c] > 20);
  assert.ok(forest >= 0 && scrub >= 0, 'this map should have woods and scrub');
  const at = (c: number) => [((c % W) + 0.5) * cellSizeM, (Math.floor(c / W) + 0.5) * cellSizeM] as const;
  let longest = 0;
  for (let n = 0; n < 40; n++) {
    const before = wood[forest];
    const s = takePiece(sim, ...at(forest), Material.WOOD, rand);
    if (s < 0) break;
    assert.ok(Math.abs(before - wood[forest] - objects(sim).massKg[s]) < 1e-3, 'wood taken comes off the cell');
    longest = Math.max(longest, objects(sim).lengthM[s]);
  }
  assert.ok(longest > MATERIAL_CONSTANTS.frameLengthM, 'woods should give some long poles');
  for (let n = 0; n < 40; n++) {
    const s = takePiece(sim, ...at(scrub), Material.WOOD, rand);
    if (s >= 0) assert.ok(objects(sim).lengthM[s] <= 1.5 + 1e-6, 'scrub gives only short sticks');
  }
  const lake = u8(sim, TERRAIN_LAYERS.waterKind).findIndex((w) => w === Water.LAKE);
  if (lake >= 0) assert.equal(takePiece(sim, ...at(lake), Material.GRANITE, rand), -1, 'no stones under a lake');
});

test('cover comes from caves, from trees, and from long wood piled with skins on it', () => {
  const sim = makeSim(3, 256, 0.75);
  const W = sim.config.world.widthCells;
  const cs = sim.config.world.cellSizeM;
  const shelter = u8(sim, MATERIAL_LAYERS.rockShelter);
  const cave = shelter.findIndex((s) => s === RockShelter.CAVE);
  assert.ok(cave >= 0, 'this map should have a cave');
  const spot = rockShelterSpot(sim, cave);
  const inside = shelterAt(sim, spot.x, spot.y);
  assert.equal(inside.rain, 1);
  assert.ok(inside.buffered > 0.5);
  const corner = shelterAt(sim, (cave % W) * cs + 0.01, Math.floor(cave / W) * cs + 0.01);
  assert.ok(corner.rain < 1 && corner.buffered === 0, 'a cave covers only its own spot');

  // An open cell: clear its trees and shrubs for the test.
  const kind = u8(sim, TERRAIN_LAYERS.waterKind);
  const open = shelter.findIndex((s, c) => s === RockShelter.NONE && kind[c] === Water.DRY);
  for (const species of PLANT_SPECIES) f32(sim, coverLayer(species))[open] = 0;
  const x = ((open % W) + 0.5) * cs;
  const y = (Math.floor(open / W) + 0.5) * cs;
  assert.deepEqual(shelterAt(sim, x, y), { wind: 0, rain: 0, sky: 0, buffered: 0 });
  f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'nut')!))[open] = 1;
  const wooded = shelterAt(sim, x, y);
  assert.ok(wooded.wind > 0.3 && wooded.rain > 0 && wooded.rain < 0.5, 'a canopy breaks the wind and some of the rain');
  f32(sim, coverLayer(PLANT_SPECIES.find((s) => s.name === 'nut')!))[open] = 0;

  const hides: number[] = [];
  for (let n = 0; n < 3; n++) hides.push(placeObject(sim, Material.HIDE, x + 0.5, y, 4, 1.8, 0));
  assert.equal(shelterAt(sim, x, y).rain, 0, 'skins on the ground with nothing to hold them up cover nothing');
  const poles: number[] = [];
  for (let n = 0; n < 20; n++) poles.push(placeObject(sim, Material.WOOD, x + (n % 5) * 0.4 - 0.8, y + 1, 4, 3, 0));
  const piled = shelterAt(sim, x, y);
  assert.ok(piled.rain > 0.8 && piled.wind > 0.8, `rain ${piled.rain.toFixed(2)}, wind ${piled.wind.toFixed(2)}`);
  for (const h of hides) objects(sim).holder[h] = 1;
  const frameOnly = shelterAt(sim, x, y);
  assert.ok(frameOnly.rain === 0 && frameOnly.wind > 0.39, 'held skins are not on the frame');
  assert.deepEqual(shelterAt(sim, x + 10, y), { wind: 0, rain: 0, sky: 0, buffered: 0 }, 'a pile covers only the spot it is on');
});

test('objects survive a snapshot round trip, and the run carries on identically', () => {
  const sim = makeSim(9, 32);
  placeObject(sim, Material.HIDE, 300, 300, 3, 1.5, 0);
  placeObject(sim, Material.WOOD, 310, 300, 2, 2.5, 0.05);
  strikeObjects(sim, placeObject(sim, Material.QUARTZITE, 5, 5, 0.6, 0.1, 0), placeObject(sim, Material.FLINT, 5, 5, 1.5, 0.12, 0.6), 9, sequence(5));
  days(sim, 2);
  const copy = loadSim(saveSim(sim), SIM_PIPELINE);
  assert.equal(hashSim(copy), hashSim(sim));
  days(sim, 5);
  days(copy, 5);
  assert.equal(hashSim(copy), hashSim(sim));
  assert.ok(sim.state.store(OBJECT_STORE).count >= 4);
});
