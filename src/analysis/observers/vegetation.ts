// Plant cover and food at the moment of sampling (docs/DESIGN.md §2.12): how much
// of the land each species covers, and how many calories are standing on it.
// "Edible" here is the observer's label, using the catalogue's toxin entries;
// the simulation itself never says which plants are food.

import type { Measurements, Observer } from '../observer.ts';
import { PLANT_SPECIES, TERRAIN_LAYERS, Water, coverLayer, foodLayer } from '../../sim/readonly.ts';

export const vegetation: Observer = {
  name: 'vegetation',
  observe(view): Measurements {
    const names = view.layerNames();
    if (!names.includes(coverLayer(PLANT_SPECIES[0])) || !names.includes(TERRAIN_LAYERS.waterKind)) return {};
    const kind = view.layer(TERRAIN_LAYERS.waterKind);
    let land = 0;
    for (let k = 0; k < kind.length; k++) if (kind[k] === Water.DRY) land++;
    if (land === 0) return {};
    const landKm2 = (land * view.config.world.cellSizeM * view.config.world.cellSizeM) / 1e6;
    const out: Measurements = {};
    let edibleKcal = 0;
    let ripeKcal = 0;
    let poisonKcal = 0;
    for (const species of PLANT_SPECIES) {
      const cover = view.layer(coverLayer(species));
      const food = view.layer(foodLayer(species));
      let c = 0;
      let f = 0;
      for (let k = 0; k < cover.length; k++) {
        c += cover[k];
        f += food[k];
      }
      out[`cover.${species.name}`] = c / land;
      const kcal = f * species.kcalPerKg;
      if (species.toxin && !species.toxin.removedByProcessing) poisonKcal += kcal;
      else edibleKcal += kcal;
      if (species.food.kind === 'seasonal' && !(species.toxin && !species.toxin.removedByProcessing)) ripeKcal += kcal;
    }
    out.edibleKcalPerKm2 = edibleKcal / landKm2;
    out.ripeKcalPerKm2 = ripeKcal / landKm2;
    out.poisonKcalPerKm2 = poisonKcal / landKm2;
    return out;
  },
};
