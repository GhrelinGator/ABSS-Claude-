// Animals at the moment of sampling (docs/DESIGN.md §2.13): how many of each kind
// per km² of land, in how many groups, and the running totals of kills, births and deaths.

import type { Measurements, Observer } from '../observer.ts';
import { ANIMAL_FIELDS, ANIMAL_PARTS, ANIMAL_STORE, CARCASS_LAYER, GROUP_KINDS, HARE_LAYER, TERRAIN_LAYERS, Water } from '../../sim/readonly.ts';

export const fauna: Observer = {
  name: 'fauna',
  observe(view): Measurements {
    const names = view.layerNames();
    if (!names.includes(HARE_LAYER) || !names.includes(TERRAIN_LAYERS.waterKind)) return {};
    const water = view.layer(TERRAIN_LAYERS.waterKind);
    let land = 0;
    for (let k = 0; k < water.length; k++) if (water[k] === Water.DRY) land++;
    if (land === 0) return {};
    const km2 = (land * view.config.world.cellSizeM * view.config.world.cellSizeM) / 1e6;
    const store = view.store(ANIMAL_STORE);
    const alive = store.column('alive');
    const kind = store.column('kind');
    const count = store.column('count');
    const out: Measurements = {};
    for (const spec of GROUP_KINDS) {
      let animals = 0;
      let groups = 0;
      for (let s = 0; s < store.highWater; s++) {
        if (alive[s] !== 1 || kind[s] !== spec.kind) continue;
        animals += count[s];
        groups++;
      }
      out[`${spec.name}.perKm2`] = animals / km2;
      out[`${spec.name}.groups`] = groups;
    }
    const hare = view.layer(HARE_LAYER);
    const carcass = view.layer(CARCASS_LAYER);
    let hares = 0;
    let meat = 0;
    for (let k = 0; k < hare.length; k++) {
      hares += hare[k];
      meat += carcass[k];
    }
    out['hare.perKm2'] = hares / km2;
    out.carcassKgPerKm2 = meat / km2;
    const totals = view.readings(ANIMAL_PARTS.counts);
    if (totals) for (const [name, index] of Object.entries(ANIMAL_FIELDS)) out[`total.${name}`] = totals[index];
    return out;
  },
};
