// Gradient noise on a hashed lattice (docs/DESIGN.md §1.8, §2.10). Exact
// arithmetic only: integer hashing, + - * /, and Math.floor, so every engine
// produces the same field from the same seed.

const SQRT_HALF = Math.SQRT1_2;

// Eight gradient directions: the axes and the diagonals, all unit length.
const GRADIENTS = new Float64Array([
  1, 0, -1, 0, 0, 1, 0, -1, SQRT_HALF, SQRT_HALF, -SQRT_HALF, SQRT_HALF, SQRT_HALF, -SQRT_HALF, -SQRT_HALF, -SQRT_HALF,
]);

/** MurmurHash3's 32-bit finalizer. */
function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A 32-bit key for one noise field: the run seed combined with a salt naming the field. */
export function fieldKey(seed: number, salt: number): number {
  return mix32(mix32(seed ^ 0x2c1b3c6d) ^ Math.imul(salt + 1, 0x9e3779b1));
}

/** Quintic blending curve: 6t^5 - 15t^4 + 10t^3. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function corner(key: number, ix: number, iy: number, dx: number, dy: number): number {
  const h = mix32(mix32(key ^ Math.imul(ix | 0, 0x27d4eb2d)) ^ Math.imul(iy | 0, 0x165667b1));
  const g = (h & 7) << 1;
  return GRADIENTS[g] * dx + GRADIENTS[g + 1] * dy;
}

/** Gradient noise at (x, y), in lattice units. Smooth, zero at lattice points, roughly within [-1, 1]. */
export function noise2(key: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const n00 = corner(key, ix, iy, fx, fy);
  const n10 = corner(key, ix + 1, iy, fx - 1, fy);
  const n01 = corner(key, ix, iy + 1, fx, fy - 1);
  const n11 = corner(key, ix + 1, iy + 1, fx - 1, fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.4142135623730951;
}

/**
 * Fractal sum of `octaves` layers of noise, each at twice the frequency and
 * half the amplitude of the one before, divided by the total amplitude.
 * Roughly within [-1, 1], usually much closer to 0.
 */
export function fractal(key: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    // Each octave gets its own offset so the layers' lattice points don't line up.
    sum += amplitude * noise2((key + Math.imul(o, 0x3c6ef372)) >>> 0, x * frequency + o * 17.31, y * frequency - o * 9.87);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}
