// Guardrail: every mechanism, dial, drive, and action primitive in src/sim/
// is created through a define* function, and every such call sits directly
// under an `// ALIBI:` comment (CLAUDE.md rule 1, docs/GUARDRAILS.md §3).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig } from '../../src/sim/config.ts';
import { defineDial, defineDrive, definePrimitive, defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { createSim } from '../../src/sim/sim.ts';
import { checkAlibis, readSources } from './lib/scan.ts';

test('the checker catches missing, short, and detached alibis', () => {
  const bad = [
    "export const a = defineSystem({ name: 'x', create() { return () => {}; } });",
    "// Hunger.\nexport const a = defineDrive({ name: 'hunger' });",
    "// ALIBI: because\nexport const a = defineDrive({ name: 'hunger' });",
    "// ALIBI: bodies need energy to keep running at all\n\nexport const a = defineDrive({ name: 'hunger' });",
    "// ALIBI: bodies need energy to keep running at all\nconst other = 1;\nexport const a = definePrimitive({ name: 'consume' });",
    "export const d = defineDial({ name: 'bodySize', min: 0, max: 1, neutral: 0.5 }); // ALIBI: larger bodies store more",
  ];
  for (const sample of bad) {
    assert.ok(checkAlibis('src/sim/sample.ts', sample).length > 0, `not flagged: ${sample}`);
  }
});

test('the checker accepts a real alibi and ignores non-calls', () => {
  const good = [
    [
      '// Hunger rises as reserves fall.',
      '// ALIBI: an animal that does not look for food when its reserves run low',
      '// starves, whether or not it ever meets another of its kind.',
      "export const hunger = defineDrive({ name: 'hunger' });",
    ].join('\n'),
    'export function defineSystem(spec: SystemSpec): SystemDef {\n  return spec;\n}',
    "export { defineDial, defineDrive } from './core/registry.ts';",
    '// Call defineSystem(...) to register a mechanism.',
    "const hint = 'use defineSystem( here';",
  ];
  for (const sample of good) {
    assert.deepEqual(checkAlibis('src/sim/sample.ts', sample), [], `wrongly flagged: ${sample}`);
  }
});

test('every define* call in src/sim/ has an alibi', () => {
  const sources = readSources('src/sim');
  assert.ok(sources.length > 0, 'src/sim/ is empty or missing');
  const problems: string[] = [];
  for (const { path, text } of sources) problems.push(...checkAlibis(path, text));
  assert.deepEqual(problems, []);
});

test('a pipeline accepts only systems made by defineSystem', () => {
  const forged = { name: 'forged.system', every: 1, declare: null, create: () => () => {} };
  assert.throws(() => createSim(defaultConfig(1), [forged as unknown as SystemDef]), /defineSystem/);
  const real = defineSystem({ name: 'fixture.noop', create: () => () => {} });
  assert.doesNotThrow(() => createSim(defaultConfig(1), [real]));
  assert.throws(() => createSim(defaultConfig(1), [real, real]), /twice/);
});

test('a dial must be able to reach its neutral value', () => {
  assert.throws(() => defineDial({ name: 'fixture.dial', min: 0, max: 1, neutral: 2 }), /neutral/);
  assert.throws(() => defineDial({ name: 'fixture.dial', min: 1, max: 1, neutral: 1 }), /min < max/);
  const dial = defineDial({ name: 'fixture.dial', min: -1, max: 1, neutral: 0 });
  assert.equal(dial.neutral, 0);
  assert.throws(() => defineDrive({ name: 'Not A Name' }), /Invalid drive name/);
  assert.throws(() => definePrimitive({ name: '' }), /Invalid primitive name/);
});
