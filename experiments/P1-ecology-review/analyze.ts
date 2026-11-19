// Analysis for the P1 ecology review (see preregistration.md in this folder).
//   node experiments/P1-ecology-review/analyze.ts runs/P1-ecology-review
// Prints a markdown summary: per-run populations, plant cover, fire, the landscape check,
// and a verdict on each preregistered criterion.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'runs/P1-ecology-review';
const CELLS = 512 * 512;
const KINDS = ['deer', 'aurochs', 'wolf', 'cat', 'hare'] as const;
type Row = Record<string, Record<string, number> | number>;

interface Run {
  condition: string;
  seed: number;
  rows: Row[];
}

const runs: Run[] = [];
for (const condition of readdirSync(root).filter((d) => !d.includes('.')).sort()) {
  for (const dir of readdirSync(join(root, condition)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))) {
    const file = join(root, condition, dir, 'metrics.jsonl');
    if (!existsSync(file)) continue;
    const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
    if (rows.length > 0) runs.push({ condition, seed: Number(dir.slice(5)), rows });
  }
}
const get = (row: Row, observer: string, key: string): number => {
  const o = row[observer];
  return typeof o === 'object' && o !== null && typeof o[key] === 'number' ? o[key] : NaN;
};

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const lines: string[] = [];
const out = (s = '') => lines.push(s);

out(`Runs found: ${runs.length} (${runs.map((r) => r.rows.length).join(', ')} samples each)`);
out();

// ---- Animals ----
let extinctions: string[] = [];
let overgrowth: string[] = [];
const nearCascade: Record<string, number> = {};
const trends: string[] = [];
out('## Animals (per km² of land): start → end [min–max]');
out();
out(`| run | ${KINDS.join(' | ')} |`);
out(`|---|${KINDS.map(() => '---').join('|')}|`);
for (const run of runs) {
  const cells: string[] = [];
  for (const kind of KINDS) {
    const series = run.rows.map((r) => get(r, 'fauna', `${kind}.perKm2`));
    const start = series[0];
    const end = series[series.length - 1];
    const min = Math.min(...series);
    const max = Math.max(...series);
    if (series.slice(1).some((v) => !(v > 0))) extinctions.push(`${run.condition} seed ${run.seed}: ${kind}`);
    if (max > 5 * start) overgrowth.push(`${run.condition} seed ${run.seed}: ${kind} ${fmt(max / start, 1)}× start`);
    if (min < 0.05 * start) nearCascade[kind] = (nearCascade[kind] ?? 0) + 1;
    if (series.length >= 101) {
      const mean = (a: number, b: number) => series.slice(a, b + 1).reduce((s, v) => s + v, 0) / (b - a + 1);
      const ratio = mean(91, 100) / mean(71, 80);
      if (ratio > 2 || ratio < 0.5) trends.push(`${run.condition} seed ${run.seed}: ${kind} ${fmt(ratio)}× from years 71–80 to 91–100`);
    }
    const d = kind === 'wolf' || kind === 'cat' ? 100 : 1;
    cells.push(`${fmt(start * d)} → ${fmt(end * d)} [${fmt(min * d)}–${fmt(max * d)}]`);
  }
  out(`| ${run.condition} ${run.seed} | ${cells.join(' | ')} |`);
}
out();
out('Wolves and big cats are per 100 km².');
out();

// ---- Plants ----
const species = Object.keys((runs[0]?.rows[0]?.vegetation as Record<string, number>) ?? {})
  .filter((k) => k.startsWith('cover.'))
  .map((k) => k.slice(6));
const plantWarnings: string[] = [];
const plantLosses: string[] = [];
out('## Plants: end cover ÷ start cover (lowest over the run in brackets)');
out();
out(`| run | ${species.join(' | ')} |`);
out(`|---|${species.map(() => '---').join('|')}|`);
for (const run of runs) {
  const cells: string[] = [];
  for (const sp of species) {
    const series = run.rows.map((r) => get(r, 'vegetation', `cover.${sp}`));
    const start = series[0];
    const end = series[series.length - 1];
    const min = Math.min(...series);
    if (series.slice(1).some((v) => !(v > 0))) plantLosses.push(`${run.condition} seed ${run.seed}: ${sp}`);
    if (end < 0.2 * start) plantWarnings.push(`${run.condition} seed ${run.seed}: ${sp} ends at ${fmt(end / start)} of start`);
    cells.push(`${fmt(end / start)} (${fmt(min / start)})`);
  }
  out(`| ${run.condition} ${run.seed} | ${cells.join(' | ')} |`);
}
out();

// ---- Fire ----
out('## Fire');
out();
out('| run | land cells | fires lit by lightning | holdovers | cells burned | mean burned per compressed year | worst year |');
out('|---|---|---|---|---|---|---|');
let burnedShareSum = 0;
let yearsCounted = 0;
let worstYear = 0;
let worstRun = '';
let runsWithFire = 0;
for (const run of runs) {
  const first = run.rows[0];
  const water = get(first, 'landscape', 'springFraction') + get(first, 'landscape', 'riverFraction') + get(first, 'landscape', 'lakeFraction');
  const land = CELLS * (1 - water);
  const burned = run.rows.map((r) => get(r, 'fire', 'cellsIgnited'));
  let worst = 0;
  for (let y = 1; y < burned.length; y++) {
    const share = (burned[y] - burned[y - 1]) / land;
    burnedShareSum += share;
    yearsCounted++;
    if (share > worst) worst = share;
  }
  if (worst > worstYear) {
    worstYear = worst;
    worstRun = `${run.condition} seed ${run.seed}`;
  }
  const last = run.rows[run.rows.length - 1];
  if (burned[burned.length - 1] > 0) runsWithFire++;
  const years = burned.length - 1;
  out(
    `| ${run.condition} ${run.seed} | ${Math.round(land)} | ${get(last, 'fire', 'lightningIgnitions')} | ${get(last, 'fire', 'holdovers')} | ${burned[burned.length - 1]} | ${fmt((100 * burned[burned.length - 1]) / land / years, 3)}% | ${fmt(100 * worst, 2)}% |`,
  );
}
const meanBurned = yearsCounted > 0 ? burnedShareSum / yearsCounted : NaN;
out();
out(`Mean burned share across all runs: ${fmt(100 * meanBurned, 4)}% of land per compressed year. Worst single year: ${fmt(100 * worstYear, 2)}% (${worstRun}). Runs with any fire: ${runsWithFire} of ${runs.length}.`);
out();

// ---- Landscape ----
out('## Landscape types (year 0)');
out();
out('| seed | enclosed edge per cell: open → hemmed | map edge per cell: open → hemmed | habitable: open → hemmed |');
out('|---|---|---|---|');
const landscapeFails: number[] = [];
const seeds = [...new Set(runs.map((r) => r.seed))].sort((a, b) => a - b);
for (const seed of seeds) {
  const o = runs.find((r) => r.seed === seed && r.condition === 'open');
  const h = runs.find((r) => r.seed === seed && r.condition === 'hemmed');
  if (!o || !h) continue;
  const g = (r: Run, k: string) => get(r.rows[0], 'landscape', k);
  const ok = g(h, 'enclosedEdgePerCell') > g(o, 'enclosedEdgePerCell') && g(h, 'mapEdgePerCell') < g(o, 'mapEdgePerCell');
  if (!ok) landscapeFails.push(seed);
  out(
    `| ${seed} | ${fmt(g(o, 'enclosedEdgePerCell'), 4)} → ${fmt(g(h, 'enclosedEdgePerCell'), 4)} | ${fmt(g(o, 'mapEdgePerCell'), 4)} → ${fmt(g(h, 'mapEdgePerCell'), 4)} | ${fmt(g(o, 'habitableFraction'))} → ${fmt(g(h, 'habitableFraction'))} |`,
  );
}
out();

// ---- Verdicts ----
const pass = (b: boolean) => (b ? '**pass**' : '**FAIL**');
const persistence = extinctions.length === 0 && plantLosses.length === 0;
const bounded = overgrowth.length === 0;
const fireOk = runsWithFire > 0 && meanBurned <= 0.005 && worstYear <= 0.25;
out('## Criteria');
out();
out(`1. Persistence: ${pass(persistence)}.${extinctions.length + plantLosses.length > 0 ? ` Lost: ${[...extinctions, ...plantLosses].join('; ')}.` : ''}`);
out(`2. Bounded (never above 5× start): ${pass(bounded)}.${overgrowth.length > 0 ? ` ${overgrowth.join('; ')}.` : ''}`);
out(`3. Fire: ${pass(fireOk)} (any fire: ${runsWithFire > 0}; mean ${fmt(100 * meanBurned, 4)}% ≤ 0.5%; worst year ${fmt(100 * worstYear, 2)}% ≤ 25%).`);
out(`4. Both landscape types: ${pass(landscapeFails.length === 0)}.${landscapeFails.length > 0 ? ` Seeds where hemmed was not more walled in: ${landscapeFails.join(', ')}.` : ''}`);
out('5. Viewer: checked by `npm test` and CI, reported separately.');
out();
out('## Warnings');
out();
const nc = Object.entries(nearCascade).filter(([, n]) => n > 2);
out(`- Below 5% of start in more than 2 runs: ${nc.length > 0 ? nc.map(([k, n]) => `${k} (${n} runs)`).join(', ') : 'none'}.`);
out(`- Plant species ending below 20% of start: ${plantWarnings.length > 0 ? plantWarnings.join('; ') : 'none'}.`);
out(`- Still changing fast over the last 30 years (more than 2× or less than 0.5×): ${trends.length > 0 ? trends.join('; ') : 'none'}.`);
console.log(lines.join('\n'));
