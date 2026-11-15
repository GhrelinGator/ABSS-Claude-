import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteSink, Source } from '../../src/sim/core/codec.ts';
import { GridLayers } from '../../src/sim/core/grid.ts';
import { EntityStore } from '../../src/sim/core/store.ts';

function makeStore(): EntityStore {
  const store = new EntityStore('things');
  store.ensureColumn({ name: 'mass', dtype: 'f64', category: 'body' });
  store.ensureColumn({ name: 'tags', dtype: 'u16', category: 'learned', width: 3 });
  return store;
}

test('spawn hands out the lowest free slot and a fresh id', () => {
  const store = makeStore();
  const slots = [store.spawn(), store.spawn(), store.spawn(), store.spawn()];
  assert.deepEqual(slots, [0, 1, 2, 3]);
  assert.deepEqual(Array.from(store.id.data.subarray(0, 4)), [1, 2, 3, 4]);
  store.remove(1);
  store.remove(2);
  assert.equal(store.count, 2);
  assert.equal(store.spawn(), 1);
  assert.equal(store.spawn(), 2);
  assert.equal(store.spawn(), 4);
  assert.deepEqual(Array.from(store.id.data.subarray(0, 5)), [1, 5, 6, 4, 7]);
  assert.equal(store.slotOf(5), 1);
  assert.equal(store.slotOf(2), -1);
  assert.equal(store.slotOf(999), -1);
});

test('highWater shrinks when the top slots are released', () => {
  const store = makeStore();
  for (let i = 0; i < 5; i++) store.spawn();
  store.remove(3);
  assert.equal(store.highWater, 5);
  store.remove(4);
  assert.equal(store.highWater, 3);
  store.remove(0);
  assert.equal(store.highWater, 3);
  assert.throws(() => store.remove(0), /not alive/);
  assert.throws(() => store.remove(77), /not alive/);
});

test('a slot is wiped when released and when assigned', () => {
  const store = makeStore();
  const cleared: number[] = [];
  store.onClear((slot) => cleared.push(slot));
  const slot = store.spawn();
  const mass = store.column<Float64Array>('mass');
  const tags = store.column<Uint16Array>('tags');
  mass.data[slot] = 12.5;
  tags.data.set([7, 8, 9], slot * 3);
  store.remove(slot);
  assert.equal(mass.data[slot], 0);
  assert.deepEqual(Array.from(tags.data.subarray(0, 3)), [0, 0, 0]);
  assert.equal(store.alive.data[slot], 0);
  assert.equal(store.id.data[slot], 0);
  assert.equal(store.spawn(), slot);
  assert.deepEqual(cleared, [0, 0, 0]);
});

test('the store grows past its initial capacity and keeps its contents', () => {
  const store = makeStore();
  const before = store.capacity;
  const mass = store.column<Float64Array>('mass');
  for (let i = 0; i < before * 2 + 10; i++) {
    const slot = store.spawn();
    mass.data[slot] = i + 0.5;
  }
  assert.ok(store.capacity >= before * 2 + 10);
  assert.ok(store.layoutVersion >= 2);
  assert.equal(store.count, before * 2 + 10);
  for (let i = 0; i < store.count; i++) assert.equal(mass.data[i], i + 0.5);
});

test('columns can be shared by identical declarations but not redefined', () => {
  const store = makeStore();
  const again = store.ensureColumn({ name: 'mass', dtype: 'f64', category: 'body' });
  assert.equal(again, store.column('mass'));
  assert.throws(() => store.ensureColumn({ name: 'mass', dtype: 'f32', category: 'body' }), /different layouts/);
  assert.throws(() => store.ensureColumn({ name: 'mass', dtype: 'f64', category: 'learned' }), /different layouts/);
  assert.throws(() => store.ensureColumn({ name: 'Bad Name', dtype: 'f64', category: 'body' }), /Invalid column name/);
  assert.throws(() => store.column('missing'), /no column/);
  store.seal();
  assert.equal(store.ensureColumn({ name: 'mass', dtype: 'f64', category: 'body' }), again);
  assert.throws(() => store.ensureColumn({ name: 'late', dtype: 'f64', category: 'body' }), /sealed/);
});

test('a store survives a write/read round trip, including into a smaller store', () => {
  const store = makeStore();
  const mass = store.column<Float64Array>('mass');
  for (let i = 0; i < 700; i++) mass.data[store.spawn()] = i * 1.25;
  for (let slot = 10; slot < 500; slot += 3) store.remove(slot);
  const sink = new ByteSink();
  store.write(sink);
  const bytes = sink.bytes();

  const copy = makeStore();
  copy.read(new Source(bytes));
  assert.equal(copy.count, store.count);
  assert.equal(copy.highWater, store.highWater);
  assert.equal(copy.nextId, store.nextId);
  for (let slot = 0; slot < store.highWater; slot++) {
    assert.equal(copy.isAlive(slot), store.isAlive(slot));
    assert.equal(copy.column('mass').data[slot], mass.data[slot]);
    if (store.isAlive(slot)) assert.equal(copy.slotOf(store.id.data[slot]), slot);
  }
  assert.equal(copy.spawn(), store.spawn(), 'both should reuse the same free slot next');
  const resaved = new ByteSink();
  copy.write(resaved);
  const original = new ByteSink();
  store.write(original);
  assert.deepEqual(resaved.bytes(), original.bytes());
});

test('reading into a store with a different layout fails', () => {
  const store = makeStore();
  store.spawn();
  const sink = new ByteSink();
  store.write(sink);
  const other = new EntityStore('things');
  other.ensureColumn({ name: 'mass', dtype: 'f64', category: 'body' });
  assert.throws(() => other.read(new Source(sink.bytes())), /columns/);
  const renamed = new EntityStore('things');
  renamed.ensureColumn({ name: 'weight', dtype: 'f64', category: 'body' });
  renamed.ensureColumn({ name: 'tags', dtype: 'u16', category: 'learned', width: 3 });
  assert.throws(() => renamed.read(new Source(sink.bytes())), /does not match/);
});

test('grid layers round-trip and refuse mismatched grids', () => {
  const grid = new GridLayers(8, 4);
  const elevation = grid.ensureLayer<Float32Array>('elevation', 'f32');
  const soil = grid.ensureLayer<Uint8Array>('soil', 'u8');
  assert.equal(elevation.length, 32);
  elevation[5] = 12.5;
  soil[31] = 3;
  assert.equal(grid.ensureLayer('elevation', 'f32'), elevation);
  assert.throws(() => grid.ensureLayer('elevation', 'f64'), /different element types/);
  grid.seal();
  assert.throws(() => grid.ensureLayer('late', 'u8'), /sealed/);

  const sink = new ByteSink();
  grid.write(sink);
  const copy = new GridLayers(8, 4);
  copy.ensureLayer('elevation', 'f32');
  copy.ensureLayer('soil', 'u8');
  copy.read(new Source(sink.bytes()));
  assert.equal(copy.layer<Float32Array>('elevation')[5], 12.5);
  assert.equal(copy.layer<Uint8Array>('soil')[31], 3);
  assert.deepEqual(copy.layerNames(), ['elevation', 'soil']);

  const wrongSize = new GridLayers(4, 8);
  wrongSize.ensureLayer('elevation', 'f32');
  wrongSize.ensureLayer('soil', 'u8');
  assert.throws(() => wrongSize.read(new Source(sink.bytes())), /does not match/);
});
