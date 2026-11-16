// Accuracy of the portable math functions (docs/DESIGN.md §1.8), measured
// against an arbitrary-precision reference that does not use the engine's
// math library. "Units in the last place" below means: how many
// representable doubles away from the correctly rounded result.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cosTurn, exp, log, pow, sinTurn } from '../../src/sim/core/dmath.ts';
import { StreamDomain, nextExponential, nextFloat, nextInt, nextNormal, seedStream } from '../../src/sim/core/rng.ts';
import {
  REFERENCE_LN2,
  REFERENCE_PI,
  nearestDouble,
  refCosTurn,
  refExp,
  refLog,
  refSinTurn,
  ulpsApart,
} from './lib/bigref.ts';

const stream = new Uint32Array(4);
seedStream(stream, 0, 2026, StreamDomain.FIXTURE, 1);
const uniform = (): number => nextFloat(stream, 0);
const integerBelow = (n: number): number => nextInt(stream, 0, n);

/** A random value in [1, 2) divided by 2 between 1 and maxHalvings times. */
function shrunk(maxHalvings: number): number {
  let v = 1 + uniform();
  for (let k = 1 + integerBelow(maxHalvings); k > 0; k--) v *= 0.5;
  return v;
}

function worstError(inputs: number[], f: (x: number) => number, reference: (x: number) => number): { worst: number; at: number } {
  let worst = 0;
  let at = Number.NaN;
  for (const x of inputs) {
    const d = ulpsApart(f(x), reference(x));
    if (d > worst) {
      worst = d;
      at = x;
    }
  }
  return { worst, at };
}

test('the arbitrary-precision reference is itself sound', () => {
  assert.equal(REFERENCE_PI, Math.PI);
  assert.equal(REFERENCE_LN2, Math.LN2);
  assert.equal(refExp(0), 1);
  assert.equal(refExp(1), Math.E);
  assert.equal(refLog(1), 0);
  assert.equal(refLog(Math.E), 1);
  assert.equal(refLog(1024), 10 * Math.LN2);
  assert.equal(refSinTurn(0.125), Math.SQRT1_2);
  assert.equal(refCosTurn(0.125), Math.SQRT1_2);
  assert.equal(refCosTurn(0), 1);
  // Correct rounding, including ties and the smallest numbers a double can hold.
  assert.equal(nearestDouble(3n, -1), 1.5);
  assert.equal(nearestDouble(-5n, -1), -2.5);
  assert.equal(nearestDouble((1n << 53n) + 1n, 0), 9007199254740992);
  assert.equal(nearestDouble((1n << 53n) + 3n, 0), 9007199254740996);
  assert.equal(nearestDouble(1n, -1074), 5e-324);
  assert.equal(nearestDouble(1n, -1075), 0);
  assert.equal(nearestDouble(3n, -1076), 5e-324);
  assert.equal(nearestDouble(1n, 1024), Infinity);
  assert.equal(ulpsApart(1, 1 + Number.EPSILON), 1);
  assert.equal(ulpsApart(-0, 0), 0);
  assert.equal(ulpsApart(-5e-324, 5e-324), 2);
});

test('exp is within 1 unit in the last place everywhere it is finite', () => {
  const inputs: number[] = [];
  for (let i = 0; i < 6000; i++) inputs.push(-745.2 + uniform() * (709.8 + 745.2));
  for (let i = 0; i < 2000; i++) inputs.push(uniform() < 0.5 ? shrunk(60) : -shrunk(60));
  for (let i = -30; i <= 30; i++) inputs.push(i, i + 0.5);
  inputs.push(
    709.782712893384, 709.78, 709, -745.13, -745, -744.5, -740, -708.4, -708.39, -707,
    0.34657359027997264, 0.3465735902799727, -0.34657359027997264, 1.0397207708399179, 1e-300, -1e-300, 0,
  );
  const { worst, at } = worstError(inputs, exp, refExp);
  assert.ok(worst <= 1, `exp(${at}) is ${worst} units off`);
});

test('log is within 1 unit in the last place for every positive double', () => {
  const inputs: number[] = [];
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  for (let i = 0; i < 6000; i++) {
    // Random exponent field and random fraction bits: covers subnormal to huge.
    u32[1] = (integerBelow(2047) << 20) | integerBelow(1 << 20);
    u32[0] = integerBelow(4294967296);
    if (f64[0] > 0) inputs.push(f64[0]);
  }
  for (let i = 0; i < 2000; i++) inputs.push(uniform() < 0.5 ? 1 + shrunk(52) : 1 - shrunk(52));
  inputs.push(
    1, 2, 3, 10, Math.E, 0.5, 1e10, 1e-10, 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308,
    0.7071067811865476, 1.4142135623730951,
  );
  const { worst, at } = worstError(inputs, log, refLog);
  assert.ok(worst <= 1, `log(${at}) is ${worst} units off`);
});

test('sinTurn and cosTurn are within 2 units in the last place', () => {
  const inputs: number[] = [];
  for (let i = 0; i < 6000; i++) inputs.push((uniform() - 0.5) * 8);
  // Close to every eighth of a turn, where the two kernels hand over and where results are near zero.
  for (let i = 0; i < 1500; i++) {
    const offset = shrunk(50) - 1;
    inputs.push((integerBelow(33) - 16) / 8 + (uniform() < 0.5 ? offset : -offset));
  }
  for (let i = 0; i < 800; i++) inputs.push(integerBelow(1 << 30) + uniform());
  for (let i = 0; i < 500; i++) inputs.push(shrunk(60));
  // Exact zeros are checked separately below; the reference cannot represent them.
  const nonzero = inputs.filter((t) => !Number.isInteger(4 * t));
  assert.ok(nonzero.length > 8000);
  const sine = worstError(nonzero, sinTurn, refSinTurn);
  assert.ok(sine.worst <= 2, `sinTurn(${sine.at}) is ${sine.worst} units off`);
  const cosine = worstError(nonzero, cosTurn, refCosTurn);
  assert.ok(cosine.worst <= 2, `cosTurn(${cosine.at}) is ${cosine.worst} units off`);
});

test('sinTurn and cosTurn are exact at quarter turns and never return negative zero', () => {
  const expected: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  for (let n = -4000; n <= 4000; n++) {
    const t = n / 4;
    const [s, c] = expected[((n % 4) + 4) % 4];
    assert.ok(Object.is(sinTurn(t), s), `sinTurn(${t}) = ${sinTurn(t)}`);
    assert.ok(Object.is(cosTurn(t), c), `cosTurn(${t}) = ${cosTurn(t)}`);
  }
  assert.ok(Object.is(sinTurn(-0), 0));
  assert.ok(ulpsApart(sinTurn(0.125), Math.SQRT1_2) <= 1);
  assert.ok(ulpsApart(cosTurn(0.125), Math.SQRT1_2) <= 1);
  assert.ok(ulpsApart(cosTurn(1 / 6), 0.5) <= 1);
});

test('sinTurn and cosTurn are exactly periodic and exactly symmetric', () => {
  for (let i = 0; i < 20_000; i++) {
    // Multiples of 2^-40, so that adding whole turns is exact.
    const t = (integerBelow(1 << 30) * 1024 + integerBelow(1024)) / 1099511627776;
    const whole = integerBelow(4096) - 2048;
    assert.equal(sinTurn(t + whole), sinTurn(t));
    assert.equal(cosTurn(t + whole), cosTurn(t));
    assert.equal(sinTurn(-t), -sinTurn(t) + 0);
    assert.equal(cosTurn(-t), cosTurn(t));
    assert.equal(cosTurn(t - 0.25), sinTurn(t));
    const s = sinTurn(t);
    const c = cosTurn(t);
    assert.ok(Math.abs(s * s + c * c - 1) < 5e-16);
  }
});

test('sinTurn and cosTurn handle huge and non-finite arguments', () => {
  const two60 = 1152921504606846976;
  const two50 = 1125899906842624;
  assert.equal(sinTurn(two60), 0);
  assert.equal(cosTurn(-two60), 1);
  assert.equal(sinTurn(1.7976931348623157e308), 0);
  assert.equal(cosTurn(1.7976931348623157e308), 1);
  assert.equal(sinTurn(two50 + 0.25), 1);
  assert.equal(cosTurn(two50 + 0.5), -1);
  assert.equal(sinTurn(-two50 - 0.25), -1);
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    assert.ok(Number.isNaN(sinTurn(bad)));
    assert.ok(Number.isNaN(cosTurn(bad)));
  }
});

test('exp and log behave correctly at the edges', () => {
  assert.equal(exp(0), 1);
  assert.equal(exp(-0), 1);
  assert.equal(exp(Infinity), Infinity);
  assert.equal(exp(-Infinity), 0);
  assert.ok(Number.isNaN(exp(Number.NaN)));
  assert.equal(exp(709.782712893384), 1.7976931348622732e308);
  assert.equal(exp(709.7827128933841), Infinity);
  assert.equal(exp(710), Infinity);
  assert.equal(exp(-745.1332191019411), 5e-324);
  assert.equal(exp(-745.14), 0);
  assert.equal(exp(-1000), 0);
  assert.equal(log(1), 0);
  assert.ok(Object.is(log(1), 0));
  assert.equal(log(0), -Infinity);
  assert.equal(log(-0), -Infinity);
  assert.equal(log(Infinity), Infinity);
  assert.ok(Number.isNaN(log(-1)));
  assert.ok(Number.isNaN(log(-Infinity)));
  assert.ok(Number.isNaN(log(Number.NaN)));
  assert.equal(log(2), Math.LN2);
  assert.equal(log(1024), 10 * Math.LN2);
  for (let i = 0; i < 20_000; i++) {
    const x = (uniform() - 0.5) * 1000;
    const back = log(exp(x));
    assert.ok(Math.abs(back - x) <= 4e-16 * Math.max(1, Math.abs(x)), `log(exp(${x})) = ${back}`);
  }
});

test('pow multiplies exactly for whole-number exponents', () => {
  for (let i = 0; i < 5000; i++) {
    const x = (uniform() - 0.5) * 20;
    assert.equal(pow(x, 1), x);
    assert.equal(pow(x, 2), x * x);
    assert.equal(pow(x, 3), x * x * x);
    assert.equal(pow(x, 4), x * x * (x * x));
    assert.equal(pow(x, -1), 1 / x);
    assert.equal(pow(x, -2), 1 / (x * x));
    assert.equal(pow(x, 0), 1);
  }
  assert.equal(pow(2, 10), 1024);
  assert.equal(pow(2, 1023), 8.98846567431158e307);
  assert.equal(pow(2, -1022), 2.2250738585072014e-308);
  assert.equal(pow(-3, 3), -27);
  assert.equal(pow(-3, 4), 81);
  assert.equal(pow(10, 15), 1e15);
  assert.equal(pow(0, 5), 0);
  assert.equal(pow(0, -1), Infinity);
});

test('pow with a fractional exponent is good to 13 significant digits', () => {
  let worst = 0;
  for (let i = 0; i < 100_000; i++) {
    const x = exp((uniform() - 0.5) * 40);
    const y = (uniform() - 0.5) * 30;
    const got = pow(x, y);
    const want = Math.pow(x, y); // the engine's value, accurate to a few units in the last place
    const relative = Math.abs(got - want) / want;
    if (relative > worst) worst = relative;
  }
  assert.ok(worst < 1e-13, `worst relative difference ${worst}`);
  for (let i = 0; i < 2000; i++) {
    const x = uniform() * 1000;
    assert.equal(pow(x, 0.5), Math.sqrt(x));
    const three4 = pow(x + 1, 0.75);
    const viaRoots = Math.sqrt(Math.sqrt((x + 1) * (x + 1) * (x + 1)));
    assert.ok(Math.abs(three4 - viaRoots) <= 1e-13 * viaRoots);
  }
  assert.ok(Number.isNaN(pow(-2, 0.5)));
  assert.ok(Number.isNaN(pow(Number.NaN, 2)));
  assert.ok(Number.isNaN(pow(2, Number.NaN)));
  assert.equal(pow(0, 2.5), 0);
  assert.equal(pow(0, -2.5), Infinity);
  assert.equal(pow(7.5, 0), 1);
});

test('nextNormal draws from the standard normal distribution', () => {
  const s = new Uint32Array(4);
  seedStream(s, 0, 77, StreamDomain.FIXTURE, 2);
  const n = 400_000;
  // Standard normal cumulative probabilities at a few points (textbook values).
  const points: Array<[number, number]> = [
    [-3, 0.001349898],
    [-2, 0.0227501319],
    [-1, 0.1586552539],
    [-0.5, 0.3085375387],
    [0, 0.5],
    [0.5, 0.6914624613],
    [1, 0.8413447461],
    [2, 0.9772498681],
    [3, 0.998650102],
  ];
  const below = new Array<number>(points.length).fill(0);
  let sum = 0;
  let sum2 = 0;
  let sum3 = 0;
  let sum4 = 0;
  let largest = 0;
  for (let i = 0; i < n; i++) {
    const z = nextNormal(s, 0);
    assert.ok(Number.isFinite(z));
    sum += z;
    sum2 += z * z;
    sum3 += z * z * z;
    sum4 += z * z * z * z;
    if (Math.abs(z) > largest) largest = Math.abs(z);
    for (let k = 0; k < points.length; k++) if (z < points[k][0]) below[k]++;
  }
  const mean = sum / n;
  const variance = sum2 / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.008, `mean ${mean}`);
  assert.ok(Math.abs(variance - 1) < 0.012, `variance ${variance}`);
  assert.ok(Math.abs(sum3 / n) < 0.03, `third moment ${sum3 / n}`);
  assert.ok(Math.abs(sum4 / n - 3) < 0.08, `fourth moment ${sum4 / n}`);
  assert.ok(largest > 3.8 && largest < 7, `largest draw ${largest}`);
  for (let k = 0; k < points.length; k++) {
    const [z, p] = points[k];
    const tolerance = 5 * Math.sqrt((p * (1 - p)) / n);
    assert.ok(Math.abs(below[k] / n - p) < tolerance, `P(Z < ${z}) = ${below[k] / n}, expected ${p}`);
  }
});

test('nextExponential draws from the exponential distribution with mean 1', () => {
  const s = new Uint32Array(4);
  seedStream(s, 0, 78, StreamDomain.FIXTURE, 3);
  const n = 400_000;
  let sum = 0;
  let sum2 = 0;
  let above1 = 0;
  let above3 = 0;
  for (let i = 0; i < n; i++) {
    const v = nextExponential(s, 0);
    assert.ok(v >= 0 && Number.isFinite(v) && !Object.is(v, -0));
    sum += v;
    sum2 += v * v;
    if (v > 1) above1++;
    if (v > 3) above3++;
  }
  const mean = sum / n;
  assert.ok(Math.abs(mean - 1) < 0.008, `mean ${mean}`);
  assert.ok(Math.abs(sum2 / n - mean * mean - 1) < 0.03, `variance ${sum2 / n - mean * mean}`);
  assert.ok(Math.abs(above1 / n - 0.36787944) < 0.004, `P(X > 1) = ${above1 / n}`);
  assert.ok(Math.abs(above3 / n - 0.04978707) < 0.002, `P(X > 3) = ${above3 / n}`);
});
