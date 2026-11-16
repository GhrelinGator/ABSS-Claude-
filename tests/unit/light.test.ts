import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig } from '../../src/sim/config.ts';
import { ticksPerYear } from '../../src/sim/core/clock.ts';
import {
  LIGHT,
  ambientLight,
  daylightFraction,
  moonIllumination,
  moonPhase,
  moonlight,
  sunlight,
} from '../../src/sim/world/light.ts';

const config = defaultConfig(1);
const TPD = config.time.ticksPerDay;
const YEAR = ticksPerYear(config);
const at = (day: number, hour: number): number => day * TPD + Math.round((hour / 24) * TPD);

test('day length swings with the seasons, longest at midsummer', () => {
  const spring = daylightFraction(config, 0);
  const summer = daylightFraction(config, YEAR / 4);
  const winter = daylightFraction(config, (3 * YEAR) / 4);
  assert.ok(Math.abs(spring - 0.5) < 1e-12);
  assert.ok(Math.abs(summer - 0.6) < 1e-12);
  assert.ok(Math.abs(winter - 0.4) < 1e-12);
});

test('the sun is full at noon, gone at midnight, and changes smoothly in between', () => {
  for (const day of [0, 12, 24, 36]) {
    assert.ok(Math.abs(sunlight(config, at(day, 12)) - 1) < 1e-12);
    assert.equal(sunlight(config, at(day, 0)), 0);
    let previous = sunlight(config, day * TPD);
    for (let t = 1; t <= TPD / 2; t++) {
      const now = sunlight(config, day * TPD + t);
      assert.ok(now >= previous, 'light should only rise between midnight and noon');
      assert.ok(now - previous < 0.06, `light jumps by ${now - previous} in one tick`);
      previous = now;
    }
  }
});

test('summer days have more hours of light than winter days', () => {
  const lightHours = (day: number): number => {
    let ticks = 0;
    for (let t = 0; t < TPD; t++) if (sunlight(config, day * TPD + t) > LIGHT.twilightLevel) ticks++;
    return (ticks / TPD) * 24;
  };
  const summer = lightHours(12);
  const winter = lightHours(36);
  assert.ok(summer > 13.5 && summer < 15, `summer: ${summer} h`);
  assert.ok(winter > 9 && winter < 10.5, `winter: ${winter} h`);
});

test('the moon runs through its phases on a real 29.5-day cycle', () => {
  assert.equal(moonPhase(config, 0), 0);
  const fullDay = LIGHT.lunarMonthDays / 2;
  assert.ok(Math.abs(moonPhase(config, Math.round(fullDay * TPD)) - 0.5) < 0.001);
  const afterOneCycle = moonPhase(config, Math.round(LIGHT.lunarMonthDays * TPD));
  assert.ok(Math.min(afterOneCycle, 1 - afterOneCycle) < 0.001, `phase after one cycle: ${afterOneCycle}`);
  assert.equal(moonIllumination(0), 0);
  assert.equal(moonIllumination(0.5), 1);
  assert.ok(Math.abs(moonIllumination(0.25) - 0.5) < 1e-12);
});

test('a full moon lights the night and a new moon does not', () => {
  const fullMidnight = Math.round((LIGHT.lunarMonthDays / 2) * TPD);
  const midnightAfter = (TPD - (fullMidnight % TPD)) % TPD;
  const fullNight = fullMidnight + midnightAfter;
  const moonNear = moonlight(config, fullNight);
  assert.ok(moonNear > 0.05, `full moon at midnight gives ${moonNear}`);
  assert.equal(sunlight(config, fullNight), 0);
  assert.ok(Math.abs(ambientLight(config, fullNight) - moonNear) < 1e-12);
  const newMoonMidnight = at(0, 0);
  assert.equal(moonlight(config, newMoonMidnight), 0);
  assert.equal(ambientLight(config, newMoonMidnight), LIGHT.starlight);
});

test('a first-quarter moon is up in the evening and down before dawn', () => {
  const quarterDay = Math.round(LIGHT.lunarMonthDays / 4);
  assert.ok(moonlight(config, at(quarterDay, 21)) > 0);
  assert.equal(moonlight(config, at(quarterDay, 4)), 0);
});

test('ambient light stays within [starlight, 1] all year', () => {
  for (let t = 0; t < YEAR * 2; t += 7) {
    const a = ambientLight(config, t);
    assert.ok(a >= LIGHT.starlight && a <= 1, `tick ${t}: ${a}`);
  }
});
