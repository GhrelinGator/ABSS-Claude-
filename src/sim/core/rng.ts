// Seeded pseudo-random streams. Design: docs/DESIGN.md §1.4 and §1.5.
//
// Generator: sfc32 ("Small Fast Counting", 32-bit variant, by Chris
// Doty-Humphrey). It keeps 96 bits of chaotic state plus a 32-bit counter, so
// every stream runs for at least 2^32 draws before repeating and no seed is a
// bad seed. It needs only 32-bit integer arithmetic, which every engine
// computes identically.
//
// Streams: each consumer owns one stream of four 32-bit words inside a
// Uint32Array. A stream is seeded by hashing (run seed, domain, id) through
// three independent lanes. Streams share no state, so adding or removing one
// consumer cannot shift the draws of any other.

export const STREAM_WORDS = 4;

/**
 * Who a stream belongs to. The numbers feed the seed derivation, so they must
 * never be renumbered or reused once a run has been recorded.
 */
export const StreamDomain = {
  WORLD_GEN: 1,
  CLIMATE: 2,
  ECOLOGY: 3,
  RESOLVE: 4,
  AGENT: 5,
  FIXTURE: 6,
} as const;

export type StreamDomainId = (typeof StreamDomain)[keyof typeof StreamDomain];

/** Number of slots in the block of run-wide streams (indexed by domain number). */
export const GLOBAL_STREAM_SLOTS = 8;

/** Offset of a run-wide stream inside the block of run-wide streams. */
export function globalStreamOffset(domain: StreamDomainId): number {
  return domain * STREAM_WORDS;
}

const LANE_START = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35] as const;
const LANE_MULTIPLIER = [0x2545f491, 0x9e3779b1, 0x7feb352d] as const;
const WARMUP_ROUNDS = 15;

/** MurmurHash3's 32-bit finalizer: a bijection on 32-bit values with full avalanche. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * One 32-bit lane of the seed derivation. For a fixed (seed, domain) each lane
 * is a bijection of `id`, so two entities of one run can never get the same
 * lane value, let alone the same stream.
 */
function lane(k: 0 | 1 | 2, seed: number, domain: number, id: number): number {
  const m = LANE_MULTIPLIER[k];
  let h = fmix32(Math.imul(seed, m) ^ LANE_START[k]);
  h = fmix32(h ^ Math.imul(domain, m));
  h = fmix32(h ^ Math.imul(id, m));
  return h;
}

/** Initialise the stream at `offset` for (run seed, domain, id). All three are unsigned 32-bit integers. */
export function seedStream(s: Uint32Array, offset: number, seed: number, domain: number, id: number): void {
  s[offset] = lane(0, seed, domain, id);
  s[offset + 1] = lane(1, seed, domain, id);
  s[offset + 2] = lane(2, seed, domain, id);
  s[offset + 3] = 1;
  for (let i = 0; i < WARMUP_ROUNDS; i++) nextU32(s, offset);
}

/** Next unsigned 32-bit integer from the stream at `o`. */
export function nextU32(s: Uint32Array, o: number): number {
  const a = s[o];
  const b = s[o + 1];
  const c = s[o + 2];
  const d = s[o + 3];
  const t = (a + b + d) >>> 0;
  // Stores into a Uint32Array wrap modulo 2^32, which is the arithmetic sfc32 specifies.
  s[o] = b ^ (b >>> 9);
  s[o + 1] = c + (c << 3);
  s[o + 2] = ((c << 21) | (c >>> 11)) + t;
  s[o + 3] = d + 1;
  return t;
}

/** Uniform float in [0, 1) with 53 random bits. */
export function nextFloat(s: Uint32Array, o: number): number {
  const hi = nextU32(s, o) >>> 5; // 27 bits
  const lo = nextU32(s, o) >>> 6; // 26 bits
  return (hi * 67108864 + lo) / 9007199254740992;
}

/** Uniform integer in [0, n), without modulo bias. `n` is an integer in [1, 2^32]. */
export function nextInt(s: Uint32Array, o: number, n: number): number {
  if (!(Number.isInteger(n) && n >= 1 && n <= 4294967296)) {
    throw new RangeError(`nextInt: n must be an integer in [1, 2^32], got ${n}`);
  }
  const limit = 4294967296 - (4294967296 % n);
  let r = nextU32(s, o);
  while (r >= limit) r = nextU32(s, o);
  return r % n;
}

/** True with probability p. */
export function nextChance(s: Uint32Array, o: number, p: number): boolean {
  return nextFloat(s, o) < p;
}
