// Builds the viewer page into dist/site/ without installing anything
// (docs/DESIGN.md §10.1).
//
//   node --no-warnings scripts/build-site.ts [--out dist/site]
//
// Starting from src/viewer/main.ts, it follows the imports, strips the
// TypeScript types from each file with Node's built-in stripper, rewrites
// relative ".ts" imports to ".js", and writes plain ES modules that browsers
// load directly. Only files reachable from the entry point are copied.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = 'src/viewer/main.ts';
const STATIC_FILES = ['src/viewer/index.html', 'src/viewer/style.css'];

const { values } = parseArgs({ options: { out: { type: 'string', default: 'dist/site' } } });
const OUT = resolve(ROOT, values.out ?? 'dist/site');

const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

function commitInfo(): { commit: string; builtAt: string } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const builtAt = execFileSync('git', ['show', '-s', '--format=%cs', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return { commit, builtAt };
  } catch {
    return { commit: 'development', builtAt: '' };
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const pending = [ENTRY];
const done = new Set<string>();
const problems: string[] = [];

while (pending.length > 0) {
  const file = pending.pop() as string;
  if (done.has(file)) continue;
  done.add(file);
  const source = readFileSync(join(ROOT, file), 'utf8');
  let code: string = stripTypeScriptTypes(source, { mode: 'strip' });
  code = code.replace(IMPORT, (_match: string, lead: string, quote: string, specifier: string) => {
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (!specifier.endsWith('.ts')) {
      problems.push(`${file}: import "${specifier}" does not name a .ts file`);
      return `${lead}${quote}${specifier}${quote}`;
    }
    if (!existsSync(join(ROOT, target))) problems.push(`${file}: import "${specifier}" does not exist`);
    else pending.push(target);
    return `${lead}${quote}${specifier.slice(0, -3)}.js${quote}`;
  });
  if (file === 'src/viewer/build-info.ts') {
    code = `export const BUILD = ${JSON.stringify(commitInfo())};\n`;
  }
  const out = join(OUT, file.slice(0, -3) + '.js');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, code);
}

for (const file of STATIC_FILES) copyFileSync(join(ROOT, file), join(OUT, posix.basename(file)));
// GitHub Pages: serve files as they are, without Jekyll processing.
writeFileSync(join(OUT, '.nojekyll'), '');

if (problems.length > 0) {
  console.error(`Build failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Built ${done.size} modules and ${STATIC_FILES.length} static files into ${relative(ROOT, OUT) || '.'}/`);
