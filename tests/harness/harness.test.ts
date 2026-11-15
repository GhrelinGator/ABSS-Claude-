import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { runBatch } from '../../src/harness/batch.ts';
import { listJobs, loadSpecFile, parseSpec, resolveConfig } from '../../src/harness/spec.ts';
import { createStandardSim, hashSim, loadStandardSim, stepSim } from '../../src/sim/index.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

const RAW_SPEC = {
  name: 'harness-test',
  ticks: 300,
  metricsEveryTicks: 100,
  seeds: [11, 12],
  conditions: { plain: {}, 'long-year': { time: { daysPerYear: 60 } } },
};

function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'abss-harness-'));
  return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('a spec resolves each condition on top of the defaults', () => {
  const spec = parseSpec(RAW_SPEC);
  assert.deepEqual(spec.observers, ['census']);
  assert.equal(resolveConfig(spec, 'plain', 11).time.daysPerYear, 48);
  const long = resolveConfig(spec, 'long-year', 12);
  assert.equal(long.time.daysPerYear, 60);
  assert.equal(long.time.ticksPerDay, 144);
  assert.equal(long.seed, 12);
  const jobs = listJobs(spec);
  assert.deepEqual(
    jobs.map((job) => `${job.condition}/${job.seed}`),
    ['plain/11', 'plain/12', 'long-year/11', 'long-year/12'],
  );
});

test('bad specs are rejected before anything runs', () => {
  assert.throws(() => parseSpec({ ...RAW_SPEC, tiks: 5 }), /unknown key "tiks"/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, name: 'has spaces' }), /"name"/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, ticks: 0 }), /"ticks"/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, seeds: [] }), /empty/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, seeds: [1, 1] }), /duplicates/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, seeds: [-4] }), /unsigned 32-bit/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, conditions: {} }), /at least one condition/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, conditions: { a: { seed: 3 } } }), /must not set the seed/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, conditions: { a: { time: { daysPerYer: 3 } } } }), /unknown key/);
  assert.throws(() => parseSpec({ ...RAW_SPEC, observers: ['nonexistent'] }), /unknown observer/);
  assert.deepEqual(parseSpec({ ...RAW_SPEC, seeds: { from: 5, count: 3 } }).seeds, [5, 6, 7]);
});

test('the example spec in experiments/ is valid', () => {
  const spec = loadSpecFile(join(REPO_ROOT, 'experiments/C0-smoke/spec.json'));
  assert.equal(spec.name, 'C0-smoke');
  assert.equal(listJobs(spec).length, 6);
});

test('a batch writes manifests and metrics, and reproduces an in-process run', async () => {
  await withTempDir(async (dir) => {
    const spec = parseSpec(RAW_SPEC);
    const summaries = await runBatch(spec, { outRoot: dir, workers: 1, saveFinalSnapshot: true });
    assert.equal(summaries.length, 4);
    for (const summary of summaries) {
      const expected = createStandardSim(resolveConfig(spec, summary.condition, summary.seed));
      stepSim(expected, spec.ticks);
      assert.equal(summary.finalStateHash, hashSim(expected));

      const manifest = JSON.parse(readFileSync(join(summary.outDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.outcome, 'completed');
      assert.equal(manifest.seed, summary.seed);
      assert.equal(manifest.condition, summary.condition);
      assert.equal(manifest.finalStateHash, summary.finalStateHash);
      assert.deepEqual(manifest.config, expected.config);
      assert.ok('commit' in manifest && 'machine' in manifest && 'pipeline' in manifest);

      const text: string = readFileSync(join(summary.outDir, 'metrics.jsonl'), 'utf8');
      const rows: Array<{ tick: number; census: unknown }> = text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        rows.map((row) => row.tick),
        [0, 100, 200, 300],
      );
      assert.deepEqual(rows[0].census, { agents: 0, scanned: 0 });

      const restored = loadStandardSim(new Uint8Array(readFileSync(join(summary.outDir, 'final.abss'))));
      assert.equal(hashSim(restored), summary.finalStateHash);
    }
    assert.ok(existsSync(join(dir, 'harness-test', 'spec.json')));
    await assert.rejects(runBatch(spec, { outRoot: dir, workers: 1 }), /already exists/);
  });
});

test('worker threads give the same results as running in one thread', async () => {
  await withTempDir(async (dir) => {
    const spec = parseSpec(RAW_SPEC);
    const inline = await runBatch(spec, { outRoot: join(dir, 'inline'), workers: 1 });
    const threaded = await runBatch(spec, { outRoot: join(dir, 'threaded'), workers: 3 });
    const key = (summary: { condition: string; seed: number; finalStateHash: string }): string =>
      `${summary.condition}/${summary.seed}/${summary.finalStateHash}`;
    assert.deepEqual(threaded.map(key), inline.map(key));
    assert.ok(existsSync(join(dir, 'threaded', 'harness-test', 'long-year', 'seed-12', 'metrics.jsonl')));
  });
});
