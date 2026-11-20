// Scripted mating, nursing and feeding for reproduction tests (docs/DESIGN.md
// §3.13). Stands in for the acts of Phases 3–4, which will decide all of this.
// Nothing under src/ may import this file.

import { ticksPerYear } from '../../src/sim/core/clock.ts';
import { defineSystem } from '../../src/sim/core/registry.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { HEAT_COLUMNS, drink, fullWaterKg } from '../../src/sim/body/heat.ts';
import { BODY_COLUMNS, METABOLISM, Sex, fatKgOf, ingest } from '../../src/sim/body/metabolism.ts';
import { REPRODUCTION, REPRODUCTION_COLUMNS, mate, nurse } from '../../src/sim/body/reproduction.ts';
import type { Sim } from '../../src/sim/sim.ts';

const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

export interface Rearing {
  /** Days between matings of each grown female with the first grown male (0: never). */
  mateEveryDays: number;
  /**
   * What a grown female eats every six hours: the heat she spent since (her own upkeep, pregnancy's
   * rise and milk making's overhead), plus a quarter of `extraPerDay`, plus, when `refeedYoung`, what
   * she gave a fetus or milk.
   */
  extraPerDay: number;
  refeedYoung: boolean;
  /** Share of a child's needs given as milk, by age: 1 to `solidsFrom`, then falling linearly to 0 at `weanAt`. */
  solidsFrom: number;
  weanAt: number;
  /** A child is fed toward this fat share of its mass. */
  childFat: number;
}

/** A forager-like schedule: nursed alone to 0.5 years, then more and more solid food, weaned at 2.5. */
export const FORAGER_REARING: Rearing = {
  mateEveryDays: 2,
  extraPerDay: 300,
  refeedYoung: false,
  solidsFrom: 0.5,
  weanAt: 2.5,
  childFat: 0.15,
};

/** Share of a child's needs it takes as milk at this age. */
export function milkShare(r: Rearing, ageYears: number): number {
  if (ageYears <= r.solidsFrom) return 1;
  if (ageYears >= r.weanAt) return 0;
  return 1 - (ageYears - r.solidsFrom) / (r.weanAt - r.solidsFrom);
}

/**
 * The script: matings at noon every `mateEveryDays` days; every hour each child under 15 with its
 * mother alive takes what it needs (what it spent since its last feed, plus half of what it is short of
 * `childFat`), milk for its share by age and solid food for the rest (a child without a mother gets all
 * of it as solid food); every six hours grown females eat by the rule above and males what they spent;
 * every hour every body from half a year drinks what it is short of full water (younger ones live on
 * milk's water). Put it before the bodies' systems.
 */
export function fxRearing(r: Rearing): SystemDef {
  return defineSystem({
    name: 'fixture.rearing',
    declare: (state) => {
      state.agents.ensureColumn({ name: 'rearMark', dtype: 'f64', category: 'body' });
      state.agents.ensureColumn({ name: 'rearYoungMark', dtype: 'f64', category: 'body' });
    },
    create(sim: Sim) {
      const agents = sim.state.agents;
      const perDay = sim.config.time.ticksPerDay;
      const perHour = perDay / 24;
      const perYear = ticksPerYear(sim.config);
      const watered = agents.hasColumn(HEAT_COLUMNS.water.name);
      return () => {
        const tick = sim.state.tick;
        const alive = agents.alive.data;
        const sex = agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data;
        const born = f64(sim, BODY_COLUMNS.born.name);
        const mothers = agents.column<Uint32Array>(REPRODUCTION_COLUMNS.motherId.name).data;
        const age = (slot: number) => (tick - born[slot]) / perYear;
        const hour = tick % perHour === 0;
        const quarter = tick % (6 * perHour) === 0;

        // Matings.
        if (r.mateEveryDays > 0 && tick % (r.mateEveryDays * perDay) === perDay / 2) {
          let male = -1;
          for (let slot = 0; slot < agents.highWater; slot++) {
            if (alive[slot] === 1 && sex[slot] === Sex.MALE && age(slot) >= 16) {
              male = slot;
              break;
            }
          }
          if (male >= 0) {
            for (let slot = 0; slot < agents.highWater; slot++) {
              if (alive[slot] === 1 && sex[slot] === Sex.FEMALE && age(slot) >= 12) mate(sim, slot, male);
            }
          }
        }

        const n = agents.highWater;
        for (let slot = 0; slot < n; slot++) {
          if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
          const a = age(slot);
          const out = f64(sim, BODY_COLUMNS.energyOut.name);
          const mark = f64(sim, 'rearMark');
          if (a < 15) {
            if (!hour) continue;
            const lean = f64(sim, BODY_COLUMNS.leanKg.name)[slot];
            const fat = fatKgOf(f64(sim, BODY_COLUMNS.energy.name)[slot], f64(sim, BODY_COLUMNS.gut.name)[slot], lean);
            let need = out[slot] - mark[slot];
            const short = r.childFat * (lean + fat) - fat;
            if (short > 0) need += 0.5 * short * METABOLISM.fatKcalPerKg;
            mark[slot] = out[slot];
            if (need > 0) {
              const mother = mothers[slot] > 0 ? agents.slotOf(mothers[slot]) : -1;
              const share = mother >= 0 ? milkShare(r, a) : 0;
              if (share > 0) nurse(sim, mother, slot, (need * share) / REPRODUCTION.milkKcalPerKg);
              if (share < 1) ingest(sim, slot, need * (1 - share));
            }
          } else if (quarter) {
            let meal = out[slot] - mark[slot];
            mark[slot] = out[slot];
            if (sex[slot] === Sex.FEMALE) {
              const youngMark = f64(sim, 'rearYoungMark');
              const young =
                f64(sim, REPRODUCTION_COLUMNS.fetusKcalIn.name)[slot] +
                f64(sim, REPRODUCTION_COLUMNS.milkMadeKg.name)[slot] * REPRODUCTION.milkKcalPerKg;
              if (!r.refeedYoung) meal -= young - youngMark[slot];
              youngMark[slot] = young;
              meal += r.extraPerDay / 4;
            }
            if (meal > 0) ingest(sim, slot, meal);
          }
          if (watered && hour && a >= 0.5 && f64(sim, HEAT_COLUMNS.coreC.name)[slot] !== 0) {
            const shortWater = fullWaterKg(f64(sim, BODY_COLUMNS.leanKg.name)[slot]) - f64(sim, HEAT_COLUMNS.water.name)[slot];
            if (shortWater > 0) drink(sim, slot, shortWater);
          }
        }
      };
    },
  });
}
