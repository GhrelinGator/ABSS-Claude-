// The page the browser loads is built by scripts/build-site.ts. This checks
// that the build works and that the simulation inside it is the same
// simulation the tests run: the built JavaScript produces the same state
// fingerprint as the TypeScript source.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createStandardSim, defaultConfig, hashSim, stepSim, validateConfig } from '../../src/sim/index.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = mkdtempSync(join(tmpdir(), 'abss-site-'));
after(() => rmSync(OUT, { recursive: true, force: true }));

execFileSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/build-site.ts'), '--out', OUT], { stdio: 'pipe' });

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

test('the build produces the page, its styles, and plain JavaScript modules', () => {
  for (const file of ['index.html', 'style.css', 'src/viewer/main.js', 'src/sim/index.js', 'src/analysis/index.js']) {
    assert.ok(existsSync(join(OUT, file)), `missing ${file}`);
  }
  const html = readFileSync(join(OUT, 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="\.\/src\/viewer\/main\.js"><\/script>/);
  const modules = filesUnder(OUT).filter((file) => file.endsWith('.js'));
  assert.ok(modules.length > 10);
  for (const file of modules) {
    const code = readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /from\s*['"][^'"]+\.ts['"]/, `${file} still imports a .ts file`);
    assert.doesNotMatch(code, /\bimport\s+type\b|\bexport\s+type\b|\binterface\s+\w+\s*\{/, `${file} still has type syntax`);
  }
  // Nothing from the Node-only harness, tests, or benchmark ends up on the page.
  assert.ok(!existsSync(join(OUT, 'src/harness')));
  assert.ok(!existsSync(join(OUT, 'tests')));
  assert.ok(!existsSync(join(OUT, 'bench')));
  assert.match(readFileSync(join(OUT, 'src/viewer/build-info.js'), 'utf8'), /"commit":"[0-9a-f]{40}"|"commit":"development"/);
});

test('the built simulation is the same simulation: identical state fingerprints', async () => {
  const built = await import(pathToFileURL(join(OUT, 'src/sim/index.js')).href);
  const raw = JSON.parse(JSON.stringify(defaultConfig(11)));
  raw.world.widthCells = 128;
  raw.world.heightCells = 128;
  raw.world.circumscription = 0.8;
  const config = validateConfig(raw);

  const fromSource = createStandardSim(config);
  const fromBuild = built.createStandardSim(config);
  stepSim(fromSource, 300);
  built.stepSim(fromBuild, 300);
  assert.equal(built.hashSim(fromBuild), hashSim(fromSource));
  assert.deepEqual(built.arithmeticProblems(), []);
});
