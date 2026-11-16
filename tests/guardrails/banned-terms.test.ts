// Guardrail: no social-outcome words anywhere in src/sim/ (docs/GUARDRAILS.md §2).
// The list is read from the document itself, so the two cannot drift apart.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, checkBannedTerms, listFiles, loadBannedTerms } from './lib/scan.ts';

const { terms, categories } = loadBannedTerms();

// The list may grow. Shrinking it needs an owner-approved decision (docs/GUARDRAILS.md §2),
// and whoever does that has to lower this number on purpose.
const MINIMUM_TERMS = 139;

test('the banned-term list in docs/GUARDRAILS.md §2 parses and is intact', () => {
  assert.deepEqual(categories, [
    'Religion',
    'Politics & hierarchy',
    'Economy',
    'Kinship & bonds',
    'Culture & cognition',
  ]);
  assert.ok(terms.size >= MINIMUM_TERMS, `expected at least ${MINIMUM_TERMS} banned terms, found ${terms.size}`);
  for (const sentinel of [
    'religion',
    'god',
    'ritual',
    'leader',
    'hierarchy',
    'status',
    'power',
    'trade',
    'money',
    'tool',
    'marriage',
    'tribe',
    'culture',
    'language',
    'cooperation',
  ]) {
    assert.ok(terms.has(sentinel), `"${sentinel}" is missing from the banned list`);
  }
});

test('the scanner catches banned terms however they are written', () => {
  const flagged = [
    'const religionScore = 1;',
    'const LEADER_ID = 3;',
    '// a trade-off between two costs',
    'function isPriest() {}',
    'let leaders = [];',
    'worshipping',
    'TRIBE',
    'taxes',
    'married',
    'armies',
    'tradingPost',
    '// they trust each other',
    'const label = "ritual";',
    'customPipeline',
    'exit_status',
  ];
  for (const sample of flagged) {
    assert.ok(checkBannedTerms('src/sim/sample.ts', sample, terms).length > 0, `not flagged: ${sample}`);
  }
});

test('the scanner leaves ordinary words alone', () => {
  const clean = [
    'tradeoff',
    'kin',
    'signalToken',
    'hiddenCause',
    'vector norm',
    'warning',
    'seed',
    'speed',
    'history',
    'offspring',
    'attachment',
    'bondStrength',
    'follow strike mate give take',
    'normalize',
    'lightning during the evening',
  ];
  for (const sample of clean) {
    assert.deepEqual(checkBannedTerms('src/sim/sample.ts', sample, terms), [], `wrongly flagged: ${sample}`);
  }
});

test('file and directory names are scanned too', () => {
  assert.ok(checkBannedTerms('src/sim/trade/exchange.ts', '', terms).length > 0);
  assert.ok(checkBannedTerms('src/sim/mind/ritualTimer.ts', '', terms).length > 0);
});

test('src/sim/ contains no banned terms', () => {
  const files = listFiles('src/sim');
  assert.ok(files.length > 0, 'src/sim/ is empty or missing');
  const problems: string[] = [];
  for (const path of files) {
    problems.push(...checkBannedTerms(path, readFileSync(join(REPO_ROOT, path), 'utf8'), terms));
  }
  assert.deepEqual(problems, []);
});
