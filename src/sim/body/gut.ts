// The stomach and plant poisons (docs/DESIGN.md §4.9.2). The stomach holds the bulk of what was
// swallowed until it passes on; its energy is already in the body's gut (§3.8). A poison eaten waits
// for its delay, then acts: it hurts, makes the body vomit at one strength and kills at another, and is
// cleared over hours. Runs before body.metabolism, so food vomited this tick is never absorbed.

import { exp } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import type { ColumnSpec } from '../core/store.ts';
import type { Sim, SimState } from '../sim.ts';
import { BODY_COLUMNS, DeathCause, Sex, deathDoor, fatKgOf } from './metabolism.ts';

export const GUT = {
  /** Most food mass the stomach holds, kg, and how fast it passes on, kg an hour [estimates]. */
  stomachMostKg: 2,
  stomachPassKgPerHour: 0.3,
  /** A dose's strength is units × this ÷ body mass: one unit is one unit in a body of this many kg. */
  strengthAtKg: 50,
  /** Hours a dose can wait; longer delays wait this long. */
  ringHours: 32,
  /** Half-life of active poison, hours [estimate]. */
  clearHalfLifeHours: 6,
  /** Strengths at which the body vomits and dies [estimates]; strength ÷ painAt is its share of pain. */
  vomitAt: 2,
  lethalAt: 8,
  painAt: 4,
} as const;
const K = GUT;
const B = BODY_COLUMNS;

export const GUT_COLUMNS = {
  /** Food mass swallowed and not yet passed on, kg. */
  stomachKg: { name: 'stomachKg', dtype: 'f64', category: 'body' },
  /** Poison waiting for its delay: units due in each hour, a ring indexed by the hour of the run mod ringHours. */
  poisonDue: { name: 'poisonDue', dtype: 'f32', category: 'body', width: K.ringHours },
  /** Poison acting now, units. */
  poisonActive: { name: 'poisonActive', dtype: 'f64', category: 'body' },
} as const satisfies Record<string, ColumnSpec>;
const C = GUT_COLUMNS;

/** A poison's strength (§4.9.2) for `units` acting in a body of `massKg`. */
export function poisonStrength(units: number, massKg: number): number {
  return (units * K.strengthAtKg) / massKg;
}

function bodySlot(sim: Sim, slot: number, door: string): void {
  const agents = sim.state.agents;
  if (!agents.isAlive(slot)) throw new Error(`${door}: slot ${slot} holds no agent.`);
  if (!agents.hasColumn(C.stomachKg.name)) throw new Error(`${door}: the pipeline has no body.gut.`);
  if (agents.column<Uint8Array>(B.sex.name).data[slot] === Sex.NONE) {
    throw new Error(`${door}: agent id ${agents.id.data[slot]} has no body.`);
  }
}

/** Room left in the stomach, kg. */
export function stomachRoomKg(sim: Sim, slot: number): number {
  bodySlot(sim, slot, 'stomachRoomKg');
  const room = K.stomachMostKg - sim.state.agents.column<Float64Array>(C.stomachKg.name).data[slot];
  return room > 0 ? room : 0;
}

/** Food mass swallowed, kg: its energy goes in through `ingest`; this adds its bulk. */
export function swallow(sim: Sim, slot: number, kg: number): void {
  bodySlot(sim, slot, 'swallow');
  if (!(kg >= 0 && Number.isFinite(kg))) throw new RangeError(`swallow: ${kg} kg.`);
  sim.state.agents.column<Float64Array>(C.stomachKg.name).data[slot] += kg;
}

/** A poison eaten: `dose` units, felt `delayHours` from now (at least the next hour). */
export function poison(sim: Sim, slot: number, dose: number, delayHours: number): void {
  bodySlot(sim, slot, 'poison');
  if (!(dose >= 0 && Number.isFinite(dose))) throw new RangeError(`poison: dose ${dose}.`);
  if (!(delayHours >= 0 && Number.isFinite(delayHours))) throw new RangeError(`poison: delay ${delayHours} hours.`);
  if (dose === 0) return;
  const ticksPerHour = sim.config.time.ticksPerDay / 24;
  let wait = Math.round(delayHours);
  if (wait < 1) wait = 1;
  if (wait > K.ringHours - 1) wait = K.ringHours - 1;
  const hour = Math.floor(sim.state.tick / ticksPerHour) + wait;
  sim.state.agents.column<Float32Array>(C.poisonDue.name).data[slot * K.ringHours + (hour % K.ringHours)] += dose;
}

// ALIBI: a stomach holds only so much and passes it on over hours, and plants defend themselves with
// poisons that sicken whatever eats them, whether or not anyone else exists.
export const gut: SystemDef = defineSystem({
  name: 'body.gut',
  declare(state: SimState) {
    for (const spec of Object.values(C)) state.agents.ensureColumn(spec);
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    if (!agents.hasColumn(B.gut.name)) throw new Error('body.gut needs body.metabolism in the pipeline.');
    const dt = 86_400 / config.time.ticksPerDay;
    const ticksPerHour = config.time.ticksPerDay / 24;
    const passPerTick = (K.stomachPassKgPerHour * dt) / 3600;
    const keepActive = exp((-dt / (K.clearHalfLifeHours * 3600)) * Math.LN2);
    const dies = deathDoor(sim, 'body.gut');
    const R = K.ringHours;

    return () => {
      const alive = agents.alive.data;
      const sex = agents.column<Uint8Array>(B.sex.name).data;
      const lean = agents.column<Float64Array>(B.leanKg.name).data;
      const gutKcal = agents.column<Float64Array>(B.gut.name).data;
      const energy = agents.column<Float64Array>(B.energy.name).data;
      const energyOut = agents.column<Float64Array>(B.energyOut.name).data;
      const stomach = agents.column<Float64Array>(C.stomachKg.name).data;
      const due = agents.column<Float32Array>(C.poisonDue.name).data;
      const active = agents.column<Float64Array>(C.poisonActive.name).data;
      const index = Math.floor(state.tick / ticksPerHour) % R;

      for (let slot = 0; slot < agents.highWater; slot++) {
        if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
        // The stomach passes its bulk on.
        const s = stomach[slot];
        stomach[slot] = s > passPerTick ? s - passPerTick : 0;
        // Poison: what is due this hour begins to act; what acts is cleared.
        const k = slot * R + index;
        let a = active[slot] * keepActive;
        if (due[k] > 0) {
          a += due[k];
          due[k] = 0;
        }
        active[slot] = a;
        if (a <= 0) continue;
        const leanKg = lean[slot];
        const mass = leanKg + fatKgOf(energy[slot], gutKcal[slot], leanKg);
        const strength = poisonStrength(a, mass);
        if (strength >= K.lethalAt) {
          dies(slot, DeathCause.POISONING);
          continue;
        }
        if (strength >= K.vomitAt) {
          // Vomiting: what the stomach and gut hold is lost.
          const lost = gutKcal[slot];
          gutKcal[slot] = 0;
          energy[slot] -= lost;
          energyOut[slot] += lost;
          stomach[slot] = 0;
        }
      }
    };
  },
});
