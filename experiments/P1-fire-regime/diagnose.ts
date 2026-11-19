// Fire diagnosis for milestone 1.11 (docs/DESIGN.md §2.16, end): runs the world without agents and
// logs every fire, so the open-country fire regime can be understood before anything changes.
//   node experiments/P1-fire-regime/diagnose.ts --seeds 1,2,3,4 --cells 256 --years 60 --circ 0
// Prints one line per fire that flamed, then a per-year table and a summary. Reads the sim only;
// writes nothing to it, so the run is the same run the harness would make.

import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { dayIndex, dayFraction } from '../../src/sim/core/clock.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import { CLIMATE_FIELDS, CLIMATE_PARTS, MOISTURE_LAYER } from '../../src/sim/world/climate.ts';
import { FIRE_FIELDS, FIRE_LAYERS, FIRE_PARTS, FIRE_STORE, FireStage } from '../../src/sim/world/fire.ts';
import { seasonFraction } from '../../src/sim/world/light.ts';
import { MATERIAL_LAYERS } from '../../src/sim/world/materials.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const seeds = arg('seeds', '1,2,3,4').split(',').map(Number);
const cells = Number(arg('cells', '256'));
const years = Number(arg('years', '60'));
const circ = Number(arg('circ', '0'));
const quiet = process.argv.includes('--quiet');

interface FireEvent {
  startTick: number;
  firstFlameTick: number;
  endTick: number;
  ignitedAtStart: number;
  flaresAtStart: number;
  ignitedDay: number;
  ignitedNight: number;
  flares: number;
  maxFlaming: number;
  nights: number;
  wetDays: number;
  storms: number;
  soilAtFlame: number;
  wetnessAtFlame: number;
}

const summary: string[] = [];
for (const seed of seeds) {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = circ;
  const config = validateConfig(raw);
  const sim = createSim(config, SIM_PIPELINE);
  const { state } = sim;
  const world = state.world;
  const water = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const stage = world.layer<Uint8Array>(FIRE_LAYERS.stage);
  const lastBurn = world.layer<Float32Array>(FIRE_LAYERS.lastBurnDay);
  const moisture = world.layer<Float32Array>(MOISTURE_LAYER);
  const litter = world.layer<Float32Array>(MATERIAL_LAYERS.litter);
  const counts = state.parts.find((p) => p.name === FIRE_PARTS.counts)!.readings!();
  const weather = state.parts.find((p) => p.name === CLIMATE_PARTS.weather)!.readings!();
  const fires = state.store(FIRE_STORE);
  let land = 0;
  for (let k = 0; k < water.length; k++) if (water[k] === Water.DRY) land++;
  const perDay = config.time.ticksPerDay;
  const perYear = perDay * config.time.daysPerYear;
  const events: FireEvent[] = [];
  let ev: FireEvent | null = null;
  let flamingBefore = 0;
  const yearIgnited: number[] = [];
  // Cells ignited in each eighth of the year (0 = spring equinox, 0.25 midsummer, 0.5 autumn, 0.75 midwinter).
  const bySeason = new Float64Array(8);
  let ignitedBefore = 0;
  const yearDistinct: number[] = [];
  const yearLitter: number[] = [];
  let ignitedYearStart = 0;
  let lastDay = -1;
  let holdoversOnly = 0;
  const totalTicks = years * perYear;
  for (let t = 0; t < totalTicks; t++) {
    stepSim(sim, 1);
    const tick = state.tick;
    const ignited = counts[FIRE_FIELDS.cellsIgnited];
    if (ignited > ignitedBefore) {
      bySeason[Math.min(7, Math.floor(seasonFraction(config, tick) * 8))] += ignited - ignitedBefore;
      ignitedBefore = ignited;
    }
    if (fires.count > 0 && !ev) {
      ev = {
        startTick: tick, firstFlameTick: -1, endTick: -1, ignitedAtStart: ignited, flaresAtStart: counts[FIRE_FIELDS.flareUps],
        ignitedDay: 0, ignitedNight: 0, flares: 0, maxFlaming: 0, nights: 0, wetDays: 0, storms: 0, soilAtFlame: 0, wetnessAtFlame: 0,
      };
      flamingBefore = 0;
      lastDay = -1;
    }
    if (ev) {
      let flaming = 0;
      for (let k = 0; k < stage.length; k++) if (stage[k] === FireStage.FLAMING) flaming++;
      const newIgnitions = ignited - (ev.ignitedAtStart + ev.ignitedDay + ev.ignitedNight);
      if (newIgnitions > 0) {
        const h = dayFraction(config, tick) * 24;
        if (h >= 7 && h < 19) ev.ignitedDay += newIgnitions;
        else ev.ignitedNight += newIgnitions;
        if (ev.firstFlameTick < 0) {
          ev.firstFlameTick = tick;
          let sm = 0;
          for (let k = 0; k < water.length; k++) if (water[k] === Water.DRY) sm += moisture[k];
          ev.soilAtFlame = sm / land;
          ev.wetnessAtFlame = weather[CLIMATE_FIELDS.wetness];
        }
      }
      if (flaming > ev.maxFlaming) ev.maxFlaming = flaming;
      if (flamingBefore > 0 && flaming === 0 && fires.count > 0) ev.nights++;
      flamingBefore = flaming;
      const day = dayIndex(config, tick);
      if (day !== lastDay) {
        lastDay = day;
        if (weather[CLIMATE_FIELDS.wetToday] === 1) ev.wetDays++;
        if (weather[CLIMATE_FIELDS.stormStart] >= 0) ev.storms++;
      }
      if (fires.count === 0) {
        ev.endTick = tick;
        ev.flares = counts[FIRE_FIELDS.flareUps] - ev.flaresAtStart;
        if (ev.firstFlameTick >= 0) events.push(ev);
        else holdoversOnly++;
        ev = null;
      }
    }
    if ((tick % perYear) === 0) {
      const y = tick / perYear;
      const since = dayIndex(config, tick) + 1 - config.time.daysPerYear;
      let distinct = 0;
      let lit = 0;
      for (let k = 0; k < water.length; k++) {
        if (water[k] !== Water.DRY) continue;
        lit += litter[k];
        if (lastBurn[k] > since) distinct++;
      }
      yearIgnited[y] = (ignited - ignitedYearStart) / land;
      yearDistinct[y] = distinct / land;
      yearLitter[y] = lit / 1000 / land / ((config.world.cellSizeM * config.world.cellSizeM) / 10_000);
      ignitedYearStart = ignited;
    }
  }
  const dpy = config.time.daysPerYear;
  if (!quiet) {
    console.log(`\n# seed ${seed} (${cells} cells, circumscription ${circ}, ${years} years, land ${land})`);
    console.log('year.day | season | soil | wetness | days | nights | wet days | storms | ignited (day/night) | flares | distinct-ish | max flaming');
  }
  for (const e of events) {
    const d0 = dayIndex(config, e.firstFlameTick);
    const total = e.ignitedDay + e.ignitedNight;
    if (!quiet) {
      console.log(
        `${Math.floor(d0 / dpy)}.${d0 % dpy} | ${seasonFraction(config, e.firstFlameTick).toFixed(2)} | ${e.soilAtFlame.toFixed(2)} | ${e.wetnessAtFlame.toFixed(2)} | ${((e.endTick - e.firstFlameTick) / perDay).toFixed(1)} | ${e.nights} | ${e.wetDays} | ${e.storms} | ${total} (${e.ignitedDay}/${e.ignitedNight}) | ${e.flares} | ${((100 * total) / land).toFixed(2)}% | ${e.maxFlaming}`,
      );
    }
  }
  const n = yearIgnited.length - 1;
  let sumI = 0;
  let sumD = 0;
  let worstI = 0;
  let worstD = 0;
  const big: string[] = [];
  for (let y = 1; y <= n; y++) {
    sumI += yearIgnited[y];
    sumD += yearDistinct[y];
    if (yearIgnited[y] > worstI) worstI = yearIgnited[y];
    if (yearDistinct[y] > worstD) worstD = yearDistinct[y];
    if (yearIgnited[y] > 0.01) big.push(`y${y}: ${(100 * yearIgnited[y]).toFixed(1)}% (${(100 * yearDistinct[y]).toFixed(1)}% distinct, litter ${(yearLitter[y - 1] ?? NaN).toFixed(2)} t/ha)`);
  }
  const sizes = events.map((e) => e.ignitedDay + e.ignitedNight).sort((a, b) => b - a);
  const small = sizes.filter((s) => s < 100).length;
  const seasonTotal = bySeason.reduce((a, b) => a + b, 0) || 1;
  const seasons = Array.from(bySeason, (v) => `${Math.round((100 * v) / seasonTotal)}`).join('/');
  const line = `seed ${seed} circ ${circ}: ignitions by eighth of the year ${seasons}%; mean ${(100 * sumI / n).toFixed(3)}%/yr ignited, ${(100 * sumD / n).toFixed(3)}% distinct; worst year ${(100 * worstI).toFixed(1)}% (${(100 * worstD).toFixed(1)}% distinct); fires that flamed ${events.length} (under 1 km²: ${small}), holdovers that never flamed ${holdoversOnly}; largest ${sizes.slice(0, 3).join(', ')} cells`;
  summary.push(line);
  if (!quiet) {
    console.log(`years over 1%: ${big.join('; ') || 'none'}`);
    console.log(line);
  }
}
console.log('\n## Summary');
for (const l of summary) console.log(l);
