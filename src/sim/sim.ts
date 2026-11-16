// The simulation kernel: state container, tick loop, snapshots, and hashes.
// Design: docs/DESIGN.md §1.4 and §1.5.
//
// The kernel has no mechanisms of its own. Mechanisms are systems, and the
// systems of the real simulation are listed in pipeline.ts.

import { ByteSink, HashSink, Source } from './core/codec.ts';
import type { Sink } from './core/codec.ts';
import { GridLayers } from './core/grid.ts';
import { Hasher } from './core/hash.ts';
import { isSystemDef } from './core/registry.ts';
import type { SystemDef } from './core/registry.ts';
import { GLOBAL_STREAM_SLOTS, STREAM_WORDS, StreamDomain, seedStream } from './core/rng.ts';
import { EntityStore } from './core/store.ts';
import type { ColumnSpec } from './core/store.ts';
import { canonicalJson, validateConfig, worldHeightM, worldWidthM } from './config.ts';
import type { SimConfig } from './config.ts';

/** First word of every snapshot: the bytes "ABSS". */
export const SNAPSHOT_MAGIC = 0x53534241;
/** Bump whenever the snapshot layout changes. */
export const SNAPSHOT_FORMAT = 1;

/** A registered piece of simulation state other than an entity store. */
export interface StatePart {
  readonly name: string;
  /** True if the part stores anything an agent acquired during its life. */
  readonly holdsLearned: boolean;
  /** Required when holdsLearned is true: does the part hold nothing for this agent slot? */
  learnedEmptyFor?(agentSlot: number): boolean;
  /** Optional numeric readings for observers and the viewer, read through src/sim/readonly.ts. */
  readings?(): ArrayLike<number>;
  write(sink: Sink): void;
  read(source: Source): void;
}

/** Columns every agent has, whatever else later phases add. */
export const AGENT_COLUMNS = {
  /** Position in metres, measured from the corner of the world where x and y are lowest. */
  x: { name: 'x', dtype: 'f64', category: 'body' },
  y: { name: 'y', dtype: 'f64', category: 'body' },
  /** Tick at which the slot was assigned. */
  spawnTick: { name: 'spawnTick', dtype: 'f64', category: 'identity' },
  /** The agent's own random stream. */
  rng: { name: 'rng', dtype: 'u32', category: 'kernel', width: STREAM_WORDS },
} as const satisfies Record<string, ColumnSpec>;

export class SimState {
  /** Ticks completed so far. */
  tick = 0;
  /** Run-wide random streams, one per StreamDomain slot. */
  readonly streams: Uint32Array;
  readonly stores: EntityStore[] = [];
  readonly parts: StatePart[] = [];
  readonly agents: EntityStore;
  readonly world: GridLayers;

  private sealed = false;

  constructor(config: SimConfig) {
    this.streams = new Uint32Array(GLOBAL_STREAM_SLOTS * STREAM_WORDS);
    for (let slot = 0; slot < GLOBAL_STREAM_SLOTS; slot++) {
      seedStream(this.streams, slot * STREAM_WORDS, config.seed, slot, 0);
    }
    this.agents = this.addStore('agents');
    this.agents.ensureColumn(AGENT_COLUMNS.x);
    this.agents.ensureColumn(AGENT_COLUMNS.y);
    this.agents.ensureColumn(AGENT_COLUMNS.spawnTick);
    this.agents.ensureColumn(AGENT_COLUMNS.rng);
    this.world = new GridLayers(config.world.widthCells, config.world.heightCells);
    this.addPart(this.world);
  }

  /** Create another entity store. Only possible before the state is sealed. */
  addStore(name: string): EntityStore {
    if (this.sealed) throw new Error(`Store "${name}" was added after the state was sealed.`);
    if (this.stores.some((store) => store.name === name)) throw new Error(`Store "${name}" already exists.`);
    const store = new EntityStore(name);
    this.stores.push(store);
    return store;
  }

  store(name: string): EntityStore {
    const store = this.stores.find((candidate) => candidate.name === name);
    if (!store) throw new Error(`There is no store "${name}".`);
    return store;
  }

  /** Register a state part. Only possible before the state is sealed. */
  addPart(part: StatePart): void {
    if (this.sealed) throw new Error(`Part "${part.name}" was added after the state was sealed.`);
    if (this.parts.some((existing) => existing.name === part.name)) {
      throw new Error(`Part "${part.name}" already exists.`);
    }
    if (part.holdsLearned && typeof part.learnedEmptyFor !== 'function') {
      throw new Error(`Part "${part.name}" holds learned content, so it must implement learnedEmptyFor.`);
    }
    this.parts.push(part);
  }

  /** Freeze the layout: no more stores, parts, columns, or layers. */
  seal(): void {
    this.sealed = true;
    for (const store of this.stores) store.seal();
    this.world.seal();
  }
}

export interface Sim {
  readonly config: SimConfig;
  readonly state: SimState;
  readonly pipeline: readonly SystemDef[];
  /** One step function per pipeline entry, in the same order. */
  readonly runners: ReadonlyArray<() => void>;
}

/** Optional hooks around each system run, for profiling from outside the simulation. */
export interface StepProbe {
  enter(systemIndex: number): void;
  exit(systemIndex: number): void;
}

/** Build a simulation at tick 0 with the given systems, in the given order, and run their setup steps. */
export function createSim(config: SimConfig, pipeline: readonly SystemDef[]): Sim {
  const sim = assembleSim(config, pipeline);
  for (const def of sim.pipeline) {
    if (def.init) def.init(sim);
  }
  if (sim.state.agents.count !== 0) throw new Error('A setup step spawned agents; setup builds the world only.');
  return sim;
}

/** Declare, seal, and bind every system, without running any setup step. */
function assembleSim(config: SimConfig, pipeline: readonly SystemDef[]): Sim {
  const checked = validateConfig(config);
  const names = new Set<string>();
  for (const def of pipeline) {
    if (!isSystemDef(def)) throw new TypeError('Every pipeline entry must come from defineSystem.');
    if (names.has(def.name)) throw new Error(`The pipeline lists system "${def.name}" twice.`);
    names.add(def.name);
  }
  const state = new SimState(checked);
  for (const def of pipeline) {
    if (def.declare) def.declare(state);
  }
  state.seal();
  const runners: Array<() => void> = [];
  const sim: Sim = Object.freeze({ config: checked, state, pipeline: Object.freeze([...pipeline]), runners });
  for (const def of pipeline) runners.push(def.create(sim));
  Object.freeze(runners);
  return sim;
}

/**
 * Assign a slot to a new agent at (x, y) and return the slot. This is the
 * only place in the simulation that creates an agent, so it is the single
 * point the blank-slate guardrail has to watch. The slot starts zeroed; the
 * caller fills in body and genome and must leave every learned column empty.
 */
export function spawnAgent(sim: Sim, x: number, y: number): number {
  const { state, config } = sim;
  if (!(x >= 0 && x < worldWidthM(config) && y >= 0 && y < worldHeightM(config))) {
    throw new RangeError(`spawnAgent: (${x}, ${y}) is outside the world.`);
  }
  const agents = state.agents;
  const slot = agents.spawn();
  const id = agents.id.data[slot];
  seedStream(agents.column<Uint32Array>('rng').data, slot * STREAM_WORDS, config.seed, StreamDomain.AGENT, id);
  agents.column<Float64Array>('x').data[slot] = x;
  agents.column<Float64Array>('y').data[slot] = y;
  agents.column<Float64Array>('spawnTick').data[slot] = state.tick;
  return slot;
}

/** Advance the simulation. Each tick runs every due system in pipeline order, then moves the clock. */
export function stepSim(sim: Sim, ticks = 1, probe?: StepProbe): void {
  const { pipeline, runners, state } = sim;
  const n = runners.length;
  for (let t = 0; t < ticks; t++) {
    const tick = state.tick;
    for (let i = 0; i < n; i++) {
      const every = pipeline[i].every;
      if (every !== 1 && tick % every !== 0) continue;
      if (probe) probe.enter(i);
      runners[i]();
      if (probe) probe.exit(i);
    }
    state.tick = tick + 1;
  }
}

function writeSim(sim: Sim, sink: Sink): void {
  const { state } = sim;
  sink.u32(SNAPSHOT_MAGIC);
  sink.u32(SNAPSHOT_FORMAT);
  sink.str(canonicalJson(sim.config));
  sink.u32(sim.pipeline.length);
  for (const def of sim.pipeline) sink.str(def.name);
  sink.f64(state.tick);
  sink.array(state.streams);
  sink.u32(state.stores.length);
  for (const store of state.stores) {
    sink.str(store.name);
    store.write(sink);
  }
  sink.u32(state.parts.length);
  for (const part of state.parts) {
    sink.str(part.name);
    part.write(sink);
  }
}

/** 128-bit hash of the complete simulation state, config included, as 32 hex digits. */
export function hashSim(sim: Sim): string {
  const hasher = new Hasher();
  writeSim(sim, new HashSink(hasher));
  return hasher.digest();
}

/** Serialise the complete simulation state. hashSim(sim) is the hash of exactly these bytes. */
export function saveSim(sim: Sim): Uint8Array {
  const sink = new ByteSink();
  writeSim(sim, sink);
  return sink.bytes();
}

/**
 * Rebuild a simulation from a snapshot. The config comes from the snapshot;
 * the pipeline must be the one the snapshot was taken with.
 */
export function loadSim(bytes: Uint8Array, pipeline: readonly SystemDef[]): Sim {
  const source = new Source(bytes);
  if (source.u32() !== SNAPSHOT_MAGIC) throw new Error('Not an ABSS snapshot.');
  const format = source.u32();
  if (format !== SNAPSHOT_FORMAT) {
    throw new Error(`Snapshot format ${format} is not supported (this build reads format ${SNAPSHOT_FORMAT}).`);
  }
  const config = validateConfig(JSON.parse(source.str()));
  // Setup steps are not run: the snapshot already holds what they built.
  const sim = assembleSim(config, pipeline);
  const { state } = sim;

  const nsystems = source.u32();
  const names: string[] = [];
  for (let i = 0; i < nsystems; i++) names.push(source.str());
  const expected = pipeline.map((def) => def.name);
  if (names.length !== expected.length || names.some((name, i) => name !== expected[i])) {
    throw new Error(`Snapshot was taken with pipeline [${names.join(', ')}], not [${expected.join(', ')}].`);
  }

  state.tick = source.f64();
  const streams = source.array('u32');
  if (streams.length !== state.streams.length) throw new Error('Snapshot stream block has the wrong length.');
  state.streams.set(streams);

  const nstores = source.u32();
  if (nstores !== state.stores.length) throw new Error('Snapshot has a different number of stores.');
  for (const store of state.stores) {
    const name = source.str();
    if (name !== store.name) throw new Error(`Snapshot store "${name}" does not match "${store.name}".`);
    store.read(source);
  }

  const nparts = source.u32();
  if (nparts !== state.parts.length) throw new Error('Snapshot has a different number of state parts.');
  for (const part of state.parts) {
    const name = source.str();
    if (name !== part.name) throw new Error(`Snapshot part "${name}" does not match "${part.name}".`);
    part.read(source);
  }

  if (!source.done) throw new Error('Snapshot has trailing bytes.');
  return sim;
}
