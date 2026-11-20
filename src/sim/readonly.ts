// The read-only face of the simulation.
//
// Code in src/analysis/ may import nothing else from src/sim/
// (tests/guardrails/import-boundary.test.ts). A second guardrail checks that a
// run with observers attached ends with the same state hash as one without.

import type { SimConfig } from './config.ts';
import type { EntityStore } from './core/store.ts';
import type { Sim } from './sim.ts';

export type { SimConfig } from './config.ts';
// Pure functions and constants for reading the weather; none of them can change the simulation.
export { CLIMATE_FIELDS, CLIMATE_PARTS, MOISTURE_LAYER, airTemperatureC, stormActive, windAt } from './world/climate.ts';
export { FIRE_FIELDS, FIRE_LAYERS, FIRE_PARTS, FIRE_STORE, FireStage } from './world/fire.ts';
export { BROWSE_LAYER, FORAGE_LAYER, PLANT_SPECIES, SEED_RAIN_LAYER, coverLayer, foodLayer } from './world/plants.ts';
export { ANIMAL_FIELDS, ANIMAL_PARTS, ANIMAL_STORE, AnimalKind, AnimalMode, CARCASS_LAYER, CARCASS_LOAD_LAYER, GROUP_KINDS, HARE_LAYER } from './world/animals.ts';
export { WATER_PATHOGEN_LAYER } from './world/pathogens.ts';
export { BODY_COLUMNS, BODY_PARTS, DeathCause, Effort, METABOLISM, Sex, basalKcalPerDay, fatKgOf } from './body/metabolism.ts';
export { HEAT, HEAT_COLUMNS, SURROUNDINGS, fullWaterKg } from './body/heat.ts';
export { INJURY, INJURY_COLUMNS, INJURY_PARTS, InjuryKind, bloodVolumeL } from './body/injury.ts';
export { FITNESS, FITNESS_COLUMNS, capacity, strength } from './body/fitness.ts';
export { SKILLS, SKILL_COLUMNS, SKILL_PAIRS, skillOf } from './body/skills.ts';
export { LIFECOURSE, capacityAtAge, fecundityAtAge, frameShare, oldAgeHazard, skillAtAge, solidsAtAge, strengthAtAge, walkingAtAge } from './body/lifecourse.ts';
export { BirthEvent, REPRODUCTION, REPRODUCTION_COLUMNS, REPRODUCTION_PARTS } from './body/reproduction.ts';
export { AGING_COLUMNS } from './body/aging.ts';
export { DialIndex, GENEALOGY_FIELDS, GENETICS, GENETICS_COLUMNS, GENETICS_PARTS, GENE_DIALS, bitCount } from './body/genetics.ts';
export {
  Bedrock,
  MATERIALS,
  MATERIAL_LAYERS,
  Material,
  OBJECT_STORE,
  ROCK_SHELTER_PROTECTION,
  ROCK_SHELTER_STORE,
  RockShelterKind,
  STONE_MATERIALS,
  canopyShelter,
  stoneLayer,
} from './world/materials.ts';
export { Soil, TERRAIN_LAYERS, Water } from './world/terrain.ts';
export { ACT_TALLY_PART, ActTally } from './mind/acts.ts';
export { MEMORY, MEMORY_COLUMNS } from './mind/memory.ts';

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
  /** Names of the environment grid's layers. */
  layerNames(): string[];
  /** Current values of a grid layer: one per cell, row by row, cell (i, j) at index j * widthCells + i. */
  layer(name: string): RoArray;
  /** Current readings of a state part that offers them (such as the weather), or null. */
  readings(name: string): RoArray | null;
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
    layerNames: () => state.world.layerNames(),
    layer: (name) => state.world.layer(name),
    readings: (name) => {
      const part = state.parts.find((candidate) => candidate.name === name);
      return part && part.readings ? part.readings() : null;
    },
  };
}
