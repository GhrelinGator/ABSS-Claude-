// Skills: practice kept per act and kind of thing, a practice curve from it,
// and slow loss with disuse (docs/DESIGN.md §3.4, §3.11).
//
// Skills are acquired during a life, so their columns are `learned`: every body
// starts with none, founders included, and nothing is counted in the tick a body
// is spawned. Practice is kept lazily, as a total and the tick it was last added
// to, so a skill nobody uses costs nothing per tick.

import { exp } from '../core/dmath.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sim, SimState } from '../sim.ts';
import { AnimalKind } from '../world/animals.ts';
import { Material } from '../world/materials.ts';
import { PLANT_SPECIES } from '../world/plants.ts';
import { BODY_COLUMNS, Sex } from './metabolism.ts';

/**
 * Acts that work on a thing and improve with practice: four of the primitives of DESIGN.md §5.5.
 * STRIKE hits it (with or without a held object); MANIPULATE works it with a held object, striking or
 * rubbing one against it; PICK_UP gets it (picking, pulling, digging out, lifting from the ground);
 * CONSUME eats it, getting the edible part out.
 */
export const SkillAct = { STRIKE: 0, MANIPULATE: 1, PICK_UP: 2, CONSUME: 3 } as const;
const ACTS = 4;

/** The kinds of thing an act works on (§4.1's categories): materials, plant species, animals, carcasses, agents. */
const MATERIALS = Object.keys(Material).length;
const PLANTS = PLANT_SPECIES.length;
const ANIMALS = Object.keys(AnimalKind).length;
const HARE_KIND = MATERIALS + PLANTS + ANIMALS;
const CARCASS_KIND = HARE_KIND + 1;
const AGENT_KIND = HARE_KIND + 2;
export const SKILL_KINDS = AGENT_KIND + 1;
export const SKILL_PAIRS = ACTS * SKILL_KINDS;

/** The kind index of a material (a Material id). */
export function materialKind(material: number): number {
  if (!(Number.isInteger(material) && material >= 1 && material <= MATERIALS)) throw new RangeError(`materialKind: ${material}.`);
  return material - 1;
}

/** The kind index of a plant species (its index in PLANT_SPECIES). */
export function plantKind(species: number): number {
  if (!(Number.isInteger(species) && species >= 0 && species < PLANTS)) throw new RangeError(`plantKind: ${species}.`);
  return MATERIALS + species;
}

/** The kind index of an animal living in groups (an AnimalKind id). */
export function animalKind(kind: number): number {
  if (!(Number.isInteger(kind) && kind >= 1 && kind <= ANIMALS)) throw new RangeError(`animalKind: ${kind}.`);
  return MATERIALS + PLANTS + kind - 1;
}

export const SkillKind = { HARE: HARE_KIND, CARCASS: CARCASS_KIND, AGENT: AGENT_KIND } as const;

export const SKILLS = {
  /** Practice at which the novice–expert gap is closed by 1 − 2^−0.5, life-hours. */
  scaleHours: 100,
  /** Exponent of the practice curve: the remaining gap shrinks as (1 + P/scale)^−exponent (Newell & Rosenbloom: 0.2–0.6). */
  practiceExponent: 0.5,
  /** Disuse shorter than this costs nothing, compressed years. */
  graceYears: 1,
  /** After the grace, practice halves every this many compressed years of disuse [estimate]. */
  halfLifeYears: 5,
} as const;
const K = SKILLS;

export const SKILL_COLUMNS = {
  /** Practice in life-hours per act and kind, as of the tick in `skillTick`. */
  skillPractice: { name: 'skillPractice', dtype: 'f32', category: 'learned', width: SKILL_PAIRS },
  /** The tick each skill was last practised. */
  skillTick: { name: 'skillTick', dtype: 'u32', category: 'learned', width: SKILL_PAIRS },
} as const satisfies Record<string, ColumnSpec>;

export function declareSkills(state: SimState): void {
  for (const spec of Object.values(SKILL_COLUMNS)) state.agents.ensureColumn(spec);
}

/** The column index of an act on a kind. */
export function skillIndex(act: number, kind: number): number {
  if (!(Number.isInteger(act) && act >= 0 && act < ACTS)) throw new RangeError(`skillIndex: no such act ${act}.`);
  if (!(Number.isInteger(kind) && kind >= 0 && kind < SKILL_KINDS)) throw new RangeError(`skillIndex: no such kind ${kind}.`);
  return act * SKILL_KINDS + kind;
}

/** Skill from practice in life-hours: the share of the gap between a novice and an expert closed. */
export function skillOf(practiceHours: number): number {
  // (1 + x)^−0.5 = 1 / √(1 + x), exact on every engine.
  return 1 - 1 / Math.sqrt(1 + practiceHours / K.scaleHours);
}

/** What an act achieves at skill `s`, between a novice's and an expert's (per try or per second). */
export function bySkill(novice: number, expert: number, s: number): number {
  return novice + (expert - novice) * s;
}

/** Life-hours counted per real hour of practice: a compressed life holds as many as a real one (§1.1). */
function lifeHoursPerHour(sim: Sim): number {
  return 365.25 / sim.config.time.daysPerYear;
}

/** Practice left after `idleTicks` ticks without use. */
function kept(sim: Sim, practice: number, idleTicks: number): number {
  const perYear = sim.config.time.ticksPerDay * sim.config.time.daysPerYear;
  const decaying = idleTicks / perYear - K.graceYears;
  if (practice === 0 || decaying <= 0) return practice;
  return practice * exp((-0.6931471805599453 * decaying) / K.halfLifeYears);
}

function bodySlot(sim: Sim, slot: number, door: string): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`${door}: slot ${slot} holds no agent.`);
  if (!agents.hasColumn(SKILL_COLUMNS.skillPractice.name)) throw new Error(`${door}: the pipeline keeps no skills (body.fitness).`);
  if (agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`${door}: agent id ${agents.id.data[slot]} has no body.`);
  }
}

/**
 * Practice: whatever makes a body act on a thing calls this with the seconds it spent at it. Nothing
 * is counted in the tick the body was spawned: no system may write learned content then (§1.5).
 */
export function practice(sim: Sim, slot: number, act: number, kind: number, seconds: number): void {
  bodySlot(sim, slot, 'practice');
  const index = skillIndex(act, kind);
  if (!(seconds >= 0 && Number.isFinite(seconds))) throw new RangeError(`practice: ${seconds} s.`);
  const agents = sim.state.agents;
  const tick = sim.state.tick;
  if (agents.column<Float64Array>('spawnTick').data[slot] === tick || seconds === 0) return;
  const at = slot * SKILL_PAIRS + index;
  const hours = agents.column<Float32Array>(SKILL_COLUMNS.skillPractice.name).data;
  const last = agents.column<Uint32Array>(SKILL_COLUMNS.skillTick.name).data;
  hours[at] = kept(sim, hours[at], tick - last[at]) + (seconds / 3600) * lifeHoursPerHour(sim);
  last[at] = tick;
}

/** Practice in life-hours a body holds now for an act on a kind, after any disuse. */
export function practiceHours(sim: Sim, slot: number, act: number, kind: number): number {
  bodySlot(sim, slot, 'practiceHours');
  const at = slot * SKILL_PAIRS + skillIndex(act, kind);
  const agents = sim.state.agents;
  const hours = agents.column<Float32Array>(SKILL_COLUMNS.skillPractice.name).data[at];
  const last = agents.column<Uint32Array>(SKILL_COLUMNS.skillTick.name).data[at];
  return kept(sim, hours, sim.state.tick - last);
}

/** A body's skill now at an act on a kind: 0 for a novice, toward 1 for an expert. */
export function skillLevel(sim: Sim, slot: number, act: number, kind: number): number {
  return skillOf(practiceHours(sim, slot, act, kind));
}
