// Self-check of the portable arithmetic (docs/DECISIONS.md D-014,
// docs/DESIGN.md §1.8).
//
// The random streams and the functions in dmath.ts are evaluated over fixed
// sweeps of inputs, and a digest of the results is compared with the digest
// recorded when the functions were written. Agreement means this engine, on
// this machine, computes exactly what every other one does. The harness runs
// the check before a batch, and the viewer can run it in the browser.
//
// The recorded digests exist in two places on purpose: here, and in
// tests/guardrails/portable-math.test.ts. A change to the arithmetic has to
// be made in both, so it cannot happen by accident. Such a change alters the
// outcome of every run for every seed and needs an entry in
// docs/DECISIONS.md.

import { HashSink } from './codec.ts';
import { cosTurn, exp, log, pow, sinTurn } from './dmath.ts';
import { Hasher } from './hash.ts';
import {
  StreamDomain,
  nextChance,
  nextExponential,
  nextFloat,
  nextInt,
  nextNormal,
  nextU32,
  seedStream,
} from './rng.ts';

/** Recorded 2026-11-15 on Node 22.23 (V8). Bun 1.4.4 (JavaScriptCore) gave the same values. */
export const RECORDED_MATH_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  uniform: '1198ebbbb6e5d83ef4388da99068125a',
  normal: 'a32c85049656bc03cfdd9d763745da78',
  exponential: 'b57c1fa50d2b6d182b47fa82c0309609',
  exp: '4bb874e3a1bca70ab8ca825024b0db74',
  log: '7bf65dfb30aff2f684b9a5bbec6e0c15',
  pow: '20b8f93d6b7f45b6e91a45804bd7bdc5',
  sinTurn: '243d07e5fac3f2f68247469f1549bac6',
  cosTurn: '587c47b29cb2bd3c9b98633d63e5b310',
});

const SWEEP_SEED = 20261115;
const NOT_FINITE_MARKER = -12345.6789;

function digest(sweep: number, fill: (put: (value: number) => void, s: Uint32Array) => void): string {
  const hasher = new Hasher();
  const sink = new HashSink(hasher);
  const s = new Uint32Array(4);
  seedStream(s, 0, SWEEP_SEED, StreamDomain.FIXTURE, sweep);
  // A result that is not finite cannot be written, so a marker stands in for it.
  fill((value) => sink.f64(value - value === 0 ? value : NOT_FINITE_MARKER), s);
  return hasher.digest();
}

/** A random value in [1, 2), halved between 1 and maxHalvings times. */
function shrunk(s: Uint32Array, maxHalvings: number): number {
  let v = 1 + nextFloat(s, 0);
  for (let k = 1 + nextInt(s, 0, maxHalvings); k > 0; k--) v *= 0.5;
  return v;
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

/** A positive finite double with random exponent bits and random fraction bits. */
function anyPositive(s: Uint32Array): number {
  U32[1] = (nextInt(s, 0, 2047) << 20) | nextInt(s, 0, 1 << 20);
  U32[0] = nextU32(s, 0);
  return F64[0] > 0 ? F64[0] : 1;
}

/** Digests of the random streams and of each math function over fixed sweeps of inputs. */
export function portableMathDigests(): Record<string, string> {
  return {
    uniform: digest(1, (put, s) => {
      for (let i = 0; i < 20_000; i++) put(nextU32(s, 0));
      for (let i = 0; i < 20_000; i++) put(nextFloat(s, 0));
      for (let i = 0; i < 20_000; i++) put(nextInt(s, 0, 1 + (i % 1000)));
      for (let i = 0; i < 20_000; i++) put(nextChance(s, 0, 0.3) ? 1 : 0);
    }),
    normal: digest(2, (put, s) => {
      for (let i = 0; i < 40_000; i++) put(nextNormal(s, 0));
    }),
    exponential: digest(3, (put, s) => {
      for (let i = 0; i < 40_000; i++) put(nextExponential(s, 0));
    }),
    exp: digest(4, (put, s) => {
      for (let i = 0; i < 30_000; i++) put(exp(-745 + nextFloat(s, 0) * 1454));
      for (let i = 0; i < 10_000; i++) put(exp(nextChance(s, 0, 0.5) ? shrunk(s, 60) : -shrunk(s, 60)));
    }),
    log: digest(5, (put, s) => {
      for (let i = 0; i < 30_000; i++) put(log(anyPositive(s)));
      for (let i = 0; i < 10_000; i++) put(log(nextChance(s, 0, 0.5) ? 1 + shrunk(s, 52) : 1 - shrunk(s, 52)));
    }),
    pow: digest(6, (put, s) => {
      for (let i = 0; i < 20_000; i++) put(pow(exp((nextFloat(s, 0) - 0.5) * 40), (nextFloat(s, 0) - 0.5) * 30));
      for (let i = 0; i < 10_000; i++) put(pow((nextFloat(s, 0) - 0.5) * 6, nextInt(s, 0, 41) - 20));
    }),
    sinTurn: digest(7, (put, s) => {
      for (let i = 0; i < 30_000; i++) put(sinTurn((nextFloat(s, 0) - 0.5) * 16));
      for (let i = 0; i < 5_000; i++) put(sinTurn((nextInt(s, 0, 257) - 128) / 16));
      for (let i = 0; i < 5_000; i++) put(sinTurn(nextInt(s, 0, 1 << 30) + nextFloat(s, 0)));
    }),
    cosTurn: digest(8, (put, s) => {
      for (let i = 0; i < 30_000; i++) put(cosTurn((nextFloat(s, 0) - 0.5) * 16));
      for (let i = 0; i < 5_000; i++) put(cosTurn((nextInt(s, 0, 257) - 128) / 16));
      for (let i = 0; i < 5_000; i++) put(cosTurn(nextInt(s, 0, 1 << 30) + nextFloat(s, 0)));
    }),
  };
}

/**
 * Names of the sweeps whose digest differs from the recorded one. An empty
 * list means this engine's arithmetic matches. Anything else means runs made
 * here cannot be reproduced elsewhere, and must not be used.
 */
export function arithmeticProblems(): string[] {
  const computed = portableMathDigests();
  const problems: string[] = [];
  for (const name of Object.keys(RECORDED_MATH_DIGESTS)) {
    if (computed[name] !== RECORDED_MATH_DIGESTS[name]) {
      problems.push(`${name}: computed ${computed[name]}, recorded ${RECORDED_MATH_DIGESTS[name]}`);
    }
  }
  return problems;
}
