// Guardrail: a run depends on its seed and config and nothing else. No
// clocks, network, environment, timers, asynchrony, locale, or arithmetic
// that differs between engines inside src/sim/ (docs/DESIGN.md §1.5).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAmbient, readSources } from './lib/scan.ts';

test('the checker catches ambient inputs and non-portable arithmetic', () => {
  const bad = [
    'const t = Date.now();',
    'const d = new Date();',
    'const r = Math.random();',
    'const s = Math.sin(x);',
    'const e = Math.exp(1);',
    'const p = Math.pow(2, 0.5);',
    'const h = Math.hypot(a, b);',
    'const q = x ** 2;',
    'x **= 2;',
    'const m = Math;',
    'console.log(1);',
    'setTimeout(f, 1);',
    'const v = await f();',
    'async function f() {}',
    'new Promise((resolve) => resolve(1));',
    'const env = process.env.X;',
    'fetch(url);',
    'a.localeCompare(b);',
    'n.toLocaleString();',
    "const f = new Function('x', 'return x');",
    'const t = performance.now();',
    'const g = globalThis;',
    'new Worker(url);',
    'new WeakRef(o);',
  ];
  for (const sample of bad) {
    assert.ok(checkAmbient('src/sim/sample.ts', sample).length > 0, `not flagged: ${sample}`);
  }
});

test('the checker accepts exact arithmetic and ignores comments and strings', () => {
  const good = [
    'const a = Math.sqrt(x) + Math.imul(a, b) + Math.floor(c) + Math.abs(d) + Math.min(e, f) + Math.PI;',
    '// Math.random and Date.now are banned here',
    '/** Doc comment: never call fetch or await anything. */',
    "const label = 'Date and Math.sin inside a string';",
    'const text = `process ${count} console`;',
    'const birthDate = 3; const processQueue = 4; const asyncCount = 5;',
    'const sq = x * x;',
    'const product = a * b; // not a ** b',
    'const pattern = /^[a-z]*$/;',
  ];
  for (const sample of good) {
    assert.deepEqual(checkAmbient('src/sim/sample.ts', sample), [], `wrongly flagged: ${sample}`);
  }
});

test('src/sim/ uses no ambient inputs and no non-portable arithmetic', () => {
  const sources = readSources('src/sim');
  assert.ok(sources.length > 0, 'src/sim/ is empty or missing');
  const problems: string[] = [];
  for (const { path, text } of sources) problems.push(...checkAmbient(path, text));
  assert.deepEqual(problems, []);
});
