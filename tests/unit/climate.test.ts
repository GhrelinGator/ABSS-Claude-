// The climate (docs/DESIGN.md §2.11), checked against plausibility targets
// and against its own rules. Small maps keep it quick; weather does not
// depend on map size.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { viewOf } from '../../src/sim/readonly.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import {
  CLIMATE_CONSTANTS,
  CLIMATE_FIELDS as F,
  CLIMATE_PARTS,
  MOISTURE_LAYER,
  airTemperatureC,
  dailyMeanTemperatureC,
  stormActive,
} from '../../src/sim/world/climate.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

function makeSim(seed: number, variability: number, cells = 96, circumscription = 0.5): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.widthCells = cells;
  raw.world.heightCells = cells;
  raw.world.circumscription = circumscription;
  raw.climate.variability = variability;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

function weather(sim: Sim): ArrayLike<number> {
  return viewOf(sim).readings(CLIMATE_PARTS.weather) as ArrayLike<number>;
}

interface DayRecord {
  wet: boolean;
  rainMm: number;
  season: number;
  meanC: number;
  storm: { start: number; end: number; x: number; y: number; r: number } | null;
}

/** Step whole days and record each day's weather, as decided at midnight. */
function recordDays(sim: Sim, days: number): DayRecord[] {
  const tpd = sim.config.time.ticksPerDay;
  const dpy = sim.config.time.daysPerYear;
  const out: DayRecord[] = [];
  for (let d = 0; d < days; d++) {
    const midnight = sim.state.tick;
    stepSim(sim, 1);
    const w = weather(sim);
    out.push({
      wet: w[F.wetToday] === 1,
      rainMm: w[F.rainTodayMm],
      season: (Math.floor(midnight / tpd) % dpy) / dpy,
      meanC: dailyMeanTemperatureC(sim.config, midnight, w, CLIMATE_CONSTANTS.referenceElevationM),
      storm:
        w[F.stormStart] >= 0
          ? { start: w[F.stormStart], end: w[F.stormEnd], x: w[F.stormX], y: w[F.stormY], r: w[F.stormRadiusM] }
          : null,
    });
    stepSim(sim, tpd - 1);
  }
  return out;
}

const YEARS = 30;

test('rain and temperature are in plausible temperate ranges', () => {
  const days: DayRecord[] = [];
  for (const seed of [1, 2, 3]) days.push(...recordDays(makeSim(seed, 1), YEARS * 48));
  const wetShare = days.filter((d) => d.wet).length / days.length;
  const meanRain = days.reduce((a, d) => a + d.rainMm, 0) / days.length;
  assert.ok(wetShare > 0.33 && wetShare < 0.45, `wet days ${wetShare}`);
  assert.ok(meanRain > 1.8 && meanRain < 3.2, `mean rain ${meanRain} mm per day`);
  assert.ok(days.every((d) => (d.wet ? d.rainMm > 0 : d.rainMm === 0)));
  const mean = (list: DayRecord[]): number => list.reduce((a, d) => a + d.meanC, 0) / list.length;
  const summer = mean(days.filter((d) => d.season > 0.15 && d.season < 0.35));
  const winter = mean(days.filter((d) => d.season > 0.65 && d.season < 0.85));
  assert.ok(summer - winter > 13 && summer - winter < 21, `summer ${summer} °C, winter ${winter} °C`);
  assert.ok(winter > 0 && summer < 30);
});

test('the day is warmest mid-afternoon, and high ground is colder', () => {
  const sim = makeSim(4, 1);
  stepSim(sim, 10);
  const w = weather(sim);
  const day = 144 * 3;
  const at = (hour: number, elevation = 400): number => airTemperatureC(sim.config, day + hour * 6, w, elevation);
  // The daily swing on its own: the moment's temperature minus that moment's daily mean.
  // (The compressed year moves the season about 0.6 °C in half a day, so raw values drift.)
  const swing = (hour: number): number => at(hour) - dailyMeanTemperatureC(sim.config, day + hour * 6, w, 400);
  assert.ok(Math.abs(swing(15) - CLIMATE_CONSTANTS.dailySwingC) < 1e-9);
  assert.ok(Math.abs(swing(3) + CLIMATE_CONSTANTS.dailySwingC) < 1e-9);
  for (let hour = 0; hour < 24; hour++) assert.ok(swing(hour) <= swing(15) + 1e-9);
  assert.ok(Math.abs(at(12, 400) - at(12, 1400) - 6.5) < 1e-9);
});

test('turning variability up widens the swings between seasons without changing average rain', () => {
  const seasonMeans = (variability: number): { mean: number; spread: number } => {
    const means: number[] = [];
    for (const seed of [5, 6, 7, 8]) {
      const days = recordDays(makeSim(seed, variability), YEARS * 48);
      for (let start = 0; start + 12 <= days.length; start += 12) {
        means.push(days.slice(start, start + 12).reduce((a, d) => a + d.rainMm, 0) / 12);
      }
    }
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    const spread = Math.sqrt(means.reduce((a, b) => a + (b - mean) * (b - mean), 0) / means.length);
    return { mean, spread };
  };
  const calm = seasonMeans(0);
  const normal = seasonMeans(1);
  const wild = seasonMeans(2);
  assert.ok(Math.abs(wild.mean / calm.mean - 1) < 0.2, `average rain moved from ${calm.mean} to ${wild.mean}`);
  assert.ok(Math.abs(normal.mean / calm.mean - 1) < 0.2, `average rain moved from ${calm.mean} to ${normal.mean}`);
  assert.ok(normal.spread > calm.spread, `spread ${calm.spread} → ${normal.spread}`);
  assert.ok(wild.spread > 1.5 * calm.spread, `spread ${calm.spread} → ${wild.spread}`);
});

test('storms come on warm wet days, in the afternoon, and last one to three hours', () => {
  let storms = 0;
  for (const seed of [9, 10]) {
    const sim = makeSim(seed, 1);
    const tpd = sim.config.time.ticksPerDay;
    for (const [d, day] of recordDays(sim, YEARS * 48).entries()) {
      if (!day.storm) continue;
      storms++;
      assert.ok(day.wet, 'a storm on a dry day');
      assert.ok(day.meanC > CLIMATE_CONSTANTS.stormMinTemperatureC, `a storm at a daily mean of ${day.meanC} °C`);
      const startHour = ((day.storm.start - d * tpd) / tpd) * 24;
      const hours = ((day.storm.end - day.storm.start) / tpd) * 24;
      assert.ok(startHour >= 12 && startHour < 20, `storm starts at ${startHour}`);
      assert.ok(hours >= 1 - 1e-9 && hours <= 3 + 1e-9, `storm lasts ${hours} hours`);
      assert.ok(day.storm.r >= 4000 && day.storm.r <= 12000);
    }
  }
  assert.ok(storms > 20, `only ${storms} storms in ${2 * YEARS} years`);
});

test('lightning strikes only during storms, and only inside the storm', () => {
  const sim = makeSim(11, 1, 256);
  const cs = sim.config.world.cellSizeM;
  const W = sim.config.world.widthCells;
  let struck = 0;
  for (let t = 0; t < 144 * 48 * 4; t++) {
    stepSim(sim, 1);
    const tick = sim.state.tick - 1;
    const w = weather(sim);
    const strikes = viewOf(sim).readings(CLIMATE_PARTS.strikes) as ArrayLike<number>;
    if (!stormActive(w, tick)) {
      assert.equal(strikes.length, 0, `strikes outside a storm at tick ${tick}`);
      continue;
    }
    for (let n = 0; n < strikes.length; n++) {
      const cell = strikes[n];
      assert.ok(cell >= 0 && cell < W * W);
      const x = ((cell % W) + 0.5) * cs;
      const y = (Math.floor(cell / W) + 0.5) * cs;
      const distance = Math.hypot(x - w[F.stormX], y - w[F.stormY]);
      assert.ok(distance <= w[F.stormRadiusM] + cs, `strike ${distance} m from the storm's centre`);
      struck++;
    }
  }
  assert.ok(struck > 0, 'no lightning in four years');
  assert.equal(weather(sim)[F.strikesTotal], struck);
});

test('soil moisture stays in bounds, water stays wet, and dry land is drier', () => {
  const sim = makeSim(12, 1, 160, 1);
  const kind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const rainfall = sim.state.world.layer<Float32Array>(TERRAIN_LAYERS.rainfall);
  const moisture = sim.state.world.layer<Float32Array>(MOISTURE_LAYER);
  let dry = 0;
  let dryCount = 0;
  let wet = 0;
  let wetCount = 0;
  for (let day = 0; day < 48 * 4; day++) {
    stepSim(sim, 144);
    for (let k = 0; k < moisture.length; k++) {
      assert.ok(moisture[k] >= 0 && moisture[k] <= 1, `moisture ${moisture[k]}`);
      if (kind[k] !== Water.DRY) {
        assert.equal(moisture[k], 1);
        continue;
      }
      if (rainfall[k] < 0.25) {
        dry += moisture[k];
        dryCount++;
      } else if (rainfall[k] > 0.9) {
        wet += moisture[k];
        wetCount++;
      }
    }
  }
  assert.ok(dryCount > 0 && wetCount > 0);
  assert.ok(dry / dryCount < 0.5 * (wet / wetCount), `desert ${dry / dryCount}, wet land ${wet / wetCount}`);
});

test('a snapshot taken mid-storm resumes exactly', () => {
  const sim = makeSim(13, 1, 128);
  let guard = 0;
  while (!stormActive(weather(sim), sim.state.tick) && guard++ < 144 * 48 * 10) stepSim(sim, 1);
  assert.ok(stormActive(weather(sim), sim.state.tick), 'no storm found');
  stepSim(sim, 1);
  const resumed = loadSim(saveSim(sim), SIM_PIPELINE);
  assert.equal(hashSim(resumed), hashSim(sim));
  stepSim(sim, 500);
  stepSim(resumed, 500);
  assert.equal(hashSim(resumed), hashSim(sim));
});

test('nothing agents do can change the weather', () => {
  const quiet = makeSim(14, 1);
  const busy = makeSim(14, 1);
  for (let i = 0; i < 200; i++) spawnAgent(busy, 100 + i * 20, 300);
  stepSim(quiet, 3000);
  stepSim(busy, 3000);
  assert.deepEqual(Array.from(weather(busy)), Array.from(weather(quiet)));
  assert.deepEqual(busy.state.world.layer(MOISTURE_LAYER), quiet.state.world.layer(MOISTURE_LAYER));
});

test('climate variability is validated', () => {
  const raw = JSON.parse(JSON.stringify(defaultConfig(1)));
  for (const bad of [-0.5, 6, Number.NaN, '1']) {
    raw.climate.variability = bad;
    assert.throws(() => validateConfig(raw), /climate.variability/);
  }
  raw.climate.variability = 0;
  assert.equal(validateConfig(raw).climate.variability, 0);
  delete raw.climate;
  assert.throws(() => validateConfig(raw), /missing key "config.climate"/);
});
