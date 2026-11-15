// Calendar arithmetic. Design: docs/DESIGN.md §1.1.
//
// Days are real length (so day and night are real); years are compressed.
// Everything here is a pure function of the tick counter and the config.

import type { SimConfig } from '../config.ts';

/** Ticks in one simulated year. */
export function ticksPerYear(config: SimConfig): number {
  return config.time.ticksPerDay * config.time.daysPerYear;
}

/** Simulated minutes that one tick represents. */
export function minutesPerTick(config: SimConfig): number {
  return 1440 / config.time.ticksPerDay;
}

/** Whole days elapsed since the start of the run. */
export function dayIndex(config: SimConfig, tick: number): number {
  return Math.floor(tick / config.time.ticksPerDay);
}

/** Position inside the current day, in ticks: 0 at midnight. */
export function tickOfDay(config: SimConfig, tick: number): number {
  return tick % config.time.ticksPerDay;
}

/** Position inside the current day as a fraction in [0, 1): 0 at midnight, 0.5 at noon. */
export function dayFraction(config: SimConfig, tick: number): number {
  return tickOfDay(config, tick) / config.time.ticksPerDay;
}

/** Whole years elapsed since the start of the run. */
export function yearIndex(config: SimConfig, tick: number): number {
  return Math.floor(tick / ticksPerYear(config));
}

/** Day inside the current year: 0 on the first day. */
export function dayOfYear(config: SimConfig, tick: number): number {
  return dayIndex(config, tick) % config.time.daysPerYear;
}

/** Position inside the current year as a fraction in [0, 1). */
export function yearFraction(config: SimConfig, tick: number): number {
  const perYear = ticksPerYear(config);
  return (tick % perYear) / perYear;
}
