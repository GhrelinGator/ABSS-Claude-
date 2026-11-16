// Experiment specifications: which conditions, which seeds, how long, and
// what to measure. A spec plus a commit hash is everything needed to
// reproduce a batch of runs.
//
// Runs made through the harness always use the real pipeline. Conditions
// differ only in config, which is how ablations and null models are expressed
// (docs/DESIGN.md §8.3).

import { readFileSync } from 'node:fs';
import { observerNames } from '../analysis/index.ts';
import { defaultConfig, validateConfig } from '../sim/index.ts';
import type { SimConfig } from '../sim/index.ts';

type Overrides = Readonly<Record<string, unknown>>;

export interface ExperimentSpec {
  readonly name: string;
  readonly description: string;
  /** Ticks to simulate in every run. */
  readonly ticks: number;
  /** Observers are sampled at tick 0 and then every this many ticks. */
  readonly metricsEveryTicks: number;
  readonly seeds: readonly number[];
  /** Config overrides applied to every condition, on top of the defaults. */
  readonly base: Overrides;
  /** Config overrides per condition, applied on top of `base`. */
  readonly conditions: Readonly<Record<string, Overrides>>;
  readonly observers: readonly string[];
}

export interface Job {
  readonly experiment: string;
  readonly condition: string;
  readonly seed: number;
  readonly config: SimConfig;
  readonly ticks: number;
  readonly metricsEveryTicks: number;
  readonly observers: readonly string[];
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SPEC_KEYS = ['name', 'description', 'ticks', 'metricsEveryTicks', 'seeds', 'base', 'conditions', 'observers'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function positiveInteger(where: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Spec: "${where}" must be a positive integer, got ${String(value)}.`);
  }
  return value;
}

function isSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function parseSeeds(value: unknown): number[] {
  let seeds: unknown[];
  if (Array.isArray(value)) {
    seeds = value;
  } else if (isPlainObject(value) && isSeed(value.from) && typeof value.count === 'number') {
    const count = positiveInteger('seeds.count', value.count);
    const from = value.from;
    seeds = Array.from({ length: count }, (_, i) => from + i);
  } else {
    throw new Error('Spec: "seeds" must be a list of seeds or { "from": n, "count": n }.');
  }
  if (seeds.length === 0) throw new Error('Spec: "seeds" is empty.');
  for (const seed of seeds) {
    if (!isSeed(seed)) throw new Error(`Spec: seed ${String(seed)} is not an unsigned 32-bit integer.`);
  }
  if (new Set(seeds).size !== seeds.length) throw new Error('Spec: "seeds" contains duplicates.');
  return seeds as number[];
}

function parseOverrides(where: string, value: unknown): Overrides {
  if (!isPlainObject(value)) throw new Error(`Spec: "${where}" must be an object of config overrides.`);
  if ('seed' in value) throw new Error(`Spec: "${where}" must not set the seed; seeds come from "seeds".`);
  return value;
}

function deepMerge(target: unknown, patch: unknown): unknown {
  if (isPlainObject(target) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(patch)) {
      out[key] = key in target ? deepMerge(target[key], value) : value;
    }
    return out;
  }
  return patch;
}

/** The full config for one condition and seed: defaults, then the spec's base, then the condition's overrides. */
export function resolveConfig(spec: ExperimentSpec, condition: string, seed: number): SimConfig {
  const overrides = spec.conditions[condition];
  if (!overrides) throw new Error(`Spec "${spec.name}" has no condition "${condition}".`);
  const defaults = JSON.parse(JSON.stringify(defaultConfig(seed)));
  return validateConfig(deepMerge(deepMerge(defaults, spec.base), overrides));
}

/** Check a parsed spec file and fill in defaults. Throws on anything unexpected. */
export function parseSpec(raw: unknown): ExperimentSpec {
  if (!isPlainObject(raw)) throw new Error('Spec: the file must contain a JSON object.');
  for (const key of Object.keys(raw)) {
    if (!SPEC_KEYS.includes(key)) throw new Error(`Spec: unknown key "${key}".`);
  }
  if (typeof raw.name !== 'string' || !NAME_PATTERN.test(raw.name)) {
    throw new Error('Spec: "name" must be letters, digits, "-" and "_" (it becomes a directory name).');
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    throw new Error('Spec: "description" must be a string.');
  }
  if (!isPlainObject(raw.conditions) || Object.keys(raw.conditions).length === 0) {
    throw new Error('Spec: "conditions" must name at least one condition.');
  }
  const conditions: Record<string, Overrides> = {};
  for (const [name, overrides] of Object.entries(raw.conditions)) {
    if (!NAME_PATTERN.test(name)) throw new Error(`Spec: condition name "${name}" is not a valid directory name.`);
    conditions[name] = parseOverrides(`conditions.${name}`, overrides);
  }
  const observers = raw.observers === undefined ? ['census'] : raw.observers;
  if (!Array.isArray(observers) || observers.some((name) => typeof name !== 'string')) {
    throw new Error('Spec: "observers" must be a list of observer names.');
  }
  const known = observerNames();
  for (const name of observers) {
    if (!known.includes(name)) throw new Error(`Spec: unknown observer "${name}". Known: ${known.join(', ')}.`);
  }
  const spec: ExperimentSpec = {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    ticks: positiveInteger('ticks', raw.ticks),
    metricsEveryTicks: positiveInteger('metricsEveryTicks', raw.metricsEveryTicks),
    seeds: parseSeeds(raw.seeds),
    base: raw.base === undefined ? {} : parseOverrides('base', raw.base),
    conditions,
    observers,
  };
  // Resolve every condition once now, so a bad override fails before any run starts.
  for (const condition of Object.keys(spec.conditions)) resolveConfig(spec, condition, spec.seeds[0]);
  return spec;
}

export function loadSpecFile(path: string): ExperimentSpec {
  return parseSpec(JSON.parse(readFileSync(path, 'utf8')));
}

/** One job per condition and seed, conditions in spec order. */
export function listJobs(spec: ExperimentSpec): Job[] {
  const jobs: Job[] = [];
  for (const condition of Object.keys(spec.conditions)) {
    for (const seed of spec.seeds) {
      jobs.push({
        experiment: spec.name,
        condition,
        seed,
        config: resolveConfig(spec, condition, seed),
        ticks: spec.ticks,
        metricsEveryTicks: spec.metricsEveryTicks,
        observers: spec.observers,
      });
    }
  }
  return jobs;
}
