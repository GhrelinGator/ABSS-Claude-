// Phase 2's exit check, criterion 3 (preregistration.md in this folder): bodies driven by a random
// policy on a real world, and what they die of. Scripted behaviour from tests/ only; nothing here
// enters src/.
//
//   node experiments/P2-bodies-exit/random-policy.ts <seed> [bodies] [years]

import { defaultConfig } from '../../src/sim/config.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import { auditConserved } from '../../src/sim/core/audit.ts';
import { StreamDomain, globalStreamOffset, nextChance, nextFloat, nextInt } from '../../src/sim/core/rng.ts';
import { ticksPerYear } from '../../src/sim/core/clock.ts';
import { BODY_COLUMNS, BODY_PARTS, DeathCause, ingest } from '../../src/sim/body/metabolism.ts';
import { SURROUNDINGS, drink } from '../../src/sim/body/heat.ts';
import { exposeGut, injure, waterDose } from '../../src/sim/body/injury.ts';
import { exposure } from '../../src/sim/body/exposure.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';
import { HADZA_MAN, HADZA_WOMAN, spawnWithBody } from '../../tests/fixtures/bodies.ts';

const seed = Number(process.argv[2] ?? 1);
const N = Number(process.argv[3] ?? 600);
const YEARS = Number(process.argv[4] ?? 4);

const CAUSE_NAMES = Object.fromEntries(Object.entries(DeathCause).map(([k, v]) => [v, k.toLowerCase()])) as Record<number, string>;

// Per-slot supply, set once at formation (no births, so slots are never reused in this run).
const foodPerDay = new Float64Array(N);
const waterPerDay = new Float64Array(N);
// The current hour's choices.
const hourEffort = new Uint8Array(N);
const hourWalkS = new Float64Array(N);
const hourSpeed = new Float64Array(N);

// ALIBI: a test stand-in for Phase 3's acts, so bodies have something to die of; not part of any real run.
const randomPolicy = defineSystem({
  name: 'fixture.randomPolicy',
  create(sim: Sim) {
    const { state } = sim;
    const agents = state.agents;
    const streams = state.streams;
    const o = globalStreamOffset(StreamDomain.FIXTURE);
    const perHour = sim.config.time.ticksPerDay / 24;
    const secondsPerTick = 86_400 / sim.config.time.ticksPerDay;
    return () => {
      const effort = agents.column<Uint8Array>(BODY_COLUMNS.effort.name).data;
      const moved = agents.column<Float64Array>(BODY_COLUMNS.movedM.name).data;
      const moving = agents.column<Float64Array>(BODY_COLUMNS.movingS.name).data;
      const onHour = state.tick % perHour === 0;
      for (let slot = 0; slot < N; slot++) {
        if (!agents.isAlive(slot)) continue;
        if (onHour) {
          hourEffort[slot] = nextInt(streams, o, 5);
          hourWalkS[slot] = nextChance(streams, o, 0.3) ? nextFloat(streams, o) * secondsPerTick : 0;
          hourSpeed[slot] = nextFloat(streams, o) * 2;
          if (nextChance(streams, o, 0.25)) {
            const kcal = nextFloat(streams, o) * 2 * (foodPerDay[slot] / 6);
            if (kcal > 0) ingest(sim, slot, kcal);
          }
          if (nextChance(streams, o, 0.5)) {
            const kg = nextFloat(streams, o) * 2 * (waterPerDay[slot] / 12);
            if (kg > 0) drink(sim, slot, kg);
          }
        }
        effort[slot] = hourEffort[slot];
        if (hourWalkS[slot] > 0) {
          moving[slot] = hourWalkS[slot];
          moved[slot] = hourWalkS[slot] * hourSpeed[slot];
        }
        if (nextChance(streams, o, 0.0002)) {
          injure(sim, slot, {
            openCm2: nextFloat(streams, o) * 30,
            bleedMlMin: nextFloat(streams, o) * nextFloat(streams, o) * 150,
            dirt: nextFloat(streams, o),
            leg: nextChance(streams, o, 0.2) ? nextFloat(streams, o) : 0,
            strain: nextChance(streams, o, 0.3) ? nextFloat(streams, o) : 0,
          });
        }
        if (nextChance(streams, o, 0.001)) exposeGut(sim, slot, waterDose(1, nextFloat(streams, o) * 0.3));
      }
    };
  },
});

// Acts go before the bodies (pipeline.ts): insert the policy just before body.exposure.
const at = SIM_PIPELINE.indexOf(exposure);
if (at < 0) throw new Error('body.exposure is not in the pipeline');
const pipeline = [...SIM_PIPELINE.slice(0, at), randomPolicy, ...SIM_PIPELINE.slice(at)];

const config = defaultConfig(seed);
const sim = createSim(config, pipeline);
const { state } = sim;
const agents = state.agents;
const perYear = ticksPerYear(config);
const perDay = config.time.ticksPerDay;
const { widthCells: Wc, heightCells: Hc, cellSizeM: cs } = config.world;

// Bodies at random land cells, ages 15–75, from a stream of the experiment's own (not the sim's).
let s = (seed * 2654435761) >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const waterKind = state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
const formedAge = new Float64Array(N);
const sexOf = new Uint8Array(N);
for (let n = 0; n < N; n++) {
  let k: number;
  do k = Math.floor(rand() * Wc * Hc);
  while (waterKind[k] !== Water.DRY);
  const x = ((k % Wc) + rand()) * cs;
  const y = (Math.floor(k / Wc) + rand()) * cs;
  const age = 15 + rand() * 60;
  const base = n % 2 === 0 ? HADZA_MAN : HADZA_WOMAN;
  const slot = spawnWithBody(sim, x, y, { ...base, ageYears: age });
  if (slot !== n) throw new Error(`expected slot ${n}, got ${slot}`);
  foodPerDay[slot] = rand() * 4000;
  waterPerDay[slot] = rand() * 6;
  formedAge[slot] = age;
  sexOf[slot] = base.sex;
}

const tally = state.parts.find((p) => p.name === BODY_PARTS.deaths)!.readings!() as Float64Array;
const energyOut = () => agents.column<Float64Array>(BODY_COLUMNS.energyOut.name).data;
// Energy spent by each body since formation, kept while it lives (a removed slot's columns are cleared).
const spentSoFar = new Float64Array(N);
const spentAtStart = new Float64Array(N);
for (let n = 0; n < N; n++) spentAtStart[n] = agents.column<Float64Array>(BODY_COLUMNS.energyOut.name).data[n];
const airC = () => agents.column<Float64Array>(SURROUNDINGS.airC.name).data;

interface Death { slot: number; tick: number; age: number; cause: number; day: number }
const deaths: Death[] = [];
let ambiguousTicks = 0;
let ambiguousDeaths = 0;
const auditFailures: string[] = [];
const dayMeanAir: number[] = [];
let airSum = 0;
let airN = 0;
const alive = new Uint8Array(N).fill(1);
const before = new Float64Array(tally.length);
const total = YEARS * perYear;
const t0 = Date.now();

for (let i = 0; i < total; i++) {
  before.set(tally);
  stepSim(sim, 1);
  const tick = state.tick;
  const gone: number[] = [];
  for (let slot = 0; slot < N; slot++) if (alive[slot] && !agents.isAlive(slot)) { alive[slot] = 0; gone.push(slot); }
  if (gone.length) {
    const causes: number[] = [];
    for (let c = 0; c < tally.length; c++) if (tally[c] !== before[c]) causes.push(c);
    const counted = causes.reduce((a, c) => a + (tally[c] - before[c]), 0);
    if (counted !== gone.length) auditFailures.push(`tick ${tick}: ${gone.length} bodies gone, ${counted} deaths tallied`);
    if (causes.length !== 1) { ambiguousTicks++; ambiguousDeaths += gone.length; }
    for (const slot of gone) {
      // The store clears a removed slot's columns, so the age comes from the age at formation.
      deaths.push({ slot, tick, age: formedAge[slot] + tick / perYear, cause: causes.length === 1 ? causes[0] : -1, day: Math.floor(tick / perDay) });
    }
  }
  if (tick % 6 === 0) {
    const a = airC();
    for (let slot = 0; slot < N; slot++) if (alive[slot]) { airSum += a[slot]; airN++; }
  }
  if (tick % 6 === 0) {
    const out = energyOut();
    for (let slot = 0; slot < N; slot++) if (alive[slot]) spentSoFar[slot] = out[slot] - spentAtStart[slot];
  }
  if (tick % perDay === 0) {
    dayMeanAir.push(airN ? airSum / airN : NaN);
    airSum = 0;
    airN = 0;
    const problems = auditConserved(agents);
    if (problems.length) auditFailures.push(`day ${tick / perDay}: ${JSON.stringify(problems).slice(0, 300)}`);
  }
}

// NaN check over every float column of the living.
let nonFinite = 0;
for (const column of agents.columns) {
  const data = column.data as ArrayLike<number>;
  for (let slot = 0; slot < N; slot++) if (alive[slot] && !Number.isFinite(data[slot])) nonFinite++;
}

// ---- Criteria ----
const lines: string[] = [];
const say = (x: string) => { lines.push(x); console.log(x); };
const median = (xs: number[]) => { if (!xs.length) return NaN; const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const deathOf = new Map(deaths.map((d) => [d.slot, d]));
const daysLived = (slot: number) => (deathOf.has(slot) ? deathOf.get(slot)!.tick : total) / perDay;
const byCause = new Map<string, number>();
for (const d of deaths) byCause.set(d.cause < 0 ? 'ambiguous' : CAUSE_NAMES[d.cause], (byCause.get(d.cause < 0 ? 'ambiguous' : CAUSE_NAMES[d.cause]) ?? 0) + 1);
const tallied = tally.reduce((a, b) => a + b, 0);

say(`seed ${seed}: ${N} bodies, ${YEARS} compressed years (${total} ticks), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
say(`deaths ${deaths.length} (tallied ${tallied}), alive at end ${N - deaths.length}; ambiguous ticks ${ambiguousTicks} (${ambiguousDeaths} deaths)`);
say(`by cause: ${[...byCause].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}`);

const c1 = auditFailures.length === 0 && nonFinite === 0;
say(`1 audits: ${c1 ? 'PASS' : 'FAIL'} (${auditFailures.length} failures, ${nonFinite} non-finite values)${auditFailures.length ? ' first: ' + auditFailures[0] : ''}`);
const c2 = tallied === deaths.length && tally[0] === 0;
say(`2 one cause per death: ${c2 ? 'PASS' : 'FAIL'} (lost ${deaths.length}, tallied ${tallied}, undefined-cause tally ${tally[0]})`);

const group = (pred: (slot: number) => boolean) => Array.from({ length: N }, (_, i) => i).filter(pred);
const known = (slots: number[]) => slots.map((s) => deathOf.get(s)).filter((d): d is Death => !!d && d.cause > 0);
const share = (ds: Death[], cause: number) => (ds.length ? ds.filter((d) => d.cause === cause).length / ds.length : NaN);

const thirsty = group((i) => waterPerDay[i] < 1);
const thirstyDeaths = known(thirsty);
const thirstyAll = thirsty.filter((i) => deathOf.has(i)).length;
const dehyShare = share(thirstyDeaths, DeathCause.DEHYDRATION);
const starvedThirsty = thirstyDeaths.filter((d) => d.cause === DeathCause.STARVATION).length;
const thirstyMedian = median(thirsty.map(daysLived));
const c3 = thirstyAll === thirsty.length && dehyShare >= 0.9 && starvedThirsty === 0 && thirstyMedian >= 2 && thirstyMedian <= 12;
say(`3 thirst before hunger: ${c3 ? 'PASS' : 'FAIL'} (n ${thirsty.length}, died ${thirstyAll}, dehydration ${(dehyShare * 100).toFixed(1)}% of known causes, starvation ${starvedThirsty}, median ${thirstyMedian.toFixed(2)} days; causes: ${causesOf(thirstyDeaths)})`);

const hungry = group((i) => waterPerDay[i] >= 3 && foodPerDay[i] < 400);
const hungryDeaths = known(hungry);
const hungryDehy = share(hungryDeaths, DeathCause.DEHYDRATION);
const starvedDays = hungryDeaths.filter((d) => d.cause === DeathCause.STARVATION).map((d) => d.tick / perDay);
const c4 = hungryDehy <= 0.1 && starvedDays.every((d) => d >= 15 && d <= 80);
say(`4 hunger takes weeks: ${c4 ? 'PASS' : 'FAIL'} (n ${hungry.length}, died ${hungry.filter((i) => deathOf.has(i)).length}, dehydration ${(hungryDehy * 100).toFixed(1)}%, starvation deaths ${starvedDays.length} at days ${starvedDays.length ? Math.min(...starvedDays).toFixed(1) + '–' + Math.max(...starvedDays).toFixed(1) : '-'} (median ${median(starvedDays).toFixed(1)}); causes: ${causesOf(hungryDeaths)})`);

const supplied = group((i) => foodPerDay[i] >= 3000 && waterPerDay[i] >= 4);
const suppliedMedian = median(supplied.map(daysLived));
const c5 = suppliedMedian >= 5 * thirstyMedian;
say(`5 supply buys time: ${c5 ? 'PASS' : 'FAIL'} (n ${supplied.length}, median survival ${suppliedMedian.toFixed(1)} days against ${thirstyMedian.toFixed(2)}; alive at end ${supplied.filter((i) => !deathOf.has(i)).length}; causes: ${causesOf(known(supplied))})`);

const medianAir = median(dayMeanAir.filter(Number.isFinite));
const coldDay = (d: Death) => (dayMeanAir[d.day] ?? dayMeanAir[d.day - 1]) < medianAir;
const hypo = deaths.filter((d) => d.cause === DeathCause.HYPOTHERMIA);
const hyper = deaths.filter((d) => d.cause === DeathCause.HYPERTHERMIA);
const hypoCold = hypo.filter(coldDay).length;
const hyperWarm = hyper.filter((d) => !coldDay(d)).length;
const c6 = (hypo.length < 10 || hypoCold / hypo.length >= 2 / 3) && (hyper.length < 10 || hyperWarm / hyper.length >= 2 / 3);
say(`6 cold kills in the cold: ${c6 ? 'PASS' : 'FAIL'} (median day ${medianAir.toFixed(1)} °C; hypothermia ${hypo.length}, ${hypoCold} on colder days; hyperthermia ${hyper.length}, ${hyperWarm} on warmer days)`);

const old = deaths.filter((d) => d.cause === DeathCause.OLD_AGE);
const oldOld = old.filter((d) => d.age >= 45).length;
const c7 = old.length < 5 || oldOld / old.length >= 0.9;
say(`7 old age kills the old: ${c7 ? 'PASS' : 'FAIL'} (${old.length} deaths by old age, ${oldOld} at 45 or older; ages ${old.map((d) => d.age.toFixed(0)).join(' ')})`);

const knownCauses = [...byCause].filter(([c]) => c !== 'ambiguous');
const top = Math.max(...knownCauses.map(([, n]) => n));
const c8 = knownCauses.length >= 4 && top / deaths.length <= 0.9;
say(`8 a mix: ${c8 ? 'PASS' : 'FAIL'} (${knownCauses.length} causes, largest ${(top / deaths.length * 100).toFixed(1)}% of deaths)`);

say(`overall: ${[c1, c2, c3, c4, c5, c6, c7, c8].every(Boolean) ? 'PASS' : 'FAIL'}`);

// ---- Diagnostics (reported, not criteria; added after the first run, see results.md) ----
const perBodyKcalDay = Array.from({ length: N }, (_, i) => spentSoFar[i] / Math.max(daysLived(i), 1 / 24));
const lived = (i: number) => daysLived(i) >= 2;
say(`diag spending: median ${median(perBodyKcalDay.filter((_, i) => lived(i))).toFixed(0)} kcal a day over each body's life (men ${median(perBodyKcalDay.filter((_, i) => lived(i) && i % 2 === 0)).toFixed(0)}, women ${median(perBodyKcalDay.filter((_, i) => lived(i) && i % 2 === 1)).toFixed(0)}); the gut passes at most 4,320`);
let oldAgeExpected = 0;
let oldAgeExpectedYoung = 0;
{
  // Old age: the deaths the Gompertz term predicts over the time each body actually lived (§3.12).
  const H = (x: number) => (1.47e-4 / 0.086) * Math.exp(0.086 * x);
  let expected = 0;
  let expectedYoung = 0;
  for (let i = 0; i < N; i++) {
    const a0 = formedAge[i];
    const a1 = a0 + daysLived(i) / config.time.daysPerYear;
    expected += H(a1) - H(a0);
    if (a0 < 45) expectedYoung += H(Math.min(a1, 45)) - H(a0);
  }
  say(`diag old age: ${old.length} deaths against ${expected.toFixed(1)} expected from the hazard over the time lived; ${old.length - oldOld} under 45 against ${expectedYoung.toFixed(2)} expected`);
  oldAgeExpected = expected;
  oldAgeExpectedYoung = expectedYoung;
}
for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]]) {
  const g = group((i) => waterPerDay[i] >= lo && waterPerDay[i] < hi);
  say(`diag water ${lo}–${hi} kg a day: n ${g.length}, median ${median(g.map(daysLived)).toFixed(1)} days; ${causesOf(known(g))}`);
}
for (const [lo, hi] of [[0, 1000], [1000, 2000], [2000, 3000], [3000, 4000]]) {
  const g = group((i) => waterPerDay[i] >= 3 && foodPerDay[i] >= lo && foodPerDay[i] < hi);
  say(`diag food ${lo}–${hi} kcal a day (water ≥ 3 kg): n ${g.length}, median ${median(g.map(daysLived)).toFixed(1)} days; ${causesOf(known(g))}`);
}

function causesOf(ds: Death[]): string {
  const m = new Map<string, number>();
  for (const d of ds) m.set(CAUSE_NAMES[d.cause], (m.get(CAUSE_NAMES[d.cause]) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || '-';
}

// ---- Part two's criteria (preregistration.md, part two) ----
say('part two:');
const severe = group((i) => waterPerDay[i] < 0.25);
const severeDeaths = known(severe);
const severeDehy = share(severeDeaths, DeathCause.DEHYDRATION);
const severeMedian = median(severe.map(daysLived));
const d3 = severeDehy >= 0.7 && severeMedian >= 5 && severeMedian <= 15;
say(`3b thirst before hunger, severe: ${d3 ? 'PASS' : 'FAIL'} (n ${severe.length}, dehydration ${(severeDehy * 100).toFixed(1)}%, median ${severeMedian.toFixed(1)} days; ${causesOf(severeDeaths)})`);
const d4 = hungryDeaths.every((d) => d.cause !== DeathCause.DEHYDRATION) && starvedDays.every((d) => d >= 10 && d <= 40);
say(`4b hunger takes weeks at this spending: ${d4 ? 'PASS' : 'FAIL'} (n ${hungry.length}, dehydration ${hungryDeaths.filter((d) => d.cause === DeathCause.DEHYDRATION).length}, starvation at ${starvedDays.length ? Math.min(...starvedDays).toFixed(1) + '–' + Math.max(...starvedDays).toFixed(1) : '-'} days)`);
const bandMedians = (pred: (i: number) => boolean, key: Float64Array, edges: number[]) =>
  edges.slice(0, -1).map((lo, b) => median(group((i) => pred(i) && key[i] >= lo && key[i] < edges[b + 1]).map(daysLived)));
const foodBands = bandMedians((i) => waterPerDay[i] >= 3, foodPerDay, [0, 1000, 2000, 3000, 4000]);
const waterBands = bandMedians(() => true, waterPerDay, [0, 0.25, 0.5, 0.75, 1]);
const rising = (xs: number[]) => xs.every((x, k) => k === 0 || x > xs[k - 1]);
const d5 = rising(foodBands) && foodBands[3] >= 1.5 * foodBands[0] && rising(waterBands);
say(`5b supply buys time: ${d5 ? 'PASS' : 'FAIL'} (food bands ${foodBands.map((x) => x.toFixed(1)).join(' < ')} days; water bands ${waterBands.map((x) => x.toFixed(1)).join(' < ')} days)`);
const poisson99 = (mean: number): [number, number] => {
  let p = Math.exp(-mean);
  let cdf = p;
  let k = 0;
  let lo = -1;
  while (cdf < 0.995) {
    if (lo < 0 && cdf >= 0.005) lo = k;
    k++;
    p *= mean / k;
    cdf += p;
  }
  return [lo < 0 ? k : lo, k];
};
const [lo7, hi7] = poisson99(oldAgeExpected);
const [loY, hiY] = poisson99(oldAgeExpectedYoung);
const young = old.length - oldOld;
const d7 = old.length >= lo7 && old.length <= hi7 && young >= loY && young <= hiY;
say(`7b old age at the hazard's rate: ${d7 ? 'PASS' : 'FAIL'} (${old.length} in ${lo7}–${hi7} for a mean of ${oldAgeExpected.toFixed(1)}; under 45: ${young} in ${loY}–${hiY} for ${oldAgeExpectedYoung.toFixed(2)})`);
say(`part two overall: ${[c1, c2, d3, d4, d5, c6, d7, c8].every(Boolean) ? 'PASS' : 'FAIL'}`);
