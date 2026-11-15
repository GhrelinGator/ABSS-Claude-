// The read-only face of the simulation.
//
// Code in src/analysis/ may import nothing else from src/sim/
// (tests/guardrails/import-boundary.test.ts). A second guardrail checks that a
// run with observers attached ends with the same state hash as one without.

import type { SimConfig } from './config.ts';
import type { EntityStore } from './core/store.ts';
import type { Sim } from './sim.ts';

export type { SimConfig } from './config.ts';

/** A numeric array that can be read but not written. */
export interface RoArray {
  readonly length: number;
  readonly [index: number]: number;
}

export interface StoreView {
  readonly name: string;
  /** Number of live entities. */
  readonly count: number;
  /** Scan slots in [0, highWater) and skip those whose "alive" value is not 1. */
  readonly highWater: number;
  hasColumn(name: string): boolean;
  /** Values per entity in the column. */
  columnWidth(name: string): number;
  /** Current values of a column. Entity `slot` occupies [slot * width, (slot + 1) * width). */
  column(name: string): RoArray;
}

export interface SimView {
  /** Ticks completed so far. */
  readonly tick: number;
  readonly config: SimConfig;
  readonly agents: StoreView;
  store(name: string): StoreView;
}

function storeView(store: EntityStore): StoreView {
  return {
    name: store.name,
    get count() {
      return store.count;
    },
    get highWater() {
      return store.highWater;
    },
    hasColumn: (name) => store.hasColumn(name),
    columnWidth: (name) => store.column(name).width,
    column: (name) => store.column(name).data,
  };
}

/** A live, read-only window onto a simulation. It reflects the current state each time it is read. */
export function viewOf(sim: Sim): SimView {
  const { state } = sim;
  const views = new Map<string, StoreView>();
  for (const store of state.stores) views.set(store.name, storeView(store));
  return {
    get tick() {
      return state.tick;
    },
    config: sim.config,
    agents: views.get('agents') as StoreView,
    store(name) {
      const view = views.get(name);
      if (!view) throw new Error(`There is no store "${name}".`);
      return view;
    },
  };
}
