// Animals: grazers, predators, and scavengers. Design: docs/DESIGN.md §2.13.
// Animals are environment: simple drives, no learning. Everything that sets how
// much meat and danger the land holds per day runs on real days (D-026).

import type { Sink, Source } from '../core/codec.ts';
import { cosTurn, exp, sinTurn } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextChance, nextFloat } from '../core/rng.ts';
import { BucketGrid } from '../core/spatial.ts';
import type { EntityStore } from '../core/store.ts';
import { spawnEntity } from '../sim.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { CLIMATE_CONSTANTS, CLIMATE_PARTS, dailyMeanTemperatureC } from './climate.ts';
import { FIRE_CONSTANTS, FIRE_LAYERS, FIRE_STORE, FirePoints, FireStage, avoidDistanceM } from './fire.ts';
import { seasonFraction, sunlight } from './light.ts';
import { BROWSE_LAYER, FORAGE_LAYER, PLANT_CONSTANTS, PLANT_SPECIES, SEED_RAIN_LAYER, coverLayer } from './plants.ts';
import { TERRAIN_LAYERS, Water } from './terrain.ts';

/** Kinds of animal that live in groups. Numbers are part of what a seed means: never renumber. */
export const AnimalKind = {
  DEER: 1,
  AUROCHS: 2,
  WOLF: 3,
  CAT: 4,
} as const;

export interface GroupKind {
  readonly name: string;
  readonly kind: number;
  readonly grazer: boolean;
  /** Meat a body leaves, kg. */
  readonly edibleKg: number;
  /** A grown body's mass, kg: what a blow must wound (§2.17). */
  readonly massKg: number;
  readonly typicalGroup: number;
  readonly maxGroup: number;
  /** Starting density, animals per km² of land. */
  readonly startPerKm2: number;
  /** Births per animal per real year, in a good season. */
  readonly birthsPerRealYear: number;
  /** If true, births are per group (one breeding pair raises one litter), not per animal. */
  readonly oneLitterPerGroup: boolean;
  /** Deaths per animal per real year from causes not modelled one by one (age, illness, accident). */
  readonly deathsPerRealYear: number;
  /** Food needed per animal per day: forage (dry kg) for grazers, meat (kg) for predators. */
  readonly needKgPerDay: number;
  /** Days of need that full condition stands for. */
  readonly reserveDays: number;
  readonly walkKmh: number;
  readonly runKmh: number;
  /** Grazers: the daily mean temperature they are most comfortable in. */
  readonly comfortC: number;
  /** Grazers: true if they browse leaves and shoots first and graze grass only for the rest (deer); false for grass only. */
  readonly browses: boolean;
  /** Browsers: the most of their food that can be grass. */
  readonly grassShareMax: number;
}

// Estimates unless RESEARCH.md says otherwise; the ecology review (1.10) judges them.
export const GROUP_KINDS: readonly GroupKind[] = Object.freeze([
  {
    name: 'deer',
    kind: AnimalKind.DEER,
    grazer: true,
    edibleKg: 55,
    massKg: 90,
    typicalGroup: 8,
    maxGroup: 30,
    startPerKm2: 5,
    birthsPerRealYear: 0.45,
    oneLitterPerGroup: false,
    deathsPerRealYear: 0.1,
    needKgPerDay: 2.5,
    reserveDays: 30,
    walkKmh: 2,
    runKmh: 30,
    comfortC: 8,
    browses: true,
    grassShareMax: 0.3,
  },
  {
    name: 'aurochs',
    kind: AnimalKind.AUROCHS,
    grazer: true,
    edibleKg: 350,
    massKg: 700,
    typicalGroup: 12,
    maxGroup: 25,
    startPerKm2: 0.5,
    birthsPerRealYear: 0.25,
    oneLitterPerGroup: false,
    deathsPerRealYear: 0.08,
    needKgPerDay: 12,
    reserveDays: 40,
    walkKmh: 1.5,
    runKmh: 20,
    comfortC: 12,
    browses: false,
    grassShareMax: 1,
  },
  {
    name: 'wolf',
    kind: AnimalKind.WOLF,
    grazer: false,
    edibleKg: 15,
    massKg: 40,
    typicalGroup: 5,
    maxGroup: 8,
    startPerKm2: 0.02,
    // Pups that survive to join the pack, per pack per real year.
    birthsPerRealYear: 2.5,
    oneLitterPerGroup: true,
    deathsPerRealYear: 0.25,
    needKgPerDay: 5.6,
    reserveDays: 4,
    walkKmh: 4,
    runKmh: 8,
    comfortC: 0,
    browses: false,
    grassShareMax: 0,
  },
  {
    name: 'cat',
    kind: AnimalKind.CAT,
    grazer: false,
    edibleKg: 20,
    massKg: 60,
    typicalGroup: 1,
    maxGroup: 1,
    startPerKm2: 0.015,
    birthsPerRealYear: 0.35,
    oneLitterPerGroup: false,
    deathsPerRealYear: 0.15,
    needKgPerDay: 3.5,
    reserveDays: 5,
    walkKmh: 4,
    runKmh: 4,
    comfortC: 0,
    browses: false,
    grassShareMax: 0,
  },
] satisfies GroupKind[]);

/**
 * Tall cover in a cell, from its plant covers (§2.13): reeds, trees, half the bushes, and grass
 * at full height from midsummer to late autumn (0.3 of it otherwise). Cats ambush from it, and
 * it hides whatever lies in it from eyes (§4.8).
 */
export function tallCoverOf(season: number, grass: number, berry: number, nut: number, reed: number): number {
  const grassTall = season >= 0.3 && season < 0.75 ? 1 : 0.3;
  return reed + nut + 0.5 * berry + grassTall * grass;
}

export function groupKind(kind: number): GroupKind {
  const spec = GROUP_KINDS.find((k) => k.kind === kind);
  if (!spec) throw new Error(`No animal kind ${kind}.`);
  return spec;
}

export const HARE = {
  edibleKg: 2.5,
  startPerKm2: 30,
  /** Young that live to leave the nest, per hare per real year. */
  birthsPerRealYear: 4,
  deathsPerRealYear: 1,
  /** Extra deaths per real year from crowding (disease, stress), per hare per km² of local density / 10. */
  crowdingDeathsPerRealYear: 1,
  crowdingPerKm2: 10,
  needKgPerDay: 0.3,
  /** Share of a cell's hares that moves to each neighbouring cell per day. */
  wanderPerDay: 0.02,
  /** Extra deaths per day, as a share of the hares going hungry. */
  starvationPerDay: 0.05,
} as const;

export const ANIMAL_CONSTANTS = {
  /** Spring window, as season fractions, in which births happen. */
  birthStart: 0.08,
  birthEnd: 0.2,
  hareBirthStart: 0.05,
  hareBirthEnd: 0.5,
  /** Below this condition an animal hunts; at zero it starts dying of hunger. */
  hungryBelow: 0.7,
  /** Daily death hazard added at zero condition, rising from nothing at `starvingBelow`. */
  starvationHazardPerDay: 0.1,
  starvingBelow: 0.3,
  /** Births need at least this condition, and reach their full rate at full condition. */
  breedAbove: 0.4,
  thirstyAfterHours: 18,
  deerDetectDayM: 300,
  deerDetectNightM: 120,
  fleeM: 1500,
  wolfSearchM: 3000,
  chaseStartM: 300,
  /** Chance a wolf chase ends in a kill, for a pack of four; scales with pack size up to 1.5×. */
  wolfKillDeer: 0.2,
  wolfKillAurochs: 0.06,
  wolvesNeededForAurochs: 4,
  catSearchM: 3000,
  ambushM: 200,
  catKillDeer: 0.35,
  /** Tall cover at which a big cat's strike reaches its full chance. */
  ambushCover: 0.3,
  /** Share of that chance left to a cat striking from open ground. */
  openGroundShare: 0.25,
  /** Below this sunlight it is night. */
  nightBelowSunlight: 0.02,
  /** Ticks a predator rests after a chase or a strike. */
  restTicks: 6,
  /** Meat a predator can eat per hour, kg per animal. */
  mealKgPerHour: 2,
  /** Chance per hour of catching a hare, per hare in the 3 × 3 cells around, and its cap. */
  wolfHarePerHare: 0.03,
  wolfHareCap: 0.2,
  catHarePerHare: 0.05,
  catHareCap: 0.3,
  /** Rotting: share of a carcass lost per day, plus this much per °C above freezing. */
  rotPerDay: 0.02,
  rotPerDayPerC: 0.006,
  vulturesPerKm2: 0.05,
  leastVultures: 20,
  vultureMeatKgPerDay: 0.5,
  /** Most of a carcass vultures can take in a day. */
  vultureShareCap: 0.5,
  vultureBirthsPerRealYear: 0.25,
  vultureDeathsPerRealYear: 0.15,
  vultureHungerDeathsPerRealYear: 0.3,
  wolfPackSpacingM: 15_000,
  wolfDisperseNearM: 10_000,
  wolfDisperseFarM: 20_000,
  wolvesThatDisperse: 3,
  catSpacingM: 6000,
  catDisperseNearM: 5000,
  catDisperseFarM: 15_000,
  /** Predators drift back toward their anchor beyond this distance. */
  rangeM: 6000,
  /** How far a grazer looks for a better spot: normally, and when below `hungryBelow` (T-006). */
  grazeSearchM: 800,
  hungryGrazeSearchM: 3000,
  /**
   * Starting numbers are densities per km² of habitat: land with at least this much forage
   * (grazing and browse) counts fully, poorer land in proportion (T-006).
   */
  goodHabitatForageKgHa: 100,
  /** In a flaming cell (§2.16): share of the hares that die each tick, share of carcass meat burnt, and of its pathogen load left. */
  hareFireDeathsPerTick: 0.03,
  carcassBurntPerTick: 0.05,
  carcassLoadLeftPerTick: 0.5,
  /** Fires this hot or hotter, kW, make an animal run rather than walk away. */
  runFromFireKw: 1000,
} as const;
const A = ANIMAL_CONSTANTS;

/** A wound an animal deals: open cm², bleeding mL a minute, dirt, and the chance and share of a broken limb (§2.17). */
export interface AnimalWound {
  readonly openCm2: number;
  readonly bleedMlMin: number;
  readonly dirt: number;
  /** Chance of a broken bone, and the share of the limb's use lost if so. */
  readonly breakChance: number;
  readonly breakShare: number;
  /** True for a leg, false for an arm. */
  readonly leg: boolean;
}

/** Animals and persons (docs/DESIGN.md §2.17). Every number an estimate unless a source is named there. */
export const ENCOUNTER = {
  /** Distances at which a group notices a person and leaves, by day and by night, m; and how far it goes. Index: AnimalKind. */
  shyDayM: [0, 100, 50, 100, 50] as readonly number[],
  shyNightM: [0, 40, 20, 50, 25] as readonly number[],
  leaveM: [0, 400, 200, 400, 300] as readonly number[],
  /** Whether the group runs (true) or walks (false) when it leaves a person. */
  leaveRuns: [false, true, false, false, false] as readonly boolean[],
  /** A person who did not walk in its last tick is noticed at this share of the distance. */
  stillShare: 0.4,
  /** Tall cover around a person shortens it by this much at full cover (perception's concealment), to no less than `leastConcealed`. */
  concealLoss: 0.7,
  leastConcealed: 0.3,
  /** Metres walked in the last tick above which a person counts as moving. */
  movingFromM: 1,
  /** A person of this lean mass or more counts as company for another, kg. */
  companyLeanKg: 20,
  /** Within this distance another person makes a person not alone, m: to a cat, to wolves. */
  catAloneM: 50,
  wolfAloneM: 100,
  /** Wolves take a lone person only if smaller than this lean mass, kg, or with mobility under `lameBelow` (Linnell et al. 2002). */
  wolfPreyLeanKg: 30,
  lameBelow: 0.5,
  /** A landed attack holds with chance min(holdMost, H ÷ lean mass): H for a cat, and for each wolf in the pack, kg. */
  catHoldKg: 22,
  wolfHoldKgEach: 5,
  holdMost: 0.9,
  /** A hold: a bite to the throat or neck. */
  hold: { openCm2: 20, bleedMlMin: 1200, dirt: 1, breakChance: 0, breakShare: 0, leg: false } as AnimalWound,
  /** A cat's mauling bite (two in a mauling, one biting back), a wolf's bite, an aurochs' goring. */
  catBite: { openCm2: 25, bleedMlMin: 60, dirt: 1, breakChance: 0.15, breakShare: 0.7, leg: false } as AnimalWound,
  catMaulBites: 2,
  wolfBite: { openCm2: 15, bleedMlMin: 40, dirt: 1, breakChance: 0.1, breakShare: 0.7, leg: true } as AnimalWound,
  gore: { openCm2: 60, bleedMlMin: 200, dirt: 0.5, breakChance: 0.3, breakShare: 0.7, leg: true } as AnimalWound,
  /** Struck animals: energy landed per kg of body that kills, J; the edge's gain; the half-life of a wound, days. */
  lethalJPerKg: 8,
  edgeGain: 3,
  healHalfDays: 5,
  /** Chance a tick that a struck aurochs gores its striker, and that a struck wolf or cat bites back. */
  goreChance: 0.4,
  biteBackChance: 0.5,
} as const;
const E = ENCOUNTER;

/**
 * The share of its distance at which an animal notices a person (§2.17): 1 for a person that walked in
 * its last tick on open ground, less for one standing still, and less again in tall cover (`tall` is
 * the tall cover around it as a share of `ambushCover`'s).
 */
export function noticeFactor(moving: boolean, tall: number): number {
  let conceal = 1 - E.concealLoss * (tall < 1 ? tall : 1);
  if (conceal < E.leastConcealed) conceal = E.leastConcealed;
  return (moving ? 1 : E.stillShare) * conceal;
}

/** Chance a landed attack by a group of `kind` and `count` holds a person of `leanKg` lean mass (§2.17). */
export function holdChance(kind: number, count: number, leanKg: number): number {
  const h = kind === AnimalKind.WOLF ? E.wolfHoldKgEach * count : E.catHoldKg;
  const p = leanKg > 0 ? h / leanKg : 1;
  return p > E.holdMost ? E.holdMost : p;
}

/** The column the acts keep on each agent: metres walked in its last tick (§2.17); animals read it by name. */
export const MOVED_TICK_COLUMN = 'movedTickM';

export const ANIMAL_STORE = 'animals';
export const HARE_LAYER = 'animals.hare';
export const CARCASS_LAYER = 'animals.carcass';
/** Pathogen load of the carcass meat in each cell, 0 to 1 (§2.14). Fresh meat is clean; mixing is by weight. */
export const CARCASS_LOAD_LAYER = 'animals.carcassLoad';
export const ANIMAL_PARTS = { counts: 'animals.counts', bites: 'animals.bites' } as const;

export const AnimalMode = {
  REST: 0,
  MOVE: 1,
  FLEE: 2,
  HUNT: 3,
  FEED: 4,
  AMBUSH: 5,
} as const;

/** Running totals since the start of the run, plus the vultures. Indices are fixed. */
export const ANIMAL_FIELDS = {
  wolfKillsDeer: 0,
  wolfKillsAurochs: 1,
  wolfKillsHare: 2,
  catKillsDeer: 3,
  catKillsAurochs: 4,
  catKillsHare: 5,
  catKillsAtNight: 6,
  wolfChases: 7,
  catStrikes: 8,
  birthsDeer: 9,
  birthsAurochs: 10,
  birthsWolf: 11,
  birthsCat: 12,
  birthsHare: 13,
  deathsDeer: 14,
  deathsAurochs: 15,
  deathsWolf: 16,
  deathsCat: 17,
  deathsHare: 18,
  hungerDeaths: 19,
  vultures: 20,
  meatToVultures: 21,
  meatRotted: 22,
  meatToPredators: 23,
  // Animals and persons (§2.17).
  catStrikesPerson: 24,
  catLandsPerson: 25,
  wolfAttacksPerson: 26,
  holdsPerson: 27,
  bitesToPersons: 28,
  blowsByPersons: 29,
  killedByPersonsDeer: 30,
  killedByPersonsAurochs: 31,
  killedByPersonsWolf: 32,
  killedByPersonsCat: 33,
} as const;
const FIELD_COUNT = 34;
const F = ANIMAL_FIELDS;
const KILLED_BY_PERSONS: Readonly<Record<number, number>> = {
  [AnimalKind.DEER]: F.killedByPersonsDeer,
  [AnimalKind.AUROCHS]: F.killedByPersonsAurochs,
  [AnimalKind.WOLF]: F.killedByPersonsWolf,
  [AnimalKind.CAT]: F.killedByPersonsCat,
};

/** Fields of one entry in `animals.bites`. */
const BITE = { agent: 0, openCm2: 1, bleedMlMin: 2, dirt: 3, leg: 4, arm: 5, kind: 6, STRIDE: 7 } as const;
/** How many numbers `AnimalBites.entry` writes: open cm², bleeding, dirt, leg, arm, the animal's kind. */
export const BITES_INJURY_FIELDS = BITE.STRIDE - 1;

/**
 * Wounds animals dealt to persons this tick (§2.17), for body.injury to deal through `injure` in the
 * same tick: the world does not import bodies. Empty between ticks once body.injury has run; cleared
 * by world.animals at the start of each tick in any case.
 */
export class AnimalBites implements StatePart {
  readonly name = ANIMAL_PARTS.bites;
  readonly holdsLearned = false;
  n = 0;
  data = new Float64Array(BITE.STRIDE * 8);

  push(agentId: number, w: AnimalWound, leg: number, arm: number, kind: number): void {
    if ((this.n + 1) * BITE.STRIDE > this.data.length) {
      const bigger = new Float64Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const o = this.n * BITE.STRIDE;
    this.data[o + BITE.agent] = agentId;
    this.data[o + BITE.openCm2] = w.openCm2;
    this.data[o + BITE.bleedMlMin] = w.bleedMlMin;
    this.data[o + BITE.dirt] = w.dirt;
    this.data[o + BITE.leg] = leg;
    this.data[o + BITE.arm] = arm;
    this.data[o + BITE.kind] = kind;
    this.n++;
  }

  /** Is the agent with this id in an animal's jaws or under its horns this tick? */
  holds(agentId: number): boolean {
    for (let i = 0; i < this.n; i++) if (this.data[i * BITE.STRIDE + BITE.agent] === agentId) return true;
    return false;
  }

  /** Entry `i`: the agent's id, and the injury's fields into `out` (open, bleeding, dirt, leg, arm, kind). */
  entry(i: number, out: Float64Array): number {
    const o = i * BITE.STRIDE;
    for (let f = 1; f < BITE.STRIDE; f++) out[f - 1] = this.data[o + f];
    return this.data[o + BITE.agent];
  }

  clear(): void {
    this.n = 0;
  }

  write(sink: Sink): void {
    sink.array(this.data.slice(0, this.n * BITE.STRIDE));
  }

  read(source: Source): void {
    const saved = source.array('f64');
    if (saved.length % BITE.STRIDE !== 0) throw new Error('Snapshot animal bites have the wrong length.');
    this.n = saved.length / BITE.STRIDE;
    if (this.data.length < saved.length) this.data = new Float64Array(saved.length);
    this.data.set(saved);
  }
}

/** The part `animals.bites`, or null when the pipeline has no animals. */
export function bitesOf(state: SimState): AnimalBites | null {
  const part = state.parts.find((p) => p.name === ANIMAL_PARTS.bites);
  return part ? (part as AnimalBites) : null;
}

export class AnimalCounts implements StatePart {
  readonly name = ANIMAL_PARTS.counts;
  readonly holdsLearned = false;
  readonly values = new Float64Array(FIELD_COUNT);

  readings(): Float64Array {
    return this.values;
  }

  write(sink: Sink): void {
    sink.array(this.values);
  }

  read(source: Source): void {
    const values = source.array('f64');
    if (values.length !== FIELD_COUNT) throw new Error('Snapshot animal counts have the wrong length.');
    this.values.set(values);
  }
}

const BIRTH_FIELD: Readonly<Record<number, number>> = {
  [AnimalKind.DEER]: F.birthsDeer,
  [AnimalKind.AUROCHS]: F.birthsAurochs,
  [AnimalKind.WOLF]: F.birthsWolf,
  [AnimalKind.CAT]: F.birthsCat,
};
const DEATH_FIELD: Readonly<Record<number, number>> = {
  [AnimalKind.DEER]: F.deathsDeer,
  [AnimalKind.AUROCHS]: F.deathsAurochs,
  [AnimalKind.WOLF]: F.deathsWolf,
  [AnimalKind.CAT]: F.deathsCat,
};

/** The pathogen load of a cell's meat after `added` kg of fresh, clean meat joins `kg` kg at `load`. */
export function dilutedLoad(load: number, kg: number, added: number): number {
  return kg > 0 && added > 0 ? (load * kg) / (kg + added) : load;
}

/** Bits of the plant species whose seeds grazers carry: grass, berry, nut, greens. */
const CARRIED_SEEDS = (['grass', 'berry', 'nut', 'greens'] as const).map((name) => {
  const index = PLANT_SPECIES.findIndex((s) => s.name === name);
  if (index < 0) throw new Error(`No plant species ${name}.`);
  return index;
});

interface Columns {
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  count: Uint16Array;
  condition: Float32Array;
  targetX: Float32Array;
  targetY: Float32Array;
  mode: Uint8Array;
  thirst: Float32Array;
  anchorX: Float32Array;
  anchorY: Float32Array;
  cooldown: Uint16Array;
  preyId: Uint32Array;
  seeds: Uint8Array;
  /** The most-hurt animal's share of a lethal wound from persons' blows, 0 to 1 (§2.17). */
  hurt: Float32Array;
  /** The id of the person a predator is hunting, 0 for none (§2.17). */
  preyAgent: Uint32Array;
}

function declareStore(state: SimState): EntityStore {
  const store = state.addStore(ANIMAL_STORE);
  store.ensureColumn({ name: 'kind', dtype: 'u8', category: 'identity' });
  for (const name of ['x', 'y', 'condition', 'targetX', 'targetY', 'thirst', 'anchorX', 'anchorY', 'hurt']) {
    store.ensureColumn({ name, dtype: 'f32', category: 'body' });
  }
  store.ensureColumn({ name: 'count', dtype: 'u16', category: 'body' });
  store.ensureColumn({ name: 'mode', dtype: 'u8', category: 'body' });
  store.ensureColumn({ name: 'cooldown', dtype: 'u16', category: 'body' });
  store.ensureColumn({ name: 'preyId', dtype: 'u32', category: 'body' });
  store.ensureColumn({ name: 'seeds', dtype: 'u8', category: 'body' });
  store.ensureColumn({ name: 'preyAgent', dtype: 'u32', category: 'body' });
  return store;
}

/** The store's columns as typed arrays. Columns can grow when groups are added, so call again after spawning. */
function columnsOf(store: EntityStore): Columns {
  const c = <T extends Uint8Array | Uint16Array | Uint32Array | Float32Array>(name: string) => store.column(name).data as T;
  return {
    kind: c<Uint8Array>('kind'),
    x: c<Float32Array>('x'),
    y: c<Float32Array>('y'),
    count: c<Uint16Array>('count'),
    condition: c<Float32Array>('condition'),
    targetX: c<Float32Array>('targetX'),
    targetY: c<Float32Array>('targetY'),
    mode: c<Uint8Array>('mode'),
    thirst: c<Float32Array>('thirst'),
    anchorX: c<Float32Array>('anchorX'),
    anchorY: c<Float32Array>('anchorY'),
    cooldown: c<Uint16Array>('cooldown'),
    preyId: c<Uint32Array>('preyId'),
    seeds: c<Uint8Array>('seeds'),
    hurt: c<Float32Array>('hurt'),
    preyAgent: c<Uint32Array>('preyAgent'),
  };
}

/** Add a group and return its slot. */
function addGroup(state: SimState, store: EntityStore, kind: number, x: number, y: number, count: number, condition: number): number {
  const slot = spawnEntity(state, store);
  const c = columnsOf(store);
  c.kind[slot] = kind;
  c.x[slot] = x;
  c.y[slot] = y;
  c.targetX[slot] = x;
  c.targetY[slot] = y;
  c.anchorX[slot] = x;
  c.anchorY[slot] = y;
  c.count[slot] = count;
  c.condition[slot] = condition;
  c.mode[slot] = AnimalMode.REST;
  c.thirst[slot] = 0;
  c.cooldown[slot] = 0;
  c.preyId[slot] = 0;
  c.seeds[slot] = 0;
  c.hurt[slot] = 0;
  c.preyAgent[slot] = 0;
  return slot;
}

/** Place a group (tests and experiments that need animals somewhere particular); returns its slot. */
export function placeGroup(sim: Sim, kind: number, x: number, y: number, count: number, condition: number): number {
  groupKind(kind);
  return addGroup(sim.state, sim.state.store(ANIMAL_STORE), kind, x, y, count, condition);
}

/** Km² of habitat: land counted in proportion to its forage, fully from `goodHabitatForageKgHa` (T-006). */
export function habitatKm2(sim: Sim): number {
  const world = sim.state.world;
  const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const graze = world.layer<Float32Array>(FORAGE_LAYER);
  const browse = world.layer<Float32Array>(BROWSE_LAYER);
  const cs = sim.config.world.cellSizeM;
  const good = (A.goodHabitatForageKgHa * cs * cs) / 10_000;
  let cells = 0;
  for (let k = 0; k < kind.length; k++) {
    if (kind[k] !== Water.DRY) continue;
    const share = (graze[k] + browse[k]) / good;
    cells += share < 1 ? share : 1;
  }
  return (cells * cs * cs) / 1e6;
}

/** Is there a group of this kind with its anchor within `radius` of (x, y)? */
function anchorNear(store: EntityStore, kind: number, x: number, y: number, radius: number): boolean {
  const c = columnsOf(store);
  const r2 = radius * radius;
  for (let slot = 0; slot < store.highWater; slot++) {
    if (!store.isAlive(slot) || c.kind[slot] !== kind) continue;
    const dx = c.anchorX[slot] - x;
    const dy = c.anchorY[slot] - y;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}

/** Setup: place the starting animals (docs/DESIGN.md §2.13). Draws only from the world-generation stream. */
function startAnimals(sim: Sim): void {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const N = W * H;
  const s = state.streams;
  const o = globalStreamOffset(StreamDomain.WORLD_GEN);
  const world = state.world;
  const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const graze = world.layer<Float32Array>(FORAGE_LAYER);
  const browse = world.layer<Float32Array>(BROWSE_LAYER);
  const forage = new Float32Array(N);
  for (let k = 0; k < N; k++) forage[k] = graze[k] + browse[k];
  const hare = world.layer<Float32Array>(HARE_LAYER);
  const store = state.store(ANIMAL_STORE);
  const counts = state.parts.find((p) => p.name === ANIMAL_PARTS.counts) as AnimalCounts;
  const km2 = habitatKm2(sim);
  if (km2 <= 0) return;

  let fmax = 0;
  for (let k = 0; k < N; k++) if (kind[k] === Water.DRY && forage[k] > fmax) fmax = forage[k];
  const good = (A.goodHabitatForageKgHa * cs * cs) / 10_000;

  // Hares in proportion to forage against the good-habitat yardstick, up to twice the density.
  const harePerCell = (HARE.startPerKm2 * cs * cs) / 1e6;
  for (let k = 0; k < N; k++) {
    if (kind[k] !== Water.DRY) continue;
    const share = forage[k] / good;
    hare[k] = harePerCell * (share < 2 ? share : 2);
  }

  /** A random land cell, accepted in proportion to its forage (or any land cell if `byForage` is false). */
  const pickCell = (byForage: boolean): number => {
    for (let tries = 0; tries < 10_000; tries++) {
      const k = Math.floor(nextFloat(s, o) * N);
      if (kind[k] !== Water.DRY) continue;
      if (!byForage || fmax <= 0 || nextFloat(s, o) * fmax < forage[k]) return k;
    }
    return -1;
  };
  const centre = (k: number) => [((k % W) + nextFloat(s, o)) * cs, (Math.floor(k / W) + nextFloat(s, o)) * cs] as const;

  for (const spec of GROUP_KINDS) {
    let animals = Math.round(spec.startPerKm2 * km2);
    const spacing = spec.kind === AnimalKind.WOLF ? A.wolfPackSpacingM : spec.kind === AnimalKind.CAT ? A.catSpacingM : 0;
    let failures = 0;
    while (animals > 0 && failures < 200) {
      const size = spec.typicalGroup === 1 ? 1 : Math.max(1, Math.min(animals, Math.round(spec.typicalGroup * (0.5 + nextFloat(s, o)))));
      const k = pickCell(true);
      if (k < 0) break;
      const [x, y] = centre(k);
      if (spacing > 0 && anchorNear(store, spec.kind, x, y, spacing)) {
        failures++;
        continue;
      }
      const slot = addGroup(state, store, spec.kind, x, y, size, 0.8);
      columnsOf(store).thirst[slot] = Math.floor(nextFloat(s, o) * 12);
      animals -= size;
    }
  }
  counts.values[F.vultures] = Math.max(A.leastVultures, Math.round(A.vulturesPerKm2 * km2));
}

// ALIBI: grazers seek food, water and comfortable warmth; predators hunt when hungry and rest when fed;
// scavengers eat what dies; animals keep away from fire, which burns them. All of it happens whether
// or not anyone ever watches or hunts.
export const animals: SystemDef = defineSystem({
  name: 'world.animals',
  declare(state: SimState) {
    declareStore(state);
    state.addPart(new AnimalCounts());
    state.addPart(new AnimalBites());
    state.world.ensureLayer(HARE_LAYER, 'f32');
    state.world.ensureLayer(CARCASS_LAYER, 'f32');
    state.world.ensureLayer(CARCASS_LOAD_LAYER, 'f32');
    // Read from the landscape, the climate and the plants, which run first.
    state.world.ensureLayer(TERRAIN_LAYERS.elevation, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.waterKind, 'u8');
    state.world.ensureLayer(FORAGE_LAYER, 'f32');
    state.world.ensureLayer(BROWSE_LAYER, 'f32');
    state.world.ensureLayer(SEED_RAIN_LAYER, 'u8');
  },
  init: startAnimals,
  create(sim: Sim) {
    const { config, state } = sim;
    const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
    const N = W * H;
    const widthM = W * cs;
    const heightM = H * cs;
    const ticksPerDay = config.time.ticksPerDay;
    const ticksPerHour = ticksPerDay / 24;
    const s = state.streams;
    const o = globalStreamOffset(StreamDomain.ECOLOGY);
    const world = state.world;
    const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const waterKind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    const forage = world.layer<Float32Array>(FORAGE_LAYER);
    const browse = world.layer<Float32Array>(BROWSE_LAYER);
    const seedRain = world.layer<Uint8Array>(SEED_RAIN_LAYER);
    const hare = world.layer<Float32Array>(HARE_LAYER);
    const carcass = world.layer<Float32Array>(CARCASS_LAYER);
    const carcassLoad = world.layer<Float32Array>(CARCASS_LOAD_LAYER);
    /** Fresh meat into a cell: the cell's pathogen load is diluted by weight (§2.14). */
    function addMeat(k: number, kg: number): void {
      const before = carcass[k];
      carcassLoad[k] = dilutedLoad(carcassLoad[k], before, kg);
      carcass[k] = before + kg;
    }
    const cover = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
    const areaHa = (cs * cs) / 10_000;
    const grazeFloorPerCover = PLANT_SPECIES.map((sp) => (sp.forageKind === 'graze' ? sp.forageKgHa * areaHa * PLANT_CONSTANTS.ungrazableShare : 0));
    const browseFloorPerCover = PLANT_SPECIES.map((sp) => (sp.forageKind === 'browse' ? sp.forageKgHa * areaHa * PLANT_CONSTANTS.ungrazableShare : 0));
    /** Forage of one kind in cell k that animals can reach: everything above the ungrazable base. */
    function reachable(pool: Float32Array, perCover: number[], k: number): number {
      let floor = 0;
      for (let sp = 0; sp < perCover.length; sp++) if (perCover[sp] > 0) floor += cover[sp][k] * perCover[sp];
      const r = pool[k] - floor;
      return r > 0 ? r : 0;
    }
    const coverIndex = (name: string) => PLANT_SPECIES.findIndex((sp) => sp.name === name);
    const reedCover = cover[coverIndex('reed')];
    const nutCover = cover[coverIndex('nut')];
    const berryCover = cover[coverIndex('berry')];
    const grassCover = cover[coverIndex('grass')];
    const store = state.store(ANIMAL_STORE);
    const counts = (state.parts.find((p) => p.name === ANIMAL_PARTS.counts) as AnimalCounts).values;
    const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weather || !weather.readings) throw new Error('world.animals needs world.climate earlier in the pipeline.');
    const weatherValues = weather.readings();
    const lapse = CLIMATE_CONSTANTS.lapseRatePerM;
    const reference = CLIMATE_CONSTANTS.referenceElevationM;
    const specOf: GroupKind[] = [];
    for (const spec of GROUP_KINDS) specOf[spec.kind] = spec;
    /** Share of a wound from persons' blows left after a day (§2.17). */
    const hurtKeep = exp(-0.6931471805599453 / E.healHalfDays);

    // Fire (§2.16), if the pipeline has it: every animal keeps away from a burning cell, predators from any fire.
    const fireStore = state.stores.find((st) => st.name === FIRE_STORE) ?? null;
    const fireStage = fireStore ? world.layer<Uint8Array>(FIRE_LAYERS.stage) : null;
    const firePoints = fireStore ? new FirePoints(sim) : null;
    let fireNow = false;
    /** The fire a group of `kind` at (x, y) is too close to, or -1. */
    function fireTooClose(kind: number, x: number, y: number): number {
      if (!fireNow || firePoints === null) return -1;
      const predator = kind === AnimalKind.WOLF || kind === AnimalKind.CAT;
      return firePoints.tooClose(x, y, predator ? 0 : FIRE_CONSTANTS.everyAnimalAvoidsKw);
    }
    /** Move away from fire point p, running from a big fire, walking from a small one. */
    function leaveFire(slot: number, p: number): void {
      const points = firePoints as FirePoints;
      const dx = c.x[slot] - points.x[p];
      const dy = c.y[slot] - points.y[p];
      const d = Math.sqrt(dx * dx + dy * dy);
      const [ux, uy] = d > 0 ? [dx / d, dy / d] : anyDirection();
      const away = 2 * avoidDistanceM(points.kw[p]) + 200;
      setTarget(slot, c.x[slot] + ux * away, c.y[slot] + uy * away, points.kw[p] >= A.runFromFireKw ? AnimalMode.FLEE : AnimalMode.MOVE);
    }
    /** Hares and carcass meat in flaming cells. */
    function burnInCells(): void {
      const store = fireStore as EntityStore;
      const stageOf = fireStage as Uint8Array;
      const cells = store.column<Int32Array>('cell').data;
      for (let slot = 0; slot < store.highWater; slot++) {
        if (store.alive.data[slot] !== 1) continue;
        const k = cells[slot];
        if (stageOf[k] !== FireStage.FLAMING) continue;
        if (carcass[k] > 0) {
          carcass[k] *= 1 - A.carcassBurntPerTick;
          carcassLoad[k] *= A.carcassLoadLeftPerTick;
        }
        const dead = hare[k] * A.hareFireDeathsPerTick;
        if (dead > 0) {
          hare[k] -= dead;
          counts[F.deathsHare] += dead;
          addMeat(k, dead * HARE.edibleKg);
        }
      }
    }

    // Derived from the landscape; built on the first run, never saved (docs/DESIGN.md §1.5).
    let waterDist = new Uint16Array(0);
    /** For each cell, the neighbouring cell one step closer to open water over land. */
    let towardWater = new Int32Array(0);
    function buildWaterField(): void {
      waterDist = new Uint16Array(N).fill(65535);
      towardWater = new Int32Array(N).fill(-1);
      const queue = new Int32Array(N);
      let head = 0;
      let tail = 0;
      for (let k = 0; k < N; k++) {
        if (waterKind[k] !== Water.DRY) {
          waterDist[k] = 0;
          towardWater[k] = k;
          queue[tail++] = k;
        }
      }
      while (head < tail) {
        const k = queue[head++];
        const i = k % W;
        const j = (k - i) / W;
        const next = waterDist[k] + 1;
        const visit = (n: number) => {
          if (waterDist[n] <= next) return;
          waterDist[n] = next;
          towardWater[n] = k;
          queue[tail++] = n;
        };
        if (i > 0) visit(k - 1);
        if (i < W - 1) visit(k + 1);
        if (j > 0) visit(k - W);
        if (j < H - 1) visit(k + W);
      }
    }

    const herbGrid = new BucketGrid(widthM, heightM, 1000);
    const predGrid = new BucketGrid(widthM, heightM, 1000);
    let herbMask = new Uint8Array(256);
    let predMask = new Uint8Array(256);
    let c = columnsOf(store);

    const cellAt = (x: number, y: number): number => {
      let i = Math.floor(x / cs);
      let j = Math.floor(y / cs);
      if (i < 0) i = 0;
      else if (i >= W) i = W - 1;
      if (j < 0) j = 0;
      else if (j >= H) j = H - 1;
      return j * W + i;
    };
    const temperatureAt = (atReference: number, k: number) => atReference - lapse * (elevation[k] - reference);
    const isNight = (tick: number) => sunlight(config, tick) < A.nightBelowSunlight;
    const inBirthSeason = (season: number, start: number, end: number) => season >= start && season < end;
    const random = () => nextFloat(s, o);
    const chance = (p: number) => nextChance(s, o, p);
    const clampX = (x: number) => (x < 0 ? 0 : x >= widthM ? widthM - 0.01 : x);
    const clampY = (y: number) => (y < 0 ? 0 : y >= heightM ? heightM - 0.01 : y);
    /**
     * A unit vector in a random direction: the way an animal bolts from something at its own
     * position, where "away" has no direction (T-009; it was due east, which trapped deer).
     */
    const anyDirection = (): [number, number] => {
      const turn = random();
      return [cosTurn(turn), sinTurn(turn)];
    };

    function tallCover(k: number, season: number): number {
      return tallCoverOf(season, grassCover[k], berryCover[k], nutCover[k], reedCover[k]);
    }

    function buildGrids(): void {
      const hw = store.highWater;
      if (herbMask.length < hw) {
        let n = herbMask.length;
        while (n < hw) n *= 2;
        herbMask = new Uint8Array(n);
        predMask = new Uint8Array(n);
      }
      for (let slot = 0; slot < hw; slot++) {
        const alive = store.isAlive(slot);
        const grazer = alive && (c.kind[slot] === AnimalKind.DEER || c.kind[slot] === AnimalKind.AUROCHS);
        herbMask[slot] = grazer ? 1 : 0;
        predMask[slot] = alive && !grazer ? 1 : 0;
      }
      herbGrid.build(c.x, c.y, herbMask, hw);
      predGrid.build(c.x, c.y, predMask, hw);
    }

    /** The nearest group of `kind` within `radius`, or -1. Ties go to the lower slot. */
    function nearest(grid: BucketGrid, x: number, y: number, radius: number, kind: number, exclude: number): number {
      const n = grid.query(x, y, radius, c.x, c.y);
      let best = -1;
      let bestD = Infinity;
      for (let q = 0; q < n; q++) {
        const slot = grid.result[q];
        if (slot === exclude || c.kind[slot] !== kind || c.count[slot] === 0) continue;
        const dx = c.x[slot] - x;
        const dy = c.y[slot] - y;
        const d = dx * dx + dy * dy;
        if (d < bestD || (d === bestD && slot < best)) {
          bestD = d;
          best = slot;
        }
      }
      return best;
    }

    function setTarget(slot: number, x: number, y: number, mode: number): void {
      c.targetX[slot] = clampX(x);
      c.targetY[slot] = clampY(y);
      c.mode[slot] = mode;
    }

    function flee(slot: number, fromX: number, fromY: number): void {
      leave(slot, fromX, fromY, A.fleeM, AnimalMode.FLEE);
    }

    /** Head `far` metres away from (fromX, fromY), in a random direction from that very point (T-009). */
    function leave(slot: number, fromX: number, fromY: number, far: number, mode: number): void {
      const dx = c.x[slot] - fromX;
      const dy = c.y[slot] - fromY;
      const d = Math.sqrt(dx * dx + dy * dy);
      const [ux, uy] = d > 0 ? [dx / d, dy / d] : anyDirection();
      setTarget(slot, c.x[slot] + ux * far, c.y[slot] + uy * far, mode);
    }

    // ---- persons (§2.17): bodies with a sex, as animals see them at the end of the last tick ----

    const agents = state.agents;
    const personGrid = new BucketGrid(widthM, heightM, 500);
    let personMask = new Uint8Array(64);
    let personsN = 0;
    let personX: Float64Array = new Float64Array(0);
    let personY: Float64Array = new Float64Array(0);
    let personLean: Float64Array = new Float64Array(0);
    let personMobility: Float64Array | null = null;
    let personMoved: Float64Array | null = null;
    let personIds: Uint32Array = new Uint32Array(0);
    /** 200 m squares with a person in or next to them this tick (§2.17). The most any animal notices from is 100 m. */
    const MARK_M = 200;
    const markW = Math.ceil(widthM / MARK_M);
    const markH = Math.ceil(heightM / MARK_M);
    const marks = new Uint8Array(markW * markH);
    let marked = new Int32Array(64);
    let markedN = 0;
    for (const d of [...E.shyDayM, ...E.shyNightM]) if (d > MARK_M) throw new Error('world.animals: a flight distance is longer than the squares that mark persons.');
    /** Results of a person query, copied out so a nested query can run. */
    let found = new Int32Array(64);
    const bites = state.parts.find((p) => p.name === ANIMAL_PARTS.bites) as AnimalBites;

    /** Index the persons; returns how many there are. Nothing about persons runs when there are none. */
    function indexPersons(): number {
      personsN = 0;
      if (agents.count === 0 || !agents.hasColumn('sex') || !agents.hasColumn('leanKg')) return 0;
      const hw = agents.highWater;
      if (personMask.length < hw) {
        let n = personMask.length;
        while (n < hw) n *= 2;
        personMask = new Uint8Array(n);
      }
      const alive = agents.alive.data;
      const sex = agents.column<Uint8Array>('sex').data;
      for (let slot = 0; slot < hw; slot++) {
        const on = alive[slot] === 1 && sex[slot] !== 0 ? 1 : 0;
        personMask[slot] = on;
        personsN += on;
      }
      if (personsN === 0) return 0;
      personX = agents.column<Float64Array>('x').data;
      personY = agents.column<Float64Array>('y').data;
      personLean = agents.column<Float64Array>('leanKg').data;
      personMobility = agents.hasColumn('mobility') ? agents.column<Float64Array>('mobility').data : null;
      personMoved = agents.hasColumn(MOVED_TICK_COLUMN) ? agents.column<Float64Array>(MOVED_TICK_COLUMN).data : null;
      personIds = agents.id.data;
      personGrid.build(personX, personY, personMask, hw);
      markPersons();
      return personsN;
    }

    /** Copy the persons within `radius` of (x, y) into `found`; returns how many. */
    function personsWithin(x: number, y: number, radius: number): number {
      const n = personGrid.query(x, y, radius, personX, personY);
      if (found.length < n) found = new Int32Array(personGrid.result.length);
      for (let q = 0; q < n; q++) found[q] = personGrid.result[q];
      return n;
    }

    /** Is person p without company: no other person of `companyLeanKg` or more within `radius`? */
    function alone(p: number, radius: number): boolean {
      const n = personGrid.query(personX[p], personY[p], radius, personX, personY);
      const r = personGrid.result;
      for (let q = 0; q < n; q++) {
        const o = r[q];
        if (o !== p && personLean[o] >= E.companyLeanKg) return false;
      }
      return true;
    }

    /**
     * The nearest person within `radius` of (x, y) that a hungry predator of `kind` would take: alone,
     * not near a fire, and for wolves small or lame. -1 for none; ties go to the lower slot.
     */
    function personPrey(kind: number, x: number, y: number, radius: number): number {
      const n = personsWithin(x, y, radius);
      const wolf = kind === AnimalKind.WOLF;
      let best = -1;
      let bestD = Infinity;
      for (let q = 0; q < n; q++) {
        const p = found[q];
        const dx = personX[p] - x;
        const dy = personY[p] - y;
        const d = dx * dx + dy * dy;
        if (d > bestD || (d === bestD && p > best)) continue;
        // Mobility is 0 only before body.injury has first seen a body: that is not a limp.
        if (wolf && !(personLean[p] < E.wolfPreyLeanKg || (personMobility !== null && personMobility[p] > 0 && personMobility[p] < E.lameBelow))) continue;
        if (fireTooClose(kind, personX[p], personY[p]) >= 0) continue;
        if (!alone(p, wolf ? E.wolfAloneM : E.catAloneM)) continue;
        best = p;
        bestD = d;
      }
      return best;
    }

    /** Squared distance from group `slot` to person p. */
    function d2To(slot: number, p: number): number {
      const dx = personX[p] - c.x[slot];
      const dy = personY[p] - c.y[slot];
      return dx * dx + dy * dy;
    }

    /** The share of its distance at which an animal notices person p now (§2.17). */
    function noticeOf(p: number, season: number): number {
      const moving = personMoved === null || personMoved[p] > E.movingFromM;
      // Grass, even tall, hides only a body keeping low: one walking upright shows above it.
      const k = cellAt(personX[p], personY[p]);
      const tall = tallCoverOf(season, moving ? 0 : grassCover[k], berryCover[k], nutCover[k], reedCover[k]);
      return noticeFactor(moving, tall / A.ambushCover);
    }

    /** Mark the 200 m squares each person stands in, and their neighbours (derived each tick, never saved). */
    function markPersons(): void {
      for (let m = 0; m < markedN; m++) marks[marked[m]] = 0;
      markedN = 0;
      const hwA = agents.highWater;
      for (let p = 0; p < hwA; p++) {
        if (personMask[p] !== 1) continue;
        const i0 = Math.floor(personX[p] / MARK_M);
        const j0 = Math.floor(personY[p] / MARK_M);
        for (let j = j0 - 1; j <= j0 + 1; j++) {
          if (j < 0 || j >= markH) continue;
          for (let i = i0 - 1; i <= i0 + 1; i++) {
            if (i < 0 || i >= markW) continue;
            const m = j * markW + i;
            if (marks[m] !== 0) continue;
            marks[m] = 1;
            if (markedN === marked.length) {
              const bigger = new Int32Array(marked.length * 2);
              bigger.set(marked);
              marked = bigger;
            }
            marked[markedN++] = m;
          }
        }
      }
    }

    /**
     * A group that notices a person leaves the nearest such person (ties: the lower slot), unless it
     * is running already, standing its ground, or a hungry predator. Called only for groups in a
     * marked square (the tick's loop looks the square up).
     */
    function keepAway(slot: number, night: boolean, season: number): void {
      if (c.mode[slot] === AnimalMode.FLEE) return;
      const kind = c.kind[slot];
      if (kind === AnimalKind.AUROCHS && c.cooldown[slot] > 0) return;
      if ((kind === AnimalKind.WOLF || kind === AnimalKind.CAT) && c.condition[slot] < A.hungryBelow) return;
      const gx = c.x[slot];
      const gy = c.y[slot];
      const reach = (night ? E.shyNightM : E.shyDayM)[kind];
      const n = personGrid.query(gx, gy, reach, personX, personY);
      const r = personGrid.result;
      let best = -1;
      let bestD = Infinity;
      for (let q = 0; q < n; q++) {
        const p = r[q];
        const dx = gx - personX[p];
        const dy = gy - personY[p];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > reach || d > bestD || (d === bestD && p > best)) continue;
        if (d > reach * noticeOf(p, season)) continue;
        best = p;
        bestD = d;
      }
      if (best < 0) return;
      leave(slot, personX[best], personY[best], E.leaveM[kind], E.leaveRuns[kind] ? AnimalMode.FLEE : AnimalMode.MOVE);
    }

    /** Write a wound an animal of `kind` deals to person p, drawing whether it breaks a bone. */
    function wound(p: number, w: AnimalWound, kind: number): void {
      const broken = w.breakChance > 0 && chance(w.breakChance) ? w.breakShare : 0;
      bites.push(personIds[p], w, w.leg ? broken : 0, w.leg ? 0 : broken, kind);
      counts[F.bitesToPersons] += 1;
    }

    /** A landed attack on person p by group `slot`: a hold, or a mauling (§2.17). Returns true for a hold. */
    function attackPerson(slot: number, p: number): boolean {
      const kind = c.kind[slot];
      const wolves = kind === AnimalKind.WOLF;
      const held = chance(holdChance(kind, c.count[slot], personLean[p]));
      if (wolves) for (let w = 0; w < c.count[slot]; w++) wound(p, E.wolfBite, kind);
      else if (!held) for (let b = 0; b < E.catMaulBites; b++) wound(p, E.catBite, kind);
      if (held) {
        wound(p, E.hold, kind);
        counts[F.holdsPerson] += 1;
      }
      const x = personX[p];
      const y = personY[p];
      c.x[slot] = x;
      c.y[slot] = y;
      c.targetX[slot] = x;
      c.targetY[slot] = y;
      c.cooldown[slot] = A.restTicks;
      c.preyAgent[slot] = 0;
      if (held) settle(slot, x, y);
      c.mode[slot] = held ? AnimalMode.FEED : AnimalMode.REST;
      return held;
    }

    /** Food that would bring a group to full condition, kg: animals eat no more than they can hold. */
    function room(slot: number, spec: GroupKind): number {
      const r = (1 - c.condition[slot]) * c.count[slot] * spec.needKgPerDay * spec.reserveDays;
      return r > 0 ? r : 0;
    }

    function feed(slot: number, k: number): number {
      const spec = specOf[c.kind[slot]];
      if (carcass[k] <= 0 || c.condition[slot] >= 1) return 0;
      const meal = c.count[slot] * A.mealKgPerHour;
      const space = room(slot, spec);
      const want = meal < space ? meal : space;
      const eaten = carcass[k] < want ? carcass[k] : want;
      carcass[k] -= eaten;
      counts[F.meatToPredators] += eaten;
      gain(slot, eaten, spec);
      return eaten;
    }

    function gain(slot: number, kg: number, spec: GroupKind): void {
      let cond = c.condition[slot] + kg / (c.count[slot] * spec.needKgPerDay * spec.reserveDays);
      if (cond > 1) cond = 1;
      c.condition[slot] = cond;
    }

    /** Catch a hare from the 3 × 3 cells around k, with a chance that grows with the hares there. */
    function catchHare(slot: number, k: number, perHare: number, cap: number, field: number): void {
      const i0 = k % W;
      const j0 = (k - i0) / W;
      let total = 0;
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        if (j < 0 || j >= H) continue;
        for (let i = i0 - 1; i <= i0 + 1; i++) if (i >= 0 && i < W) total += hare[j * W + i];
      }
      if (total < 1) return;
      const p = perHare * total;
      if (!chance(p < cap ? p : cap)) return;
      // One hare, taken from the nine cells in proportion to the hares in each.
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        if (j < 0 || j >= H) continue;
        for (let i = i0 - 1; i <= i0 + 1; i++) if (i >= 0 && i < W) hare[j * W + i] -= hare[j * W + i] / total;
      }
      counts[field] += 1;
      counts[F.meatToPredators] += HARE.edibleKg;
      gain(slot, HARE.edibleKg, specOf[c.kind[slot]]);
    }

    /** A predator's range drifts toward where it kills. */
    function settle(slot: number, x: number, y: number): void {
      c.anchorX[slot] = 0.8 * c.anchorX[slot] + 0.2 * x;
      c.anchorY[slot] = 0.8 * c.anchorY[slot] + 0.2 * y;
    }

    function killOne(prey: number, field: number): void {
      const k = cellAt(c.x[prey], c.y[prey]);
      addMeat(k, specOf[c.kind[prey]].edibleKg);
      counts[field] += 1;
      c.count[prey] -= 1;
      if (c.count[prey] === 0) store.remove(prey);
    }

    // ---- hourly decisions ----

    function placeScore(cell: number, dayNeed: number, spec: GroupKind, atReference: number): number {
      const comfortC = spec.comfortC;
      const grass = reachable(forage, grazeFloorPerCover, cell);
      const food = (spec.browses ? reachable(browse, browseFloorPerCover, cell) + grass * spec.grassShareMax : grass) / dayNeed;
      const warmth = temperatureAt(atReference, cell) - comfortC;
      return (food < 2 ? food : 2) / 2 - (warmth < 0 ? -warmth : warmth) / 10;
    }

    function placeScoreFood(cell: number, spec: GroupKind): number {
      const grass = reachable(forage, grazeFloorPerCover, cell);
      return spec.browses ? reachable(browse, browseFloorPerCover, cell) + grass * spec.grassShareMax : grass;
    }

    function decideGrazer(slot: number, hour: number, atReference: number, night: boolean): void {
      const spec = specOf[c.kind[slot]];
      const k = cellAt(c.x[slot], c.y[slot]);
      const n = c.count[slot];
      // Eat: up to an hour's need, half as much again while below full condition.
      const hourNeed = (n * spec.needKgPerDay) / 24;
      const extra = room(slot, spec);
      const want = hourNeed + (extra < hourNeed * 0.5 ? extra : hourNeed * 0.5);
      // Browsers take leaves and shoots first, then grass for the rest, up to their limit.
      let eaten = 0;
      if (spec.browses) {
        const b = reachable(browse, browseFloorPerCover, k);
        eaten = b < want ? b : want;
        browse[k] -= eaten;
      }
      let rest = want - eaten;
      const grassCap = want * spec.grassShareMax;
      if (rest > grassCap) rest = grassCap;
      const g = reachable(forage, grazeFloorPerCover, k);
      const grazed = g < rest ? g : rest;
      forage[k] -= grazed;
      eaten += grazed;
      gain(slot, eaten, spec);
      // Seeds eaten earlier are dropped here; seeds of what grows here are picked up.
      if (c.seeds[slot] !== 0) seedRain[k] |= c.seeds[slot];
      if (eaten > 0) {
        for (const sp of CARRIED_SEEDS) if (cover[sp][k] > 0.05) c.seeds[slot] |= 1 << sp;
      }
      // Drink.
      if (waterDist[k] <= 1) c.thirst[slot] = 0;
      else c.thirst[slot] += 1;
      // Deer that notice a wolf pack run.
      if (c.kind[slot] === AnimalKind.DEER) {
        const wolf = nearest(predGrid, c.x[slot], c.y[slot], night ? A.deerDetectNightM : A.deerDetectDayM, AnimalKind.WOLF, -1);
        if (wolf >= 0) {
          flee(slot, c.x[wolf], c.y[wolf]);
          return;
        }
      }
      if (c.mode[slot] === AnimalMode.FLEE) return;
      // Thirsty: follow the shortest way over land toward water, a stretch at a time.
      if (c.thirst[slot] >= A.thirstyAfterHours && towardWater[k] >= 0) {
        let w = k;
        for (let step = 0; step < 12 && waterDist[w] > 1; step++) w = towardWater[w];
        setTarget(slot, ((w % W) + 0.5) * cs, (Math.floor(w / W) + 0.5) * cs, AnimalMode.MOVE);
        return;
      }
      // Otherwise, when food here is short (or now and then, to follow the warmth),
      // compare a few nearby spots by food and warmth.
      const dayNeed = n * spec.needKgPerDay;
      if (placeScoreFood(k, spec) > 2 * dayNeed && (hour + slot) % 4 !== 0) {
        if (c.mode[slot] !== AnimalMode.MOVE) c.mode[slot] = AnimalMode.REST;
        return;
      }
      let best = -1;
      let bestScore = placeScore(k, dayNeed, spec, atReference) + 0.1;
      // Hungry animals range farther (T-006).
      const reach = c.condition[slot] < A.hungryBelow ? A.hungryGrazeSearchM : A.grazeSearchM;
      for (let t = 0; t < 5; t++) {
        const px = clampX(c.x[slot] + (random() * 2 - 1) * reach);
        const py = clampY(c.y[slot] + (random() * 2 - 1) * reach);
        const cell = cellAt(px, py);
        if (waterKind[cell] !== Water.DRY || fireTooClose(c.kind[slot], px, py) >= 0) continue;
        const sc = placeScore(cell, dayNeed, spec, atReference);
        if (sc > bestScore) {
          bestScore = sc;
          best = cell;
          c.targetX[slot] = px;
          c.targetY[slot] = py;
        }
      }
      c.mode[slot] = best >= 0 ? AnimalMode.MOVE : AnimalMode.REST;
    }

    function decideWolf(slot: number): void {
      const k = cellAt(c.x[slot], c.y[slot]);
      if (feed(slot, k) > 0) {
        c.mode[slot] = AnimalMode.FEED;
        return;
      }
      if (c.condition[slot] < A.hungryBelow && c.cooldown[slot] === 0) {
        let prey = nearest(herbGrid, c.x[slot], c.y[slot], A.wolfSearchM, AnimalKind.DEER, -1);
        if (prey < 0 && c.count[slot] >= A.wolvesNeededForAurochs) {
          prey = nearest(herbGrid, c.x[slot], c.y[slot], A.wolfSearchM, AnimalKind.AUROCHS, -1);
        }
        // Prey standing near a fire is left alone.
        if (prey >= 0 && fireTooClose(AnimalKind.WOLF, c.x[prey], c.y[prey]) >= 0) prey = -1;
        catchHare(slot, k, A.wolfHarePerHare, A.wolfHareCap, F.wolfKillsHare);
        // A lone person who is small or lame, if nearer than any deer (§2.17).
        const person = personsN > 0 ? personPrey(AnimalKind.WOLF, c.x[slot], c.y[slot], A.wolfSearchM) : -1;
        if (person >= 0 && (prey < 0 || c.kind[prey] !== AnimalKind.DEER || d2To(slot, person) < groupD2(slot, prey))) {
          c.preyAgent[slot] = personIds[person];
          c.preyId[slot] = 0;
          setTarget(slot, personX[person], personY[person], AnimalMode.HUNT);
          return;
        }
        if (prey >= 0) {
          c.preyAgent[slot] = 0;
          c.preyId[slot] = store.id.data[prey];
          setTarget(slot, c.x[prey], c.y[prey], AnimalMode.HUNT);
          return;
        }
        // Nothing near: search somewhere else in the range.
        setTarget(slot, c.anchorX[slot] + (random() * 2 - 1) * A.rangeM, c.anchorY[slot] + (random() * 2 - 1) * A.rangeM, AnimalMode.MOVE);
        return;
      }
      if (c.mode[slot] === AnimalMode.MOVE) return;
      const dx = c.x[slot] - c.anchorX[slot];
      const dy = c.y[slot] - c.anchorY[slot];
      if (dx * dx + dy * dy > (A.rangeM / 2) * (A.rangeM / 2)) setTarget(slot, c.anchorX[slot], c.anchorY[slot], AnimalMode.MOVE);
      else c.mode[slot] = AnimalMode.REST;
    }

    function decideCat(slot: number, night: boolean, season: number): void {
      const k = cellAt(c.x[slot], c.y[slot]);
      // A cat stays with its kill until the meat is gone.
      if (feed(slot, k) > 0 || carcass[k] > 0) {
        c.mode[slot] = AnimalMode.FEED;
        return;
      }
      const dx = c.x[slot] - c.anchorX[slot];
      const dy = c.y[slot] - c.anchorY[slot];
      if (dx * dx + dy * dy > A.rangeM * A.rangeM) {
        setTarget(slot, c.anchorX[slot], c.anchorY[slot], AnimalMode.MOVE);
        return;
      }
      const hungry = c.condition[slot] < A.hungryBelow;
      if (night && hungry) {
        catchHare(slot, k, A.catHarePerHare, A.catHareCap, F.catKillsHare);
        let prey = nearest(herbGrid, c.x[slot], c.y[slot], A.catSearchM, AnimalKind.DEER, -1);
        if (prey >= 0 && fireTooClose(AnimalKind.CAT, c.x[prey], c.y[prey]) >= 0) prey = -1;
        // A lone person, if nearer than any deer (§2.17).
        const person = personsN > 0 ? personPrey(AnimalKind.CAT, c.x[slot], c.y[slot], A.catSearchM) : -1;
        const onPerson = person >= 0 && (prey < 0 || d2To(slot, person) < groupD2(slot, prey));
        if (prey < 0 && !onPerson) {
          // Nothing near: search somewhere else in the range.
          setTarget(slot, c.anchorX[slot] + (random() * 2 - 1) * A.rangeM, c.anchorY[slot] + (random() * 2 - 1) * A.rangeM, AnimalMode.MOVE);
          return;
        }
        const tx = onPerson ? personX[person] : c.x[prey];
        const ty = onPerson ? personY[person] : c.y[prey];
        const pdx = tx - c.x[slot];
        const pdy = ty - c.y[slot];
        if (pdx * pdx + pdy * pdy <= A.ambushM * A.ambushM) {
          c.mode[slot] = AnimalMode.AMBUSH;
          return;
        }
        // Stalk: creep to the tallest cover within striking range of the prey.
        let bestCover = -1;
        const reach = A.ambushM * 0.7;
        for (let t = 0; t < 6; t++) {
          const px = clampX(tx + (random() * 2 - 1) * reach);
          const py = clampY(ty + (random() * 2 - 1) * reach);
          const cell = cellAt(px, py);
          if (waterKind[cell] !== Water.DRY || fireTooClose(AnimalKind.CAT, px, py) >= 0) continue;
          const tc = tallCover(cell, season);
          if (tc > bestCover) {
            bestCover = tc;
            c.targetX[slot] = px;
            c.targetY[slot] = py;
          }
        }
        c.mode[slot] = bestCover >= 0 ? AnimalMode.MOVE : AnimalMode.REST;
        return;
      }
      if (!night && tallCover(k, season) < A.ambushCover) {
        // Rest the day in cover.
        let bestCover = tallCover(k, season);
        let moved = false;
        for (let t = 0; t < 6; t++) {
          const px = clampX(c.x[slot] + (random() * 2 - 1) * 1000);
          const py = clampY(c.y[slot] + (random() * 2 - 1) * 1000);
          const cell = cellAt(px, py);
          if (waterKind[cell] !== Water.DRY || fireTooClose(AnimalKind.CAT, px, py) >= 0) continue;
          const tc = tallCover(cell, season);
          if (tc > bestCover) {
            bestCover = tc;
            c.targetX[slot] = px;
            c.targetY[slot] = py;
            moved = true;
          }
        }
        c.mode[slot] = moved ? AnimalMode.MOVE : AnimalMode.REST;
        return;
      }
      if (c.mode[slot] !== AnimalMode.MOVE) c.mode[slot] = AnimalMode.REST;
    }

    // ---- every tick ----

    function move(slot: number): void {
      const mode = c.mode[slot];
      if (mode === AnimalMode.REST || mode === AnimalMode.FEED || mode === AnimalMode.AMBUSH) return;
      const spec = specOf[c.kind[slot]];
      const kmh = mode === AnimalMode.FLEE || mode === AnimalMode.HUNT ? spec.runKmh : spec.walkKmh;
      const step = (kmh * 1000) / ticksPerHour;
      const dx = c.targetX[slot] - c.x[slot];
      const dy = c.targetY[slot] - c.y[slot];
      const d = Math.sqrt(dx * dx + dy * dy);
      let nx: number;
      let ny: number;
      if (d <= step) {
        nx = c.targetX[slot];
        ny = c.targetY[slot];
      } else {
        nx = c.x[slot] + (dx / d) * step;
        ny = c.y[slot] + (dy / d) * step;
      }
      nx = clampX(nx);
      ny = clampY(ny);
      if (waterKind[cellAt(nx, ny)] === Water.LAKE) {
        // Step sideways along the shore instead, left first.
        const sx = d > 0 ? -dy / d : 0;
        const sy = d > 0 ? dx / d : 0;
        const lx = clampX(c.x[slot] + sx * step);
        const ly = clampY(c.y[slot] + sy * step);
        const rx = clampX(c.x[slot] - sx * step);
        const ry = clampY(c.y[slot] - sy * step);
        if (waterKind[cellAt(lx, ly)] !== Water.LAKE) {
          nx = lx;
          ny = ly;
        } else if (waterKind[cellAt(rx, ry)] !== Water.LAKE) {
          nx = rx;
          ny = ry;
        } else {
          c.mode[slot] = AnimalMode.REST;
          return;
        }
      }
      c.x[slot] = nx;
      c.y[slot] = ny;
      if (d <= step && mode !== AnimalMode.HUNT) c.mode[slot] = AnimalMode.REST;
    }

    /** Squared distance between two groups. */
    function groupD2(a: number, b: number): number {
      const dx = c.x[b] - c.x[a];
      const dy = c.y[b] - c.y[a];
      return dx * dx + dy * dy;
    }

    /** A pack hunting a person runs it down; within reach it attacks, unless company or a fire is near (§2.17). */
    function chasePerson(slot: number): void {
      const p = personsN > 0 ? agents.slotOf(c.preyAgent[slot]) : -1;
      if (p < 0 || personMask[p] !== 1) {
        c.preyAgent[slot] = 0;
        c.mode[slot] = AnimalMode.REST;
        return;
      }
      const giveUp = () => {
        c.preyAgent[slot] = 0;
        c.cooldown[slot] = A.restTicks;
        c.mode[slot] = AnimalMode.REST;
      };
      if (fireTooClose(AnimalKind.WOLF, personX[p], personY[p]) >= 0) {
        giveUp();
        return;
      }
      c.targetX[slot] = personX[p];
      c.targetY[slot] = personY[p];
      if (d2To(slot, p) > A.chaseStartM * A.chaseStartM) return;
      if (!alone(p, E.wolfAloneM)) {
        giveUp();
        return;
      }
      counts[F.wolfAttacksPerson] += 1;
      attackPerson(slot, p);
    }

    function chase(slot: number): void {
      if (c.preyAgent[slot] !== 0) {
        chasePerson(slot);
        return;
      }
      const prey = store.slotOf(c.preyId[slot]);
      if (prey < 0 || !store.isAlive(prey) || c.count[prey] === 0) {
        c.mode[slot] = AnimalMode.REST;
        return;
      }
      // A chase is given up when the prey runs near a fire.
      if (fireTooClose(AnimalKind.WOLF, c.x[prey], c.y[prey]) >= 0) {
        c.mode[slot] = AnimalMode.REST;
        return;
      }
      c.targetX[slot] = c.x[prey];
      c.targetY[slot] = c.y[prey];
      const dx = c.x[prey] - c.x[slot];
      const dy = c.y[prey] - c.y[slot];
      if (dx * dx + dy * dy > A.chaseStartM * A.chaseStartM) return;
      counts[F.wolfChases] += 1;
      const pack = c.count[slot] / 4;
      const strength = pack < 1.5 ? pack : 1.5;
      const aurochs = c.kind[prey] === AnimalKind.AUROCHS;
      const p = aurochs ? (c.count[slot] >= A.wolvesNeededForAurochs ? A.wolfKillAurochs * strength : 0) : A.wolfKillDeer * strength;
      const px = c.x[prey];
      const py = c.y[prey];
      if (!aurochs) flee(prey, c.x[slot], c.y[slot]);
      c.cooldown[slot] = A.restTicks;
      if (chance(p)) {
        killOne(prey, aurochs ? F.wolfKillsAurochs : F.wolfKillsDeer);
        c.x[slot] = px;
        c.y[slot] = py;
        settle(slot, px, py);
        c.mode[slot] = AnimalMode.FEED;
      } else {
        c.mode[slot] = AnimalMode.REST;
      }
    }

    function ambush(slot: number, night: boolean, season: number): void {
      if (!night || c.cooldown[slot] > 0 || c.condition[slot] >= A.hungryBelow) return;
      let prey = nearest(herbGrid, c.x[slot], c.y[slot], A.ambushM, AnimalKind.DEER, -1);
      if (prey >= 0 && fireTooClose(AnimalKind.CAT, c.x[prey], c.y[prey]) >= 0) prey = -1;
      // A lone person within reach, if nearer than any deer, is struck instead (§2.17).
      const person = personsN > 0 ? personPrey(AnimalKind.CAT, c.x[slot], c.y[slot], A.ambushM) : -1;
      if (person >= 0 && (prey < 0 || d2To(slot, person) < groupD2(slot, prey))) {
        counts[F.catStrikesPerson] += 1;
        c.cooldown[slot] = A.restTicks;
        const cover = tallCover(cellAt(c.x[slot], c.y[slot]), season) / A.ambushCover;
        if (chance(A.catKillDeer * (A.openGroundShare + (1 - A.openGroundShare) * (cover < 1 ? cover : 1)))) {
          counts[F.catLandsPerson] += 1;
          attackPerson(slot, person);
        }
        return;
      }
      if (prey < 0) return;
      counts[F.catStrikes] += 1;
      c.cooldown[slot] = A.restTicks;
      const px = c.x[prey];
      const py = c.y[prey];
      // Tall cover lets a cat get close unseen; in the open it rarely succeeds.
      const hidden = tallCover(cellAt(c.x[slot], c.y[slot]), season) / A.ambushCover;
      if (chance(A.catKillDeer * (A.openGroundShare + (1 - A.openGroundShare) * (hidden < 1 ? hidden : 1)))) {
        flee(prey, c.x[slot], c.y[slot]);
        killOne(prey, F.catKillsDeer);
        counts[F.catKillsAtNight] += 1;
        c.x[slot] = px;
        c.y[slot] = py;
        settle(slot, px, py);
        c.mode[slot] = AnimalMode.FEED;
      } else {
        flee(prey, c.x[slot], c.y[slot]);
      }
    }

    // ---- daily ----

    /**
     * Hares in one quarter of the cells, with four days of change (the same 2 × 2 pattern
     * as the plants, §2.12): no two neighbouring cells update on the same day, so a cell
     * can send hares to its neighbours without the order of cells mattering.
     */
    function hares(season: number, quarter: number): void {
      const days = 4;
      const births = inBirthSeason(season, A.hareBirthStart, A.hareBirthEnd)
        ? (days * HARE.birthsPerRealYear) / (365 * (A.hareBirthEnd - A.hareBirthStart))
        : 0;
      const deaths = (days * HARE.deathsPerRealYear) / 365;
      const crowdingRate = (days * HARE.crowdingDeathsPerRealYear) / 365;
      const crowdingRef = (HARE.crowdingPerKm2 * cs * cs) / 1e6;
      const starving = days * HARE.starvationPerDay;
      const share = days * HARE.wanderPerDay;
      let born = 0;
      let died = 0;
      for (let j = quarter >> 1; j < H; j += 2) {
        for (let i = quarter & 1; i < W; i += 2) {
          const k = j * W + i;
          const n = hare[k];
          if (n <= 0) continue;
          const need = days * n * HARE.needKgPerDay;
          const g = reachable(forage, grazeFloorPerCover, k);
          const eaten = g < need ? g : need;
          forage[k] -= eaten;
          const fed = eaten / need;
          const b = n * births * fed;
          let d = n * (deaths + crowdingRate * (n / crowdingRef) + (1 - fed) * starving);
          if (d > n) d = n;
          born += b;
          died += d;
          addMeat(k, d * HARE.edibleKg);
          let next = n + b - d;
          // Wander to neighbouring land.
          const out = next * share;
          if (i > 0 && waterKind[k - 1] === Water.DRY) {
            hare[k - 1] += out;
            next -= out;
          }
          if (i < W - 1 && waterKind[k + 1] === Water.DRY) {
            hare[k + 1] += out;
            next -= out;
          }
          if (j > 0 && waterKind[k - W] === Water.DRY) {
            hare[k - W] += out;
            next -= out;
          }
          if (j < H - 1 && waterKind[k + W] === Water.DRY) {
            hare[k + W] += out;
            next -= out;
          }
          hare[k] = next < 1e-4 ? 0 : next;
        }
      }
      counts[F.birthsHare] += born;
      counts[F.deathsHare] += died;
    }

    function carcasses(atReference: number): void {
      let meat = 0;
      for (let k = 0; k < N; k++) meat += carcass[k];
      const pool = counts[F.vultures];
      const demand = pool * A.vultureMeatKgPerDay;
      let share = meat > 0 ? demand / meat : 0;
      if (share > A.vultureShareCap) share = A.vultureShareCap;
      let toVultures = 0;
      let rotted = 0;
      for (let k = 0; k < N; k++) {
        let m = carcass[k];
        if (m <= 0) continue;
        const v = m * share;
        m -= v;
        toVultures += v;
        const t = temperatureAt(atReference, k);
        const r = m * (A.rotPerDay + A.rotPerDayPerC * (t > 0 ? t : 0));
        m -= r;
        rotted += r;
        if (m < 0.1) {
          rotted += m;
          m = 0;
        }
        carcass[k] = m;
      }
      counts[F.meatToVultures] += toVultures;
      counts[F.meatRotted] += rotted;
      const fed = demand > 0 ? toVultures / demand : 0;
      const change = (A.vultureBirthsPerRealYear * fed - A.vultureDeathsPerRealYear - A.vultureHungerDeathsPerRealYear * (1 - fed)) / 365;
      const next = pool + pool * change;
      counts[F.vultures] = next < A.leastVultures ? A.leastVultures : next;
    }

    function lifeAndDeath(season: number): void {
      const breeding = inBirthSeason(season, A.birthStart, A.birthEnd);
      const windowShare = A.birthEnd - A.birthStart;
      const end = store.highWater;
      for (let slot = 0; slot < end; slot++) {
        if (!store.isAlive(slot)) continue;
        const spec = specOf[c.kind[slot]];
        const k = cellAt(c.x[slot], c.y[slot]);
        c.seeds[slot] = 0;
        // Wounds from persons' blows heal (§2.17).
        if (c.hurt[slot] > 0) c.hurt[slot] = c.hurt[slot] * hurtKeep < 1e-4 ? 0 : c.hurt[slot] * hurtKeep;
        // Deaths.
        const cond = c.condition[slot];
        const hunger = cond < A.starvingBelow ? (A.starvationHazardPerDay * (A.starvingBelow - cond)) / A.starvingBelow : 0;
        const hazard = spec.deathsPerRealYear / 365 + hunger;
        let died = 0;
        for (let a = c.count[slot]; a > 0; a--) if (chance(hazard)) died++;
        if (died > 0) {
          addMeat(k, died * spec.edibleKg);
          counts[DEATH_FIELD[spec.kind]] += died;
          if (hunger > 0) counts[F.hungerDeaths] += died;
          c.count[slot] -= died;
          if (c.count[slot] === 0) {
            store.remove(slot);
            continue;
          }
        }
        // Births.
        if (breeding && cond > A.breedAbove) {
          const p = (spec.birthsPerRealYear / (365 * windowShare)) * ((cond - A.breedAbove) / (1 - A.breedAbove));
          let born = 0;
          if (spec.oneLitterPerGroup) {
            // One litter for the group; a whole litter of p per day, drawn as whole young.
            let litter = p;
            while (litter >= 1) {
              born++;
              litter -= 1;
            }
            if (chance(litter)) born++;
          } else {
            for (let a = c.count[slot]; a > 0; a--) if (chance(p)) born++;
          }
          if (born > 0) {
            counts[BIRTH_FIELD[spec.kind]] += born;
            if (spec.kind === AnimalKind.CAT) {
              for (let b = 0; b < born; b++) disperse(slot, spec, 1, A.catDisperseNearM, A.catDisperseFarM, A.catSpacingM);
            } else {
              c.count[slot] = Math.min(65535, c.count[slot] + born);
            }
          }
        }
        // Too many: split, or send a few off to find room.
        if (c.count[slot] > spec.maxGroup) {
          if (spec.kind === AnimalKind.WOLF) {
            c.count[slot] -= A.wolvesThatDisperse;
            disperse(slot, spec, A.wolvesThatDisperse, A.wolfDisperseNearM, A.wolfDisperseFarM, A.wolfPackSpacingM);
          } else if (spec.grazer) {
            const half = Math.floor(c.count[slot] / 2);
            c.count[slot] -= half;
            const x = clampX(c.x[slot] + (random() * 2 - 1) * 150);
            const y = clampY(c.y[slot] + (random() * 2 - 1) * 150);
            const cond2 = c.condition[slot];
            addGroup(state, store, spec.kind, x, y, half, cond2);
            c = columnsOf(store);
          }
        }
      }
      // Tiny deer groups join a nearby one.
      buildGrids();
      for (let slot = 0; slot < store.highWater; slot++) {
        if (!store.isAlive(slot) || c.kind[slot] !== AnimalKind.DEER || c.count[slot] > 2) continue;
        const other = nearest(herbGrid, c.x[slot], c.y[slot], 300, AnimalKind.DEER, slot);
        if (other < 0 || c.count[other] + c.count[slot] > specOf[AnimalKind.DEER].maxGroup) continue;
        c.count[other] += c.count[slot];
        c.count[slot] = 0;
        store.remove(slot);
      }
    }

    /** Young animals look for room of their own; if none of a few spots is free, they don't survive. */
    function disperse(slot: number, spec: GroupKind, n: number, near: number, far: number, spacing: number): void {
      for (let t = 0; t < 4; t++) {
        const dx = (random() * 2 - 1) * far;
        const dy = (random() * 2 - 1) * far;
        const d2 = dx * dx + dy * dy;
        if (d2 < near * near || d2 > far * far) continue;
        const x = c.x[slot] + dx;
        const y = c.y[slot] + dy;
        if (x < 0 || y < 0 || x >= widthM || y >= heightM) continue;
        if (waterKind[cellAt(x, y)] !== Water.DRY) continue;
        if (anchorNear(store, spec.kind, x, y, spacing)) continue;
        addGroup(state, store, spec.kind, x, y, n, 0.6);
        c = columnsOf(store);
        return;
      }
    }

    return () => {
      const tick = state.tick;
      if (waterDist.length === 0) buildWaterField();
      const season = seasonFraction(config, tick);
      const atReference = dailyMeanTemperatureC(config, tick, weatherValues, reference);
      c = columnsOf(store);
      if (tick % ticksPerDay === 0) {
        hares(season, Math.floor(tick / ticksPerDay) % 4);
        carcasses(atReference);
        lifeAndDeath(season);
        c = columnsOf(store);
      }
      fireNow = firePoints !== null && firePoints.refresh() > 0;
      if (fireStore !== null && fireStore.count > 0) burnInCells();
      buildGrids();
      const night = isNight(tick);
      bites.clear();
      indexPersons();
      const hour = Math.floor(tick / ticksPerHour);
      const end = store.highWater;
      for (let slot = 0; slot < end; slot++) {
        if (!store.isAlive(slot)) continue;
        const kind = c.kind[slot];
        if ((tick + slot) % ticksPerHour === 0) {
          // An hour's hunger.
          const spec = specOf[kind];
          const cond = c.condition[slot] - 1 / (24 * spec.reserveDays);
          c.condition[slot] = cond > 0 ? cond : 0;
          if (spec.grazer) decideGrazer(slot, hour, atReference, night);
          else if (kind === AnimalKind.WOLF) decideWolf(slot);
          else decideCat(slot, night, season);
          if (!store.isAlive(slot)) continue;
        }
        if (c.cooldown[slot] > 0) c.cooldown[slot] -= 1;
        if (fireNow) {
          const p = fireTooClose(kind, c.x[slot], c.y[slot]);
          if (p >= 0) leaveFire(slot, p);
        }
        if (personsN > 0) {
          // Groups with no person in their 200 m square or the next cost one lookup (positions are never negative).
          const mi = (c.x[slot] / MARK_M) | 0;
          const mj = (c.y[slot] / MARK_M) | 0;
          if (marks[(mj < markH ? mj : markH - 1) * markW + (mi < markW ? mi : markW - 1)] !== 0) keepAway(slot, night, season);
        }
        if (kind === AnimalKind.WOLF && c.mode[slot] === AnimalMode.HUNT) chase(slot);
        else if (kind === AnimalKind.CAT && c.mode[slot] === AnimalMode.AMBUSH) ambush(slot, night, season);
        if (store.isAlive(slot)) move(slot);
      }
    };
  },
});

/** What a tick of blows on an animal did (§2.17). */
export interface StrikeOutcome {
  /** Blows that landed. */
  landed: number;
  /** An animal died of them; its meat lies in `cell`. */
  killed: boolean;
  cell: number;
  /** The group ran or walked off, or is gone: the striker cannot go on. */
  away: boolean;
}

/**
 * Persons' blows on an animal group (§2.17): up to `blows` blows of `joules` each, landing `precision` of
 * their energy, times (1 + edgeGain × edge). Wounds add up on the group's most-hurt animal, whoever deals
 * them; at a lethal total it dies and its meat lies in its cell. Then the group responds: deer run after
 * the first blow; an aurochs stands and may gore; a wolf or a cat may bite back, then leaves. Draws come
 * from the striker's stream (`s`, `o`); wounds dealt go to `animals.bites`, for body.injury this tick.
 */
export function strikeAnimal(
  sim: Sim,
  group: number,
  striker: number,
  joules: number,
  edge: number,
  precision: number,
  blows: number,
  s: Uint32Array,
  o: number,
  out: StrikeOutcome,
): void {
  const { config, state } = sim;
  const store = state.store(ANIMAL_STORE);
  out.landed = 0;
  out.killed = false;
  out.cell = -1;
  out.away = false;
  if (!store.isAlive(group) || blows <= 0) {
    out.away = !store.isAlive(group);
    return;
  }
  const c = columnsOf(store);
  const kind = c.kind[group];
  const spec = groupKind(kind);
  const counts = (state.parts.find((p) => p.name === ANIMAL_PARTS.counts) as AnimalCounts).values;
  const bites = bitesOf(state) as AnimalBites;
  const agents = state.agents;
  const strikerId = agents.id.data[striker];
  const sx = agents.column<Float64Array>('x').data[striker];
  const sy = agents.column<Float64Array>('y').data[striker];
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const per = (joules * precision * (1 + E.edgeGain * edge)) / (E.lethalJPerKg * spec.massKg);
  const most = kind === AnimalKind.AUROCHS ? blows : 1;
  for (let b = 0; b < most; b++) {
    out.landed++;
    counts[F.blowsByPersons] += 1;
    const hurt = c.hurt[group] + per;
    if (hurt < 1) {
      c.hurt[group] = hurt;
      continue;
    }
    // One animal dies of its wounds; its meat lies where it fell.
    let i = Math.floor(c.x[group] / cs);
    let j = Math.floor(c.y[group] / cs);
    i = i < 0 ? 0 : i >= W ? W - 1 : i;
    j = j < 0 ? 0 : j >= H ? H - 1 : j;
    const k = j * W + i;
    const meat = state.world.layer<Float32Array>(CARCASS_LAYER);
    const load = state.world.layer<Float32Array>(CARCASS_LOAD_LAYER);
    load[k] = dilutedLoad(load[k], meat[k], spec.edibleKg);
    meat[k] += spec.edibleKg;
    counts[KILLED_BY_PERSONS[kind]] += 1;
    counts[DEATH_FIELD[kind]] += 1;
    out.killed = true;
    out.cell = k;
    c.hurt[group] = 0;
    c.count[group] -= 1;
    if (c.count[group] === 0) {
      store.remove(group);
      out.away = true;
      return;
    }
    return;
  }
  // The group's answer to the blows.
  const wound = (w: AnimalWound) => {
    const broken = w.breakChance > 0 && nextChance(s, o, w.breakChance) ? w.breakShare : 0;
    bites.push(strikerId, w, w.leg ? broken : 0, w.leg ? 0 : broken, kind);
    counts[F.bitesToPersons] += 1;
  };
  const go = (far: number, mode: number) => {
    let dx = c.x[group] - sx;
    let dy = c.y[group] - sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      dx /= d;
      dy /= d;
    } else {
      const turn = nextFloat(s, o);
      dx = cosTurn(turn);
      dy = sinTurn(turn);
    }
    const widthM = W * cs;
    const heightM = H * cs;
    const tx = c.x[group] + dx * far;
    const ty = c.y[group] + dy * far;
    c.targetX[group] = tx < 0 ? 0 : tx >= widthM ? widthM - 0.01 : tx;
    c.targetY[group] = ty < 0 ? 0 : ty >= heightM ? heightM - 0.01 : ty;
    c.mode[group] = mode;
    c.preyAgent[group] = 0;
    c.preyId[group] = 0;
    out.away = true;
  };
  if (kind === AnimalKind.DEER) {
    go(A.fleeM, AnimalMode.FLEE);
  } else if (kind === AnimalKind.AUROCHS) {
    // It stands its ground for an hour, and may gore whoever strikes it.
    c.cooldown[group] = A.restTicks;
    if (c.mode[group] === AnimalMode.MOVE) c.mode[group] = AnimalMode.REST;
    if (nextChance(s, o, E.goreChance)) wound(E.gore);
  } else {
    if (nextChance(s, o, E.biteBackChance)) wound(kind === AnimalKind.WOLF ? E.wolfBite : E.catBite);
    if (kind === AnimalKind.WOLF) go(A.fleeM, AnimalMode.FLEE);
    else go(E.leaveM[AnimalKind.CAT], AnimalMode.MOVE);
  }
}
