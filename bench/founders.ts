// Phase 3.4: what founders do and die of, with memory and with the blank predictor (the random-policy
// baseline), on the full map (docs/DESIGN.md §4.9.8, §4.10).
//
//   node bench/founders.ts [founders=100] [days=40] [seed=7] [radiusM=3000] [--blank] [--bias=x] [--gut=h]
//
// The real pipeline; `--blank` swaps the mind for one that never learns. It reports, every 5 days, how
// many are alive, and at the end the deaths by cause, the acts begun, done and failed, what was eaten
// and drunk, and decisions per awake agent-tick. `--bias=x` sets every founder's hiddenCauseBias to x
// after tick 0 (3.5: `--bias=0` is the ablation of §4.11.5; without it founders keep their genomes'
// values), and the run then also reports hidden-cause nodes (§4.11). This is a description of what the code does, not an
// emergence check: nothing here has a null model or a preregistered threshold. Since 3.6 it also reports,
// every 10 days, the skills of the living, and at the end the pieces, embers and fires their acts made.
// Since 3.6b `--gut=h` sets every founder's gutTraceHalfLife to h hours after tick 0 (`--gut=0` is the
// ablation of §4.13), and the run reports the poisonous plants' share of what was eaten by tenths of the run.
// Since 3.7c `--need=x` and `--rest=x` set every founder's needCuriosity and restlessness after tick 0
// (0 is each one's ablation, §4.15), and the run reports plant kg dug with a stick, sleeps the body could
// not refuse, hours asleep a living founder-day, and energy in and out a living founder-day.

import { defaultConfig, validateConfig } from '../src/sim/config.ts';
import { createSim, stepSim } from '../src/sim/sim.ts';
import { SIM_PIPELINE } from '../src/sim/pipeline.ts';
import { Act, ActTally } from '../src/sim/mind/acts.ts';
import { MIND_PARTS, blankMind } from '../src/sim/mind/mind.ts';
import { BODY_PARTS, DeathCause } from '../src/sim/body/metabolism.ts';
import { PLANT_SPECIES } from '../src/sim/world/plants.ts';
import { GENETICS_COLUMNS } from '../src/sim/body/genetics.ts';
import { CHANNELS, Channel, createInteroception } from '../src/sim/mind/interoception.ts';
import { MEMORY_COLUMNS } from '../src/sim/mind/memory.ts';
import { SKILL_KINDS, SkillAct, materialKind, skillLevel } from '../src/sim/body/skills.ts';
import { Material } from '../src/sim/world/materials.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const blank = process.argv.includes('--blank');
const biasArg = process.argv.find((a) => a.startsWith('--bias='));
const bias = biasArg === undefined ? null : Number(biasArg.slice(7));
const gutArg = process.argv.find((a) => a.startsWith('--gut='));
const gutH = gutArg === undefined ? null : Number(gutArg.slice(6));
const needArg = process.argv.find((a) => a.startsWith('--need='));
const need = needArg === undefined ? null : Number(needArg.slice(7));
const restArg = process.argv.find((a) => a.startsWith('--rest='));
const rest = restArg === undefined ? null : Number(restArg.slice(7));
const N = Number(args[0] ?? 100);
const DAYS = Number(args[1] ?? 40);
const seed = Number(args[2] ?? 7);
const radiusM = Number(args[3] ?? 3000);

const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
raw.founders = { count: N, radiusM };
const config = validateConfig(raw);
const pipeline = blank ? SIM_PIPELINE.map((s) => (s.name === 'mind' ? blankMind : s)) : SIM_PIPELINE;
const sim = createSim(config, pipeline);
const intero = createInteroception(sim);
const drives = new Float64Array(CHANNELS);
const tally = sim.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
const deaths = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths)!.readings!() as Float64Array;
const perDay = config.time.ticksPerDay;
const t0 = performance.now();
const alive: string[] = [];
stepSim(sim, 1); // tick 0: founders placed, first choices made (nothing learned yet)
if (bias !== null) {
  const col = sim.state.agents.column<Float64Array>(GENETICS_COLUMNS.hiddenCauseBias.name).data;
  for (let s = 0; s < sim.state.agents.highWater; s++) col[s] = bias;
}
if (gutH !== null) {
  const col = sim.state.agents.column<Float64Array>(GENETICS_COLUMNS.gutTraceHalfLife.name).data;
  for (let s = 0; s < sim.state.agents.highWater; s++) col[s] = gutH;
}
for (const [value, column] of [
  [need, GENETICS_COLUMNS.needCuriosity.name],
  [rest, GENETICS_COLUMNS.restlessness.name],
] as const) {
  if (value === null) continue;
  const col = sim.state.agents.column<Float64Array>(column).data;
  for (let s = 0; s < sim.state.agents.highWater; s++) col[s] = value;
}
// 3.7c: hours asleep and energy in and out, a living founder-day (§4.15).
const kindCol = () => sim.state.agents.column<Uint8Array>('actKind').data;
const endCol = () => sim.state.agents.column<Uint8Array>('actEnd').data;
let asleepTicks = 0;
let livingTicks = 0;
// 3.6b: the poisonous plants' share of plant kg eaten, by stretch of the run (§4.13).
const poisonous = PLANT_SPECIES.map((sp) => sp.toxin !== null);
const shares: string[] = [];
let lastKg = PLANT_SPECIES.map((_, i) => tally[ActTally.PLANT_KG + i]);
function poisonShare(): string {
  let all = 0;
  let bad = 0;
  PLANT_SPECIES.forEach((_, i) => {
    const kg = tally[ActTally.PLANT_KG + i] - lastKg[i];
    all += kg;
    if (poisonous[i]) bad += kg;
  });
  lastKg = PLANT_SPECIES.map((_, i) => tally[ActTally.PLANT_KG + i]);
  return all > 0 ? `${((100 * bad) / all).toFixed(1)}% of ${all.toFixed(0)} kg` : '—';
}
const painSum = { sum: 0, n: 0 };
// 3.6: skills of the living (§4.12): the mean of each one's best eating skill, the share above 0.3, and
// the mean best striking skill and rubbing skill.
const skills: string[] = [];
function skillsNow(): string {
  let n = 0;
  let eat = 0;
  let eat03 = 0;
  let strike = 0;
  let rub = 0;
  for (let s = 0; s < sim.state.agents.highWater; s++) {
    if (sim.state.agents.alive.data[s] !== 1) continue;
    n++;
    let best = 0;
    let bestStrike = 0;
    for (let k = 0; k < SKILL_KINDS; k++) {
      const e = skillLevel(sim, s, SkillAct.CONSUME, k);
      if (e > best) best = e;
      const t = skillLevel(sim, s, SkillAct.STRIKE, k);
      if (t > bestStrike) bestStrike = t;
    }
    eat += best;
    if (best > 0.3) eat03++;
    strike += bestStrike;
    rub += skillLevel(sim, s, SkillAct.MANIPULATE, materialKind(Material.WOOD));
  }
  const m = (x: number) => (n > 0 ? x / n : 0).toFixed(2);
  return `eating ${m(eat)} (${eat03} of ${n} above 0.3), striking ${m(strike)}, rubbing wood ${m(rub)}`;
}
for (let d = 1; d <= DAYS; d++) {
  for (let t = 0; t < perDay; t++) {
    stepSim(sim, 1);
    {
      const k = kindCol();
      const e = endCol();
      for (let s = 0; s < sim.state.agents.highWater; s++) {
        if (sim.state.agents.alive.data[s] !== 1) continue;
        livingTicks++;
        if (k[s] === Act.SLEEP && e[s] === 0) asleepTicks++;
      }
    }
    if (t % 6 === 0) {
      // Mean pain of the living, hourly: the harm a hidden cause could spare (§4.11, ROADMAP Phase 3).
      intero.refresh();
      for (let s = 0; s < sim.state.agents.highWater; s++) {
        if (sim.state.agents.alive.data[s] !== 1) continue;
        intero.read(s, drives, 0);
        painSum.sum += drives[Channel.PAIN];
        painSum.n += 1;
      }
    }
  }
  if (d % 5 === 0) alive.push(`${d}:${sim.state.agents.count}`);
  if (d % 10 === 0) skills.push(`${d}: ${skillsNow()}`);
  if (d % Math.max(1, Math.round(DAYS / 10)) === 0) shares.push(`${d}: ${poisonShare()}`);
}
const ms = performance.now() - t0;
const causes = Object.entries(DeathCause)
  .filter(([, i]) => deaths[i] > 0)
  .map(([name, i]) => `${name.toLowerCase()} ${deaths[i]}`)
  .join(', ');
const names = Object.keys(Act).slice(1);
const row = (base: number) => names.map((name, i) => `${name.toLowerCase()} ${tally[base + i + 1]}`).join(', ');
const eaten = PLANT_SPECIES.map((sp, i) => `${sp.name} ${tally[ActTally.PLANT_KG + i].toFixed(0)}`).join(', ');
console.log(`bench/founders: ${N} founders, ${DAYS} days, seed ${seed}, ${radiusM} m disc, ${blank ? 'blank minds' : 'memory'}; ${(ms / 1000).toFixed(1)} s`);
console.log(`alive by day: ${alive.join(' ')}`);
console.log(`deaths: ${causes || 'none'}`);
console.log(`begun: ${row(ActTally.BEGUN)}`);
console.log(`done: ${row(ActTally.DONE)}`);
console.log(`failed: ${row(ActTally.FAILED)}`);
console.log(`eaten, kg: ${eaten}; meat ${tally[ActTally.MEAT_KG].toFixed(1)}; water drunk ${tally[ActTally.WATER_KG].toFixed(0)} kg; ${(tally[ActTally.KCAL] / 1000).toFixed(0)} thousand kcal`);
console.log(`decisions per awake agent-tick ${(tally[ActTally.DECISIONS] / tally[ActTally.AWAKE_TICKS]).toFixed(3)}; poison units ${tally[ActTally.POISON_UNITS].toFixed(1)}`);
console.log(`mean pain of the living, hourly: ${(painSum.sum / Math.max(1, painSum.n)).toFixed(4)}`);
console.log(`poisonous plants' share of plant kg eaten, by stretch${gutH === null ? ' (genome gutTraceHalfLife)' : ` (gutTraceHalfLife ${gutH} h)`}: ${shares.join('; ')}`);
console.log(`skills of the living (best pair, mean): ${skills.join('; ')}`);
console.log(
  `3.7c${need === null ? '' : ` (needCuriosity ${need})`}${rest === null ? '' : ` (restlessness ${rest})`}: plant kg dug with a stick ${tally[ActTally.STICK_KG].toFixed(0)}; sleeps not refused ${tally[ActTally.SLEEPS_UNREFUSED]}; hours asleep a living founder-day ${((24 * asleepTicks) / Math.max(1, livingTicks)).toFixed(2)}; kcal eaten a living founder-day ${((tally[ActTally.KCAL] * perDay) / Math.max(1, livingTicks)).toFixed(0)}`,
);
console.log(`pieces struck off ${tally[ActTally.PIECES]}, embers ${tally[ActTally.EMBERS]}, fires lit ${tally[ActTally.FIRES_LIT]}, blows on animals ${tally[ActTally.BLOWS_ON_ANIMALS]}, animals killed ${tally[ActTally.ANIMALS_KILLED]}`);
if (!blank) {
  const ids = sim.state.agents.column<Uint32Array>(MEMORY_COLUMNS.nodeId.name).data;
  let held = 0;
  let withAny = 0;
  for (let s = 0; s < sim.state.agents.highWater; s++) {
    if (sim.state.agents.alive.data[s] !== 1) continue;
    let n = 0;
    for (let q = 0; q < MEMORY_COLUMNS.nodeId.width; q++) if (ids[s * MEMORY_COLUMNS.nodeId.width + q] !== 0) n++;
    held += n;
    if (n > 0) withAny++;
  }
  console.log(
    `hidden causes${bias === null ? ' (genome biases)' : ` (bias ${bias})`}: salient residuals ${tally[ActTally.RESIDUALS_SALIENT]}, nodes posited ${tally[ActTally.NODES_POSITED]}, strengthened ${tally[ActTally.NODES_STRENGTHENED]}; the living hold ${held} (${withAny} of ${sim.state.agents.count} hold any)`,
  );
}
