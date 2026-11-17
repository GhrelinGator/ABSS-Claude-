// Fire (docs/DESIGN.md §2.16): what is burning now, what lit fires so far, how much of the land
// burned in the last year, the fine fuel lying on the land, and today's wind.

import type { Measurements, Observer } from '../observer.ts';
import {
  CLIMATE_FIELDS,
  CLIMATE_PARTS,
  FIRE_FIELDS,
  FIRE_LAYERS,
  FIRE_PARTS,
  FireStage,
  MATERIAL_LAYERS,
  TERRAIN_LAYERS,
  Water,
} from '../../sim/readonly.ts';

export const fire: Observer = {
  name: 'fire',
  observe(view): Measurements {
    if (!view.layerNames().includes(FIRE_LAYERS.stage)) return {};
    const { ticksPerDay, daysPerYear } = view.config.time;
    const cellHa = (view.config.world.cellSizeM * view.config.world.cellSizeM) / 10_000;
    const water = view.layer(TERRAIN_LAYERS.waterKind);
    const stage = view.layer(FIRE_LAYERS.stage);
    const last = view.layer(FIRE_LAYERS.lastBurnDay);
    const litter = view.layer(MATERIAL_LAYERS.litter);
    // lastBurnDay holds day number + 1, so "within the last year" is greater than today + 1 − daysPerYear.
    const since = Math.floor(view.tick / ticksPerDay) + 1 - daysPerYear;
    let land = 0;
    let flaming = 0;
    let smouldering = 0;
    let burnedLastYear = 0;
    let everBurned = 0;
    let fine = 0;
    for (let k = 0; k < water.length; k++) {
      if (stage[k] === FireStage.FLAMING) flaming++;
      else if (stage[k] === FireStage.SMOULDERING) smouldering++;
      if (water[k] !== Water.DRY) continue;
      land++;
      fine += litter[k];
      if (last[k] > 0) {
        everBurned++;
        if (last[k] > since) burnedLastYear++;
      }
    }
    const out: Measurements = {
      flamingCells: flaming,
      smoulderingCells: smouldering,
      burnedLandShareLastYear: land > 0 ? burnedLastYear / land : 0,
      everBurnedLandShare: land > 0 ? everBurned / land : 0,
      litterTPerHa: land > 0 ? fine / 1000 / (land * cellHa) : 0,
    };
    const counts = view.readings(FIRE_PARTS.counts);
    if (counts) {
      for (const [name, index] of Object.entries(FIRE_FIELDS)) out[name] = counts[index];
    }
    const weather = view.readings(CLIMATE_PARTS.weather);
    if (weather) out.windMs = Math.hypot(weather[CLIMATE_FIELDS.windEastMs], weather[CLIMATE_FIELDS.windSouthMs]);
    return out;
  },
};
