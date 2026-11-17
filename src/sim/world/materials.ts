// Materials and objects: what loose matter is made of, where it lies, how it
// breaks when struck, and the cover it gives from wind, rain, and open sky.
// Design: docs/DESIGN.md §2.8 and §2.15.
//
// Objects carry physical attributes only (mass, length, edge, hardness, how
// they break). What anything is good for is for agents to find out, and for
// the analysis layer to notice.

import { pow } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import type { EntityStore } from '../core/store.ts';
import { spawnEntity } from '../sim.ts';
import type { Sim, SimState } from '../sim.ts';
import { CLIMATE_CONSTANTS, CLIMATE_PARTS, MOISTURE_LAYER, dailyMeanTemperatureC } from './climate.ts';
import { fieldKey, fractal, hash01 } from './noise.ts';
import { PLANT_SPECIES, coverLayer } from './plants.ts';
import { Soil, TERRAIN_LAYERS, Water, steepestSlope } from './terrain.ts';

// ---------------------------------------------------------------- the catalogue

export const Material = {
  FLINT: 0,
  QUARTZITE: 1,
  GRANITE: 2,
  LIMESTONE: 3,
  SANDSTONE: 4,
  PYRITE: 5,
  WOOD: 6,
  REED: 7,
  BONE: 8,
  HIDE: 9,
  DRY_GRASS: 10,
} as const;

/** How a material breaks when struck hard enough. */
export const Fracture = {
  /** Glassy stone: a shell-shaped flake comes away with a very thin, sharp edge. */
  CONCHOIDAL: 0,
  /** Grainy stone: splits into blocky chunks with blunt edges. */
  GRANULAR: 1,
  /** Fresh bone: splits along its length into splinters with fairly sharp edges and points. */
  SPLINTERING: 2,
  /** Wood and stems: snap across into shorter pieces. */
  FIBROUS: 3,
  /** Skin and grass: bend and don't break. */
  PLIANT: 4,
} as const;

export interface MaterialSpec {
  readonly name: string;
  readonly densityKgPerM3: number;
  /** Mohs scratch hardness. */
  readonly hardness: number;
  readonly fracture: number;
  /**
   * Impact energy, in joules, that breaks a 1 kg piece that already has an
   * edge to break from. It scales with mass to the 2/3 (the area of the
   * break). 0: never breaks.
   */
  readonly breakJ: number;
  /** Sharpness of a freshly broken edge, 0 (round) to 1 (as sharp as stone gets). */
  readonly freshEdge: number;
  /** Throws off burning particles when struck by something harder (iron sulfide does). */
  readonly sparks: boolean;
  /** Heat released by burning it dry, MJ per kg. */
  readonly heatMJPerKg: number;
  /** How readily it catches from a spark when dry, 0 to 1. Used by fire (Phase 1.8). */
  readonly ignitability: number;
  /** Thermal insulation when wrapped round a body, clo per kg. Used by bodies (Phase 2.2). */
  readonly insulationCloPerKg: number;
  /** Share lost to rot or weathering per real day at 10 °C in moist conditions; doubles every 10 °C warmer. */
  readonly decayPerDayAt10C: number;
}

/** Indexed by Material. Numbers and their sources: docs/RESEARCH.md, Materials. */
export const MATERIALS: readonly MaterialSpec[] = Object.freeze([
  { name: 'flint', densityKgPerM3: 2600, hardness: 7, fracture: Fracture.CONCHOIDAL, breakJ: 8, freshEdge: 1, sparks: false, heatMJPerKg: 0, ignitability: 0, insulationCloPerKg: 0, decayPerDayAt10C: 0 },
  { name: 'quartzite', densityKgPerM3: 2650, hardness: 7, fracture: Fracture.CONCHOIDAL, breakJ: 15, freshEdge: 0.6, sparks: false, heatMJPerKg: 0, ignitability: 0, insulationCloPerKg: 0, decayPerDayAt10C: 0 },
  { name: 'granite', densityKgPerM3: 2700, hardness: 6, fracture: Fracture.GRANULAR, breakJ: 60, freshEdge: 0.15, sparks: false, heatMJPerKg: 0, ignitability: 0, insulationCloPerKg: 0, decayPerDayAt10C: 0 },
  { name: 'limestone', densityKgPerM3: 2500, hardness: 3, fracture: Fracture.GRANULAR, breakJ: 15, freshEdge: 0.1, sparks: false, heatMJPerKg: 0, ignitability: 0, insulationCloPerKg: 0, decayPerDayAt10C: 0 },
  { name: 'sandstone', densityKgPerM3: 2300, hardness: 4.5, fracture: Fracture.GRANULAR, breakJ: 20, freshEdge: 0.05, sparks: false, heatMJPerKg: 0, ignitability: 0, insulationCloPerKg: 0, decayPerDayAt10C: 0 },
  { name: 'pyrite', densityKgPerM3: 5000, hardness: 6.5, fracture: Fracture.GRANULAR, breakJ: 25, freshEdge: 0.1, sparks: true, heatMJPerKg: 0, ignitability: 0, insulationCloPerKg: 0, decayPerDayAt10C: 0 },
  { name: 'wood', densityKgPerM3: 650, hardness: 1.5, fracture: Fracture.FIBROUS, breakJ: 30, freshEdge: 0.1, sparks: false, heatMJPerKg: 18, ignitability: 0.05, insulationCloPerKg: 0, decayPerDayAt10C: 0.25 / 365 },
  { name: 'reed', densityKgPerM3: 350, hardness: 1.5, fracture: Fracture.FIBROUS, breakJ: 4, freshEdge: 0.3, sparks: false, heatMJPerKg: 17, ignitability: 0.3, insulationCloPerKg: 0, decayPerDayAt10C: 0.5 / 365 },
  { name: 'bone', densityKgPerM3: 1900, hardness: 3.5, fracture: Fracture.SPLINTERING, breakJ: 35, freshEdge: 0.55, sparks: false, heatMJPerKg: 4, ignitability: 0, insulationCloPerKg: 0, decayPerDayAt10C: 0.15 / 365 },
  { name: 'hide', densityKgPerM3: 1000, hardness: 1, fracture: Fracture.PLIANT, breakJ: 0, freshEdge: 0, sparks: false, heatMJPerKg: 15, ignitability: 0.01, insulationCloPerKg: 0.5, decayPerDayAt10C: 0.05 },
  { name: 'dryGrass', densityKgPerM3: 150, hardness: 1, fracture: Fracture.PLIANT, breakJ: 0, freshEdge: 0, sparks: false, heatMJPerKg: 15, ignitability: 1, insulationCloPerKg: 0.2, decayPerDayAt10C: 1 / 365 },
] satisfies MaterialSpec[]);

/** Stone kinds that lie loose on the ground, each with its own count layer. */
export const STONE_KINDS: readonly number[] = Object.freeze([
  Material.FLINT,
  Material.QUARTZITE,
  Material.GRANITE,
  Material.LIMESTONE,
  Material.SANDSTONE,
  Material.PYRITE,
]);

export const RockShelter = { NONE: 0, OVERHANG: 1, CAVE: 2 } as const;

export const MATERIAL_LAYERS = {
  /** The rock under the soil (a Material value: granite, quartzite, limestone, or sandstone). */
  bedrock: 'materials.bedrock',
  /** Fallen dead wood, kg per cell. */
  deadwood: 'materials.deadwood',
  /** Bone from animals that died there, kg per cell. */
  bone: 'materials.bone',
  /** Skin still on carcasses, kg per cell. */
  hide: 'materials.hide',
  /** A RockShelter value: an overhang or a cave somewhere in the cell. */
  rockShelter: 'materials.rockShelter',
} as const;

/** Loose hand-sized stones of one kind lying in each cell (a count). */
export function stoneLayer(material: number): string {
  return `materials.stone.${MATERIALS[material].name}`;
}

export const OBJECT_STORE = 'objects';

export const MATERIAL_CONSTANTS = {
  /** Bedrock patches: wavelength in cells, and octaves of the noise. */
  bedrockWavelengthCells: 60,
  bedrockOctaves: 3,
  /** Loose stones per cell by soil (rock, thin, loam, alluvium, sand), before a ±50% jitter. */
  stonesBySoil: [2000, 400, 30, 10, 60],
  /**
   * Cobbles in a river cell, and on dry land next to a river. River gravel is
   * the hard stone of the catchment upstream (quartzite, granite, and flint
   * from limestone); limestone and sandstone wear away to grit and sand.
   */
  riverCobbles: 1500,
  riverbankCobbles: 150,
  /** Flint's share of limestone's loose stones where its bands are thickest. */
  flintShare: 0.15,
  /** Pyrite's share of sedimentary rock's loose stones where its nodules are densest; most places have none. */
  pyriteShare: 0.02,
  /**
   * Rock faces: how steep a cell is, from 0 at this slope (rise over run) to
   * 1 at `steepSlope`. Cliffs, and with them overhangs and most caves, come
   * with steep ground.
   */
  gentleSlope: 0.1,
  steepSlope: 0.35,
  /** Chance of a cave in a cell, by bedrock (indexed by Material; stones only): anywhere (sinkholes in limestone), and extra on fully steep ground. */
  caveFlatChance: [0, 0, 0, 0.002, 0],
  caveSteepChance: [0, 0.005, 0.005, 0.05, 0.01],
  /** Chance of an overhang on fully steep ground, by bedrock. */
  overhangSteepChance: [0, 0.04, 0.04, 0.12, 0.12],
  /** A rock shelter covers points within this distance of its spot, metres. */
  rockShelterRadiusM: 10,
  /** Dead wood falling per hectare per real year at full cover: trees (nut), shrubs (berry). */
  treeDeadwoodKgPerHaYear: 2000,
  shrubDeadwoodKgPerHaYear: 400,
  /** Organic decay in dry conditions, as a share of the moist rate. */
  dryDecayShare: 0.25,
  /** Each cell's dead wood updates every this many days, a quarter of the map per day. */
  deadwoodEveryDays: 4,
  /** Below this, a layer's bone, skin, or wood is gone. */
  leastKg: 0.01,
  /** Bone and skin left by an animal, per kg of its edible meat. */
  bonePerMeatKg: 0.22,
  hidePerMeatKg: 0.13,
  /** Pieces lighter than this are grit, not objects, kg. */
  leastPieceKg: 0.005,
  /** A conchoidal stone struck this many times over its breaking energy shatters. */
  shatterRatio: 10,
  /** A stone with no edge to break from needs this many times the energy. */
  roundStoneFactor: 3,
  /** Least impact energy that strikes sparks from pyrite, J; sparks per J above it; most per blow. */
  sparkLeastJ: 1,
  sparksPerJ: 0.5,
  mostSparks: 30,
  /** Pyrite scraped off per blow that throws sparks, kg. */
  pyritePerBlowKg: 0.0002,
  /** Objects within this distance of a point count toward its cover, m. */
  pileRadiusM: 2.5,
  /** Wood at least this long counts as frame, m. */
  frameLengthM: 1.5,
  /** Frame wood, and covering (skins; grass and reed), that fully cover one spot, kg. */
  fullFrameKg: 80,
  fullHideKg: 12,
  fullThatchKg: 30,
} as const;
const K = MATERIAL_CONSTANTS;

const SALT_BEDROCK = 200;
const SALT_JITTER = 205;
const SALT_FLINT = 206;
const SALT_PYRITE = 207;
const SALT_SHELTER = 208;
const SALT_SPOT = 209;

// ---------------------------------------------------------------- objects

export interface ObjectColumns {
  material: Uint8Array;
  x: Float64Array;
  y: Float64Array;
  massKg: Float32Array;
  lengthM: Float32Array;
  /** Sharpness of the sharpest edge, 0 to 1. */
  edge: Float32Array;
  /** 1 when sound, falling as it rots or weathers; at 0 it is gone. */
  integrity: Float32Array;
  /** Id of the agent holding it, or 0 when it lies on the ground. */
  holder: Uint32Array;
}

function declareObjects(state: SimState): EntityStore {
  const store = state.addStore(OBJECT_STORE);
  store.ensureColumn({ name: 'material', dtype: 'u8', category: 'identity' });
  store.ensureColumn({ name: 'x', dtype: 'f64', category: 'body' });
  store.ensureColumn({ name: 'y', dtype: 'f64', category: 'body' });
  for (const name of ['massKg', 'lengthM', 'edge', 'integrity']) store.ensureColumn({ name, dtype: 'f32', category: 'body' });
  store.ensureColumn({ name: 'holder', dtype: 'u32', category: 'body' });
  return store;
}

/** The object store's columns. They are replaced when the store grows, so fetch them again after adding objects. */
export function objectColumns(store: EntityStore): ObjectColumns {
  return {
    material: store.column('material').data as Uint8Array,
    x: store.column('x').data as Float64Array,
    y: store.column('y').data as Float64Array,
    massKg: store.column('massKg').data as Float32Array,
    lengthM: store.column('lengthM').data as Float32Array,
    edge: store.column('edge').data as Float32Array,
    integrity: store.column('integrity').data as Float32Array,
    holder: store.column('holder').data as Uint32Array,
  };
}

/** Put a sound object on the ground at (x, y) and return its slot. */
export function placeObject(sim: Sim, material: number, x: number, y: number, massKg: number, lengthM: number, edge: number): number {
  if (!(material >= 0 && material < MATERIALS.length && Number.isInteger(material))) throw new RangeError(`No material ${material}.`);
  if (!(massKg > 0 && lengthM > 0 && edge >= 0 && edge <= 1)) throw new RangeError('placeObject: mass and length must be positive and edge within [0, 1].');
  const store = sim.state.store(OBJECT_STORE);
  const slot = spawnEntity(sim.state, store);
  const c = objectColumns(store);
  c.material[slot] = material;
  c.x[slot] = x;
  c.y[slot] = y;
  c.massKg[slot] = massKg;
  c.lengthM[slot] = lengthM;
  c.edge[slot] = edge;
  c.integrity[slot] = 1;
  c.holder[slot] = 0;
  return slot;
}

/** Cube root, from the portable pow. */
function cbrt(x: number): number {
  return x > 0 ? pow(x, 1 / 3) : 0;
}

/** Longest dimension of a stone piece of this mass: blocky pieces, or thin flakes. */
function stoneLength(material: number, massKg: number, flake: boolean): number {
  return (flake ? 3 : 1.6) * cbrt(massKg / MATERIALS[material].densityKgPerM3);
}

/** Mass of a stick of this length: thicker sticks are longer ones. */
function woodMass(material: number, lengthM: number): number {
  const diameter = 0.015 + 0.01 * lengthM;
  return MATERIALS[material].densityKgPerM3 * 0.7853981633974483 * diameter * diameter * lengthM;
}

function cellOf(sim: Sim, x: number, y: number): number {
  const { widthCells: W, heightCells: H, cellSizeM } = sim.config.world;
  let i = Math.floor(x / cellSizeM);
  let j = Math.floor(y / cellSizeM);
  if (i < 0) i = 0;
  else if (i >= W) i = W - 1;
  if (j < 0) j = 0;
  else if (j >= H) j = H - 1;
  return j * W + i;
}

/**
 * Take one loose piece of a material from the ground at (x, y), as a new
 * object lying there, and return its slot, or -1 if the cell has none.
 * Stones, dead wood, bone, and skin come from the cell's layers; how big the
 * piece is comes from `rand` (the taker's own stream, later).
 */
export function takePiece(sim: Sim, x: number, y: number, material: number, rand: () => number): number {
  const world = sim.state.world;
  const k = cellOf(sim, x, y);
  if (STONE_KINDS.includes(material)) {
    const count = world.layer<Uint16Array>(stoneLayer(material));
    if (count[k] === 0) return -1;
    count[k] -= 1;
    const mass = material === Material.PYRITE ? 0.05 + 0.45 * rand() : 0.2 + 2.3 * rand();
    return placeObject(sim, material, x, y, mass, stoneLength(material, mass, false), 0);
  }
  if (material === Material.WOOD) {
    const wood = world.layer<Float32Array>(MATERIAL_LAYERS.deadwood);
    const trees = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('nut')]))[k];
    const shrubs = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('berry')]))[k];
    const woody = trees * K.treeDeadwoodKgPerHaYear + shrubs * K.shrubDeadwoodKgPerHaYear;
    const treeShare = woody > 0 ? (trees * K.treeDeadwoodKgPerHaYear) / woody : 0;
    const length = rand() < treeShare ? 0.3 + 4.7 * rand() : 0.3 + 1.2 * rand();
    const mass = woodMass(material, length);
    if (wood[k] < mass) return -1;
    wood[k] -= mass;
    return placeObject(sim, material, x, y, mass, length, 0);
  }
  if (material === Material.BONE || material === Material.HIDE) {
    const layer = world.layer<Float32Array>(material === Material.BONE ? MATERIAL_LAYERS.bone : MATERIAL_LAYERS.hide);
    if (layer[k] < K.leastKg) return -1;
    let mass = material === Material.BONE ? 0.1 + 1.9 * rand() : 1 + 5 * rand();
    if (mass > layer[k]) mass = layer[k];
    layer[k] -= mass;
    const length = material === Material.BONE ? 0.15 + 0.3 * rand() : 1.2 * cbrt(mass);
    return placeObject(sim, material, x, y, mass, length, 0);
  }
  return -1;
}

function speciesIndex(name: string): number {
  const index = PLANT_SPECIES.findIndex((species) => species.name === name);
  if (index < 0) throw new Error(`No plant species "${name}".`);
  return index;
}

// ---------------------------------------------------------------- striking

export interface StrikeResult {
  /** Slots of new objects that broke off either piece (flakes, chunks, splinters). */
  readonly pieces: number[];
  readonly struckBroke: boolean;
  readonly strikerBroke: boolean;
  /** Burning particles thrown off: iron sulfide struck by something harder. Fire (1.8) decides what they light. */
  readonly sparks: number;
  /** Mass turned into grit too small to be an object, kg. */
  readonly dustKg: number;
  /** Energy of the blow, J. */
  readonly energyJ: number;
}

/** Impact energy needed to break this object: grows with its size, and a stone with no edge to break from needs more. */
export function breakEnergyJ(material: number, massKg: number, edge: number): number {
  const spec = MATERIALS[material];
  if (spec.breakJ <= 0) return Infinity;
  let factor = 1;
  if (spec.fracture === Fracture.CONCHOIDAL || spec.fracture === Fracture.GRANULAR) {
    const e = edge / 0.5;
    factor = K.roundStoneFactor - (K.roundStoneFactor - 1) * (e < 1 ? e : 1);
  }
  return spec.breakJ * pow(massKg, 2 / 3) * factor;
}

/**
 * Strike one object against another at a closing speed (m/s). Both feel the
 * same blow, so either can break; the energy available to break things is
 * that of the collision (reduced mass). Physics alone decides the result.
 * `rand` supplies the chance part (where the blow lands, how the crack runs).
 */
export function strikeObjects(sim: Sim, striker: number, struck: number, speedMps: number, rand: () => number): StrikeResult {
  const store = sim.state.store(OBJECT_STORE);
  if (striker === struck || !store.isAlive(striker) || !store.isAlive(struck)) throw new Error('strikeObjects needs two different live objects.');
  if (!(speedMps >= 0 && Number.isFinite(speedMps))) throw new RangeError('strikeObjects: speed must be a finite number ≥ 0.');
  let c = objectColumns(store);
  const m1 = c.massKg[striker];
  const m2 = c.massKg[struck];
  const energy = (0.5 * ((m1 * m2) / (m1 + m2)) * speedMps * speedMps);
  const a = c.material[striker];
  const b = c.material[struck];

  // Sparks: iron sulfide scraped by a harder stone.
  let sparks = 0;
  let dust = 0;
  const pyrite = MATERIALS[a].sparks && MATERIALS[b].hardness > MATERIALS[a].hardness ? striker : MATERIALS[b].sparks && MATERIALS[a].hardness > MATERIALS[b].hardness ? struck : -1;
  if (pyrite >= 0 && energy >= K.sparkLeastJ) {
    sparks = Math.floor((energy - K.sparkLeastJ) * K.sparksPerJ) + 1;
    if (sparks > K.mostSparks) sparks = K.mostSparks;
    const scraped = c.massKg[pyrite] > K.pyritePerBlowKg ? K.pyritePerBlowKg : 0;
    c.massKg[pyrite] -= scraped;
    dust += scraped;
  }

  // Thresholds are set before either piece changes: both feel the same blow.
  const struckBreaks = energy >= breakEnergyJ(b, c.massKg[struck], c.edge[struck]);
  const strikerBreaks = energy >= breakEnergyJ(a, c.massKg[striker], c.edge[striker]);
  const pieces: number[] = [];
  if (struckBreaks) dust += breakObject(sim, struck, energy, rand, pieces);
  if (strikerBreaks) {
    c = objectColumns(store);
    if (store.isAlive(striker)) dust += breakObject(sim, striker, energy, rand, pieces);
  }
  return { pieces, struckBroke: struckBreaks, strikerBroke: strikerBreaks, sparks, dustKg: dust, energyJ: energy };
}

/** Split `slot` according to its material; new pieces are pushed onto `out`. Returns the mass lost as grit. */
function breakObject(sim: Sim, slot: number, energy: number, rand: () => number, out: number[]): number {
  const store = sim.state.store(OBJECT_STORE);
  let c = objectColumns(store);
  const material = c.material[slot];
  const spec = MATERIALS[material];
  const mass = c.massKg[slot];
  const length = c.lengthM[slot];
  const threshold = breakEnergyJ(material, mass, c.edge[slot]);
  const x = c.x[slot];
  const y = c.y[slot];
  const shares: number[] = [];
  const edges: number[] = [];
  let flaked = false;

  if (spec.fracture === Fracture.CONCHOIDAL) {
    if (energy >= K.shatterRatio * threshold) {
      const s1 = 0.2 + 0.3 * rand();
      const s2 = (1 - s1) * (0.3 + 0.4 * rand());
      shares.push(1 - s1 - s2, s1, s2);
      for (let p = 0; p < 3; p++) edges.push(spec.freshEdge * (0.6 + 0.4 * rand()));
    } else {
      const over = energy / threshold;
      const f = (0.02 + 0.08 * rand()) * (over < 2 ? over : 2);
      const coreEdge = c.edge[slot] > spec.freshEdge * 0.5 ? c.edge[slot] : spec.freshEdge * 0.5;
      shares.push(1 - f, f);
      edges.push(coreEdge, spec.freshEdge * (0.7 + 0.3 * rand()));
      flaked = true;
    }
  } else if (spec.fracture === Fracture.GRANULAR) {
    const f = 0.25 + 0.5 * rand();
    shares.push(1 - f, f);
    edges.push(spec.freshEdge * (0.5 + 0.5 * rand()), spec.freshEdge * (0.5 + 0.5 * rand()));
  } else if (spec.fracture === Fracture.SPLINTERING) {
    const f = 0.3 + 0.4 * rand();
    shares.push(1 - f, f);
    edges.push(spec.freshEdge * (0.6 + 0.4 * rand()), spec.freshEdge * (0.6 + 0.4 * rand()));
  } else if (spec.fracture === Fracture.FIBROUS) {
    const f = 0.2 + 0.6 * rand();
    shares.push(1 - f, f);
    edges.push(spec.freshEdge * rand(), spec.freshEdge * rand());
  } else {
    return 0;
  }

  let dust = 0;
  for (let p = 0; p < shares.length; p++) {
    const m = mass * shares[p];
    let len: number;
    if (spec.fracture === Fracture.FIBROUS) len = length * shares[p];
    else if (spec.fracture === Fracture.SPLINTERING) len = length * (0.5 + 0.5 * shares[p]);
    else len = stoneLength(material, m, flaked && p === 1);
    if (p === 0) {
      // The first share stays in the original object.
      c = objectColumns(store);
      if (m < K.leastPieceKg) {
        dust += m;
        store.remove(slot);
        continue;
      }
      c.massKg[slot] = m;
      c.lengthM[slot] = len;
      c.edge[slot] = edges[p];
      continue;
    }
    if (m < K.leastPieceKg) {
      dust += m;
      continue;
    }
    out.push(placeObject(sim, material, x, y, m, len, edges[p]));
  }
  return dust;
}

// ---------------------------------------------------------------- cover

export interface Shelter {
  /** Share of the wind kept off, 0 to 1. */
  readonly wind: number;
  /** Share of the rain kept off. */
  readonly rain: number;
  /** Share of the open night sky hidden (what draws heat away by radiation). */
  readonly sky: number;
  /** How far the air is held toward the year's mean temperature (deep rock does this). */
  readonly buffered: number;
}

/** Spot in a cell where its rock shelter is, from a hash of the seed and the cell. */
export function rockShelterSpot(sim: Sim, cell: number): { x: number; y: number } {
  const { widthCells: W, cellSizeM } = sim.config.world;
  const i = cell % W;
  const j = (cell - i) / W;
  const key = fieldKey(sim.config.seed, SALT_SPOT);
  return {
    x: (i + 0.2 + 0.6 * hash01(key, 2 * cell)) * cellSizeM,
    y: (j + 0.2 + 0.6 * hash01(key, 2 * cell + 1)) * cellSizeM,
  };
}

/** Cover at the point (x, y), from rock, from trees and shrubs, and from objects lying piled near it. */
export function shelterAt(sim: Sim, x: number, y: number): Shelter {
  const world = sim.state.world;
  const k = cellOf(sim, x, y);
  const open = { wind: 1, rain: 1, sky: 1 };
  let buffered = 0;
  function add(wind: number, rain: number, sky: number): void {
    open.wind *= 1 - wind;
    open.rain *= 1 - rain;
    open.sky *= 1 - sky;
  }
  const rock = world.layer<Uint8Array>(MATERIAL_LAYERS.rockShelter)[k];
  if (rock !== RockShelter.NONE) {
    const spot = rockShelterSpot(sim, k);
    const dx = x - spot.x;
    const dy = y - spot.y;
    if (dx * dx + dy * dy <= K.rockShelterRadiusM * K.rockShelterRadiusM) {
      if (rock === RockShelter.CAVE) {
        add(0.9, 1, 1);
        buffered = 0.8;
      } else {
        add(0.4, 0.8, 0.6);
        buffered = 0.2;
      }
    }
  }
  const trees = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('nut')]))[k];
  const shrubs = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('berry')]))[k];
  add(0.5 * trees, 0.25 * trees, 0.5 * trees);
  add(0.2 * shrubs, 0.05 * shrubs, 0.1 * shrubs);

  // Objects lying near the point: long wood stands as a frame; skins, grass, and reed laid on it cover it.
  const store = sim.state.store(OBJECT_STORE);
  if (store.count > 0) {
    const c = objectColumns(store);
    const r2 = K.pileRadiusM * K.pileRadiusM;
    let frame = 0;
    let hide = 0;
    let thatch = 0;
    const end = store.highWater;
    for (let s = 0; s < end; s++) {
      if (!store.isAlive(s) || c.holder[s] !== 0) continue;
      const dx = c.x[s] - x;
      const dy = c.y[s] - y;
      if (dx * dx + dy * dy > r2) continue;
      const m = c.material[s];
      if (m === Material.WOOD && c.lengthM[s] >= K.frameLengthM) frame += c.massKg[s];
      else if (m === Material.HIDE) hide += c.massKg[s];
      else if (m === Material.DRY_GRASS || m === Material.REED) thatch += c.massKg[s];
    }
    if (frame > 0) {
      const f = frame < K.fullFrameKg ? frame / K.fullFrameKg : 1;
      const cover = hide / K.fullHideKg + thatch / K.fullThatchKg;
      const v = cover < 1 ? cover : 1;
      add(f * (0.4 + 0.5 * v), f * v * 0.95, f * (0.3 + 0.6 * v));
    }
  }
  return { wind: 1 - open.wind, rain: 1 - open.rain, sky: 1 - open.sky, buffered };
}

// ---------------------------------------------------------------- setup

function placeMaterials(sim: Sim): void {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM } = config.world;
  const N = W * H;
  const world = state.world;
  const seed = config.seed;
  const soil = world.layer<Uint8Array>(TERRAIN_LAYERS.soil);
  const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
  const drain = world.layer<Int32Array>(TERRAIN_LAYERS.drain);
  const gravel = new Float64Array(3 * N);
  const bedrock = world.layer<Uint8Array>(MATERIAL_LAYERS.bedrock);
  const shelter = world.layer<Uint8Array>(MATERIAL_LAYERS.rockShelter);
  const stones = STONE_KINDS.map((m) => world.layer<Uint16Array>(stoneLayer(m)));
  const slope = steepestSlope(W, H, cellSizeM, elevation);
  const rockKinds = [Material.GRANITE, Material.QUARTZITE, Material.LIMESTONE, Material.SANDSTONE];
  const rockKeys = rockKinds.map((_, n) => fieldKey(seed, SALT_BEDROCK + n));
  const jitterKey = fieldKey(seed, SALT_JITTER);
  const flintKey = fieldKey(seed, SALT_FLINT);
  const pyriteKey = fieldKey(seed, SALT_PYRITE);
  const shelterKey = fieldKey(seed, SALT_SHELTER);
  const wl = K.bedrockWavelengthCells;
  const at = (m: number) => STONE_KINDS.indexOf(m);

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      // Bedrock: whichever of four patch fields is highest here; sand lies on sandstone.
      let rock: number = Material.SANDSTONE;
      if (soil[k] !== Soil.SAND) {
        let best = -Infinity;
        for (let n = 0; n < rockKinds.length; n++) {
          const v = fractal(rockKeys[n], i / wl, j / wl, K.bedrockOctaves);
          if (v > best) {
            best = v;
            rock = rockKinds[n];
          }
        }
      }
      bedrock[k] = rock;
      let flint = 0;
      if (rock === Material.LIMESTONE) {
        const band = 0.5 + 2 * fractal(flintKey, i / 20, j / 20, 2);
        flint = K.flintShare * (band < 0 ? 0 : band > 1 ? 1 : band);
      }
      // What this cell's rock sends downstream as cobbles: its hard stone only.
      if (rock === Material.QUARTZITE) gravel[3 * k] = 1;
      else if (rock === Material.GRANITE) gravel[3 * k + 1] = 1;
      else if (rock === Material.LIMESTONE) gravel[3 * k + 2] = flint / K.flintShare;

      const w = kind[k];
      if (w !== Water.DRY) continue;
      const total = K.stonesBySoil[soil[k]] * (0.5 + hash01(jitterKey, k));
      let pyrite = 0;
      if (rock === Material.LIMESTONE || rock === Material.SANDSTONE) {
        const nodules = 4 * fractal(pyriteKey, i / 15, j / 15, 2);
        pyrite = K.pyriteShare * (nodules < 0 ? 0 : nodules > 1 ? 1 : nodules);
      }
      stones[at(Material.FLINT)][k] = Math.round(total * flint);
      stones[at(Material.PYRITE)][k] = Math.round(total * pyrite);
      stones[at(rock)][k] = Math.round(total * (1 - flint - pyrite));

      // Caves and overhangs: sinkholes in limestone anywhere, rock faces on steep ground.
      let steep = (slope[k] - K.gentleSlope) / (K.steepSlope - K.gentleSlope);
      steep = steep < 0 ? 0 : steep > 1 ? 1 : steep;
      const cave = K.caveFlatChance[rock] + K.caveSteepChance[rock] * steep;
      const h = hash01(shelterKey, k);
      if (h < cave) shelter[k] = RockShelter.CAVE;
      else if (h < cave + K.overhangSteepChance[rock] * steep) shelter[k] = RockShelter.OVERHANG;
    }
  }

  // Gravel travels down the drainage: visit cells upstream first (each cell
  // after everything that drains into it) and pass each one's gravel on.
  const pending = new Int32Array(N);
  for (let k = 0; k < N; k++) if (drain[k] >= 0) pending[drain[k]]++;
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < N; k++) if (pending[k] === 0) queue[tail++] = k;
  while (head < tail) {
    const k = queue[head++];
    const down = drain[k];
    if (down < 0) continue;
    gravel[3 * down] += gravel[3 * k];
    gravel[3 * down + 1] += gravel[3 * k + 1];
    gravel[3 * down + 2] += gravel[3 * k + 2];
    if (--pending[down] === 0) queue[tail++] = down;
  }
  // River beds hold cobbles in the mix of their catchment, and so do the banks beside them.
  const cobbleKinds = [Material.QUARTZITE, Material.GRANITE, Material.FLINT];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (kind[k] !== Water.RIVER) continue;
      const sum = gravel[3 * k] + gravel[3 * k + 1] + gravel[3 * k + 2];
      if (sum <= 0) continue;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          const bed = n === k;
          if (!bed && kind[n] !== Water.DRY) continue;
          const total = (bed ? K.riverCobbles : K.riverbankCobbles) * (0.5 + hash01(jitterKey, n));
          for (let q = 0; q < 3; q++) {
            const layer = stones[at(cobbleKinds[q])];
            const add = Math.round((total * gravel[3 * k + q]) / sum);
            layer[n] = layer[n] + add > 65535 ? 65535 : layer[n] + add;
          }
        }
      }
    }
  }

  // Dead wood starts near where falling and rotting would balance in an average year.
  const deadwood = world.layer<Float32Array>(MATERIAL_LAYERS.deadwood);
  const moisture = world.layer<Float32Array>(MOISTURE_LAYER);
  const trees = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('nut')]));
  const shrubs = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('berry')]));
  const hectares = (cellSizeM * cellSizeM) / 10000;
  const wood = MATERIALS[Material.WOOD].decayPerDayAt10C;
  for (let k = 0; k < N; k++) {
    if (kind[k] !== Water.DRY) continue;
    const fall = ((trees[k] * K.treeDeadwoodKgPerHaYear + shrubs[k] * K.shrubDeadwoodKgPerHaYear) * hectares) / 365;
    if (fall <= 0) continue;
    const t = CLIMATE_CONSTANTS.meanTemperatureC - CLIMATE_CONSTANTS.lapseRatePerM * (elevation[k] - CLIMATE_CONSTANTS.referenceElevationM);
    const rate = wood * pow(2, (t - 10) / 10) * (K.dryDecayShare + (1 - K.dryDecayShare) * moisture[k]);
    deadwood[k] = fall / rate;
  }
}

// ---------------------------------------------------------------- the system

// ALIBI: dead wood falls and rots, bones weather, skins rot, and stone lies where bedrock
// breaks up, whether or not anything ever picks any of it up.
export const materials: SystemDef = defineSystem({
  name: 'world.materials',
  declare(state: SimState) {
    const world = state.world;
    world.ensureLayer(MATERIAL_LAYERS.bedrock, 'u8');
    for (const m of STONE_KINDS) world.ensureLayer(stoneLayer(m), 'u16');
    world.ensureLayer(MATERIAL_LAYERS.rockShelter, 'u8');
    world.ensureLayer(MATERIAL_LAYERS.deadwood, 'f32');
    world.ensureLayer(MATERIAL_LAYERS.bone, 'f32');
    world.ensureLayer(MATERIAL_LAYERS.hide, 'f32');
    world.ensureLayer(TERRAIN_LAYERS.soil, 'u8');
    world.ensureLayer(TERRAIN_LAYERS.waterKind, 'u8');
    world.ensureLayer(TERRAIN_LAYERS.elevation, 'f32');
    world.ensureLayer(TERRAIN_LAYERS.drain, 'i32');
    world.ensureLayer(MOISTURE_LAYER, 'f32');
    declareObjects(state);
  },
  init: placeMaterials,
  create(sim: Sim) {
    const { config, state } = sim;
    const { widthCells: W, heightCells: H, cellSizeM } = config.world;
    const N = W * H;
    const ticksPerDay = config.time.ticksPerDay;
    const world = state.world;
    const kind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const moisture = world.layer<Float32Array>(MOISTURE_LAYER);
    const deadwood = world.layer<Float32Array>(MATERIAL_LAYERS.deadwood);
    const bone = world.layer<Float32Array>(MATERIAL_LAYERS.bone);
    const hide = world.layer<Float32Array>(MATERIAL_LAYERS.hide);
    const trees = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('nut')]));
    const shrubs = world.layer<Float32Array>(coverLayer(PLANT_SPECIES[speciesIndex('berry')]));
    const store = state.store(OBJECT_STORE);
    const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weather || !weather.readings) throw new Error('world.materials needs world.climate earlier in the pipeline.');
    const weatherValues = weather.readings();
    const lapse = CLIMATE_CONSTANTS.lapseRatePerM;
    const reference = CLIMATE_CONSTANTS.referenceElevationM;
    const hectares = (cellSizeM * cellSizeM) / 10000;
    const every = K.deadwoodEveryDays;
    const treeFall = (K.treeDeadwoodKgPerHaYear * hectares) / 365;
    const shrubFall = (K.shrubDeadwoodKgPerHaYear * hectares) / 365;
    const dry = K.dryDecayShare;
    // Derived cache (never saved): each cell's warmth factor relative to the reference height.
    let heightFactor: Float32Array | null = null;

    /** Organic decay multiplier at cell k today: doubling every 10 °C, nothing at or below freezing, slower when dry. */
    function decayFactor(k: number, atReference: number, dayFactor: number, hf: Float32Array): number {
      const t = atReference - lapse * (elevation[k] - reference);
      if (t <= 0) return 0;
      return dayFactor * hf[k] * (dry + (1 - dry) * moisture[k]);
    }

    return () => {
      const tick = state.tick;
      if (tick % ticksPerDay !== 0) return;
      if (heightFactor === null) {
        heightFactor = new Float32Array(N);
        for (let k = 0; k < N; k++) heightFactor[k] = pow(2, (-lapse * (elevation[k] - reference)) / 10);
      }
      const hf = heightFactor;
      const day = tick / ticksPerDay;
      const atReference = dailyMeanTemperatureC(config, tick, weatherValues, reference);
      const dayFactor = pow(2, (atReference - 10) / 10);
      const woodRate = MATERIALS[Material.WOOD].decayPerDayAt10C;
      const boneRate = MATERIALS[Material.BONE].decayPerDayAt10C;
      const hideRate = MATERIALS[Material.HIDE].decayPerDayAt10C;
      const quarter = day % every;

      for (let j = 0; j < H; j++) {
        const row = j * W;
        for (let i = 0; i < W; i++) {
          const k = row + i;
          if (kind[k] !== Water.DRY) continue;
          // Dead wood: a quarter of the cells each day, with four days of change, in a 2 × 2 pattern.
          if ((((j & 1) << 1) | (i & 1)) === quarter) {
            const fall = trees[k] * treeFall + shrubs[k] * shrubFall;
            const w = deadwood[k];
            if (fall > 0 || w > 0) {
              let lost = every * woodRate * decayFactor(k, atReference, dayFactor, hf);
              if (lost > 1) lost = 1;
              const next = w - w * lost + every * fall;
              deadwood[k] = next < K.leastKg ? 0 : next;
            }
          }
          // Bone weathers; skin rots.
          if (bone[k] > 0) {
            let lost = boneRate * decayFactor(k, atReference, dayFactor, hf);
            if (lost > 1) lost = 1;
            const next = bone[k] * (1 - lost);
            bone[k] = next < K.leastKg ? 0 : next;
          }
          if (hide[k] > 0) {
            let lost = hideRate * decayFactor(k, atReference, dayFactor, hf);
            if (lost > 1) lost = 1;
            const next = hide[k] * (1 - lost);
            hide[k] = next < K.leastKg ? 0 : next;
          }
        }
      }

      // Objects rot or weather where they are; held ones too.
      if (store.count > 0) {
        const c = objectColumns(store);
        const end = store.highWater;
        for (let s = 0; s < end; s++) {
          if (!store.isAlive(s)) continue;
          const rate = MATERIALS[c.material[s]].decayPerDayAt10C;
          if (rate <= 0) continue;
          let lost = rate * decayFactor(cellOf(sim, c.x[s], c.y[s]), atReference, dayFactor, hf);
          if (lost > 1) lost = 1;
          const next = c.integrity[s] - lost;
          if (next <= 0) store.remove(s);
          else c.integrity[s] = next;
        }
      }
    };
  },
});
