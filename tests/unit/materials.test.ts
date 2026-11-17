// Materials and objects (docs/DESIGN.md §2.8, §2.15): the catalogue, loose stone and fallen
// wood laid down by the landscape, rock shelters, striking, sparks, rotting, and shelter.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { STREAM_WORDS, StreamDomain, seedStream } from '../../src/sim/core/rng.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, hashSim, loadSim, saveSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import {
  Bedrock,
  MATERIALS,
  MATERIAL_LAYERS,
  Material,
  OBJECT_STORE,
  ROCK_SHELTER_STORE,
  RockShelterKind,
  STONE_MATERIALS,
  createShelterProbe,
  spawnObject,
  stoneLayer,
  strikeObjects,
  takeStone,
  takeWood,
} from '../../src/sim/world/materials.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

function makeSim(seed: number, cells: number, circumscription = 0.5): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = circumscription;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}
function stream(id: number): Uint32Array {
  const s = new Uint32Array(STREAM_WORDS);
  seedStream(s, 0, 99, StreamDomain.FIXTURE, id);
  return s;
}
const f32 = (sim: Sim, name: string) => sim.state.world.layer<Float32Array>(name);
const u8 = (sim: Sim, name: string) => sim.state.world.layer<Uint8Array>(name);
const col = (sim: Sim, name: string) => sim.state.store(OBJECT_STORE).column<Float32Array>(name).data;

function totalMass(sim: Sim): number {
  const store = sim.state.store(OBJECT_STORE);
  const mass = col(sim, 'mass');
  let sum = 0;
  for (let s = 0; s < store.highWater; s++) if (store.alive.data[s] === 1) sum += mass[s];
  return sum;
}

test('the catalogue holds physical attributes in range, and only iron sulfide burns as sparks', () => {
  const ids = new Set<number>();
  for (const m of MATERIALS) {
    assert.ok(!ids.has(m.id), `${m.name}: duplicate id`);
    ids.add(m.id);
    assert.ok(m.densityKgM3 > 0 && m.hardness > 0 && m.hardness <= 10, m.name);
    for (const v of [m.freshEdge, m.weatheredEdge, m.flammability, m.shedsRain]) assert.ok(v >= 0 && v <= 1, m.name);
    assert.ok(m.weatheredEdge <= m.freshEdge, `${m.name}: weathering should not sharpen`);
    assert.equal(m.sparkFuel > 0, m.id === Material.PYRITE, m.name);
  }
  assert.equal(STONE_MATERIALS.length, 6);
});

test('loose stone follows the bedrock and the water; fallen wood lies under trees and bushes', () => {
  const sim = makeSim(2, 192);
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const soil = u8(sim, TERRAIN_LAYERS.soil);
  const bedrock = u8(sim, MATERIAL_LAYERS.bedrock);
  const flint = f32(sim, stoneLayer(MATERIALS[Material.FLINT - 1]));
  const pyrite = f32(sim, stoneLayer(MATERIALS[Material.PYRITE - 1]));
  const small = f32(sim, MATERIAL_LAYERS.smallWood);
  const long = f32(sim, MATERIAL_LAYERS.longWood);
  const tree = f32(sim, 'plants.nut.cover');
  const bush = f32(sim, 'plants.berry.cover');
  const kinds = new Set<number>();
  let flintCells = 0;
  let pyriteCells = 0;
  let riverStone = 0;
  let riverCells = 0;
  let loamStone = 0;
  let loamCells = 0;
  for (let k = 0; k < water.length; k++) {
    kinds.add(bedrock[k]);
    let here = 0;
    for (const m of STONE_MATERIALS) {
      const v = f32(sim, stoneLayer(m))[k];
      assert.ok(Number.isFinite(v) && v >= 0);
      here += v;
    }
    if (water[k] === Water.LAKE) assert.equal(here, 0, 'nothing to pick up on a lake');
    if (water[k] === Water.RIVER) {
      riverStone += here;
      riverCells++;
      assert.equal(pyrite[k], 0, 'iron sulfide does not survive in a river bed');
    }
    if (water[k] === Water.DRY && soil[k] === 2) {
      loamStone += here;
      loamCells++;
    }
    if (flint[k] > 0) {
      if (flint[k] >= 1) flintCells++;
      assert.equal(bedrock[k], Bedrock.LIMESTONE, 'flint nodules weather out of limestone');
    }
    if (pyrite[k] > 0) assert.equal(bedrock[k], Bedrock.LIMESTONE);
    if (pyrite[k] >= 1) pyriteCells++;
    if (water[k] !== Water.DRY) assert.equal(small[k] + long[k], 0);
    if (tree[k] === 0 && bush[k] === 0) assert.equal(small[k], 0);
    if (tree[k] === 0) assert.equal(long[k], 0);
    if (tree[k] > 0.2) assert.ok(long[k] > 0);
  }
  assert.deepEqual([...kinds].sort(), [Bedrock.GRANITE, Bedrock.LIMESTONE, Bedrock.SANDSTONE]);
  assert.ok(flintCells > 0 && pyriteCells > 0 && pyriteCells < flintCells, `${flintCells} ${pyriteCells}`);
  assert.ok(riverCells > 0 && riverStone / riverCells > 20 * (loamStone / loamCells), 'river beds are stony; loam is not');
});

test('rock shelters lie on dry land, more of them where the land is walled in', () => {
  const count = (circumscription: number): number => {
    const sim = makeSim(3, 192, circumscription);
    const store = sim.state.store(ROCK_SHELTER_STORE);
    const water = u8(sim, TERRAIN_LAYERS.waterKind);
    const bedrock = u8(sim, MATERIAL_LAYERS.bedrock);
    const kind = store.column<Uint8Array>('kind').data;
    const x = store.column<Float64Array>('x').data;
    const y = store.column<Float64Array>('y').data;
    const area = store.column<Float32Array>('area').data;
    for (let s = 0; s < store.highWater; s++) {
      const k = Math.floor(y[s] / 100) * 192 + Math.floor(x[s] / 100);
      assert.equal(water[k], Water.DRY);
      if (bedrock[k] === Bedrock.GRANITE) assert.equal(kind[s], RockShelterKind.OVERHANG, 'granite has no caves');
      assert.ok(area[s] >= 6 && area[s] <= 150);
    }
    return store.count;
  };
  const open = count(0);
  const walled = count(1);
  assert.ok(walled > 2 * open + 10, `walled ${walled}, open ${open}`);
});

test('picking up loose material takes exactly what the new object weighs', () => {
  const sim = makeSim(2, 96);
  const water = u8(sim, TERRAIN_LAYERS.waterKind);
  const long = f32(sim, MATERIAL_LAYERS.longWood);
  const s = stream(1);
  // Some cell with quartzite, and the cell with most fallen long wood.
  const quartzite = f32(sim, stoneLayer(MATERIALS[Material.QUARTZITE - 1]));
  let k = 0;
  while (!(quartzite[k] > 10 && water[k] === Water.DRY)) k++;
  let w = 0;
  for (let c = 0; c < long.length; c++) if (long[c] > long[w]) w = c;
  const at = (c: number) => [((c % 96) + 0.5) * 100, (Math.floor(c / 96) + 0.5) * 100] as const;
  const before = quartzite[k];
  const stone = takeStone(sim, Material.QUARTZITE, ...at(k), s, 0);
  assert.ok(stone >= 0);
  assert.ok(Math.abs(before - quartzite[k] - col(sim, 'mass')[stone]) < 1e-3);
  assert.ok(col(sim, 'mass')[stone] >= 0.15 * 0.999 && col(sim, 'mass')[stone] <= 3.001);
  const woodBefore = long[w];
  const pole = takeWood(sim, true, ...at(w), s, 0);
  assert.ok(pole >= 0 && col(sim, 'length')[pole] >= 1.5);
  assert.ok(Math.abs(woodBefore - long[w] - col(sim, 'mass')[pole]) < 1e-2);
  quartzite[k] = 0;
  assert.equal(takeStone(sim, Material.QUARTZITE, ...at(k), s, 0), -1, 'none left');
  assert.throws(() => takeStone(sim, Material.WOOD, ...at(k), s, 0));
});

test('struck flint flakes into keen edges; limestone crumbles; mass is kept except crumbs', () => {
  const sim = makeSim(4, 48);
  const s = stream(2);
  let keen = 0;
  for (let n = 0; n < 20; n++) {
    const striker = spawnObject(sim, Material.QUARTZITE, 100, 100, 0.8, 0.12, 0);
    const nodule = spawnObject(sim, Material.FLINT, 100, 100, 1.2, 0.15, 0.1);
    const before = totalMass(sim);
    const out = strikeObjects(sim, striker, nodule, 30, 0.9, s, 0);
    assert.ok(Math.abs(totalMass(sim) + out.crumbsKg - before) < 1e-4);
    assert.equal(out.sparks, 0, 'silica on silica makes no hot sparks');
    for (const p of out.pieces) if (col(sim, 'edge')[p] > 0.6) keen++;
  }
  assert.ok(keen >= 10, `${keen} keen flakes from 20 good blows`);

  // A blow too weak to detach anything does nothing to flint.
  const a = spawnObject(sim, Material.FLINT, 50, 50, 1, 0.12, 0.1);
  const b = spawnObject(sim, Material.FLINT, 50, 50, 1, 0.12, 0.1);
  assert.deepEqual(strikeObjects(sim, a, b, 2, 1, s, 0).pieces, []);

  // Limestone never yields a keen edge, however it is struck.
  for (let n = 0; n < 20; n++) {
    const x = spawnObject(sim, Material.LIMESTONE, 10, 10, 1, 0.12, 0);
    const y = spawnObject(sim, Material.LIMESTONE, 10, 10, 1, 0.12, 0);
    const before = totalMass(sim);
    const out = strikeObjects(sim, x, y, 20 + 20 * n, 1, s, 0);
    assert.ok(Math.abs(totalMass(sim) + out.crumbsKg - before) < 1e-4);
    for (const p of [x, y, ...out.pieces]) assert.ok(col(sim, 'edge')[p] <= 0.2);
  }

  // A hard blow on a small flake shatters it.
  const flake = spawnObject(sim, Material.FLINT, 20, 20, 0.02, 0.05, 0.9);
  const rock = spawnObject(sim, Material.GRANITE, 20, 20, 2, 0.15, 0);
  assert.ok(strikeObjects(sim, rock, flake, 40, 0.5, s, 0).pieces.length >= 2);
  // Striking stone with a keen flake dulls it.
  const edge = spawnObject(sim, Material.FLINT, 30, 30, 0.05, 0.06, 0.9);
  const block = spawnObject(sim, Material.QUARTZITE, 30, 30, 3, 0.2, 0);
  strikeObjects(sim, edge, block, 0.5, 0.5, s, 0);
  assert.ok(col(sim, 'edge')[edge] < 0.6);
});

test('iron sulfide struck by harder stone throws hot sparks; other pairs do not', () => {
  const sim = makeSim(4, 48);
  const s = stream(3);
  const pair = (a: number, b: number, energy = 30) =>
    strikeObjects(sim, spawnObject(sim, a, 5, 5, 0.5, 0.08, 0), spawnObject(sim, b, 5, 5, 0.5, 0.08, 0), energy, 0.5, s, 0);
  let hot = 0;
  for (let n = 0; n < 10; n++) {
    const out = pair(Material.FLINT, Material.PYRITE);
    hot += out.sparks;
    if (out.sparks > 0) assert.ok(out.sparkHeat > 0.8);
  }
  assert.ok(hot >= 20, `${hot} sparks from 10 blows`);
  for (const [a, b] of [
    [Material.FLINT, Material.FLINT],
    [Material.GRANITE, Material.GRANITE],
    [Material.LIMESTONE, Material.PYRITE],
    [Material.WOOD, Material.PYRITE],
  ]) {
    assert.equal(pair(a, b).sparks, 0, `${a} on ${b}`);
  }
});

test('a thin stick snaps under a hard blow; a heavy pole does not', () => {
  const sim = makeSim(4, 48);
  const s = stream(4);
  const stone = spawnObject(sim, Material.GRANITE, 5, 5, 1.5, 0.12, 0);
  const stick = spawnObject(sim, Material.WOOD, 5, 5, 0.3, 0.9, 0.05);
  const out = strikeObjects(sim, stone, stick, 40, 0.5, s, 0);
  assert.equal(out.pieces.length, 1);
  assert.ok(Math.abs(col(sim, 'length')[stick] + col(sim, 'length')[out.pieces[0]] - 0.9) < 1e-5);
  const pole = spawnObject(sim, Material.WOOD, 5, 5, 12, 3, 0.05);
  assert.equal(strikeObjects(sim, stone, pole, 40, 0.5, s, 0).pieces.length, 0);
});

test('hide rots within weeks in summer, wood over years, stone never', () => {
  const sim = makeSim(5, 48);
  const store = sim.state.store(OBJECT_STORE);
  const ticksPerDay = sim.config.time.ticksPerDay;
  // Start of summer.
  stepSim(sim, 9 * ticksPerDay);
  const hide = spawnObject(sim, Material.HIDE, 2400, 2400, 3, 1.5, 0);
  const stick = spawnObject(sim, Material.WOOD, 2400, 2400, 0.4, 1, 0.05);
  const stone = spawnObject(sim, Material.FLINT, 2400, 2400, 1, 0.1, 0.1);
  const hideId = store.id.data[hide];
  stepSim(sim, 45 * ticksPerDay);
  assert.equal(store.slotOf(hideId), -1, 'the hide has rotted away');
  assert.ok(store.isAlive(stick) && col(sim, 'integrity')[stick] < 1 && col(sim, 'integrity')[stick] > 0.3);
  assert.equal(col(sim, 'integrity')[stone], 1);
});

test('shelter: rock shelters and woods keep off weather; a pile of poles and hides does too, but only close by', () => {
  const sim = makeSim(3, 192, 1);
  const probe = createShelterProbe(sim);
  const out = new Float64Array(3);
  const shelters = sim.state.store(ROCK_SHELTER_STORE);
  const kind = shelters.column<Uint8Array>('kind').data;
  let cave = -1;
  for (let s = 0; s < shelters.highWater && cave < 0; s++) if (kind[s] === RockShelterKind.CAVE) cave = s;
  assert.ok(cave >= 0, 'this walled map has a cave');
  const cx = shelters.column<Float64Array>('x').data[cave];
  const cy = shelters.column<Float64Array>('y').data[cave];
  probe.at(cx, cy, out);
  assert.ok(out[0] >= 0.95 && out[1] >= 0.99 && out[2] >= 0.6, `in a cave: ${[...out]}`);

  // Bare ground with no rock shelter near: almost nothing.
  const tree = f32(sim, 'plants.nut.cover');
  const bush = f32(sim, 'plants.berry.cover');
  const reed = f32(sim, 'plants.reed.cover');
  let bare = -1;
  let wood = -1;
  for (let k = 0; k < tree.length; k++) {
    if (bare < 0 && tree[k] + bush[k] + reed[k] === 0) bare = k;
    if (wood < 0 || tree[k] > tree[wood]) wood = k;
  }
  const centre = (k: number) => [((k % 192) + 0.5) * 100, (Math.floor(k / 192) + 0.5) * 100] as const;
  const [bx, by] = centre(bare);
  probe.at(bx, by, out);
  const open = [...out];
  assert.ok(open[0] < 0.05 && open[1] < 0.05, `open ground: ${open}`);
  probe.at(...centre(wood), out);
  assert.ok(out[0] > 0.2 && out[0] > open[0], `in the woods: ${[...out]}`);

  // Hides alone on the ground keep off little rain: nothing holds them up.
  for (let n = 0; n < 4; n++) spawnObject(sim, Material.HIDE, bx + 0.5, by, 2.5, 1.5, 0);
  probe.at(bx, by, out);
  assert.ok(out[1] < 0.05, `hides alone: ${[...out]}`);
  // With twenty poles they make a screen and a roof.
  for (let n = 0; n < 20; n++) spawnObject(sim, Material.WOOD, bx - 1, by + 0.5, 8, 3, 0.05);
  probe.at(bx, by, out);
  assert.ok(out[0] > 0.5 && out[1] > 0.5 && out[2] > 0.3, `under a pile: ${[...out]}`);
  probe.at(bx + 10, by, out);
  assert.ok(out[0] < 0.05, `ten metres away: ${[...out]}`);
  // Held objects are not part of a pile.
  const holder = sim.state.store(OBJECT_STORE).column<Uint32Array>('holder').data;
  const store = sim.state.store(OBJECT_STORE);
  for (let s = 0; s < store.highWater; s++) holder[s] = 7;
  stepSim(sim, 1);
  probe.at(bx, by, out);
  assert.ok(out[0] < 0.05, `everything picked up: ${[...out]}`);
});

test('objects and loose material survive a save and load bit for bit', () => {
  const sim = makeSim(6, 64);
  const s = stream(5);
  const a = spawnObject(sim, Material.PYRITE, 300, 300, 0.4, 0.06, 0.05);
  const b = spawnObject(sim, Material.FLINT, 300, 300, 1, 0.12, 0.1);
  strikeObjects(sim, b, a, 25, 0.7, s, 0);
  spawnObject(sim, Material.HIDE, 310, 300, 2, 1.2, 0);
  stepSim(sim, 3 * sim.config.time.ticksPerDay);
  const copy = loadSim(saveSim(sim), SIM_PIPELINE);
  assert.equal(hashSim(copy), hashSim(sim));
  stepSim(sim, 5 * sim.config.time.ticksPerDay);
  stepSim(copy, 5 * copy.config.time.ticksPerDay);
  assert.equal(hashSim(copy), hashSim(sim));
});
