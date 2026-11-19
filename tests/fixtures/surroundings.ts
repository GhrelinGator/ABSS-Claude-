// Scripted surroundings for bodies in tests (docs/DESIGN.md §3.9): stands in
// for body.exposure, so heat and water can be tested without a world. Nothing
// under src/ may import this file.

import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { BODY_COLUMNS, Sex } from '../../src/sim/body/metabolism.ts';
import { SURROUNDINGS } from '../../src/sim/body/heat.ts';
import type { Sim } from '../../src/sim/sim.ts';

/** What a body is in, as body.exposure would write it. Missing fields are 0 (radiant: the air). */
export interface Weather {
  airC: number;
  radiantC?: number;
  humidity?: number;
  windMs?: number;
  rainMmH?: number;
  sunWm2?: number;
  fireWm2?: number;
  hideClo?: number;
  contact?: number;
  /** 1 inside a flaming cell. */
  inFire?: number;
}

/** Shaded, sheltered, half-humid still air at `airC`: a room, or deep shade. */
export function still(airC: number): Weather {
  return { airC, radiantC: airC, humidity: 0.5, windMs: 0 };
}

/**
 * A system that writes the same scripted surroundings for every body each tick, from a function of
 * the tick and the slot. Put it where body.exposure would go: after anything that moves bodies,
 * before body.heat.
 */
export function fxSurroundings(weather: (tick: number, slot: number) => Weather): SystemDef {
  return defineSystem({
    name: 'fixture.surroundings',
    create: (sim: Sim) => () => {
      const agents = sim.state.agents;
      const sex = agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data;
      const col = (name: string) => agents.column<Float64Array>(name).data;
      const air = col(SURROUNDINGS.airC.name);
      const radiant = col(SURROUNDINGS.radiantC.name);
      const humidity = col(SURROUNDINGS.humidity.name);
      const wind = col(SURROUNDINGS.windMs.name);
      const rain = col(SURROUNDINGS.rainMmH.name);
      const sun = col(SURROUNDINGS.sunWm2.name);
      const fire = col(SURROUNDINGS.fireWm2.name);
      const hide = col(SURROUNDINGS.hideClo.name);
      const contact = col(SURROUNDINGS.contact.name);
      const inFire = col(SURROUNDINGS.inFire.name);
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (!agents.isAlive(slot) || sex[slot] === Sex.NONE) continue;
        const w = weather(sim.state.tick, slot);
        air[slot] = w.airC;
        radiant[slot] = w.radiantC ?? w.airC;
        humidity[slot] = w.humidity ?? 0;
        wind[slot] = w.windMs ?? 0;
        rain[slot] = w.rainMmH ?? 0;
        sun[slot] = w.sunWm2 ?? 0;
        fire[slot] = w.fireWm2 ?? 0;
        hide[slot] = w.hideClo ?? 0;
        contact[slot] = w.contact ?? 0;
        inFire[slot] = w.inFire ?? 0;
      }
    },
  });
}
