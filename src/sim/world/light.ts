// Sunlight, moonlight, and starlight as pure functions of the tick and the
// config (docs/DESIGN.md §2.4). Nothing here is stored, so nothing here
// needs a system. Fire light is added per cell in Phase 1.8.

import type { SimConfig } from '../config.ts';
import { dayFraction, dayIndex, ticksPerYear } from '../core/clock.ts';
import { cosTurn, sinTurn } from '../core/dmath.ts';

export const LIGHT = {
  /** Mean day length as a fraction of the day, and its seasonal swing either way (about 9.6 to 14.4 hours). */
  meanDaylight: 0.5,
  daylightSwing: 0.1,
  /** Twilight lasts this fraction of a day after sunset and before sunrise (45 minutes). */
  twilight: 0.03125,
  /** Light at the moment of sunrise or sunset, as a share of full noon sun. */
  twilightLevel: 0.08,
  /** Real days from one new moon to the next. Days are not compressed (§1.1), so the moon keeps its real rhythm. */
  lunarMonthDays: 29.530588,
  /** Light from a full moon overhead, as a share of full noon sun. Exaggerated on purpose (§2.4). */
  fullMoon: 0.06,
  starlight: 0.002,
} as const;

/** Position in the year as a fraction: 0 spring equinox, 0.25 midsummer, 0.5 autumn equinox, 0.75 midwinter. */
export function seasonFraction(config: SimConfig, tick: number): number {
  const perYear = ticksPerYear(config);
  return (tick % perYear) / perYear;
}

/** Fraction of the day the sun is above the horizon. */
export function daylightFraction(config: SimConfig, tick: number): number {
  return LIGHT.meanDaylight + LIGHT.daylightSwing * sinTurn(seasonFraction(config, tick));
}

/** Sunlight as a share of full noon sun: 1 at noon on any day, falling to 0 by the end of twilight. */
export function sunlight(config: SimConfig, tick: number): number {
  const fromNoon = dayFraction(config, tick) - 0.5;
  const away = fromNoon < 0 ? -fromNoon : fromNoon;
  const half = daylightFraction(config, tick) / 2;
  if (away <= half) {
    const horizon = cosTurn(half);
    const height = (cosTurn(away) - horizon) / (1 - horizon);
    return LIGHT.twilightLevel + (1 - LIGHT.twilightLevel) * height;
  }
  const dusk = (away - half) / LIGHT.twilight;
  return dusk >= 1 ? 0 : LIGHT.twilightLevel * (1 - dusk);
}

/** Phase of the moon as a fraction of its cycle: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhase(config: SimConfig, tick: number): number {
  const days = (dayIndex(config, tick) + dayFraction(config, tick)) / LIGHT.lunarMonthDays;
  return days - Math.floor(days);
}

/** Share of the moon's disc that is lit: 0 at new moon, 1 at full moon. */
export function moonIllumination(phase: number): number {
  return (1 - cosTurn(phase)) / 2;
}

/**
 * Moonlight as a share of full noon sun. The moon crosses the sky later each
 * day by its phase: a full moon is highest at midnight, a new moon at noon.
 */
export function moonlight(config: SimConfig, tick: number): number {
  const phase = moonPhase(config, tick);
  const height = cosTurn(dayFraction(config, tick) - 0.5 - phase);
  if (height <= 0) return 0;
  return LIGHT.fullMoon * moonIllumination(phase) * height;
}

/** The brightest of sun, moon, and stars, as a share of full noon sun. */
export function ambientLight(config: SimConfig, tick: number): number {
  const sun = sunlight(config, tick);
  const moon = moonlight(config, tick);
  const brightest = sun > moon ? sun : moon;
  return brightest > LIGHT.starlight ? brightest : LIGHT.starlight;
}
