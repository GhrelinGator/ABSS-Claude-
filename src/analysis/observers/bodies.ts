// Agents' bodies at the moment of sampling (docs/DESIGN.md §3.8): how many,
// their mean mass and fat share, the energy they have eaten and spent so far,
// and deaths so far by cause.

import type { Measurements, Observer } from '../observer.ts';
import { BODY_COLUMNS, BODY_PARTS, DeathCause, Sex, fatKgOf } from '../../sim/readonly.ts';

export const bodies: Observer = {
  name: 'bodies',
  observe(view): Measurements {
    const agents = view.agents;
    if (!agents.hasColumn(BODY_COLUMNS.energy.name)) return {};
    const alive = agents.column('alive');
    const sex = agents.column(BODY_COLUMNS.sex.name);
    const energy = agents.column(BODY_COLUMNS.energy.name);
    const energyIn = agents.column(BODY_COLUMNS.energyIn.name);
    const energyOut = agents.column(BODY_COLUMNS.energyOut.name);
    const gut = agents.column(BODY_COLUMNS.gut.name);
    const lean = agents.column(BODY_COLUMNS.leanKg.name);
    let n = 0;
    let mass = 0;
    let fatShare = 0;
    let eaten = 0;
    let spent = 0;
    for (let slot = 0; slot < agents.highWater; slot++) {
      if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
      const fat = fatKgOf(energy[slot], gut[slot], lean[slot]);
      const m = fat + lean[slot];
      n++;
      mass += m;
      fatShare += fat / m;
      eaten += energyIn[slot];
      spent += energyOut[slot];
    }
    const out: Measurements = { withBodies: n };
    if (n > 0) {
      out.meanMassKg = mass / n;
      out.meanFatShare = fatShare / n;
      out.meanKcalIn = eaten / n;
      out.meanKcalOut = spent / n;
    }
    const deaths = view.readings(BODY_PARTS.deaths);
    if (deaths) out['deaths.starvation'] = deaths[DeathCause.STARVATION];
    return out;
  },
};
