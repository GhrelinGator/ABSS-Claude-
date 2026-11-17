// Loose material and natural shelter (docs/DESIGN.md §2.15): loose stone by material, how
// much of the land has flint or iron sulfide to pick up, fallen wood, rock shelters, and
// how many objects exist.

import type { Measurements, Observer } from '../observer.ts';
import {
  MATERIAL_LAYERS,
  OBJECT_STORE,
  ROCK_SHELTER_STORE,
  RockShelterKind,
  STONE_MATERIALS,
  TERRAIN_LAYERS,
  Water,
  stoneLayer,
} from '../../sim/readonly.ts';

export const materials: Observer = {
  name: 'materials',
  observe(view): Measurements {
    if (!view.layerNames().includes(MATERIAL_LAYERS.smallWood)) return {};
    const water = view.layer(TERRAIN_LAYERS.waterKind);
    const cellHa = (view.config.world.cellSizeM * view.config.world.cellSizeM) / 10_000;
    let land = 0;
    for (let k = 0; k < water.length; k++) if (water[k] === Water.DRY) land++;
    const out: Measurements = {};
    for (const m of STONE_MATERIALS) {
      const kg = view.layer(stoneLayer(m));
      let total = 0;
      let cells = 0;
      for (let k = 0; k < kg.length; k++) {
        total += kg[k];
        if (water[k] === Water.DRY && kg[k] >= 1) cells++;
      }
      out[`${m.name}Tonnes`] = total / 1000;
      out[`${m.name}LandShare`] = land > 0 ? cells / land : 0;
    }
    const small = view.layer(MATERIAL_LAYERS.smallWood);
    const long = view.layer(MATERIAL_LAYERS.longWood);
    let s = 0;
    let l = 0;
    for (let k = 0; k < small.length; k++) {
      s += small[k];
      l += long[k];
    }
    out.smallWoodTPerHa = land > 0 ? s / 1000 / (land * cellHa) : 0;
    out.longWoodTPerHa = land > 0 ? l / 1000 / (land * cellHa) : 0;
    const shelters = view.store(ROCK_SHELTER_STORE);
    const kind = shelters.column('kind');
    const alive = shelters.column('alive');
    let caves = 0;
    for (let slot = 0; slot < shelters.highWater; slot++) if (alive[slot] === 1 && kind[slot] === RockShelterKind.CAVE) caves++;
    out.rockShelters = shelters.count;
    out.caves = caves;
    out.rockSheltersPer100Km2 = land > 0 ? shelters.count / ((land * cellHa) / 10_000) : 0;
    out.objects = view.store(OBJECT_STORE).count;
    return out;
  },
};
