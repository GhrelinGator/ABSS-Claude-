// Phase 3.3: what minds cost with real acts, and how often they choose (docs/DESIGN.md §4.7.12, §4.9.7).
//
//   node bench/acts.ts [founders=500] [days=2] [seed=1] [radiusM=5000]
//
// The real pipeline on the full map, with `founders` placed by the founders system in a disc of
// `radiusM`. Their minds have learned nothing (3.3), so they choose uniformly among what physics
// allows. After a warm-up day it times every system over `days` simulated days and reports the mind
// system's cost per agent per tick and decisions per awake agent per tick (the rule: about 0.25).

import { defaultConfig, validateConfig } from '../src/sim/config.ts';
import { createSim, stepSim } from '../src/sim/sim.ts';
import type { StepProbe } from '../src/sim/sim.ts';
import { SIM_PIPELINE } from '../src/sim/pipeline.ts';
import { ActTally } from '../src/sim/mind/acts.ts';
import { MIND_PARTS } from '../src/sim/mind/mind.ts';
import { getMachineInfo } from '../src/harness/manifest.ts';

const N = Number(process.argv[2] ?? 500);
const DAYS = Number(process.argv[3] ?? 2);
const seed = Number(process.argv[4] ?? 1);
const radiusM = Number(process.argv[5] ?? 5000);
const BUDGET_US = 6.94; // DESIGN.md §1.7

const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
raw.founders = { count: N, radiusM };
const config = validateConfig(raw);
const t0 = performance.now();
const sim = createSim(config, SIM_PIPELINE);
const buildMs = performance.now() - t0;
const perDay = config.time.ticksPerDay;
stepSim(sim, perDay); // warm-up day: founders placed, still views and lines of sight begin to fill

const tally = sim.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
const decisions0 = tally[ActTally.DECISIONS];
const awake0 = tally[ActTally.AWAKE_TICKS];
const spent = new Array<number>(sim.pipeline.length).fill(0);
let entered = 0;
const probe: StepProbe = {
  enter() {
    entered = performance.now();
  },
  exit(i) {
    spent[i] += performance.now() - entered;
  },
};
let agentTicks = 0;
for (let t = 0; t < DAYS * perDay; t++) {
  agentTicks += sim.state.agents.count;
  stepSim(sim, 1, probe);
}
const ticks = DAYS * perDay;
const meanAgents = agentTicks / ticks;
const decisions = tally[ActTally.DECISIONS] - decisions0;
const awake = tally[ActTally.AWAKE_TICKS] - awake0;
const machine = getMachineInfo();
console.log(`bench/acts: ${N} founders in a ${radiusM} m disc, seed ${seed}, ${DAYS} days after a warm-up day; built in ${buildMs.toFixed(0)} ms`);
console.log(`machine: ${machine.cpuModel ?? '?'} (${machine.cpuCount} cores), Node ${process.versions.node}`);
console.log(`mean agents alive: ${meanAgents.toFixed(1)}; decisions per awake agent-tick: ${(decisions / awake).toFixed(3)} (rule: about 0.25)`);
const rows: [string, number][] = sim.pipeline.map((d, i) => [d.name, spent[i]]);
let bodies = 0;
let world = 0;
for (const [name, ms] of rows) {
  const perAgent = (ms * 1000) / agentTicks;
  if (name.startsWith('body.')) bodies += ms;
  else if (name !== 'mind' && name !== 'founders') world += ms;
  console.log(`  ${name.padEnd(18)} ${((ms * 1000) / ticks).toFixed(1).padStart(8)} µs a tick  ${perAgent.toFixed(3).padStart(7)} µs per agent-tick`);
}
const mindMs = rows.find(([n]) => n === 'mind')![1];
console.log(`world ${((world * 1000) / agentTicks).toFixed(2)}, bodies ${((bodies * 1000) / agentTicks).toFixed(2)}, mind ${((mindMs * 1000) / agentTicks).toFixed(2)} µs per agent-tick; budget ${BUDGET_US} (§1.7)`);
console.log(`mind per decision (with its share of acts): ${((mindMs * 1000) / decisions).toFixed(1)} µs`);
