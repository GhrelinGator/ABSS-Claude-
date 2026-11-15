// The only doors through which mechanisms enter the simulation.
//
// Every system, heritable dial, drive, and action primitive is created by one
// of the define* functions below. Every call site must sit directly under an
// `// ALIBI:` comment that gives the ecological reason the thing would exist
// even if agents never banded together (docs/GUARDRAILS.md §3).
// tests/guardrails/alibi.test.ts scans src/sim/ for the call sites.

import type { Sim, SimState } from '../sim.ts';

const KIND: unique symbol = Symbol('abss.definition');

const NAME_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;

function checkName(what: string, name: string): void {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`Invalid ${what} name "${name}": use dotted camelCase such as "climate.season".`);
  }
}

// ---------------------------------------------------------------- systems

export interface SystemSpec {
  /** Unique dotted name, such as "climate.season". */
  readonly name: string;
  /** Run only on ticks divisible by this number. Defaults to 1 (every tick). */
  readonly every?: number;
  /**
   * Declare the columns, layers, and state parts this system owns or reads.
   * Runs once per sim, before any entity exists.
   */
  readonly declare?: (state: SimState) => void;
  /**
   * Bind the system to one sim and return the function that advances it by
   * one step. Keep all mutable data inside the sim or this closure, never at
   * module level, so that several sims can run side by side.
   */
  readonly create: (sim: Sim) => () => void;
}

export interface SystemDef {
  readonly [KIND]: 'system';
  readonly name: string;
  readonly every: number;
  readonly declare: ((state: SimState) => void) | null;
  readonly create: (sim: Sim) => () => void;
}

export function defineSystem(spec: SystemSpec): SystemDef {
  checkName('system', spec.name);
  const every = spec.every ?? 1;
  if (!(Number.isInteger(every) && every >= 1)) {
    throw new RangeError(`System "${spec.name}": "every" must be a positive integer, got ${every}.`);
  }
  if (typeof spec.create !== 'function') throw new TypeError(`System "${spec.name}" has no create function.`);
  return Object.freeze({
    [KIND]: 'system' as const,
    name: spec.name,
    every,
    declare: spec.declare ?? null,
    create: spec.create,
  });
}

export function isSystemDef(value: unknown): value is SystemDef {
  return typeof value === 'object' && value !== null && (value as { [KIND]?: unknown })[KIND] === 'system';
}

// ---------------------------------------------------------------- heritable dials

export interface DialSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  /**
   * The value at which the dial has no effect. Selection must be able to
   * bring a dial back to it, so it has to lie inside [min, max].
   */
  readonly neutral: number;
}

export interface DialDef extends DialSpec {
  readonly [KIND]: 'dial';
}

export function defineDial(spec: DialSpec): DialDef {
  checkName('dial', spec.name);
  const { min, max, neutral } = spec;
  if (![min, max, neutral].every(Number.isFinite) || !(min < max)) {
    throw new RangeError(`Dial "${spec.name}" needs finite min < max.`);
  }
  if (!(neutral >= min && neutral <= max)) {
    throw new RangeError(`Dial "${spec.name}": the neutral value ${neutral} is outside [${min}, ${max}].`);
  }
  return Object.freeze({ [KIND]: 'dial' as const, name: spec.name, min, max, neutral });
}

// ---------------------------------------------------------------- drives

export interface DriveSpec {
  readonly name: string;
}

export interface DriveDef extends DriveSpec {
  readonly [KIND]: 'drive';
}

export function defineDrive(spec: DriveSpec): DriveDef {
  checkName('drive', spec.name);
  return Object.freeze({ [KIND]: 'drive' as const, name: spec.name });
}

// ---------------------------------------------------------------- action primitives

export interface PrimitiveSpec {
  readonly name: string;
}

export interface PrimitiveDef extends PrimitiveSpec {
  readonly [KIND]: 'primitive';
}

export function definePrimitive(spec: PrimitiveSpec): PrimitiveDef {
  checkName('primitive', spec.name);
  return Object.freeze({ [KIND]: 'primitive' as const, name: spec.name });
}
