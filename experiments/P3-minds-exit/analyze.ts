// Phase 3's exit checks: the analysis written in the preregistration, applied to results/*.json.
//
//   node experiments/P3-minds-exit/analyze.ts [resultsDir=experiments/P3-minds-exit/results]
//
// Every threshold here is the preregistration's (preregistration.md); change neither without the other,
// and log any change (GUARDRAILS.md T10).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Run = {
  condition: string;
  seed: number;
  founders: number;
  aliveByDay: number[];
  deaths: Record<string, number>;
  founderDays: number;
  check1: { aliveAt20: boolean; kcal1: number; awakeH1: number; eatH1: number; kcal2: number; awakeH2: number; eatH2: number }[];
  check2: { species: string[]; toxic: boolean[]; kgW1: number[]; kgW2: number[] };
  check3: { harmEvents: number; founderHours: number; meanPain: number; perFounder: { bias: number; harm: number; hours: number }[] };
  check4: {
    posited: number;
    strengthened: number;
    nodes: { slot: number; bias: number; dominant: number; domNow: number; hours: number; events: number; baseRate: number }[];
  };
  births: { womanDays: number; meanFactor: number; aboveHalf: number; zero: number; actChance: number };
};

const dir = process.argv[2] ?? 'experiments/P3-minds-exit/results';
const runs: Run[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Run);
const by = (c: string) => new Map(runs.filter((r) => r.condition === c).map((r) => [r.seed, r]));
const learn = by('learn');
const blank = by('blank');
const gut0 = by('gut0');
const bias0 = by('bias0');
const bias1 = by('bias1');
const seeds = [...learn.keys()].sort((a, b) => a - b);
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const gmean = (a: number[]) => Math.exp(a.reduce((s, v) => s + Math.log(v), 0) / a.length);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / Math.max(1, a.length - 1));
const verdict = (ok: boolean) => (ok ? '**PASS**' : '**FAIL**');

console.log(`# Phase 3 exit checks: results\n`);
console.log(`Seeds ${seeds.join(', ')}; conditions found: ${[...new Set(runs.map((r) => r.condition))].join(', ')}.\n`);

// ---------------------------------------------------------------- check 1
function rates(r: Run) {
  const a = r.check1.filter((x) => x.aliveAt20);
  const s = (g: (x: (typeof a)[number]) => number) => a.reduce((t, x) => t + g(x), 0);
  return {
    n: a.length,
    early: s((x) => x.kcal1) / s((x) => x.awakeH1),
    late: s((x) => x.kcal2) / s((x) => x.awakeH2),
    handEarly: s((x) => x.kcal1) / s((x) => x.eatH1),
    handLate: s((x) => x.kcal2) / s((x) => x.eatH2),
    eatShareEarly: s((x) => x.eatH1) / s((x) => x.awakeH1),
    eatShareLate: s((x) => x.eatH2) / s((x) => x.awakeH2),
  };
}
console.log(`## Check 1: foraging efficiency rises over a lifetime against the random-policy baseline (§7.1)\n`);
console.log(`Founders alive at day 20; kcal taken in per awake hour in day 1 (A) and days 16–20 (B); rise = B ÷ A; statistic = rise(learn) ÷ rise(blank).\n`);
console.log(`| seed | learn: n, A, B, rise | blank: n, A, B, rise | statistic | learn handling A → B (kcal/h eating) | learn share of awake hours eating A → B |`);
console.log(`|---|---|---|---|---|---|`);
const stat1: number[] = [];
for (const s of seeds) {
  const L = rates(learn.get(s)!);
  const B = rates(blank.get(s)!);
  const st = L.late / L.early / (B.late / B.early);
  stat1.push(st);
  console.log(
    `| ${s} | ${L.n}, ${f(L.early, 0)}, ${f(L.late, 0)}, ${f(L.late / L.early)} | ${B.n}, ${f(B.early, 0)}, ${f(B.late, 0)}, ${f(B.late / B.early)} | ${f(st)} | ${f(L.handEarly, 0)} → ${f(L.handLate, 0)} | ${pct(L.eatShareEarly)} → ${pct(L.eatShareLate)} |`,
  );
}
const over1 = stat1.filter((v) => v > 1.25).length;
const g1 = gmean(stat1);
console.log(`\nStatistic above 1.25 on ${over1} of ${seeds.length} seeds (needs 7 of 8); geometric mean ${f(g1)} (needs > 1.25). ${verdict(over1 >= 7 && g1 > 1.25)}`);
const level1 = seeds.map((s) => rates(learn.get(s)!).late / rates(blank.get(s)!).late);
console.log(`Secondary (the level): learners' rate in days 16–20 ÷ blank minds', geometric mean ${f(gmean(level1))}, above 1.5 on ${level1.filter((v) => v > 1.5).length} of ${seeds.length} seeds.\n`);

// ---------------------------------------------------------------- check 2
function toxicShare(kg: number[], toxic: boolean[]): number {
  let all = 0;
  let bad = 0;
  kg.forEach((v, i) => {
    all += v;
    if (toxic[i]) bad += v;
  });
  return all > 0 ? bad / all : NaN;
}
const dP = (r: Run) => toxicShare(r.check2.kgW2, r.check2.toxic) - toxicShare(r.check2.kgW1, r.check2.toxic);
console.log(`## Check 2: agents learn to avoid delayed-toxic plants at a measurable rate\n`);
console.log(`Toxic share = kg of bitter root and nightshade ÷ kg of all plants eaten; ΔP = share in days 16–20 − share in days 1–5; statistic = ΔP(learn) − ΔP(gut0).\n`);
console.log(`| seed | learn: share 1–5 → 16–20 (ΔP) | gut0: ΔP | blank: ΔP | statistic | ΔP(learn) − ΔP(blank) |`);
console.log(`|---|---|---|---|---|---|`);
const stat2: number[] = [];
const vsBlank2: number[] = [];
const dLearn: number[] = [];
for (const s of seeds) {
  const L = learn.get(s)!;
  const p1 = toxicShare(L.check2.kgW1, L.check2.toxic);
  const p2 = toxicShare(L.check2.kgW2, L.check2.toxic);
  const st = dP(L) - dP(gut0.get(s)!);
  stat2.push(st);
  vsBlank2.push(dP(L) - dP(blank.get(s)!));
  dLearn.push(dP(L));
  console.log(`| ${s} | ${pct(p1)} → ${pct(p2)} (${f(100 * dP(L), 1)} pp) | ${f(100 * dP(gut0.get(s)!), 1)} pp | ${f(100 * dP(blank.get(s)!), 1)} pp | ${f(100 * st, 1)} pp | ${f(100 * vsBlank2[vsBlank2.length - 1], 1)} pp |`);
}
const neg2 = stat2.filter((v) => v < 0).length;
const m2 = mean(stat2);
console.log(`\nStatistic negative on ${neg2} of ${seeds.length} seeds (needs 7 of 8); mean ${f(100 * m2, 1)} pp (needs ≤ −5). ${verdict(neg2 >= 7 && m2 <= -0.05)}`);
console.log(`The rate: learners' toxic share changed by ${f(100 * mean(dLearn), 1)} pp (sd ${f(100 * sd(dLearn), 1)}) from days 1–5 to days 16–20, about ${f((100 * mean(dLearn)) / 15, 2)} pp a day.\n`);

// ---------------------------------------------------------------- check 3
console.log(`## Check 3: hidden-cause nodes form, and where real hidden causes exist they reduce harm against hiddenCauseBias = 0\n`);
const formed = seeds.every((s) => bias1.get(s)!.check4.posited > 0 && learn.get(s)!.check4.posited > 0);
const none0 = seeds.every((s) => bias0.get(s)!.check4.posited === 0);
console.log(`(a) Nodes posited in every bias1 and learn run: ${formed ? 'yes' : 'no'}; none in any bias0 run (the ablation works): ${none0 ? 'yes' : 'no'}. ${verdict(formed && none0)}\n`);
console.log(`| seed | bias1: killed by animals / founder-days | bias0 | learn | harm events per founder-day: bias1, bias0, learn | mean pain: bias1, bias0 | nodes posited: bias1, learn |`);
console.log(`|---|---|---|---|---|---|---|`);
let a1 = 0;
let d1 = 0;
let a0 = 0;
let d0 = 0;
const harmRatio: number[] = [];
for (const s of seeds) {
  const x = bias1.get(s)!;
  const y = bias0.get(s)!;
  const z = learn.get(s)!;
  a1 += x.deaths.animal;
  d1 += x.founderDays;
  a0 += y.deaths.animal;
  d0 += y.founderDays;
  const h = (r: Run) => (24 * r.check3.harmEvents) / r.check3.founderHours;
  harmRatio.push(h(x) / h(y));
  console.log(
    `| ${s} | ${x.deaths.animal} / ${f(x.founderDays, 0)} | ${y.deaths.animal} / ${f(y.founderDays, 0)} | ${z.deaths.animal} / ${f(z.founderDays, 0)} | ${f(h(x))}, ${f(h(y))}, ${f(h(z))} | ${f(x.check3.meanPain, 3)}, ${f(y.check3.meanPain, 3)} | ${x.check4.posited}, ${z.check4.posited} |`,
  );
}
// Exact conditional test: given n = a1 + a0 deaths, a1 ~ Binomial(n, d1 ÷ (d1 + d0)) under equal rates.
function binomLowerTail(k: number, n: number, p: number): number {
  let sum = 0;
  let term = Math.pow(1 - p, n);
  for (let i = 0; i <= k; i++) {
    sum += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.min(1, sum);
}
const rr = a1 / d1 / (a0 / d0);
const p3 = binomLowerTail(a1, a1 + a0, d1 / (d1 + d0));
console.log(`\n(b) Killed by animals per 1,000 founder-days, pooled: bias1 ${f((1000 * a1) / d1)} (${a1}), bias0 ${f((1000 * a0) / d0)} (${a0}); rate ratio ${f(rr)} (needs ≤ 0.8); one-sided exact p = ${f(p3, 3)} (needs < 0.05). ${verdict(rr <= 0.8 && p3 < 0.05)}`);
console.log(`Secondary: harm events per founder-day, bias1 ÷ bias0, below 1 on ${harmRatio.filter((v) => v < 1).length} of ${seeds.length} seeds; geometric mean ${f(gmean(harmRatio))}.`);
// Within the learn runs: founders whose genome expresses bias > 0 against those at 0.
let hp = 0;
let hh = 0;
let zp = 0;
let zh = 0;
for (const s of seeds) {
  for (const p of learn.get(s)!.check3.perFounder) {
    if (p.bias > 0) {
      hp += p.harm;
      hh += p.hours;
    } else {
      zp += p.harm;
      zh += p.hours;
    }
  }
}
console.log(`Within the learn runs: harm events per founder-day ${f((24 * hp) / hh)} for founders expressing a bias above 0, ${f((24 * zp) / zh)} for those at 0.\n`);

// ---------------------------------------------------------------- check 4
const CH = ['hunger', 'thirst', 'cold', 'heat', 'pain', 'fatigue', 'mating', 'separation'];
function classify(rs: Run[], cut: number) {
  let classified = 0;
  let spurious = 0;
  const perSeed: number[] = [];
  const byCh = new Map<string, [number, number]>();
  for (const r of rs) {
    let c = 0;
    let sp = 0;
    for (const nd of r.check4.nodes) {
      if (nd.hours < 24 || Math.abs(nd.domNow) < 0.005 || !(nd.baseRate > 0)) continue;
      c++;
      const ratio = nd.events / nd.hours / nd.baseRate;
      const isSp = ratio <= cut;
      if (isSp) sp++;
      const key = `${CH[nd.dominant]} ${nd.domNow >= 0 ? 'rising' : 'falling'}`;
      const e = byCh.get(key) ?? [0, 0];
      e[0]++;
      if (isSp) e[1]++;
      byCh.set(key, e);
    }
    classified += c;
    spurious += sp;
    if (c > 0) perSeed.push(sp / c);
  }
  return { classified, spurious, perSeed, byCh };
}
function wilson(k: number, n: number): [number, number] {
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [mid - half, mid + half];
}
console.log(`## Check 4: spurious hidden-cause associations have a measurable base rate\n`);
console.log(`Nodes held by living founders (snapshots at days 10, 20, 30, 40); classified when active at least 24 founder-hours and predicting a change of at least 0.005; spurious when the predicted channel moves the predicted way (≥ 0.05 in an hour) no more often where the node is active than over all founder-hours (ratio ≤ 1).\n`);
for (const [name, rs] of [
  ['bias1 (primary)', [...bias1.values()]],
  ['learn', [...learn.values()]],
] as const) {
  const c = classify(rs, 1);
  const s125 = classify(rs, 1.25);
  const [lo, hi] = wilson(c.spurious, c.classified);
  const ok = c.classified >= 50 && (hi - lo) / 2 <= 0.1;
  console.log(
    `${name}: ${c.spurious} of ${c.classified} classified nodes spurious, base rate ${pct(c.spurious / c.classified)} (95% interval ${pct(lo)}–${pct(hi)}); per seed mean ${pct(mean(c.perSeed))}, sd ${pct(sd(c.perSeed))}; with a cut of 1.25, ${pct(s125.spurious / s125.classified)}.${name.startsWith('bias1') ? ` ${verdict(ok)}` : ''}`,
  );
  console.log(`  by the channel predicted: ${[...c.byCh.entries()].sort((a, b) => b[1][0] - a[1][0]).map(([k, [n, sp]]) => `${k} ${sp}/${n}`).join(', ')}`);
}

// ---------------------------------------------------------------- births and survival
console.log(`\n## Survival and the births reading (descriptions, not checks)\n`);
console.log(`| seed | alive at day 5, 10, …, 40: learn | blank | deaths, learn |`);
console.log(`|---|---|---|---|`);
for (const s of seeds) {
  const L = learn.get(s)!;
  const causes = Object.entries(L.deaths).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`| ${s} | ${L.aliveByDay.join(' ')} | ${blank.get(s)!.aliveByDay.join(' ')} | ${causes} |`);
}
let wd = 0;
let fs = 0;
let above = 0;
let zero = 0;
for (const s of seeds) {
  const b = learn.get(s)!.births;
  wd += b.womanDays;
  fs += b.meanFactor * b.womanDays;
  above += b.aboveHalf;
  zero += b.zero;
  void s;
}
const actChance = learn.get(seeds[0])!.births.actChance;
console.log(`\nLearners, all seeds: ${wd} woman-days; mean fertility factor ${f(fs / wd, 4)}; above 0.5 on ${above}, zero on ${zero}. Conceptions expected if every woman mated every second day with a man at peak fecundity: ${f(0.5 * actChance * fs, 2)}.`);
