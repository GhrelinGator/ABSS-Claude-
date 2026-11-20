// Perception: what one agent can see from where it stands (docs/DESIGN.md §4.1, §4.7.3, §4.8).
// A look returns percepts (a cue, a distance, a place to walk to, and what it refers to) and the
// context cues. It gives nothing that is not on the surface of the world: no pathogen loads, no
// toxins, nothing underground, nobody's insides, and never what a thing is for.
//
// Minds call it in the decide phase, which reads tick-start state (§1.6). Everything that moves
// (agents, animals, lying objects, fire) is indexed from copies of its position at the first look of
// the tick. The still world is worked out once per cell and hour and kept as saved state (rule 1).

import type { Sink, Source } from '../core/codec.ts';
import { exp } from '../core/dmath.ts';
import { NeighbourGrid } from '../core/spatial.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { worldWidthM } from '../config.ts';
import { ANIMAL_STORE, AnimalMode, CARCASS_LAYER, HARE_LAYER, tallCoverOf } from '../world/animals.ts';
import { CLIMATE_PARTS, airTemperatureC, dailyMeanTemperatureC } from '../world/climate.ts';
import { FIRE_LAYERS, FIRE_STORE, FireStage, createFireProbe } from '../world/fire.ts';
import { ambientLight, seasonFraction } from '../world/light.ts';
import {
  MATERIAL_LAYERS,
  OBJECT_STORE,
  ROCK_SHELTER_STORE,
  RockShelterKind,
  STONE_MATERIALS,
  createShelterProbe,
  stoneLayer,
} from '../world/materials.ts';
import { mix32 } from '../world/noise.ts';
import { PLANT_SPECIES, coverLayer, foodLayer } from '../world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../world/terrain.ts';
import {
  CLASS,
  CueKind,
  DayLength,
  LightBand,
  PERCEIVED_CLASSES,
  PlantLook,
  SightGroup,
  Warmth,
  animalClass,
  cue,
  materialClass,
  plantClass,
} from './cues.ts';

/** Every number perception uses (§4.8). Ranges are in full light on open ground [estimates]. */
export const PERCEPTION = {
  /** Range by SightGroup: ground, bush, tree, large, fire, metres. */
  rangeM: [60, 150, 400, 600, 2000] as readonly number[],
  /** Range for telling who a person is, metres, and the most persons a look names. */
  individualM: 150,
  mostIndividuals: 16,
  /** Light at the eye, as a share of full noon sun, below which it is dark, and dim; and what each does to range. */
  darkBelow: 0.01,
  dimBelow: 0.07,
  darkFactor: 0.05,
  dimFactor: 0.3,
  /** Range lost to trees, bushes and reeds around the eye, and to tall cover around a target, at full cover. */
  vegetationLoss: 0.7,
  concealmentLoss: 0.7,
  /** Range factor for an animal lying still (resting, or in ambush). */
  stillAnimalFactor: 0.5,
  /** Heights of the eye and of a target above the ground, metres, for lines of sight. */
  eyeM: 1.6,
  targetM: 1,
  /** Lines of sight are kept for cells up to this many cells away (beyond every range but fire's). */
  sightReachCells: 7,
  /** Least plant cover counted in a cell, and least food above ground, kg, for a plant to look bearing. */
  plantSeenCover: 0.02,
  bearingKg: 1,
  /** Least of each lying thing in a cell, kg, for it to be seen. */
  stoneSeenKg: 5,
  smallWoodKg: 5,
  longWoodKg: 20,
  litterKg: 50,
  carcassKg: 1,
  /** An object with an edge this keen or keener looks edged; wood this long or longer looks long, metres. */
  edgedFrom: 0.5,
  longWoodM: 1.5,
  /** Deciduous leaves are out from mid-spring to mid-autumn (§2.15's canopy). */
  leafFrom: 0.08,
  leafUntil: 0.65,
  /** Air at the skin below this is cold, from this up hot, °C [provisional]. */
  coldBelowC: 10,
  hotFromC: 25,
  /** Side of a place, metres (§4.7.3). */
  placeM: 400,
} as const;
const P = PERCEPTION;

/** What a percept refers to: a cell (by index), or the id of an object, an animal group or an agent. */
export const PerceptSource = { CELL: 1, OBJECT: 2, ANIMAL: 3, AGENT: 4 } as const;

/** The name of the saved still-view part. */
export const STILL_VIEW_PART = 'mind.stillView';

/**
 * The output of one look. `ref` and the position are for acts to find a target; a mind attends
 * only to the cues, never to `ref` (an id beyond the range for telling who is not a cue).
 */
export class Percepts {
  static readonly CAPACITY = 128;
  n = 0;
  readonly cue = new Uint32Array(Percepts.CAPACITY);
  /** Distance from the eye, metres: to a cell's nearest point, or to an object, group or agent. */
  readonly dist = new Float64Array(Percepts.CAPACITY);
  /** Where to go: a cell's centre, or the thing's position. */
  readonly x = new Float64Array(Percepts.CAPACITY);
  readonly y = new Float64Array(Percepts.CAPACITY);
  readonly ref = new Float64Array(Percepts.CAPACITY);
  readonly source = new Uint8Array(Percepts.CAPACITY);
  /** Context cues (§4.7.3). */
  place = 0;
  light = 0;
  dayLength = 0;
  warmth = 0;
  /** Light at the eye as a share of full noon sun, and the factor it and vegetation put on every range. */
  lightLevel = 0;
  rangeFactor = 0;

  push(c: number, dist: number, x: number, y: number, ref: number, source: number): void {
    const n = this.n;
    if (n === Percepts.CAPACITY) throw new Error('Percepts: more percepts than the capacity.');
    this.cue[n] = c;
    this.dist[n] = dist;
    this.x[n] = x;
    this.y[n] = y;
    this.ref[n] = ref;
    this.source[n] = source;
    this.n = n + 1;
  }
}

/**
 * The still view of each cell for the current hour (rule 1): a 64-bit mask of the still classes
 * seen there, made at the first look at the cell in the hour. Saved, because what it holds depends
 * on when it was made; it holds nothing any agent learned.
 */
class StillView implements StatePart {
  readonly name = STILL_VIEW_PART;
  readonly holdsLearned = false;
  /** The hour the stamps refer to. */
  hour = -1;
  /** hour + 1 for cells whose mask is current, anything else for stale ones. */
  readonly stamp: Uint32Array;
  readonly mask: Uint32Array;

  constructor(cells: number) {
    this.stamp = new Uint32Array(cells);
    this.mask = new Uint32Array(cells * 2);
  }

  write(sink: Sink): void {
    const { stamp, mask } = this;
    const want = this.hour + 1;
    sink.f64(this.hour);
    let count = 0;
    for (let k = 0; k < stamp.length; k++) if (stamp[k] === want && want > 0) count++;
    sink.u32(count);
    if (count === 0) return;
    for (let k = 0; k < stamp.length; k++) {
      if (stamp[k] !== want) continue;
      sink.u32(k);
      sink.u32(mask[2 * k]);
      sink.u32(mask[2 * k + 1]);
    }
  }

  read(source: Source): void {
    this.hour = source.f64();
    this.stamp.fill(0);
    this.mask.fill(0);
    const count = source.u32();
    for (let n = 0; n < count; n++) {
      const k = source.u32();
      if (k >= this.stamp.length) throw new Error('Snapshot still view names a cell outside the map.');
      this.stamp[k] = this.hour + 1;
      this.mask[2 * k] = source.u32();
      this.mask[2 * k + 1] = source.u32();
    }
  }
}

/** Declare what perception keeps: call from the declaring step of the system that owns minds. */
export function declarePerception(state: SimState): void {
  state.addPart(new StillView(state.world.widthCells * state.world.heightCells));
}

export interface Perception {
  /** Look from agent `slot` now; fills `out` and returns the number of percepts. */
  perceive(slot: number, out: Percepts): number;
  /** An act changed what lies or grows in `cell`: its still view is made afresh at the next look. */
  invalidate(cell: number): void;
}

const SOURCE_NONE = 0;

// ALIBI: light reaches eyes from what is lit, trees and reeds and ridges block it, and things hidden in
// tall plants or lying still are harder to make out, whoever is looking and whether or not anyone else exists.
/** A reusable look for one simulation (§4.8). It writes nothing but its own still view. */
export function createPerception(sim: Sim): Perception {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const world = state.world;
  const agents = state.agents;
  const view = state.parts.find((p) => p.name === STILL_VIEW_PART) as StillView | undefined;
  if (!view) throw new Error('createPerception: call declarePerception from a declaring step first.');
  const weatherPart = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
  if (!weatherPart || !weatherPart.readings) throw new Error('Perception needs world.climate.');
  const weather = weatherPart.readings();

  // Layers of the still world.
  const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
  const waterKind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const cover = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
  const food = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(foodLayer(sp)));
  const bearsInSight = PLANT_SPECIES.map((sp) => sp.visible && sp.food.kind === 'seasonal');
  const woody = PLANT_SPECIES.map((sp) => sp.woody);
  const minTemperature = PLANT_SPECIES.map((sp) => sp.minTemperatureC);
  const plantBits = PLANT_SPECIES.map((_, s) => [plantClass(s, PlantLook.BARE), plantClass(s, PlantLook.LEAF), plantClass(s, PlantLook.BEARING)]);
  const indexOf = (name: string) => {
    const s = PLANT_SPECIES.findIndex((sp) => sp.name === name);
    if (s < 0) throw new Error(`Perception needs the plant species "${name}".`);
    return s;
  };
  const grass = cover[indexOf('grass')];
  const berry = cover[indexOf('berry')];
  const nut = cover[indexOf('nut')];
  const reed = cover[indexOf('reed')];
  const hares = world.layer<Float32Array>(HARE_LAYER);
  const carcass = world.layer<Float32Array>(CARCASS_LAYER);
  const stones = STONE_MATERIALS.map((m) => world.layer<Float32Array>(stoneLayer(m)));
  const stoneBits = STONE_MATERIALS.map((m) => materialClass(m.id, false, false));
  const smallWood = world.layer<Float32Array>(MATERIAL_LAYERS.smallWood);
  const longWood = world.layer<Float32Array>(MATERIAL_LAYERS.longWood);
  const litter = world.layer<Float32Array>(MATERIAL_LAYERS.litter);
  const stage = world.layer<Uint8Array>(FIRE_LAYERS.stage);

  // Stores of moving things.
  const animals = state.store(ANIMAL_STORE);
  const objects = state.store(OBJECT_STORE);
  const fireStore = state.store(FIRE_STORE);
  const shelters = state.store(ROCK_SHELTER_STORE);

  const shelterProbe = createShelterProbe(sim);
  const fireProbe = createFireProbe(sim);
  const hereShelter = new Float64Array(3);
  const hereFire = new Float64Array(2);

  const widthM = W * cs;
  const heightM = H * cs;
  const placeColumns = Math.ceil(worldWidthM(config) / P.placeM);
  const ticksPerHour = Math.max(1, Math.round(config.time.ticksPerDay / 24));
  const hareKey = mix32(config.seed ^ 0x5a17e3b1);

  // Sight groups as masks over the still classes, for "which still classes reach this far".
  const groupMask = [new Uint32Array(2), new Uint32Array(2), new Uint32Array(2)];
  for (let c = 0; c < CLASS.stillCount; c++) {
    const g = PERCEIVED_CLASSES[c].group;
    if (g > SightGroup.TREE) throw new Error('A still class must be seen at tree range or nearer.');
    groupMask[g][c >>> 5] |= 1 << (c & 31);
  }
  // Within ground range every still class reaches, within bush range the bush and tree ones, and so on.
  const reach = [
    [groupMask[0][0] | groupMask[1][0] | groupMask[2][0], groupMask[0][1] | groupMask[1][1] | groupMask[2][1]],
    [groupMask[1][0] | groupMask[2][0], groupMask[1][1] | groupMask[2][1]],
    [groupMask[2][0], groupMask[2][1]],
  ];
  const R = P.rangeM;

  // Window offsets, nearest first; and lines of sight per viewing cell, kept for the run (rule 4).
  const SR = P.sightReachCells;
  const side = 2 * SR + 1;
  const sightWords = Math.ceil((side * side) / 32);
  const offsets: { di: number; dj: number; bit: number; d2: number }[] = [];
  for (let dj = -SR; dj <= SR; dj++) {
    for (let di = -SR; di <= SR; di++) offsets.push({ di, dj, bit: (dj + SR) * side + (di + SR), d2: di * di + dj * dj });
  }
  offsets.sort((a, b) => a.d2 - b.d2 || a.dj - b.dj || a.di - b.di);
  const offI = new Int32Array(offsets.map((o) => o.di));
  const offJ = new Int32Array(offsets.map((o) => o.dj));
  const offBit = new Int32Array(offsets.map((o) => o.bit));
  // No cell at or after this offset can be nearer than this (its Chebyshev distance is at least d / √2).
  const offFloor = new Float64Array(offsets.map((o) => Math.max(0, Math.sqrt(o.d2) / Math.SQRT2 - 1) * cs));
  const sight = new Uint32Array(W * H * sightWords);
  const sightDone = new Uint8Array(W * H);

  function workOutSight(k: number): void {
    const vi = k % W;
    const vj = (k - vi) / W;
    const eye = elevation[k] + P.eyeM;
    const base = k * sightWords;
    for (let o = 0; o < offI.length; o++) {
      const di = offI[o];
      const dj = offJ[o];
      const ti = vi + di;
      const tj = vj + dj;
      if (ti < 0 || ti >= W || tj < 0 || tj >= H) continue;
      const m = Math.max(di < 0 ? -di : di, dj < 0 ? -dj : dj);
      let clear = true;
      if (m > 1) {
        const top = elevation[tj * W + ti] + P.targetM;
        for (let s = 1; s < m && clear; s++) {
          const si = vi + Math.round((di * s) / m);
          const sj = vj + Math.round((dj * s) / m);
          if (elevation[sj * W + si] > eye + ((top - eye) * s) / m) clear = false;
        }
      }
      if (clear) sight[base + (offBit[o] >>> 5)] |= 1 << (offBit[o] & 31);
    }
    sightDone[k] = 1;
  }

  const inSight = (viewer: number, di: number, dj: number): boolean => {
    if (di < -SR || di > SR || dj < -SR || dj > SR) return true;
    if (sightDone[viewer] === 0) workOutSight(viewer);
    const bit = (dj + SR) * side + (di + SR);
    return (sight[viewer * sightWords + (bit >>> 5)] & (1 << (bit & 31))) !== 0;
  };

  // Rock shelters by cell, rebuilt if the store changes (it is made at setup and then fixed).
  const shelterKind = new Uint8Array(W * H);
  let sheltersSeenId = -1;
  function refreshShelters(): void {
    if (shelters.nextId === sheltersSeenId) return;
    sheltersSeenId = shelters.nextId;
    shelterKind.fill(0);
    const kind = shelters.column<Uint8Array>('kind').data;
    const sx = shelters.column<Float64Array>('x').data;
    const sy = shelters.column<Float64Array>('y').data;
    for (let s = 0; s < shelters.highWater; s++) {
      if (shelters.alive.data[s] !== 1) continue;
      const k = cellOf(sx[s], sy[s]);
      // A cave is the more enclosed; it shows if a cell has both.
      if (kind[s] === RockShelterKind.CAVE || shelterKind[k] === 0) shelterKind[k] = kind[s];
    }
  }

  function cellOf(x: number, y: number): number {
    let i = Math.floor(x / cs);
    let j = Math.floor(y / cs);
    if (i < 0) i = 0;
    else if (i >= W) i = W - 1;
    if (j < 0) j = 0;
    else if (j >= H) j = H - 1;
    return j * W + i;
  }

  // ---- what changes once a tick
  let tick = -1;
  let hour = -1;
  let ambient = 0;
  let season = 0;
  let leafOut = false;
  let dayLength = 0;

  function refreshTick(): void {
    const now = state.tick;
    if (now === tick) return;
    tick = now;
    hour = Math.floor(now / ticksPerHour);
    ambient = ambientLight(config, now);
    season = seasonFraction(config, now);
    leafOut = season >= P.leafFrom && season < P.leafUntil;
    // Quarters of the year centred on the equinoxes and solstices (the year starts at the spring equinox).
    const quarter = Math.floor((season + 0.125 - Math.floor(season + 0.125)) * 4);
    dayLength = quarter === 0 ? DayLength.LENGTHENING : quarter === 1 ? DayLength.LONG : quarter === 2 ? DayLength.SHORTENING : DayLength.SHORT;
    if (view!.hour !== hour) view!.hour = hour;
  }

  // ---- the still view of a cell (rule 1)
  function workOutStill(k: number): void {
    let m0 = 0;
    let m1 = 0;
    const set = (c: number) => {
      if (c < 32) m0 |= 1 << c;
      else m1 |= 1 << (c - 32);
    };
    let meanC = Number.NaN;
    for (let s = 0; s < cover.length; s++) {
      if (cover[s][k] < P.plantSeenCover) continue;
      let look: number;
      if (bearsInSight[s] && food[s][k] >= P.bearingKg) look = PlantLook.BEARING;
      else if (woody[s]) look = leafOut ? PlantLook.LEAF : PlantLook.BARE;
      else {
        if (meanC !== meanC) meanC = dailyMeanTemperatureC(config, tick, weather, elevation[k]);
        look = meanC >= minTemperature[s] ? PlantLook.LEAF : PlantLook.BARE;
      }
      set(plantBits[s][look]);
    }
    const h = hares[k];
    if (h > 0) {
      const draw = mix32(mix32(hareKey ^ Math.imul(k + 1, 0x9e3779b1)) ^ Math.imul(hour + 1, 0x85ebca6b)) / 4294967296;
      if (draw < 1 - exp(-h)) set(CLASS.hare);
    }
    if (carcass[k] >= P.carcassKg) set(CLASS.carcass);
    for (let m = 0; m < stones.length; m++) if (stones[m][k] >= P.stoneSeenKg) set(stoneBits[m]);
    if (smallWood[k] >= P.smallWoodKg) set(CLASS.smallWood);
    if (longWood[k] >= P.longWoodKg) set(CLASS.longWood);
    if (litter[k] >= P.litterKg) set(CLASS.litter);
    const water = waterKind[k];
    if (water === Water.RIVER || water === Water.SPRING) set(CLASS.flowing);
    else if (water === Water.LAKE) set(CLASS.standing);
    const shelter = shelterKind[k];
    if (shelter === RockShelterKind.OVERHANG) set(CLASS.overhang);
    else if (shelter === RockShelterKind.CAVE) set(CLASS.cave);
    view!.mask[2 * k] = m0;
    view!.mask[2 * k + 1] = m1;
    view!.stamp[k] = hour + 1;
  }

  // ---- moving things, indexed once a tick from copies of their positions (rule 2)
  const agentGrid = new NeighbourGrid(widthM, heightM, 200);
  const animalGrid = new NeighbourGrid(widthM, heightM, 400);
  const objectGrid = new NeighbourGrid(widthM, heightM, 100);
  const fireGrid = new NeighbourGrid(widthM, heightM, 500);
  let agentsAt = -1;
  let agentsId = -1;
  let agentsCount = -1;
  let animalsAt = -1;
  let animalsId = -1;
  let animalsCount = -1;
  let objectsAt = -1;
  let objectsId = -1;
  let objectsCount = -1;
  let firesAt = -1;
  let firesId = -1;
  let firesCount = -1;
  // Fires as points: burning cells at their centres and burning objects, with their class and reference.
  let fireX = new Float64Array(64);
  let fireY = new Float64Array(64);
  let fireClass = new Int16Array(64);
  let fireRef = new Float64Array(64);
  let fireSource = new Uint8Array(64);
  let fireN = 0;

  function refreshAgents(): void {
    if (agentsAt === tick && agentsId === agents.nextId && agentsCount === agents.count) return;
    agentsAt = tick;
    agentsId = agents.nextId;
    agentsCount = agents.count;
    const alive = agents.alive.data;
    agentGrid.build(agents.column<Float64Array>('x').data, agents.column<Float64Array>('y').data, agents.highWater, (s) => alive[s] === 1);
  }

  function refreshAnimals(): void {
    if (animalsAt === tick && animalsId === animals.nextId && animalsCount === animals.count) return;
    animalsAt = tick;
    animalsId = animals.nextId;
    animalsCount = animals.count;
    const alive = animals.alive.data;
    animalGrid.build(animals.column<Float32Array>('x').data, animals.column<Float32Array>('y').data, animals.highWater, (s) => alive[s] === 1);
  }

  const burnColumn = objects.hasColumn('burnKw') ? objects.column<Float32Array>('burnKw') : null;

  function refreshObjects(): void {
    if (objectsAt === tick && objectsId === objects.nextId && objectsCount === objects.count) return;
    objectsAt = tick;
    objectsId = objects.nextId;
    objectsCount = objects.count;
    const alive = objects.alive.data;
    const holder = objects.column<Uint32Array>('holder').data;
    const burn = burnColumn ? burnColumn.data : null;
    objectGrid.build(
      objects.column<Float64Array>('x').data,
      objects.column<Float64Array>('y').data,
      objects.highWater,
      (s) => alive[s] === 1 && holder[s] === 0 && !(burn !== null && burn[s] > 0),
    );
  }

  function pushFire(x: number, y: number, c: number, ref: number, source: number): void {
    if (fireN === fireX.length) {
      const n = fireX.length * 2;
      const grow = <T extends Float64Array | Int16Array | Uint8Array>(a: T, b: T): T => {
        b.set(a);
        return b;
      };
      fireX = grow(fireX, new Float64Array(n));
      fireY = grow(fireY, new Float64Array(n));
      fireClass = grow(fireClass, new Int16Array(n));
      fireRef = grow(fireRef, new Float64Array(n));
      fireSource = grow(fireSource, new Uint8Array(n));
    }
    fireX[fireN] = x;
    fireY[fireN] = y;
    fireClass[fireN] = c;
    fireRef[fireN] = ref;
    fireSource[fireN] = source;
    fireN++;
  }

  function refreshFires(): void {
    if (firesAt === tick && firesId === objects.nextId && firesCount === fireStore.count) return;
    firesAt = tick;
    firesId = objects.nextId;
    firesCount = fireStore.count;
    fireN = 0;
    if (fireStore.count > 0) {
      const cell = fireStore.column<Int32Array>('cell').data;
      for (let s = 0; s < fireStore.highWater; s++) {
        if (fireStore.alive.data[s] !== 1) continue;
        const k = cell[s];
        const st = stage[k];
        if (st === FireStage.NONE) continue;
        const i = k % W;
        pushFire((i + 0.5) * cs, ((k - i) / W + 0.5) * cs, st === FireStage.FLAMING ? CLASS.flaming : CLASS.smouldering, k, PerceptSource.CELL);
      }
    }
    if (burnColumn !== null) {
      const burn = burnColumn.data;
      const ox = objects.column<Float64Array>('x').data;
      const oy = objects.column<Float64Array>('y').data;
      const ids = objects.id.data;
      for (let s = 0; s < objects.highWater; s++) {
        if (objects.alive.data[s] === 1 && burn[s] > 0) pushFire(ox[s], oy[s], CLASS.flaming, ids[s], PerceptSource.OBJECT);
      }
    }
    if (fireN > 0) fireGrid.build(fireX, fireY, fireN, () => true);
  }

  // ---- nearest of each class among fresh things, gathered then emitted in class order
  const classCount = PERCEIVED_CLASSES.length;
  const bestD = new Float64Array(classCount).fill(Infinity);
  const bestX = new Float64Array(classCount);
  const bestY = new Float64Array(classCount);
  const bestRef = new Float64Array(classCount);
  const bestSource = new Uint8Array(classCount);
  const touched = new Int32Array(classCount);
  let touchedN = 0;

  function offer(c: number, d: number, x: number, y: number, ref: number, source: number): void {
    const was = bestD[c];
    if (!(d < was || (d === was && ref < bestRef[c]))) return;
    if (was === Infinity) touched[touchedN++] = c;
    bestD[c] = d;
    bestX[c] = x;
    bestY[c] = y;
    bestRef[c] = ref;
    bestSource[c] = source;
  }

  function flush(out: Percepts): void {
    // Class order, so the output does not depend on the order things were found in.
    const order = touched.subarray(0, touchedN).sort();
    for (let n = 0; n < touchedN; n++) {
      const c = order[n];
      out.push(cue(CueKind.CLASS, c), bestD[c], bestX[c], bestY[c], bestRef[c], bestSource[c]);
      bestD[c] = Infinity;
      bestSource[c] = SOURCE_NONE;
    }
    touchedN = 0;
  }

  // Persons named in a look, nearest first.
  const whoSlot = new Int32Array(P.mostIndividuals + 1);
  const whoD = new Float64Array(P.mostIndividuals + 1);

  /** Concealment of a target in cell k: tall plants hide what is in them (§4.8). */
  const concealment = (k: number) => {
    const tall = tallCoverOf(season, grass[k], berry[k], nut[k], reed[k]);
    return 1 - P.concealmentLoss * (tall < 1 ? tall : 1);
  };

  function perceive(slot: number, out: Percepts): number {
    if (!agents.isAlive(slot)) throw new Error(`perceive: slot ${slot} is not a live agent.`);
    refreshTick();
    refreshShelters();
    const px = agents.column<Float64Array>('x').data[slot];
    const py = agents.column<Float64Array>('y').data[slot];
    const k = cellOf(px, py);
    const vi = k % W;
    const vj = (k - vi) / W;

    // Light at the eye, and the range factor from it and from the plants around the eye.
    shelterProbe.at(px, py, hereShelter);
    fireProbe.at(px, py, hereFire);
    const lightLevel = ambient * (1 - hereShelter[2]) + hereFire[0];
    const band = lightLevel < P.darkBelow ? LightBand.DARK : lightLevel < P.dimBelow ? LightBand.DIM : LightBand.BRIGHT;
    const fLight = band === LightBand.DARK ? P.darkFactor : band === LightBand.DIM ? P.dimFactor : 1;
    const around = nut[k] + 0.5 * berry[k] + reed[k];
    const fPlants = 1 - P.vegetationLoss * (around < 1 ? around : 1);
    const f = fLight * fPlants;

    out.n = 0;
    out.lightLevel = lightLevel;
    out.rangeFactor = f;
    out.light = cue(CueKind.LIGHT, band);
    out.dayLength = cue(CueKind.DAY_LENGTH, dayLength);
    out.place = cue(CueKind.PLACE, Math.floor(py / P.placeM) * placeColumns + Math.floor(px / P.placeM));
    // The air at the skin: what body.exposure gives a body in this cell (§3.9).
    const air = airTemperatureC(config, tick, weather, elevation[k]);
    out.warmth = cue(CueKind.WARMTH, air < P.coldBelowC ? Warmth.COLD : air < P.hotFromC ? Warmth.MILD : Warmth.HOT);

    // The still world: cells nearest first, each class at the nearest cell where it shows.
    const stillReach = R[SightGroup.TREE] * f;
    let seen0 = 0;
    let seen1 = 0;
    const stamp = view!.stamp;
    const mask = view!.mask;
    const want = hour + 1;
    for (let o = 0; o < offI.length; o++) {
      if (offFloor[o] > stillReach) break;
      const ti = vi + offI[o];
      const tj = vj + offJ[o];
      if (ti < 0 || ti >= W || tj < 0 || tj >= H) continue;
      // Distance to the cell's nearest point.
      const x0 = ti * cs;
      const y0 = tj * cs;
      const dx = px < x0 ? x0 - px : px > x0 + cs ? px - x0 - cs : 0;
      const dy = py < y0 ? y0 - py : py > y0 + cs ? py - y0 - cs : 0;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > stillReach) continue;
      const t = d / f;
      const g = t <= R[SightGroup.GROUND] ? 0 : t <= R[SightGroup.BUSH] ? 1 : 2;
      const tk = tj * W + ti;
      if (stamp[tk] !== want) workOutStill(tk);
      let new0 = mask[2 * tk] & ~seen0 & reach[g][0];
      let new1 = mask[2 * tk + 1] & ~seen1 & reach[g][1];
      if ((new0 | new1) === 0) continue;
      if (!inSight(k, offI[o], offJ[o])) continue;
      seen0 |= new0;
      seen1 |= new1;
      const cx = x0 + cs / 2;
      const cy = y0 + cs / 2;
      while (new0 !== 0) {
        const b = 31 - Math.clz32(new0 & -new0);
        new0 &= new0 - 1;
        out.push(cue(CueKind.CLASS, b), d, cx, cy, tk, PerceptSource.CELL);
      }
      while (new1 !== 0) {
        const b = 31 - Math.clz32(new1 & -new1);
        new1 &= new1 - 1;
        out.push(cue(CueKind.CLASS, 32 + b), d, cx, cy, tk, PerceptSource.CELL);
      }
    }

    // Lying objects within ground range.
    if (objects.count > 0) {
      refreshObjects();
      const found = objectGrid.query(px, py, R[SightGroup.GROUND] * f);
      if (found > 0) {
        const material = objects.column<Uint8Array>('material').data;
        const edge = objects.column<Float32Array>('edge').data;
        const length = objects.column<Float32Array>('length').data;
        const ids = objects.id.data;
        for (let q = 0; q < found; q++) {
          const s = objectGrid.result[q];
          const ox = objectGrid.x[s];
          const oy = objectGrid.y[s];
          const tk = cellOf(ox, oy);
          const tki = tk % W;
          if (!inSight(k, tki - vi, (tk - tki) / W - vj)) continue;
          const c = materialClass(material[s], edge[s] >= P.edgedFrom, length[s] >= P.longWoodM);
          if (c < 0) continue;
          const dx = ox - px;
          const dy = oy - py;
          offer(c, Math.sqrt(dx * dx + dy * dy), ox, oy, ids[s], PerceptSource.OBJECT);
        }
      }
    }

    // Animal groups: the nearest of each kind seen.
    if (animals.count > 0) {
      refreshAnimals();
      const found = animalGrid.query(px, py, R[SightGroup.LARGE] * f);
      if (found > 0) {
        const kind = animals.column<Uint8Array>('kind').data;
        const mode = animals.column<Uint8Array>('mode').data;
        const ids = animals.id.data;
        for (let q = 0; q < found; q++) {
          const s = animalGrid.result[q];
          const c = animalClass(kind[s]);
          if (c < 0) continue;
          const ax = animalGrid.x[s];
          const ay = animalGrid.y[s];
          const dx = ax - px;
          const dy = ay - py;
          const d = Math.sqrt(dx * dx + dy * dy);
          const tk = cellOf(ax, ay);
          const still = mode[s] === AnimalMode.REST || mode[s] === AnimalMode.AMBUSH ? P.stillAnimalFactor : 1;
          if (d > R[SightGroup.LARGE] * f * concealment(tk) * still) continue;
          const tki = tk % W;
          if (!inSight(k, tki - vi, (tk - tki) / W - vj)) continue;
          offer(c, d, ax, ay, ids[s], PerceptSource.ANIMAL);
        }
      }
    }

    // Fire: not shortened by darkness or hidden by terrain; light and smoke rise above both.
    if (fireStore.count > 0 || (burnColumn !== null && objects.count > 0)) {
      refreshFires();
      if (fireN > 0) {
        const found = fireGrid.query(px, py, R[SightGroup.FIRE] * fPlants + cs);
        const half = cs / 2;
        for (let q = 0; q < found; q++) {
          const p = fireGrid.result[q];
          const dx = fireX[p] - px;
          const dy = fireY[p] - py;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (fireSource[p] === PerceptSource.CELL) d = d > half ? d - half : 0;
          if (d > R[SightGroup.FIRE] * fPlants) continue;
          offer(fireClass[p], d, fireX[p], fireY[p], fireRef[p], fireSource[p]);
        }
      }
    }

    // Persons: who they are within the range for telling, the nearest shape beyond it.
    let who = 0;
    let figureSlot = -1;
    let figureD = Infinity;
    if (agents.count > 1) {
      refreshAgents();
      const found = agentGrid.query(px, py, R[SightGroup.LARGE] * f);
      for (let q = 0; q < found; q++) {
        const s = agentGrid.result[q];
        if (s === slot) continue;
        const ox = agentGrid.x[s];
        const oy = agentGrid.y[s];
        const dx = ox - px;
        const dy = oy - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        const tk = cellOf(ox, oy);
        const hide = f * concealment(tk);
        if (d > R[SightGroup.LARGE] * hide) continue;
        const tki = tk % W;
        if (!inSight(k, tki - vi, (tk - tki) / W - vj)) continue;
        if (d <= P.individualM * hide) {
          // Insert into the nearest-first list, ties by id.
          const id = agents.id.data[s];
          let at = who;
          while (at > 0 && (whoD[at - 1] > d || (whoD[at - 1] === d && agents.id.data[whoSlot[at - 1]] > id))) {
            whoD[at] = whoD[at - 1];
            whoSlot[at] = whoSlot[at - 1];
            at--;
          }
          whoD[at] = d;
          whoSlot[at] = s;
          if (who < P.mostIndividuals) who++;
        } else if (d < figureD || (d === figureD && agents.id.data[s] < agents.id.data[figureSlot])) {
          figureD = d;
          figureSlot = s;
        }
      }
    }
    if (figureSlot >= 0) offer(CLASS.figure, figureD, agentGrid.x[figureSlot], agentGrid.y[figureSlot], agents.id.data[figureSlot], PerceptSource.AGENT);
    flush(out);
    for (let n = 0; n < who; n++) {
      const s = whoSlot[n];
      const id = agents.id.data[s];
      out.push(cue(CueKind.INDIVIDUAL, id), whoD[n], agentGrid.x[s], agentGrid.y[s], id, PerceptSource.AGENT);
    }
    return out.n;
  }

  return {
    perceive,
    invalidate(cell: number): void {
      if (cell >= 0 && cell < view.stamp.length) view.stamp[cell] = 0;
    },
  };
}
