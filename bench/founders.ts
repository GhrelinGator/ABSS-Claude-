// Phase 3.4: what founders do and die of, with memory and with the blank predictor (the random-policy
// baseline), on the full map (docs/DESIGN.md §4.9.8, §4.10).
//
//   node bench/founders.ts [founders=100] [days=40] [seed=7] [radiusM=3000] [--blank]
//
// The real pipeline; `--blank` swaps the mind for one that never learns. It reports, every 5 days, how
// many are alive, and at the end the deaths by cause, the acts begun, done and failed, what was eaten
// and drunk, and decisions per awake agent-tick. This is a description of what the code does, not an
// emergence check: nothing here has a null model or a preregistered threshold.

import { defaultConfig, validateConfig } from '../src/sim/config.ts';
import { createSim, stepSim } from '../src/sim/sim.ts';
import { SIM_PIPELINE } from '../src/sim/pipeline.ts';
import { Act, ActTally } from '../src/sim/mind/acts.ts';
import { MIND_PARTS, blankMind } from '../src/sim/mind/mind.ts';
import { BODY_PARTS, DeathCause } from '../src/sim/body/metabolism.ts';
import { PLANT_SPECIES } from '../src/sim/world/plants.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const blank = process.argv.includes('--blank');
const N = Number(args[0] ?? 100);
const DAYS = Number(args[1] ?? 40);
const seed = Number(args[2] ?? 7);
const radiusM = Number(args[3] ?? 3000);

const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
raw.founders = { count: N, radiusM };
const config = validateConfig(raw);
const pipeline = blank ? SIM_PIPELINE.map((s) => (s.name === 'mind' ? blankMind : s)) : SIM_PIPELINE;
const sim = createSim(config, pipeline);
const tally = sim.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
const deaths = sim.state.parts.find((p) => p.name === BODY_PARTS.deaths)!.readings!() as Float64Array;
const perDay = config.time.ticksPerDay;
const t0 = performance.now();
const alive: string[] = [];
for (let d = 1; d <= DAYS; d++) {
  stepSim(sim, perDay);
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
