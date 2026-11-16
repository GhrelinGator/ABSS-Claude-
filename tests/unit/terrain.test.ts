// The map generator (docs/DESIGN.md §2.10): structural invariants of the
// landscape, and the circumscription manipulation check.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeLandscape } from '../../src/analysis/index.ts';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { viewOf } from '../../src/sim/readonly.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { Soil, TERRAIN_CONSTANTS, TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

function config(seed: number, circumscription: number, cells = 512) {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.circumscription = circumscription;
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  return validateConfig(raw);
}

function layers(sim: Sim) {
  const w = sim.state.world;
  return {
    elevation: w.layer<Float32Array>(TERRAIN_LAYERS.elevation),
    rainfall: w.layer<Float32Array>(TERRAIN_LAYERS.rainfall),
    soil: w.layer<Uint8Array>(TERRAIN_LAYERS.soil),
    kind: w.layer<Uint8Array>(TERRAIN_LAYERS.waterKind),
    depth: w.layer<Float32Array>(TERRAIN_LAYERS.waterDepth),
    drain: w.layer<Int32Array>(TERRAIN_LAYERS.drain),
    flow: w.layer<Float32Array>(TERRAIN_LAYERS.flow),
  };
}

// Small maps for the structural checks, full-size ones for the manipulation check.
const SMALL: Array<[number, number]> = [
  [1, 0],
  [2, 0.5],
  [3, 1],
  [4, 0.8],
];

for (const [seed, c] of SMALL) {
  const W = 160;
  const sim = createSim(config(seed, c, W), SIM_PIPELINE);
  const L = layers(sim);
  const N = W * W;

  test(`seed ${seed}, circumscription ${c}: every value is finite and in range`, () => {
    for (let k = 0; k < N; k++) {
      assert.ok(Number.isFinite(L.elevation[k]));
      assert.ok(L.rainfall[k] >= TERRAIN_CONSTANTS.minRainfall && L.rainfall[k] < 3);
      assert.ok(L.soil[k] <= Soil.SAND);
      assert.ok(L.kind[k] <= Water.LAKE);
      assert.ok(L.flow[k] >= 0 && Number.isFinite(L.flow[k]));
      assert.ok(L.depth[k] >= 0);
    }
  });

  test(`seed ${seed}, circumscription ${c}: every cell drains off the map through its neighbours`, () => {
    for (let k = 0; k < N; k++) {
      const down = L.drain[k];
      const i = k % W;
      const j = (k - i) / W;
      if (down === -1) {
        assert.ok(i === 0 || j === 0 || i === W - 1 || j === W - 1, `interior cell ${k} drains off the map`);
        continue;
      }
      const di = (down % W) - i;
      const dj = Math.floor(down / W) - j;
      assert.ok(Math.abs(di) <= 1 && Math.abs(dj) <= 1 && down !== k, `cell ${k} drains to a non-neighbour`);
    }
    // Following the drains from any cell ends at the map edge without looping.
    const state = new Uint8Array(N); // 0 unknown, 1 on current path, 2 known to reach the edge
    for (let start = 0; start < N; start++) {
      const path: number[] = [];
      let k = start;
      while (k !== -1 && state[k] === 0) {
        state[k] = 1;
        path.push(k);
        k = L.drain[k];
      }
      assert.ok(k === -1 || state[k] === 2, `drainage loops at cell ${k}`);
      for (const p of path) state[p] = 2;
    }
  });

  test(`seed ${seed}, circumscription ${c}: flow never shrinks downstream, and rivers lead somewhere`, () => {
    for (let k = 0; k < N; k++) {
      const down = L.drain[k];
      if (down < 0) continue;
      assert.ok(L.flow[down] >= L.flow[k], `flow drops from ${L.flow[k]} to ${L.flow[down]}`);
      if (L.kind[k] === Water.RIVER || L.kind[k] === Water.SPRING) {
        assert.ok(L.kind[down] === Water.RIVER || L.kind[down] === Water.LAKE, `a river at ${k} runs into dry land`);
      }
      if (L.kind[k] === Water.RIVER || L.kind[k] === Water.LAKE) {
        assert.notEqual(L.kind[down], Water.SPRING, 'water drains into a spring');
      }
    }
  });

  test(`seed ${seed}, circumscription ${c}: lakes have depth and nothing else does`, () => {
    for (let k = 0; k < N; k++) {
      if (L.kind[k] === Water.LAKE) assert.ok(L.depth[k] >= TERRAIN_CONSTANTS.lakeMinDepthM);
      else assert.equal(L.depth[k], 0);
    }
  });
}

test('the same seed and settings always give the same landscape; another seed gives another', () => {
  const a = createSim(config(5, 0.7, 128), SIM_PIPELINE);
  const b = createSim(config(5, 0.7, 128), SIM_PIPELINE);
  const other = createSim(config(6, 0.7, 128), SIM_PIPELINE);
  assert.equal(hashSim(a), hashSim(b));
  assert.deepEqual(layers(a).elevation, layers(b).elevation);
  assert.notDeepEqual(layers(a).elevation, layers(other).elevation);
});

test('a loaded snapshot keeps its landscape, and setup steps run only for fresh sims', () => {
  let setups = 0;
  // ALIBI: test fixture; counts how often the kernel runs setup steps.
  const counter = defineSystem({ name: 'fixture.setupCounter', create: () => () => {}, init: () => setups++ });
  const pipeline = [...SIM_PIPELINE, counter];
  const sim = createSim(config(9, 0.4, 128), pipeline);
  assert.equal(setups, 1);
  stepSim(sim, 50);
  const restored = loadSim(saveSim(sim), pipeline);
  assert.equal(setups, 1, 'loading must not run setup again');
  assert.equal(hashSim(restored), hashSim(sim));
  assert.deepEqual(layers(restored).flow, layers(sim).flow);
});

test('a setup step may not create agents', () => {
  // ALIBI: test fixture; a setup step that breaks the rule.
  const spawner = defineSystem({ name: 'fixture.setupSpawner', create: () => () => {}, init: (s) => void spawnAgent(s, 10, 10) });
  assert.throws(() => createSim(config(1, 0, 64), [spawner]), /spawned agents/);
});

test('circumscription is validated', () => {
  const raw = JSON.parse(JSON.stringify(defaultConfig(1)));
  for (const bad of [-0.1, 1.5, Number.NaN, '0.5']) {
    raw.world.circumscription = bad;
    assert.throws(() => validateConfig(raw), /circumscription/);
  }
});

test('manipulation check: habitable land shrinks and is walled in as circumscription rises', () => {
  const settings = [0, 0.5, 0.75, 1];
  for (const seed of [1, 2, 3]) {
    const summaries = settings.map((c) => summarizeLandscape(viewOf(createSim(config(seed, c), SIM_PIPELINE))));
    const habitable = summaries.map((s) => s.habitableFraction);
    for (let k = 1; k < habitable.length; k++) {
      assert.ok(habitable[k] <= habitable[k - 1] + 0.03, `seed ${seed}: habitable land grew from ${habitable[k - 1]} to ${habitable[k]}`);
    }
    const open = summaries[0];
    const walled = summaries[summaries.length - 1];
    assert.ok(open.habitableFraction >= 0.9, `seed ${seed}: open country is only ${open.habitableFraction} habitable`);
    assert.ok(walled.habitableFraction <= 0.45, `seed ${seed}: walled valley leaves ${walled.habitableFraction} habitable`);
    assert.ok(walled.largestRegionShare >= 0.85, `seed ${seed}: habitable land is split (${walled.largestRegionShare})`);
    assert.ok(walled.enclosedEdgePerCell > open.enclosedEdgePerCell + 0.005, `seed ${seed}: the valley is not walled in`);
    assert.ok(walled.riverFraction > 0, `seed ${seed}: the walled valley has no river`);
  }
});
