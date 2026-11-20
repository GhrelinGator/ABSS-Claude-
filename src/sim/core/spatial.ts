// Uniform bucket grid for "what is near this point?" queries.
//
// This is a derived cache (docs/DESIGN.md §1.5): it is rebuilt from positions
// whenever it is needed and is never part of saved or hashed state.
//
// Results come back in a fixed order (bucket rows from low y to high y,
// buckets from low x to high x, slots ascending inside a bucket), so anything
// computed from a query is reproducible.

export class BucketGrid {
  readonly bucketSize: number;
  readonly columns: number;
  readonly rows: number;
  /** Slots found by the most recent query. Only the first `n` entries are meaningful, where `n` is what query returned. */
  result: Int32Array = new Int32Array(64);

  private readonly start: Int32Array;
  private readonly cursor: Int32Array;
  private items: Int32Array = new Int32Array(256);
  private bucketOf: Int32Array = new Int32Array(256);

  /** Covers the rectangle [0, width) x [0, height) with square buckets of side `bucketSize`. */
  constructor(width: number, height: number, bucketSize: number) {
    if (!(width > 0 && height > 0 && bucketSize > 0)) throw new RangeError('BucketGrid needs positive dimensions.');
    this.bucketSize = bucketSize;
    this.columns = Math.max(1, Math.ceil(width / bucketSize));
    this.rows = Math.max(1, Math.ceil(height / bucketSize));
    this.start = new Int32Array(this.columns * this.rows + 1);
    this.cursor = new Int32Array(this.columns * this.rows);
  }

  /** Index every live slot in [0, highWater) by its position. */
  build(x: ArrayLike<number>, y: ArrayLike<number>, alive: ArrayLike<number>, highWater: number): void {
    if (this.bucketOf.length < highWater) {
      let capacity = this.bucketOf.length;
      while (capacity < highWater) capacity *= 2;
      this.bucketOf = new Int32Array(capacity);
      this.items = new Int32Array(capacity);
    }
    const { start, cursor, bucketOf, columns, rows, bucketSize } = this;
    start.fill(0);
    for (let slot = 0; slot < highWater; slot++) {
      if (alive[slot] !== 1) continue;
      let bx = Math.floor(x[slot] / bucketSize);
      let by = Math.floor(y[slot] / bucketSize);
      if (bx < 0) bx = 0;
      else if (bx >= columns) bx = columns - 1;
      if (by < 0) by = 0;
      else if (by >= rows) by = rows - 1;
      const bucket = by * columns + bx;
      bucketOf[slot] = bucket;
      start[bucket + 1]++;
    }
    const nbuckets = columns * rows;
    for (let b = 0; b < nbuckets; b++) {
      start[b + 1] += start[b];
      cursor[b] = start[b];
    }
    const items = this.items;
    for (let slot = 0; slot < highWater; slot++) {
      if (alive[slot] !== 1) continue;
      items[cursor[bucketOf[slot]]++] = slot;
    }
  }

  /**
   * Collect every indexed slot within `radius` of (px, py), using the same
   * position arrays the index was built from. Returns the number found; the
   * slots are in `this.result`. Nothing is left out however many there are.
   */
  query(px: number, py: number, radius: number, x: ArrayLike<number>, y: ArrayLike<number>): number {
    const { start, items, columns, rows, bucketSize } = this;
    let bx0 = Math.floor((px - radius) / bucketSize);
    let bx1 = Math.floor((px + radius) / bucketSize);
    let by0 = Math.floor((py - radius) / bucketSize);
    let by1 = Math.floor((py + radius) / bucketSize);
    if (bx0 < 0) bx0 = 0;
    if (by0 < 0) by0 = 0;
    if (bx1 >= columns) bx1 = columns - 1;
    if (by1 >= rows) by1 = rows - 1;
    const r2 = radius * radius;
    let result = this.result;
    let n = 0;
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const bucket = by * columns + bx;
        const end = start[bucket + 1];
        for (let k = start[bucket]; k < end; k++) {
          const slot = items[k];
          const dx = x[slot] - px;
          const dy = y[slot] - py;
          if (dx * dx + dy * dy <= r2) {
            if (n === result.length) {
              const bigger = new Int32Array(result.length * 2);
              bigger.set(result);
              result = bigger;
              this.result = bigger;
            }
            result[n++] = slot;
          }
        }
      }
    }
    return n;
  }
}

/**
 * A bucket grid whose buckets are kept sorted by x (ties by slot), built from its own copy of the
 * positions, so that a query reads the positions as they were when the grid was built however the
 * entities move afterwards, and a small query in a crowded bucket binary-searches instead of scanning
 * it (docs/DESIGN.md §4.8, rule 3). A derived cache: rebuilt from state, never saved.
 *
 * Results come back in a fixed order: bucket rows from low y to high y, buckets from low x to high x,
 * and inside a bucket by x, then by slot.
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
  /** Live entities indexed at the last build. */
  count = 0;

  private readonly start: Int32Array;
  private readonly cursor: Int32Array;
  private items: Int32Array = new Int32Array(256);
  private itemX: Float64Array = new Float64Array(256);
  private bucketOf: Int32Array = new Int32Array(256);

  constructor(width: number, height: number, bucketSize: number) {
    if (!(width > 0 && height > 0 && bucketSize > 0)) throw new RangeError('NeighbourGrid needs positive dimensions.');
    this.bucketSize = bucketSize;
    this.columns = Math.max(1, Math.ceil(width / bucketSize));
    this.rows = Math.max(1, Math.ceil(height / bucketSize));
    this.start = new Int32Array(this.columns * this.rows + 1);
    this.cursor = new Int32Array(this.columns * this.rows);
  }

  /** Index every slot in [0, highWater) for which `keep(slot)` is true, copying its position now. */
  build(x: ArrayLike<number>, y: ArrayLike<number>, highWater: number, keep: (slot: number) => boolean): void {
    if (this.x.length < highWater) {
      let capacity = this.x.length;
      while (capacity < highWater) capacity *= 2;
      this.x = new Float64Array(capacity);
      this.y = new Float64Array(capacity);
      this.bucketOf = new Int32Array(capacity);
      this.items = new Int32Array(capacity);
      this.itemX = new Float64Array(capacity);
    }
    const { start, cursor, bucketOf, columns, rows, bucketSize } = this;
    const cx = this.x;
    const cy = this.y;
    start.fill(0);
    let count = 0;
    for (let slot = 0; slot < highWater; slot++) {
      if (!keep(slot)) {
        bucketOf[slot] = -1;
        continue;
      }
      const px = x[slot];
      const py = y[slot];
      cx[slot] = px;
      cy[slot] = py;
      let bx = Math.floor(px / bucketSize);
      let by = Math.floor(py / bucketSize);
      if (bx < 0) bx = 0;
      else if (bx >= columns) bx = columns - 1;
      if (by < 0) by = 0;
      else if (by >= rows) by = rows - 1;
      const bucket = by * columns + bx;
      bucketOf[slot] = bucket;
      start[bucket + 1]++;
      count++;
    }
    this.count = count;
    const nbuckets = columns * rows;
    for (let b = 0; b < nbuckets; b++) {
      start[b + 1] += start[b];
      cursor[b] = start[b];
    }
    const items = this.items;
    const itemX = this.itemX;
    for (let slot = 0; slot < highWater; slot++) {
      const bucket = bucketOf[slot];
      if (bucket < 0) continue;
      // Insertion into the bucket's sorted run: slots arrive in ascending order, so ties keep slot order.
      const px = cx[slot];
      const lo = start[bucket];
      let k = cursor[bucket]++;
      while (k > lo && itemX[k - 1] > px) {
        items[k] = items[k - 1];
        itemX[k] = itemX[k - 1];
        k--;
      }
      items[k] = slot;
      itemX[k] = px;
    }
  }

  /** Every indexed slot within `radius` of (px, py), by the copied positions. Returns how many; the slots are in `this.result`. */
  query(px: number, py: number, radius: number): number {
    const { start, items, itemX, columns, rows, bucketSize } = this;
    const cx = this.x;
    const cy = this.y;
    let bx0 = Math.floor((px - radius) / bucketSize);
    let bx1 = Math.floor((px + radius) / bucketSize);
    let by0 = Math.floor((py - radius) / bucketSize);
    let by1 = Math.floor((py + radius) / bucketSize);
    if (bx0 < 0) bx0 = 0;
    if (by0 < 0) by0 = 0;
    if (bx1 >= columns) bx1 = columns - 1;
    if (by1 >= rows) by1 = rows - 1;
    const r2 = radius * radius;
    const xlo = px - radius;
    const xhi = px + radius;
    let result = this.result;
    let n = 0;
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const bucket = by * columns + bx;
        let lo = start[bucket];
        const end = start[bucket + 1];
        if (lo === end) continue;
        // First entry with x >= xlo.
        let hi = end;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (itemX[mid] < xlo) lo = mid + 1;
          else hi = mid;
        }
        for (let k = lo; k < end && itemX[k] <= xhi; k++) {
          const slot = items[k];
          const dx = cx[slot] - px;
          const dy = cy[slot] - py;
          if (dx * dx + dy * dy <= r2) {
            if (n === result.length) {
              const bigger = new Int32Array(result.length * 2);
              bigger.set(result);
              result = bigger;
              this.result = bigger;
            }
            result[n++] = slot;
          }
        }
      }
    }
    return n;
  }
}
