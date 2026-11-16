// Phase 0.4 benchmark: how fast is the kernel under a stand-in agent load,
// and how much of the compute budget does that leave for real bodies and
// minds? (docs/DESIGN.md §1.3 and §1.7)
//
//   node bench/bench.ts            human-readable table
//   node bench/bench.ts --json     machine-readable
//
// What this does NOT tell you: how fast the finished simulation will be. The
// stand-in systems are far cheaper than real perception and learning. The
// useful numbers are the kernel's overhead and the per-agent time budget.

import { auditConserved } from '../src/sim/core/audit.ts';
import { ticksPerYear } from '../src/sim/core/clock.ts';
import { defaultConfig } from '../src/sim/config.ts';
import { createSim, hashSim, saveSim, stepSim } from '../src/sim/sim.ts';
import type { StepProbe } from '../src/sim/sim.ts';
import { getMachineInfo } from '../src/harness/manifest.ts';
import { BENCH_PIPELINE, populateGroups } from './fixtures.ts';

const POPULATIONS = [100, 500, 2000];
const WARMUP_TICKS = 300;
const MEASURE_SECONDS = 3;
const GENERATION_YEARS = 25; // assumed mean age of parents; see docs/DESIGN.md §1.7
const TARGET_POPULATION = 500;
const TARGET_MINUTES_PER_GENERATION = 10;

interface Result {
  agents: number;
  ticksPerSecond: number;
  microsecondsPerAgentTick: number;
  generationsPerHour: number;
  shareBySystem: Record<string, number>;
  hashMilliseconds: number;
  snapshotMilliseconds: number;
  snapshotBytes: number;
}

function measure(agents: number): Result {
  const config = defaultConfig(1);
  const sim = createSim(config, BENCH_PIPELINE);
  populateGroups(sim, agents);
  stepSim(sim, WARMUP_TICKS);

  // Headline speed, without any probe.
  let ticks = 0;
  const start = performance.now();
  let elapsed = 0;
  while (elapsed < MEASURE_SECONDS * 1000) {
    stepSim(sim, 50);
    ticks += 50;
    elapsed = performance.now() - start;
  }
  const ticksPerSecond = ticks / (elapsed / 1000);

  // Where the time goes, with a probe around each system.
  const spent = new Array<number>(sim.pipeline.length).fill(0);
  let entered = 0;
  const probe: StepProbe = {
    enter() {
      entered = performance.now();
    },
    exit(index) {
      spent[index] += performance.now() - entered;
    },
  };
  stepSim(sim, 500, probe);
  const totalSpent = spent.reduce((a, b) => a + b, 0);
  const shareBySystem: Record<string, number> = {};
  sim.pipeline.forEach((def, i) => {
    shareBySystem[def.name] = spent[i] / totalSpent;
  });

  const problems = auditConserved(sim.state.agents);
  if (problems.length > 0) throw new Error(`Benchmark bookkeeping does not balance: ${problems[0]}`);

  const h0 = performance.now();
  for (let i = 0; i < 20; i++) hashSim(sim);
  const hashMilliseconds = (performance.now() - h0) / 20;
  const s0 = performance.now();
  let bytes = 0;
  for (let i = 0; i < 20; i++) bytes = saveSim(sim).length;
  const snapshotMilliseconds = (performance.now() - s0) / 20;

  const ticksPerGeneration = GENERATION_YEARS * ticksPerYear(config);
  return {
    agents,
    ticksPerSecond,
    microsecondsPerAgentTick: 1e6 / (ticksPerSecond * agents),
    generationsPerHour: (ticksPerSecond * 3600) / ticksPerGeneration,
    shareBySystem,
    hashMilliseconds,
    snapshotMilliseconds,
    snapshotBytes: bytes,
  };
}

const config = defaultConfig(1);
const ticksPerGeneration = GENERATION_YEARS * ticksPerYear(config);
const targetTicksPerSecond = ticksPerGeneration / (TARGET_MINUTES_PER_GENERATION * 60);
const budgetMicroseconds = 1e6 / (targetTicksPerSecond * TARGET_POPULATION);

const results = POPULATIONS.map(measure);
const atTarget = results.find((result) => result.agents === TARGET_POPULATION) as Result;
const report = {
  machine: getMachineInfo(),
  assumptions: {
    generationYears: GENERATION_YEARS,
    ticksPerGeneration,
    target: `${TARGET_POPULATION} agents, one generation per ${TARGET_MINUTES_PER_GENERATION} minutes, one core`,
    targetTicksPerSecond,
    budgetMicrosecondsPerAgentTick: budgetMicroseconds,
  },
  results,
  standInLoadShareOfBudget: atTarget.microsecondsPerAgentTick / budgetMicroseconds,
  microsecondsLeftForRealSystems: budgetMicroseconds - atTarget.microsecondsPerAgentTick,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { machine } = report;
  console.log(`Machine: ${machine.cpu}, ${machine.cores} cores, Node ${machine.node} (${machine.platform}/${machine.arch})`);
  console.log(
    `Target:  ${report.assumptions.target} = ${targetTicksPerSecond.toFixed(0)} ticks/s ` +
      `= ${budgetMicroseconds.toFixed(2)} microseconds per agent per tick\n`,
  );
  console.log('agents   ticks/s   us/agent-tick   generations/hour   hash ms   snapshot');
  for (const r of results) {
    console.log(
      `${String(r.agents).padStart(6)}  ${r.ticksPerSecond.toFixed(0).padStart(8)}  ${r.microsecondsPerAgentTick.toFixed(3).padStart(14)}  ` +
        `${r.generationsPerHour.toFixed(1).padStart(17)}  ${r.hashMilliseconds.toFixed(2).padStart(8)}  ` +
        `${r.snapshotMilliseconds.toFixed(2)} ms, ${(r.snapshotBytes / 1024).toFixed(0)} KiB`,
    );
  }
  console.log(`\nShare of tick time by system at ${TARGET_POPULATION} agents:`);
  for (const [name, share] of Object.entries(atTarget.shareBySystem)) {
    console.log(`  ${name.padEnd(14)} ${(share * 100).toFixed(0)}%`);
  }
  console.log(
    `\nThe stand-in load uses ${(report.standInLoadShareOfBudget * 100).toFixed(1)}% of the budget, ` +
      `leaving about ${report.microsecondsLeftForRealSystems.toFixed(2)} microseconds per agent per tick for real bodies and minds.`,
  );
}
