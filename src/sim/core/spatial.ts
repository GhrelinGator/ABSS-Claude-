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
