// Memory (docs/DESIGN.md §4.7.5–§4.7.10, §4.10): what one agent learns from what it does. An
// association table of (cue, act) → the change in each drive channel during the act and in the hours
// after it, learned by Kalman–Rescorla–Wagner when an act ends; an episodic buffer that hands delayed
// consequences back to the acts that came before, by eligibility; and a memory of things worth acting
// on and where they were. It is also the predictor choice reads (§4.7.10), replacing 3.3's blank one.
// Since 3.5 it also keeps hidden-cause nodes (§4.11): what no known cause could explain, set aside with
// where, in what light and in what season it happened, and learned about like anything seen. Since 3.6b
// a second, longer kernel ties the gut's part of later pain to acts of eating and drinking (§4.13).
//
// Every number an agent holds here is learned content, kept in store columns of category `learned`, so
// a new agent starts with nothing (T5) and the blank-slate guardrail covers it with no extra code. The
// mind gets cues, never labels: nothing here knows what a class of thing is or is for.

import { exp } from '../core/dmath.ts';
import { STREAM_WORDS, nextFloat } from '../core/rng.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sim, SimState } from '../sim.ts';
import { GENETICS_COLUMNS } from '../body/genetics.ts';
import { ACTS, ACT_COLUMNS, ACT_KINDS, ACT_TALLY_PART, Act, ActEnd, ActTally } from './acts.ts';
import type { Candidates, ChoiceDials, Predictor } from './choice.ts';
import { ClassKind, CueKind, SELF_CUE, classKind, cue, cueKind, cuePayload } from './cues.ts';
import { MIND_DIAL_DEFAULTS } from './dials.ts';
import { CHANNELS, Channel } from './interoception.ts';
import { PERCEPTION, PerceptSource } from './perception.ts';
import type { Percepts } from './perception.ts';
import { worldWidthM } from '../config.ts';

/** Every number of memory (§4.10) [provisional]. */
export const MEMORY = {
  /** Association slots an agent, and the most in use before the least recently learned is forgotten (§4.7.5). */
  slots: 512,
  most: 384,
  /** Slots read when choosing one to forget. */
  sampled: 8,
  /** Prior variance of a key about a thing (V₀), and a context key's share of it (§4.7.6). */
  priorVariance: 0.04,
  contextShare: 0.1,
  /** Outcome noise the rule assumes (R), and variance regained an hour unused (Q: 2 × 10⁻⁵ a 10-minute tick). */
  outcomeNoise: 0.01,
  regrowthPerHour: 1.2e-4,
  /** An error is salient when its channels' absolute sum passes this (§4.7.7). */
  salient: 0.08,
  /** Records in the episodic buffer; a record older than this many half-lives gets no credit. */
  records: 24,
  traceHalfLives: 6,
  /** Place memory: places, things a place, things offered as "go there" at a choice, and the least worth remembered (§4.10.4). */
  places: 64,
  thingsPerPlace: 4,
  goThere: 3,
  rememberAbove: 0.01,
  /** Salient percepts in a context (§4.7.3). */
  salientPercepts: 2,
  /** Hidden-cause nodes an agent, and the most active at once (§4.11.1, §4.11.2). */
  nodes: 16,
  activeNodes: 2,
  /** A node's strength halves over this many compressed years since it was last given a residual (§4.11.2). */
  nodeHalfLifeYears: 1,
  /** Act kinds in a node's signature: the act that ended and the ones before it in the buffer (§4.11.1). */
  recentActs: 3,
} as const;
const K = MEMORY;
const S = K.slots;
const LOG2_S = 9;
if (1 << LOG2_S !== S) throw new Error('memory: the slot count must be 2^LOG2_S.');
const MASK = S - 1;
const E = K.records;
const P = K.places;
const T = K.thingsPerPlace;
const N = K.nodes;
const LN2 = 0.6931471805599453;
/** Largest node serial before they start again from 1 (24-bit cue payloads). */
const SERIAL_MAX = 0xffffff;

/** What one agent remembers (§4.10.1). All learned content. */
export const MEMORY_COLUMNS = {
  memKey: { name: 'memKey', dtype: 'u32', category: 'learned', width: S },
  memNow: { name: 'memNow', dtype: 'f32', category: 'learned', width: S * CHANNELS },
  memLater: { name: 'memLater', dtype: 'f32', category: 'learned', width: S * CHANNELS },
  memVar: { name: 'memVar', dtype: 'f32', category: 'learned', width: S },
  memLaterVar: { name: 'memLaterVar', dtype: 'f32', category: 'learned', width: S },
  memPainVar: { name: 'memPainVar', dtype: 'f32', category: 'learned', width: S },
  memUsed: { name: 'memUsed', dtype: 'u32', category: 'learned', width: S },
  memCount: { name: 'memCount', dtype: 'u16', category: 'learned' },
  epiKey: { name: 'epiKey', dtype: 'u32', category: 'learned', width: E },
  epiPlace: { name: 'epiPlace', dtype: 'u32', category: 'learned', width: E },
  epiEnd: { name: 'epiEnd', dtype: 'u32', category: 'learned', width: E },
  epiCredit: { name: 'epiCredit', dtype: 'f32', category: 'learned', width: E * CHANNELS },
  epiNext: { name: 'epiNext', dtype: 'u8', category: 'learned' },
  placeId: { name: 'placeId', dtype: 'u32', category: 'learned', width: P },
  placeSeen: { name: 'placeSeen', dtype: 'u32', category: 'learned', width: P },
  placeKey: { name: 'placeKey', dtype: 'u32', category: 'learned', width: P * T },
  placeCell: { name: 'placeCell', dtype: 'u32', category: 'learned', width: P * T },
  /** The channel a remembered thing relieved most, and by how much, the last time it was used. */
  placeChannel: { name: 'placeChannel', dtype: 'u8', category: 'learned', width: P * T },
  placeRelief: { name: 'placeRelief', dtype: 'f32', category: 'learned', width: P * T },
  /** Hidden-cause nodes (§4.11.1): serial (0: empty), signature, strength and when last given a residual. */
  nodeId: { name: 'nodeId', dtype: 'u32', category: 'learned', width: N },
  nodePlace: { name: 'nodePlace', dtype: 'u32', category: 'learned', width: N },
  nodeLight: { name: 'nodeLight', dtype: 'u8', category: 'learned', width: N },
  nodeDay: { name: 'nodeDay', dtype: 'u8', category: 'learned', width: N },
  nodeActs: { name: 'nodeActs', dtype: 'u16', category: 'learned', width: N },
  nodeStrength: { name: 'nodeStrength', dtype: 'f32', category: 'learned', width: N },
  nodeLast: { name: 'nodeLast', dtype: 'u32', category: 'learned', width: N },
  nodeSerial: { name: 'nodeSerial', dtype: 'u32', category: 'learned' },
  /** The (node, act) keys of the nodes active when each record's act ended. */
  epiNodes: { name: 'epiNodes', dtype: 'u32', category: 'learned', width: E * K.activeNodes },
  /** A consume record's credit on pain from the second kernel, beyond its general credit (§4.13.2). */
  epiGut: { name: 'epiGut', dtype: 'f32', category: 'learned', width: E },
  /** The part of pain the gut added as the act under way began (§4.13.1): body state, like actDrives. */
  actGutPain: { name: 'actGutPain', dtype: 'f32', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const C = MEMORY_COLUMNS;

export function declareMemory(state: SimState): void {
  for (const spec of Object.values(C)) state.agents.ensureColumn(spec);
}

/** An association key: a cue and an act kind (0: whatever was done). Never 0, because no cue is. */
export function keyOf(c: number, act: number): number {
  return ((c << 4) | act) >>> 0;
}
function bitCount16(x: number): number {
  let n = 0;
  for (let v = x & 0xffff; v !== 0; v &= v - 1) n++;
  return n;
}
if (MEMORY.activeNodes !== 2) throw new Error('memory: the buffer keeps two node keys a record.');

export function cueOfKey(k: number): number {
  return k >>> 4;
}
export function actOfKey(k: number): number {
  return k & 15;
}

/** Is a cue context (place, light, day length, warmth), which starts at a tenth of a thing's plasticity (§4.7.6)? */
export function isContext(c: number): boolean {
  const kind = cueKind(c);
  return kind === CueKind.PLACE || kind === CueKind.LIGHT || kind === CueKind.DAY_LENGTH || kind === CueKind.WARMTH;
}

/** Worth of an outcome `o` to drives `d` (§4.7.10's first term). */
export function worthOf(d: ArrayLike<number>, dOff: number, o: ArrayLike<number>, oOff: number): number {
  let v = 0;
  for (let ch = 0; ch < CHANNELS; ch++) {
    const now = d[dOff + ch];
    let next = now + o[oOff + ch];
    if (next < 0) next = 0;
    else if (next > 1) next = 1;
    v += now * now - next * next;
  }
  return v;
}

/** One agent's dials as memory and choice read them (§4.10.6, §4.11.6). */
export interface MindDials extends ChoiceDials {
  learningRate: number;
  traceHalfLife: number;
  /** As the genome carries it: a liability, read as max(0, value). */
  hiddenCauseBias: number;
  /** Half-life, hours, of the second kernel for consume acts on the gut's part of pain (§4.13.3). */
  gutTraceHalfLife: number;
}

/** A node as `node()` copies it: serial, place, light, day length, act-kind mask, strength, last given a residual. */
export const NODE_LENGTH = 7;

/** A slot's contents, for tests and observers: now (8), later (8), variance, later variance, σ²_pain, last learned. */
export const ENTRY_LENGTH = 2 * CHANNELS + 4;

export interface Memory extends Predictor {
  /** Fetch columns afresh: once a tick, before any agent decides. */
  refresh(): void;
  /**
   * Learn from agent `slot`'s act that just ended, with the look made now, the drives now and the part of
   * pain the gut adds now (§4.10.2, §4.13; 0 if not given).
   */
  learn(slot: number, look: Percepts, drives: Float64Array, offset: number, gutPain?: number): void;
  /** Add remembered things as candidates, the most worth to drives `drives` (from `offset`) first (§4.10.4). */
  recall(slot: number, look: Percepts, cands: Candidates, drives: Float64Array, offset: number): void;
  /** The dials of the agent last begun. */
  readonly dials: MindDials;

  // Lower-level doors, used by learn() and by tests that build cases by hand.
  /** Read agent `slot`'s dials into `dials`. */
  readDials(slot: number): MindDials;
  /**
   * Kalman–Rescorla–Wagner over `keys[0..n)` for outcome `o` at `tick`, with the drives at the act's start
   * in `start` (from `startOff`) if the prediction is to be held within what the body could show; the
   * error is left in `error`. Returns Σ|δ|.
   */
  update(slot: number, keys: Uint32Array, n: number, o: ArrayLike<number>, tick: number, placeKey?: number, start?: ArrayLike<number>, startOff?: number): number;
  /**
   * Credit every record in the buffer with `error` by its eligibility at `tick`, and consume records also
   * with the gut's part of the pain error, `gutError`, by the second kernel (§4.13.2).
   */
  credit(slot: number, error: ArrayLike<number>, tick: number, gutError?: number): void;
  /** Push an ended act into the buffer, with the (node, act) keys of the nodes active then; closes the oldest record if it is full. */
  push(slot: number, key: number, placeKey: number, tick: number, node0?: number, node1?: number): void;
  /** The error of the last update. */
  readonly error: Float64Array;
  /** What no key of the last update absorbed: error × R ÷ (Σv + R) (§4.11.4). */
  readonly residual: Float64Array;
  /**
   * The step of §4.11.5 on the last update's residual, for agent `slot` after act `act` in the context of
   * `look`, with the nodes active in it counted as having taken part. Returns the node's slot (0..15) that
   * was posited or strengthened, or -1.
   */
  infer(slot: number, look: Percepts, act: number, tick: number): number;
  /** The cues of the nodes active in `look` now (at most two; the strongest when more are). */
  activeNodes(slot: number, look: Percepts, out: Uint32Array): number;
  /** Nodes held. */
  nodeCount(slot: number): number;
  /** Copy node `q` (0..15) into `out` (NODE_LENGTH numbers); false if the slot is empty. */
  node(slot: number, q: number, out: Float64Array): boolean;
  /** Copy a key's entry into `out` (ENTRY_LENGTH numbers); false if the key is not held. */
  entry(slot: number, key: number, out: Float64Array): boolean;
  /** Keys in use. */
  count(slot: number): number;
  /** Remember a thing at `cell` that relieved `channel` by `relief`, or forget it (§4.10.4). */
  remember(slot: number, key: number, cell: number, channel: number, relief: number, tick: number): void;
  forget(slot: number, key: number, cell: number): void;
  /** The 400 m place of a map cell. */
  placeOfCell(cell: number): number;
}

export function createMemory(sim: Sim): Memory {
  const { config, state } = sim;
  const agents = state.agents;
  const { widthCells: W, cellSizeM: cs } = config.world;
  const ticksPerHour = config.time.ticksPerDay / 24;
  const placeColumns = Math.ceil(worldWidthM(config) / PERCEPTION.placeM);
  const tripPerM = 1 / (ACTS.walkMs * ACTS.exploreS);
  const genomes = agents.hasColumn(GENETICS_COLUMNS.genomeFormed.name);
  const nodeHalfLifeTicks = K.nodeHalfLifeYears * config.time.daysPerYear * config.time.ticksPerDay;
  const tallyPart = state.parts.find((p) => p.name === ACT_TALLY_PART);
  const tally = (tallyPart?.readings?.() as Float64Array | undefined) ?? new Float64Array(ActTally.LENGTH);

  let key: Uint32Array;
  let now: Float32Array;
  let later: Float32Array;
  let vNow: Float32Array;
  let vLater: Float32Array;
  let vPain: Float32Array;
  let used: Uint32Array;
  let count: Uint16Array;
  let eKey: Uint32Array;
  let ePlace: Uint32Array;
  let eEnd: Uint32Array;
  let eCredit: Float32Array;
  let eNext: Uint8Array;
  let pId: Uint32Array;
  let pSeen: Uint32Array;
  let pChannel: Uint8Array;
  let pRelief: Float32Array;
  let pKey: Uint32Array;
  let pCell: Uint32Array;
  let nId: Uint32Array;
  let nPlace: Uint32Array;
  let nLight: Uint8Array;
  let nDay: Uint8Array;
  let nActs: Uint16Array;
  let nStrength: Float32Array;
  let nLast: Uint32Array;
  let nSerial: Uint32Array;
  let eNodes: Uint32Array;
  let eGut: Float32Array;
  let gutAt: Float32Array;
  let rng: Uint32Array;
  let ax: Float64Array;
  let ay: Float64Array;
  let actKind: Uint8Array;
  let actEnd: Uint8Array;
  let actCue: Uint32Array;
  let actSource: Uint8Array;
  let actRef: Float64Array;
  let actDrives: Float32Array;
  let formed: Uint8Array | null = null;
  let dialColumns: Float64Array[] = [];

  function refresh(): void {
    key = agents.column<Uint32Array>(C.memKey.name).data;
    now = agents.column<Float32Array>(C.memNow.name).data;
    later = agents.column<Float32Array>(C.memLater.name).data;
    vNow = agents.column<Float32Array>(C.memVar.name).data;
    vLater = agents.column<Float32Array>(C.memLaterVar.name).data;
    vPain = agents.column<Float32Array>(C.memPainVar.name).data;
    used = agents.column<Uint32Array>(C.memUsed.name).data;
    count = agents.column<Uint16Array>(C.memCount.name).data;
    eKey = agents.column<Uint32Array>(C.epiKey.name).data;
    ePlace = agents.column<Uint32Array>(C.epiPlace.name).data;
    eEnd = agents.column<Uint32Array>(C.epiEnd.name).data;
    eCredit = agents.column<Float32Array>(C.epiCredit.name).data;
    eNext = agents.column<Uint8Array>(C.epiNext.name).data;
    pId = agents.column<Uint32Array>(C.placeId.name).data;
    pSeen = agents.column<Uint32Array>(C.placeSeen.name).data;
    pChannel = agents.column<Uint8Array>(C.placeChannel.name).data;
    pRelief = agents.column<Float32Array>(C.placeRelief.name).data;
    pKey = agents.column<Uint32Array>(C.placeKey.name).data;
    pCell = agents.column<Uint32Array>(C.placeCell.name).data;
    nId = agents.column<Uint32Array>(C.nodeId.name).data;
    nPlace = agents.column<Uint32Array>(C.nodePlace.name).data;
    nLight = agents.column<Uint8Array>(C.nodeLight.name).data;
    nDay = agents.column<Uint8Array>(C.nodeDay.name).data;
    nActs = agents.column<Uint16Array>(C.nodeActs.name).data;
    nStrength = agents.column<Float32Array>(C.nodeStrength.name).data;
    nLast = agents.column<Uint32Array>(C.nodeLast.name).data;
    nSerial = agents.column<Uint32Array>(C.nodeSerial.name).data;
    eNodes = agents.column<Uint32Array>(C.epiNodes.name).data;
    eGut = agents.column<Float32Array>(C.epiGut.name).data;
    gutAt = agents.column<Float32Array>(C.actGutPain.name).data;
    rng = agents.column<Uint32Array>('rng').data;
    ax = agents.column<Float64Array>('x').data;
    ay = agents.column<Float64Array>('y').data;
    actKind = agents.column<Uint8Array>(ACT_COLUMNS.actKind.name).data;
    actEnd = agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data;
    actCue = agents.column<Uint32Array>(ACT_COLUMNS.actCue.name).data;
    actSource = agents.column<Uint8Array>(ACT_COLUMNS.actSource.name).data;
    actRef = agents.column<Float64Array>(ACT_COLUMNS.actRef.name).data;
    actDrives = agents.column<Float32Array>(ACT_COLUMNS.actDrives.name).data;
    if (genomes) {
      formed = agents.column<Uint8Array>(GENETICS_COLUMNS.genomeFormed.name).data;
      const G = GENETICS_COLUMNS;
      dialColumns = [
        G.learningRate,
        G.traceHalfLife,
        G.curiosity,
        G.explorationTemperature,
        G.riskTolerance,
        G.hiddenCauseBias,
        G.gutTraceHalfLife,
        G.needCuriosity,
        G.restlessness,
      ].map(
        (spec) => agents.column<Float64Array>(spec.name).data,
      );
    }
  }

  // ---- dials

  const dials: MindDials = { ...MIND_DIAL_DEFAULTS };
  let prior = K.priorVariance;
  let regrowth = K.regrowthPerHour / ticksPerHour;
  let traceTicks = 0;
  let gutTicks = 0;

  function readDials(slot: number): MindDials {
    if (formed && formed[slot] === 1) {
      dials.learningRate = dialColumns[0][slot];
      dials.traceHalfLife = dialColumns[1][slot];
      dials.curiosity = dialColumns[2][slot];
      dials.explorationTemperature = dialColumns[3][slot];
      dials.riskTolerance = dialColumns[4][slot];
      dials.hiddenCauseBias = dialColumns[5][slot];
      dials.gutTraceHalfLife = dialColumns[6][slot];
      dials.needCuriosity = dialColumns[7][slot];
      dials.restlessness = dialColumns[8][slot];
    } else {
      dials.learningRate = MIND_DIAL_DEFAULTS.learningRate;
      dials.traceHalfLife = MIND_DIAL_DEFAULTS.traceHalfLife;
      dials.curiosity = MIND_DIAL_DEFAULTS.curiosity;
      dials.explorationTemperature = MIND_DIAL_DEFAULTS.explorationTemperature;
      dials.riskTolerance = MIND_DIAL_DEFAULTS.riskTolerance;
      dials.hiddenCauseBias = MIND_DIAL_DEFAULTS.hiddenCauseBias;
      dials.gutTraceHalfLife = MIND_DIAL_DEFAULTS.gutTraceHalfLife;
      dials.needCuriosity = MIND_DIAL_DEFAULTS.needCuriosity;
      dials.restlessness = MIND_DIAL_DEFAULTS.restlessness;
    }
    prior = K.priorVariance * dials.learningRate;
    regrowth = (K.regrowthPerHour / ticksPerHour) * dials.learningRate;
    traceTicks = dials.traceHalfLife * ticksPerHour;
    gutTicks = dials.gutTraceHalfLife * ticksPerHour;
    return dials;
  }

  function priorOf(k: number): number {
    return isContext(cueOfKey(k)) ? prior * K.contextShare : prior;
  }

  // ---- the table (§4.10.1)

  function probeStart(k: number): number {
    return Math.imul(k, 0x9e3779b1) >>> (32 - LOG2_S);
  }

  /** Global index of key `k` in agent `a`'s table, or -1. */
  function find(a: number, k: number): number {
    const base = a * S;
    let i = probeStart(k);
    for (;;) {
      const kk = key[base + i];
      if (kk === k) return base + i;
      if (kk === 0) return -1;
      i = (i + 1) & MASK;
    }
  }

  function moveSlot(from: number, to: number): void {
    key[to] = key[from];
    vNow[to] = vNow[from];
    vLater[to] = vLater[from];
    vPain[to] = vPain[from];
    used[to] = used[from];
    const f = from * CHANNELS;
    const t = to * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) {
      now[t + ch] = now[f + ch];
      later[t + ch] = later[f + ch];
    }
  }

  function clearSlot(s: number): void {
    key[s] = 0;
    vNow[s] = 0;
    vLater[s] = 0;
    vPain[s] = 0;
    used[s] = 0;
    const o = s * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) {
      now[o + ch] = 0;
      later[o + ch] = 0;
    }
  }

  // Keys in the update under way: never chosen to be forgotten.
  const keep = new Uint32Array(24);
  let keepN = 0;

  /** Forget the least recently learned of `sampled` slots read from a start hashed from `k` and `tick` (§4.10.2). */
  function forgetOne(a: number, k: number, tick: number): void {
    const base = a * S;
    const start = Math.imul((k ^ Math.imul(tick + 1, 0x85ebca6b)) >>> 0, 0x27d4eb2f) >>> (32 - LOG2_S);
    let victim = -1;
    let oldest = 0;
    for (let n = 0, seen = 0; n < S && (seen < K.sampled || victim < 0); n++) {
      const i = (start + n) & MASK;
      const kk = key[base + i];
      if (kk === 0) continue;
      seen++;
      let kept = false;
      for (let q = 0; q < keepN; q++) if (keep[q] === kk) kept = true;
      if (kept) continue;
      if (victim < 0 || used[base + i] < oldest) {
        victim = i;
        oldest = used[base + i];
      }
    }
    if (victim < 0) throw new Error('memory: nothing to forget.');
    // Backward-shift deletion keeps every probe sequence intact.
    let i = victim;
    for (;;) {
      clearSlot(base + i);
      let j = i;
      for (;;) {
        j = (j + 1) & MASK;
        const kk = key[base + j];
        if (kk === 0) {
          count[a]--;
          return;
        }
        const h = probeStart(kk);
        const between = i <= j ? i < h && h <= j : i < h || h <= j;
        if (between) continue;
        moveSlot(base + j, base + i);
        i = j;
        break;
      }
    }
  }

  /** Add key `k` (not held) to agent `a`'s table at its prior; there must be room. */
  function add(a: number, k: number, tick: number): number {
    if (count[a] >= K.most) throw new Error('memory: add without room.');
    const base = a * S;
    let i = probeStart(k);
    while (key[base + i] !== 0) i = (i + 1) & MASK;
    const s = base + i;
    key[s] = k;
    const p = priorOf(k);
    vNow[s] = p;
    vLater[s] = p;
    vPain[s] = 0;
    used[s] = tick;
    count[a]++;
    return s;
  }

  /** A slot's variances with what disuse gave back, written in, and its clock set to `tick`. */
  function touch(s: number, k: number, tick: number): void {
    const p = priorOf(k);
    const back = regrowth * (tick - used[s]);
    const a = vNow[s] + back;
    const b = vLater[s] + back;
    vNow[s] = a < p ? a : p;
    vLater[s] = b < p ? b : p;
    used[s] = tick;
  }

  function effective(v: number, s: number, k: number, tick: number): number {
    const p = priorOf(k);
    const x = v + regrowth * (tick - used[s]);
    return x < p ? x : p;
  }

  // ---- learning now (§4.10.2)

  const slots = new Int32Array(24);
  const gains = new Float64Array(24);
  const pred = new Float64Array(CHANNELS);
  const error = new Float64Array(CHANNELS);
  const residual = new Float64Array(CHANNELS);
  let residualSize = 0;

  function findAll(a: number, keys: Uint32Array, n: number): number {
    let missing = 0;
    for (let i = 0; i < n; i++) {
      slots[i] = find(a, keys[i]);
      if (slots[i] < 0) missing++;
    }
    return missing;
  }

  function update(
    a: number,
    keys: Uint32Array,
    n0: number,
    o: ArrayLike<number>,
    tick: number,
    placeKey = 0,
    start: ArrayLike<number> | null = null,
    startOff = 0,
  ): number {
    let n = n0;
    findAll(a, keys, n);
    // The place's key joins only if it is held, or the error is salient, or the place is remembered.
    if (placeKey !== 0) {
      const ps = find(a, placeKey);
      let include = ps >= 0;
      if (!include) {
        for (let ch = 0; ch < CHANNELS; ch++) pred[ch] = 0;
        for (let i = 0; i < n; i++) {
          const s = slots[i];
          if (s < 0) continue;
          for (let ch = 0; ch < CHANNELS; ch++) pred[ch] += now[s * CHANNELS + ch];
        }
        let size = 0;
        for (let ch = 0; ch < CHANNELS; ch++) {
          let p = pred[ch];
          if (start) {
            const lo = -start[startOff + ch];
            const hi = 1 - start[startOff + ch];
            if (p < lo) p = lo;
            else if (p > hi) p = hi;
          }
          size += Math.abs(o[ch] - p);
        }
        include = size > K.salient || placeKnown(a, cuePayload(cueOfKey(placeKey)));
      }
      if (include) {
        keys[n] = placeKey;
        slots[n] = ps;
        n++;
      }
    }
    // Room first: forgetting moves entries, so find again after it.
    let missing = 0;
    for (let i = 0; i < n; i++) if (slots[i] < 0) missing++;
    if (missing > 0 && count[a] + missing > K.most) {
      keepN = 0;
      for (let i = 0; i < n; i++) keep[keepN++] = keys[i];
      while (count[a] + missing > K.most) forgetOne(a, keys[0], tick);
      keepN = 0;
      findAll(a, keys, n);
    }
    for (let i = 0; i < n; i++) if (slots[i] < 0) slots[i] = add(a, keys[i], tick);

    // Prediction, error and gains.
    let sumV = 0;
    for (let ch = 0; ch < CHANNELS; ch++) pred[ch] = 0;
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      touch(s, keys[i], tick);
      gains[i] = vNow[s];
      sumV += vNow[s];
      for (let ch = 0; ch < CHANNELS; ch++) pred[ch] += now[s * CHANNELS + ch];
    }
    // A drive cannot go below 0 or above 1, so a body can only show the part of a predicted change that
    // fits between its start and those limits: the error is against that part (§4.10.2).
    let size = 0;
    for (let ch = 0; ch < CHANNELS; ch++) {
      let p = pred[ch];
      if (start) {
        const lo = -start[startOff + ch];
        const hi = 1 - start[startOff + ch];
        if (p < lo) p = lo;
        else if (p > hi) p = hi;
      }
      error[ch] = o[ch] - p;
      size += Math.abs(error[ch]);
    }
    const denom = sumV + K.outcomeNoise;
    // What no key absorbed (§4.11.4): each key moves by g δ, so δ (1 − Σg) = δ R ÷ (Σv + R) is left.
    const left = K.outcomeNoise / denom;
    residualSize = 0;
    for (let ch = 0; ch < CHANNELS; ch++) {
      residual[ch] = error[ch] * left;
      residualSize += Math.abs(residual[ch]);
    }
    const painError2 = error[Channel.PAIN] * error[Channel.PAIN];
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const g = gains[i] / denom;
      const o8 = s * CHANNELS;
      for (let ch = 0; ch < CHANNELS; ch++) now[o8 + ch] += g * error[ch];
      vNow[s] = gains[i] * (1 - g);
      vPain[s] += g * (painError2 - vPain[s]);
    }
    return size;
  }

  // ---- delays (§4.10.3)

  function credit(a: number, err: ArrayLike<number>, tick: number, gutErr: number): void {
    const general = traceTicks > 0;
    // The second kernel adds only where it reaches further than the first (§4.13.2).
    const gut = gutErr !== 0 && gutTicks > traceTicks;
    if (!general && !gut) return;
    const base = a * E;
    for (let r = 0; r < E; r++) {
      const j = base + r;
      const k = eKey[j];
      if (k === 0) continue;
      const age = tick - eEnd[j];
      let e = 0;
      if (general) {
        const x = age / traceTicks;
        if (x <= K.traceHalfLives) {
          e = exp(-x * LN2);
          const o = j * CHANNELS;
          for (let ch = 0; ch < CHANNELS; ch++) eCredit[o + ch] += e * err[ch];
        }
      }
      if (gut && actOfKey(k) === Act.CONSUME) {
        const y = age / gutTicks;
        if (y <= K.traceHalfLives) {
          const eg = exp(-y * LN2);
          if (eg > e) eGut[j] += (eg - e) * gutErr;
        }
      }
    }
  }

  function closeInto(a: number, k: number, c: Float32Array, co: number, tick: number, mustExist: boolean, extraPain = 0): void {
    let s = find(a, k);
    if (s < 0) {
      if (mustExist) return;
      if (count[a] + 1 > K.most) {
        keep[0] = k;
        keepN = 1;
        forgetOne(a, k, tick);
        keepN = 0;
      }
      s = add(a, k, tick);
    }
    touch(s, k, tick);
    const v = vLater[s];
    const g = v / (v + K.outcomeNoise);
    const o8 = s * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) later[o8 + ch] += g * (c[co + ch] + (ch === Channel.PAIN ? extraPain : 0) - later[o8 + ch]);
    vLater[s] = v * (1 - g);
  }

  /** A record leaves the buffer: its keys' delayed predictions move toward the credit it gathered. */
  function close(a: number, j: number, tick: number): void {
    const co = j * CHANNELS;
    // What was swallowed takes the second kernel's credit too; where, and the nodes, do not (§4.13.2).
    closeInto(a, eKey[j], eCredit, co, tick, false, eGut[j]);
    const pk = ePlace[j];
    if (pk !== 0) {
      let size = 0;
      for (let ch = 0; ch < CHANNELS; ch++) size += Math.abs(eCredit[co + ch]);
      const createIt = size > K.salient || placeKnown(a, cuePayload(cueOfKey(pk)));
      closeInto(a, pk, eCredit, co, tick, !createIt);
    }
    // The nodes active when its act ended learn what followed, if they are still held (§4.11.3).
    for (let q = 0; q < K.activeNodes; q++) {
      const nk = eNodes[j * K.activeNodes + q];
      if (nk !== 0) closeInto(a, nk, eCredit, co, tick, true);
    }
  }

  function push(a: number, k: number, placeKey: number, tick: number, node0 = 0, node1 = 0): void {
    const j = a * E + eNext[a];
    if (eKey[j] !== 0) close(a, j, tick);
    eKey[j] = k;
    ePlace[j] = placeKey;
    eEnd[j] = tick;
    eNodes[j * K.activeNodes] = node0;
    eNodes[j * K.activeNodes + 1] = node1;
    eGut[j] = 0;
    const o = j * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) eCredit[o + ch] = 0;
    eNext[a] = (eNext[a] + 1) % E;
  }

  // ---- place memory (§4.10.4)

  function placeOfCell(cell: number): number {
    const x = ((cell % W) + 0.5) * cs;
    const y = (Math.floor(cell / W) + 0.5) * cs;
    return Math.floor(y / PERCEPTION.placeM) * placeColumns + Math.floor(x / PERCEPTION.placeM);
  }

  function findPlace(a: number, place: number): number {
    const base = a * P;
    const id = place + 1;
    for (let r = 0; r < P; r++) if (pId[base + r] === id) return base + r;
    return -1;
  }

  function placeKnown(a: number, place: number): boolean {
    return findPlace(a, place) >= 0;
  }

  function clearThing(j: number): void {
    pKey[j] = 0;
    pCell[j] = 0;
    pChannel[j] = 0;
    pRelief[j] = 0;
  }

  function remember(a: number, k: number, cell: number, channel: number, relief: number, tick: number): void {
    const place = placeOfCell(cell);
    let r = findPlace(a, place);
    if (r < 0) {
      const base = a * P;
      for (let q = 0; q < P; q++) {
        const j = base + q;
        if (pId[j] === 0) {
          r = j;
          break;
        }
        if (r < 0 || pSeen[j] < pSeen[r]) r = j;
      }
      pId[r] = place + 1;
      for (let t = 0; t < T; t++) clearThing(r * T + t);
    }
    pSeen[r] = tick;
    const o = r * T;
    let at = -1;
    for (let t = 0; t < T; t++) {
      if (pKey[o + t] === k && pCell[o + t] === cell) at = t;
      else if (at < 0 && pKey[o + t] === 0) at = t;
    }
    if (at < 0) {
      // A fifth thing replaces the oldest: the rest move down.
      for (let t = 0; t + 1 < T; t++) {
        pKey[o + t] = pKey[o + t + 1];
        pCell[o + t] = pCell[o + t + 1];
        pChannel[o + t] = pChannel[o + t + 1];
        pRelief[o + t] = pRelief[o + t + 1];
      }
      at = T - 1;
    }
    pKey[o + at] = k;
    pCell[o + at] = cell;
    pChannel[o + at] = channel;
    pRelief[o + at] = relief;
  }

  function forget(a: number, k: number, cell: number): void {
    const r = findPlace(a, placeOfCell(cell));
    if (r < 0) return;
    const o = r * T;
    let left = 0;
    for (let t = 0; t < T; t++) {
      if (pKey[o + t] === k && pCell[o + t] === cell) clearThing(o + t);
      if (pKey[o + t] !== 0) left++;
    }
    if (left === 0) {
      pId[r] = 0;
      pSeen[r] = 0;
    }
  }

  // ---- hidden-cause nodes (§4.11)

  function nodeCue(j: number): number {
    return cue(CueKind.NODE, nId[j]);
  }

  function matches(j: number, place: number, light: number, day: number): number {
    return (nPlace[j] === place ? 1 : 0) + (nLight[j] === light ? 1 : 0) + (nDay[j] === day ? 1 : 0);
  }

  /** Strength, halved for every compressed year since the node was last given a residual (§4.11.2). */
  function effectiveStrength(j: number, tick: number): number {
    const age = tick - nLast[j];
    return age > 0 ? nStrength[j] * exp((-age / nodeHalfLifeTicks) * LN2) : nStrength[j];
  }

  const fitting = new Int32Array(N);

  /**
   * Agent `a`'s nodes active at (place, light, day length): two or more of the three match. At most two,
   * the strongest when more are active (ties to the lower slot); global indices into `out`.
   */
  function activeAt(a: number, place: number, light: number, day: number, tick: number, out: Int32Array): number {
    const base = a * N;
    let n = 0;
    for (let q = 0; q < N; q++) {
      const j = base + q;
      if (nId[j] !== 0 && matches(j, place, light, day) >= 2) fitting[n++] = j;
    }
    if (n <= K.activeNodes) {
      for (let i = 0; i < n; i++) out[i] = fitting[i];
      return n;
    }
    let b0 = -1;
    let b1 = -1;
    let s0 = -Infinity;
    let s1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = fitting[i];
      const st = effectiveStrength(j, tick);
      if (st > s0) {
        b1 = b0;
        s1 = s0;
        b0 = j;
        s0 = st;
      } else if (st > s1) {
        b1 = j;
        s1 = st;
      }
    }
    out[0] = b0;
    out[1] = b1;
    return 2;
  }

  function hasNodes(a: number): boolean {
    const base = a * N;
    for (let q = 0; q < N; q++) if (nId[base + q] !== 0) return true;
    return false;
  }

  /** Act kinds of the act that just ended (`act`) and the records before it in the buffer (§4.11.1). */
  function recentMask(a: number, act: number): number {
    let mask = 1 << act;
    for (let back = 1; back < K.recentActs; back++) {
      const j = a * E + ((eNext[a] + E - back) % E);
      if (eKey[j] !== 0) mask |= 1 << actOfKey(eKey[j]);
    }
    return mask;
  }

  // The nodes that took part in the update under way (§4.11.3, §4.11.5).
  const took = new Int32Array(K.activeNodes);
  let tookN = 0;
  const nodeKeys = new Uint32Array(2);
  const nodeSlots = new Int32Array(2);

  /** Node `j`'s (node, act) and (node, 0) keys learn the residual, entering at prior if missing (§4.11.5). */
  function assign(a: number, j: number, act: number, tick: number): void {
    const nc = nodeCue(j);
    nodeKeys[0] = keyOf(nc, act);
    nodeKeys[1] = keyOf(nc, 0);
    let missing = 0;
    for (let i = 0; i < 2; i++) {
      nodeSlots[i] = find(a, nodeKeys[i]);
      if (nodeSlots[i] < 0) missing++;
    }
    if (missing > 0 && count[a] + missing > K.most) {
      keepN = 0;
      keep[keepN++] = nodeKeys[0];
      keep[keepN++] = nodeKeys[1];
      while (count[a] + missing > K.most) forgetOne(a, nodeKeys[0], tick);
      keepN = 0;
      for (let i = 0; i < 2; i++) nodeSlots[i] = find(a, nodeKeys[i]);
    }
    for (let i = 0; i < 2; i++) if (nodeSlots[i] < 0) nodeSlots[i] = add(a, nodeKeys[i], tick);
    let sumV = 0;
    for (let ch = 0; ch < CHANNELS; ch++) pred[ch] = 0;
    for (let i = 0; i < 2; i++) {
      const s = nodeSlots[i];
      touch(s, nodeKeys[i], tick);
      sumV += vNow[s];
      for (let ch = 0; ch < CHANNELS; ch++) pred[ch] += now[s * CHANNELS + ch];
    }
    const denom = sumV + K.outcomeNoise;
    const painError = residual[Channel.PAIN] - pred[Channel.PAIN];
    for (let i = 0; i < 2; i++) {
      const s = nodeSlots[i];
      const v = vNow[s];
      const g = v / denom;
      const o8 = s * CHANNELS;
      for (let ch = 0; ch < CHANNELS; ch++) now[o8 + ch] += g * (residual[ch] - pred[ch]);
      vNow[s] = v * (1 - g);
      vPain[s] += g * (painError * painError - vPain[s]);
    }
  }

  /**
   * §4.11.5 on the residual of the last update, for agent `a` (its dials read) after act `act` at (place,
   * light, day length); `took[0..tookN)` are the nodes that took part. Returns the node's slot or -1.
   */
  function infer(a: number, act: number, place: number, light: number, day: number, tick: number): number {
    if (!(residualSize > K.salient)) return -1;
    tally[ActTally.RESIDUALS_SALIENT] += 1;
    const b = dials.hiddenCauseBias;
    if (!(b > 0)) return -1;
    const p = b * residualSize;
    if (p < 1 && !(nextFloat(rng, a * STREAM_WORDS) < p)) return -1;
    const recent = recentMask(a, act);
    const base = a * N;
    // The best fit: most of place, light and day length matching (two at least), then most act kinds in
    // common, then the strongest, then the lowest slot.
    let j = -1;
    let bestM = 0;
    let bestO = 0;
    let bestS = 0;
    for (let q = 0; q < N; q++) {
      const i = base + q;
      if (nId[i] === 0) continue;
      const m = matches(i, place, light, day);
      if (m < 2) continue;
      const o = bitCount16(nActs[i] & recent);
      const st = effectiveStrength(i, tick);
      if (j < 0 || m > bestM || (m === bestM && (o > bestO || (o === bestO && st > bestS)))) {
        j = i;
        bestM = m;
        bestO = o;
        bestS = st;
      }
    }
    if (j >= 0) {
      nStrength[j] += residualSize;
      nLast[j] = tick;
      tally[ActTally.NODES_STRENGTHENED] += 1;
      // A node that took part has had its share of the error by its gain already.
      for (let i = 0; i < tookN; i++) if (took[i] === j) return j - base;
    } else {
      // Posited: in an empty slot, or in place of the weakest.
      let weakest = -1;
      let ws = Infinity;
      for (let q = 0; q < N && j < 0; q++) {
        const i = base + q;
        if (nId[i] === 0) j = i;
        else {
          const st = effectiveStrength(i, tick);
          if (st < ws) {
            ws = st;
            weakest = i;
          }
        }
      }
      if (j < 0) j = weakest;
      nSerial[a] = nSerial[a] >= SERIAL_MAX ? 1 : nSerial[a] + 1;
      nId[j] = nSerial[a];
      nPlace[j] = place;
      nLight[j] = light;
      nDay[j] = day;
      nActs[j] = recent;
      nStrength[j] = residualSize;
      nLast[j] = tick;
      tally[ActTally.NODES_POSITED] += 1;
    }
    assign(a, j, act, tick);
    return j - base;
  }

  // ---- what a look gives as context (§4.7.3)

  const salient = new Uint32Array(K.salientPercepts);
  let salientN = 0;

  function salientOf(look: Percepts): void {
    salientN = 0;
    let d0 = Infinity;
    let d1 = Infinity;
    let c0 = 0;
    let c1 = 0;
    for (let i = 0; i < look.n; i++) {
      const src = look.source[i];
      const c = look.cue[i];
      let moving = src === PerceptSource.ANIMAL || src === PerceptSource.AGENT;
      if (!moving && cueKind(c) === CueKind.CLASS) {
        const kind = classKind(cuePayload(c));
        moving = kind === ClassKind.FIRE || kind === ClassKind.FIGURE;
      }
      if (!moving || c === c0 || c === c1) continue;
      const d = look.dist[i];
      if (d < d0) {
        d1 = d0;
        c1 = c0;
        d0 = d;
        c0 = c;
      } else if (d < d1) {
        d1 = d;
        c1 = c;
      }
    }
    if (c0 !== 0) salient[salientN++] = c0;
    if (c1 !== 0) salient[salientN++] = c1;
  }

  // ---- learning when an act ends (§4.10.2)

  const keys = new Uint32Array(16);
  const outcome = new Float64Array(CHANNELS);

  function learn(slot: number, look: Percepts, drives: Float64Array, offset: number, gutPain = 0): void {
    const act = actKind[slot];
    // The gut's part of pain as the act that ended began, and now, as the next begins (§4.13.1).
    // Both as stored (32-bit), so an unchanged gut shows a change of exactly 0.
    const gutBefore = gutAt[slot];
    const gutNow = Math.fround(gutPain);
    gutAt[slot] = gutNow;
    if (act === Act.NONE) return;
    const tick = state.tick;
    readDials(slot);
    const d0 = slot * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) outcome[ch] = drives[offset + ch] - actDrives[d0 + ch];
    const target = actCue[slot];
    const targetKey = keyOf(target, act);
    let n = 0;
    keys[n++] = targetKey;
    keys[n++] = keyOf(look.light, act);
    keys[n++] = keyOf(look.light, 0);
    keys[n++] = keyOf(look.dayLength, act);
    keys[n++] = keyOf(look.dayLength, 0);
    keys[n++] = keyOf(look.warmth, act);
    keys[n++] = keyOf(look.warmth, 0);
    salientOf(look);
    for (let i = 0; i < salientN; i++) {
      const s = salient[i];
      if (s !== target) keys[n++] = keyOf(s, act);
      keys[n++] = keyOf(s, 0);
    }
    // The nodes active here take part as things (§4.11.3).
    const place = cuePayload(look.place);
    const lightNow = cuePayload(look.light);
    const dayNow = cuePayload(look.dayLength);
    tookN = activeAt(slot, place, lightNow, dayNow, tick, took);
    for (let i = 0; i < tookN; i++) {
      const nc = nodeCue(took[i]);
      keys[n++] = keyOf(nc, act);
      keys[n++] = keyOf(nc, 0);
    }
    const node0 = tookN > 0 ? keyOf(nodeCue(took[0]), act) : 0;
    const node1 = tookN > 1 ? keyOf(nodeCue(took[1]), act) : 0;
    // A key named twice would be counted twice.
    let m = 0;
    for (let i = 0; i < n; i++) {
      let dup = false;
      for (let j = 0; j < m; j++) if (keys[j] === keys[i]) dup = true;
      if (!dup) keys[m++] = keys[i];
    }
    const placeKey = keyOf(look.place, 0);
    const size = update(slot, keys, m, outcome, tick, placeKey, actDrives, d0);
    if (size > K.salient) {
      // The gut's part of the pain error: what the gut's own change could account for (§4.13.2).
      const dp = error[Channel.PAIN];
      const du = gutNow - gutBefore;
      const gutErr = dp > 0 && du > 0 ? (dp < du ? dp : du) : dp < 0 && du < 0 ? (dp > du ? dp : du) : 0;
      credit(slot, error, tick, gutErr);
    }
    // What nothing known absorbed may be set aside for a hidden cause (§4.11.5).
    infer(slot, act, place, lightNow, dayNow, tick);
    push(slot, targetKey, placeKey, tick, node0, node1);

    // Things worth acting on, where they were.
    if (actSource[slot] === PerceptSource.CELL) {
      const cell = actRef[slot];
      const how = actEnd[slot];
      if (how === ActEnd.FAILED) forget(slot, targetKey, cell);
      else if (how === ActEnd.DONE && worthOf(actDrives, d0, outcome, 0) > K.rememberAbove) {
        // Kept: the channel it relieved most, by its worth then, and by how much.
        let ch = 0;
        let most = -Infinity;
        for (let c = 0; c < CHANNELS; c++) {
          const was = actDrives[d0 + c];
          let next = was + outcome[c];
          if (next < 0) next = 0;
          const w = was * was - next * next;
          if (w > most) {
            most = w;
            ch = c;
          }
        }
        if (outcome[ch] < 0) remember(slot, targetKey, cell, ch, -outcome[ch], tick);
      }
    }
  }

  // ---- go there (§4.10.4)

  const best = new Int32Array(K.goThere);
  const bestScore = new Float64Array(K.goThere);

  function recall(slot: number, look: Percepts, cands: Candidates, drives: Float64Array, offset: number): void {
    const base = slot * P;
    const here = cuePayload(look.place) + 1;
    let found = 0;
    for (let r = 0; r < P; r++) {
      const id = pId[base + r];
      if (id === 0 || id === here) continue;
      for (let t = 0; t < T; t++) {
        const j = (base + r) * T + t;
        if (pKey[j] === 0) continue;
        // What it would be worth now: the relief it gave, to the drive as it is now.
        const d = drives[offset + pChannel[j]];
        let next = d - pRelief[j];
        if (next < 0) next = 0;
        const score = d * d - next * next;
        if (!(score > 0)) continue;
        // Into the best few; ties keep the earlier thing.
        let at = found;
        while (at > 0 && bestScore[at - 1] < score) at--;
        if (at >= K.goThere) continue;
        for (let q = Math.min(found, K.goThere - 1); q > at; q--) {
          best[q] = best[q - 1];
          bestScore[q] = bestScore[q - 1];
        }
        best[at] = j;
        bestScore[at] = score;
        if (found < K.goThere) found++;
      }
    }
    const x = ax[slot];
    const y = ay[slot];
    for (let q = 0; q < found; q++) {
      const j = best[q];
      const r = Math.floor(j / T);
      const there = cue(CueKind.PLACE, pId[r] - 1);
      const k = pKey[j];
      const c = cueOfKey(k);
      const act = actOfKey(k);
      const cell = pCell[j];
      let seen = false;
      for (let i = 0; i < cands.n; i++) {
        if (cands.source[i] === PerceptSource.CELL && cands.ref[i] === cell && cands.cue[i] === c && cands.act[i] === act) seen = true;
      }
      if (seen) continue;
      const cx = ((cell % W) + 0.5) * cs;
      const cy = (Math.floor(cell / W) + 0.5) * cs;
      const dx = cx - x;
      const dy = cy - y;
      cands.add(act, c, PerceptSource.CELL, cell, cx, cy, Math.sqrt(dx * dx + dy * dy), there);
    }
  }

  // ---- the predictor (§4.10.5)

  let who = -1;
  let tickNow = 0;
  let herePlace = 0;
  const pav = new Float64Array(CHANNELS);
  const herePav = new Float64Array(CHANNELS);
  const trip = new Float64Array(CHANNELS);
  const ctxAct = new Float64Array(ACT_KINDS * CHANNELS);
  const salAct = new Float64Array(K.salientPercepts * ACT_KINDS * CHANNELS);
  let ctxDone = 0;
  let light = 0;
  let dayLength = 0;
  let warmth = 0;
  // Nodes active here and, for a remembered thing elsewhere, there (§4.11.3).
  const here = new Int32Array(K.activeNodes);
  const hereCue = new Uint32Array(K.activeNodes);
  let hereN = 0;
  let anyNodes = false;
  const thereIdx = new Int32Array(K.activeNodes);

  function addNow(a: number, k: number, out: Float64Array, o: number): boolean {
    const s = find(a, k);
    if (s < 0) return false;
    const f = s * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) out[o + ch] += now[f + ch];
    return true;
  }

  function subNow(a: number, k: number, out: Float64Array): void {
    const s = find(a, k);
    if (s < 0) return;
    const f = s * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) out[ch] -= now[f + ch];
  }

  function begin(slot: number, look: Percepts): void {
    who = slot;
    tickNow = state.tick;
    readDials(slot);
    salientOf(look);
    light = look.light;
    dayLength = look.dayLength;
    warmth = look.warmth;
    herePlace = look.place;
    pav.fill(0);
    herePav.fill(0);
    addNow(slot, keyOf(look.place, 0), herePav, 0);
    for (let ch = 0; ch < CHANNELS; ch++) pav[ch] = herePav[ch];
    addNow(slot, keyOf(light, 0), pav, 0);
    addNow(slot, keyOf(dayLength, 0), pav, 0);
    addNow(slot, keyOf(warmth, 0), pav, 0);
    for (let i = 0; i < salientN; i++) addNow(slot, keyOf(salient[i], 0), pav, 0);
    anyNodes = hasNodes(slot);
    hereN = anyNodes ? activeAt(slot, cuePayload(look.place), cuePayload(light), cuePayload(dayLength), tickNow, here) : 0;
    for (let i = 0; i < hereN; i++) {
      hereCue[i] = nodeCue(here[i]);
      addNow(slot, keyOf(hereCue[i], 0), pav, 0);
    }
    trip.fill(0);
    const s = find(slot, keyOf(SELF_CUE, Act.EXPLORE));
    if (s >= 0) {
      for (let ch = 0; ch < CHANNELS; ch++) {
        const c = now[s * CHANNELS + ch];
        trip[ch] = c > 0 ? c * tripPerM : 0;
      }
    }
    ctxDone = 0;
  }

  function contextFor(act: number): void {
    const o = act * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) ctxAct[o + ch] = 0;
    addNow(who, keyOf(light, act), ctxAct, o);
    addNow(who, keyOf(dayLength, act), ctxAct, o);
    addNow(who, keyOf(warmth, act), ctxAct, o);
    for (let i = 0; i < hereN; i++) addNow(who, keyOf(hereCue[i], act), ctxAct, o);
    for (let i = 0; i < salientN; i++) {
      const so = (i * ACT_KINDS + act) * CHANNELS;
      for (let ch = 0; ch < CHANNELS; ch++) salAct[so + ch] = 0;
      addNow(who, keyOf(salient[i], act), salAct, so);
      for (let ch = 0; ch < CHANNELS; ch++) ctxAct[o + ch] += salAct[so + ch];
    }
    ctxDone |= 1 << act;
  }

  function predict(c: number, act: number, distM: number, out: Float64Array, there = 0): void {
    if ((ctxDone & (1 << act)) === 0) contextFor(act);
    const o = act * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) out[ch] = pav[ch] + ctxAct[o + ch] + trip[ch] * distM;
    for (let i = 0; i < salientN; i++) {
      if (salient[i] !== c) continue;
      const so = (i * ACT_KINDS + act) * CHANNELS;
      for (let ch = 0; ch < CHANNELS; ch++) out[ch] -= salAct[so + ch];
    }
    if (there !== 0 && there !== herePlace) {
      const s = find(who, keyOf(there, 0));
      for (let ch = 0; ch < CHANNELS; ch++) out[ch] += (s >= 0 ? now[s * CHANNELS + ch] : 0) - herePav[ch];
      // The nodes active there replace those active here (§4.11.3).
      if (anyNodes) {
        const thereN = activeAt(who, cuePayload(there), cuePayload(light), cuePayload(dayLength), tickNow, thereIdx);
        for (let i = 0; i < thereN; i++) {
          let also = false;
          for (let q = 0; q < hereN; q++) if (here[q] === thereIdx[i]) also = true;
          if (also) continue;
          const nc = nodeCue(thereIdx[i]);
          addNow(who, keyOf(nc, 0), out, 0);
          addNow(who, keyOf(nc, act), out, 0);
        }
        for (let q = 0; q < hereN; q++) {
          let also = false;
          for (let i = 0; i < thereN; i++) if (here[q] === thereIdx[i]) also = true;
          if (also) continue;
          subNow(who, keyOf(hereCue[q], 0), out);
          subNow(who, keyOf(hereCue[q], act), out);
        }
      }
    }
    const k = keyOf(c, act);
    const s = find(who, k);
    if (s < 0) {
      out[CHANNELS] = priorOf(k);
      out[CHANNELS + 1] = 0;
      return;
    }
    const f = s * CHANNELS;
    for (let ch = 0; ch < CHANNELS; ch++) out[ch] += now[f + ch] + later[f + ch];
    out[CHANNELS] = effective(vNow[s], s, k, tickNow);
    out[CHANNELS + 1] = vPain[s];
  }

  function entry(slot: number, k: number, out: Float64Array): boolean {
    const s = find(slot, k);
    if (s < 0) return false;
    for (let ch = 0; ch < CHANNELS; ch++) {
      out[ch] = now[s * CHANNELS + ch];
      out[CHANNELS + ch] = later[s * CHANNELS + ch];
    }
    out[2 * CHANNELS] = vNow[s];
    out[2 * CHANNELS + 1] = vLater[s];
    out[2 * CHANNELS + 2] = vPain[s];
    out[2 * CHANNELS + 3] = used[s];
    return true;
  }

  return {
    refresh,
    learn,
    recall,
    begin,
    predict,
    dials,
    readDials,
    // The doors read the agent's dials first; learn() and begin() do so themselves.
    update: (slot, ks, n, o, tick, placeKey = 0, start, startOff = 0) => {
      readDials(slot);
      // Callers pass their own keys; update may append the place key, so copy into room for it.
      for (let i = 0; i < n; i++) keys[i] = ks[i];
      return update(slot, keys, n, o, tick, placeKey, start ?? null, startOff);
    },
    credit: (slot, err, tick, gutErr = 0) => {
      readDials(slot);
      credit(slot, err, tick, gutErr);
    },
    push: (slot, k, placeKey, tick, node0 = 0, node1 = 0) => {
      readDials(slot);
      push(slot, k, placeKey, tick, node0, node1);
    },
    error,
    residual,
    infer: (slot, look, act, tick) => {
      readDials(slot);
      const place = cuePayload(look.place);
      const l = cuePayload(look.light);
      const d = cuePayload(look.dayLength);
      tookN = activeAt(slot, place, l, d, tick, took);
      return infer(slot, act, place, l, d, tick);
    },
    activeNodes: (slot, look, out) => {
      const n = activeAt(slot, cuePayload(look.place), cuePayload(look.light), cuePayload(look.dayLength), state.tick, took);
      for (let i = 0; i < n; i++) out[i] = nodeCue(took[i]);
      return n;
    },
    nodeCount: (slot) => {
      let n = 0;
      for (let q = 0; q < N; q++) if (nId[slot * N + q] !== 0) n++;
      return n;
    },
    node: (slot, q, out) => {
      const j = slot * N + q;
      if (nId[j] === 0) return false;
      out[0] = nId[j];
      out[1] = nPlace[j];
      out[2] = nLight[j];
      out[3] = nDay[j];
      out[4] = nActs[j];
      out[5] = nStrength[j];
      out[6] = nLast[j];
      return true;
    },
    entry,
    count: (slot) => count[slot],
    remember,
    forget,
    placeOfCell,
  };
}
