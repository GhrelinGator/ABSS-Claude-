// Turning the landscape's layers into pixels. Viewer-only code: it may use
// any arithmetic, because nothing here feeds back into the simulation.

import type { RoArray, SimView } from '../sim/index.ts';
import { animals, plants } from '../sim/index.ts';

export type LayerMode = 'land' | 'height' | 'rain' | 'soil' | 'flow' | 'moisture' | 'plants' | 'ripe' | 'animals';

/** Display names and colours of the plant species, in catalogue order. */
export const PLANT_NAMES: Readonly<Record<string, string>> = {
  grass: 'Grass',
  tuber: 'Tuber',
  berry: 'Berry bush',
  nut: 'Nut tree',
  greens: 'Greens',
  bitterRoot: 'Bitter root',
  nightshade: 'Nightshade',
  reed: 'Reed',
};
export const PLANT_COLORS: Readonly<Record<string, [number, number, number]>> = {
  grass: [196, 188, 92],
  tuber: [150, 112, 70],
  berry: [170, 60, 100],
  nut: [38, 92, 46],
  greens: [110, 190, 80],
  bitterRoot: [200, 140, 60],
  nightshade: [96, 50, 120],
  reed: [60, 150, 140],
};
const BARE: [number, number, number] = [176, 156, 120];

/** Dot colours for animal groups, drawn on every layer, by kind number. */
export const ANIMAL_DOT_COLORS: Readonly<Record<number, [number, number, number]>> = {
  1: [150, 92, 40],
  2: [20, 18, 16],
  3: [215, 215, 225],
  4: [235, 140, 30],
};
const ANIMAL_DOTS: ReadonlyArray<[string, [number, number, number]]> = [
  ['Deer', ANIMAL_DOT_COLORS[1]],
  ['Aurochs', ANIMAL_DOT_COLORS[2]],
  ['Wolves', ANIMAL_DOT_COLORS[3]],
  ['Big cat', ANIMAL_DOT_COLORS[4]],
];

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
  /** Soil moisture, 0 to 1. Changes once a day. */
  moisture: RoArray;
  /** Share of each cell each plant species covers, in catalogue order. Changes once a day. */
  plantCover: RoArray[];
  /** Kilograms of each species' edible part in each cell, in catalogue order. */
  plantFood: RoArray[];
  /** Hares per cell, and kilograms of carcass meat per cell. */
  hare: RoArray;
  carcass: RoArray;
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
    moisture: view.layer('water.soilMoisture'),
    plantCover: plants.PLANT_SPECIES.map((s) => view.layer(plants.coverLayer(s))),
    plantFood: plants.PLANT_SPECIES.map((s) => view.layer(plants.foodLayer(s))),
    hare: view.layer(animals.HARE_LAYER),
    carcass: view.layer(animals.CARCASS_LAYER),
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
  const { W, H, elevation, rainfall, soil, kind, flow, moisture, shade, minElevation, maxElevation, plantCover, plantFood } = land;
  const species = plants.PLANT_SPECIES;
  const colors = species.map((s) => PLANT_COLORS[s.name] ?? [255, 0, 255]);
  // Ripe food: the seasonal kinds a body can eat, in kcal.
  const ripe = species.map((s) => (s.food.kind === 'seasonal' && !(s.toxin && !s.toxin.removedByProcessing) ? s.kcalPerKg : 0));
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
      case 'moisture': {
        const t = moisture[k];
        c = t < 0.5 ? mix([176, 112, 60], [206, 196, 120], t * 2) : mix([206, 196, 120], [52, 122, 92], (t - 0.5) * 2);
        c = [c[0] * (0.8 + 0.25 * shade[k]), c[1] * (0.8 + 0.25 * shade[k]), c[2] * (0.8 + 0.25 * shade[k])];
        break;
      }
      case 'plants': {
        // The colour of whichever species covers most of the cell, fading to bare ground where cover is thin.
        let total = 0;
        let top = -1;
        let topShare = 0;
        for (let s = 0; s < species.length; s++) {
          const share = plantCover[s][k];
          total += share;
          if (share > topShare) {
            topShare = share;
            top = s;
          }
        }
        c = top < 0 ? BARE : mix(BARE, colors[top], Math.min(1, total * 1.25));
        c = [c[0] * light, c[1] * light, c[2] * light];
        break;
      }
      case 'animals': {
        // Hares per km² on a log scale from 1 to 100, carcasses in red.
        if (land.carcass[k] > 5) {
          c = [200, 40, 40];
        } else {
          const perKm2 = land.hare[k] * (1e6 / (land.cellSizeM * land.cellSizeM));
          const t = perKm2 <= 1 ? 0 : Math.min(1, Math.log10(perKm2) / 2);
          c = mix([46, 44, 40], [190, 170, 120], t);
          c = [c[0] * (0.8 + 0.25 * shade[k]), c[1] * (0.8 + 0.25 * shade[k]), c[2] * (0.8 + 0.25 * shade[k])];
        }
        break;
      }
      case 'ripe': {
        let kcal = 0;
        for (let s = 0; s < species.length; s++) if (ripe[s] > 0) kcal += plantFood[s][k] * ripe[s];
        // Per hectare, on a log scale from 1,000 to 10 million kcal.
        const perHa = kcal / ((land.cellSizeM * land.cellSizeM) / 10_000);
        const t = perHa <= 1e3 ? 0 : Math.min(1, Math.log10(perHa / 1e3) / 4);
        c = t === 0 ? [40, 38, 34] : t < 0.5 ? mix([70, 60, 40], [214, 150, 50], t * 2) : mix([214, 150, 50], [255, 236, 150], (t - 0.5) * 2);
        c = [c[0] * (0.8 + 0.25 * shade[k]), c[1] * (0.8 + 0.25 * shade[k]), c[2] * (0.8 + 0.25 * shade[k])];
        break;
      }
    }
    if (mode !== 'flow' && mode !== 'rain' && mode !== 'moisture') {
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
    case 'moisture':
      return '<span>Parched<span class="ramp" style="background:linear-gradient(90deg,rgb(176,112,60),rgb(206,196,120),rgb(52,122,92))"></span>Soaked (water in the soil, updated daily)</span>';
    case 'plants':
      return '<span>Colour of the plant covering most of each patch:</span>' + plants.PLANT_SPECIES.map((s) => swatch(PLANT_COLORS[s.name] ?? [255, 0, 255], PLANT_NAMES[s.name] ?? s.name)).join('') + swatch(BARE, 'Bare ground') + water;
    case 'animals':
      return '<span>Hares: few<span class="ramp" style="background:linear-gradient(90deg,rgb(46,44,40),rgb(190,170,120))"></span>100 per km²</span>' + swatch([200, 40, 40], 'Carcass') + ANIMAL_DOTS.map(([name, color]) => swatch(color, name)).join('') + water;
    case 'ripe':
      return '<span>None<span class="ramp" style="background:linear-gradient(90deg,rgb(40,38,34),rgb(70,60,40),rgb(214,150,50),rgb(255,236,150))"></span>10 million kcal per hectare (from 1,000)</span><span>Fruit, seeds and nuts waiting to be picked (not roots underground, not nightshade)</span>' + water;
  }
}
