// Arbitrary-precision reference values for testing src/sim/core/dmath.ts.
//
// Everything here is fixed-point arithmetic on BigInt with P fractional
// bits, far more than a double holds. The constants ln 2 and pi are computed
// from series, not typed in, so nothing depends on anyone's memory of their
// digits or on the engine's own math library.

const P = 320n;
const ONE = 1n << P;

const F64 = new Float64Array(1);
const U64 = new BigUint64Array(F64.buffer);
const I64 = new BigInt64Array(F64.buffer);

/** Divide by 2^P, rounding toward zero for either sign. */
function shr(a: bigint): bigint {
  return a >= 0n ? a >> P : -(-a >> P);
}

function bitLength(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length;
}

/** atanh(1 / n) * 2^P. */
function atanhInverse(n: bigint): bigint {
  const n2 = n * n;
  let power = ONE / n;
  let sum = 0n;
  for (let k = 1n; power !== 0n; k += 2n) {
    sum += power / k;
    power /= n2;
  }
  return sum;
}

/** atan(1 / n) * 2^P. */
function atanInverse(n: bigint): bigint {
  const n2 = n * n;
  let power = ONE / n;
  let sum = 0n;
  let sign = 1n;
  for (let k = 1n; power !== 0n; k += 2n) {
    sum += (sign * power) / k;
    power /= n2;
    sign = -sign;
  }
  return sum;
}

/** ln 2 = 2 atanh(1/3). */
const LN2 = 2n * atanhInverse(3n);
/** Machin's formula: pi = 16 atan(1/5) - 4 atan(1/239). */
const PI = 16n * atanInverse(5n) - 4n * atanInverse(239n);

/** A finite double as sign * mantissa * 2^exponent, exactly. */
function decompose(x: number): { negative: boolean; mantissa: bigint; exponent: number } {
  F64[0] = x;
  const bits = U64[0];
  const negative = bits >> 63n === 1n;
  const field = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  if (field === 0) return { negative, mantissa: fraction, exponent: -1074 };
  return { negative, mantissa: fraction | (1n << 52n), exponent: field - 1075 };
}

/** x * 2^P as a signed integer. Exact unless x has bits below 2^-P, which are dropped. */
function toFixed(x: number): bigint {
  const { negative, mantissa, exponent } = decompose(x);
  const shift = P + BigInt(exponent);
  const magnitude = shift >= 0n ? mantissa << shift : mantissa >> -shift;
  return negative ? -magnitude : magnitude;
}

/** 2^k as a double for any k that a double can hold exactly, built from its bits. */
function twoTo(k: number): number {
  if (k >= -1022) {
    U64[0] = BigInt(k + 1023) << 52n;
    return F64[0];
  }
  U64[0] = 1n << BigInt(k + 1074);
  return F64[0];
}

/** The double nearest to n * 2^e (round half to even), as the standard defines correct rounding. */
export function nearestDouble(n: bigint, e: number): number {
  if (n === 0n) return 0;
  const negative = n < 0n;
  let m = negative ? -n : n;
  const length = bitLength(m);
  const top = length - 1 + e; // exponent of the leading bit
  if (top > 1023) return negative ? -Infinity : Infinity;
  // Bits of precision available: 53 for normal results, fewer for subnormal ones.
  const precision = top >= -1022 ? 53 : 53 - (-1022 - top);
  if (precision < 0) return negative ? -0 : 0;
  const drop = length - precision;
  let scale = e;
  if (drop > 0) {
    const dropBits = BigInt(drop);
    const kept = m >> dropBits;
    const rest = m & ((1n << dropBits) - 1n);
    const half = 1n << (dropBits - 1n);
    m = rest > half || (rest === half && (kept & 1n) === 1n) ? kept + 1n : kept;
    scale = e + drop;
  }
  // m now has at most 54 bits (53, or 54 after a carry), so Number(m) is exact.
  let value = Number(m);
  // Multiply by 2^scale in steps that are each exact.
  let remaining = scale;
  while (remaining > 900) {
    value *= twoTo(900);
    remaining -= 900;
  }
  while (remaining < -900) {
    value *= twoTo(-900);
    remaining += 900;
  }
  value *= twoTo(remaining);
  return negative ? -value : value;
}

/** Correctly rounded e^x for finite x. */
export function refExp(x: number): number {
  const X = toFixed(x);
  const k = BigInt(Math.round(x / Math.LN2));
  const r = X - k * LN2;
  let term = ONE;
  let sum = ONE;
  for (let i = 1n; term !== 0n; i++) {
    term = shr(term * r) / i;
    sum += term;
  }
  return nearestDouble(sum, Number(k - P));
}

/** Correctly rounded natural logarithm for finite x > 0. */
export function refLog(x: number): number {
  const { mantissa, exponent } = decompose(x);
  const length = bitLength(mantissa);
  const m = mantissa << (P - BigInt(length - 1)); // in [1, 2), times 2^P
  const e = BigInt(exponent + length - 1);
  // log(m) = 2 atanh((m - 1) / (m + 1))
  const z = ((m - ONE) << P) / (m + ONE);
  const z2 = shr(z * z);
  let power = z;
  let sum = 0n;
  for (let k = 1n; power !== 0n; k += 2n) {
    sum += power / k;
    power = shr(power * z2);
  }
  return nearestDouble(e * LN2 + 2n * sum, Number(-P));
}

function turnsToRadians(t: number): bigint {
  const T = toFixed(t);
  const fraction = ((T % ONE) + ONE) % ONE; // whole turns do not matter
  return shr(fraction * 2n * PI);
}

/** Correctly rounded sin(2 pi t). Do not use where the true value is exactly zero. */
export function refSinTurn(t: number): number {
  const a = turnsToRadians(t);
  const a2 = shr(a * a);
  let term = a;
  let sum = a;
  for (let k = 1n; term !== 0n; k++) {
    term = -shr(term * a2) / (2n * k * (2n * k + 1n));
    sum += term;
  }
  return nearestDouble(sum, Number(-P));
}

/** Correctly rounded cos(2 pi t). Do not use where the true value is exactly zero. */
export function refCosTurn(t: number): number {
  const a = turnsToRadians(t);
  const a2 = shr(a * a);
  let term = ONE;
  let sum = ONE;
  for (let k = 1n; term !== 0n; k++) {
    term = -shr(term * a2) / ((2n * k - 1n) * (2n * k));
    sum += term;
  }
  return nearestDouble(sum, Number(-P));
}

/** How many representable doubles apart two values are (0 means identical; -0 and +0 count as identical). */
export function ulpsApart(a: number, b: number): number {
  const ordered = (x: number): bigint => {
    F64[0] = x;
    const bits = I64[0];
    return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits;
  };
  const d = ordered(a) - ordered(b);
  return Number(d < 0n ? -d : d);
}

/** pi and ln 2 to double precision, from the series above. Lets tests confirm the reference constants themselves. */
export const REFERENCE_PI = nearestDouble(PI, Number(-P));
export const REFERENCE_LN2 = nearestDouble(LN2, Number(-P));
