// The solo acts (docs/DESIGN.md §4.9.3): what each act does to the body and the world in a tick. An
// act first walks to its goal if it is out of reach, then works for the time left. What the body did
// is written to metabolism's columns (effort, metres, seconds moving, metres climbed, load), so the
// bodies charge for it in the same tick. Physics decides what an act can do to a thing; the mind's
// knowledge never does.

import { ticksPerYear } from '../core/clock.ts';
import { cosTurn, sinTurn } from '../core/dmath.ts';
import { STREAM_WORDS, nextFloat } from '../core/rng.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sim, SimState } from '../sim.ts';
import { FITNESS_COLUMNS, capacity as capacityFrom, strength as strengthFrom, tiredness } from '../body/fitness.ts';
import { GUT, GUT_COLUMNS, poison, swallow } from '../body/gut.ts';
import { HEAT_COLUMNS, drink, fullWaterKg } from '../body/heat.ts';
import { INJURY_COLUMNS, exposeGut, meatDose, waterDose } from '../body/injury.ts';
import { capacityAtAge, strengthAtAge, walkingAtAge } from '../body/lifecourse.ts';
import { BODY_COLUMNS, Effort, METABOLISM, ingest } from '../body/metabolism.ts';
import { SLEEP, SLEEP_COLUMNS, sleepiness } from '../body/sleep.ts';
import { ANIMAL_STORE, CARCASS_LAYER, CARCASS_LOAD_LAYER } from '../world/animals.ts';
import { sparksAt, rubWood } from '../world/fire.ts';
import { Material, OBJECT_STORE, strikeObjects, takeStone, takeWood } from '../world/materials.ts';
import { WATER_PATHOGEN_LAYER } from '../world/pathogens.ts';
import { PLANT_SPECIES, foodLayer } from '../world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../world/terrain.ts';
import { ClassKind, classKind, classWhat, cuePayload } from './cues.ts';
import { PerceptSource } from './perception.ts';
import type { Perception } from './perception.ts';

/** Act kinds (§5.5). 0 is "whatever was done" in an association key (§4.7.5), never an act. */
export const Act = {
  NONE: 0,
  CONSUME: 1,
  APPROACH: 2,
  AVOID: 3,
  EXPLORE: 4,
  REST: 5,
  SLEEP: 6,
  PICK_UP: 7,
  DROP: 8,
  STRIKE: 9,
  MANIPULATE: 10,
} as const;
export const ACT_KINDS = 11;

/** How an act stands at the end of a tick. */
export const ActEnd = { GOING: 0, DONE: 1, FAILED: 2 } as const;

/** Every number the acts use (§4.9.3) [estimates unless said]. */
export const ACTS = {
  /** Walking and running speeds, m/s, before mobility and tiredness (Hadza walking, from memory). */
  walkMs: 1.2,
  runMs: 3,
  /** Avoid: seconds run at the start, and how far from the thing it keeps, m. Explore: how long it walks, s. */
  avoidRunS: 60,
  avoidM: 300,
  exploreS: 1800,
  /** A thing is reached within this many metres; a cell at its nearest point, this far inside (or off a lake's shore). */
  reachM: 2,
  insideM: 0.5,
  /** Walks are checked for lakes every this many metres. */
  shoreStepM: 20,
  /** Eating plants by hand, kg an hour at a dense stand, by catalogue name; density at which it is half that, kg a hectare. */
  plantKgPerHour: { grass: 0.3, tuber: 0.5, berry: 1.5, nut: 1, greens: 1, bitterRoot: 0.5, nightshade: 1.5, reed: 0.5 } as Readonly<Record<string, number>>,
  halfRateKgHa: 20,
  /** Time spent finding there is nothing to eat, s. */
  searchS: 300,
  /** Meat: kg an hour by hand and with a keen edge held; the least edge that cuts; kcal a kg; raw digestibility. */
  meatKgPerHourHand: 0.2,
  meatKgPerHourEdge: 2,
  cuttingEdge: 0.5,
  meatKcalPerKg: 1500,
  meatDigestible: 0.9,
  /** Drinking, kg a minute; a sip when not short of water, kg. */
  drinkKgPerMinute: 1,
  sipKg: 0.1,
  /** Most held in all, kg × strength; hands. */
  holdKgPerStrength: 25,
  hands: 2,
  /** Seconds to pick up or drop a thing. */
  handleS: 60,
  /** Striking: blows an act, a blow's speed (m/s), seconds a blow. */
  blows: 5,
  blowMs: 8,
  blowS: 12,
  /** Rubbing wood: an attempt's seconds and watts × strength; the act's work, s. */
  rubS: 120,
  rubW: 40,
  manipulateS: 600,
  /** A novice's precision, until skills reach acts (3.6). */
  precision: 0.5,
  /** Eating ends after this much work, s; rest ends below this tiredness. */
  eatMostS: 7200,
  restedBelow: 0.1,
  /** Each act's time limit from its start, hours. */
  limitHours: [0, 3, 1, 1, 1, 1, 12, 1, 1, 1, 1] as readonly number[],
} as const;
const K = ACTS;

/** What an agent is doing (§4.9.3): body state, not anything it learned. */
export const ACT_COLUMNS = {
  actKind: { name: 'actKind', dtype: 'u8', category: 'body' },
  actEnd: { name: 'actEnd', dtype: 'u8', category: 'body' },
  /** The target's cue (§4.7.3), what it refers to (PerceptSource and a cell, object, group or agent), and the goal. */
  actCue: { name: 'actCue', dtype: 'u32', category: 'body' },
  actSource: { name: 'actSource', dtype: 'u8', category: 'body' },
  actRef: { name: 'actRef', dtype: 'f64', category: 'body' },
  actX: { name: 'actX', dtype: 'f64', category: 'body' },
  actY: { name: 'actY', dtype: 'f64', category: 'body' },
  /** The tick it began, seconds of work done, and what it got (kg eaten or drunk, things picked up). */
  actStart: { name: 'actStart', dtype: 'f64', category: 'body' },
  actWorkS: { name: 'actWorkS', dtype: 'f64', category: 'body' },
  actGot: { name: 'actGot', dtype: 'f64', category: 'body' },
  /** The drive channels as the act began (§4.7.2's interrupts; 3.4's learning). */
  actDrives: { name: 'actDrives', dtype: 'f32', category: 'body', width: 8 },
  /** Ids of the objects in the two hands; 0 for an empty hand. */
  held: { name: 'held', dtype: 'u32', category: 'body', width: 2 },
} as const satisfies Record<string, ColumnSpec>;
const C = ACT_COLUMNS;
const B = BODY_COLUMNS;

/** Running tallies of what acts did, by index (`mind.acts`). */
export const ActTally = {
  /** Acts begun, by kind: 0..10. */
  BEGUN: 0,
  DONE: 11,
  FAILED: 22,
  /** Kg of each plant species eaten: 33..40. */
  PLANT_KG: 33,
  MEAT_KG: 41,
  WATER_KG: 42,
  KCAL: 43,
  DECISIONS: 44,
  AWAKE_TICKS: 45,
  INTERRUPTS: 46,
  POISON_UNITS: 47,
  PIECES: 48,
  EMBERS: 49,
  FIRES_LIT: 50,
  LENGTH: 51,
} as const;

export function declareActs(state: SimState): void {
  for (const spec of Object.values(C)) state.agents.ensureColumn(spec);
}

export interface Acts {
  /** Fetch columns and layers afresh: once a tick, before any act runs. */
  refresh(): void;
  /** Begin an act for agent `slot` aimed at a percept (or none), with the drives as they are now. */
  begin(slot: number, kind: number, cueId: number, source: number, ref: number, x: number, y: number, drives: Float64Array, offset: number): void;
  /** Run agent `slot`'s act for one tick. */
  run(slot: number): void;
  /** Ticks an act of this kind may last. */
  limitTicks(kind: number): number;
  /** Ids of the objects agent `slot` holds, alive and still its own; writes up to two into `out`, returns how many. */
  heldBy(slot: number, out: Float64Array): number;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function createActs(sim: Sim, perception: Perception, tally: Float64Array): Acts {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const world = state.world;
  const agents = state.agents;
  const objects = state.store(OBJECT_STORE);
  const animals = state.store(ANIMAL_STORE);
  const dt = 86_400 / config.time.ticksPerDay;
  const ticksPerHour = config.time.ticksPerDay / 24;
  const perYear = ticksPerYear(config);
  const widthM = W * cs;
  const heightM = H * cs;
  const hectares = (cs * cs) / 10_000;
  const fullGutKcal = METABOLISM.absorbKcalPerMinute * 60 * 6;

  const plantRate = PLANT_SPECIES.map((sp) => {
    const r = K.plantKgPerHour[sp.name];
    if (r === undefined) throw new Error(`Acts: no eating rate for the plant species "${sp.name}".`);
    return r;
  });

  // Layers: fixed for the run once the world exists; read lazily (create runs before world setup, §1.5).
  let elevation: Float32Array | null = null;
  let waterKind: Uint8Array | null = null;
  let food: Float32Array[] = [];
  let carcass: Float32Array | null = null;
  let carcassLoad: Float32Array | null = null;
  let pathogen: Float32Array | null = null;
  function layers(): void {
    if (elevation) return;
    elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    waterKind = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
    food = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(foodLayer(sp)));
    carcass = world.layer<Float32Array>(CARCASS_LAYER);
    carcassLoad = world.layer<Float32Array>(CARCASS_LOAD_LAYER);
    pathogen = world.layer<Float32Array>(WATER_PATHOGEN_LAYER);
  }

  const f = (name: string) => agents.column<Float64Array>(name).data;
  let ax = f('x');
  let ay = f('y');
  let ids = agents.id.data;
  let rng = agents.column<Uint32Array>('rng').data;
  let kind = agents.column<Uint8Array>(C.actKind.name).data;
  let end = agents.column<Uint8Array>(C.actEnd.name).data;
  let cueOf = agents.column<Uint32Array>(C.actCue.name).data;
  let sourceOf = agents.column<Uint8Array>(C.actSource.name).data;
  let refOf = f(C.actRef.name);
  let gx = f(C.actX.name);
  let gy = f(C.actY.name);
  let started = f(C.actStart.name);
  let workS = f(C.actWorkS.name);
  let got = f(C.actGot.name);
  let drivesAt = agents.column<Float32Array>(C.actDrives.name).data;
  let held = agents.column<Uint32Array>(C.held.name).data;
  let effort = agents.column<Uint8Array>(B.effort.name).data;
  let moved = f(B.movedM.name);
  let moving = f(B.movingS.name);
  let climbed = f(B.climbedM.name);
  let load = f(B.loadKg.name);
  let born = f(B.born.name);
  let lean = f(B.leanKg.name);
  let gut = f(B.gut.name);
  let water = f(HEAT_COLUMNS.water.name);
  let core = f(HEAT_COLUMNS.coreC.name);
  let stomach = f(GUT_COLUMNS.stomachKg.name);
  let mobility = f(INJURY_COLUMNS.mobility.name);
  let armUse = f(INJURY_COLUMNS.armUse.name);
  let strain = f(INJURY_COLUMNS.strain.name);
  let fitness = f(FITNESS_COLUMNS.fitness.name);
  let fatigue = f(FITNESS_COLUMNS.fatigue.name);
  let acute = f(FITNESS_COLUMNS.acuteLoad.name);
  let pressure = f(SLEEP_COLUMNS.sleepPressure.name);

  // Objects' columns, fetched when used (the store grows as pieces break off).
  const objF32 = (name: string) => objects.column<Float32Array>(name).data;
  const objF64 = (name: string) => objects.column<Float64Array>(name).data;
  const objHolder = () => objects.column<Uint32Array>('holder').data;

  function cellOf(x: number, y: number): number {
    let i = Math.floor(x / cs);
    let j = Math.floor(y / cs);
    i = i < 0 ? 0 : i >= W ? W - 1 : i;
    j = j < 0 ? 0 : j >= H ? H - 1 : j;
    return j * W + i;
  }

  function isLake(x: number, y: number): boolean {
    return (waterKind as Uint8Array)[cellOf(x, y)] === Water.LAKE;
  }

  /** Age in years, and whether the body systems have seen this body yet (they set core temperature). */
  function ageOf(slot: number): number {
    return (state.tick - born[slot]) / perYear;
  }

  function tiredOf(slot: number): number {
    return tiredness(acute[slot], capacityFrom(fitness[slot], fatigue[slot]) * capacityAtAge(ageOf(slot)));
  }

  /** Share of walking speed: mobility (injury, youth) and tiredness. */
  function legsOf(slot: number): number {
    const m = core[slot] === 0 ? walkingAtAge(ageOf(slot)) : mobility[slot] * walkingAtAge(ageOf(slot));
    return m * (1 - 0.5 * tiredOf(slot));
  }

  /** Share of hand work: arm use and tiredness. */
  function handsOf(slot: number): number {
    const a = core[slot] === 0 ? 1 : armUse[slot];
    return a * (1 - 0.5 * tiredOf(slot));
  }

  function strengthNow(slot: number): number {
    return strengthFrom(lean[slot], strain[slot]) * strengthAtAge(ageOf(slot));
  }

  function heldBy(slot: number, out: Float64Array): number {
    const id = ids[slot];
    const holder = objHolder();
    let n = 0;
    for (let h = 0; h < K.hands; h++) {
      const oid = held[slot * K.hands + h];
      if (oid === 0) continue;
      const o = objects.slotOf(oid);
      if (o < 0 || holder[o] !== id) {
        held[slot * K.hands + h] = 0;
        continue;
      }
      out[n++] = oid;
    }
    return n;
  }
  const heldScratch = new Float64Array(2);

  function heldMass(slot: number): number {
    const n = heldBy(slot, heldScratch);
    const mass = objF32('mass');
    let kg = 0;
    for (let h = 0; h < n; h++) kg += mass[objects.slotOf(heldScratch[h])];
    return kg;
  }

  /** Move what the agent holds to where it stands. */
  function carryHeld(slot: number): void {
    const n = heldBy(slot, heldScratch);
    if (n === 0) return;
    const ox = objF64('x');
    const oy = objF64('y');
    for (let h = 0; h < n; h++) {
      const o = objects.slotOf(heldScratch[h]);
      ox[o] = ax[slot];
      oy[o] = ay[slot];
    }
  }

  // ---- walking

  let blocked = false;
  /**
   * Walk agent `slot` toward (tx, ty) for at most `seconds`, running for the first `runS` of them.
   * Returns the seconds used; sets `blocked` when a lake's shore stopped it.
   */
  function walk(slot: number, tx: number, ty: number, seconds: number, runS: number): number {
    blocked = false;
    const legs = legsOf(slot);
    if (!(legs > 0.01)) {
      blocked = true;
      return 0;
    }
    const x0 = ax[slot];
    const y0 = ay[slot];
    const dx = tx - x0;
    const dy = ty - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return 0;
    const run = runS > 0 ? (runS < seconds ? runS : seconds) : 0;
    let reach = K.runMs * legs * run + K.walkMs * legs * (seconds - run);
    if (reach > dist) reach = dist;
    // Stop at a lake's shore: the last sample before the first one in a lake.
    const ux = dx / dist;
    const uy = dy / dist;
    let go = reach;
    for (let s = K.shoreStepM; ; s += K.shoreStepM) {
      const at = s < reach ? s : reach;
      if (isLake(x0 + ux * at, y0 + uy * at)) {
        go = at - K.shoreStepM > 0 ? at - K.shoreStepM : 0;
        blocked = true;
        break;
      }
      if (at >= reach) break;
    }
    if (go <= 0) return 0;
    const x1 = clamp(x0 + ux * go, 0.01, widthM - 0.01);
    const y1 = clamp(y0 + uy * go, 0.01, heightM - 0.01);
    const runDist = K.runMs * legs * run;
    const used = go <= runDist ? go / (K.runMs * legs) : run + (go - runDist) / (K.walkMs * legs);
    const elev = elevation as Float32Array;
    const rise = elev[cellOf(x1, y1)] - elev[cellOf(x0, y0)];
    ax[slot] = x1;
    ay[slot] = y1;
    moved[slot] += go;
    moving[slot] += used;
    if (rise > 0) climbed[slot] += rise;
    carryHeld(slot);
    return used;
  }

  /** Where to stand to reach cell `k` from (x, y): just inside it, or just off a lake's shore. */
  function aimAtCell(k: number, x: number, y: number, out: Float64Array): void {
    const i = k % W;
    const j = (k - i) / W;
    const lake = (waterKind as Uint8Array)[k] === Water.LAKE;
    const x0 = i * cs;
    const y0 = j * cs;
    let px = clamp(x, x0, x0 + cs);
    let py = clamp(y, y0, y0 + cs);
    if (lake) {
      // Just outside, toward the agent.
      if (x < x0) px = x0 - K.insideM;
      else if (x > x0 + cs) px = x0 + cs + K.insideM;
      if (y < y0) py = y0 - K.insideM;
      else if (y > y0 + cs) py = y0 + cs + K.insideM;
    } else {
      px = clamp(px, x0 + K.insideM, x0 + cs - K.insideM);
      py = clamp(py, y0 + K.insideM, y0 + cs - K.insideM);
    }
    out[0] = clamp(px, 0.01, widthM - 0.01);
    out[1] = clamp(py, 0.01, heightM - 0.01);
  }
  const aim = new Float64Array(2);

  /** The target's position now, into `aim`; false if it is gone. */
  function targetNow(slot: number): boolean {
    const src = sourceOf[slot];
    const ref = refOf[slot];
    if (src === PerceptSource.ANIMAL) {
      const g = animals.slotOf(ref);
      if (g < 0) return false;
      aim[0] = animals.column<Float64Array>('x').data[g];
      aim[1] = animals.column<Float64Array>('y').data[g];
      return true;
    }
    if (src === PerceptSource.AGENT) {
      const a = agents.slotOf(ref);
      if (a < 0) return false;
      aim[0] = ax[a];
      aim[1] = ay[a];
      return true;
    }
    if (src === PerceptSource.OBJECT) {
      const o = objects.slotOf(ref);
      if (o < 0) return false;
      aim[0] = objF64('x')[o];
      aim[1] = objF64('y')[o];
      return true;
    }
    aim[0] = gx[slot];
    aim[1] = gy[slot];
    return true;
  }

  /** Is agent `slot` where it can work on its target? */
  function reached(slot: number): boolean {
    const dx = aim[0] - ax[slot];
    const dy = aim[1] - ay[slot];
    const d2 = dx * dx + dy * dy;
    if (sourceOf[slot] === PerceptSource.CELL) {
      const k = refOf[slot];
      if ((waterKind as Uint8Array)[k] !== Water.LAKE && cellOf(ax[slot], ay[slot]) === k) return true;
      return d2 <= 1;
    }
    return d2 <= K.reachM * K.reachM;
  }

  // ---- work

  let workEffort: number = Effort.STILL;
  let workUsed = 0;

  function finish(slot: number, how: number): void {
    end[slot] = how;
    tally[(how === ActEnd.DONE ? ActTally.DONE : ActTally.FAILED) + kind[slot]] += 1;
  }

  function eatPlant(slot: number, seconds: number): void {
    const k = refOf[slot];
    const s = classWhat(cuePayload(cueOf[slot]));
    const sp = PLANT_SPECIES[s];
    const layer = food[s];
    const stock = layer[k];
    const density = stock / hectares;
    const rate = (plantRate[s] * density) / (density + K.halfRateKgHa) * handsOf(slot);
    workEffort = sp.food.kind === 'stock' ? Effort.MODERATE : Effort.LIGHT;
    if (!(stock > 0.001) || !(rate > 0)) {
      workUsed = seconds < K.searchS ? seconds : K.searchS;
      finish(slot, workS[slot] === 0 ? ActEnd.FAILED : ActEnd.DONE);
      return;
    }
    const kcalPerKg = sp.kcalPerKg * sp.rawDigestible;
    const room = GUT.stomachMostKg - stomach[slot];
    const toFill = (fullGutKcal - gut[slot]) / kcalPerKg;
    let kg = (rate * seconds) / 3600;
    let full = false;
    if (kg >= stock) kg = stock;
    if (kg >= room) {
      kg = room > 0 ? room : 0;
      full = true;
    }
    if (kg >= toFill) {
      kg = toFill > 0 ? toFill : 0;
      full = true;
    }
    if (kg > 0) {
      tally[ActTally.KCAL] += ingest(sim, slot, kg * kcalPerKg);
      swallow(sim, slot, kg);
      if (sp.toxin !== null) {
        const units = kg * sp.toxin.dosePerKg;
        poison(sim, slot, units, sp.toxin.delayHours);
        tally[ActTally.POISON_UNITS] += units;
      }
      layer[k] = stock - kg;
      perception.invalidate(k);
      tally[ActTally.PLANT_KG + s] += kg;
      got[slot] += kg;
    }
    workUsed = (kg / rate) * 3600;
    if (full || layer[k] <= 0.001 || workS[slot] + workUsed >= K.eatMostS) finish(slot, ActEnd.DONE);
  }

  function eatMeat(slot: number, seconds: number): void {
    const k = refOf[slot];
    const meat = carcass as Float32Array;
    const stock = meat[k];
    workEffort = Effort.LIGHT;
    // A keen edge held cuts meat away; hands alone tear it slowly.
    const n = heldBy(slot, heldScratch);
    let edged = false;
    const edge = objF32('edge');
    for (let h = 0; h < n; h++) if (edge[objects.slotOf(heldScratch[h])] >= K.cuttingEdge) edged = true;
    const rate = (edged ? K.meatKgPerHourEdge : K.meatKgPerHourHand) * handsOf(slot);
    if (!(stock > 0.001) || !(rate > 0)) {
      workUsed = seconds < K.searchS ? seconds : K.searchS;
      finish(slot, workS[slot] === 0 ? ActEnd.FAILED : ActEnd.DONE);
      return;
    }
    const kcalPerKg = K.meatKcalPerKg * K.meatDigestible;
    const room = GUT.stomachMostKg - stomach[slot];
    const toFill = (fullGutKcal - gut[slot]) / kcalPerKg;
    let kg = (rate * seconds) / 3600;
    let full = false;
    if (kg >= stock) kg = stock;
    if (kg >= room) {
      kg = room > 0 ? room : 0;
      full = true;
    }
    if (kg >= toFill) {
      kg = toFill > 0 ? toFill : 0;
      full = true;
    }
    if (kg > 0) {
      tally[ActTally.KCAL] += ingest(sim, slot, kg * kcalPerKg);
      swallow(sim, slot, kg);
      exposeGut(sim, slot, meatDose(kg, (carcassLoad as Float32Array)[k]));
      meat[k] = stock - kg;
      perception.invalidate(k);
      tally[ActTally.MEAT_KG] += kg;
      got[slot] += kg;
    }
    workUsed = (kg / rate) * 3600;
    if (full || meat[k] <= 0.001 || workS[slot] + workUsed >= K.eatMostS) finish(slot, ActEnd.DONE);
  }

  function drinkHere(slot: number, seconds: number): void {
    const k = refOf[slot];
    workEffort = Effort.STILL;
    if ((waterKind as Uint8Array)[k] === Water.DRY) {
      workUsed = 0;
      finish(slot, ActEnd.FAILED);
      return;
    }
    const short = core[slot] === 0 ? 0 : fullWaterKg(lean[slot]) - water[slot];
    let kg = short > 0 ? short + K.sipKg : K.sipKg;
    const most = (K.drinkKgPerMinute * seconds) / 60;
    let done = true;
    if (kg > most) {
      kg = most;
      done = false;
    }
    if (kg > 0) {
      drink(sim, slot, kg);
      exposeGut(sim, slot, waterDose(kg, (pathogen as Float32Array)[k]));
      tally[ActTally.WATER_KG] += kg;
      got[slot] += kg;
    }
    workUsed = (kg / K.drinkKgPerMinute) * 60;
    if (done) finish(slot, ActEnd.DONE);
  }

  /** Take an object into a free hand if strength allows; false if not. */
  function grasp(slot: number, o: number): boolean {
    let hand = -1;
    for (let h = 0; h < K.hands; h++) {
      const oid = held[slot * K.hands + h];
      if (oid === 0 || objects.slotOf(oid) < 0 || objHolder()[objects.slotOf(oid)] !== ids[slot]) {
        hand = h;
        break;
      }
    }
    if (hand < 0) return false;
    const mass = objF32('mass')[o];
    if (heldMass(slot) + mass > K.holdKgPerStrength * strengthNow(slot)) return false;
    objHolder()[o] = ids[slot];
    held[slot * K.hands + hand] = objects.id.data[o];
    objF64('x')[o] = ax[slot];
    objF64('y')[o] = ay[slot];
    return true;
  }

  function pickUp(slot: number, seconds: number): void {
    workEffort = Effort.LIGHT;
    workUsed = seconds < K.handleS ? seconds : K.handleS;
    let free = false;
    for (let h = 0; h < K.hands; h++) {
      const oid = held[slot * K.hands + h];
      if (oid === 0 || objects.slotOf(oid) < 0 || objHolder()[objects.slotOf(oid)] !== ids[slot]) free = true;
    }
    if (!free) {
      finish(slot, ActEnd.FAILED);
      return;
    }
    if (sourceOf[slot] === PerceptSource.OBJECT) {
      const o = objects.slotOf(refOf[slot]);
      if (o < 0 || objHolder()[o] !== 0 || !grasp(slot, o)) {
        finish(slot, ActEnd.FAILED);
        return;
      }
    } else {
      // A cell's loose stone or fallen wood: a piece of it becomes an object, then is taken up.
      const k = refOf[slot];
      const c = cuePayload(cueOf[slot]);
      const what = classWhat(c);
      const i = k % W;
      const px = clamp(ax[slot], i * cs + K.insideM, (i + 1) * cs - K.insideM);
      const py = clamp(ay[slot], ((k - i) / W) * cs + K.insideM, ((k - i) / W + 1) * cs - K.insideM);
      const o =
        classKind(c) === ClassKind.WOOD
          ? takeWood(sim, what === 1, px, py, rng, slot * STREAM_WORDS)
          : takeStone(sim, what, px, py, rng, slot * STREAM_WORDS);
      perception.invalidate(k);
      if (o < 0 || !grasp(slot, o)) {
        finish(slot, ActEnd.FAILED);
        return;
      }
    }
    got[slot] += 1;
    finish(slot, ActEnd.DONE);
  }

  function dropHeld(slot: number): void {
    workEffort = Effort.STILL;
    workUsed = 0;
    const o = objects.slotOf(refOf[slot]);
    if (o < 0 || objHolder()[o] !== ids[slot]) {
      finish(slot, ActEnd.FAILED);
      return;
    }
    objHolder()[o] = 0;
    objF64('x')[o] = ax[slot];
    objF64('y')[o] = ay[slot];
    for (let h = 0; h < K.hands; h++) if (held[slot * K.hands + h] === refOf[slot]) held[slot * K.hands + h] = 0;
    workUsed = K.handleS;
    finish(slot, ActEnd.DONE);
  }

  /** Strike `b` with `a` (object slots) `blows` times; returns the blows struck. */
  function blowsOn(slot: number, a: number, b: number, blows: number): number {
    const sOff = slot * STREAM_WORDS;
    const force = strengthNow(slot);
    let n = 0;
    for (; n < blows; n++) {
      if (objects.alive.data[a] !== 1 || objects.alive.data[b] !== 1) break;
      const energy = 0.5 * objF32('mass')[a] * K.blowMs * K.blowMs * force;
      const out = strikeObjects(sim, a, b, energy, K.precision, rng, sOff);
      tally[ActTally.PIECES] += out.pieces.length;
      if (out.sparks > 0 && sparksAt(sim, ax[slot], ay[slot], out.sparks, out.sparkHeat, rng, sOff)) tally[ActTally.FIRES_LIT] += 1;
    }
    return n;
  }

  function strike(slot: number, seconds: number): void {
    workEffort = Effort.MODERATE;
    const n = heldBy(slot, heldScratch);
    const target = objects.slotOf(refOf[slot]);
    if (n === 0 || target < 0 || objHolder()[target] !== 0) {
      workUsed = 0;
      finish(slot, ActEnd.FAILED);
      return;
    }
    const striker = objects.slotOf(heldScratch[0]);
    const left = K.blows - got[slot];
    let blows = Math.floor(seconds / K.blowS);
    if (blows > left) blows = left;
    const struck = blowsOn(slot, striker, target, blows);
    got[slot] += struck;
    workUsed = struck * K.blowS;
    if (got[slot] >= K.blows || struck < blows) finish(slot, ActEnd.DONE);
  }

  function manipulate(slot: number, seconds: number): void {
    workEffort = Effort.HEAVY;
    const n = heldBy(slot, heldScratch);
    if (n < 2) {
      workUsed = 0;
      finish(slot, ActEnd.FAILED);
      return;
    }
    const a = objects.slotOf(heldScratch[0]);
    const b = objects.slotOf(heldScratch[1]);
    const material = objects.column<Uint8Array>('material').data;
    let left = K.manipulateS - workS[slot];
    if (left > seconds) left = seconds;
    if (material[a] === Material.WOOD && material[b] === Material.WOOD) {
      const attempts = Math.floor(left / K.rubS);
      const energy = K.rubS * K.rubW * strengthNow(slot);
      let caught = false;
      for (let t = 0; t < attempts && !caught; t++) {
        const r = rubWood(sim, a, b, energy, K.precision, rng, slot * STREAM_WORDS);
        if (r.ember) tally[ActTally.EMBERS] += 1;
        if (r.caught) {
          tally[ActTally.FIRES_LIT] += 1;
          caught = true;
        }
      }
      workUsed = left;
    } else {
      const blows = Math.floor(left / K.blowS);
      const struck = blowsOn(slot, a, b, blows);
      workUsed = struck < blows ? struck * K.blowS : left;
      if (struck < blows) {
        finish(slot, ActEnd.DONE);
        return;
      }
    }
    if (workS[slot] + workUsed >= K.manipulateS - 1e-9) finish(slot, ActEnd.DONE);
  }

  // ---- the tick of one act

  const limits = K.limitHours.map((h) => Math.max(1, Math.round(h * ticksPerHour)));

  function run(slot: number): void {
    const k0 = kind[slot];
    let rest = dt;
    workEffort = Effort.STILL;
    workUsed = 0;
    if (k0 === Act.NONE || end[slot] !== ActEnd.GOING) {
      load[slot] += heldMass(slot);
      return;
    }
    if (k0 === Act.SLEEP) {
      if (sleepiness(config, state.tick, pressure[slot]) <= SLEEP.wakeAt) {
        finish(slot, ActEnd.DONE);
      } else {
        effort[slot] = Effort.SLEEP;
      }
      load[slot] += heldMass(slot);
      return;
    }
    if (k0 === Act.REST) {
      if (tiredOf(slot) < K.restedBelow && state.tick > started[slot]) finish(slot, ActEnd.DONE);
      effort[slot] = Effort.STILL;
      load[slot] += heldMass(slot);
      return;
    }
    if (k0 === Act.DROP) {
      dropHeld(slot);
      load[slot] += heldMass(slot);
      return;
    }
    if (k0 === Act.MANIPULATE) {
      manipulate(slot, rest);
      workS[slot] += workUsed;
      effort[slot] = workUsed * 2 >= rest ? workEffort : Effort.STILL;
      load[slot] += heldMass(slot);
      return;
    }

    // Acts with a place to be: walk there first.
    if (!targetNow(slot)) {
      finish(slot, ActEnd.FAILED);
      load[slot] += heldMass(slot);
      return;
    }
    if (k0 === Act.EXPLORE) {
      // On a heading for a while, until a shore or the edge stops it.
      const left = K.exploreS - workS[slot];
      const used = walk(slot, gx[slot], gy[slot], left < rest ? left : rest, 0);
      workS[slot] += used;
      const dx = gx[slot] - ax[slot];
      const dy = gy[slot] - ay[slot];
      if (blocked || used === 0 || workS[slot] >= K.exploreS - 1e-9 || dx * dx + dy * dy <= 1) finish(slot, ActEnd.DONE);
      load[slot] += heldMass(slot);
      return;
    }
    const last = state.tick - started[slot] >= limits[k0] - 1;
    if (k0 === Act.AVOID) {
      // Keep at least avoidM from it: run the first minute, walk after, stand when far enough.
      let dx = ax[slot] - aim[0];
      let dy = ay[slot] - aim[1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < K.avoidM) {
        if (d < 1e-6) {
          dx = 1;
          dy = 0;
        } else {
          dx /= d;
          dy /= d;
        }
        const away = K.avoidM - (d < 1e-6 ? 0 : d);
        const runFor = K.avoidRunS - workS[slot];
        const tx = clamp(ax[slot] + dx * away, 0.01, widthM - 0.01);
        const ty = clamp(ay[slot] + dy * away, 0.01, heightM - 0.01);
        workS[slot] += walk(slot, tx, ty, rest, runFor > 0 ? runFor : 0);
      }
      if (last) finish(slot, ActEnd.DONE);
      load[slot] += heldMass(slot);
      return;
    }
    if (!reached(slot)) {
      const used = walk(slot, aim[0], aim[1], rest, 0);
      rest -= used;
      if (!reached(slot)) {
        if (blocked || used === 0) finish(slot, ActEnd.FAILED);
        load[slot] += heldMass(slot);
        return;
      }
    }
    if (k0 === Act.APPROACH) {
      // Stay by it, following it if it moves, until the act's hour is out.
      if (last) finish(slot, ActEnd.DONE);
      load[slot] += heldMass(slot);
      return;
    }
    if (rest > 0) {
      switch (k0) {
        case Act.CONSUME: {
          const c = classKind(cuePayload(cueOf[slot]));
          if (c === ClassKind.PLANT) eatPlant(slot, rest);
          else if (c === ClassKind.CARCASS) eatMeat(slot, rest);
          else if (c === ClassKind.WATER) drinkHere(slot, rest);
          else finish(slot, ActEnd.FAILED);
          break;
        }
        case Act.PICK_UP:
          pickUp(slot, rest);
          break;
        case Act.STRIKE:
          strike(slot, rest);
          break;
        default:
          finish(slot, ActEnd.FAILED);
      }
      workS[slot] += workUsed;
      effort[slot] = workUsed * 2 >= rest ? workEffort : Effort.STILL;
    }
    load[slot] += heldMass(slot);
  }

  function begin(slot: number, k: number, cueId: number, source: number, ref: number, x: number, y: number, drives: Float64Array, offset: number): void {
    kind[slot] = k;
    end[slot] = ActEnd.GOING;
    cueOf[slot] = cueId;
    sourceOf[slot] = source;
    refOf[slot] = ref;
    started[slot] = state.tick;
    workS[slot] = 0;
    got[slot] = 0;
    for (let ch = 0; ch < 8; ch++) drivesAt[slot * 8 + ch] = drives[offset + ch];
    tally[ActTally.BEGUN + k] += 1;
    if (k === Act.EXPLORE) {
      const u = nextFloat(rng, slot * STREAM_WORDS);
      const far = K.walkMs * K.exploreS;
      gx[slot] = clamp(ax[slot] + far * cosTurn(u), 0.01, widthM - 0.01);
      gy[slot] = clamp(ay[slot] + far * sinTurn(u), 0.01, heightM - 0.01);
      return;
    }
    if (source === PerceptSource.CELL) {
      aimAtCell(ref, ax[slot], ay[slot], aim);
      gx[slot] = aim[0];
      gy[slot] = aim[1];
      return;
    }
    gx[slot] = x;
    gy[slot] = y;
  }

  return {
    refresh() {
      layers();
      ax = f('x');
      ay = f('y');
      ids = agents.id.data;
      rng = agents.column<Uint32Array>('rng').data;
      kind = agents.column<Uint8Array>(C.actKind.name).data;
      end = agents.column<Uint8Array>(C.actEnd.name).data;
      cueOf = agents.column<Uint32Array>(C.actCue.name).data;
      sourceOf = agents.column<Uint8Array>(C.actSource.name).data;
      refOf = f(C.actRef.name);
      gx = f(C.actX.name);
      gy = f(C.actY.name);
      started = f(C.actStart.name);
      workS = f(C.actWorkS.name);
      got = f(C.actGot.name);
      drivesAt = agents.column<Float32Array>(C.actDrives.name).data;
      held = agents.column<Uint32Array>(C.held.name).data;
      effort = agents.column<Uint8Array>(B.effort.name).data;
      moved = f(B.movedM.name);
      moving = f(B.movingS.name);
      climbed = f(B.climbedM.name);
      load = f(B.loadKg.name);
      born = f(B.born.name);
      lean = f(B.leanKg.name);
      gut = f(B.gut.name);
      water = f(HEAT_COLUMNS.water.name);
      core = f(HEAT_COLUMNS.coreC.name);
      stomach = f(GUT_COLUMNS.stomachKg.name);
      mobility = f(INJURY_COLUMNS.mobility.name);
      armUse = f(INJURY_COLUMNS.armUse.name);
      strain = f(INJURY_COLUMNS.strain.name);
      fitness = f(FITNESS_COLUMNS.fitness.name);
      fatigue = f(FITNESS_COLUMNS.fatigue.name);
      acute = f(FITNESS_COLUMNS.acuteLoad.name);
      pressure = f(SLEEP_COLUMNS.sleepPressure.name);
    },
    begin,
    run,
    limitTicks: (k) => limits[k],
    heldBy,
  };
}
