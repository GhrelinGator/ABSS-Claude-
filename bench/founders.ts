// Phase 3.4: what founders do and die of, with memory and with the blank predictor (the random-policy
// baseline), on the full map (docs/DESIGN.md §4.9.8, §4.10).
//
//   node bench/founders.ts [founders=100] [days=40] [seed=7] [radiusM=3000] [--blank] [--bias=x]
//
// The real pipeline; `--blank` swaps the mind for one that never learns. It reports, every 5 days, how
// many are alive, and at the end the deaths by cause, the acts begun, done and failed, what was eaten
// and drunk, and decisions per awake agent-tick. `--bias=x` sets every founder's hiddenCauseBias to x
// after tick 0 (3.5: `--bias=0` is the ablation of §4.11.5; without it founders keep their genomes'
// values), and the run then also reports hidden-cause nodes (§4.11). This is a description of what the code does, not an
// emergence check: nothing here has a null model or a preregistered threshold.

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

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const blank = process.argv.includes('--blank');
const biasArg = process.argv.find((a) => a.startsWith('--bias='));
const bias = biasArg === undefined ? null : Number(biasArg.slice(7));
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
const painSum = { sum: 0, n: 0 };
for (let d = 1; d <= DAYS; d++) {
  for (let t = 0; t < perDay; t++) {
    stepSim(sim, 1);
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
