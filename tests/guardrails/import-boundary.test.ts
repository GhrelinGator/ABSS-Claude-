// Guardrail: the simulation imports nothing but itself, and analysis reaches
// it only through the read-only view (docs/GUARDRAILS.md §1, CLAUDE.md).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkImports, readSources } from './lib/scan.ts';

test('the checker catches every kind of boundary violation', () => {
  const bad: Array<[string, string]> = [
    ['src/sim/a.ts', "import { x } from '../analysis/index.ts';"],
    ['src/sim/a.ts', "import { runOne } from '../harness/run.ts';"],
    ['src/sim/a.ts', "import fs from 'node:fs';"],
    ['src/sim/a.ts', "import { z } from 'some-package';"],
    ['src/sim/a.ts', "const m = import('../harness/run.ts');"],
    ['src/sim/a.ts', 'const m = import(name);'],
    ['src/sim/a.ts', "const m = require('fs');"],
    ['src/sim/a.ts', "import './core/rng';"],
    ['src/sim/a.ts', "import {\n  a,\n  b,\n} from '../viewer/main.ts';"],
    ['src/sim/core/a.ts', "export { y } from '../../../tests/fixtures/systems.ts';"],
    ['src/sim/core/a.ts', "export * from '../../../bench/fixtures.ts';"],
    ['src/analysis/a.ts', "import { stepSim } from '../sim/sim.ts';"],
    ['src/analysis/a.ts', "import type { Sim } from '../sim/sim.ts';"],
    ['src/analysis/a.ts', "import { writeFileSync } from 'node:fs';"],
    ['src/harness/a.ts', "import { fx } from '../../tests/fixtures/systems.ts';"],
    ['src/viewer/a.ts', "import { runOne } from '../harness/run.ts';"],
  ];
  for (const [file, text] of bad) {
    assert.ok(checkImports(file, text).length > 0, `not flagged: ${file}: ${text}`);
  }
});

test('the checker accepts legitimate imports', () => {
  const good: Array<[string, string]> = [
    ['src/sim/a.ts', "import { x } from './core/rng.ts';\nimport type { T } from './config.ts';"],
    ['src/sim/core/a.ts', "export { y } from '../config.ts';"],
    ['src/sim/a.ts', "// import fs from 'node:fs';\n/* import('../harness/run.ts') */"],
    ['src/analysis/a.ts', "import type { SimView } from '../sim/readonly.ts';\nimport { o } from './observer.ts';"],
    ['src/harness/a.ts', "import fs from 'node:fs';\nimport { createStandardSim } from '../sim/index.ts';"],
    ['src/viewer/a.ts', "import { createStandardSim } from '../sim/index.ts';\nimport { getObserver } from '../analysis/index.ts';"],
  ];
  for (const [file, text] of good) {
    assert.deepEqual(checkImports(file, text), [], `wrongly flagged: ${file}: ${text}`);
  }
});

test('every file under src/ respects the import boundaries', () => {
  const sources = readSources('src');
  assert.ok(sources.some((source) => source.path.startsWith('src/sim/')), 'src/sim/ is empty or missing');
  const problems: string[] = [];
  for (const { path, text } of sources) problems.push(...checkImports(path, text));
  assert.deepEqual(problems, []);
});
