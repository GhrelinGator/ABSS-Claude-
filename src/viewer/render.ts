// Turning the landscape's layers into pixels. Viewer-only code: it may use
// any arithmetic, because nothing here feeds back into the simulation.

import type { RoArray, SimView } from '../sim/index.ts';

export type LayerMode = 'land' | 'height' | 'rain' | 'soil' | 'flow';

export const SOIL_COLORS: ReadonlyArray<[number, number, number]> = [
  [132, 126, 118], // rock
  [158, 146, 104], // thin
  [104, 138, 70], // loam
  [74, 112, 54], // alluvium
  [214, 190, 132], // sand
];
export const SOIL_NAMES = ['Rock', 'Thin soil', 'Loam', 'Alluvium', 'Sand'];
export const WATER_NAMES = ['Dry land', 'Spring', 'River', 'Lake'];

const RIVER: [number, number, number] = [64, 118, 206];
const BIG_RIVER: [number, number, number] = [52, 100, 196];
const LAKE: [number, number, number] = [44, 86, 172];
const SPRING: [number, number, number] = [150, 220, 255];

export interface Landscape {
  W: number;
  H: number;
  cellSizeM: number;
  elevation: RoArray;
  rainfall: RoArray;
  soil: RoArray;
  kind: RoArray;
  depth: RoArray;
  flow: RoArray;
  /** 0 (shadow) to 1 (lit), from light falling from the north-west. */
  shade: Float32Array;
  minElevation: number;
  maxElevation: number;
}

export function readLandscape(view: SimView): Landscape {
  const { widthCells: W, heightCells: H, cellSizeM } = view.config.world;
  const elevation = view.layer('terrain.elevation');
  const shade = new Float32Array(W * H);
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const e = elevation[k];
      if (e < minElevation) minElevation = e;
      if (e > maxElevation) maxElevation = e;
      const east = elevation[j * W + Math.min(W - 1, i + 1)] - elevation[j * W + Math.max(0, i - 1)];
      const south = elevation[Math.min(H - 1, j + 1) * W + i] - elevation[Math.max(0, j - 1) * W + i];
      // Exaggerate relief three times so gentle hills still read on a phone screen.
      const gx = (3 * east) / (2 * cellSizeM);
      const gy = (3 * south) / (2 * cellSizeM);
      const nx = -gx;
      const ny = -gy;
      const n = Math.hypot(nx, ny, 1);
      const lit = (nx * -0.5 + ny * -0.5 + 0.7) / (n * Math.hypot(0.5, 0.5, 0.7));
      shade[k] = Math.max(0, Math.min(1, lit));
    }
  }
  return {
    W,
    H,
    cellSizeM,
    elevation,
    rainfall: view.layer('terrain.rainfall'),
    soil: view.layer('terrain.soil'),
    kind: view.layer('water.kind'),
    depth: view.layer('water.depth'),
    flow: view.layer('water.flow'),
    shade,
    minElevation,
    maxElevation,
  };
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Colour every cell of the landscape for the chosen layer, into an RGBA buffer. */
export function paint(land: Landscape, mode: LayerMode, out: Uint8ClampedArray): void {
  const { W, H, elevation, rainfall, soil, kind, flow, shade, minElevation, maxElevation } = land;
  const span = Math.max(1, maxElevation - minElevation);
  const N = W * H;

  // Big rivers drawn three cells wide so they show at phone size.
  const wide = new Uint8Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (flow[j * W + i] < 100 || kind[j * W + i] === 3) continue;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < W && nj < H) wide[nj * W + ni] = 1;
        }
      }
    }
  }

  for (let k = 0; k < N; k++) {
    let c: [number, number, number];
    const light = 0.55 + 0.6 * shade[k];
    switch (mode) {
      case 'land': {
        const wet = Math.max(0, Math.min(1, (rainfall[k] - 0.15) / 0.85));
        c = mix([214, 188, 128], [86, 128, 62], wet);
        if (soil[k] === 0) c = [134, 128, 120];
        const high = Math.max(0, Math.min(1, (elevation[k] - 1300) / 500));
        c = mix(c, [205, 200, 192], high);
        c = [c[0] * light, c[1] * light, c[2] * light];
        break;
      }
      case 'height': {
        const t = (elevation[k] - minElevation) / span;
        const g = 40 + 200 * t;
        c = [g * light, g * light, g * light];
        break;
      }
      case 'rain': {
        const t = Math.max(0, Math.min(1, rainfall[k] / 1.6));
        c = t < 0.5 ? mix([150, 92, 48], [196, 186, 96], t * 2) : mix([196, 186, 96], [46, 120, 160], (t - 0.5) * 2);
        c = [c[0] * (0.8 + 0.25 * shade[k]), c[1] * (0.8 + 0.25 * shade[k]), c[2] * (0.8 + 0.25 * shade[k])];
        break;
      }
      case 'soil': {
        const s = SOIL_COLORS[soil[k]] ?? [255, 0, 255];
        c = [s[0] * (0.75 + 0.35 * shade[k]), s[1] * (0.75 + 0.35 * shade[k]), s[2] * (0.75 + 0.35 * shade[k])];
        break;
      }
      case 'flow': {
        const t = Math.max(0, Math.min(1, Math.log10(1 + flow[k]) / 3.2));
        c = mix([22, 24, 30], [120, 200, 255], t);
        break;
      }
    }
    if (mode !== 'flow' && mode !== 'rain') {
      if (kind[k] === 3) c = LAKE;
      else if (kind[k] === 1) c = SPRING;
      else if (wide[k] === 1) c = BIG_RIVER;
      else if (kind[k] === 2) c = RIVER;
    }
    const o = k * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 255;
  }
}

/** HTML for the legend of a layer. */
export function legendFor(mode: LayerMode, land: Landscape): string {
  const swatch = (rgb: readonly number[], label: string): string =>
    `<span><span class="swatch" style="background:rgb(${rgb.join(',')})"></span>${label}</span>`;
  const water = swatch(RIVER, 'River') + swatch(LAKE, 'Lake') + swatch(SPRING, 'Spring');
  switch (mode) {
    case 'land':
      return swatch([86, 128, 62], 'Wet ground') + swatch([214, 188, 128], 'Dry ground') + swatch([134, 128, 120], 'Rock') + water;
    case 'height':
      return `<span>${Math.round(land.minElevation)} m<span class="ramp" style="background:linear-gradient(90deg,rgb(40,40,40),rgb(240,240,240))"></span>${Math.round(land.maxElevation)} m</span>${water}`;
    case 'rain':
      return '<span>Dry<span class="ramp" style="background:linear-gradient(90deg,rgb(150,92,48),rgb(196,186,96),rgb(46,120,160))"></span>Wet (mean rainfall)</span>';
    case 'soil':
      return SOIL_COLORS.map((rgb, i) => swatch(rgb, SOIL_NAMES[i])).join('') + water;
    case 'flow':
      return '<span>Little<span class="ramp" style="background:linear-gradient(90deg,rgb(22,24,30),rgb(120,200,255))"></span>A lot of water flowing through</span>';
  }
}
