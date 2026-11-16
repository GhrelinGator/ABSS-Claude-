// Prints digests of the portable arithmetic and of a short simulation run.
// Run it on two different JavaScript engines and compare the output: it must
// be identical, byte for byte (docs/DECISIONS.md D-014).
//
//   node tests/cross-engine/print-digests.ts
//   bun  tests/cross-engine/print-digests.ts
//
// Node runs on the V8 engine and Bun on JavaScriptCore (the engine in
// Safari), so agreement between them is a real test, not a formality.

import { portableMathDigests } from '../../src/sim/core/selfcheck.ts';
import { fixtureRunHashes } from '../guardrails/lib/portable-digests.ts';

console.log(JSON.stringify({ math: portableMathDigests(), fixtureRun: fixtureRunHashes() }, null, 2));
