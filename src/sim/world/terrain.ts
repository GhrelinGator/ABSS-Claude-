// The landscape: relief, mean rainfall, drainage, rivers, lakes, springs, and
// soil. Built once before tick 0 from the seed and the config, and constant
// afterwards. Design: docs/DESIGN.md §2.10.

import type { SimConfig } from '../config.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextFloat } from '../core/rng.ts';
import type { Sim, SimState } from '../sim.ts';
import { fieldKey, fractal, noise2 } from './noise.ts';

/** Names of the layers this system declares. */
export const TERRAIN_LAYERS = {
  elevation: 'terrain.elevation',
  rainfall: 'terrain.rainfall',
  soil: 'terrain.soil',
  waterKind: 'water.kind',
  waterDepth: 'water.depth',
  drain: 'water.drain',
  flow: 'water.flow',
} as const;

export const Soil = { ROCK: 0, THIN: 1, LOAM: 2, ALLUVIUM: 3, SAND: 4 } as const;
export const Water = { DRY: 0, SPRING: 1, RIVER: 2, LAKE: 3 } as const;

/** Every number the generator uses, in one place. Lengths in metres unless marked as a fraction of the map. */
export const TERRAIN_CONSTANTS = {
  baseElevationM: 400,
  reliefAmplitudeM: 250,
  reliefOctaves: 6,
  /** Longest relief wavelength, as a fraction of the map's shorter side (about 25 km on the default map). */
  reliefWavelength: 0.5,
  /** Rise along the valley axis, metres per metre (5 m per km). */
  axisTilt: 0.005,
  /** Valley half-width, ramp width, meander amplitude and wavelength, as fractions of the shorter side. */
  valleyHalfWidth: 0.137,
  barrierRamp: 0.06,
  meanderAmplitude: 0.06,
  meanderWavelength: 0.4,
  barrierHeightM: 1400,
  /**
   * How much of the relief a valley floor loses to river sediment when
   * circumscription is 1: valley floors are graded plains sloping
   * downstream, not the hummocky ground around them.
   */
  valleySmoothing: 0.85,
  /**
   * Cross-slope of the valley floor toward its centre line when
   * circumscription is 1, metres per metre (12 m per km). Without it, rain on
   * a smooth floor runs straight downhill in parallel lines and never
   * gathers into one river.
   */
  troughSlope: 0.012,
  rainOctaves: 3,
  rainVariation: 0.25,
  /** How much of the rain is lost in the desert. */
  desertRainLoss: 0.85,
  /**
   * Where the desert begins, as a distance from the valley axis (fraction of
   * the shorter side) when circumscription is 0. As circumscription rises to
   * 1 the desert's edge moves in to the middle of the valley walls, so the
   * land left between valley and desert shrinks gradually rather than all at
   * once, and at 1 none is left.
   */
  desertStartOpen: 0.75,
  desertRamp: 0.05,
  /** Extra rain at the upstream end when circumscription is 1. */
  headlandRain: 0.9,
  /** Where the wet headland starts, and over how much of the map it ramps up, as fractions along the axis. */
  headlandStart: 0.25,
  headlandRamp: 0.2,
  minRainfall: 0.05,
  /**
   * Share of each closed basin's depth filled by sediment over geological
   * time, so that only the deepest cores of basins still hold water. Random
   * relief has far more closed basins than real land, where rivers have long
   * since drained or filled most of them.
   */
  basinInfill: 0.85,
  /**
   * Rain that evaporates or soaks in before it can run off, in the same
   * units as rainfall. Runoff is rainfall minus this, never negative, so
   * deserts feed no rivers of their own.
   */
  evaporation: 0.3,
  lakeMinDepthM: 1,
  lakeMinFlowKm2: 0.7,
  /** A lake holds only if its catchment's rain-weighted area is at least this many times its own area: inflow must offset evaporation from the surface. */
  lakeCatchmentRatio: 5,
  lakeMinCells: 3,
  riverMinFlowKm2: 7,
  largeRiverFlowKm2: 28,
  rockSlope: 0.35,
  thinSoilSlope: 0.15,
  thinSoilElevationM: 1200,
  alluviumMaxSlope: 0.05,
  alluviumReachM: 200,
  sandRainfall: 0.25,
} as const;

const K = TERRAIN_CONSTANTS;

// Noise field salts. Never renumber: they are part of what a seed means.
const SALT_RELIEF = 1;
const SALT_BARRIER = 2;
const SALT_RAIN = 3;
const SALT_MEANDER = 4;
const SALT_FLATS = 5;

/** MurmurHash3's 32-bit finalizer. */
function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- relief and rainfall

interface Fields {
  elevation: Float32Array;
  rainfall: Float32Array;
}

function shapeLand(config: SimConfig, streams: Uint32Array): Fields {
  const { widthCells: W, heightCells: H, cellSizeM: cs, circumscription: c } = config.world;
  const L = Math.min(W, H) * cs;
  const o = globalStreamOffset(StreamDomain.WORLD_GEN);

  // The valley axis: a uniformly random direction, drawn by rejection from the unit disc.
  let ux = 0;
  let uy = 0;
  let q = 0;
  do {
    ux = nextFloat(streams, o) * 2 - 1;
    uy = nextFloat(streams, o) * 2 - 1;
    q = ux * ux + uy * uy;
  } while (q > 1 || q < 0.0625);
  const norm = Math.sqrt(q);
  ux /= norm;
  uy /= norm;
  const px = -uy;
  const py = ux;

  const reliefKey = fieldKey(config.seed, SALT_RELIEF);
  const barrierKey = fieldKey(config.seed, SALT_BARRIER);
  const rainKey = fieldKey(config.seed, SALT_RAIN);
  const meanderKey = fieldKey(config.seed, SALT_MEANDER);

  const reliefScale = 1 / (K.reliefWavelength * L);
  const meanderScale = 1 / (K.meanderWavelength * L);
  const halfWidth = K.valleyHalfWidth * L;
  const ramp = K.barrierRamp * L;
  const meanderAmp = K.meanderAmplitude * L;
  const headStart = K.headlandStart * L;
  const headRamp = K.headlandRamp * L;
  const wallMiddle = halfWidth + 0.5 * ramp;
  const desertStart = wallMiddle + (1 - c) * (K.desertStartOpen * L - wallMiddle);
  const desertRamp = K.desertRamp * L;
  const cx = (W * cs) / 2;
  const cy = (H * cs) / 2;

  const elevation = new Float32Array(W * H);
  const rainfall = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const y = (j + 0.5) * cs - cy;
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * cs - cx;
      const along = x * ux + y * uy;
      const across = x * px + y * py - meanderAmp * noise2(meanderKey, along * meanderScale, 0.5);
      const distance = across < 0 ? -across : across;
      const outside = smoothstep((distance - halfWidth) / ramp);

      const graded = 1 - K.valleySmoothing * c * (1 - outside);
      const relief = graded * K.reliefAmplitudeM * fractal(reliefKey, x * reliefScale, y * reliefScale, K.reliefOctaves);
      const ruggedness = 0.6 + 0.4 * (0.5 + 0.5 * noise2(barrierKey, x * reliefScale * 4, y * reliefScale * 4));
      const barrier = c * K.barrierHeightM * outside * ruggedness;
      const trough = c * K.troughSlope * (distance < halfWidth + ramp ? distance : halfWidth + ramp);
      elevation[j * W + i] = K.baseElevationM + relief + K.axisTilt * along + trough + barrier;

      const base = 1 + K.rainVariation * fractal(rainKey, x * reliefScale, y * reliefScale, K.rainOctaves);
      const desert = smoothstep((distance - desertStart) / desertRamp);
      // The wet headland is the upper valley itself, not the uplands beside it.
      const headland = smoothstep((along - headStart) / headRamp) * (1 - outside);
      const rain = base * (1 - K.desertRainLoss * desert) + K.headlandRain * c * headland;
      rainfall[j * W + i] = rain < K.minRainfall ? K.minRainfall : rain;
    }
  }
  return { elevation, rainfall };
}

// ---------------------------------------------------------------- drainage

// Neighbour offsets in a fixed order; the order is part of the result.
const DI = [-1, 0, 1, -1, 1, -1, 0, 1];
const DJ = [-1, -1, -1, 0, 0, 1, 1, 1];

/** Binary min-heap of cells keyed by (height, cell index). The index breaks ties, so pops are deterministic. */
class CellHeap {
  private readonly keys: Float64Array;
  private readonly cells: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.cells = new Int32Array(capacity);
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a];
    const kb = this.keys[b];
    return ka < kb || (ka === kb && this.cells[a] < this.cells[b]);
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const c = this.cells[a];
    this.cells[a] = this.cells[b];
    this.cells[b] = c;
  }

  push(key: number, cell: number): void {
    let i = this.size++;
    this.keys[i] = key;
    this.cells[i] = cell;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.cells[0];
    const last = --this.size;
    if (last > 0) {
      this.keys[0] = this.keys[last];
      this.cells[0] = this.cells[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < last && this.less(l, m)) m = l;
        if (r < last && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

interface Drainage {
  /** Elevation with every depression filled to its spill point. */
  filled: Float32Array;
  /** The neighbour each cell drains to, or -1 if it drains off the map. */
  drain: Int32Array;
  /** Cells in the order they were reached: every cell comes after the cell it drains to. */
  order: Int32Array;
}

/**
 * Priority-flood from the map edges, with a first-in-first-out queue for
 * cells inside depressions (Barnes, Lehman & Mulla 2014, "improved"
 * variant). The queue makes water inside a filled depression drain along the
 * shortest path to its spill point, instead of in straight lines set by
 * cell numbering.
 */
function routeWater(W: number, H: number, elevation: Float32Array, flatsKey: number): Drainage {
  const N = W * H;
  // Steps from the cell where each flat stretch was entered; 0 for cells on slopes.
  const steps = new Int32Array(N);
  const position = new Int32Array(N);
  const filled = new Float32Array(N);
  const drain = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  const reached = new Uint8Array(N);
  const heap = new CellHeap(N);
  const pit = new Int32Array(N);
  let pitHead = 0;
  let pitTail = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (i !== 0 && j !== 0 && i !== W - 1 && j !== H - 1) continue;
      const cell = j * W + i;
      reached[cell] = 1;
      filled[cell] = elevation[cell];
      heap.push(filled[cell], cell);
    }
  }
  let k = 0;
  while (pitHead < pitTail || heap.size > 0) {
    const cell = pitHead < pitTail ? pit[pitHead++] : heap.pop();
    position[cell] = k;
    order[k++] = cell;
    const ci = cell % W;
    const cj = (cell - ci) / W;
    const level = filled[cell];
    for (let d = 0; d < 8; d++) {
      const ni = ci + DI[d];
      const nj = cj + DJ[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (reached[n] === 1) continue;
      reached[n] = 1;
      drain[n] = cell;
      if (elevation[n] <= level) {
        filled[n] = level;
        steps[n] = steps[cell] + 1;
        pit[pitTail++] = n;
      } else {
        filled[n] = elevation[n];
        heap.push(filled[n], n);
      }
    }
  }

  // On flat stretches every neighbour one step closer to the way out is an
  // equally good route. Always taking the first one found draws straight
  // lines; picking among them by a hash of the seed and the cell makes water
  // meander across flats instead, as it does on real floodplains.
  const choices = new Int32Array(8);
  for (let cell = 0; cell < N; cell++) {
    if (steps[cell] === 0) continue;
    const ci = cell % W;
    const cj = (cell - ci) / W;
    let count = 0;
    for (let d = 0; d < 8; d++) {
      const ni = ci + DI[d];
      const nj = cj + DJ[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (filled[n] === filled[cell] && steps[n] === steps[cell] - 1 && position[n] < position[cell]) {
        choices[count++] = n;
      }
    }
    if (count > 1) drain[cell] = choices[mix32(flatsKey ^ Math.imul(cell, 0x9e3779b1)) % count];
  }
  return { filled, drain, order };
}

// ---------------------------------------------------------------- water bodies and soil

/** Steepest slope from each cell to any neighbour (rise over run, either direction). */
export function steepestSlope(W: number, H: number, cellSizeM: number, elevation: ArrayLike<number>): Float32Array {
  const slope = new Float32Array(W * H);
  const diagonal = cellSizeM * Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const cell = j * W + i;
      const e = elevation[cell];
      let steepest = 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d];
        const nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        let rise = elevation[nj * W + ni] - e;
        if (rise < 0) rise = -rise;
        const s = rise / (DI[d] !== 0 && DJ[d] !== 0 ? diagonal : cellSizeM);
        if (s > steepest) steepest = s;
      }
      slope[cell] = steepest;
    }
  }
  return slope;
}

function markLakes(
  W: number,
  H: number,
  cellAreaKm2: number,
  elevation: Float32Array,
  filled: Float32Array,
  drain: Int32Array,
  flow: Float32Array,
  kind: Uint8Array,
  depth: Float32Array,
): void {
  const N = W * H;
  const candidate = new Uint8Array(N);
  for (let cell = 0; cell < N; cell++) {
    if (filled[cell] - elevation[cell] >= K.lakeMinDepthM) candidate[cell] = 1;
  }
  const seen = new Uint8Array(N);
  const patch = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    if (candidate[start] !== 1 || seen[start] === 1) continue;
    let size = 0;
    patch[size++] = start;
    seen[start] = 1;
    for (let p = 0; p < size; p++) {
      const cell = patch[p];
      const ci = cell % W;
      const cj = (cell - ci) / W;
      for (let d = 0; d < 8; d++) {
        const ni = ci + DI[d];
        const nj = cj + DJ[d];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (candidate[n] === 1 && seen[n] === 0) {
          seen[n] = 1;
          patch[size++] = n;
        }
      }
    }
    // Everything that runs into the basin leaves through its outlet, so the
    // flow out of the patch is the patch's total inflow, however the water
    // was routed inside it.
    let inflow = 0;
    for (let p = 0; p < size; p++) {
      const cell = patch[p];
      const down = drain[cell];
      const leaving = down < 0 ? flow[cell] : seen[down] === 1 && candidate[down] === 1 ? 0 : flow[down];
      if (leaving > inflow) inflow = leaving;
    }
    const balanced = inflow >= K.lakeCatchmentRatio * size * cellAreaKm2;
    if (size >= K.lakeMinCells && inflow >= K.lakeMinFlowKm2 && balanced) {
      for (let p = 0; p < size; p++) {
        const cell = patch[p];
        kind[cell] = Water.LAKE;
        depth[cell] = filled[cell] - elevation[cell];
      }
    }
  }
}

function assignSoil(
  config: SimConfig,
  elevation: Float32Array,
  rainfall: Float32Array,
  kind: Uint8Array,
  flow: Float32Array,
  soil: Uint8Array,
): void {
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const N = W * H;
  const slope = steepestSlope(W, H, cs, elevation);

  // Ground within reach of a large river or a lake, grown outward one ring of cells at a time.
  let near = new Uint8Array(N);
  for (let cell = 0; cell < N; cell++) {
    if (kind[cell] === Water.LAKE || (kind[cell] === Water.RIVER && flow[cell] >= K.largeRiverFlowKm2)) near[cell] = 1;
  }
  const rings = Math.max(1, Math.round(K.alluviumReachM / cs));
  for (let r = 0; r < rings; r++) {
    const grown = near.slice();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (near[j * W + i] !== 1) continue;
        for (let d = 0; d < 8; d++) {
          const ni = i + DI[d];
          const nj = j + DJ[d];
          if (ni >= 0 && nj >= 0 && ni < W && nj < H) grown[nj * W + ni] = 1;
        }
      }
    }
    near = grown;
  }

  for (let cell = 0; cell < N; cell++) {
    const s = slope[cell];
    if (s > K.rockSlope) soil[cell] = Soil.ROCK;
    else if (near[cell] === 1 && s < K.alluviumMaxSlope) soil[cell] = Soil.ALLUVIUM;
    else if (rainfall[cell] < K.sandRainfall) soil[cell] = Soil.SAND;
    else if (s > K.thinSoilSlope || elevation[cell] > K.thinSoilElevationM) soil[cell] = Soil.THIN;
    else soil[cell] = Soil.LOAM;
  }
}

/** Build the whole landscape into the sim's layers. */
function generate(sim: Sim): void {
  const { config, state } = sim;
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const N = W * H;
  const world = state.world;

  const { elevation, rainfall } = shapeLand(config, state.streams);
  const { filled, drain, order } = routeWater(W, H, elevation, fieldKey(config.seed, SALT_FLATS));
  // Sediment fills most of each closed basin. The filled surface, and so the drainage, is unchanged.
  for (let cell = 0; cell < N; cell++) {
    elevation[cell] = elevation[cell] + K.basinInfill * (filled[cell] - elevation[cell]);
  }

  const cellAreaKm2 = (cs * cs) / 1e6;
  const flow64 = new Float64Array(N);
  for (let cell = 0; cell < N; cell++) {
    const runoff = rainfall[cell] - K.evaporation;
    flow64[cell] = runoff > 0 ? runoff * cellAreaKm2 : 0;
  }
  for (let k = N - 1; k >= 0; k--) {
    const cell = order[k];
    const down = drain[cell];
    if (down >= 0) flow64[down] += flow64[cell];
  }
  const flow = Float32Array.from(flow64);

  const kind = new Uint8Array(N);
  const depth = new Float32Array(N);
  markLakes(W, H, cellAreaKm2, elevation, filled, drain, flow, kind, depth);
  for (let cell = 0; cell < N; cell++) {
    if (kind[cell] !== Water.LAKE && flow[cell] >= K.riverMinFlowKm2) kind[cell] = Water.RIVER;
  }
  // A river cell that nothing wet drains into is where the river begins: a spring.
  const fedFromAbove = new Uint8Array(N);
  for (let cell = 0; cell < N; cell++) {
    if ((kind[cell] === Water.RIVER || kind[cell] === Water.LAKE) && drain[cell] >= 0) fedFromAbove[drain[cell]] = 1;
  }
  for (let cell = 0; cell < N; cell++) {
    if (kind[cell] === Water.RIVER && fedFromAbove[cell] === 0) kind[cell] = Water.SPRING;
  }

  const soil = new Uint8Array(N);
  assignSoil(config, elevation, rainfall, kind, flow, soil);

  world.layer<Float32Array>(TERRAIN_LAYERS.elevation).set(elevation);
  world.layer<Float32Array>(TERRAIN_LAYERS.rainfall).set(rainfall);
  world.layer<Uint8Array>(TERRAIN_LAYERS.soil).set(soil);
  world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind).set(kind);
  world.layer<Float32Array>(TERRAIN_LAYERS.waterDepth).set(depth);
  world.layer<Int32Array>(TERRAIN_LAYERS.drain).set(drain);
  world.layer<Float32Array>(TERRAIN_LAYERS.flow).set(flow);
}

// ALIBI: land, rain, rivers, lakes and soil are there before anything lives on them,
// and stay the same whether or not anything ever does.
export const terrain: SystemDef = defineSystem({
  name: 'world.terrain',
  declare(state: SimState) {
    state.world.ensureLayer(TERRAIN_LAYERS.elevation, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.rainfall, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.soil, 'u8');
    state.world.ensureLayer(TERRAIN_LAYERS.waterKind, 'u8');
    state.world.ensureLayer(TERRAIN_LAYERS.waterDepth, 'f32');
    state.world.ensureLayer(TERRAIN_LAYERS.drain, 'i32');
    state.world.ensureLayer(TERRAIN_LAYERS.flow, 'f32');
  },
  // The landscape does not change from tick to tick (yet), so there is nothing to step.
  create: () => () => {},
  init: generate,
});
