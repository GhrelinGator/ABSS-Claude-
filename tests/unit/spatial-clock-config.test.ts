import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as clock from '../../src/sim/core/clock.ts';
import { StreamDomain, nextFloat, seedStream } from '../../src/sim/core/rng.ts';
import { BucketGrid } from '../../src/sim/core/spatial.ts';
import { canonicalJson, defaultConfig, validateConfig, worldHeightM, worldWidthM } from '../../src/sim/config.ts';
import { createSim, spawnAgent } from '../../src/sim/sim.ts';

test('bucket-grid queries match a brute-force search, in a fixed order', () => {
  const s = new Uint32Array(4);
  seedStream(s, 0, 5, StreamDomain.FIXTURE, 0);
  const n = 3_000;
  const width = 5_000;
  const height = 3_000;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const alive = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // Half the points sit in a tight cluster, so some buckets are crowded.
    const clustered = i % 2 === 0;
    x[i] = clustered ? 1_000 + nextFloat(s, 0) * 150 : nextFloat(s, 0) * width;
    y[i] = clustered ? 1_000 + nextFloat(s, 0) * 150 : nextFloat(s, 0) * height;
    alive[i] = nextFloat(s, 0) < 0.9 ? 1 : 0;
  }
  const grid = new BucketGrid(width, height, 200);
  grid.build(x, y, alive, n);
  const centres: Array<[number, number, number]> = [
    [1_075, 1_075, 120],
    [0, 0, 300],
    [width - 1, height - 1, 450],
    [2_500, 1_500, 1],
    [2_500, 1_500, 5_000],
    [-200, 1_000, 400],
  ];
  for (const [px, py, radius] of centres) {
    const expected: number[] = [];
    for (let i = 0; i < n; i++) {
      if (alive[i] !== 1) continue;
      const dx = x[i] - px;
      const dy = y[i] - py;
      if (dx * dx + dy * dy <= radius * radius) expected.push(i);
    }
    const found = grid.query(px, py, radius, x, y);
    const got = Array.from(grid.result.subarray(0, found));
    assert.deepEqual([...got].sort((a, b) => a - b), expected, `query (${px}, ${py}, ${radius})`);
    const again = grid.query(px, py, radius, x, y);
    assert.deepEqual(Array.from(grid.result.subarray(0, again)), got, 'query order must be repeatable');
  }
});

test('a rebuilt grid forgets entities that are gone', () => {
  const grid = new BucketGrid(1_000, 1_000, 100);
  const x = new Float64Array([50, 60, 950]);
  const y = new Float64Array([50, 60, 950]);
  grid.build(x, y, new Uint8Array([1, 1, 1]), 3);
  assert.equal(grid.query(55, 55, 20, x, y), 2);
  grid.build(x, y, new Uint8Array([1, 0, 1]), 3);
  assert.equal(grid.query(55, 55, 20, x, y), 1);
  assert.equal(grid.result[0], 0);
  grid.build(x, y, new Uint8Array([1, 1, 1]), 0);
  assert.equal(grid.query(55, 55, 2_000, x, y), 0);
});

test('calendar arithmetic follows the config', () => {
  const config = defaultConfig(1);
  assert.equal(clock.ticksPerYear(config), 144 * 48);
  assert.equal(clock.minutesPerTick(config), 10);
  assert.equal(clock.dayIndex(config, 0), 0);
  assert.equal(clock.dayIndex(config, 143), 0);
  assert.equal(clock.dayIndex(config, 144), 1);
  assert.equal(clock.tickOfDay(config, 144 + 72), 72);
  assert.equal(clock.dayFraction(config, 72), 0.5);
  assert.equal(clock.yearIndex(config, 144 * 48 - 1), 0);
  assert.equal(clock.yearIndex(config, 144 * 48), 1);
  assert.equal(clock.dayOfYear(config, 144 * 49), 1);
  assert.equal(clock.yearFraction(config, 144 * 24), 0.5);
});

test('config validation is strict', () => {
  const good = defaultConfig(7);
  assert.equal(good.seed, 7);
  assert.equal(worldWidthM(good), 51_200);
  assert.equal(worldHeightM(good), 51_200);
  assert.ok(Object.isFrozen(good) && Object.isFrozen(good.time) && Object.isFrozen(good.world));
  const copy = JSON.parse(JSON.stringify(good));
  assert.deepEqual(validateConfig(copy), good);

  assert.throws(() => validateConfig({ ...copy, sead: 3 }), /unknown key "config.sead"/);
  assert.throws(() => validateConfig({ ...copy, time: { ...copy.time, tickPerDay: 1 } }), /unknown key/);
  assert.throws(() => validateConfig({ seed: 1, time: copy.time }), /missing key "config.world"/);
  assert.throws(() => validateConfig({ ...copy, seed: -1 }), /config.seed/);
  assert.throws(() => validateConfig({ ...copy, seed: 1.5 }), /config.seed/);
  assert.throws(() => validateConfig({ ...copy, seed: 2 ** 32 }), /config.seed/);
  assert.throws(() => validateConfig({ ...copy, world: { ...copy.world, cellSizeM: 0 } }), /cellSizeM/);
  assert.throws(() => validateConfig(null), /must be an object/);
  assert.throws(() => validateConfig([1, 2]), /must be an object/);
});

test('canonical JSON does not depend on key order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 2, { z: 1, y: 2 }], c: 'x' } }), '{"a":{"c":"x","d":[1,2,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.throws(() => canonicalJson({ a: Number.NaN }));
  assert.throws(() => canonicalJson({ a: undefined }));
});

test('spawnAgent refuses positions outside the world', () => {
  const sim = createSim(defaultConfig(1), []);
  assert.throws(() => spawnAgent(sim, -1, 10), /outside the world/);
  assert.throws(() => spawnAgent(sim, 10, 51_200), /outside the world/);
  assert.throws(() => spawnAgent(sim, Number.NaN, 10), /outside the world/);
  const slot = spawnAgent(sim, 10, 20);
  assert.equal(sim.state.agents.column('x').data[slot], 10);
  assert.equal(sim.state.agents.column('spawnTick').data[slot], 0);
});
