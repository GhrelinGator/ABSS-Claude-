// Command line for batch runs.
//
//   node src/harness/cli.ts run <spec.json> [--out runs] [--workers N] [--snapshot] [--overwrite]

import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { runBatch } from './batch.ts';
import { loadSpecFile } from './spec.ts';

const USAGE = `Usage:
  node src/harness/cli.ts run <spec.json> [--out runs] [--workers N] [--snapshot] [--overwrite]

  --out DIR       where results go (default: runs)
  --workers N     worker threads (default: all cores but one)
  --snapshot      also save each run's final state as final.abss
  --overwrite     allow writing into an existing experiment directory`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'runs' },
    workers: { type: 'string' },
    snapshot: { type: 'boolean', default: false },
    overwrite: { type: 'boolean', default: false },
  },
});

const [command, specPath] = positionals;
if (command !== 'run' || !specPath || positionals.length !== 2) {
  console.error(USAGE);
  process.exit(2);
}

const workers = values.workers === undefined ? Math.max(1, availableParallelism() - 1) : Number(values.workers);
if (!Number.isInteger(workers) || workers < 1) {
  console.error(`--workers must be a positive integer, got "${values.workers}".`);
  process.exit(2);
}

const outRoot = values.out ?? 'runs';
const spec = loadSpecFile(specPath);
const jobCount = Object.keys(spec.conditions).length * spec.seeds.length;
console.log(`${spec.name}: ${jobCount} runs of ${spec.ticks} ticks on ${Math.min(workers, jobCount)} worker(s)`);

const started = performance.now();
const summaries = await runBatch(spec, {
  outRoot,
  workers,
  saveFinalSnapshot: values.snapshot ?? false,
  overwrite: values.overwrite ?? false,
  onProgress: (summary, done, total) => {
    console.log(
      `  [${done}/${total}] ${summary.condition} seed ${summary.seed}: ` +
        `${summary.wallSeconds.toFixed(1)} s, final state ${summary.finalStateHash}`,
    );
  },
});
const seconds = (performance.now() - started) / 1000;
console.log(`Done: ${summaries.length} runs in ${seconds.toFixed(1)} s. Results in ${outRoot}/${spec.name}/`);
