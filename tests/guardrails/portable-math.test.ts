// Guardrail: the simulation's arithmetic gives the same bits everywhere and
// every time (docs/DECISIONS.md D-014, docs/DESIGN.md §1.8).
//
// The random streams and the functions in src/sim/core/dmath.ts are
// evaluated over fixed sweeps of inputs and the results are compared with
// digests recorded when the functions were written. A mismatch means the
// arithmetic changed, and with it the outcome of every run for every seed.
//
// If this test fails:
//  - on a machine or engine where nothing was edited: the claim of D-014 is
//    broken there. That is a serious finding. Do not update the digests.
//  - after an intentional change to rng.ts or dmath.ts: record the change in
//    docs/DECISIONS.md, then update the digests here AND in
//    src/sim/core/selfcheck.ts with the output of
//    `node tests/cross-engine/print-digests.ts`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORDED_MATH_DIGESTS, arithmeticProblems, portableMathDigests } from '../../src/sim/core/selfcheck.ts';
import { fixtureRunHashes } from './lib/portable-digests.ts';

// Recorded 2026-11-15 on Node 22.23 (V8). Bun 1.4.4 (JavaScriptCore) gave the same values.
// This is a second copy, kept apart from the one in src/sim/core/selfcheck.ts on purpose.
const RECORDED: Record<string, string> = {
  uniform: '1198ebbbb6e5d83ef4388da99068125a',
  normal: 'a32c85049656bc03cfdd9d763745da78',
  exponential: 'b57c1fa50d2b6d182b47fa82c0309609',
  exp: '4bb874e3a1bca70ab8ca825024b0db74',
  log: '7bf65dfb30aff2f684b9a5bbec6e0c15',
  pow: '20b8f93d6b7f45b6e91a45804bd7bdc5',
  sinTurn: '243d07e5fac3f2f68247469f1549bac6',
  cosTurn: '587c47b29cb2bd3c9b98633d63e5b310',
};

test('random streams and math functions still give their recorded results', () => {
  assert.deepEqual(portableMathDigests(), RECORDED);
});

test('the digests recorded in the simulation match the ones recorded here', () => {
  assert.deepEqual({ ...RECORDED_MATH_DIGESTS }, RECORDED);
  assert.deepEqual(arithmeticProblems(), []);
});

test('every sweep has its own digest, and computing them twice agrees', () => {
  const once = portableMathDigests();
  assert.deepEqual(portableMathDigests(), once);
  assert.equal(new Set(Object.values(once)).size, Object.keys(RECORDED).length);
});

test('a short simulation run can be hashed for comparison between engines', () => {
  const hashes = fixtureRunHashes();
  assert.equal(hashes.length, 4);
  assert.equal(new Set(hashes).size, 4);
  assert.deepEqual(fixtureRunHashes(), hashes);
});
