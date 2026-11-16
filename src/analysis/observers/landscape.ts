// Manipulation check for experiment E3 (docs/DESIGN.md §2.10, §7.11): how
// much of the map is land a forager could live on, and how much of that land
// is one connected region walled in by land they could not.
//
// "Habitable" is the analyst's yardstick for describing a landscape. Agents
// never see it and the simulation never uses it.

import type { Observer } from '../observer.ts';
import type { RoArray, SimView } from '../../sim/readonly.ts';

/** Thresholds of the habitable-land yardstick. */
export const HABITABLE = {
  maxSlope: 0.3,
  minRainfall: 0.35,
  /** Fresh water within this distance makes dry land habitable. */
  waterReachM: 1500,
} as const;

export interface LandscapeSummary {
  /** Share of all cells that are habitable. */
  habitableFraction: number;
  /** Share of habitable cells that lie in the largest connected habitable region. */
  largestRegionShare: number;
  /** The largest region's size as a share of the whole map. */
  largestRegionFraction: number;
  /** Cells of the largest region that touch land outside it (not the map edge), per cell of region: higher means more walled in. */
  enclosedEdgePerCell: number;
  /** Cells of the largest region on the map edge, per cell of region: room to wander off the map. */
  mapEdgePerCell: number;
  /** Shares of cells that are spring, river, or lake. */
  springFraction: number;
  riverFraction: number;
  lakeFraction: number;
  meanRainfall: number;
}

const cache = new WeakMap<object, LandscapeSummary>();

function slopeAt(e: RoArray, W: number, H: number, cs: number, i: number, j: number): number {
  let steepest = 0;
  const here = e[j * W + i];
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue;
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const run = di !== 0 && dj !== 0 ? cs * Math.SQRT2 : cs;
      const s = Math.abs(e[nj * W + ni] - here) / run;
      if (s > steepest) steepest = s;
    }
  }
  return steepest;
}

/** Chamfer distance (in cells) from every cell to the nearest marked cell. */
function distanceToMarked(marked: Uint8Array, W: number, H: number): Float32Array {
  const far = 1e9;
  const d = new Float32Array(W * H).fill(far);
  for (let k = 0; k < marked.length; k++) if (marked[k] === 1) d[k] = 0;
  const diag = Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - W] + 1);
        if (i > 0) v = Math.min(v, d[k - W - 1] + diag);
        if (i < W - 1) v = Math.min(v, d[k - W + 1] + diag);
      }
      d[k] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      let v = d[k];
      if (i < W - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < H - 1) {
        v = Math.min(v, d[k + W] + 1);
        if (i < W - 1) v = Math.min(v, d[k + W + 1] + diag);
        if (i > 0) v = Math.min(v, d[k + W - 1] + diag);
      }
      d[k] = v;
    }
  }
  return d;
}

export function summarizeLandscape(view: SimView): LandscapeSummary {
  const elevation = view.layer('terrain.elevation');
  const cached = cache.get(elevation as object);
  if (cached) return cached;

  const { widthCells: W, heightCells: H, cellSizeM: cs } = view.config.world;
  const N = W * H;
  const rainfall = view.layer('terrain.rainfall');
  const kind = view.layer('water.kind');

  const wet = new Uint8Array(N);
  let springs = 0;
  let rivers = 0;
  let lakes = 0;
  let rainSum = 0;
  for (let k = 0; k < N; k++) {
    rainSum += rainfall[k];
    if (kind[k] === 1) springs++;
    else if (kind[k] === 2) rivers++;
    else if (kind[k] === 3) lakes++;
    if (kind[k] !== 0) wet[k] = 1;
  }
  const toWater = distanceToMarked(wet, W, H);
  const reachCells = HABITABLE.waterReachM / cs;

  const habitable = new Uint8Array(N);
  let habitableCount = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (kind[k] === 3) continue; // open water is not land
      if (slopeAt(elevation, W, H, cs, i, j) > HABITABLE.maxSlope) continue;
      if (rainfall[k] < HABITABLE.minRainfall && toWater[k] > reachCells) continue;
      habitable[k] = 1;
      habitableCount++;
    }
  }

  // Connected regions of habitable land (8-neighbour).
  const region = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  let largestId = -1;
  let largestSize = 0;
  let nextId = 0;
  for (let start = 0; start < N; start++) {
    if (habitable[start] !== 1 || region[start] !== -1) continue;
    const id = nextId++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    region[start] = id;
    while (head < tail) {
      const k = queue[head++];
      const i = k % W;
      const j = (k - i) / W;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          if (habitable[n] === 1 && region[n] === -1) {
            region[n] = id;
            queue[tail++] = n;
          }
        }
      }
    }
    if (tail > largestSize) {
      largestSize = tail;
      largestId = id;
    }
  }

  let enclosedEdge = 0;
  let mapEdge = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (region[k] !== largestId || largestId < 0) continue;
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) mapEdge++;
      let walled = false;
      if (i > 0 && region[k - 1] !== largestId && kind[k - 1] !== 3) walled = true;
      if (i < W - 1 && region[k + 1] !== largestId && kind[k + 1] !== 3) walled = true;
      if (j > 0 && region[k - W] !== largestId && kind[k - W] !== 3) walled = true;
      if (j < H - 1 && region[k + W] !== largestId && kind[k + W] !== 3) walled = true;
      if (walled) enclosedEdge++;
    }
  }

  const summary: LandscapeSummary = {
    habitableFraction: habitableCount / N,
    largestRegionShare: habitableCount === 0 ? 0 : largestSize / habitableCount,
    largestRegionFraction: largestSize / N,
    enclosedEdgePerCell: largestSize === 0 ? 0 : enclosedEdge / largestSize,
    mapEdgePerCell: largestSize === 0 ? 0 : mapEdge / largestSize,
    springFraction: springs / N,
    riverFraction: rivers / N,
    lakeFraction: lakes / N,
    meanRainfall: rainSum / N,
  };
  cache.set(elevation as object, summary);
  return summary;
}

export const landscape: Observer = {
  name: 'landscape',
  observe(view) {
    // A pipeline without a landscape (such as a test fixture) has nothing to summarize.
    if (!view.layerNames().includes('terrain.elevation')) return {};
    return { ...summarizeLandscape(view) };
  },
};
