// The viewer page (docs/DESIGN.md §10.1). It runs the real simulation in the
// browser and only reads from it: nothing here writes to simulation state.

import { summarizeLandscape } from '../analysis/index.ts';
import {
  arithmeticProblems,
  climate,
  clock,
  createStandardSim,
  defaultConfig,
  light,
  plants,
  stepSim,
  validateConfig,
  viewOf,
} from '../sim/index.ts';
import type { Sim, SimConfig, SimView } from '../sim/index.ts';
import { BUILD } from './build-info.ts';
import { PLANT_NAMES, SOIL_NAMES, WATER_NAMES, legendFor, paint, readLandscape } from './render.ts';
import type { Landscape, LayerMode } from './render.ts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const canvas = element<HTMLCanvasElement>('map');
const context = canvas.getContext('2d') as CanvasRenderingContext2D;
const busy = element<HTMLDivElement>('busy');
const dateLine = element<HTMLDivElement>('date');
const skyLine = element<HTMLDivElement>('sky');
const weatherLine = element<HTMLDivElement>('weather');
const varInput = element<HTMLInputElement>('var');
const dayNightToggle = element<HTMLInputElement>('dayNight');
const weatherToggle = element<HTMLInputElement>('weatherFx');
const calmNote = element<HTMLParagraphElement>('calmNote');
const varOut = element<HTMLOutputElement>('varOut');
const playButton = element<HTMLButtonElement>('play');
const speedSelect = element<HTMLSelectElement>('speed');
const legend = element<HTMLDivElement>('legend');
const inspectPanel = element<HTMLElement>('inspect');
const seedInput = element<HTMLInputElement>('seed');
const randomButton = element<HTMLButtonElement>('random');
const circInput = element<HTMLInputElement>('circ');
const circOut = element<HTMLOutputElement>('circOut');
const buildButton = element<HTMLButtonElement>('build');
const statsPanel = element<HTMLDivElement>('stats');
const selfcheckLine = element<HTMLParagraphElement>('selfcheck');
const layerButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-layer]'));

const offscreen = document.createElement('canvas');
const offscreenContext = offscreen.getContext('2d') as CanvasRenderingContext2D;

let sim: Sim | null = null;
let view: SimView | null = null;
let land: Landscape | null = null;
let mode: LayerMode = 'land';
let playing = false;
let ticksPerSecond = Number(speedSelect.value);
let carry = 0;
let lastFrame = 0;
let drawnTick = -1;
let drawnMode: LayerMode | null = null;
let inspected = -1;
let paintedDay = -1;
/** Tick to open the first world at; later worlds open at noon on day one. */
let openAt = -1;

const F = climate.CLIMATE_FIELDS;

/**
 * Above 1 simulated day per real second, night and rain come and go several
 * times a second: a flashing screen. Those effects are hidden at such speeds,
 * whatever the switches say. (Flashing more than three times a second is
 * what accessibility guidelines warn against.)
 */
const CALM_ABOVE_TICKS_PER_SECOND = 144;

function fastSpeed(): boolean {
  return ticksPerSecond > CALM_ABOVE_TICKS_PER_SECOND;
}

function showNight(): boolean {
  return dayNightToggle.checked && !fastSpeed();
}

function showWeather(): boolean {
  return weatherToggle.checked && !fastSpeed();
}

/** Remember the switches on this device; the page works the same if storage is unavailable. */
function loadPreferences(): void {
  try {
    const saved = JSON.parse(localStorage.getItem('abss.display') ?? '{}');
    if (typeof saved.dayNight === 'boolean') dayNightToggle.checked = saved.dayNight;
    if (typeof saved.weather === 'boolean') weatherToggle.checked = saved.weather;
  } catch {
    // ignore
  }
}

function savePreferences(): void {
  try {
    localStorage.setItem('abss.display', JSON.stringify({ dayNight: dayNightToggle.checked, weather: weatherToggle.checked }));
  } catch {
    // ignore
  }
}

function updateCalmNote(): void {
  calmNote.hidden = !(fastSpeed() && (dayNightToggle.checked || weatherToggle.checked));
}
const FLASH_MS = 700;
/** Recent lightning strikes, for drawing flashes that fade. */
const flashes: Array<{ cell: number; born: number }> = [];

// ---------------------------------------------------------------- world

function readHash(): { seed: number; circumscription: number; variability: number; tick: number } {
  const params = new URLSearchParams(location.hash.slice(1));
  const seed = Number(params.get('seed'));
  const c = Number(params.get('c'));
  const v = Number(params.get('v'));
  const t = Number(params.get('t'));
  return {
    seed: Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff && params.has('seed') ? seed : 7,
    circumscription: params.has('c') && Number.isFinite(c) && c >= 0 && c <= 1 ? c : 0.75,
    variability: params.has('v') && Number.isFinite(v) && v >= 0 && v <= 3 ? v : 1,
    // A moment to open at, in ticks from the start (noon on day one unless given).
    tick: params.has('t') && Number.isInteger(t) && t >= 0 && t <= 10_000_000 ? t : -1,
  };
}

function configFor(seed: number, circumscription: number, variability: number): SimConfig {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.circumscription = circumscription;
  raw.climate.variability = variability;
  return validateConfig(raw);
}

function buildWorld(): void {
  const seed = Number(seedInput.value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    seedInput.setCustomValidity('Use a whole number from 0 to 4294967295.');
    seedInput.reportValidity();
    return;
  }
  seedInput.setCustomValidity('');
  const circumscription = Number(circInput.value);
  const variability = Number(varInput.value);
  busy.hidden = false;
  buildButton.disabled = true;
  // Let the "building" notice paint before the work starts.
  setTimeout(() => {
    const started = performance.now();
    sim = createStandardSim(configFor(seed, circumscription, variability));
    // Every run starts at midnight. Open the page at noon on the first day instead (or at the
    // moment named in the address), so the first thing seen is the land in daylight. This only
    // advances the run, exactly as playing would.
    stepSim(sim, openAt >= 0 ? openAt : sim.config.time.ticksPerDay / 2);
    openAt = -1;
    view = viewOf(sim);
    land = readLandscape(view);
    offscreen.width = land.W;
    offscreen.height = land.H;
    canvas.width = land.W;
    canvas.height = land.H;
    drawnMode = null;
    drawnTick = -1;
    inspected = -1;
    paintedDay = -1;
    flashes.length = 0;
    inspectPanel.innerHTML = '<p class="hint">Tap the map to see what is there.</p>';
    try {
      // Lets a world be shared by its address. Some hosts don't allow it; the page works without it.
      history.replaceState(null, '', `#seed=${seed}&c=${circumscription}&v=${variability}`);
    } catch {
      // ignore
    }
    showStats(performance.now() - started);
    busy.hidden = true;
    buildButton.disabled = false;
    draw(performance.now());
  }, 30);
}

function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function showStats(milliseconds: number): void {
  if (!view) return;
  const s = summarizeLandscape(view);
  statsPanel.innerHTML =
    `<b>${percent(s.habitableFraction)}</b> of the map is land a forager could live on, ` +
    `<b>${percent(s.largestRegionShare)}</b> of it in one connected stretch. ` +
    `Rivers ${percent(s.riverFraction + s.springFraction)}, lakes ${percent(s.lakeFraction)} of the map. ` +
    `Built in ${Math.round(milliseconds)} ms.`;
}

// ---------------------------------------------------------------- drawing

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const MOONS = [
  'new moon',
  'waxing crescent',
  'first quarter moon',
  'waxing gibbous moon',
  'full moon',
  'waning gibbous moon',
  'last quarter moon',
  'waning crescent',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function updateClock(): void {
  if (!sim) return;
  const { config } = sim;
  const tick = sim.state.tick;
  const minutes = Math.floor(clock.dayFraction(config, tick) * 1440);
  const season = SEASONS[Math.floor((light.seasonFraction(config, tick) + 0.125) * 4) % 4];
  dateLine.textContent =
    `Year ${clock.yearIndex(config, tick) + 1}, day ${clock.dayOfYear(config, tick) + 1} (${season}), ` +
    `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  const ambient = light.ambientLight(config, tick);
  const sun = light.sunlight(config, tick);
  const moon = MOONS[Math.floor((light.moonPhase(config, tick) + 1 / 16) * 8) % 8];
  const sky = sun >= 0.5 ? 'Daylight' : sun > 0.08 ? 'Low sun' : sun > 0 ? 'Twilight' : 'Night';
  skyLine.textContent = `${sky}, ${moon} · light ${ambient < 0.01 ? (ambient * 100).toFixed(1) : Math.round(ambient * 100)}%`;

  const w = view?.readings(climate.CLIMATE_PARTS.weather);
  if (!w) return;
  const temperature = climate.airTemperatureC(config, tick, w, 400);
  const rain = w[F.rainTodayMm];
  const today = climate.stormActive(w, tick)
    ? 'thunderstorm'
    : w[F.stormStart] > tick
      ? 'storm brewing'
      : w[F.wetToday] === 1
        ? rain < 2
          ? `drizzle (${rain.toFixed(1)} mm today)`
          : rain < 10
            ? `rain (${rain.toFixed(0)} mm today)`
            : `heavy rain (${rain.toFixed(0)} mm today)`
        : 'dry';
  const spell = w[F.wetness] < -0.4 ? ' · in a dry spell' : w[F.wetness] > 0.4 ? ' · in a wet spell' : '';
  weatherLine.textContent = `${Math.round(temperature)} °C at 400 m, ${today}${spell} · ${w[F.strikesTotal]} lightning strikes so far`;
}

function draw(now: number): void {
  if (!sim || !land) return;
  const day = clock.dayIndex(sim.config, sim.state.tick);
  const daily = mode === 'moisture' || mode === 'plants' || mode === 'ripe';
  if (drawnMode !== mode || (daily && day !== paintedDay)) {
    paintedDay = day;
    const image = offscreenContext.createImageData(land.W, land.H);
    paint(land, mode, image.data);
    offscreenContext.putImageData(image, 0, 0);
    legend.innerHTML = legendFor(mode, land);
    drawnMode = mode;
    drawnTick = -1;
  }
  const tick = sim.state.tick;
  while (flashes.length > 0 && now - flashes[0].born > FLASH_MS) flashes.shift();
  if (tick === drawnTick && flashes.length === 0) return;
  drawnTick = tick;
  context.drawImage(offscreen, 0, 0);
  const w = showWeather() ? view?.readings(climate.CLIMATE_PARTS.weather) : null;
  if (w && w[F.wetToday] === 1) {
    // A grey veil on wet days, heavier the more rain is falling.
    const veil = 0.08 + 0.17 * Math.min(1, w[F.rainTodayMm] / 12);
    context.fillStyle = `rgba(96, 112, 140, ${veil.toFixed(3)})`;
    context.fillRect(0, 0, land.W, land.H);
  }
  if (w && climate.stormActive(w, tick)) {
    const x = w[F.stormX] / land.cellSizeM;
    const y = w[F.stormY] / land.cellSizeM;
    const r = w[F.stormRadiusM] / land.cellSizeM;
    const cloud = context.createRadialGradient(x, y, 0, x, y, r);
    cloud.addColorStop(0, 'rgba(18, 20, 34, 0.55)');
    cloud.addColorStop(0.75, 'rgba(18, 20, 34, 0.4)');
    cloud.addColorStop(1, 'rgba(18, 20, 34, 0)');
    context.fillStyle = cloud;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }
  // Night falls over the map: darker the less light there is.
  const ambient = light.ambientLight(sim.config, tick);
  const darkness = showNight() ? 0.62 * (1 - Math.min(1, Math.sqrt(ambient))) : 0;
  if (darkness > 0.005) {
    context.fillStyle = `rgba(8, 12, 32, ${darkness.toFixed(3)})`;
    context.fillRect(0, 0, land.W, land.H);
  }
  for (const flash of flashes) {
    const age = (now - flash.born) / FLASH_MS;
    const i = (flash.cell % land.W) + 0.5;
    const j = Math.floor(flash.cell / land.W) + 0.5;
    context.fillStyle = `rgba(255, 252, 214, ${(1 - age).toFixed(3)})`;
    context.beginPath();
    context.arc(i, j, 3.5 - 1.5 * age, 0, Math.PI * 2);
    context.fill();
  }
  if (inspected >= 0) {
    const i = inspected % land.W;
    const j = Math.floor(inspected / land.W);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.strokeRect(i - 5, j - 5, 11, 11);
  }
  updateClock();
}

function frame(now: number): void {
  if (playing && sim && view) {
    const elapsed = lastFrame === 0 ? 0 : Math.min(0.25, (now - lastFrame) / 1000);
    carry += elapsed * ticksPerSecond;
    const ticks = Math.floor(carry);
    carry -= ticks;
    // Step one tick at a time so no lightning strike goes unseen: strikes are kept only for the tick they happen in.
    const collect = showWeather();
    if (!collect) stepSim(sim, ticks);
    for (let t = 0; collect && t < ticks; t++) {
      stepSim(sim, 1);
      const strikes = view.readings(climate.CLIMATE_PARTS.strikes);
      if (!strikes) continue;
      for (let n = 0; n < strikes.length && flashes.length < 600; n++) flashes.push({ cell: strikes[n], born: now });
    }
  }
  lastFrame = now;
  draw(now);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- inspecting a cell

function inspect(event: MouseEvent): void {
  if (!land) return;
  const rect = canvas.getBoundingClientRect();
  const i = Math.floor(((event.clientX - rect.left) / rect.width) * land.W);
  const j = Math.floor(((event.clientY - rect.top) / rect.height) * land.H);
  if (i < 0 || j < 0 || i >= land.W || j >= land.H) return;
  const k = j * land.W + i;
  inspected = k;
  drawnTick = -1;
  let steepest = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const ni = i + di;
      const nj = j + dj;
      if ((di === 0 && dj === 0) || ni < 0 || nj < 0 || ni >= land.W || nj >= land.H) continue;
      const run = di !== 0 && dj !== 0 ? land.cellSizeM * Math.SQRT2 : land.cellSizeM;
      steepest = Math.max(steepest, Math.abs(land.elevation[nj * land.W + ni] - land.elevation[k]) / run);
    }
  }
  const kind = land.kind[k];
  const rows: Array<[string, string]> = [
    ['Where', `${((i + 0.5) * land.cellSizeM / 1000).toFixed(1)} km east, ${((j + 0.5) * land.cellSizeM / 1000).toFixed(1)} km south`],
    ['Height', `${Math.round(land.elevation[k])} m`],
    ['Steepness', `${(steepest * 100).toFixed(0)}% slope (${(Math.atan(steepest) * 180 / Math.PI).toFixed(0)}°)`],
    ['Mean rainfall', `${land.rainfall[k].toFixed(2)} × temperate`],
    ['Ground', SOIL_NAMES[land.soil[k]] ?? '?'],
    ['Water', WATER_NAMES[kind] + (kind === 3 ? `, ${land.depth[k].toFixed(1)} m deep` : '')],
    ['Drains', `${land.flow[k].toFixed(land.flow[k] < 10 ? 2 : 0)} km² of runoff through here`],
    ['Soil moisture', `${Math.round(land.moisture[k] * 100)}% of what it can hold`],
  ];
  const growing: string[] = [];
  const food: string[] = [];
  plants.PLANT_SPECIES.forEach((s, n) => {
    const share = land!.plantCover[n][k];
    if (share >= 0.005) growing.push(`${PLANT_NAMES[s.name] ?? s.name} ${Math.round(share * 100)}%`);
    const kg = land!.plantFood[n][k];
    if (kg >= 0.5) food.push(`${kg < 10 ? kg.toFixed(1) : Math.round(kg)} kg ${PLANT_NAMES[s.name] ?? s.name}${s.visible ? '' : ' (underground)'}`);
  });
  if (kind === 0) {
    rows.push(['Plants', growing.length > 0 ? growing.join(', ') : 'bare']);
    rows.push(['Food here', food.length > 0 ? food.join(', ') : 'none']);
  }
  const w = view?.readings(climate.CLIMATE_PARTS.weather);
  if (sim && w) rows.push(['Air now', `${climate.airTemperatureC(sim.config, sim.state.tick, w, land.elevation[k]).toFixed(1)} °C`]);
  inspectPanel.innerHTML = `<dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`;
}

// ---------------------------------------------------------------- controls

playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.textContent = playing ? '⏸ Pause' : '▶ Play';
  carry = 0;
});
speedSelect.addEventListener('change', () => {
  ticksPerSecond = Number(speedSelect.value);
  if (fastSpeed()) flashes.length = 0;
  updateCalmNote();
  drawnTick = -1;
});
for (const toggle of [dayNightToggle, weatherToggle]) {
  toggle.addEventListener('change', () => {
    if (!weatherToggle.checked) flashes.length = 0;
    savePreferences();
    updateCalmNote();
    drawnTick = -1;
  });
}
for (const button of layerButtons) {
  button.addEventListener('click', () => {
    mode = button.dataset.layer as LayerMode;
    for (const other of layerButtons) other.classList.toggle('on', other === button);
    draw(performance.now());
  });
}
circInput.addEventListener('input', () => {
  circOut.textContent = Number(circInput.value).toFixed(2);
});
varInput.addEventListener('input', () => {
  varOut.textContent = Number(varInput.value).toFixed(2);
});
randomButton.addEventListener('click', () => {
  seedInput.value = String(Math.floor(Math.random() * 4294967296));
  buildWorld();
});
buildButton.addEventListener('click', buildWorld);
canvas.addEventListener('click', inspect);

// ---------------------------------------------------------------- start

const initial = readHash();
seedInput.value = String(initial.seed);
circInput.value = String(initial.circumscription);
circOut.textContent = initial.circumscription.toFixed(2);
openAt = initial.tick;
loadPreferences();
updateCalmNote();
varInput.value = String(initial.variability);
varOut.textContent = initial.variability.toFixed(2);
element<HTMLSpanElement>('build-info').textContent =
  BUILD.commit === 'development' ? 'development build' : `built from ${BUILD.commit.slice(0, 7)}${BUILD.builtAt ? ` on ${BUILD.builtAt}` : ''}`;
buildWorld();
requestAnimationFrame(frame);

// The arithmetic self-check (docs/DESIGN.md §1.8): does this browser compute exactly what Node does?
setTimeout(() => {
  const started = performance.now();
  const problems = arithmeticProblems();
  const ms = Math.round(performance.now() - started);
  if (problems.length === 0) {
    selfcheckLine.textContent = `✓ This browser's arithmetic matches the recorded results exactly (checked in ${ms} ms), so a run seen here can be replayed anywhere.`;
    selfcheckLine.className = 'selfcheck ok';
  } else {
    selfcheckLine.textContent = `✗ This browser's arithmetic differs from the recorded results (${problems.length} of 8 checks). Runs seen here may not match other machines. Please report this.`;
    selfcheckLine.className = 'selfcheck bad';
  }
}, 600);
