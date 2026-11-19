// Materials and objects: what things are made of, what striking one thing on
// another does, and how lying material keeps off wind and rain.
// Design: docs/DESIGN.md §2.8 and §2.15.
//
// Objects have physical attributes and never use-labels. Loose material lying
// in the open (stones, fallen wood) is kept as kilograms per cell; it becomes an
// individual object only when something picks a piece up (Phase 3), and the
// physics below then applies to that object.

import { exp, log, pow } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { STREAM_WORDS, StreamDomain, nextFloat, seedStream } from '../core/rng.ts';
import { BucketGrid } from '../core/spatial.ts';
import { spawnEntity } from '../sim.ts';
import type { Sim, SimState } from '../sim.ts';
import { CLIMATE_CONSTANTS, CLIMATE_PARTS, MOISTURE_LAYER, dailyMeanTemperatureC } from './climate.ts';
import { seasonFraction } from './light.ts';
import { fieldKey, fractal } from './noise.ts';
import { PLANT_SPECIES, coverLayer } from './plants.ts';
import { Soil, TERRAIN_LAYERS, Water, steepestSlope } from './terrain.ts';

// ---------------------------------------------------------------- the catalogue

/** Material ids. Part of what a seed and a snapshot mean: never renumber. */
export const Material = {
  FLINT: 1,
  QUARTZITE: 2,
  GRANITE: 3,
  LIMESTONE: 4,
  SANDSTONE: 5,
  PYRITE: 6,
  WOOD: 7,
  HIDE: 8,
} as const;

/** How a material fails when struck. */
export const Fracture = {
  /** Breaks along smooth curved surfaces, so a blow can detach a thin piece with a keen edge. */
  CONCHOIDAL: 1,
  /** Crumbles at the surface or splits into blunt lumps. */
  GRANULAR: 2,
  /** Snaps along the grain into splintered pieces. */
  FIBROUS: 3,
  /** Bends and does not break. */
  PLIABLE: 4,
} as const;

export interface MaterialSpec {
  readonly name: string;
  readonly id: number;
  readonly densityKgM3: number;
  /** Bulk hardness, roughly on Mohs' scale (talc 1, quartz 7). Decides which of two struck things takes the damage. */
  readonly hardness: number;
  readonly fracture: number;
  /** Conchoidal: least energy that must reach the piece for a blow to detach a flake, J. */
  readonly flakeEnergyJ: number;
  /** Energy per kg of the piece that breaks it apart (shatters, splits, or snaps), J/kg. */
  readonly breakEnergyJPerKg: number;
  /** Granular: kilograms knocked off as crumbs per joule absorbed by a blow too weak to split the piece. */
  readonly crumbleKgPerJ: number;
  /** Sharpness of a fresh fracture edge, 0 (round) to 1 (keen). */
  readonly freshEdge: number;
  /** Sharpness of a piece as found lying in the open, weathered or worn. */
  readonly weatheredEdge: number;
  /** 1 if particles shaved off it burn in air (iron sulfide), making hot sparks; 0 otherwise. */
  readonly sparkFuel: number;
  /** How readily it catches fire when dry, 0 to 1 (read by fire, Phase 1.8). */
  readonly flammability: number;
  /** Heat released by burning it dry, MJ/kg. */
  readonly fuelMJPerKg: number;
  /** Insulation when wrapped around a body, clo per kg (read by bodies, Phase 2). */
  readonly insulationCloPerKg: number;
  /** Wind screen a kilogram makes when piled or leaned, m². */
  readonly coverM2PerKg: number;
  /** Share of rain that screen keeps off when it is overhead. */
  readonly shedsRain: number;
  /** True if pieces stand up on their own when piled (stones stack; poles lean); false if it lies flat (hide). */
  readonly standsUp: boolean;
  /** Share of a piece's integrity lost per real day at 12 °C on half-wet ground (hide). 0 = does not rot this way. */
  readonly rotPerRealDay: number;
}

// Numbers are estimates unless docs/RESEARCH.md (*Materials*) says otherwise.
export const MATERIALS: readonly MaterialSpec[] = Object.freeze([
  {
    name: 'flint',
    id: Material.FLINT,
    densityKgM3: 2600,
    hardness: 7,
    fracture: Fracture.CONCHOIDAL,
    flakeEnergyJ: 3,
    breakEnergyJPerKg: 300,
    crumbleKgPerJ: 0,
    freshEdge: 0.95,
    weatheredEdge: 0.1,
    sparkFuel: 0,
    flammability: 0,
    fuelMJPerKg: 0,
    insulationCloPerKg: 0,
    coverM2PerKg: 0.002,
    shedsRain: 0,
    standsUp: true,
    rotPerRealDay: 0,
  },
  {
    name: 'quartzite',
    id: Material.QUARTZITE,
    densityKgM3: 2650,
    hardness: 7,
    fracture: Fracture.CONCHOIDAL,
    flakeEnergyJ: 10,
    breakEnergyJPerKg: 500,
    crumbleKgPerJ: 0,
    freshEdge: 0.65,
    weatheredEdge: 0.05,
    sparkFuel: 0,
    flammability: 0,
    fuelMJPerKg: 0,
    insulationCloPerKg: 0,
    coverM2PerKg: 0.002,
    shedsRain: 0,
    standsUp: true,
    rotPerRealDay: 0,
  },
  {
    name: 'granite',
    id: Material.GRANITE,
    densityKgM3: 2700,
    hardness: 6,
    fracture: Fracture.GRANULAR,
    flakeEnergyJ: 0,
    breakEnergyJPerKg: 400,
    crumbleKgPerJ: 0.00005,
    freshEdge: 0.2,
    weatheredEdge: 0.02,
    sparkFuel: 0,
    flammability: 0,
    fuelMJPerKg: 0,
    insulationCloPerKg: 0,
    coverM2PerKg: 0.002,
    shedsRain: 0,
    standsUp: true,
    rotPerRealDay: 0,
  },
  {
    name: 'limestone',
    id: Material.LIMESTONE,
    densityKgM3: 2500,
    hardness: 3,
    fracture: Fracture.GRANULAR,
    flakeEnergyJ: 0,
    breakEnergyJPerKg: 120,
    crumbleKgPerJ: 0.0008,
    freshEdge: 0.15,
    weatheredEdge: 0.03,
    sparkFuel: 0,
    flammability: 0,
    fuelMJPerKg: 0,
    insulationCloPerKg: 0,
    coverM2PerKg: 0.002,
    shedsRain: 0,
    standsUp: true,
    rotPerRealDay: 0,
  },
  {
    name: 'sandstone',
    id: Material.SANDSTONE,
    densityKgM3: 2300,
    hardness: 4.5,
    fracture: Fracture.GRANULAR,
    flakeEnergyJ: 0,
    breakEnergyJPerKg: 100,
    crumbleKgPerJ: 0.0015,
    freshEdge: 0.1,
    weatheredEdge: 0.02,
    sparkFuel: 0,
    flammability: 0,
    fuelMJPerKg: 0,
    insulationCloPerKg: 0,
    coverM2PerKg: 0.002,
    shedsRain: 0,
    standsUp: true,
    rotPerRealDay: 0,
  },
  {
    name: 'pyrite',
    id: Material.PYRITE,
    densityKgM3: 5000,
    hardness: 6.25,
    fracture: Fracture.CONCHOIDAL,
    flakeEnergyJ: 4,
    breakEnergyJPerKg: 150,
    crumbleKgPerJ: 0,
    freshEdge: 0.4,
    weatheredEdge: 0.05,
    sparkFuel: 1,
    flammability: 0,
    fuelMJPerKg: 0,
    insulationCloPerKg: 0,
    coverM2PerKg: 0.001,
    shedsRain: 0,
    standsUp: true,
    rotPerRealDay: 0,
  },
  {
    name: 'wood',
    id: Material.WOOD,
    densityKgM3: 500,
    hardness: 2.5,
    fracture: Fracture.FIBROUS,
    flakeEnergyJ: 0,
    breakEnergyJPerKg: 15,
    crumbleKgPerJ: 0,
    freshEdge: 0.3,
    weatheredEdge: 0.05,
    sparkFuel: 0,
    flammability: 0.6,
    fuelMJPerKg: 16,
    insulationCloPerKg: 0,
    coverM2PerKg: 0.03,
    shedsRain: 0.3,
    standsUp: true,
    // Wood rots on the plants' clock instead: see woodDecayPerYear.
    rotPerRealDay: 0,
  },
  {
    name: 'hide',
    id: Material.HIDE,
    densityKgM3: 1100,
    hardness: 1.5,
    fracture: Fracture.PLIABLE,
    flakeEnergyJ: 0,
    breakEnergyJPerKg: 0,
    crumbleKgPerJ: 0,
    freshEdge: 0,
    weatheredEdge: 0,
    sparkFuel: 0,
    flammability: 0.1,
    fuelMJPerKg: 18,
    insulationCloPerKg: 0.8,
    coverM2PerKg: 0.6,
    shedsRain: 0.95,
    standsUp: false,
    rotPerRealDay: 0.05,
  },
]);

const BY_ID: ReadonlyArray<MaterialSpec | undefined> = (() => {
  const table: Array<MaterialSpec | undefined> = [];
  for (const m of MATERIALS) table[m.id] = m;
  return Object.freeze(table);
})();

export function materialById(id: number): MaterialSpec {
  const m = BY_ID[id];
  if (!m) throw new RangeError(`There is no material ${id}.`);
  return m;
}

/** The stone materials that lie loose on the ground, in the order of their stock layers. */
export const STONE_MATERIALS: readonly MaterialSpec[] = Object.freeze(
  MATERIALS.filter((m) => m.id >= Material.FLINT && m.id <= Material.PYRITE),
);

/** Bedrock under each cell. Part of what a seed means: never renumber. */
export const Bedrock = { GRANITE: 1, LIMESTONE: 2, SANDSTONE: 3 } as const;

/** Kinds of natural rock shelter. */
export const RockShelterKind = { OVERHANG: 1, CAVE: 2 } as const;

// ---------------------------------------------------------------- layers, stores, constants

export const MATERIAL_LAYERS = {
  bedrock: 'materials.bedrock',
  /** Fallen wood thinner or shorter than a pole: twigs, sticks, branches under 1.5 m. kg per cell. */
  smallWood: 'materials.wood.small',
  /** Fallen branches and trunks 1.5 m or longer. kg per cell. */
  longWood: 'materials.wood.long',
  /** Fine dead plant matter: cured grass, dead herbs, fallen leaves (the fuel fire spreads in, §2.16). kg per cell. */
  litter: 'materials.litter',
} as const;

/** Name of the layer holding kilograms of loose, hand-sized stone of one material per cell. */
export function stoneLayer(material: MaterialSpec): string {
  return `materials.stone.${material.name}`;
}

/**
 * The day (plus one) each cell last burned; 0 if never. Kept by world.fire (§2.16) and read here,
 * named here rather than imported to avoid a circular import (a test checks the two names match).
 */
export const LAST_BURN_LAYER = 'fire.lastBurnDay';

export const OBJECT_STORE = 'objects';
export const ROCK_SHELTER_STORE = 'rockShelters';

export const MATERIAL_CONSTANTS = {
  /** Loose hand-sized stone lying on the surface, kg per hectare, by soil (rock, thin, loam, alluvium, sand). */
  looseStonePerHa: [30000, 8000, 300, 1500, 100],
  /** River beds and gravel bars, and spring heads, kg per hectare. Lakes: none within reach. */
  riverStonePerHa: 20000,
  springStonePerHa: 2000,
  /** Wavelength of the bedrock pattern, m, and the noise level that separates the three kinds. */
  bedrockWavelengthM: 15000,
  bedrockSplit: 0.12,
  /** Wavelength of the patchiness of nodules (flint, pyrite) in limestone, m. */
  noduleWavelengthM: 2000,
  /**
   * Share of loose stone mass by material over each bedrock, before nodule patchiness.
   * Order: flint, quartzite, granite, limestone, sandstone, pyrite.
   */
  stoneShares: {
    granite: [0, 0.05, 0.95, 0, 0, 0],
    limestone: [0.18, 0, 0, 0.8, 0, 0.001],
    sandstone: [0, 0.15, 0, 0, 0.85, 0],
  },
  /** Stones carried and rolled by water: how well each survives (flint ... pyrite). Soft stones wear away; pyrite rusts and breaks up. */
  waterSurvival: [2, 2, 1.5, 0.5, 0.5, 0],
  /** Fallen wood added per compressed year per unit of cover, kg/ha: nut trees and berry bushes. */
  treeSmallWoodPerHa: 1500,
  treeLongWoodPerHa: 1500,
  bushSmallWoodPerHa: 400,
  /**
   * Fine dead plant matter added per compressed year at full cover, kg/ha, by plant species
   * (§2.16). It falls during the dying-back season and rots at `litterDecayPerYear`.
   */
  litterKgHaPerYear: { grass: 3000, tuber: 500, berry: 1500, nut: 3000, greens: 1000, bitterRoot: 500, nightshade: 500, reed: 6000 } as Readonly<Record<string, number>>,
  /** Season fractions between which plants die back and drop it (late summer to late autumn). */
  litterFallStart: 0.45,
  litterFallEnd: 0.7,
  /** Share of fine dead matter that rots per compressed year at reference conditions. */
  litterDecayPerYear: 0.6,
  /** Thickness of a typical piece in each wood stock, m: sets how fast it rots (woodDecayPerYear). */
  smallWoodThicknessM: 0.03,
  longWoodThicknessM: 0.08,
  /** Rock shelters per cell where the slope is steep enough, by bedrock (granite, limestone, sandstone). */
  shelterPerSteepCell: [0.01, 0.04, 0.03],
  /** Slope where rock shelters start to appear, and the extra slope over which they reach full frequency. */
  shelterSlopeFrom: 0.12,
  shelterSlopeSpan: 0.25,
  /** Caves opening on gentle limestone ground (sinkholes, karst), per cell regardless of slope. */
  karstCavePerCell: 0.002,
  /** Share of limestone shelters that are caves; of sandstone ones; granite has overhangs only. */
  caveShareLimestone: 0.4,
  caveShareSandstone: 0.05,
  /** Floor area of shelters, m²: overhangs and caves, least and most. */
  overhangAreaM2: [6, 40],
  caveAreaM2: [20, 150],
  /** Lying objects within this distance of a point screen it, m. */
  pileReachM: 3,
  /** Screen and rain cover at which a pile's protection is half its most, m². */
  pileWindHalfM2: 6,
  pileRainHalfM2: 4,
  /** Most a pile can protect. */
  pileMost: 0.9,
  /** A covering that lies flat can only be held up over this many m² per m² of standing screen. */
  coveringPerSupport: 2,
} as const;
const K = MATERIAL_CONSTANTS;

/**
 * Share of wind and rain kept off, and of the sky hidden, for each kind of rock shelter.
 * Rows: overhang, cave. Columns: wind, rain, sky.
 */
export const ROCK_SHELTER_PROTECTION: Readonly<Record<number, readonly [number, number, number]>> = {
  [RockShelterKind.OVERHANG]: [0.5, 0.85, 0.6],
  [RockShelterKind.CAVE]: [0.95, 1, 1],
};

const SALT_BEDROCK = 0x6265_6472;
const SALT_NODULES = 0x6e6f_6475;
const SALT_SHELTERS = 0x7368_656c;
const SALT_PYRITE = 0x7079_7269;

/** Share of a wood piece's integrity lost per compressed year at reference conditions; thicker wood rots slower. */
export function woodDecayPerYear(thicknessM: number): number {
  const r = thicknessM <= 0.03 ? 1 : 0.03 / thicknessM;
  return 0.25 * r * Math.sqrt(r);
}

/** How fast things rot here compared with 12 °C on half-wet ground: warmth times wetness. */
export function rotFactor(temperatureC: number, soilMoisture: number): number {
  const warm = temperatureC <= 0 ? 0 : temperatureC >= 30 ? 2.5 : temperatureC / 12;
  return warm * (0.4 + 1.2 * soilMoisture);
}

/** Thickness of a roughly round piece from its mass, length and density, m. */
export function thicknessOf(massKg: number, lengthM: number, densityKgM3: number): number {
  if (!(lengthM > 0)) return 0;
  return Math.sqrt((4 * massKg) / (Math.PI * densityKgM3 * lengthM));
}

// ---------------------------------------------------------------- objects

function declareObjects(state: SimState): void {
  const store = state.addStore(OBJECT_STORE);
  store.ensureColumn({ name: 'material', dtype: 'u8', category: 'identity' });
  store.ensureColumn({ name: 'x', dtype: 'f64', category: 'body' });
  store.ensureColumn({ name: 'y', dtype: 'f64', category: 'body' });
  for (const name of ['mass', 'length', 'edge', 'integrity']) store.ensureColumn({ name, dtype: 'f32', category: 'body' });
  // Id of the agent holding it; 0 while it lies on the ground.
  store.ensureColumn({ name: 'holder', dtype: 'u32', category: 'body' });

  const shelters = state.addStore(ROCK_SHELTER_STORE);
  shelters.ensureColumn({ name: 'kind', dtype: 'u8', category: 'identity' });
  shelters.ensureColumn({ name: 'x', dtype: 'f64', category: 'body' });
  shelters.ensureColumn({ name: 'y', dtype: 'f64', category: 'body' });
  shelters.ensureColumn({ name: 'area', dtype: 'f32', category: 'body' });
}

/**
 * Put a new object into the world, lying on the ground. The building block for pieces that
 * break off, pieces picked up from loose material, and (from later phases) pieces cut from a
 * carcass. Returns its slot in the objects store.
 */
export function spawnObject(sim: Sim, material: number, x: number, y: number, massKg: number, lengthM: number, edge: number): number {
  materialById(material);
  if (!(massKg > 0) || !(lengthM > 0)) throw new RangeError('spawnObject: mass and length must be positive.');
  const store = sim.state.store(OBJECT_STORE);
  const slot = spawnEntity(sim.state, store);
  store.column<Uint8Array>('material').data[slot] = material;
  store.column<Float64Array>('x').data[slot] = x;
  store.column<Float64Array>('y').data[slot] = y;
  store.column<Float32Array>('mass').data[slot] = massKg;
  store.column<Float32Array>('length').data[slot] = lengthM;
  store.column<Float32Array>('edge').data[slot] = edge < 0 ? 0 : edge > 1 ? 1 : edge;
  store.column<Float32Array>('integrity').data[slot] = 1;
  return slot;
}

/** Length of a roughly equant stone of this mass, m (a little longer than it is wide). */
function stoneLength(massKg: number, densityKgM3: number): number {
  return 1.6 * pow(massKg / densityKgM3, 1 / 3);
}

/** Length of a thin flake of this mass, m: about 12% as thick as it is long, and half as wide. */
function flakeLength(massKg: number, densityKgM3: number): number {
  return pow(massKg / (0.06 * densityKgM3), 1 / 3);
}

function cellAt(sim: Sim, x: number, y: number): number {
  const { widthCells: W, heightCells: H, cellSizeM } = sim.config.world;
  let i = Math.floor(x / cellSizeM);
  let j = Math.floor(y / cellSizeM);
  if (i < 0) i = 0;
  else if (i >= W) i = W - 1;
  if (j < 0) j = 0;
  else if (j >= H) j = H - 1;
  return j * W + i;
}

const LOG_20 = log(20);

/**
 * Take one hand-sized stone of a material from the loose stone at (x, y), as a new object lying
 * there. Its size is drawn from the given stream (0.15 to 3 kg). Returns its slot, or -1 if none
 * of that material is left in the cell. The cell's stock goes down by the stone's mass.
 */
export function takeStone(sim: Sim, material: number, x: number, y: number, s: Uint32Array, o: number): number {
  const spec = materialById(material);
  const index = STONE_MATERIALS.indexOf(spec);
  if (index < 0) throw new RangeError(`takeStone: ${spec.name} is not a loose stone.`);
  const cell = cellAt(sim, x, y);
  const stock = sim.state.world.layer<Float32Array>(stoneLayer(spec));
  let mass = 0.15 * exp(nextFloat(s, o) * LOG_20);
  if (stock[cell] < 0.05) return -1;
  if (mass > stock[cell]) mass = stock[cell];
  stock[cell] -= mass;
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind)[cell];
  // Stones from a river bed are rounded by the water.
  const edge = water === Water.DRY ? spec.weatheredEdge : 0;
  return spawnObject(sim, material, x, y, mass, stoneLength(mass, spec.densityKgM3), edge);
}

/**
 * Take one piece of fallen wood at (x, y): a stick (0.3 to 1.5 m) from the small wood, or a pole
 * (1.5 to 4 m) from the long wood. Returns its slot, or -1 if that kind of wood is gone here.
 */
export function takeWood(sim: Sim, long: boolean, x: number, y: number, s: Uint32Array, o: number): number {
  const wood = materialById(Material.WOOD);
  const cell = cellAt(sim, x, y);
  const stock = sim.state.world.layer<Float32Array>(long ? MATERIAL_LAYERS.longWood : MATERIAL_LAYERS.smallWood);
  let length = long ? 1.5 + 2.5 * nextFloat(s, o) : 0.3 + 1.2 * nextFloat(s, o);
  const thickness = long ? 0.04 + 0.08 * nextFloat(s, o) : 0.015 + 0.035 * nextFloat(s, o);
  let mass = wood.densityKgM3 * Math.PI * 0.25 * thickness * thickness * length;
  if (stock[cell] < 0.05) return -1;
  if (mass > stock[cell]) {
    length *= stock[cell] / mass;
    mass = stock[cell];
  }
  stock[cell] -= mass;
  return spawnObject(sim, Material.WOOD, x, y, mass, length, wood.weatheredEdge);
}

// ---------------------------------------------------------------- striking

export interface StrikeOutcome {
  /** Slots of new objects that broke off either piece, all lying on the ground where they fell. */
  readonly pieces: number[];
  /** Number of sparks thrown. */
  readonly sparks: number;
  /** How hot the sparks are, 0 (none, or cold flashes) to 1 (burning particles of iron sulfide). Fire (1.8) decides what they ignite. */
  readonly sparkHeat: number;
  /** Mass knocked off as crumbs and dust, gone, kg. */
  readonly crumbsKg: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Heat of the sparks when a material of hardness `h` scrapes `other`: only burning particles are hot. */
function sparkHeatOf(h: number, other: MaterialSpec): number {
  return other.sparkFuel * clamp01((h - other.hardness + 1) / 2);
}

// ALIBI: hard, brittle stone breaks along curved surfaces and leaves edges sharp enough to cut,
// and iron sulfide struck by harder stone throws burning particles. This is physics; it happens
// whether a rockfall, a hoof, or a hand brings the two together.
/**
 * Strike the object in slot `striker` against the one in slot `struck` with `energyJ` of impact
 * energy. `precision` (0 to 1) is how squarely the blow lands; a body's skill will supply it.
 * Draws from the given stream (the striking agent's own). Both objects may change: the softer
 * one takes more of the blow, edges dull against harder material, brittle stone may flake or
 * shatter, granular stone crumbles or splits, wood snaps, and iron sulfide may throw sparks.
 * Mass is conserved except for crumbs.
 */
export function strikeObjects(
  sim: Sim,
  striker: number,
  struck: number,
  energyJ: number,
  precision: number,
  s: Uint32Array,
  o: number,
): StrikeOutcome {
  const store = sim.state.store(OBJECT_STORE);
  if (striker === struck || !store.isAlive(striker) || !store.isAlive(struck)) {
    throw new RangeError('strikeObjects needs two different live objects.');
  }
  if (!(energyJ >= 0) || !(precision >= 0 && precision <= 1)) throw new RangeError('strikeObjects: bad energy or precision.');
  const materialCol = store.column<Uint8Array>('material').data;
  const a = materialById(materialCol[striker]);
  const b = materialById(materialCol[struck]);
  const pieces: number[] = [];
  let crumbsKg = 0;

  // Sparks: the harder material shaves particles off the other; only iron sulfide's burn.
  const heat = Math.max(sparkHeatOf(a.hardness, b), sparkHeatOf(b.hardness, a));
  let sparks = 0;
  if (heat > 0) sparks = Math.floor((heat * energyJ) / 8 + nextFloat(s, o));

  // The softer piece takes more of the blow.
  const total = a.hardness + b.hardness;
  const share = [(energyJ * b.hardness) / total, (energyJ * a.hardness) / total];
  const slots = [struck, striker];
  const specs = [b, a];
  const others = [a, b];
  const absorbed = [share[1], share[0]];

  for (let n = 0; n < 2; n++) {
    const slot = slots[n];
    const spec = specs[n];
    const other = others[n];
    const e = absorbed[n];
    // Columns are read afresh: spawning a piece can grow the store and replace them.
    const edgeCol = store.column<Float32Array>('edge').data;
    // An edge dulls against anything about as hard as itself.
    if (edgeCol[slot] > 0) {
      const dull = other.hardness >= spec.hardness ? 0.6 : other.hardness >= spec.hardness - 2 ? 0.85 : 0.97;
      edgeCol[slot] *= dull;
    }
    const mass = store.column<Float32Array>('mass').data[slot];
    const length = store.column<Float32Array>('length').data[slot];
    const breakJ = spec.breakEnergyJPerKg * mass;
    if (spec.fracture === Fracture.CONCHOIDAL) {
      if (e >= breakJ) {
        splitInto(sim, slot, [0.5, 0.3, 0.2], spec.freshEdge * 0.7, s, o, pieces);
      } else if (e >= spec.flakeEnergyJ && nextFloat(s, o) < precision) {
        let flakeKg = 0.002 * e;
        if (flakeKg > 0.4 * mass) flakeKg = 0.4 * mass;
        if (flakeKg >= 0.002) {
          const x = store.column<Float64Array>('x').data[slot];
          const y = store.column<Float64Array>('y').data[slot];
          store.column<Float32Array>('mass').data[slot] = mass - flakeKg;
          const piece = spawnObject(sim, spec.id, x, y, flakeKg, flakeLength(flakeKg, spec.densityKgM3), spec.freshEdge * (0.6 + 0.4 * precision));
          pieces.push(piece);
          const edges = store.column<Float32Array>('edge').data;
          if (edges[slot] < spec.freshEdge * 0.5) edges[slot] = spec.freshEdge * 0.5;
          store.column<Float32Array>('integrity').data[piece] = store.column<Float32Array>('integrity').data[slot];
        }
      }
    } else if (spec.fracture === Fracture.GRANULAR) {
      if (e >= breakJ) {
        const u = 0.3 + 0.4 * nextFloat(s, o);
        splitInto(sim, slot, [u, 1 - u], spec.freshEdge, s, o, pieces);
      } else {
        let loss = spec.crumbleKgPerJ * e;
        if (loss > 0.5 * mass) loss = 0.5 * mass;
        store.column<Float32Array>('mass').data[slot] = mass - loss;
        store.column<Float32Array>('length').data[slot] = stoneLength(mass - loss, spec.densityKgM3);
        crumbsKg += loss;
      }
    } else if (spec.fracture === Fracture.FIBROUS) {
      if (e >= breakJ) {
        const u = 0.25 + 0.5 * nextFloat(s, o);
        splitInto(sim, slot, [u, 1 - u], spec.freshEdge, s, o, pieces, length);
      } else if (breakJ > 0) {
        const integrity = store.column<Float32Array>('integrity').data;
        const left = integrity[slot] - (0.02 * e) / breakJ;
        integrity[slot] = left > 0.01 ? left : 0.01;
      }
    }
  }
  return { pieces, sparks, sparkHeat: sparks > 0 ? heat : 0, crumbsKg };
}

/**
 * Break the object in `slot` into pieces with the given mass shares (summing to 1). The object
 * keeps the first share; the rest become new objects lying where it was. Stone pieces get a
 * length from their mass; wood pieces (pass `lengthM`) split the length in the same shares.
 */
function splitInto(
  sim: Sim,
  slot: number,
  shares: readonly number[],
  edge: number,
  s: Uint32Array,
  o: number,
  pieces: number[],
  lengthM = 0,
): void {
  const store = sim.state.store(OBJECT_STORE);
  const spec = materialById(store.column<Uint8Array>('material').data[slot]);
  const mass = store.column<Float32Array>('mass').data[slot];
  const x = store.column<Float64Array>('x').data[slot];
  const y = store.column<Float64Array>('y').data[slot];
  const integrity = store.column<Float32Array>('integrity').data[slot];
  // A fresh break leaves some pieces keener than others.
  const keen = (): number => edge * (0.7 + 0.3 * nextFloat(s, o));
  let given = 0;
  for (let n = 1; n < shares.length; n++) {
    const m = mass * shares[n];
    given += m;
    const length = lengthM > 0 ? lengthM * shares[n] : stoneLength(m, spec.densityKgM3);
    const piece = spawnObject(sim, spec.id, x, y, m, length, keen());
    store.column<Float32Array>('integrity').data[piece] = integrity;
    pieces.push(piece);
  }
  const kept = mass - given;
  store.column<Float32Array>('mass').data[slot] = kept;
  store.column<Float32Array>('length').data[slot] = lengthM > 0 ? lengthM * shares[0] : stoneLength(kept, spec.densityKgM3);
  const edges = store.column<Float32Array>('edge').data;
  const e = keen();
  if (edges[slot] < e) edges[slot] = e;
}

// ---------------------------------------------------------------- shelter

/** Wind and rain kept off, and sky hidden, by plants in a cell, each 0 to 1 (DESIGN.md §2.15). */
export function canopyShelter(treeCover: number, bushCover: number, reedCover: number, season: number, out: Float64Array): void {
  // Deciduous leaves are out from mid-spring to mid-autumn (the year starts at the spring equinox).
  const leaves = season >= 0.08 && season < 0.65;
  const wind = 0.7 * treeCover + 0.35 * bushCover + 0.2 * reedCover;
  out[0] = wind < 0.9 ? wind : 0.9;
  out[1] = (leaves ? 0.3 : 0.1) * treeCover + 0.1 * bushCover;
  const sky = (leaves ? 0.85 : 0.4) * treeCover + 0.3 * bushCover;
  out[2] = sky < 1 ? sky : 1;
}

/**
 * Protection from a pile of lying objects with the given standing screen, flat covering, and
 * rain cover from standing pieces (all m²), into `out` as wind and rain kept off and sky hidden
 * (0 to 1). What keeps the rain off hides the sky.
 */
export function pileShelter(standingM2: number, coveringM2: number, standingRainM2: number, out: Float64Array): void {
  const held = coveringM2 < K.coveringPerSupport * standingM2 ? coveringM2 : K.coveringPerSupport * standingM2;
  const screen = standingM2 + held;
  const rain = standingRainM2 + held * materialById(Material.HIDE).shedsRain;
  const wind = (K.pileMost * screen) / (screen + K.pileWindHalfM2);
  const wet = (K.pileMost * rain) / (rain + K.pileRainHalfM2);
  out[0] = wind;
  out[1] = wet;
  out[2] = wet;
}

export interface ShelterProbe {
  /**
   * Protection at (x, y), metres, from rock shelters, plant cover, and lying objects, written
   * into `out` as [wind, rain, sky]: the shares of wind and rain kept off and of the sky hidden
   * (0 to 1; the sky keeps off sun and the cold of a clear night). Objects are seen as they
   * were at the first query of the tick (DESIGN.md §1.6).
   */
  at(x: number, y: number, out: Float64Array): void;
}

// ALIBI: rock overhangs, caves, dense trees, and anything piled up block wind and rain because
// of their shape; nothing about them depends on who stands behind them.
/** A reusable query of shelter for one simulation. Bodies (Phase 2) read it; it never writes state. */
export function createShelterProbe(sim: Sim): ShelterProbe {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM } = config.world;
  const objects = state.store(OBJECT_STORE);
  const shelters = state.store(ROCK_SHELTER_STORE);
  const tree = state.world.layer<Float32Array>(coverLayer(speciesNamed('nut')));
  const bush = state.world.layer<Float32Array>(coverLayer(speciesNamed('berry')));
  const reed = state.world.layer<Float32Array>(coverLayer(speciesNamed('reed')));
  const shelterGrid = new BucketGrid(W * cellSizeM, H * cellSizeM, 50);
  const objectGrid = new BucketGrid(W * cellSizeM, H * cellSizeM, 10);
  const maxReach = Math.sqrt(K.caveAreaM2[1] / Math.PI) + 0.01;
  let sheltersBuiltAt = -1;
  let objectsBuiltTick = -1;
  let objectsBuiltId = -1;
  let objectsBuiltCount = -1;
  const part = new Float64Array(3);
  const keep = new Float64Array(3);

  function fold(): void {
    for (let n = 0; n < 3; n++) keep[n] *= 1 - part[n];
  }

  return {
    at(x: number, y: number, out: Float64Array): void {
      keep[0] = 1;
      keep[1] = 1;
      keep[2] = 1;
      // Rock shelters never move once the world is built.
      if (sheltersBuiltAt !== shelters.nextId) {
        shelterGrid.build(shelters.column('x').data, shelters.column('y').data, shelters.alive.data, shelters.highWater);
        sheltersBuiltAt = shelters.nextId;
      }
      const sx = shelters.column<Float64Array>('x').data;
      const sy = shelters.column<Float64Array>('y').data;
      const area = shelters.column<Float32Array>('area').data;
      const kind = shelters.column<Uint8Array>('kind').data;
      const found = shelterGrid.query(x, y, maxReach, sx, sy);
      let best = -1;
      let bestRain = -1;
      for (let n = 0; n < found; n++) {
        const slot = shelterGrid.result[n];
        const dx = sx[slot] - x;
        const dy = sy[slot] - y;
        if (dx * dx + dy * dy > area[slot] / Math.PI) continue;
        const rain = ROCK_SHELTER_PROTECTION[kind[slot]][1];
        if (rain > bestRain) {
          bestRain = rain;
          best = slot;
        }
      }
      if (best >= 0) {
        const p = ROCK_SHELTER_PROTECTION[kind[best]];
        part[0] = p[0];
        part[1] = p[1];
        part[2] = p[2];
        fold();
      }

      const cell = cellAt(sim, x, y);
      canopyShelter(tree[cell], bush[cell], reed[cell], seasonFraction(config, state.tick), part);
      fold();

      if (objects.count > 0) {
        if (objectsBuiltTick !== state.tick || objectsBuiltId !== objects.nextId || objectsBuiltCount !== objects.count) {
          objectGrid.build(objects.column('x').data, objects.column('y').data, objects.alive.data, objects.highWater);
          objectsBuiltTick = state.tick;
          objectsBuiltId = objects.nextId;
          objectsBuiltCount = objects.count;
        }
        const ox = objects.column<Float64Array>('x').data;
        const oy = objects.column<Float64Array>('y').data;
        const material = objects.column<Uint8Array>('material').data;
        const mass = objects.column<Float32Array>('mass').data;
        const length = objects.column<Float32Array>('length').data;
        const holder = objects.column<Uint32Array>('holder').data;
        const near = objectGrid.query(x, y, K.pileReachM, ox, oy);
        let standing = 0;
        let standingRain = 0;
        let covering = 0;
        for (let n = 0; n < near; n++) {
          const slot = objectGrid.result[n];
          if (holder[slot] !== 0) continue;
          const spec = materialById(material[slot]);
          const screen = mass[slot] * spec.coverM2PerKg;
          if (spec.standsUp) {
            // Stones stack to any height; a stick screens only as high as it is long.
            const tall = spec.fracture === Fracture.FIBROUS ? (length[slot] < 1.5 ? length[slot] / 1.5 : 1) : 1;
            standing += screen * tall;
            standingRain += screen * tall * spec.shedsRain;
          } else {
            covering += screen;
          }
        }
        if (standing > 0 || covering > 0) {
          pileShelter(standing, covering, standingRain, part);
          fold();
        }
      }
      out[0] = 1 - keep[0];
      out[1] = 1 - keep[1];
      out[2] = 1 - keep[2];
    },
  };
}

/** Fine dead matter each plant species drops per compressed year at full cover, kg/ha, in catalogue order. */
function litterInputs(): number[] {
  return PLANT_SPECIES.map((sp) => {
    const kg = K.litterKgHaPerYear[sp.name];
    if (kg === undefined) throw new Error(`world.materials has no litter input for the plant species "${sp.name}".`);
    return kg;
  });
}

function speciesNamed(name: string) {
  const found = PLANT_SPECIES.find((s) => s.name === name);
  if (!found) throw new Error(`world.materials needs the plant species "${name}".`);
  return found;
}

// ---------------------------------------------------------------- building the world's loose material

function buildLooseMaterial(sim: Sim): void {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM } = config.world;
  const N = W * H;
  const world = state.world;
  const soil = world.layer<Uint8Array>(TERRAIN_LAYERS.soil);
  const water = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
  const bedrock = world.layer<Uint8Array>(MATERIAL_LAYERS.bedrock);
  const stones = STONE_MATERIALS.map((m) => world.layer<Float32Array>(stoneLayer(m)));
  const small = world.layer<Float32Array>(MATERIAL_LAYERS.smallWood);
  const long = world.layer<Float32Array>(MATERIAL_LAYERS.longWood);
  const tree = world.layer<Float32Array>(coverLayer(speciesNamed('nut')));
  const bush = world.layer<Float32Array>(coverLayer(speciesNamed('berry')));
  const litter = world.layer<Float32Array>(MATERIAL_LAYERS.litter);
  const litterCover = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
  const litterPerYear = litterInputs();
  const areaHa = (cellSizeM * cellSizeM) / 10_000;
  const rockKey = fieldKey(config.seed, SALT_BEDROCK);
  const noduleKey = fieldKey(config.seed, SALT_NODULES);
  const pyriteKey = fieldKey(config.seed, SALT_PYRITE);
  const rockScale = cellSizeM / K.bedrockWavelengthM;
  const noduleScale = cellSizeM / K.noduleWavelengthM;
  const kSmall = woodDecayPerYear(K.smallWoodThicknessM);
  const kLong = woodDecayPerYear(K.longWoodThicknessM);
  const mix = new Float64Array(STONE_MATERIALS.length);

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const n = fractal(rockKey, i * rockScale, j * rockScale, 3);
      const rock = n > K.bedrockSplit ? Bedrock.LIMESTONE : n < -K.bedrockSplit ? Bedrock.GRANITE : Bedrock.SANDSTONE;
      bedrock[k] = rock;
      const base = rock === Bedrock.LIMESTONE ? K.stoneShares.limestone : rock === Bedrock.GRANITE ? K.stoneShares.granite : K.stoneShares.sandstone;
      // Nodules come in patches, from none to twice the usual share; flint and iron sulfide in different ones.
      let patch = 1 + 2 * fractal(noduleKey, i * noduleScale, j * noduleScale, 2);
      patch = patch < 0 ? 0 : patch > 2 ? 2 : patch;
      let patchP = 1 + 4 * fractal(pyriteKey, i * noduleScale, j * noduleScale, 2);
      patchP = patchP < 0 ? 0 : patchP > 2 ? 2 : patchP;
      const w = water[k];
      let total = 0;
      for (let m = 0; m < mix.length; m++) {
        const id = STONE_MATERIALS[m].id;
        let share = base[m];
        if (id === Material.FLINT) share *= patch;
        else if (id === Material.PYRITE) share *= patchP;
        if (w === Water.RIVER || w === Water.SPRING || soil[k] === Soil.ALLUVIUM) share *= K.waterSurvival[m];
        mix[m] = share;
        total += share;
      }
      const perHa =
        w === Water.RIVER ? K.riverStonePerHa : w === Water.SPRING ? K.springStonePerHa : w === Water.LAKE ? 0 : K.looseStonePerHa[soil[k]];
      for (let m = 0; m < mix.length; m++) stones[m][k] = total > 0 ? (perHa * areaHa * mix[m]) / total : 0;
      // Fallen wood starts where input and rotting balance at reference conditions.
      if (w === Water.DRY) {
        small[k] = ((K.treeSmallWoodPerHa * tree[k] + K.bushSmallWoodPerHa * bush[k]) * areaHa) / kSmall;
        long[k] = (K.treeLongWoodPerHa * tree[k] * areaHa) / kLong;
        let input = 0;
        for (let sp = 0; sp < litterCover.length; sp++) input += litterPerYear[sp] * litterCover[sp][k];
        litter[k] = (input * areaHa) / K.litterDecayPerYear;
      }
    }
  }

  // Rock shelters, where cliffs and steep rock are, and caves in limestone.
  const slope = steepestSlope(W, H, cellSizeM, elevation);
  const stream = new Uint32Array(STREAM_WORDS);
  seedStream(stream, 0, config.seed, StreamDomain.WORLD_GEN, SALT_SHELTERS);
  const store = state.store(ROCK_SHELTER_STORE);
  for (let k = 0; k < N; k++) {
    if (water[k] !== Water.DRY) continue;
    const rock = bedrock[k];
    let steep = (slope[k] - K.shelterSlopeFrom) / K.shelterSlopeSpan;
    steep = steep < 0 ? 0 : steep > 1 ? 1 : steep;
    let chance = steep * K.shelterPerSteepCell[rock - 1];
    if (rock === Bedrock.LIMESTONE) chance += K.karstCavePerCell;
    if (!(nextFloat(stream, 0) < chance)) continue;
    const caveShare = rock === Bedrock.LIMESTONE ? K.caveShareLimestone : rock === Bedrock.SANDSTONE ? K.caveShareSandstone : 0;
    const cave = steep === 0 || nextFloat(stream, 0) < caveShare;
    const range = cave ? K.caveAreaM2 : K.overhangAreaM2;
    const slot = spawnEntity(state, store);
    const i = k % W;
    const j = (k - i) / W;
    store.column<Uint8Array>('kind').data[slot] = cave ? RockShelterKind.CAVE : RockShelterKind.OVERHANG;
    store.column<Float64Array>('x').data[slot] = (i + nextFloat(stream, 0)) * cellSizeM;
    store.column<Float64Array>('y').data[slot] = (j + nextFloat(stream, 0)) * cellSizeM;
    store.column<Float32Array>('area').data[slot] = range[0] + (range[1] - range[0]) * nextFloat(stream, 0);
  }
}

// ---------------------------------------------------------------- the system

// ALIBI: rock weathers into loose stone of whatever the bedrock is, trees and bushes drop dead
// wood that rots faster when warm and wet, and cliffs have overhangs and caves, all whether or
// not anything ever lives there.
export const materials: SystemDef = defineSystem({
  name: 'world.materials',
  declare(state: SimState) {
    const world = state.world;
    world.ensureLayer(MATERIAL_LAYERS.bedrock, 'u8');
    for (const m of STONE_MATERIALS) world.ensureLayer(stoneLayer(m), 'f32');
    world.ensureLayer(MATERIAL_LAYERS.smallWood, 'f32');
    world.ensureLayer(LAST_BURN_LAYER, 'f32');
    world.ensureLayer(MATERIAL_LAYERS.longWood, 'f32');
    world.ensureLayer(MATERIAL_LAYERS.litter, 'f32');
    world.ensureLayer(TERRAIN_LAYERS.soil, 'u8');
    world.ensureLayer(TERRAIN_LAYERS.waterKind, 'u8');
    world.ensureLayer(TERRAIN_LAYERS.elevation, 'f32');
    world.ensureLayer(MOISTURE_LAYER, 'f32');
    declareObjects(state);
  },
  init(sim: Sim) {
    buildLooseMaterial(sim);
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const { widthCells: W, heightCells: H, cellSizeM } = config.world;
    const N = W * H;
    const { ticksPerDay, daysPerYear } = config.time;
    const world = state.world;
    const water = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const moisture = world.layer<Float32Array>(MOISTURE_LAYER);
    const small = world.layer<Float32Array>(MATERIAL_LAYERS.smallWood);
    const long = world.layer<Float32Array>(MATERIAL_LAYERS.longWood);
    const tree = world.layer<Float32Array>(coverLayer(speciesNamed('nut')));
    const bush = world.layer<Float32Array>(coverLayer(speciesNamed('berry')));
    const objects = state.store(OBJECT_STORE);
    const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weather || !weather.readings) throw new Error('world.materials needs world.climate earlier in the pipeline.');
    const weatherValues = weather.readings();
    const lapse = CLIMATE_CONSTANTS.lapseRatePerM;
    const reference = CLIMATE_CONSTANTS.referenceElevationM;
    const areaHa = (cellSizeM * cellSizeM) / 10_000;
    // Fallen wood is part of the trees' life history, so it runs on the compressed year (§2.15).
    const smallIn = (K.treeSmallWoodPerHa * areaHa) / daysPerYear;
    const bushIn = (K.bushSmallWoodPerHa * areaHa) / daysPerYear;
    const longIn = (K.treeLongWoodPerHa * areaHa) / daysPerYear;
    const smallOut = woodDecayPerYear(K.smallWoodThicknessM) / daysPerYear;
    const longOut = woodDecayPerYear(K.longWoodThicknessM) / daysPerYear;
    const wood = materialById(Material.WOOD);
    const litter = world.layer<Float32Array>(MATERIAL_LAYERS.litter);
    const litterCover = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
    // Litter falls only in the dying-back season, so a day in it carries the whole year's input ÷ the season's days.
    const fallDays = (K.litterFallEnd - K.litterFallStart) * daysPerYear;
    const litterIn = litterInputs().map((kg) => (kg * areaHa) / fallDays);
    const litterOut = K.litterDecayPerYear / daysPerYear;
    const species = litterCover.length;
    const woody = PLANT_SPECIES.map((sp) => sp.woody);
    const lastBurn = world.layer<Float32Array>(LAST_BURN_LAYER);

    return () => {
      const tick = state.tick;
      if (tick % ticksPerDay !== 0) return;
      const atReference = dailyMeanTemperatureC(config, tick, weatherValues, reference);
      const season = seasonFraction(config, tick);
      const falling = season >= K.litterFallStart && season < K.litterFallEnd;
      // Day (plus one, as the fire layer stores it) on which this year began.
      const yearBegan = Math.floor(tick / ticksPerDay / daysPerYear) * daysPerYear + 1;
      for (let k = 0; k < N; k++) {
        if (water[k] !== Water.DRY) continue;
        const rot = rotFactor(atReference - lapse * (elevation[k] - reference), moisture[k]);
        small[k] += smallIn * tree[k] + bushIn * bush[k] - smallOut * rot * small[k];
        long[k] += longIn * tree[k] - longOut * rot * long[k];
        if (small[k] < 0) small[k] = 0;
        if (long[k] < 0) long[k] = 0;
        let fine = litter[k] - litterOut * rot * litter[k];
        if (falling) {
          // A fire this year burned the year's dead grass and herbs where they stood: only the
          // leaves of woody plants are left to fall (T-006).
          const burned = lastBurn[k] >= yearBegan;
          for (let sp = 0; sp < species; sp++) if (!burned || woody[sp]) fine += litterIn[sp] * litterCover[sp][k];
        }
        litter[k] = fine > 0 ? fine : 0;
      }

      // Objects made of something that rots: wood on the trees' clock, hide on real days.
      if (objects.count === 0) return;
      const material = objects.column<Uint8Array>('material').data;
      const ox = objects.column<Float64Array>('x').data;
      const oy = objects.column<Float64Array>('y').data;
      const mass = objects.column<Float32Array>('mass').data;
      const length = objects.column<Float32Array>('length').data;
      const integrity = objects.column<Float32Array>('integrity').data;
      const alive = objects.alive.data;
      const high = objects.highWater;
      for (let slot = 0; slot < high; slot++) {
        if (alive[slot] !== 1) continue;
        const spec = materialById(material[slot]);
        let perDay = 0;
        if (spec.id === Material.WOOD) {
          perDay = woodDecayPerYear(thicknessOf(mass[slot], length[slot], wood.densityKgM3)) / daysPerYear;
        } else {
          perDay = spec.rotPerRealDay;
        }
        if (perDay === 0) continue;
        let i = Math.floor(ox[slot] / cellSizeM);
        let j = Math.floor(oy[slot] / cellSizeM);
        i = i < 0 ? 0 : i >= W ? W - 1 : i;
        j = j < 0 ? 0 : j >= H ? H - 1 : j;
        const cell = j * W + i;
        const left = integrity[slot] - perDay * rotFactor(atReference - lapse * (elevation[cell] - reference), moisture[cell]);
        if (left > 0) integrity[slot] = left;
        else objects.remove(slot);
      }
    };
  },
});
