// Reproduction: conception when two bodies mate, the fetus a mother's body
// pays for, birth and its bleeding, milk and nursing (docs/DESIGN.md §3.6,
// §3.13). Who mates, and who nurses whom, are acts (Phases 3–4): this file
// only gives them doors, `mate` and `nurse`.
//
// Runs after body.heat and before body.metabolism, so the heat of pregnancy
// and of making milk is charged in the same tick, and a newborn's first tick
// of metabolism, fitness and aging is the tick it was born.
//
// Clocks (D-024, D-045, §3.13): the lengths of the life course (gestation, the
// ages of fertility) are compressed years; daily physiology (the basal rise of
// pregnancy, milk made and its cost, the energy balance fertility reads) keeps
// real days.

import { ticksPerYear } from '../core/clock.ts';
import { exp } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextFloat, nextNormal } from '../core/rng.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sink, Source } from '../core/codec.ts';
import { spawnAgent } from '../sim.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { HEAT, HEAT_COLUMNS } from './heat.ts';
import { INJURY, injure } from './injury.ts';
import { fecundityAtAge, frameShare } from './lifecourse.ts';
import { BODY_COLUMNS, METABOLISM, Sex, basalKcalPerDay, fatKgOf, forbesKgOf, formBody, leanShiftKg } from './metabolism.ts';

/** Every number of reproduction, in one place. Estimates unless a source is named (docs/RESEARCH.md, *Reproduction*). */
export const REPRODUCTION = {
  /**
   * A female's chance of conceiving per mating act at her peak, fed and in balance [estimate: with acts
   * every two days, about 0.14 a compressed cycle, near the ~0.15 of natural-fertility populations].
   */
  actChance: 0.08,
  /** Share of conceptions that are male. */
  maleShare: 0.512,
  /** Gestation, compressed years (nine months). */
  gestationYears: 0.75,
  /** The energy balance fertility reads: averaged over days with this time constant, days [estimate: about a cycle]. */
  balanceDays: 4,
  /** Fertility falls linearly from 1 at a balance of 0 to 0 at minus this, kcal a day [estimate]. */
  balanceFloorPerDay: 150,
  /** Not fertile for this long after a birth or a lost pregnancy, compressed years [estimate: about six weeks]. */
  restYears: 0.1,
  /** A male's adult frame ÷ a female's, for a fetus's adult frame from its parents' until 2.7 (44 ÷ 34 kg, §3.8). */
  frameRatio: 44 / 34,
  /** Fat share of a newborn at term [estimate: about 12–15%]. */
  birthFatShare: 0.14,
  /** The fetus's mass, share of its birth mass, by share of gestation [estimate: the usual fetal weights by week]. */
  fetalMass: [[0, 0], [0.25, 0.005], [0.4, 0.04], [0.5, 0.09], [0.6, 0.19], [0.7, 0.33], [0.8, 0.53], [0.9, 0.78], [1, 1]] as ReadonlyArray<readonly [number, number]>,
  /** The fetus's fat, share of its mass, by share of gestation [estimate: most laid down in the last trimester]. */
  fetalFat: [[0.6, 0], [0.7, 0.03], [0.8, 0.07], [0.9, 0.11], [1, 0.14]] as ReadonlyArray<readonly [number, number]>,
  /** The mother's basal rate rises by this share of itself, by share of gestation (the 2005 review of energy needs in pregnancy written for FAO, see DESIGN.md §3.13; as remembered). */
  basalRise: [[0, 0], [1 / 3, 0.05], [2 / 3, 0.11], [1, 0.24]] as ReadonlyArray<readonly [number, number]>,
  /** Mass carried for a pregnancy, × the fetus's: placenta, fluid, the larger womb and blood [estimate: 8.5 kg at term]. */
  gravidShare: 2.5,
  /** Chance a pregnancy is lost, by the mother's age (Nybo Andersen et al. 2000, as remembered). */
  lossByAge: [[22, 0.09], [27, 0.11], [32, 0.15], [37, 0.25], [42, 0.51], [45, 0.75]] as ReadonlyArray<readonly [number, number]>,
  /** A lost pregnancy ends at a share of gestation drawn uniformly between these. */
  lossFrom: 0.1,
  lossTo: 0.4,
  /** A fetus below this share of its curve's birth mass at term is stillborn [estimate: below about 1.2–1.3 kg]. */
  stillbornBelow: 0.4,
  /** Blood lost at birth: log-normal, median mL and spread [estimate: one birth in five over 500 mL, 1% over 1,000]. */
  birthBloodMl: 350,
  birthBloodSpread: 0.45,
  /** Milk: most the breast holds, kg [Daly et al. 1996: 0.1–0.6]; most made, kg a day; made × the milk taken. */
  milkStoreKg: 0.3,
  milkMostPerDay: 1.5,
  milkHeadroom: 1.5,
  /** The milk taken is averaged over this, days. */
  milkTakenDays: 1,
  /** After a birth, milk is made at least at this rate, kg a day, × e^(−days since ÷ milkOnsetDays). */
  milkOnsetPerDay: 0.3,
  milkOnsetDays: 5,
  /** Below this rate, kg a day, lactation is over and milk left in the breast is taken back, with this time constant, days. */
  milkEndsBelowPerDay: 0.01,
  milkReabsorbDays: 2,
  /** Energy of milk, kcal per kg, and its water, share (FAO/WHO/UNU 2004: 0.67 kcal/g; 87.5% water). */
  milkKcalPerKg: 670,
  milkWaterShare: 0.875,
  /** Energetic efficiency of making milk (FAO/WHO/UNU 2004): the rest of what it costs is heat. */
  milkEfficiency: 0.8,
  /** Neither the fetus nor milk takes a mother's fat below this share of her mass. */
  keepsFatShare: 0.01,
} as const;
const K = REPRODUCTION;
const B = BODY_COLUMNS;
const H = HEAT_COLUMNS;
const JOULES_PER_KCAL = 4184;
/** body.injury's bleeding column: births bleed only when the pipeline holds injury. */
const INJURY_BLEED = 'bleedMlMin';

export const REPRODUCTION_COLUMNS = {
  /** 1 while carrying a fetus. */
  pregnant: { name: 'pregnant', dtype: 'u8', category: 'body' },
  /** Tick of conception. */
  conceivedAt: { name: 'conceivedAt', dtype: 'f64', category: 'body' },
  /** Share of gestation at which this pregnancy will be lost; 0 if it will be carried to term. */
  lossAt: { name: 'lossAt', dtype: 'f64', category: 'body' },
  /** The fetus's sex, its adult frame (kg), its father's id. */
  fetusSex: { name: 'fetusSex', dtype: 'u8', category: 'body' },
  fetusFrameKg: { name: 'fetusFrameKg', dtype: 'f64', category: 'body' },
  fetusFatherId: { name: 'fetusFatherId', dtype: 'u32', category: 'body' },
  /** The fetus's lean mass, kg: a share of its energy, as a body's is (§3.8). */
  fetusLeanKg: { name: 'fetusLeanKg', dtype: 'f64', category: 'body' },
  /** The fetus's energy (lean and fat), kcal: drawn from the mother, given to the newborn or lost. */
  fetusKcal: { name: 'fetusKcal', dtype: 'f64', category: 'body', conserved: { quantity: 'fetus energy', role: 'stock' } },
  fetusKcalIn: { name: 'fetusKcalIn', dtype: 'f64', category: 'body', conserved: { quantity: 'fetus energy', role: 'inflow' } },
  fetusKcalOut: { name: 'fetusKcalOut', dtype: 'f64', category: 'body', conserved: { quantity: 'fetus energy', role: 'outflow' } },
  /** The fetus's water, kg, when the pipeline keeps body water. */
  fetusWater: { name: 'fetusWater', dtype: 'f64', category: 'body', conserved: { quantity: 'fetus water', role: 'stock' } },
  fetusWaterIn: { name: 'fetusWaterIn', dtype: 'f64', category: 'body', conserved: { quantity: 'fetus water', role: 'inflow' } },
  fetusWaterOut: { name: 'fetusWaterOut', dtype: 'f64', category: 'body', conserved: { quantity: 'fetus water', role: 'outflow' } },
  /** Tick before which the body cannot conceive (after a birth or a lost pregnancy). */
  restUntil: { name: 'restUntil', dtype: 'f64', category: 'body' },
  /** Milk in the breast, kg, of fixed make-up (energy and water). */
  milkKg: { name: 'milkKg', dtype: 'f64', category: 'body', conserved: { quantity: 'milk', role: 'stock' } },
  milkMadeKg: { name: 'milkMadeKg', dtype: 'f64', category: 'body', conserved: { quantity: 'milk', role: 'inflow' } },
  milkOutKg: { name: 'milkOutKg', dtype: 'f64', category: 'body', conserved: { quantity: 'milk', role: 'outflow' } },
  /** Rate milk is made at now, kg a day. */
  milkRate: { name: 'milkRate', dtype: 'f64', category: 'body' },
  /** Milk taken, kg a day, averaged over about a day; and taken this tick, kg (written by `nurse`). */
  milkTakenAvg: { name: 'milkTakenAvg', dtype: 'f64', category: 'body' },
  milkTaken: { name: 'milkTaken', dtype: 'f64', category: 'body' },
  /** The rate milk is made at regardless of suckling, kg a day: set at a birth, fading. */
  milkOnset: { name: 'milkOnset', dtype: 'f64', category: 'body' },
  /** Daily change in the energy of the body's tissues, averaged (kcal a day), and that energy at the last day's start. */
  balancePerDay: { name: 'balancePerDay', dtype: 'f64', category: 'body' },
  tissueMark: { name: 'tissueMark', dtype: 'f64', category: 'body' },
  /** Heat of pregnancy and of making milk this tick, W: charged and cleared by body.metabolism. */
  reproW: { name: 'reproW', dtype: 'f64', category: 'body' },
  /** Mass carried for a pregnancy, kg: read by body.metabolism for the cost of moving. */
  gravidKg: { name: 'gravidKg', dtype: 'f64', category: 'body' },
  /** The ids of the body's mother and father; 0 for a body formed without them. Minds never read these. */
  motherId: { name: 'motherId', dtype: 'u32', category: 'identity' },
  fatherId: { name: 'fatherId', dtype: 'u32', category: 'identity' },
} as const satisfies Record<string, ColumnSpec>;
const C = REPRODUCTION_COLUMNS;

/** What `body.births` counts (index = event). */
export const BirthEvent = { CONCEPTION: 0, BIRTH: 1, STILLBIRTH: 2, LOST: 3 } as const;
export const REPRODUCTION_PARTS = { births: 'body.births', birthAges: 'body.birthAges' } as const;
/** `body.birthAges` counts births by the mother's age in whole years, from 0 to this. */
const OLDEST_MOTHER = 70;

function tally(name: string, length: number): StatePart {
  const counts = new Float64Array(length);
  return {
    name,
    holdsLearned: false,
    readings: () => counts,
    write(sink: Sink) {
      sink.array(counts);
    },
    read(source: Source) {
      const saved = source.array('f64');
      if (saved.length !== counts.length) throw new Error(`${name}: snapshot has the wrong length.`);
      counts.set(saved);
    },
  };
}

function readings(state: SimState, name: string): Float64Array {
  const part = state.parts.find((p) => p.name === name);
  if (!part || !part.readings) throw new Error(`The pipeline has no body.reproduction (${name} is missing).`);
  return part.readings() as Float64Array;
}

/** Linear interpolation in a table of [x, y] points, flat beyond its ends. */
function interpolate(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const hi = points[i];
    if (x <= hi[0]) {
      const lo = points[i - 1];
      return lo[1] + ((hi[1] - lo[1]) * (x - lo[0])) / (hi[0] - lo[0]);
    }
  }
  return points[points.length - 1][1];
}

/** Nourishment (§3.10): 0 at 1% body fat, 1 at 6%. */
function nourishmentOf(fatKg: number, massKg: number): number {
  const n = (fatKg / massKg - INJURY.nourishedFrom) / (INJURY.nourishedAt - INJURY.nourishedFrom);
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** A body's fertility from its energy balance (kcal a day, averaged): 1 at 0 or more, 0 at −150. */
export function balanceFactor(balancePerDay: number): number {
  const f = 1 + balancePerDay / K.balanceFloorPerDay;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** The mass, kg, of a newborn of this sex and adult frame at term on its curve. */
export function birthMassKg(sex: number, adultFrameKg: number): number {
  return (frameShare(sex, 0) * adultFrameKg) / (1 - K.birthFatShare);
}

/** The fetus's mass (share of birth mass) and fat share at share of gestation `g`. */
export function fetalCurve(g: number): { mass: number; fat: number } {
  return { mass: interpolate(K.fetalMass, g), fat: interpolate(K.fetalFat, g) };
}

/** The rise of a pregnant body's basal rate, as a share of it, at share of gestation `g`. */
export function basalRiseAt(g: number): number {
  return interpolate(K.basalRise, g);
}

/** The chance a pregnancy begun at this age is lost. */
export function lossChanceAt(ageYears: number): number {
  return interpolate(K.lossByAge, ageYears);
}

function bodyOf(sim: Sim, slot: number, door: string): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`${door}: slot ${slot} holds no agent.`);
  if (!agents.hasColumn(C.milkKg.name)) throw new Error(`${door}: the pipeline has no body.reproduction.`);
  if (agents.column<Uint8Array>(B.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`${door}: agent id ${agents.id.data[slot]} has no body.`);
  }
}

/** The adult frame a body grows toward (§3.12), or its estimate from its frame now if body.aging has not set it yet. */
function adultFrameOf(sim: Sim, slot: number): number {
  const agents = sim.state.agents;
  const f64 = (name: string) => agents.column<Float64Array>(name).data;
  const set = f64(B.adultFrameKg.name)[slot];
  if (set > 0) return set;
  const trained = agents.hasColumn('trainedKg') ? f64('trainedKg')[slot] : 0;
  const age = (sim.state.tick - f64(B.born.name)[slot]) / ticksPerYear(sim.config);
  return (f64(B.leanBuiltKg.name)[slot] - trained) / frameShare(agents.column<Uint8Array>(B.sex.name).data[slot], age);
}

/**
 * Two bodies mate: what the acts of Phase 4 call when both have chosen the mate act toward each other
 * (§3.6, §5.5). Nothing here decides who mates. If they are of opposite sex and the female can
 * conceive, she does with a chance set by both ages, her energy balance and her nourishment (§3.13).
 * Minds never learn the outcome from this door.
 */
export function mate(sim: Sim, a: number, b: number): void {
  bodyOf(sim, a, 'mate');
  bodyOf(sim, b, 'mate');
  if (a === b) throw new Error('mate: a body cannot mate with itself.');
  const { state } = sim;
  const agents = state.agents;
  const sex = agents.column<Uint8Array>(B.sex.name).data;
  if (sex[a] === sex[b]) return;
  const female = sex[a] === Sex.FEMALE ? a : b;
  const male = female === a ? b : a;
  const f64 = (name: string) => agents.column<Float64Array>(name).data;
  if (agents.column<Uint8Array>(C.pregnant.name).data[female] === 1) return;
  if (state.tick < f64(C.restUntil.name)[female]) return;
  const perYear = ticksPerYear(sim.config);
  const born = f64(B.born.name);
  const herAge = (state.tick - born[female]) / perYear;
  const hisAge = (state.tick - born[male]) / perYear;
  const lean = f64(B.leanKg.name)[female];
  const fat = fatKgOf(f64(B.energy.name)[female], f64(B.gut.name)[female], lean);
  const chance =
    K.actChance *
    fecundityAtAge(Sex.FEMALE, herAge) *
    fecundityAtAge(Sex.MALE, hisAge) *
    balanceFactor(f64(C.balancePerDay.name)[female]) *
    nourishmentOf(fat, lean + fat);
  const s = state.streams;
  const o = globalStreamOffset(StreamDomain.REPRODUCTION);
  if (!(nextFloat(s, o) < chance)) return;
  // Conceived: the fetus's sex, whether and when the pregnancy will be lost, its adult frame.
  const fetusSex = nextFloat(s, o) < K.maleShare ? Sex.MALE : Sex.FEMALE;
  const lost = nextFloat(s, o) < lossChanceAt(herAge);
  const lossAt = lost ? K.lossFrom + (K.lossTo - K.lossFrom) * nextFloat(s, o) : 0;
  const herFrame = adultFrameOf(sim, female);
  const hisFrame = adultFrameOf(sim, male);
  const frame = fetusSex === Sex.MALE ? (herFrame * K.frameRatio + hisFrame) / 2 : (herFrame + hisFrame / K.frameRatio) / 2;
  agents.column<Uint8Array>(C.pregnant.name).data[female] = 1;
  f64(C.conceivedAt.name)[female] = state.tick;
  f64(C.lossAt.name)[female] = lossAt;
  agents.column<Uint8Array>(C.fetusSex.name).data[female] = fetusSex;
  f64(C.fetusFrameKg.name)[female] = frame;
  agents.column<Uint32Array>(C.fetusFatherId.name).data[female] = agents.id.data[male];
  f64(C.fetusLeanKg.name)[female] = 0;
  readings(state, REPRODUCTION_PARTS.births)[BirthEvent.CONCEPTION] += 1;
}

/**
 * One body suckles at another: up to `kg` of milk moves from `from`'s breast into `to`'s gut and body
 * water. What the acts of Phase 3 call; who nurses whom, how often and until when are not decided
 * here. Returns the kg moved (0 if there is no milk). Milk is always digested (§3.13).
 */
export function nurse(sim: Sim, from: number, to: number, kg: number): number {
  bodyOf(sim, from, 'nurse');
  bodyOf(sim, to, 'nurse');
  if (from === to) throw new Error('nurse: a body cannot nurse itself.');
  if (!(kg >= 0 && Number.isFinite(kg))) throw new RangeError(`nurse: ${kg} kg.`);
  const agents = sim.state.agents;
  const f64 = (name: string) => agents.column<Float64Array>(name).data;
  const milk = f64(C.milkKg.name);
  const moved = kg < milk[from] ? kg : milk[from];
  if (!(moved > 0)) return 0;
  milk[from] -= moved;
  f64(C.milkOutKg.name)[from] += moved;
  f64(C.milkTaken.name)[from] += moved;
  const kcal = moved * K.milkKcalPerKg;
  f64(B.gut.name)[to] += kcal;
  f64(B.energy.name)[to] += kcal;
  f64(B.energyIn.name)[to] += kcal;
  if (agents.hasColumn(H.water.name)) {
    const water = moved * K.milkWaterShare;
    f64(H.water.name)[to] += water;
    f64(H.waterIn.name)[to] += water;
  }
  return moved;
}

// ALIBI: a body of either sex can join with one of the other to begin a new body, which grows inside
// the female at her cost, is born with a risk to her, and is fed on milk her body makes while it is
// suckled; all of this is how mammals continue at all, whether or not any group ever forms.
export const reproduction: SystemDef = defineSystem({
  name: 'body.reproduction',
  declare(state: SimState) {
    for (const spec of Object.values(REPRODUCTION_COLUMNS)) state.agents.ensureColumn(spec);
    state.addPart(tally(REPRODUCTION_PARTS.births, 4));
    state.addPart(tally(REPRODUCTION_PARTS.birthAges, OLDEST_MOTHER + 1));
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    if (!agents.hasColumn(B.adultFrameKg.name)) throw new Error('body.reproduction needs body.metabolism in the pipeline.');
    const perDay = config.time.ticksPerDay;
    const perYear = ticksPerYear(config);
    const dt = 86_400 / perDay;
    const dtDays = 1 / perDay;
    const gestationTicks = K.gestationYears * perYear;
    const restTicks = K.restYears * perYear;
    const balanceShare = 1 - exp(-1 / K.balanceDays);
    const takenShare = 1 - exp(-dtDays / K.milkTakenDays);
    const onsetFade = exp(-dtDays / K.milkOnsetDays);
    const reabsorbShare = 1 - exp(-dtDays / K.milkReabsorbDays);
    const fatDensity = METABOLISM.fatKcalPerKg;
    const leanDensity = METABOLISM.leanKcalPerKg;
    const milkCost = K.milkKcalPerKg / K.milkEfficiency;
    const watered = agents.hasColumn(H.water.name);
    const bleeds = agents.hasColumn(INJURY_BLEED);
    const training = agents.hasColumn('trainedKg');
    const s = state.streams;
    const o = globalStreamOffset(StreamDomain.REPRODUCTION);
    const births = readings(state, REPRODUCTION_PARTS.births);
    const birthAges = readings(state, REPRODUCTION_PARTS.birthAges);
    const due: number[] = [];

    /** Energy the mother can give up without her fat falling below its floor, kcal (by Forbes's split). */
    function spareKcal(fatKg: number, massKg: number, forbes: number): number {
      const spare = fatKg - K.keepsFatShare * massKg;
      return spare > 0 ? spare * (fatDensity + (leanDensity * forbes) / fatKg) : 0;
    }

    /** End a pregnancy without a newborn: the fetus's energy and water leave. */
    function lose(slot: number, event: number): void {
      const f64 = (name: string) => agents.column<Float64Array>(name).data;
      const kcal = f64(C.fetusKcal.name);
      f64(C.fetusKcalOut.name)[slot] += kcal[slot];
      kcal[slot] = 0;
      const water = f64(C.fetusWater.name);
      f64(C.fetusWaterOut.name)[slot] += water[slot];
      water[slot] = 0;
      f64(C.fetusLeanKg.name)[slot] = 0;
      f64(C.gravidKg.name)[slot] = 0;
      agents.column<Uint8Array>(C.pregnant.name).data[slot] = 0;
      f64(C.restUntil.name)[slot] = state.tick + restTicks;
      births[event] += 1;
    }

    /** A fetus at term is born: a new body with the fetus's tissue and water, and the mother bleeds. */
    function deliver(mother: number): void {
      const f64 = (name: string) => agents.column<Float64Array>(name).data;
      const sex = agents.column<Uint8Array>(C.fetusSex.name).data[mother];
      const frame = f64(C.fetusFrameKg.name)[mother];
      const leanKg = f64(C.fetusLeanKg.name)[mother];
      const kcal = f64(C.fetusKcal.name)[mother];
      const fatKg = (kcal - leanDensity * leanKg) / fatDensity;
      if (!(leanKg + fatKg >= K.stillbornBelow * birthMassKg(sex, frame) && fatKg > 0 && leanKg > 0)) {
        lose(mother, BirthEvent.STILLBIRTH);
        return;
      }
      const water = f64(C.fetusWater.name)[mother];
      const motherId = agents.id.data[mother];
      const fatherId = agents.column<Uint32Array>(C.fetusFatherId.name).data[mother];
      const age = (state.tick - f64(B.born.name)[mother]) / perYear;
      const x = f64('x')[mother];
      const y = f64('y')[mother];
      // The fetus's stocks leave the mother before the store can grow and move its columns.
      f64(C.fetusKcalOut.name)[mother] += kcal;
      f64(C.fetusKcal.name)[mother] = 0;
      f64(C.fetusWaterOut.name)[mother] += water;
      f64(C.fetusWater.name)[mother] = 0;
      f64(C.fetusLeanKg.name)[mother] = 0;
      f64(C.gravidKg.name)[mother] = 0;
      agents.column<Uint8Array>(C.pregnant.name).data[mother] = 0;
      f64(C.restUntil.name)[mother] = state.tick + restTicks;
      f64(C.milkOnset.name)[mother] = K.milkOnsetPerDay;
      births[BirthEvent.BIRTH] += 1;
      birthAges[age >= OLDEST_MOTHER ? OLDEST_MOTHER : age > 0 ? Math.floor(age) : 0] += 1;
      const loss = K.birthBloodMl * exp(K.birthBloodSpread * nextNormal(s, o));

      const child = spawnAgent(sim, x, y);
      formBody(sim, child, { sex: sex as 1 | 2, ageYears: 0, leanKg, fatKg, adultFrameKg: frame });
      // formBody counted the newborn's energy as its first inflow: the fetus's, to rounding. Columns are
      // fetched again, since the store may have grown.
      const g64 = (name: string) => agents.column<Float64Array>(name).data;
      agents.column<Uint32Array>(C.motherId.name).data[child] = motherId;
      agents.column<Uint32Array>(C.fatherId.name).data[child] = fatherId;
      if (watered && water > 0) {
        g64(H.water.name)[child] = water;
        g64(H.waterIn.name)[child] = water;
        g64(H.coreC.name)[child] = HEAT.coreC;
      }
      // Bleeding: the total lost is the rate at which it starts × the clotting time (§3.10).
      if (bleeds) injure(sim, mother, { bleedMlMin: loss / (INJURY.clotSeconds / 60) });
    }

    return () => {
      const tick = state.tick;
      const newDay = tick % perDay === 0;
      const alive = agents.alive.data;
      const f64 = (name: string) => agents.column<Float64Array>(name).data;
      const sex = agents.column<Uint8Array>(B.sex.name).data;
      const born = f64(B.born.name);
      const lean = f64(B.leanKg.name);
      const leanBuilt = f64(B.leanBuiltKg.name);
      const gut = f64(B.gut.name);
      const energy = f64(B.energy.name);
      const energyIn = f64(B.energyIn.name);
      const energyOut = f64(B.energyOut.name);
      const adultFrame = f64(B.adultFrameKg.name);
      const trained = training ? f64('trainedKg') : null;
      const water = watered ? f64(H.water.name) : null;
      const waterIn = watered ? f64(H.waterIn.name) : null;
      const waterOut = watered ? f64(H.waterOut.name) : null;
      const pregnant = agents.column<Uint8Array>(C.pregnant.name).data;
      const conceivedAt = f64(C.conceivedAt.name);
      const lossAt = f64(C.lossAt.name);
      const fetusSex = agents.column<Uint8Array>(C.fetusSex.name).data;
      const fetusFrame = f64(C.fetusFrameKg.name);
      const fetusLean = f64(C.fetusLeanKg.name);
      const fetusKcal = f64(C.fetusKcal.name);
      const fetusKcalIn = f64(C.fetusKcalIn.name);
      const fetusWater = f64(C.fetusWater.name);
      const fetusWaterIn = f64(C.fetusWaterIn.name);
      const milk = f64(C.milkKg.name);
      const milkMade = f64(C.milkMadeKg.name);
      const milkOut = f64(C.milkOutKg.name);
      const milkRate = f64(C.milkRate.name);
      const takenAvg = f64(C.milkTakenAvg.name);
      const taken = f64(C.milkTaken.name);
      const onset = f64(C.milkOnset.name);
      const balance = f64(C.balancePerDay.name);
      const mark = f64(C.tissueMark.name);
      const reproW = f64(C.reproW.name);
      const gravid = f64(C.gravidKg.name);
      due.length = 0;

      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1 || sex[slot] !== Sex.FEMALE) continue;
        const leanKg = lean[slot];
        let fatKg = fatKgOf(energy[slot], gut[slot], leanKg);
        const mass = leanKg + fatKg;

        // The energy balance fertility reads: the day's change in the tissues' energy.
        if (newDay) {
          const tissue = energy[slot] - gut[slot];
          if (mark[slot] !== 0) balance[slot] += (tissue - mark[slot] - balance[slot]) * balanceShare;
          mark[slot] = tissue;
        }
        const pregnantNow = pregnant[slot] === 1;
        const lactating = milkRate[slot] > 0 || onset[slot] > 0 || milk[slot] > 0 || taken[slot] > 0;
        if (!pregnantNow && !lactating) continue;

        const forbes = forbesKgOf(leanBuilt[slot], trained ? trained[slot] : 0, adultFrame[slot]);
        const nourished = nourishmentOf(fatKg, mass);
        let spare = spareKcal(fatKg, mass, forbes);
        let heatW = 0;

        // Pregnancy.
        if (pregnantNow) {
          const g = (tick - conceivedAt[slot]) / gestationTicks;
          if (lossAt[slot] > 0 && g >= lossAt[slot]) {
            lose(slot, BirthEvent.LOST);
          } else if (g >= 1) {
            due.push(slot);
          } else {
            const age = (tick - born[slot]) / perYear;
            const basalW = (basalKcalPerDay(Sex.FEMALE, age, mass) * JOULES_PER_KCAL) / 86_400;
            heatW += basalRiseAt(g) * basalW;
            // The fetus takes what it lacks of its curve, × the mother's nourishment.
            const fatShare = interpolate(K.fetalFat, g);
            const target = interpolate(K.fetalMass, g) * birthMassKg(fetusSex[slot], fetusFrame[slot]);
            const fl = fetusLean[slot];
            const ff = (fetusKcal[slot] - leanDensity * fl) / fatDensity;
            let dLean = target * (1 - fatShare) - fl;
            let dFat = target * fatShare - ff;
            dLean = dLean > 0 ? dLean * nourished : 0;
            dFat = dFat > 0 ? dFat * nourished : 0;
            let kcal = leanDensity * dLean + fatDensity * dFat;
            if (kcal > spare) {
              const cut = spare / kcal;
              dLean *= cut;
              dFat *= cut;
              kcal = spare;
            }
            if (kcal > 0) {
              energy[slot] -= kcal;
              energyOut[slot] += kcal;
              lean[slot] += leanShiftKg(-kcal, fatKg, forbes);
              fetusKcal[slot] += kcal;
              fetusKcalIn[slot] += kcal;
              fetusLean[slot] = fl + dLean;
              spare -= kcal;
              if (water && waterOut && dLean > 0) {
                const w = HEAT.leanWaterShare * dLean;
                water[slot] -= w;
                waterOut[slot] += w;
                fetusWater[slot] += w;
                fetusWaterIn[slot] += w;
              }
              fatKg = fatKgOf(energy[slot], gut[slot], lean[slot]);
            }
            const fetusKg = fetusLean[slot] + (fetusKcal[slot] - leanDensity * fetusLean[slot]) / fatDensity;
            gravid[slot] = K.gravidShare * fetusKg;
          }
        }

        // Milk: made to follow what is taken, from the mother's tissues and water, into the breast.
        if (lactating) {
          const took = taken[slot];
          taken[slot] = 0;
          takenAvg[slot] += (took / dtDays - takenAvg[slot]) * takenShare;
          let o0 = onset[slot] * onsetFade;
          if (o0 < 1e-6) o0 = 0;
          onset[slot] = o0;
          let rate = K.milkHeadroom * takenAvg[slot];
          if (rate < o0) rate = o0;
          if (rate > K.milkMostPerDay) rate = K.milkMostPerDay;
          rate *= nourished;
          if (rate < 1e-9) rate = 0;
          milkRate[slot] = rate;
          if (rate >= K.milkEndsBelowPerDay) {
            const room = K.milkStoreKg - milk[slot];
            let made = rate * dtDays;
            if (made > room) made = room > 0 ? room : 0;
            const most = spare / milkCost;
            if (made > most) made = most;
            if (made > 0) {
              const kcal = made * K.milkKcalPerKg;
              energy[slot] -= kcal;
              energyOut[slot] += kcal;
              lean[slot] += leanShiftKg(-kcal, fatKg, forbes);
              heatW += ((made * milkCost - kcal) * JOULES_PER_KCAL) / dt;
              milk[slot] += made;
              milkMade[slot] += made;
              if (water && waterOut) {
                const w = made * K.milkWaterShare;
                water[slot] -= w;
                waterOut[slot] += w;
              }
            }
          } else if (milk[slot] > 0) {
            // Lactation is over: what is left in the breast is taken back.
            let back = milk[slot] * reabsorbShare;
            if (milk[slot] < 1e-6) back = milk[slot];
            const kcal = back * K.milkKcalPerKg;
            milk[slot] -= back;
            milkOut[slot] += back;
            energy[slot] += kcal;
            energyIn[slot] += kcal;
            lean[slot] += leanShiftKg(kcal, fatKg, forbes);
            if (water && waterIn) {
              const w = back * K.milkWaterShare;
              water[slot] += w;
              waterIn[slot] += w;
            }
          }
        }
        reproW[slot] = heatW;
      }

      // Births, after the loop: a new body may grow the store and move every column.
      for (const mother of due) deliver(mother);
    };
  },
});
