import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GLOBAL_STREAM_SLOTS,
  STREAM_WORDS,
  StreamDomain,
  globalStreamOffset,
  nextChance,
  nextFloat,
  nextInt,
  nextU32,
  seedStream,
} from '../../src/sim/core/rng.ts';

/** sfc32 written with arbitrary-precision integers, straight from its definition. */
function referenceSfc32(state: bigint[]): bigint {
  const mask = 0xffffffffn;
  const [a, b, c, d] = state;
  const t = (a + b + d) & mask;
  state[3] = (d + 1n) & mask;
  state[0] = b ^ (b >> 9n);
  state[1] = (c + (c << 3n)) & mask;
  state[2] = ((((c << 21n) | (c >> 11n)) & mask) + t) & mask;
  return t;
}

test('nextU32 matches the definition of sfc32', () => {
  const s = new Uint32Array([0x12345678, 0xdeadbeef, 0xfedcba98, 0xfffffff0]);
  const reference = Array.from(s, (word) => BigInt(word));
  for (let i = 0; i < 20_000; i++) {
    const got = nextU32(s, 0);
    const want = referenceSfc32(reference);
    assert.equal(BigInt(got), want, `draw ${i}`);
  }
});

test('a stream is a pure function of (seed, domain, id)', () => {
  const a = new Uint32Array(8);
  seedStream(a, 0, 42, StreamDomain.AGENT, 7);
  seedStream(a, 4, 42, StreamDomain.AGENT, 7);
  assert.deepEqual(a.subarray(0, 4), a.subarray(4, 8));
  for (let i = 0; i < 100; i++) assert.equal(nextU32(a, 0), nextU32(a, 4));
});

test('changing seed, domain, or id gives an unrelated stream', () => {
  const base = new Uint32Array(4);
  seedStream(base, 0, 42, StreamDomain.AGENT, 7);
  const first = Array.from({ length: 8 }, () => nextU32(base, 0));
  const variants: Array<[number, number, number]> = [
    [43, StreamDomain.AGENT, 7],
    [42, StreamDomain.CLIMATE, 7],
    [42, StreamDomain.AGENT, 8],
    [7, StreamDomain.AGENT, 42],
  ];
  for (const [seed, domain, id] of variants) {
    const s = new Uint32Array(4);
    seedStream(s, 0, seed, domain, id);
    const draws = Array.from({ length: 8 }, () => nextU32(s, 0));
    const shared = draws.filter((value, i) => value === first[i]).length;
    assert.equal(shared, 0, `stream (${seed}, ${domain}, ${id}) repeats draws of the base stream`);
  }
});

test('200,000 agent streams of one run are all different', () => {
  const s = new Uint32Array(4);
  const seen = new Set<string>();
  for (let id = 1; id <= 200_000; id++) {
    seedStream(s, 0, 123, StreamDomain.AGENT, id);
    seen.add(`${s[0]}:${s[1]}:${s[2]}`);
  }
  assert.equal(seen.size, 200_000);
});

test('nextFloat is uniform on [0, 1)', () => {
  const s = new Uint32Array(4);
  seedStream(s, 0, 1, StreamDomain.FIXTURE, 0);
  const buckets = new Array<number>(10).fill(0);
  let sum = 0;
  const n = 200_000;
  for (let i = 0; i < n; i++) {
    const v = nextFloat(s, 0);
    assert.ok(v >= 0 && v < 1);
    sum += v;
    buckets[Math.floor(v * 10)]++;
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.005, `mean ${sum / n}`);
  for (const count of buckets) assert.ok(Math.abs(count - n / 10) < n / 10 * 0.05, `bucket count ${count}`);
});

test('nextInt covers [0, n) evenly and rejects bad n', () => {
  const s = new Uint32Array(4);
  seedStream(s, 0, 2, StreamDomain.FIXTURE, 0);
  const counts = new Array<number>(7).fill(0);
  const n = 140_000;
  for (let i = 0; i < n; i++) counts[nextInt(s, 0, 7)]++;
  for (const count of counts) assert.ok(Math.abs(count - n / 7) < n / 7 * 0.05, `count ${count}`);
  assert.equal(nextInt(s, 0, 1), 0);
  for (let i = 0; i < 100; i++) {
    const v = nextInt(s, 0, 4294967296);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 4294967296);
  }
  assert.throws(() => nextInt(s, 0, 0));
  assert.throws(() => nextInt(s, 0, 2.5));
  assert.throws(() => nextInt(s, 0, 4294967297));
});

test('nextChance matches its probability', () => {
  const s = new Uint32Array(4);
  seedStream(s, 0, 3, StreamDomain.FIXTURE, 0);
  let hits = 0;
  const n = 200_000;
  for (let i = 0; i < n; i++) if (nextChance(s, 0, 0.25)) hits++;
  assert.ok(Math.abs(hits / n - 0.25) < 0.005, `rate ${hits / n}`);
  assert.equal(nextChance(s, 0, 0), false);
  assert.equal(nextChance(s, 0, 1), true);
});

test('run-wide stream slots do not overlap', () => {
  const offsets = Object.values(StreamDomain).map((domain) => globalStreamOffset(domain));
  assert.equal(new Set(offsets).size, offsets.length);
  for (const offset of offsets) assert.ok(offset + STREAM_WORDS <= GLOBAL_STREAM_SLOTS * STREAM_WORDS);
});
