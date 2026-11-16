// How much slower are the portable math functions than the engine's own?
// (docs/DESIGN.md §1.8, rule 3.)
//
//   node bench/math.ts

import { cosTurn, exp, log, pow, sinTurn } from '../src/sim/core/dmath.ts';
import { StreamDomain, nextExponential, nextFloat, nextNormal, seedStream } from '../src/sim/core/rng.ts';

const N = 4_000_000;
const inputs = new Float64Array(N);
const stream = new Uint32Array(4);
seedStream(stream, 0, 1, StreamDomain.FIXTURE, 0);

function fill(make: () => number): void {
  for (let i = 0; i < N; i++) inputs[i] = make();
}

/** Nanoseconds per call, best of five passes. The sum keeps the calls from being optimised away. */
function time(f: (x: number) => number): number {
  let best = Infinity;
  let sink = 0;
  for (let pass = 0; pass < 5; pass++) {
    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < N; i++) sum += f(inputs[i]);
    const elapsed = performance.now() - start;
    sink += sum;
    if (elapsed < best) best = elapsed;
  }
  if (sink !== sink) throw new Error('unexpected NaN');
  return (best * 1e6) / N;
}

function row(name: string, portable: number, builtin: number | null): void {
  const ratio = builtin === null ? '' : `${(portable / builtin).toFixed(1)}x`;
  const other = builtin === null ? '' : builtin.toFixed(1);
  console.log(`${name.padEnd(16)} ${portable.toFixed(1).padStart(8)} ${other.padStart(10)} ${ratio.padStart(8)}`);
}

console.log('nanoseconds per call  portable   built-in    ratio');

fill(() => (nextFloat(stream, 0) - 0.5) * 40);
row('exp', time(exp), time(Math.exp));

fill(() => exp((nextFloat(stream, 0) - 0.5) * 40));
row('log', time(log), time(Math.log));
row('pow(x, 0.3)', time((x) => pow(x, 0.3)), time((x) => Math.pow(x, 0.3)));
row('pow(x, 3)', time((x) => pow(x, 3)), time((x) => Math.pow(x, 3)));

fill(() => (nextFloat(stream, 0) - 0.5) * 4);
row('sinTurn', time(sinTurn), time((t) => Math.sin(2 * Math.PI * t)));
row('cosTurn', time(cosTurn), time((t) => Math.cos(2 * Math.PI * t)));

fill(() => 0);
row('nextFloat', time(() => nextFloat(stream, 0)), time(() => Math.random()));
row('nextNormal', time(() => nextNormal(stream, 0)), null);
row('nextExponential', time(() => nextExponential(stream, 0)), null);
