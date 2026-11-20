// Cues: what a mind can attend to (docs/DESIGN.md §4.7.3, §4.8). A cue is a perception, never a
// label: a mind gets "a thing of perceived class 17", never what the thing is for. A cue is a 28-bit
// number, a 4-bit kind and a 24-bit payload, so an association key (cue, act kind) fits in 32 bits.
//
// The class catalogue is built from the world's own catalogues in their order, so a class number
// means the same thing in every run of one version of the code.

import { GROUP_KINDS } from '../world/animals.ts';
import { MATERIALS, Material } from '../world/materials.ts';
import { PLANT_SPECIES } from '../world/plants.ts';

/** Kinds of cue (the top 4 bits). 0 is never a cue, so a zeroed key means "empty". */
export const CueKind = {
  CLASS: 1,
  INDIVIDUAL: 2,
  PLACE: 3,
  LIGHT: 4,
  DAY_LENGTH: 5,
  WARMTH: 6,
  NODE: 7,
  SELF: 8,
} as const;

/** Largest payload a cue can carry (24 bits). */
export const CUE_PAYLOAD_MAX = 0xffffff;

export function cue(kind: number, payload: number): number {
  if (payload < 0 || payload > CUE_PAYLOAD_MAX || payload !== Math.floor(payload)) {
    throw new RangeError(`cue: payload ${payload} does not fit in 24 bits.`);
  }
  return ((kind << 24) | payload) >>> 0;
}

export function cueKind(c: number): number {
  return c >>> 24;
}

export function cuePayload(c: number): number {
  return c & CUE_PAYLOAD_MAX;
}

/** The cue of untargeted acts (rest, sleep, explore). */
export const SELF_CUE = cue(CueKind.SELF, 0);

/** How a plant looks: no green leaves, in leaf, or bearing what it bears above ground. */
export const PlantLook = { BARE: 0, LEAF: 1, BEARING: 2 } as const;
const PLANT_LOOKS = 3;

/** Light at the eye, as a band (§4.8). */
export const LightBand = { DARK: 0, DIM: 1, BRIGHT: 2 } as const;
/** Day length and its trend over the year (§4.7.3). */
export const DayLength = { SHORT: 0, LENGTHENING: 1, LONG: 2, SHORTENING: 3 } as const;
/** Air at the skin, as a band (§4.8). */
export const Warmth = { COLD: 0, MILD: 1, HOT: 2 } as const;

/**
 * How far a class can be seen in full light on open ground (§4.8), by group. A class's group is
 * a property of how big and how visible the thing is, not of what it is.
 */
export const SightGroup = {
  /** Things on the ground: herbs, stone, wood, litter, hides, hares, objects. */
  GROUND: 0,
  /** Bushes, reeds, long wood, carcasses. */
  BUSH: 1,
  /** Trees, water, rock shelters. */
  TREE: 2,
  /** Large animals and a person's shape. */
  LARGE: 3,
  /** Fire: smoke by day, glow by night. */
  FIRE: 4,
} as const;

export interface PerceivedClass {
  /** A description for people reading the code and the analysis; minds never see it. */
  readonly name: string;
  readonly group: number;
  /** True if the class is part of a cell's still view (§4.8, rule 1); its class number is then below 64. */
  readonly still: boolean;
}

function buildClasses() {
  const classes: PerceivedClass[] = [];
  const add = (name: string, group: number, still: boolean): number => {
    classes.push(Object.freeze({ name, group, still }));
    return classes.length - 1;
  };
  // Still classes first, so each has a bit in a cell's 64-bit still mask.
  const plant: number[] = [];
  for (const species of PLANT_SPECIES) {
    // Nut trees are the only trees (§2.15's canopy); berry bushes and reeds stand about head high; the rest are herbs.
    const group = species.name === 'nut' ? SightGroup.TREE : species.woody || species.name === 'reed' ? SightGroup.BUSH : SightGroup.GROUND;
    plant.push(add(`${species.name}, bare`, group, true));
    add(`${species.name}, in leaf`, group, true);
    add(`${species.name}, bearing`, group, true);
  }
  const hare = add('hare', SightGroup.GROUND, true);
  const carcass = add('carcass', SightGroup.BUSH, true);
  // Material classes, by material id: plain (loose stone, or a stone object), edged, small and long wood, hide.
  const plainOf = new Int16Array(MATERIALS.length + 1).fill(-1);
  for (const m of MATERIALS) {
    if (m.id >= Material.FLINT && m.id <= Material.PYRITE) plainOf[m.id] = add(`${m.name}, lying`, SightGroup.GROUND, true);
  }
  const smallWood = add('wood, small', SightGroup.GROUND, true);
  const longWood = add('wood, long', SightGroup.BUSH, true);
  const litter = add('litter', SightGroup.GROUND, true);
  const flowing = add('water, flowing', SightGroup.TREE, true);
  const standing = add('water, standing', SightGroup.TREE, true);
  const overhang = add('rock overhang', SightGroup.TREE, true);
  const cave = add('cave', SightGroup.TREE, true);
  const stillCount = classes.length;
  // Classes seen only fresh: edged stone and hides (objects only), animals, a person's shape, fire.
  const edgedOf = new Int16Array(MATERIALS.length + 1).fill(-1);
  for (const m of MATERIALS) {
    if (m.id >= Material.FLINT && m.id <= Material.PYRITE) edgedOf[m.id] = add(`${m.name}, keen edge`, SightGroup.GROUND, false);
  }
  const hide = add('hide', SightGroup.GROUND, false);
  const animalOf = new Int16Array(16).fill(-1);
  for (const g of GROUP_KINDS) animalOf[g.kind] = add(g.name, SightGroup.LARGE, false);
  const figure = add('a person too far away to tell who', SightGroup.LARGE, false);
  const flaming = add('fire, flaming', SightGroup.FIRE, false);
  const smouldering = add('fire, smouldering', SightGroup.FIRE, false);
  if (stillCount > 64) throw new Error(`cues: ${stillCount} still classes do not fit a 64-bit mask.`);
  return {
    classes: Object.freeze(classes),
    stillCount,
    plant: Object.freeze(plant),
    hare,
    carcass,
    plainOf,
    edgedOf,
    smallWood,
    longWood,
    litter,
    flowing,
    standing,
    overhang,
    cave,
    hide,
    animalOf,
    figure,
    flaming,
    smouldering,
  };
}

const BUILT = buildClasses();

/** Every perceived class, by class number. */
export const PERCEIVED_CLASSES: readonly PerceivedClass[] = BUILT.classes;

/** Class numbers of the things perception names (read-only lookups; the arrays are not to be written). */
export const CLASS = Object.freeze({
  stillCount: BUILT.stillCount,
  hare: BUILT.hare,
  carcass: BUILT.carcass,
  smallWood: BUILT.smallWood,
  longWood: BUILT.longWood,
  litter: BUILT.litter,
  flowing: BUILT.flowing,
  standing: BUILT.standing,
  overhang: BUILT.overhang,
  cave: BUILT.cave,
  hide: BUILT.hide,
  figure: BUILT.figure,
  flaming: BUILT.flaming,
  smouldering: BUILT.smouldering,
});

/** The class of plant species `species` (its catalogue index) with look `look` (PlantLook). */
export function plantClass(species: number, look: number): number {
  return BUILT.plant[species] + look;
}

/** The class of a lying thing of material id `material`: stone plain or edged, wood small or long, hide; -1 for none. */
export function materialClass(material: number, edged: boolean, long: boolean): number {
  if (material === Material.WOOD) return long ? BUILT.longWood : BUILT.smallWood;
  if (material === Material.HIDE) return BUILT.hide;
  if (material < 0 || material >= BUILT.plainOf.length) return -1;
  return edged ? BUILT.edgedOf[material] : BUILT.plainOf[material];
}

/** The class of an animal group of kind `kind` (AnimalKind); -1 for none. */
export function animalClass(kind: number): number {
  return kind >= 0 && kind < BUILT.animalOf.length ? BUILT.animalOf[kind] : -1;
}

export const PLANT_LOOK_COUNT = PLANT_LOOKS;
