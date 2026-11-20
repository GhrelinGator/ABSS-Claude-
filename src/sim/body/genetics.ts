// Genetics (docs/DESIGN.md §3.7, §3.14): two alleles per heritable dial, their
// mean plus developmental noise expressed in the body, gametes that take one of
// each parent's two copies and sometimes mutate; 64 loci at which two broken
// copies kill, before or after birth; and the genealogy, which bodies never read.
//
// Doors: `formGenome` gives a founder its genome, right after `formBody`.
// `conceiveGenome` and `bearGenome` are the two steps body.reproduction takes at
// conception and at birth. The system body.genetics runs last: it stops the run
// if a body has no genome, and kills a body that has reached the age of its
// recessive disorder.

import { ticksPerYear } from '../core/clock.ts';
import { exp, log } from '../core/dmath.ts';
import { defineDial, defineSystem } from '../core/registry.ts';
import type { DialDef, SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextFloat, nextInt, nextNormal, nextU32 } from '../core/rng.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sink, Source } from '../core/codec.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { BODY_COLUMNS, DeathCause, Sex, deathDoor } from './metabolism.ts';
import { CURIOSITY, EXPLORATION_TEMPERATURE, HIDDEN_CAUSE_BIAS, LEARNING_RATE, RISK_TOLERANCE, TRACE_HALF_LIFE } from '../mind/dials.ts';

// ALIBI: bodies of one species grow to different sizes, and a parent's size passes in part to its
// young; a larger body stores and carries more but costs more to keep and to grow, whether or not any
// group ever forms.
export const FRAME_SCALE: DialDef = defineDial({ name: 'frameScale', min: 0.5, max: 1.5, neutral: 1 });

// ALIBI: bodies of the same size, sex and age burn different amounts of energy at rest; a lower rate
// saves food and makes less heat, which costs shivering in the cold, so the best rate depends on food
// and climate, whether or not any group ever forms.
export const BASAL_SCALE: DialDef = defineDial({ name: 'basalScale', min: 0.7, max: 1.3, neutral: 1 });

/** How a dial is inherited: founders' alleles, developmental noise, mutation (§3.14). Estimates. */
export interface GeneDial {
  readonly dial: DialDef;
  /** Founders draw each allele uniformly from [foundersFrom, foundersTo]; log-uniformly if `foundersLog` (both ends then above 0). */
  readonly foundersFrom: number;
  readonly foundersTo: number;
  readonly foundersLog?: boolean;
  /** Developmental noise added once, at conception, to the mean of the two alleles (sd). */
  readonly noiseSd: number;
  /** Spread of the normal step by which a mutated allele moves (sd). */
  readonly mutationSd: number;
}

/**
 * The dials on the genome, in order: the body's two (D-047), then the mind's five (3.4, DESIGN.md
 * §4.10.6), then `hiddenCauseBias` (3.5, §4.11.6, in the design's dial list since D-004 and D-005); each
 * joins with the mechanism that reads it. A drive, or a bias the design does not already list, still
 * waits for approval (CLAUDE.md). Founders' ranges for the mind's survival-critical dials are viability
 * choices (§0.2), logged; `hiddenCauseBias` starts centred on its neutral value instead (D-005).
 */
export const GENE_DIALS: readonly GeneDial[] = Object.freeze([
  { dial: FRAME_SCALE, foundersFrom: 0.75, foundersTo: 1.25, noiseSd: 0.04, mutationSd: 0.05 },
  { dial: BASAL_SCALE, foundersFrom: 0.85, foundersTo: 1.15, noiseSd: 0.04, mutationSd: 0.03 },
  { dial: LEARNING_RATE, foundersFrom: 0.5, foundersTo: 1.5, noiseSd: 0.05, mutationSd: 0.1 },
  { dial: TRACE_HALF_LIFE, foundersFrom: 0.25, foundersTo: 4, foundersLog: true, noiseSd: 0.05, mutationSd: 0.25 },
  { dial: CURIOSITY, foundersFrom: 0, foundersTo: 0.6, noiseSd: 0.03, mutationSd: 0.05 },
  { dial: EXPLORATION_TEMPERATURE, foundersFrom: 0.003, foundersTo: 0.03, foundersLog: true, noiseSd: 0.001, mutationSd: 0.002 },
  { dial: RISK_TOLERANCE, foundersFrom: -0.5, foundersTo: 0.5, noiseSd: 0.05, mutationSd: 0.05 },
  // 3.5 (§4.11.6): a liability centred on its neutral 0, so about half the founders never set anything aside.
  { dial: HIDDEN_CAUSE_BIAS, foundersFrom: -2, foundersTo: 2, noiseSd: 0.1, mutationSd: 0.2 },
]);
const DIALS = GENE_DIALS.length;
/** Index of each dial in GENE_DIALS (and in the `alleles` and `fetusDials` columns). */
export const DialIndex = {
  FRAME_SCALE: 0,
  BASAL_SCALE: 1,
  LEARNING_RATE: 2,
  TRACE_HALF_LIFE: 3,
  CURIOSITY: 4,
  EXPLORATION_TEMPERATURE: 5,
  RISK_TOLERANCE: 6,
  HIDDEN_CAUSE_BIAS: 7,
} as const;

/** Every number of genetics, in one place. Estimates unless a source is named (docs/RESEARCH.md, *Genetics*). */
export const GENETICS = {
  /** Chance that an allele passed on to a gamete mutates [estimate]. */
  mutationChance: 0.01,
  /**
   * Adult frame (§3.12) at frameScale 1, kg, by sex: the frames of §3.8's Hadza-like adults (lean mass 34
   * and 44 kg), less the muscle a forager's working day keeps on them (§3.11: about 2.0 and 2.6 kg).
   */
  baseFrameKg: { [Sex.FEMALE]: 32, [Sex.MALE]: 41.4 } as Readonly<Record<1 | 2, number>>,
  /** Loci per 32-bit word of a haplotype; word 0 holds the loci that act before birth, word 1 those that act after. */
  lociPerWord: 32,
  /**
   * Founders' chance of a broken allele at each locus: the equilibrium of a large random-mating population
   * for recessive lethals, q = √u (1.09 lethal equivalents a gamete; first cousins' children then die
   * after birth about 3.3% more often than unrelated parents', against the ~3.5% of Bittles & Black 2010).
   */
  foundersBrokenShare: 0.017,
  /** A locus that acts before birth ends the pregnancy at this share of gestation, + the next × (j + ½)/32. */
  prenatalFrom: 0.1,
  prenatalSpan: 0.8,
  /** A locus that acts after birth kills at this age, years, × ((j + ½)/32)²: from hours to about 9 years. */
  postnatalYears: 10,
} as const;
const K = GENETICS;
/** New broken alleles a gamete, on average: 64 loci × u, with u = q² (§3.14). */
export const LETHAL_MUTATIONS_PER_GAMETE = 2 * K.lociPerWord * K.foundersBrokenShare * K.foundersBrokenShare;

export const GENETICS_COLUMNS = {
  /** 1 once the body has a genome (formGenome or bearGenome). */
  genomeFormed: { name: 'genomeFormed', dtype: 'u8', category: 'genome' },
  /** Two alleles per dial, in GENE_DIALS order: [dial 0 from the mother, from the father, dial 1 ...]. */
  alleles: { name: 'alleles', dtype: 'f64', category: 'genome', width: 2 * DIALS },
  /** Broken alleles at the 64 loci: the mother's haplotype (words 0 and 1), then the father's (2 and 3). */
  loadLoci: { name: 'loadLoci', dtype: 'u32', category: 'genome', width: 4 },
  /** Expressed values (alleles' mean plus developmental noise), one column per dial. */
  frameScale: { name: 'frameScale', dtype: 'f64', category: 'body' },
  basalScale: { name: 'basalScale', dtype: 'f64', category: 'body' },
  learningRate: { name: 'learningRate', dtype: 'f64', category: 'body' },
  traceHalfLife: { name: 'traceHalfLife', dtype: 'f64', category: 'body' },
  curiosity: { name: 'curiosity', dtype: 'f64', category: 'body' },
  explorationTemperature: { name: 'explorationTemperature', dtype: 'f64', category: 'body' },
  riskTolerance: { name: 'riskTolerance', dtype: 'f64', category: 'body' },
  hiddenCauseBias: { name: 'hiddenCauseBias', dtype: 'f64', category: 'body' },
  /** Age, years, at which a recessive disorder kills the body; 0 if none will. */
  disorderAtYears: { name: 'disorderAtYears', dtype: 'f64', category: 'body' },
  /** The fetus's genome, on its mother's row while she is pregnant: alleles, broken loci, expressed values. */
  fetusAlleles: { name: 'fetusAlleles', dtype: 'f64', category: 'body', width: 2 * DIALS },
  fetusLoadLoci: { name: 'fetusLoadLoci', dtype: 'u32', category: 'body', width: 4 },
  fetusDials: { name: 'fetusDials', dtype: 'f64', category: 'body', width: DIALS },
} as const satisfies Record<string, ColumnSpec>;
const C = GENETICS_COLUMNS;
/** The expressed column of each dial, in GENE_DIALS order. */
const EXPRESSED: readonly string[] = [
  C.frameScale.name,
  C.basalScale.name,
  C.learningRate.name,
  C.traceHalfLife.name,
  C.curiosity.name,
  C.explorationTemperature.name,
  C.riskTolerance.name,
  C.hiddenCauseBias.name,
];
if (EXPRESSED.length !== GENE_DIALS.length || GENE_DIALS.some((g, d) => g.dial.name !== EXPRESSED[d])) {
  throw new Error('genetics: the expressed columns do not match the dials on the genome.');
}

/** The genealogy's record: id, mother's id, father's id, sex, birth tick, loci with two broken copies. */
export const GENEALOGY_FIELDS = 6;
export const GENETICS_PARTS = { genealogy: 'body.genealogy' } as const;

/** The genealogy: one record per body given a genome, never removed. Bodies never read it. */
function genealogyPart(): StatePart & { add(record: readonly number[]): void } {
  let data = new Float64Array(GENEALOGY_FIELDS * 256);
  let used = 0;
  return {
    name: GENETICS_PARTS.genealogy,
    holdsLearned: false,
    readings: () => data.subarray(0, used),
    add(record: readonly number[]) {
      if (used + GENEALOGY_FIELDS > data.length) {
        const grown = new Float64Array(data.length * 2);
        grown.set(data);
        data = grown;
      }
      for (let i = 0; i < GENEALOGY_FIELDS; i++) data[used + i] = record[i];
      used += GENEALOGY_FIELDS;
    },
    write(sink: Sink) {
      sink.array(data.subarray(0, used));
    },
    read(source: Source) {
      const saved = source.array('f64') as Float64Array;
      if (saved.length % GENEALOGY_FIELDS !== 0) throw new Error('body.genealogy: snapshot has the wrong length.');
      let size = GENEALOGY_FIELDS * 256;
      while (size < saved.length) size *= 2;
      data = new Float64Array(size);
      data.set(saved);
      used = saved.length;
    },
  };
}

function genealogyOf(state: SimState): ReturnType<typeof genealogyPart> {
  const part = state.parts.find((p) => p.name === GENETICS_PARTS.genealogy);
  if (!part) throw new Error('The pipeline has no body.genetics.');
  return part as ReturnType<typeof genealogyPart>;
}

/** Number of set bits in a 32-bit word. */
export function bitCount(word: number): number {
  let v = word >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** Index of the lowest set bit of a nonzero 32-bit word. */
function lowestBit(word: number): number {
  const v = word >>> 0;
  return 31 - Math.clz32((v & -v) >>> 0);
}

/** Share of gestation at which a fetus with two broken copies at prenatal locus j (0–31) is lost. */
export function prenatalLossShare(j: number): number {
  return K.prenatalFrom + (K.prenatalSpan * (j + 0.5)) / K.lociPerWord;
}

/** Age, years, at which a body with two broken copies at postnatal locus j (0–31, i.e. locus 32 + j) dies. */
export function postnatalDeathYears(j: number): number {
  const x = (j + 0.5) / K.lociPerWord;
  return K.postnatalYears * x * x;
}

/** Loci at which the body (or fetus) whose broken loci start at `load[o]` carries two broken copies: [prenatal word, postnatal word]. */
function homozygous(load: Uint32Array, o: number): [number, number] {
  return [(load[o] & load[o + 2]) >>> 0, (load[o + 1] & load[o + 3]) >>> 0];
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function requireBody(sim: Sim, slot: number, door: string): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`${door}: slot ${slot} holds no agent.`);
  if (!agents.hasColumn(C.genomeFormed.name)) throw new Error(`${door}: the pipeline has no body.genetics.`);
  if (agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`${door}: agent id ${agents.id.data[slot]} has no body; call formBody first.`);
  }
}

/** Expressed values from alleles: their mean plus developmental noise, clamped to each dial's range. */
function express(sim: Sim, alleles: Float64Array, ao: number, out: Float64Array, oo: number): void {
  const s = sim.state.streams;
  const o = globalStreamOffset(StreamDomain.GENETICS);
  for (let d = 0; d < DIALS; d++) {
    const g = GENE_DIALS[d];
    const mean = (alleles[ao + 2 * d] + alleles[ao + 2 * d + 1]) / 2;
    out[oo + d] = clamp(mean + g.noiseSd * nextNormal(s, o), g.dial.min, g.dial.max);
  }
}

/**
 * Give a founder its genome: alleles drawn uniformly from each dial's founding range, broken alleles at
 * the founders' share (none when config.genetics.recessiveLoad is off), developmental noise. A founder is
 * a survivor, so a draw with two broken copies at a locus that would already have killed it is drawn
 * again. Call it right after formBody. A body formed with its own size keeps it; its genes only pass on.
 */
export function formGenome(sim: Sim, slot: number): void {
  requireBody(sim, slot, 'formGenome');
  const { state, config } = sim;
  const agents = state.agents;
  const formed = agents.column<Uint8Array>(C.genomeFormed.name).data;
  if (formed[slot] === 1) throw new Error(`formGenome: agent id ${agents.id.data[slot]} already has a genome.`);
  const s = state.streams;
  const o = globalStreamOffset(StreamDomain.GENETICS);
  const alleles = agents.column<Float64Array>(C.alleles.name).data;
  const ao = slot * 2 * DIALS;
  for (let d = 0; d < DIALS; d++) {
    const g = GENE_DIALS[d];
    for (let k = 0; k < 2; k++) {
      const u = nextFloat(s, o);
      alleles[ao + 2 * d + k] = g.foundersLog
        ? g.foundersFrom * exp(u * log(g.foundersTo / g.foundersFrom))
        : g.foundersFrom + (g.foundersTo - g.foundersFrom) * u;
    }
  }
  const expressed = new Float64Array(DIALS);
  express(sim, alleles, ao, expressed, 0);
  for (let d = 0; d < DIALS; d++) agents.column<Float64Array>(EXPRESSED[d]).data[slot] = expressed[d];

  const load = agents.column<Uint32Array>(C.loadLoci.name).data;
  const lo = slot * 4;
  const age = (state.tick - agents.column<Float64Array>(BODY_COLUMNS.born.name).data[slot]) / ticksPerYear(config);
  let disorderAt = 0;
  if (config.genetics.recessiveLoad) {
    for (;;) {
      for (let w = 0; w < 4; w++) {
        let word = 0;
        for (let bit = 0; bit < K.lociPerWord; bit++) if (nextFloat(s, o) < K.foundersBrokenShare) word |= 1 << bit;
        load[lo + w] = word >>> 0;
      }
      const [pre, post] = homozygous(load, lo);
      disorderAt = post === 0 ? 0 : postnatalDeathYears(lowestBit(post));
      if (pre === 0 && (disorderAt === 0 || disorderAt > age)) break;
    }
  } else {
    for (let w = 0; w < 4; w++) load[lo + w] = 0;
  }
  agents.column<Float64Array>(C.disorderAtYears.name).data[slot] = disorderAt;
  formed[slot] = 1;
  const [pre, post] = homozygous(load, lo);
  genealogyOf(state).add([
    agents.id.data[slot],
    0,
    0,
    agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data[slot],
    agents.column<Float64Array>(BODY_COLUMNS.born.name).data[slot],
    bitCount(pre) + bitCount(post),
  ]);
}

/** A parent's gamete: one of its two alleles per dial (sometimes mutated), and one haplotype's loci per locus. */
function gamete(sim: Sim, parent: number, dials: Float64Array, ddo: number, load: Uint32Array, lo: number): void {
  const { state, config } = sim;
  const agents = state.agents;
  const s = state.streams;
  const o = globalStreamOffset(StreamDomain.GENETICS);
  const alleles = agents.column<Float64Array>(C.alleles.name).data;
  const pa = parent * 2 * DIALS;
  for (let d = 0; d < DIALS; d++) {
    const g = GENE_DIALS[d];
    let v = alleles[pa + 2 * d + (nextFloat(s, o) < 0.5 ? 0 : 1)];
    if (nextFloat(s, o) < K.mutationChance) v = clamp(v + g.mutationSd * nextNormal(s, o), g.dial.min, g.dial.max);
    dials[ddo + d] = v;
  }
  const parentLoad = agents.column<Uint32Array>(C.loadLoci.name).data;
  const pl = parent * 4;
  for (let w = 0; w < 2; w++) {
    const mask = nextU32(s, o);
    load[lo + w] = ((parentLoad[pl + w] & mask) | (parentLoad[pl + 2 + w] & ~mask)) >>> 0;
  }
  if (!config.genetics.recessiveLoad) return;
  // New broken alleles: a Poisson number, each at a uniformly drawn locus.
  const mean = LETHAL_MUTATIONS_PER_GAMETE;
  const r = nextFloat(s, o);
  let p = exp(-mean);
  let cdf = p;
  let n = 0;
  while (r >= cdf && n < 64) {
    n += 1;
    p *= mean / n;
    cdf += p;
  }
  for (let i = 0; i < n; i++) {
    const locus = nextInt(s, o, 2 * K.lociPerWord);
    const w = locus < K.lociPerWord ? 0 : 1;
    load[lo + w] = (load[lo + w] | (1 << (locus - w * K.lociPerWord))) >>> 0;
  }
}

/** What conception decided about a fetus: its expressed frameScale, and the share of gestation at which it will be lost (0: none). */
export interface Conceived {
  readonly frameScale: number;
  readonly lossShare: number;
}

/**
 * Conception's step (called by body.reproduction's `mate`): the fetus's genome from one gamete of each
 * parent, written on the mother's row, and its expressed values with their developmental noise.
 */
export function conceiveGenome(sim: Sim, mother: number, father: number): Conceived {
  requireBody(sim, mother, 'conceiveGenome');
  requireBody(sim, father, 'conceiveGenome');
  const agents = sim.state.agents;
  const formed = agents.column<Uint8Array>(C.genomeFormed.name).data;
  for (const slot of [mother, father]) {
    if (formed[slot] !== 1) throw new Error(`conceiveGenome: agent id ${agents.id.data[slot]} has no genome; call formGenome.`);
  }
  const fetusAlleles = agents.column<Float64Array>(C.fetusAlleles.name).data;
  const fetusLoad = agents.column<Uint32Array>(C.fetusLoadLoci.name).data;
  const fetusDials = agents.column<Float64Array>(C.fetusDials.name).data;
  const fromMother = new Float64Array(DIALS);
  const fromFather = new Float64Array(DIALS);
  const lo = mother * 4;
  gamete(sim, mother, fromMother, 0, fetusLoad, lo);
  gamete(sim, father, fromFather, 0, fetusLoad, lo + 2);
  const ao = mother * 2 * DIALS;
  for (let d = 0; d < DIALS; d++) {
    fetusAlleles[ao + 2 * d] = fromMother[d];
    fetusAlleles[ao + 2 * d + 1] = fromFather[d];
  }
  express(sim, fetusAlleles, ao, fetusDials, mother * DIALS);
  const [pre] = homozygous(fetusLoad, lo);
  return {
    frameScale: fetusDials[mother * DIALS + DialIndex.FRAME_SCALE],
    lossShare: pre === 0 ? 0 : prenatalLossShare(lowestBit(pre)),
  };
}

/**
 * Birth's step (called by body.reproduction): the newborn takes the genome its mother carried for it,
 * learns nothing, and is entered in the genealogy with its parents' ids.
 */
export function bearGenome(sim: Sim, mother: number, child: number, motherId: number, fatherId: number): void {
  requireBody(sim, child, 'bearGenome');
  const { state } = sim;
  const agents = state.agents;
  const formed = agents.column<Uint8Array>(C.genomeFormed.name).data;
  if (formed[child] === 1) throw new Error(`bearGenome: agent id ${agents.id.data[child]} already has a genome.`);
  const alleles = agents.column<Float64Array>(C.alleles.name).data;
  const fetusAlleles = agents.column<Float64Array>(C.fetusAlleles.name).data;
  for (let k = 0; k < 2 * DIALS; k++) alleles[child * 2 * DIALS + k] = fetusAlleles[mother * 2 * DIALS + k];
  const fetusDials = agents.column<Float64Array>(C.fetusDials.name).data;
  for (let d = 0; d < DIALS; d++) agents.column<Float64Array>(EXPRESSED[d]).data[child] = fetusDials[mother * DIALS + d];
  const load = agents.column<Uint32Array>(C.loadLoci.name).data;
  const fetusLoad = agents.column<Uint32Array>(C.fetusLoadLoci.name).data;
  for (let w = 0; w < 4; w++) load[child * 4 + w] = fetusLoad[mother * 4 + w];
  const [pre, post] = homozygous(load, child * 4);
  agents.column<Float64Array>(C.disorderAtYears.name).data[child] = post === 0 ? 0 : postnatalDeathYears(lowestBit(post));
  formed[child] = 1;
  genealogyOf(state).add([
    agents.id.data[child],
    motherId,
    fatherId,
    agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data[child],
    agents.column<Float64Array>(BODY_COLUMNS.born.name).data[child],
    bitCount(pre) + bitCount(post),
  ]);
}

/** The adult frame, kg, a body of this sex grows toward at this expressed frameScale (§3.14). */
export function adultFrameFor(sex: number, frameScale: number): number {
  const base = K.baseFrameKg[sex as 1 | 2];
  if (base === undefined) throw new RangeError(`adultFrameFor: no such sex ${sex}.`);
  return base * frameScale;
}

// ALIBI: a body carries two copies of every gene, one from each parent; a copy broken by mutation does
// no harm while the other works, and a body with two broken copies of a gene it cannot live without
// dies, before or after birth, whether or not any group ever forms.
export const genetics: SystemDef = defineSystem({
  name: 'body.genetics',
  declare(state: SimState) {
    for (const spec of Object.values(GENETICS_COLUMNS)) state.agents.ensureColumn(spec);
    state.addPart(genealogyPart());
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    if (!agents.hasColumn(BODY_COLUMNS.sex.name)) throw new Error('body.genetics needs body.metabolism in the pipeline.');
    const perYear = ticksPerYear(config);
    const dies = deathDoor(sim, 'body.genetics');
    return () => {
      const tick = state.tick;
      const alive = agents.alive.data;
      const ids = agents.id.data;
      const formed = agents.column<Uint8Array>(C.genomeFormed.name).data;
      const born = agents.column<Float64Array>(BODY_COLUMNS.born.name).data;
      const disorderAt = agents.column<Float64Array>(C.disorderAtYears.name).data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1) continue;
        if (formed[slot] !== 1) {
          throw new Error(`body.genetics: agent id ${ids[slot]} has no genome; call formGenome right after formBody.`);
        }
        const at = disorderAt[slot];
        if (at > 0 && (tick - born[slot]) / perYear >= at) dies(slot, DeathCause.CONGENITAL);
      }
    };
  },
});
