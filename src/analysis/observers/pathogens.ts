// The hidden loads (docs/DESIGN.md §2.14): average pathogen load by kind of water,
// and the load of carcass meat weighted by how much meat there is.

import type { Measurements, Observer } from '../observer.ts';
import { CARCASS_LAYER, CARCASS_LOAD_LAYER, TERRAIN_LAYERS, WATER_PATHOGEN_LAYER, Water } from '../../sim/readonly.ts';

export const pathogens: Observer = {
  name: 'pathogens',
  observe(view): Measurements {
    if (!view.layerNames().includes(WATER_PATHOGEN_LAYER)) return {};
    const kind = view.layer(TERRAIN_LAYERS.waterKind);
    const load = view.layer(WATER_PATHOGEN_LAYER);
    const meat = view.layer(CARCASS_LAYER);
    const meatLoad = view.layer(CARCASS_LOAD_LAYER);
    const sum = [0, 0, 0, 0];
    const cells = [0, 0, 0, 0];
    let kg = 0;
    let foulKg = 0;
    for (let k = 0; k < kind.length; k++) {
      sum[kind[k]] += load[k];
      cells[kind[k]] += 1;
      kg += meat[k];
      foulKg += meat[k] * meatLoad[k];
    }
    const out: Measurements = {};
    if (cells[Water.LAKE] > 0) out.lake = sum[Water.LAKE] / cells[Water.LAKE];
    if (cells[Water.RIVER] > 0) out.river = sum[Water.RIVER] / cells[Water.RIVER];
    if (cells[Water.SPRING] > 0) out.spring = sum[Water.SPRING] / cells[Water.SPRING];
    out.carcassMeat = kg > 0 ? foulKg / kg : 0;
    return out;
  },
};
