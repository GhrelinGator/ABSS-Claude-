// The weather at the moment of sampling, plus the map-wide average soil
// moisture. Experiment E1's manipulation check reads the wetness anomaly
// and rain from here (docs/DESIGN.md §2.11).

import type { Measurements, Observer } from '../observer.ts';
import { CLIMATE_FIELDS as F, CLIMATE_PARTS, MOISTURE_LAYER, airTemperatureC, stormActive } from '../../sim/readonly.ts';

export const weather: Observer = {
  name: 'weather',
  observe(view): Measurements {
    const w = view.readings(CLIMATE_PARTS.weather);
    if (!w) return {};
    const strikes = view.readings(CLIMATE_PARTS.strikes);
    const moisture = view.layer(MOISTURE_LAYER);
    let sum = 0;
    for (let k = 0; k < moisture.length; k++) sum += moisture[k];
    return {
      temperatureC: airTemperatureC(view.config, view.tick, w, 400),
      wetToday: w[F.wetToday],
      rainTodayMm: w[F.rainTodayMm],
      wetness: w[F.wetness],
      slowAnomalyC: w[F.slowAnomalyC],
      storm: stormActive(w, view.tick) ? 1 : 0,
      strikesThisTick: strikes ? strikes.length : 0,
      strikesTotal: w[F.strikesTotal],
      meanSoilMoisture: sum / moisture.length,
    };
  },
};
