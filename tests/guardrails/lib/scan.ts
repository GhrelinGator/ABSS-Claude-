// Shared helpers for the static guardrail tests: finding files, removing
// comments, splitting identifiers into words, and the individual checkers.
// The checkers are pure functions of (file path, source text), so each test
// can prove its checker has teeth by feeding it a deliberately bad sample.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export interface SourceFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  text: string;
}

/** Every file under a repo-relative directory, as sorted repo-relative paths. Empty if the directory is missing. */
export function listFiles(dir: string): string[] {
  const root = join(REPO_ROOT, dir);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute).sort()) {
      const full = join(absolute, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

export function readSources(dir: string, extension = '.ts'): SourceFile[] {
  return listFiles(dir)
    .filter((path) => path.endsWith(extension))
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') }));
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

const REGEX_MAY_FOLLOW = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * Replace comments with spaces, keeping every newline and every character
 * position. With `blankStrings`, the contents of string and template
 * literals are blanked too (the quotes stay).
 */
export function stripComments(text: string, blankStrings = false): string {
  const out = text.split('');
  const n = text.length;
  const templateDepth: number[] = []; // open braces inside each `${ ... }` we are in
  let lastSignificant = '';
  let lastWord = '';
  let i = 0;

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  const skipQuoted = (quote: string): void => {
    const start = i + 1;
    i++;
    while (i < n && text[i] !== quote && text[i] !== '\n') {
      if (text[i] === '\\') i++;
      i++;
    }
    if (blankStrings) blank(start, Math.min(i, n));
    i++;
    lastSignificant = quote;
    lastWord = '';
  };

  // Scan the text part of a template literal starting at i (just after a backtick or a closing brace).
  const scanTemplateText = (): void => {
    const start = i;
    while (i < n) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === '`') {
        if (blankStrings) blank(start, i);
        i++;
        lastSignificant = '`';
        lastWord = '';
        return;
      }
      if (text[i] === '$' && text[i + 1] === '{') {
        if (blankStrings) blank(start, i);
        i += 2;
        templateDepth.push(0);
        lastSignificant = '{';
        lastWord = '';
        return;
      }
      i++;
    }
    if (blankStrings) blank(start, n);
  };

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const start = i;
      while (i < n && text[i] !== '\n') i++;
      blank(start, i);
      continue;
    }
    if (c === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      blank(start, i);
      continue;
    }
    if (c === "'" || c === '"') {
      skipQuoted(c);
      continue;
    }
    if (c === '`') {
      i++;
      scanTemplateText();
      continue;
    }
    if (c === '/') {
      const regexHere = lastSignificant === '' || REGEX_MAY_FOLLOW.has(lastSignificant) || lastWord === 'return';
      if (regexHere) {
        // Regular-expression literal: skip to the closing slash, honouring escapes and character classes.
        i++;
        let inClass = false;
        while (i < n && text[i] !== '\n') {
          if (text[i] === '\\') {
            i += 2;
            continue;
          }
          if (text[i] === '[') inClass = true;
          else if (text[i] === ']') inClass = false;
          else if (text[i] === '/' && !inClass) break;
          i++;
        }
        i++;
        lastSignificant = '/';
        lastWord = '';
        continue;
      }
    }
    if (templateDepth.length > 0) {
      if (c === '{') {
        templateDepth[templateDepth.length - 1]++;
      } else if (c === '}') {
        if (templateDepth[templateDepth.length - 1] === 0) {
          templateDepth.pop();
          i++;
          scanTemplateText();
          continue;
        }
        templateDepth[templateDepth.length - 1]--;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[\w$]/.test(text[i])) i++;
      lastWord = text.slice(start, i);
      lastSignificant = 'a';
      continue;
    }
    if (!/\s/.test(c)) {
      lastSignificant = c;
      lastWord = '';
    }
    i++;
  }
  return out.join('');
}

// ---------------------------------------------------------------- banned terms

export interface Word {
  word: string;
  line: number;
}

/**
 * Split text into lower-case words. Identifiers are split on case changes and
 * on anything that is not a letter, so `religionScore`, `LEADER_ID`, and
 * `trade-off` each yield their parts.
 */
export function splitWords(text: string): Word[] {
  const words: Word[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const run of lines[i].match(/[A-Za-z]+/g) ?? []) {
      for (const part of run.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) ?? []) {
        words.push({ word: part.toLowerCase(), line: i + 1 });
      }
    }
  }
  return words;
}

/** The word itself plus the base forms it could be a simple inflection of (plural, -ed, -ing, -er). */
export function baseForms(word: string): string[] {
  const forms = new Set<string>([word]);
  const add = (stem: string): void => {
    if (stem.length >= 3) forms.add(stem);
  };
  if (word.endsWith('ies') || word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s')) add(word.slice(0, -1));
  for (const suffix of ['ed', 'ing', 'er', 'ers']) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    add(stem);
    add(`${stem}e`);
    const n = stem.length;
    if (n >= 4 && stem[n - 1] === stem[n - 2]) add(stem.slice(0, -1));
  }
  return [...forms];
}

export interface BannedTerms {
  terms: Set<string>;
  categories: string[];
}

/** Read the banned-term list straight out of docs/GUARDRAILS.md §2, so the document is the single source of truth. */
export function loadBannedTerms(): BannedTerms {
  const text = readFileSync(join(REPO_ROOT, 'docs/GUARDRAILS.md'), 'utf8');
  const start = text.indexOf('## 2. Banned terms');
  const end = text.indexOf("**What's allowed**", start);
  if (start < 0 || end < 0) throw new Error('Could not find the banned-term list in docs/GUARDRAILS.md §2.');
  const terms = new Set<string>();
  const categories: string[] = [];
  for (const line of text.slice(start, end).split(/\r?\n/)) {
    const match = /^\*\*([^*]+):\*\*\s*(.+)$/.exec(line);
    if (!match) continue;
    categories.push(match[1]);
    for (const raw of match[2].split(',')) {
      const term = raw.trim().toLowerCase();
      if (!/^[a-z]+$/.test(term)) throw new Error(`Unparseable banned term "${raw}" in docs/GUARDRAILS.md §2.`);
      terms.add(term);
    }
  }
  return { terms, categories };
}

/** Banned terms in a file's path or contents (code, comments, and strings alike). */
export function checkBannedTerms(file: string, text: string, terms: Set<string>): string[] {
  const problems: string[] = [];
  const hit = (word: string): string | null => {
    for (const form of baseForms(word)) if (terms.has(form)) return form;
    return null;
  };
  for (const { word } of splitWords(file)) {
    const term = hit(word);
    if (term) problems.push(`${file}: the path contains "${word}" (banned term "${term}")`);
  }
  for (const { word, line } of splitWords(text)) {
    const term = hit(word);
    if (term) problems.push(`${file}:${line}: "${word}" (banned term "${term}")`);
  }
  return problems;
}

// ---------------------------------------------------------------- imports

export interface ImportRef {
  specifier: string;
  line: number;
}

export interface ParsedImports {
  refs: ImportRef[];
  /** Lines with import(...) or require(...) whose argument is not a plain string literal. */
  opaque: number[];
}

export function parseImports(text: string): ParsedImports {
  const code = stripComments(text);
  const refs: ImportRef[] = [];
  const opaque: number[] = [];
  const seen = new Set<number>();
  const push = (specifier: string, index: number): void => {
    if (seen.has(index)) return;
    seen.add(index);
    refs.push({ specifier, line: lineOf(code, index) });
  };
  for (const m of code.matchAll(/\b(?:import|export)\b[^'";]*?\bfrom\s*(['"])([^'"\n]+)\1/g)) {
    push(m[2], m.index + m[0].length - m[2].length - 1);
  }
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"\n]+)\1/g)) {
    push(m[2], m.index + m[0].length - m[2].length - 1);
  }
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*(?:(['"])([^'"\n]+)\1\s*\))?/g)) {
    if (m[2] === undefined) opaque.push(lineOf(code, m.index));
    else push(m[2], m.index + m[0].indexOf(m[2]));
  }
  return { refs, opaque };
}

function resolveSpecifier(file: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

function under(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/**
 * Import rules (docs/GUARDRAILS.md §1):
 *  - src/sim/ imports only its own files, by relative path. No packages, no
 *    Node built-ins, nothing from analysis, harness, or viewer.
 *  - src/analysis/ imports only its own files and src/sim/readonly.ts.
 *  - src/viewer/ never imports the Node-only harness.
 *  - Nothing under src/ imports from tests/ or bench/.
 */
export function checkImports(file: string, text: string): string[] {
  const problems: string[] = [];
  const { refs, opaque } = parseImports(text);
  const inSim = under(file, 'src/sim');
  const inAnalysis = under(file, 'src/analysis');
  const inViewer = under(file, 'src/viewer');
  const inSrc = under(file, 'src');
  if (inSim || inAnalysis) {
    for (const line of opaque) problems.push(`${file}:${line}: import() or require() with a computed argument`);
  }
  for (const { specifier, line } of refs) {
    const where = `${file}:${line}`;
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!isRelative) {
      if (inSim || inAnalysis) problems.push(`${where}: imports "${specifier}", which is not a relative path`);
      continue;
    }
    const target = resolveSpecifier(file, specifier);
    if (inSrc && (under(target, 'tests') || under(target, 'bench'))) {
      problems.push(`${where}: src/ must not import "${target}"`);
    }
    if (inSim && !under(target, 'src/sim')) {
      problems.push(`${where}: src/sim/ must not import "${target}"`);
    }
    if (inAnalysis && !under(target, 'src/analysis') && target !== 'src/sim/readonly.ts') {
      problems.push(`${where}: src/analysis/ may reach the simulation only through src/sim/readonly.ts, not "${target}"`);
    }
    if (inViewer && under(target, 'src/harness')) {
      problems.push(`${where}: src/viewer/ must not import the Node-only harness ("${target}")`);
    }
    if ((inSim || inAnalysis) && !specifier.endsWith('.ts')) {
      problems.push(`${where}: import "${specifier}" must name a .ts file`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- ambient inputs and non-portable arithmetic

const FORBIDDEN_NAMES = [
  'Date',
  'performance',
  'process',
  'globalThis',
  'window',
  'document',
  'navigator',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'console',
  'crypto',
  'require',
  'eval',
  'WeakRef',
  'FinalizationRegistry',
  'SharedArrayBuffer',
  'Atomics',
  'Worker',
  'Promise',
  'async',
  'await',
  'Intl',
  'localeCompare',
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
];

/** Math members whose results the standard fixes exactly. Everything else on Math is implementation-defined. */
const EXACT_MATH = new Set([
  'abs',
  'ceil',
  'floor',
  'round',
  'trunc',
  'sign',
  'sqrt',
  'min',
  'max',
  'imul',
  'fround',
  'clz32',
  'PI',
  'E',
  'LN2',
  'LN10',
  'LOG2E',
  'LOG10E',
  'SQRT2',
  'SQRT1_2',
]);

/**
 * Things that would make a run depend on anything but its seed and config:
 * clocks, the network, the environment, timers and asynchrony, locale, garbage
 * collection, and arithmetic whose result differs between engines
 * (docs/DESIGN.md §1.5).
 */
export function checkAmbient(file: string, text: string): string[] {
  const problems: string[] = [];
  const code = stripComments(text, true);
  const report = (index: number, message: string): void => {
    problems.push(`${file}:${lineOf(code, index)}: ${message}`);
  };
  for (const name of FORBIDDEN_NAMES) {
    for (const m of code.matchAll(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g'))) {
      report(m.index, `uses "${name}"`);
    }
  }
  for (const m of code.matchAll(/(?<![\w$])(?:new\s+)?Function\s*\(/g)) report(m.index, 'builds code with Function()');
  for (const m of code.matchAll(/(?<![\w$.])Math(?![\w$])\s*(\.\s*([A-Za-z_$][\w$]*))?/g)) {
    if (m[2] === undefined) report(m.index, 'uses the Math object other than as Math.<member>');
    else if (m[2] === 'random') report(m.index, 'uses Math.random (draw from a seeded stream instead)');
    else if (!EXACT_MATH.has(m[2])) {
      report(m.index, `uses Math.${m[2]}, whose result differs between engines; use src/sim/core/dmath.ts (docs/DESIGN.md §1.8)`);
    }
  }
  for (const m of code.matchAll(/\*\*/g)) {
    report(m.index, 'uses the ** operator, whose result differs between engines; multiply, or use pow from src/sim/core/dmath.ts');
  }
  return problems;
}

/** In src/sim/, only the kernel's spawnAgent may assign entity slots (docs/DESIGN.md §1.5). */
export function checkSpawnSites(file: string, text: string): string[] {
  if (file === 'src/sim/sim.ts') return [];
  const problems: string[] = [];
  const code = stripComments(text, true);
  for (const m of code.matchAll(/\.\s*spawn\s*\(/g)) {
    problems.push(`${file}:${lineOf(code, m.index)}: calls .spawn() directly; create agents through spawnAgent`);
  }
  return problems;
}

// ---------------------------------------------------------------- alibis

const MIN_ALIBI_LENGTH = 20;

/**
 * Every call to defineSystem, defineDial, defineDrive, or definePrimitive
 * must sit directly under a comment block containing `ALIBI:` followed by a
 * real sentence.
 */
export function checkAlibis(file: string, text: string): string[] {
  const problems: string[] = [];
  const code = stripComments(text, true);
  const rawLines = text.split('\n');
  for (const m of code.matchAll(/(?<![\w$])define(System|Dial|Drive|Primitive)\s*\(/g)) {
    const before = code.slice(0, m.index).trimEnd();
    if (/(?<![\w$])function$/.test(before)) continue; // the definition of the function itself
    const line = lineOf(code, m.index);
    const comment: string[] = [];
    for (let k = line - 2; k >= 0; k--) {
      const trimmed = rawLines[k].trim();
      if (!trimmed.startsWith('//')) break;
      comment.unshift(trimmed.replace(/^\/\/+\s?/, ''));
    }
    const joined = comment.join(' ');
    const at = joined.indexOf('ALIBI:');
    const reason = at < 0 ? '' : joined.slice(at + 'ALIBI:'.length).replace(/\s+/g, ' ').trim();
    if (at < 0) {
      problems.push(`${file}:${line}: define${m[1]} call has no "// ALIBI:" comment directly above it`);
    } else if (reason.length < MIN_ALIBI_LENGTH) {
      problems.push(`${file}:${line}: the ALIBI above define${m[1]} is too short to be a reason`);
    }
  }
  return problems;
}
