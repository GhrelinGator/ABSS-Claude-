// One headless run: build the simulation from a config, advance it, sample
// the observers on a fixed cadence, and leave behind metrics.jsonl plus a
// manifest that says exactly what ran.

import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { getObserver } from '../analysis/index.ts';
import {
  SNAPSHOT_FORMAT,
  auditConserved,
  canonicalJson,
  createStandardSim,
  hashSim,
  nonFiniteProblems,
  saveSim,
  stepSim,
  viewOf,
} from '../sim/index.ts';
import type { Sim } from '../sim/index.ts';
import { getMachineInfo } from './manifest.ts';
import type { RepoInfo } from './manifest.ts';
import type { Job } from './spec.ts';

export interface RunJob extends Job {
  /** Directory for this run's files. Created if missing. */
  readonly outDir: string;
  readonly saveFinalSnapshot: boolean;
  readonly repo: RepoInfo;
}

export interface RunSummary {
  readonly condition: string;
  readonly seed: number;
  readonly ticks: number;
  readonly finalStateHash: string;
  readonly wallSeconds: number;
  readonly outDir: string;
}

/** Checks that must hold at any moment of any run. A failure aborts the run. */
function auditProblems(sim: Sim): string[] {
  const problems = nonFiniteProblems(sim.state);
  for (const store of sim.state.stores) problems.push(...auditConserved(store));
  return problems;
}

export function runOne(job: RunJob): RunSummary {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  mkdirSync(job.outDir, { recursive: true });

  const sim = createStandardSim(job.config);
  const view = viewOf(sim);
  const observers = job.observers.map(getObserver);
  const manifest: Record<string, unknown> = {
    experiment: job.experiment,
    condition: job.condition,
    seed: job.seed,
    config: sim.config,
    configJson: canonicalJson(sim.config),
    pipeline: sim.pipeline.map((def) => def.name),
    ticks: job.ticks,
    metricsEveryTicks: job.metricsEveryTicks,
    observers: job.observers,
    snapshotFormat: SNAPSHOT_FORMAT,
    commit: job.repo.commit,
    uncommittedChanges: job.repo.dirty,
    machine: getMachineInfo(),
    startedAt,
  };
  const finish = (extra: Record<string, unknown>): void => {
    const wallSeconds = (performance.now() - t0) / 1000;
    writeFileSync(
      join(job.outDir, 'manifest.json'),
      `${JSON.stringify({ ...manifest, ...extra, wallSeconds }, null, 2)}\n`,
    );
  };

  const fd = openSync(join(job.outDir, 'metrics.jsonl'), 'w');
  let pending = '';
  const sample = (): void => {
    const problems = auditProblems(sim);
    if (problems.length > 0) {
      throw new Error(`Audit failed at tick ${sim.state.tick}:\n  ${problems.slice(0, 10).join('\n  ')}`);
    }
    const row: Record<string, unknown> = { tick: sim.state.tick };
    for (const observer of observers) row[observer.name] = observer.observe(view);
    pending += `${JSON.stringify(row)}\n`;
    if (pending.length > 1 << 16) {
      writeSync(fd, pending);
      pending = '';
    }
  };

  try {
    sample();
    let remaining = job.ticks;
    while (remaining > 0) {
      const chunk = Math.min(remaining, job.metricsEveryTicks);
      stepSim(sim, chunk);
      remaining -= chunk;
      sample();
    }
    writeSync(fd, pending);
  } catch (error) {
    writeSync(fd, pending);
    closeSync(fd);
    finish({ outcome: 'failed', failedAtTick: sim.state.tick, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  closeSync(fd);

  const finalStateHash = hashSim(sim);
  if (job.saveFinalSnapshot) writeFileSync(join(job.outDir, 'final.abss'), saveSim(sim));
  finish({ outcome: 'completed', finalStateHash });
  return {
    condition: job.condition,
    seed: job.seed,
    ticks: job.ticks,
    finalStateHash,
    wallSeconds: (performance.now() - t0) / 1000,
    outDir: job.outDir,
  };
}
