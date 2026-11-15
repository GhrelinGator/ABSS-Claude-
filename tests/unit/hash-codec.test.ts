import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteSink, HashSink, Source, hashEncodedBytes } from '../../src/sim/core/codec.ts';
import type { Sink } from '../../src/sim/core/codec.ts';
import { Hasher } from '../../src/sim/core/hash.ts';

function writeSample(sink: Sink): void {
  sink.u32(0);
  sink.u32(0xffffffff);
  sink.f64(-0);
  sink.f64(Math.PI);
  sink.f64(1e300);
  sink.str('');
  sink.str('agents.x');
  sink.str('naïve — 混合 🌋');
  sink.array(new Uint8Array([1, 2, 3, 4, 5]));
  sink.array(new Int8Array([-1, 2, -3]));
  sink.array(new Uint16Array([65535, 1, 2]));
  sink.array(new Int16Array([-32768]));
  sink.array(new Uint32Array([4294967295, 7]));
  sink.array(new Int32Array([-2147483648, 5, 6]));
  sink.array(new Float32Array([1.5, -2.25, 0]));
  sink.array(new Float64Array([Math.E, -1 / 3]));
  sink.array(new Float64Array(0));
  sink.array(new Float64Array([1, 2, 3, 4]).subarray(1, 3));
  sink.array(new Uint8Array([9, 8, 7, 6, 5, 4, 3]).subarray(1, 6));
}

test('everything a ByteSink writes can be read back', () => {
  const sink = new ByteSink();
  writeSample(sink);
  const bytes = sink.bytes();
  assert.equal(bytes.length % 4, 0);
  const source = new Source(bytes);
  assert.equal(source.u32(), 0);
  assert.equal(source.u32(), 0xffffffff);
  assert.ok(Object.is(source.f64(), -0));
  assert.equal(source.f64(), Math.PI);
  assert.equal(source.f64(), 1e300);
  assert.equal(source.str(), '');
  assert.equal(source.str(), 'agents.x');
  assert.equal(source.str(), 'naïve — 混合 🌋');
  assert.deepEqual(source.array('u8'), new Uint8Array([1, 2, 3, 4, 5]));
  assert.deepEqual(source.array('i8'), new Int8Array([-1, 2, -3]));
  assert.deepEqual(source.array('u16'), new Uint16Array([65535, 1, 2]));
  assert.deepEqual(source.array('i16'), new Int16Array([-32768]));
  assert.deepEqual(source.array('u32'), new Uint32Array([4294967295, 7]));
  assert.deepEqual(source.array('i32'), new Int32Array([-2147483648, 5, 6]));
  assert.deepEqual(source.array('f32'), new Float32Array([1.5, -2.25, 0]));
  assert.deepEqual(source.array('f64'), new Float64Array([Math.E, -1 / 3]));
  assert.deepEqual(source.array('f64'), new Float64Array(0));
  assert.deepEqual(source.array('f64'), new Float64Array([2, 3]));
  assert.deepEqual(source.array('u8'), new Uint8Array([8, 7, 6, 5, 4]));
  assert.ok(source.done);
});

test('a HashSink hashes exactly the bytes a ByteSink stores', () => {
  const direct = new Hasher();
  writeSample(new HashSink(direct));
  const sink = new ByteSink();
  writeSample(sink);
  const viaBytes = new Hasher();
  hashEncodedBytes(viaBytes, sink.bytes());
  assert.equal(direct.digest(), viaBytes.digest());
  assert.match(direct.digest(), /^[0-9a-f]{32}$/);
});

test('reading the wrong element type or past the end fails loudly', () => {
  const sink = new ByteSink();
  sink.array(new Float64Array([1, 2]));
  assert.throws(() => new Source(sink.bytes()).array('f32'), /element type/);
  assert.throws(() => new Source(sink.bytes().subarray(0, 12)).array('f64'), /ended unexpectedly/);
});

test('sinks refuse values that have no canonical form', () => {
  for (const make of [() => new ByteSink(), () => new HashSink(new Hasher())]) {
    assert.throws(() => make().u32(-1));
    assert.throws(() => make().u32(1.5));
    assert.throws(() => make().u32(2 ** 32));
    assert.throws(() => make().f64(Number.NaN));
    assert.throws(() => make().f64(Number.POSITIVE_INFINITY));
  }
});

test('a large write grows the buffer without corrupting it', () => {
  const big = new Float64Array(50_000);
  for (let i = 0; i < big.length; i++) big[i] = i * 0.5;
  const sink = new ByteSink();
  sink.str('before');
  sink.array(big);
  sink.str('after');
  const source = new Source(sink.bytes());
  assert.equal(source.str(), 'before');
  assert.deepEqual(source.array('f64'), big);
  assert.equal(source.str(), 'after');
  assert.ok(source.done);
});

function digestOf(words: number[]): string {
  const hasher = new Hasher();
  for (const word of words) hasher.u32(word);
  return hasher.digest();
}

test('the hash depends on every word, on order, and on length', () => {
  const base = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const seen = new Set<string>([digestOf(base)]);
  for (let i = 0; i < base.length; i++) {
    for (let bit = 0; bit < 32; bit += 5) {
      const changed = base.slice();
      changed[i] = (changed[i] ^ (1 << bit)) >>> 0;
      seen.add(digestOf(changed));
    }
  }
  seen.add(digestOf([2, 1, 3, 4, 5, 6, 7, 8, 9]));
  seen.add(digestOf(base.slice(0, 8)));
  seen.add(digestOf([...base, 0]));
  seen.add(digestOf([]));
  seen.add(digestOf([0]));
  seen.add(digestOf([0, 0]));
  assert.equal(seen.size, 1 + base.length * 7 + 6);
});

test('hashing word by word equals hashing in bulk, whatever the alignment', () => {
  const words = new Uint32Array(1_003);
  for (let i = 0; i < words.length; i++) words[i] = Math.imul(i + 1, 0x9e3779b1) >>> 0;
  const oneByOne = new Hasher();
  for (const word of words) oneByOne.u32(word);
  for (const lead of [0, 1, 2, 3, 5]) {
    const mixed = new Hasher();
    for (let i = 0; i < lead; i++) mixed.u32(words[i]);
    mixed.words(words.subarray(lead, 700));
    mixed.words(words.subarray(700));
    assert.equal(mixed.digest(), oneByOne.digest(), `lead ${lead}`);
  }
  assert.equal(oneByOne.digest(), oneByOne.digest(), 'digest must be repeatable');
});

test('hash bits look balanced over many inputs', () => {
  const ones = new Array<number>(128).fill(0);
  const n = 4_000;
  for (let i = 0; i < n; i++) {
    const hex = digestOf([i]);
    for (let nibble = 0; nibble < 32; nibble++) {
      const value = Number.parseInt(hex[nibble], 16);
      for (let bit = 0; bit < 4; bit++) if (value & (1 << bit)) ones[nibble * 4 + bit]++;
    }
  }
  for (let bit = 0; bit < 128; bit++) {
    assert.ok(Math.abs(ones[bit] / n - 0.5) < 0.05, `bit ${bit} is set ${ones[bit]} times out of ${n}`);
  }
});
