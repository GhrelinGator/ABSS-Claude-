// Deer diagnosis for milestone 1.13 (ROADMAP 1.13): runs the world without agents and measures,
// several times a compressed year, where the deer are, where their food is, what an hourly
// decision could find from where each group stands, and how the deer breed and die.
//   node experiments/P1-open-seed-6/diagnose.ts --seed 6 --years 30 --circ 0 [--cells 512] [--maps 5,15,25]
// Reads the sim only; writes nothing to it, so the run is the same run the harness would make.

import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import { ANIMAL_CONSTANTS, ANIMAL_FIELDS, ANIMAL_PARTS, ANIMAL_STORE, AnimalKind, GROUP_KINDS } from '../../src/sim/world/animals.ts';
import { CLIMATE_CONSTANTS, CLIMATE_PARTS, dailyMeanTemperatureC } from '../../src/sim/world/climate.ts';
import { seasonFraction } from '../../src/sim/world/light.ts';
import { BROWSE_LAYER, FORAGE_LAYER, PLANT_CONSTANTS, PLANT_SPECIES, coverLayer } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const seed = Number(arg('seed', '6'));
const years = Number(arg('years', '30'));
const circ = Number(arg('circ', '0'));
const cells = Number(arg('cells', '512'));
const maps = new Set(arg('maps', '').split(',').filter((s) => s !== '').map(Number));
const samplesPerYear = 8;

const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
raw.world.widthCells = cells;
raw.world.heightCells = cells;
raw.world.circumscription = circ;
const config = validateConfig(raw);
const sim = createSim(config, SIM_PIPELINE);
const { state } = sim;
const world = state.world;
const W = config.world.widthCells;
const H = config.world.heightCells;
const cs = config.world.cellSizeM;
const N = W * H;
const areaHa = (cs * cs) / 10_000;
const perDay = config.time.ticksPerDay;
const perYear = perDay * config.time.daysPerYear;
const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
const water = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
const soil = world.layer<Uint8Array>(TERRAIN_LAYERS.soil);
const forage = world.layer<Float32Array>(FORAGE_LAYER);
const browse = world.layer<Float32Array>(BROWSE_LAYER);
const cover = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
const greens = cover[PLANT_SPECIES.findIndex((sp) => sp.name === 'greens')];
const counts = state.parts.find((p) => p.name === ANIMAL_PARTS.counts)!.readings!();
const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather)!.readings!();
const store = state.store(ANIMAL_STORE);
const deer = GROUP_KINDS.find((k) => k.kind === AnimalKind.DEER)!;
const F = ANIMAL_FIELDS;
const A = ANIMAL_CONSTANTS;
const lapse = CLIMATE_CONSTANTS.lapseRatePerM;
const reference = CLIMATE_CONSTANTS.referenceElevationM;
const floorShare = PLANT_CONSTANTS.ungrazableShare;

// What a deer can eat in a cell, as animals.ts computes it (reachable browse + grass up to its share).
function reachable(k: number, kind: 'graze' | 'browse'): number {
  let floor = 0;
  for (let s = 0; s < PLANT_SPECIES.length; s++) {
    const sp = PLANT_SPECIES[s];
    if (sp.forageKind === kind) floor += cover[s][k] * sp.forageKgHa * areaHa * floorShare;
  }
  const r = (kind === 'graze' ? forage[k] : browse[k]) - floor;
  return r > 0 ? r : 0;
}
const deerFood = (k: number) => reachable(k, 'browse') + reachable(k, 'graze') * deer.grassShareMax;

// Distance to open water over the grid (chessboard steps), once.
const waterSteps = new Int32Array(N).fill(-1);
{
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < N; k++) if (water[k] !== Water.DRY) {
    waterSteps[k] = 0;
    queue[tail++] = k;
  }
  while (head < tail) {
    const k = queue[head++];
    const i = k % W;
    const j = (k - i) / W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const q = jj * W + ii;
      if (waterSteps[q] < 0) {
        waterSteps[q] = waterSteps[k] + 1;
        queue[tail++] = q;
      }
    }
  }
}

let land = 0;
let landElev = 0;
for (let k = 0; k < N; k++) if (water[k] === Water.DRY) {
  land++;
  landElev += elevation[k];
}
console.log(`seed ${seed}, circumscription ${circ}, ${W}×${H} cells, land ${(land * areaHa / 100).toFixed(0)} km², mean land elevation ${(landElev / land).toFixed(0)} m`);
{
  // Where greens grow at the start: by soil, by distance to water, by elevation.
  const bySoil = new Float64Array(5);
  const byWater = new Float64Array(6);
  let gElev = 0;
  let gTotal = 0;
  for (let k = 0; k < N; k++) {
    if (water[k] !== Water.DRY) continue;
    const g = greens[k];
    gTotal += g;
    gElev += g * elevation[k];
    bySoil[soil[k]] += g;
    const ws = waterSteps[k];
    byWater[ws <= 1 ? 0 : ws <= 3 ? 1 : ws <= 10 ? 2 : ws <= 30 ? 3 : ws <= 100 ? 4 : 5] += g;
  }
  const pct = (a: Float64Array) => Array.from(a, (v) => `${((100 * v) / gTotal).toFixed(0)}%`).join(' ');
  console.log(`greens at start: mean cover on land ${(gTotal / land).toFixed(3)}, cover-weighted elevation ${(gElev / gTotal).toFixed(0)} m`);
  console.log(`  by soil (rock thin loam alluvium sand): ${pct(bySoil)}`);
  console.log(`  by steps to water (≤1 ≤3 ≤10 ≤30 ≤100 more): ${pct(byWater)}`);
}

// Distance from the nearest deer group, by multi-source BFS from the cells deer stand in.
const deerDist = new Int32Array(N);
const bfsQueue = new Int32Array(N);
function distanceFromDeer(): void {
  deerDist.fill(-1);
  let head = 0;
  let tail = 0;
  const kind = store.column('kind').data as Uint8Array;
  const xs = store.column('x').data as Float32Array;
  const ys = store.column('y').data as Float32Array;
  for (let s = 0; s < store.highWater; s++) {
    if (!store.isAlive(s) || kind[s] !== AnimalKind.DEER) continue;
    const k = Math.floor(ys[s] / cs) * W + Math.floor(xs[s] / cs);
    if (deerDist[k] < 0) {
      deerDist[k] = 0;
      bfsQueue[tail++] = k;
    }
  }
  while (head < tail) {
    const k = bfsQueue[head++];
    const i = k % W;
    const j = (k - i) / W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const q = jj * W + ii;
      if (deerDist[q] < 0) {
        deerDist[q] = deerDist[k] + 1;
        bfsQueue[tail++] = q;
      }
    }
  }
}

interface Sample {
  year: number;
  season: number;
  deer: number;
  groups: number;
  cond: number;
  starving: number;
  hungry: number;
  elevDeer: number;
  tDeerMinusComfort: number;
  hereShort: number;
  best800Short: number;
  best3kShort: number;
  scorePicksPoor: number;
  thirsty: number;
  waterStepsDeer: number;
  modes: number[];
  foodKg: number;
  foodNear: number[];
  foodElev: number;
  greensCover: number;
}

function sample(year: number): Sample {
  const tick = state.tick;
  const season = seasonFraction(config, tick);
  const atRef = dailyMeanTemperatureC(config, tick, weather, reference);
  const kind = store.column('kind').data as Uint8Array;
  const xs = store.column('x').data as Float32Array;
  const ys = store.column('y').data as Float32Array;
  const count = store.column('count').data as Uint16Array;
  const condition = store.column('condition').data as Float32Array;
  const thirst = store.column('thirst').data as Float32Array;
  const mode = store.column('mode').data as Uint8Array;
  const food = new Float32Array(N);
  let foodKg = 0;
  let foodElev = 0;
  let greensTotal = 0;
  for (let k = 0; k < N; k++) {
    if (water[k] !== Water.DRY) continue;
    const f = deerFood(k);
    food[k] = f;
    foodKg += f;
    foodElev += f * elevation[k];
    greensTotal += greens[k];
  }
  distanceFromDeer();
  const foodNear = [0, 0, 0, 0];
  for (let k = 0; k < N; k++) {
    if (food[k] <= 0) continue;
    const d = deerDist[k] * cs;
    foodNear[d <= 1000 ? 0 : d <= 3000 ? 1 : d <= 10_000 ? 2 : 3] += food[k];
  }
  const s: Sample = {
    year, season, deer: 0, groups: 0, cond: 0, starving: 0, hungry: 0, elevDeer: 0, tDeerMinusComfort: 0,
    hereShort: 0, best800Short: 0, best3kShort: 0, scorePicksPoor: 0, thirsty: 0, waterStepsDeer: 0,
    modes: [0, 0, 0, 0, 0, 0], foodKg, foodNear: foodNear.map((v) => v / (foodKg || 1)), foodElev: foodElev / (foodKg || 1),
    greensCover: greensTotal / land,
  };
  const r800 = Math.round(A.grazeSearchM / cs);
  const r3k = Math.round(A.hungryGrazeSearchM / cs);
  for (let slot = 0; slot < store.highWater; slot++) {
    if (!store.isAlive(slot) || kind[slot] !== AnimalKind.DEER) continue;
    const n = count[slot];
    const i0 = Math.floor(xs[slot] / cs);
    const j0 = Math.floor(ys[slot] / cs);
    const k0 = j0 * W + i0;
    const dayNeed = n * deer.needKgPerDay;
    s.deer += n;
    s.groups++;
    s.cond += n * condition[slot];
    if (condition[slot] < A.starvingBelow) s.starving += n;
    if (condition[slot] < A.hungryBelow) s.hungry += n;
    s.elevDeer += n * elevation[k0];
    s.tDeerMinusComfort += n * (atRef - lapse * (elevation[k0] - reference) - deer.comfortC);
    if (food[k0] < dayNeed) s.hereShort += n;
    if (thirst[slot] >= A.thirstyAfterHours) s.thirsty += n;
    s.waterStepsDeer += n * waterSteps[k0];
    s.modes[mode[slot]] += n;
    // Exhaustive look over the squares the hourly decision samples from.
    let best800 = 0;
    let best3k = 0;
    let bestScore = -1e9;
    let foodAtBestScore = 0;
    for (let j = j0 - r3k; j <= j0 + r3k; j++) {
      if (j < 0 || j >= H) continue;
      for (let i = i0 - r3k; i <= i0 + r3k; i++) {
        if (i < 0 || i >= W) continue;
        const k = j * W + i;
        if (water[k] !== Water.DRY) continue;
        const f = food[k];
        if (f > best3k) best3k = f;
        if (Math.abs(i - i0) <= r800 && Math.abs(j - j0) <= r800) {
          if (f > best800) best800 = f;
          const ratio = f / dayNeed;
          const warmth = atRef - lapse * (elevation[k] - reference) - deer.comfortC;
          const sc = (ratio < 2 ? ratio : 2) / 2 - Math.abs(warmth) / 10;
          if (sc > bestScore) {
            bestScore = sc;
            foodAtBestScore = f;
          }
        }
      }
    }
    if (best800 < dayNeed) s.best800Short += n;
    if (best3k < dayNeed) s.best3kShort += n;
    if (foodAtBestScore < dayNeed && best800 >= 2 * dayNeed) s.scorePicksPoor += n;
  }
  const d = s.deer || 1;
  s.cond /= d;
  s.starving /= d;
  s.hungry /= d;
  s.elevDeer /= d;
  s.tDeerMinusComfort /= d;
  s.hereShort /= d;
  s.best800Short /= d;
  s.best3kShort /= d;
  s.scorePicksPoor /= d;
  s.thirsty /= d;
  s.waterStepsDeer /= d;
  s.modes = s.modes.map((v) => v / d);
  return s;
}

/** A coarse map: each character a block; deer per km² as a digit band, food (kg/ha) as a letter band. */
function printMap(year: number): void {
  const B = Math.max(1, Math.floor(W / 64));
  const bw = Math.ceil(W / B);
  const bh = Math.ceil(H / B);
  const deerIn = new Float64Array(bw * bh);
  const foodIn = new Float64Array(bw * bh);
  const landIn = new Float64Array(bw * bh);
  const kind = store.column('kind').data as Uint8Array;
  const xs = store.column('x').data as Float32Array;
  const ys = store.column('y').data as Float32Array;
  const count = store.column('count').data as Uint16Array;
  for (let slot = 0; slot < store.highWater; slot++) {
    if (!store.isAlive(slot) || kind[slot] !== AnimalKind.DEER) continue;
    const b = Math.floor(ys[slot] / cs / B) * bw + Math.floor(xs[slot] / cs / B);
    deerIn[b] += count[slot];
  }
  for (let k = 0; k < N; k++) {
    const i = k % W;
    const j = (k - i) / W;
    const b = Math.floor(j / B) * bw + Math.floor(i / B);
    if (water[k] === Water.DRY) {
      landIn[b]++;
      foodIn[b] += deerFood(k);
    }
  }
  console.log(`\nyear ${year} map, ${B * cs} m blocks. Left: deer per km² (. none, 1 <2, 2 <5, 3 <10, 4 <20, 5 ≥20; ~ water). Right: deer food kg/ha (. <10, a <30, b <60, c <100, d <150, e ≥150).`);
  const kmBlock = (B * cs / 1000) ** 2;
  for (let j = 0; j < bh; j++) {
    let l = '';
    let r = '';
    for (let i = 0; i < bw; i++) {
      const b = j * bw + i;
      if (landIn[b] < (B * B) / 2) {
        l += '~';
        r += '~';
        continue;
      }
      const dens = deerIn[b] / (kmBlock * (landIn[b] / (B * B)));
      l += dens <= 0 ? '.' : dens < 2 ? '1' : dens < 5 ? '2' : dens < 10 ? '3' : dens < 20 ? '4' : '5';
      const fha = foodIn[b] / (landIn[b] * areaHa);
      r += fha < 10 ? '.' : fha < 30 ? 'a' : fha < 60 ? 'b' : fha < 100 ? 'c' : fha < 150 ? 'd' : 'e';
    }
    console.log(`${l}  ${r}`);
  }
}

const f = (v: number, d = 2) => v.toFixed(d);
const pc = (v: number) => `${(100 * v).toFixed(0)}%`;
console.log('\nyear season | deer groups cond starving hungry | elev(deer) T-comfort | short: here ≤800m ≤3km scorePicksPoor | thirsty waterSteps | modes rest/move/flee | food t, share ≤1km ≤3km ≤10km >10km, food elev | greens');
let before = Array.from(counts);
const yearRows: string[] = [];
for (let y = 0; y < years; y++) {
  for (let q = 0; q < samplesPerYear; q++) {
    const target = y * perYear + Math.round(((q + 0.5) * perYear) / samplesPerYear) + perDay / 2;
    if (state.tick < target) stepSim(sim, target - state.tick);
    const s = sample(y);
    console.log(
      `${String(y).padStart(3)} ${f(s.season)} | ${String(s.deer).padStart(6)} ${String(s.groups).padStart(5)} ${f(s.cond)} ${pc(s.starving).padStart(4)} ${pc(s.hungry).padStart(4)} | ${f(s.elevDeer, 0)} ${f(s.tDeerMinusComfort, 1).padStart(5)} | ${pc(s.hereShort).padStart(4)} ${pc(s.best800Short).padStart(4)} ${pc(s.best3kShort).padStart(4)} ${pc(s.scorePicksPoor).padStart(4)} | ${pc(s.thirsty).padStart(4)} ${f(s.waterStepsDeer, 1)} | ${s.modes.slice(0, 3).map(pc).join('/')} | ${f(s.foodKg / 1000, 0)}t ${s.foodNear.map(pc).join(' ')} ${f(s.foodElev, 0)} | ${f(s.greensCover, 3)}`,
    );
  }
  if (state.tick < (y + 1) * perYear) stepSim(sim, (y + 1) * perYear - state.tick);
  const now = Array.from(counts);
  const dd = (i: number) => now[i] - before[i];
  yearRows.push(
    `${String(y).padStart(3)} | births ${String(dd(F.birthsDeer)).padStart(5)} deaths ${String(dd(F.deathsDeer)).padStart(5)} (hunger, all kinds ${String(dd(F.hungerDeaths)).padStart(5)}) | wolf kills ${String(dd(F.wolfKillsDeer)).padStart(4)} cat kills ${String(dd(F.catKillsDeer)).padStart(4)}`,
  );
  console.log(yearRows[yearRows.length - 1]);
  before = now;
  if (maps.has(y)) printMap(y);
}
