// Run every (condition, seed) job of an experiment, in parallel across
// worker threads. Runs are independent and deterministic, so the results do
// not depend on how many workers there are or on the order jobs finish in.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { arithmeticProblems } from '../sim/index.ts';
import { getRepoInfo } from './manifest.ts';
import { runOne } from './run.ts';
import type { RunJob, RunSummary } from './run.ts';
import { listJobs } from './spec.ts';
import type { ExperimentSpec } from './spec.ts';

export interface BatchOptions {
  /** Results go to <outRoot>/<experiment>/<condition>/seed-<seed>/. */
  readonly outRoot: string;
  /** Number of worker threads. 1 runs everything in this thread. */
  readonly workers: number;
  readonly saveFinalSnapshot?: boolean;
  /** Allow writing into an experiment directory that already exists. */
  readonly overwrite?: boolean;
  readonly onProgress?: (summary: RunSummary, done: number, total: number) => void;
}

type WorkerReply = { ok: true; index: number; summary: RunSummary } | { ok: false; index: number; error: string };

export async function runBatch(spec: ExperimentSpec, options: BatchOptions): Promise<RunSummary[]> {
  // Refuse to produce results on a machine whose arithmetic differs from everyone else's:
  // they could never be reproduced or compared (docs/DECISIONS.md D-014).
  const mismatches = arithmeticProblems();
  if (mismatches.length > 0) {
    throw new Error(
      `This machine's arithmetic does not match the recorded digests, so runs made here could not be reproduced elsewhere:\n  ${mismatches.join('\n  ')}`,
    );
  }

  const experimentDir = join(options.outRoot, spec.name);
  if (existsSync(experimentDir) && !options.overwrite) {
    throw new Error(`"${experimentDir}" already exists. Results are never overwritten unless you ask for it.`);
  }
  mkdirSync(experimentDir, { recursive: true });
  const repo = getRepoInfo(process.cwd());
  writeFileSync(join(experimentDir, 'spec.json'), `${JSON.stringify(spec, null, 2)}\n`);

  const jobs: RunJob[] = listJobs(spec).map((job) => ({
    ...job,
    outDir: join(experimentDir, job.condition, `seed-${job.seed}`),
    saveFinalSnapshot: options.saveFinalSnapshot ?? false,
    repo,
    arithmeticVerified: true,
  }));
  const total = jobs.length;

  if (options.workers <= 1) {
    const summaries: RunSummary[] = [];
    for (const job of jobs) {
      const summary = runOne(job);
      summaries.push(summary);
      options.onProgress?.(summary, summaries.length, total);
    }
    return summaries;
  }

  return new Promise<RunSummary[]>((resolve, reject) => {
    const summaries = new Array<RunSummary>(total);
    const pool: Worker[] = [];
    let next = 0;
    let done = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      for (const worker of pool) void worker.terminate();
      reject(error);
    };

    const assign = (worker: Worker): void => {
      if (next >= total) {
        void worker.terminate();
        return;
      }
      const index = next++;
      worker.postMessage({ index, job: jobs[index] });
    };

    for (let w = 0; w < Math.min(options.workers, total); w++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url));
      pool.push(worker);
      worker.on('error', fail);
      worker.on('message', (reply: WorkerReply) => {
        if (settled) return;
        if (!reply.ok) {
          fail(new Error(`Run ${jobs[reply.index].condition}/seed-${jobs[reply.index].seed} failed:\n${reply.error}`));
          return;
        }
        summaries[reply.index] = reply.summary;
        done++;
        options.onProgress?.(reply.summary, done, total);
        if (done === total) {
          settled = true;
          for (const other of pool) void other.terminate();
          resolve(summaries);
        } else {
          assign(worker);
        }
      });
      assign(worker);
    }
  });
}
