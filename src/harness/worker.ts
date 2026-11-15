// Worker-thread entry point for batch runs. Receives one job at a time,
// runs it, and reports the summary or the error back to the main thread.

import { parentPort } from 'node:worker_threads';
import { runOne } from './run.ts';
import type { RunJob } from './run.ts';

const port = parentPort;
if (!port) throw new Error('src/harness/worker.ts must be started as a worker thread.');

port.on('message', (message: { index: number; job: RunJob }) => {
  try {
    port.postMessage({ ok: true, index: message.index, summary: runOne(message.job) });
  } catch (error) {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    port.postMessage({ ok: false, index: message.index, error: text });
  }
});
