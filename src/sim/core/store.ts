// Structure-of-arrays storage for entities (agents now; animals and objects
// later). Design: docs/DESIGN.md §1.5.
//
// Rules this file enforces:
//  - Every column declares a category, so the guardrail tests can tell innate
//    state from state acquired during a life.
//  - A slot is zero-filled when it is assigned and again when it is released,
//    so a reused slot can never inherit anything from its previous occupant.
//  - Stores grow by doubling. There is no upper limit on population: a limit
//    here would act as a hidden carrying capacity.

import type { DType, Sink, Source, TypedArray } from './codec.ts';
import { allocArray } from './codec.ts';

/**
 * What kind of state a column holds.
 *  - kernel:   bookkeeping of the substrate itself (random streams).
 *  - identity: who the entity is (id, liveness, when its slot was assigned).
 *  - body:     physical state (position, reserves, injuries).
 *  - genome:   inherited values, fixed at conception.
 *  - learned:  anything acquired during a life. Must be empty at spawn.
 */
export type Category = 'kernel' | 'identity' | 'body' | 'genome' | 'learned';

export const CATEGORIES: readonly Category[] = ['kernel', 'identity', 'body', 'genome', 'learned'];

export type ConservedRole = 'stock' | 'inflow' | 'outflow';

/** Marks a column as part of the bookkeeping of a conserved quantity (see core/audit.ts). */
export interface ConservedTag {
  readonly quantity: string;
  readonly role: ConservedRole;
}

export interface ColumnSpec {
  readonly name: string;
  readonly dtype: DType;
  readonly category: Category;
  /** Values per entity. Defaults to 1. */
  readonly width?: number;
  readonly conserved?: ConservedTag;
}

const NAME_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;
const INITIAL_CAPACITY = 256;

export class Column<T extends TypedArray = TypedArray> {
  readonly name: string;
  readonly dtype: DType;
  readonly width: number;
  readonly category: Category;
  readonly conserved: ConservedTag | null;
  /** The backing array. It is replaced when the store grows, so read it afresh at the start of each system run. */
  data: T;

  constructor(spec: ColumnSpec, capacity: number) {
    if (!NAME_PATTERN.test(spec.name)) throw new Error(`Invalid column name "${spec.name}".`);
    if (!CATEGORIES.includes(spec.category)) {
      throw new Error(`Column "${spec.name}" has no valid category.`);
    }
    const width = spec.width ?? 1;
    if (!(Number.isInteger(width) && width >= 1)) {
      throw new Error(`Column "${spec.name}" has invalid width ${width}.`);
    }
    this.name = spec.name;
    this.dtype = spec.dtype;
    this.width = width;
    this.category = spec.category;
    this.conserved = spec.conserved ?? null;
    this.data = allocArray(spec.dtype, capacity * width) as T;
  }
}

function sameTag(a: ConservedTag | null, b: ConservedTag | null): boolean {
  if (a === null || b === null) return a === b;
  return a.quantity === b.quantity && a.role === b.role;
}

export class EntityStore {
  readonly name: string;
  readonly columns: Column[] = [];
  readonly id: Column<Uint32Array>;
  readonly alive: Column<Uint8Array>;
  capacity = INITIAL_CAPACITY;
  /** One past the highest slot in use. Loops run over [0, highWater) and skip slots that are not alive. */
  highWater = 0;
  /** Number of live entities. */
  count = 0;
  /** Next id to hand out. Ids start at 1 and are never reused; 0 means "none". */
  nextId = 1;
  /** Incremented whenever the column arrays are reallocated. */
  layoutVersion = 0;

  private sealed = false;
  private freeHint = 0;
  private readonly byName = new Map<string, Column>();
  private readonly slotById = new Map<number, number>();
  private readonly clearHooks: Array<(slot: number) => void> = [];

  constructor(name: string) {
    if (!NAME_PATTERN.test(name)) throw new Error(`Invalid store name "${name}".`);
    this.name = name;
    this.id = this.ensureColumn<Uint32Array>({ name: 'id', dtype: 'u32', category: 'identity' });
    this.alive = this.ensureColumn<Uint8Array>({ name: 'alive', dtype: 'u8', category: 'identity' });
  }

  /**
   * Declare a column, or fetch it if it was already declared with the same
   * layout. New columns can only be declared before the store is sealed.
   */
  ensureColumn<T extends TypedArray = TypedArray>(spec: ColumnSpec): Column<T> {
    const existing = this.byName.get(spec.name);
    if (existing) {
      const width = spec.width ?? 1;
      const same =
        existing.dtype === spec.dtype &&
        existing.width === width &&
        existing.category === spec.category &&
        sameTag(existing.conserved, spec.conserved ?? null);
      if (!same) {
        throw new Error(`Column "${this.name}.${spec.name}" was declared twice with different layouts.`);
      }
      return existing as unknown as Column<T>;
    }
    if (this.sealed) {
      throw new Error(`Column "${this.name}.${spec.name}" was declared after the store was sealed.`);
    }
    const column = new Column<T>(spec, this.capacity);
    this.columns.push(column as unknown as Column);
    this.byName.set(spec.name, column as unknown as Column);
    return column;
  }

  hasColumn(name: string): boolean {
    return this.byName.has(name);
  }

  column<T extends TypedArray = TypedArray>(name: string): Column<T> {
    const column = this.byName.get(name);
    if (!column) throw new Error(`Store "${this.name}" has no column "${name}".`);
    return column as unknown as Column<T>;
  }

  /** After sealing, no new columns can be declared. */
  seal(): void {
    this.sealed = true;
  }

  /** Register a function to run whenever a slot is wiped (on assignment and on release). */
  onClear(hook: (slot: number) => void): void {
    this.clearHooks.push(hook);
  }

  isAlive(slot: number): boolean {
    return slot >= 0 && slot < this.highWater && this.alive.data[slot] === 1;
  }

  /** Slot currently holding the entity with this id, or -1 if it is not alive. */
  slotOf(id: number): number {
    return this.slotById.get(id) ?? -1;
  }

  /**
   * Assign the lowest free slot to a new entity and return the slot. Every
   * column of the slot is zero; the caller fills in what the entity starts with.
   */
  spawn(): number {
    if (this.nextId > 0xffffffff) throw new Error(`Store "${this.name}" ran out of ids.`);
    let slot = this.freeHint;
    const alive = this.alive.data;
    while (slot < this.highWater && alive[slot] === 1) slot++;
    if (slot >= this.capacity) this.grow(slot + 1);
    this.clearSlot(slot);
    const id = this.nextId++;
    this.id.data[slot] = id;
    this.alive.data[slot] = 1;
    if (slot >= this.highWater) this.highWater = slot + 1;
    this.freeHint = slot + 1;
    this.count++;
    this.slotById.set(id, slot);
    return slot;
  }

  /** Release a slot. Everything stored for the entity is wiped. */
  remove(slot: number): void {
    if (!this.isAlive(slot)) throw new Error(`Store "${this.name}": slot ${slot} is not alive.`);
    this.slotById.delete(this.id.data[slot]);
    this.clearSlot(slot);
    this.count--;
    if (slot < this.freeHint) this.freeHint = slot;
    const alive = this.alive.data;
    while (this.highWater > 0 && alive[this.highWater - 1] === 0) this.highWater--;
  }

  write(sink: Sink): void {
    sink.u32(this.highWater);
    sink.u32(this.count);
    sink.f64(this.nextId);
    sink.u32(this.columns.length);
    for (const column of this.columns) {
      sink.str(column.name);
      sink.u32(column.width);
      sink.array(column.data.subarray(0, this.highWater * column.width));
    }
  }

  read(source: Source): void {
    const highWater = source.u32();
    const count = source.u32();
    const nextId = source.f64();
    const ncolumns = source.u32();
    if (ncolumns !== this.columns.length) {
      throw new Error(
        `Snapshot has ${ncolumns} columns for store "${this.name}" but the pipeline declares ${this.columns.length}.`,
      );
    }
    if (highWater > this.capacity) this.grow(highWater);
    for (const column of this.columns) {
      const name = source.str();
      const width = source.u32();
      if (name !== column.name || width !== column.width) {
        throw new Error(
          `Snapshot column "${this.name}.${name}" (width ${width}) does not match "${column.name}" (width ${column.width}).`,
        );
      }
      const data = source.array(column.dtype);
      if (data.length !== highWater * column.width) {
        throw new Error(`Snapshot column "${this.name}.${name}" has the wrong length.`);
      }
      column.data.fill(0);
      column.data.set(data);
    }
    this.highWater = highWater;
    this.count = count;
    this.nextId = nextId;
    this.freeHint = 0;
    this.slotById.clear();
    const alive = this.alive.data;
    const ids = this.id.data;
    let live = 0;
    for (let slot = 0; slot < highWater; slot++) {
      if (alive[slot] === 1) {
        this.slotById.set(ids[slot], slot);
        live++;
      }
    }
    if (live !== count) {
      throw new Error(`Snapshot of store "${this.name}" is inconsistent: ${live} live slots, count ${count}.`);
    }
  }

  private clearSlot(slot: number): void {
    for (const column of this.columns) {
      column.data.fill(0, slot * column.width, (slot + 1) * column.width);
    }
    for (const hook of this.clearHooks) hook(slot);
  }

  private grow(minCapacity: number): void {
    let capacity = this.capacity;
    while (capacity < minCapacity) capacity *= 2;
    for (const column of this.columns) {
      const next = allocArray(column.dtype, capacity * column.width);
      next.set(column.data);
      column.data = next;
    }
    this.capacity = capacity;
    this.layoutVersion++;
  }
}
