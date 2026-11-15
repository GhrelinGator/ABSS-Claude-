// Run-time checks behind three guardrails (docs/GUARDRAILS.md §1):
//  - conserved quantities balance for every live entity,
//  - an agent holds no learned content during the tick it was spawned,
//  - state never contains NaN or infinite values.
// Each function returns a list of problems; an empty list means the check passed.

import { dtypeOf, isFloatDType } from './codec.ts';
import type { Column, EntityStore } from './store.ts';
import type { SimState } from '../sim.ts';

const MAX_REPORTED = 20;

interface ConservedColumns {
  stock: Column<Float64Array>[];
  inflow: Column<Float64Array>[];
  outflow: Column<Float64Array>[];
}

function conservedGroups(store: EntityStore): Map<string, ConservedColumns> {
  const groups = new Map<string, ConservedColumns>();
  for (const column of store.columns) {
    const tag = column.conserved;
    if (!tag) continue;
    let group = groups.get(tag.quantity);
    if (!group) {
      group = { stock: [], inflow: [], outflow: [] };
      groups.set(tag.quantity, group);
    }
    group[tag.role].push(column as Column<Float64Array>);
  }
  return groups;
}

/** A conserved quantity needs exactly one stock, one inflow, and one outflow column, each a single f64. */
export function conservedLayoutProblems(store: EntityStore): string[] {
  const problems: string[] = [];
  for (const column of store.columns) {
    if (column.conserved && (column.dtype !== 'f64' || column.width !== 1)) {
      problems.push(`${store.name}.${column.name}: conserved columns must be single f64 values.`);
    }
  }
  for (const [quantity, group] of conservedGroups(store)) {
    if (group.stock.length !== 1 || group.inflow.length !== 1 || group.outflow.length !== 1) {
      problems.push(
        `${store.name}: conserved quantity "${quantity}" needs exactly one stock, one inflow, and one outflow column ` +
          `(found ${group.stock.length}, ${group.inflow.length}, ${group.outflow.length}).`,
      );
    }
  }
  return problems;
}

/**
 * Check `stock = inflow - outflow` for every live entity and every conserved
 * quantity, allowing for accumulated rounding. Inflow and outflow are
 * cumulative totals since the entity was spawned; whatever the entity starts
 * with has to be recorded as an inflow.
 */
export function auditConserved(store: EntityStore, relativeTolerance = 1e-9): string[] {
  const problems = conservedLayoutProblems(store);
  if (problems.length > 0) return problems;
  const alive = store.alive.data;
  const ids = store.id.data;
  for (const [quantity, group] of conservedGroups(store)) {
    const stock = group.stock[0].data;
    const inflow = group.inflow[0].data;
    const outflow = group.outflow[0].data;
    for (let slot = 0; slot < store.highWater; slot++) {
      if (alive[slot] !== 1) continue;
      const allowed = relativeTolerance * (Math.abs(inflow[slot]) + Math.abs(outflow[slot])) + 1e-9;
      const error = stock[slot] - (inflow[slot] - outflow[slot]);
      const balanced = Math.abs(error) <= allowed; // false for NaN as well
      const sane = stock[slot] >= -allowed && inflow[slot] >= 0 && outflow[slot] >= 0;
      if (!balanced || !sane) {
        problems.push(
          `${store.name} id ${ids[slot]}: ${quantity} does not balance ` +
            `(stock ${stock[slot]}, inflow ${inflow[slot]}, outflow ${outflow[slot]}, error ${error}).`,
        );
        if (problems.length >= MAX_REPORTED) return problems;
      }
    }
  }
  return problems;
}

/** Everything learned that is stored for the agent in `slot`. Empty for a blank slate. */
export function learnedContentProblems(state: SimState, slot: number): string[] {
  const problems: string[] = [];
  for (const column of state.agents.columns) {
    if (column.category !== 'learned') continue;
    const data = column.data;
    const end = (slot + 1) * column.width;
    for (let i = slot * column.width; i < end; i++) {
      if (data[i] !== 0) {
        problems.push(`agents.${column.name} holds content for slot ${slot}.`);
        break;
      }
    }
  }
  for (const part of state.parts) {
    if (!part.holdsLearned) continue;
    if (!part.learnedEmptyFor || !part.learnedEmptyFor(slot)) {
      problems.push(`State part "${part.name}" holds content for slot ${slot}.`);
    }
  }
  return problems;
}

/**
 * Agents whose slot was assigned at `tick` must hold no learned content
 * (docs/DESIGN.md §1.5). Call it with the tick that has just finished, and
 * with tick 0 before the first step to cover founders.
 */
export function freshSpawnProblems(state: SimState, tick: number): string[] {
  const problems: string[] = [];
  const agents = state.agents;
  const alive = agents.alive.data;
  const spawnTick = agents.column<Float64Array>('spawnTick').data;
  for (let slot = 0; slot < agents.highWater; slot++) {
    if (alive[slot] !== 1 || spawnTick[slot] !== tick) continue;
    for (const problem of learnedContentProblems(state, slot)) {
      problems.push(`Spawned at tick ${tick}: ${problem}`);
      if (problems.length >= MAX_REPORTED) return problems;
    }
  }
  return problems;
}

/** Every NaN or infinite value in floating-point state (first occurrence per column or layer). */
export function nonFiniteProblems(state: SimState): string[] {
  const problems: string[] = [];
  for (const store of state.stores) {
    for (const column of store.columns) {
      if (!isFloatDType(column.dtype)) continue;
      const data = column.data;
      const end = store.highWater * column.width;
      for (let i = 0; i < end; i++) {
        if (!Number.isFinite(data[i])) {
          problems.push(`${store.name}.${column.name}[${i}] is ${data[i]}.`);
          break;
        }
      }
    }
  }
  for (const name of state.world.layerNames()) {
    const data = state.world.layer(name);
    if (!isFloatDType(dtypeOf(data))) continue;
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) {
        problems.push(`world layer ${name}[${i}] is ${data[i]}.`);
        break;
      }
    }
  }
  return problems;
}
