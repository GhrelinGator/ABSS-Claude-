// Loose materials and rock shelters (docs/DESIGN.md §2.15): dead wood, bone and skin per km²
// of land, loose stones of each kind, caves and overhangs, and objects lying or held.
// Rock shelters come mostly with steep ground, so hemmed-in maps have more of them: E3
// should report these numbers alongside its manipulation check.

import type { Measurements, Observer } from '../observer.ts';
import { MATERIALS, MATERIAL_LAYERS, OBJECT_STORE, RockShelter, STONE_KINDS, TERRAIN_LAYERS, Water, stoneLayer } from '../../sim/readonly.ts';

export const materials: Observer = {
  name: 'materials',
  observe(view): Measurements {
    if (!view.layerNames().includes(MATERIAL_LAYERS.deadwood)) return {};
    const kind = view.layer(TERRAIN_LAYERS.waterKind);
    const deadwood = view.layer(MATERIAL_LAYERS.deadwood);
    const bone = view.layer(MATERIAL_LAYERS.bone);
    const hide = view.layer(MATERIAL_LAYERS.hide);
    const shelter = view.layer(MATERIAL_LAYERS.rockShelter);
    let land = 0;
    let wood = 0;
    let boneKg = 0;
    let hideKg = 0;
    let caves = 0;
    let overhangs = 0;
    for (let k = 0; k < kind.length; k++) {
      if (kind[k] === Water.DRY) land++;
      wood += deadwood[k];
      boneKg += bone[k];
      hideKg += hide[k];
      if (shelter[k] === RockShelter.CAVE) caves++;
      else if (shelter[k] === RockShelter.OVERHANG) overhangs++;
    }
    const cellKm2 = (view.config.world.cellSizeM * view.config.world.cellSizeM) / 1e6;
    const km2 = land * cellKm2;
    const out: Measurements = {
      deadwoodTPerKm2: km2 > 0 ? wood / 1000 / km2 : 0,
      boneKgPerKm2: km2 > 0 ? boneKg / km2 : 0,
      hideKgPerKm2: km2 > 0 ? hideKg / km2 : 0,
      caves,
      overhangs,
      objects: view.store(OBJECT_STORE).count,
    };
    for (const m of STONE_KINDS) {
      const count = view.layer(stoneLayer(m));
      let n = 0;
      for (let k = 0; k < count.length; k++) n += count[k];
      out[`stones.${MATERIALS[m].name}`] = n;
    }
    return out;
  },
};
