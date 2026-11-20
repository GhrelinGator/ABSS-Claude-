// Bucket grids for "what is near this point?" queries.
//
// These are derived caches (docs/DESIGN.md §1.5): rebuilt from positions whenever they are needed
// and never part of saved or hashed state.
//
// Entities are kept sorted by bucket row and, inside a row, by a key that grows with x (the bucket
// column for BucketGrid, x itself for NeighbourGrid); a query binary-searches each row it covers.
// Memory and the cost of a build grow with the number of entities and of rows, not with the area of
// the map (3.2, DESIGN.md §4.8 rule 3). The first version kept two arrays with one entry per bucket of
// the whole map and cleared them at every build: 65,536 entries for 200 m buckets on the default map,
// 26 million for the 10 m buckets that find lying objects.
//
// Results come back in a fixed order: bucket rows from low y to high y, buckets from low x to high x,
// and inside a bucket by slot (BucketGrid) or by x, then slot (NeighbourGrid).

/** Entities sorted by row, then by key, then by slot: a counting sort by row, insertion by key inside it. */
class Rows {
  readonly rows: number;
  /** Row r's items are items[start[r] .. start[r + 1]). */
  readonly start: Int32Array;
  private readonly cursor: Int32Array;
  items: Int32Array = new Int32Array(256);
  /** The sort key of each item, in item order. */
  key: Float64Array = new Float64Array(256);

  constructor(rows: number) {
    this.rows = rows;
    this.start = new Int32Array(rows + 1);
    this.cursor = new Int32Array(rows);
  }

  /** Sort the n slots in `slots` (ascending) by rowOf[slot], then keyOf[slot]; ties keep slot order. */
  build(slots: Int32Array, n: number, rowOf: Int32Array, keyOf: Float64Array): void {
    if (this.items.length < n) {
      let capacity = this.items.length;
      while (capacity < n) capacity *= 2;
      this.items = new Int32Array(capacity);
      this.key = new Float64Array(capacity);
    }
    const { start, cursor, rows, items, key } = this;
    start.fill(0);
    for (let q = 0; q < n; q++) start[rowOf[slots[q]] + 1]++;
    for (let r = 0; r < rows; r++) {
      start[r + 1] += start[r];
      cursor[r] = start[r];
    }
    for (let q = 0; q < n; q++) {
      const slot = slots[q];
      const r = rowOf[slot];
      const v = keyOf[slot];
      const lo = start[r];
      let k = cursor[r]++;
      while (k > lo && key[k - 1] > v) {
        items[k] = items[k - 1];
        key[k] = key[k - 1];
        k--;
      }
      items[k] = slot;
      key[k] = v;
    }
  }

  /** First item of row r whose key is at least v. */
  firstAtLeast(r: number, v: number): number {
    const key = this.key;
    let lo = this.start[r];
    let hi = this.start[r + 1];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (key[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

function clampIndex(v: number, size: number, count: number): number {
  const i = Math.floor(v / size);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

function grown(result: Int32Array): Int32Array {
  const bigger = new Int32Array(result.length * 2);
  bigger.set(result);
  return bigger;
}

export class BucketGrid {
  readonly bucketSize: number;
  readonly columns: number;
  readonly rows: number;
  /** Slots found by the most recent query. Only the first `n` entries are meaningful, where `n` is what query returned. */
  result: Int32Array = new Int32Array(64);

  private readonly sorted: Rows;
  private slots: Int32Array = new Int32Array(256);
  private rowOf: Int32Array = new Int32Array(256);
  private columnOf: Float64Array = new Float64Array(256);

  /** Covers the rectangle [0, width) x [0, height) with square buckets of side `bucketSize`. */
  constructor(width: number, height: number, bucketSize: number) {
    if (!(width > 0 && height > 0 && bucketSize > 0)) throw new RangeError('BucketGrid needs positive dimensions.');
    this.bucketSize = bucketSize;
    this.columns = Math.max(1, Math.ceil(width / bucketSize));
    this.rows = Math.max(1, Math.ceil(height / bucketSize));
    this.sorted = new Rows(this.rows);
  }

  /** Index every live slot in [0, highWater) by its position. */
  build(x: ArrayLike<number>, y: ArrayLike<number>, alive: ArrayLike<number>, highWater: number): void {
    if (this.rowOf.length < highWater) {
      let capacity = this.rowOf.length;
      while (capacity < highWater) capacity *= 2;
      this.rowOf = new Int32Array(capacity);
      this.columnOf = new Float64Array(capacity);
      this.slots = new Int32Array(capacity);
    }
    const { rowOf, columnOf, slots, columns, rows, bucketSize } = this;
    let n = 0;
    for (let slot = 0; slot < highWater; slot++) {
      if (alive[slot] !== 1) continue;
      rowOf[slot] = clampIndex(y[slot], bucketSize, rows);
      columnOf[slot] = clampIndex(x[slot], bucketSize, columns);
      slots[n++] = slot;
    }
    this.sorted.build(slots, n, rowOf, columnOf);
  }

  /**
   * Collect every indexed slot within `radius` of (px, py), using the same
   * position arrays the index was built from. Returns the number found; the
   * slots are in `this.result`. Nothing is left out however many there are.
   */
  query(px: number, py: number, radius: number, x: ArrayLike<number>, y: ArrayLike<number>): number {
    const { columns, rows, bucketSize, sorted } = this;
    let bx0 = Math.floor((px - radius) / bucketSize);
    let bx1 = Math.floor((px + radius) / bucketSize);
    let by0 = Math.floor((py - radius) / bucketSize);
    let by1 = Math.floor((py + radius) / bucketSize);
    if (bx0 < 0) bx0 = 0;
    if (by0 < 0) by0 = 0;
    if (bx1 >= columns) bx1 = columns - 1;
    if (by1 >= rows) by1 = rows - 1;
    const r2 = radius * radius;
    const { items, key, start } = sorted;
    let result = this.result;
    let n = 0;
    for (let by = by0; by <= by1; by++) {
      const end = start[by + 1];
      for (let k = sorted.firstAtLeast(by, bx0); k < end && key[k] <= bx1; k++) {
        const slot = items[k];
        const dx = x[slot] - px;
        const dy = y[slot] - py;
        if (dx * dx + dy * dy <= r2) {
          if (n === result.length) this.result = result = grown(result);
          result[n++] = slot;
        }
      }
    }
    return n;
  }
}

/**
 * A bucket grid built from its own copy of the positions, so a query reads them as they were when
 * the grid was built however the entities move afterwards (the decide phase reads tick-start state,
 * §1.6), with each bucket sorted by x so a small query in a crowded bucket binary-searches instead of
 * scanning it (DESIGN.md §4.8, rule 3).
 */
export class NeighbourGrid {
  readonly bucketSize: number;
  readonly columns: number;
  readonly rows: number;
  /** Slots found by the most recent query; only the first `n` are meaningful, where `n` is what query returned. */
  result: Int32Array = new Int32Array(64);
  /** Positions as copied at the last build, by slot. */
  x: Float64Array = new Float64Array(256);
  y: Float64Array = new Float64Array(256);
  /** Entities indexed at the last build. */
  count = 0;

  private readonly sorted: Rows;
  private slots: Int32Array = new Int32Array(256);
  private rowOf: Int32Array = new Int32Array(256);

  constructor(width: number, height: number, bucketSize: number) {
    if (!(width > 0 && height > 0 && bucketSize > 0)) throw new RangeError('NeighbourGrid needs positive dimensions.');
    this.bucketSize = bucketSize;
    this.columns = Math.max(1, Math.ceil(width / bucketSize));
    this.rows = Math.max(1, Math.ceil(height / bucketSize));
    this.sorted = new Rows(this.rows);
  }

  /** Index every slot in [0, highWater) for which `keep(slot)` is true, copying its position now. */
  build(x: ArrayLike<number>, y: ArrayLike<number>, highWater: number, keep: (slot: number) => boolean): void {
    if (this.x.length < highWater) {
      let capacity = this.x.length;
      while (capacity < highWater) capacity *= 2;
      this.x = new Float64Array(capacity);
      this.y = new Float64Array(capacity);
      this.rowOf = new Int32Array(capacity);
      this.slots = new Int32Array(capacity);
    }
    const { rowOf, slots, rows, bucketSize } = this;
    const cx = this.x;
    const cy = this.y;
    let n = 0;
    for (let slot = 0; slot < highWater; slot++) {
      if (!keep(slot)) continue;
      cx[slot] = x[slot];
      cy[slot] = y[slot];
      rowOf[slot] = clampIndex(cy[slot], bucketSize, rows);
      slots[n++] = slot;
    }
    this.count = n;
    // Inside a row by x: the bucket column only grows with x, so this is bucket order too.
    this.sorted.build(slots, n, rowOf, cx);
  }

  /** Every indexed slot within `radius` of (px, py), by the copied positions. Returns how many; the slots are in `this.result`. */
  query(px: number, py: number, radius: number): number {
    const { rows, bucketSize, sorted } = this;
    const cx = this.x;
    const cy = this.y;
    let by0 = Math.floor((py - radius) / bucketSize);
    let by1 = Math.floor((py + radius) / bucketSize);
    if (by0 < 0) by0 = 0;
    if (by1 >= rows) by1 = rows - 1;
    const r2 = radius * radius;
    const xhi = px + radius;
    const { items, key, start } = sorted;
    let result = this.result;
    let n = 0;
    for (let by = by0; by <= by1; by++) {
      const end = start[by + 1];
      for (let k = sorted.firstAtLeast(by, px - radius); k < end && key[k] <= xhi; k++) {
        const slot = items[k];
        const dx = cx[slot] - px;
        const dy = cy[slot] - py;
        if (dx * dx + dy * dy <= r2) {
          if (n === result.length) this.result = result = grown(result);
          result[n++] = slot;
        }
      }
    }
    return n;
  }
}
