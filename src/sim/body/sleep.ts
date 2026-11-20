// Sleep pressure (docs/DESIGN.md §4.9.2): Borbély's process S rises while a body is awake and falls
// while it sleeps; with the circadian process C, locked to the local solar hour, it makes the body's
// sleepiness. A body sleeps when its act is sleep (effort SLEEP). Runs before body.metabolism, which
// clears the tick's effort.

import { dayFraction } from '../core/clock.ts';
import { cosTurn, exp } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { SimConfig } from '../config.ts';
import type { Sim, SimState } from '../sim.ts';
import { BODY_COLUMNS, Effort, Sex } from './metabolism.ts';

export const SLEEP = {
  /** Process S's time constants, hours: rising awake, falling asleep (Daan, Beersma & Borbély 1984, from memory). */
  riseHours: 18.2,
  fallHours: 4.2,
  /** Amplitude of the circadian process in S's units, and the hour of the day it is highest (from memory). */
  circadianAmplitude: 0.12,
  circadianPeakHour: 17,
  /** Sleep is over when sleepiness falls to this (the two-process model's lower threshold, from memory). */
  wakeAt: 0.17,
} as const;
const K = SLEEP;
const B = BODY_COLUMNS;

export const SLEEP_COLUMNS = {
  /** Process S, 0 to 1. */
  sleepPressure: { name: 'sleepPressure', dtype: 'f64', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const C = SLEEP_COLUMNS;

/** Sleepiness, from process S and the hour of the day (§4.9.2); not clamped. */
export function sleepiness(config: SimConfig, tick: number, pressure: number): number {
  return pressure - K.circadianAmplitude * cosTurn(dayFraction(config, tick) - K.circadianPeakHour / 24);
}

// ALIBI: every animal with a nervous system sleeps, more the longer it has been awake, and a clock
// tied to daylight lets an animal that sees by day rest in the dark, whether or not anyone else exists.
export const sleep: SystemDef = defineSystem({
  name: 'body.sleep',
  declare(state: SimState) {
    for (const spec of Object.values(C)) state.agents.ensureColumn(spec);
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    if (!agents.hasColumn(B.effort.name)) throw new Error('body.sleep needs body.metabolism in the pipeline.');
    const hours = 24 / config.time.ticksPerDay;
    const keepAwake = exp(-hours / K.riseHours);
    const keepAsleep = exp(-hours / K.fallHours);
    return () => {
      const alive = agents.alive.data;
      const sex = agents.column<Uint8Array>(B.sex.name).data;
      const effort = agents.column<Uint8Array>(B.effort.name).data;
      const pressure = agents.column<Float64Array>(C.sleepPressure.name).data;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
        const s = pressure[slot];
        pressure[slot] = effort[slot] === Effort.SLEEP ? s * keepAsleep : 1 - (1 - s) * keepAwake;
      }
    };
  },
});
