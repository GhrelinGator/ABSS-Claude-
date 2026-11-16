// Portable elementary functions. Design: docs/DESIGN.md §1.5 and §1.8.
//
// The standard does not fix the results of Math.exp, Math.log, Math.sin and
// their relatives, so engines may differ in the last bits. In a chaotic
// simulation one differing bit becomes a different history, which is why the
// simulation never calls them. The functions here use only operations whose
// results are fixed exactly (+ - * /, comparisons, rounding to an integer,
// and direct access to the bits of a double), so they return the same bits
// on every engine.
//
// exp, log, and the sine and cosine kernels are ports of fdlibm, whose
// notice follows:
//
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
//
// sinTurn and cosTurn take the angle in turns (fractions of a full cycle)
// instead of radians. That makes argument reduction exact, gives exact zeros
// and ones at quarter turns, and makes the functions exactly periodic.
//
// Accuracy and cost are recorded in docs/DECISIONS.md D-018. These functions
// are slower than an engine's built-ins: call them at setup where the model
// allows, and keep them out of per-agent, per-tick loops.
//
// Changing anything here changes the results of every run. The recorded
// digests in tests/guardrails/portable-math.test.ts will say so.

// Scratch space for reading and writing the bits of a double. Used only
// within a single call, so it carries nothing from one call to the next.
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const LO = 0;
const HI = 1;

F64[0] = 1;
if (U32[HI] !== 0x3ff00000) throw new Error('Big-endian platforms are not supported.');

/** 2^k as a double, for -1022 <= k <= 1023. */
function twoTo(k: number): number {
  U32[LO] = 0;
  U32[HI] = (k + 1023) << 20;
  return F64[0];
}

const TWO_54 = twoTo(54);
const TWO_1023 = twoTo(1023);
const TWO_M1000 = twoTo(-1000);
const TWO_M27 = twoTo(-27);
const TWO_M28 = twoTo(-28);
const TWO_52 = twoTo(52);

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;
const HALF_LN2 = 0.34657359027997264;

// ---------------------------------------------------------------- exp

const EXP_OVERFLOW = 7.09782712893383973096e2;
const EXP_UNDERFLOW = -7.45133219101941108420e2;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** e^x. */
export function exp(x: number): number {
  if (x !== x) return x;
  if (x > EXP_OVERFLOW) return Infinity;
  if (x < EXP_UNDERFLOW) return 0;
  const ax = x < 0 ? -x : x;
  let hi = 0;
  let lo = 0;
  let k = 0;
  let r = x;
  if (ax > HALF_LN2) {
    // x = k ln2 + r with |r| <= ln2 / 2. k * LN2_HI is exact, because LN2_HI ends in 21 zero bits.
    k = (INV_LN2 * x + (x < 0 ? -0.5 : 0.5)) | 0;
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    r = hi - lo;
  } else if (ax < TWO_M28) {
    return 1 + x;
  }
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  // Scale by 2^k. y lies in about [0.7, 1.42), so each product below is exact
  // except the last one when the result is subnormal, where it rounds once.
  if (k > 1023) return y * TWO_1023 * twoTo(k - 1023);
  if (k >= -1021) return y * twoTo(k);
  return y * twoTo(k + 1000) * TWO_M1000;
}

// ---------------------------------------------------------------- log

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/** Natural logarithm. log(0) is -Infinity; the logarithm of a negative number is NaN. */
export function log(x: number): number {
  F64[0] = x;
  let hx = U32[HI] | 0;
  const lx = U32[LO];
  let k = 0;
  if (hx < 0x00100000) {
    // Zero, negative, or subnormal.
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k = -54;
    F64[0] = x * TWO_54;
    hx = U32[HI] | 0;
  }
  if (hx >= 0x7ff00000) return x + x;
  // x = 2^k * (1 + f), with 1 + f in [sqrt(1/2), sqrt(2)).
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  U32[HI] = hx | (i ^ 0x3ff00000);
  k += i >> 20;
  const f = F64[0] - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
    const small = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - small : k * LN2_HI - (small - k * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  if (((hx - 0x6147a) | (0x6b851 - hx)) > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - R) : k * LN2_HI - (s * (f - R) - k * LN2_LO - f);
}

// ---------------------------------------------------------------- pow

/**
 * x to the y.
 *
 * For whole-number y up to 1024 in size this multiplies repeatedly, so
 * pow(x, 2) is exactly x * x. Otherwise it is exp(y * log(x)), which is good
 * to about 13 significant digits. A negative x with a fractional y gives NaN.
 */
export function pow(x: number, y: number): number {
  if (x !== x || y !== y) return NaN;
  if (y === 0) return 1;
  if (Number.isInteger(y) && y >= -1024 && y <= 1024) {
    let n = y < 0 ? -y : y;
    let base = x;
    let result = 1;
    for (;;) {
      if ((n & 1) === 1) result *= base;
      n >>>= 1;
      if (n === 0) break;
      base *= base;
    }
    return y < 0 ? 1 / result : result;
  }
  if (x < 0) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (y === 0.5) return Math.sqrt(x);
  return exp(y * log(x));
}

// ---------------------------------------------------------------- sine and cosine

const HALF_PI = Math.PI / 2;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin(x) for x in radians, |x| <= pi / 4. */
function kernelSin(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < TWO_M27) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

/** cos(x) for x in radians, |x| <= pi / 4. */
function kernelCos(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < TWO_M27) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ax < 0.3) return 1 - (0.5 * z - z * r);
  // Subtract a value close to x / 4 that has few significant bits, so that
  // 1 - qx is exact and the remaining terms are small.
  let qx: number;
  if (ax > 0.78125) {
    qx = 0.28125;
  } else {
    F64[0] = ax;
    U32[HI] = U32[HI] - 0x00200000;
    U32[LO] = 0;
    qx = F64[0];
  }
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - z * r);
}

/**
 * Sine of an angle measured in turns: sinTurn(0.25) is 1 and sinTurn(0.5) is 0,
 * both exactly. Never returns negative zero.
 */
export function sinTurn(t: number): number {
  if (t - t !== 0) return NaN;
  if (t >= TWO_52 || t <= -TWO_52) return 0; // a whole number of turns
  // n = nearest quarter turn (halves round away from zero, which keeps the
  // function exactly odd); what is left over, q - n, is exact and at most
  // half a quarter turn.
  const q = 4 * t;
  const n = q < 0 ? -Math.round(-q) : Math.round(q);
  const x = (q - n) * HALF_PI;
  let v: number;
  switch (n & 3) {
    case 0:
      v = kernelSin(x);
      break;
    case 1:
      v = kernelCos(x);
      break;
    case 2:
      v = -kernelSin(x);
      break;
    default:
      v = -kernelCos(x);
  }
  return v === 0 ? 0 : v;
}

/**
 * Cosine of an angle measured in turns: cosTurn(0) is 1 and cosTurn(0.25) is 0,
 * both exactly. Never returns negative zero.
 */
export function cosTurn(t: number): number {
  if (t - t !== 0) return NaN;
  if (t >= TWO_52 || t <= -TWO_52) return 1;
  const q = 4 * t;
  const n = q < 0 ? -Math.round(-q) : Math.round(q);
  const x = (q - n) * HALF_PI;
  let v: number;
  switch (n & 3) {
    case 0:
      v = kernelCos(x);
      break;
    case 1:
      v = -kernelSin(x);
      break;
    case 2:
      v = -kernelCos(x);
      break;
    default:
      v = kernelSin(x);
  }
  return v === 0 ? 0 : v;
}
