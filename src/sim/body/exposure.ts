// Exposure: what each body is in, read from the world at its position each
// tick (docs/DESIGN.md §3.9): air, sky, humidity, wind, rain, sun, fire's heat,
// the hides it holds, and other bodies against its skin. It writes only the
// body's surroundings columns, which body.heat reads.

import { dayFraction } from '../core/clock.ts';
import { cosTurn } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { BucketGrid } from '../core/spatial.ts';
import type { Sim, SimState } from '../sim.ts';
import { CLIMATE_CONSTANTS, CLIMATE_FIELDS, CLIMATE_PARTS, MOISTURE_LAYER, airTemperatureC } from '../world/climate.ts';
import { FIRE_CONSTANTS, FireConditions, airHumidity, createFireProbe } from '../world/fire.ts';
import { sunlight } from '../world/light.ts';
import { Material, OBJECT_STORE, createShelterProbe } from '../world/materials.ts';
import { TERRAIN_LAYERS } from '../world/terrain.ts';
import { BODY_COLUMNS, Sex } from './metabolism.ts';
import { SURROUNDINGS } from './heat.ts';

export const EXPOSURE = {
  /** Wind at body height as a share of the wind at 10 m (log profile over short grass) [estimate]. */
  bodyHeightWind: 0.65,
  /** How much colder than the air a clear sky makes the radiant surroundings of a body in the open, °C [estimate]. */
  clearSkyC: 10,
  /** Clearness of the sky on a wet day (1 on a dry day) [estimate]. */
  wetDayClearness: 0.2,
  /** Sunlight on a surface facing the sun at full noon sun, W/m², and the share cloud lets through on a wet day [estimates]. */
  fullSunWm2: 800,
  wetDaySun: 0.25,
  /** Insulation per kg of hide held, clo (DESIGN.md §2.15), and the most counted [estimate]. */
  hideCloPerKg: 0.8,
  hideMostClo: 4,
  /** Another body within this distance covers this share of the skin; at most this many count [estimates]. */
  contactM: 0.5,
  contactShare: 0.12,
  contactMost: 3,
} as const;
const E = EXPOSURE;
const S = SURROUNDINGS;

// ALIBI: air, sky, sun, wind, rain and fire are what they are at a spot whoever stands there; a
// hide wrapped round a body insulates it, and a warm body pressed against another covers skin.
export const exposure: SystemDef = defineSystem({
  name: 'body.exposure',
  declare(state: SimState) {
    for (const spec of Object.values(SURROUNDINGS)) state.agents.ensureColumn(spec);
  },
  create(sim: Sim) {
    const { config, state } = sim;
    const agents = state.agents;
    const { widthCells: W, heightCells: Hc, cellSizeM: cs } = config.world;
    const weatherPart = state.parts.find((p) => p.name === CLIMATE_PARTS.weather);
    if (!weatherPart || !weatherPart.readings) throw new Error('body.exposure needs world.climate.');
    const weather = weatherPart.readings();
    const elevation = state.world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
    const moisture = state.world.layer<Float32Array>(MOISTURE_LAYER);
    const objects = state.store(OBJECT_STORE);
    const conditions = new FireConditions(sim);
    const shelter = createShelterProbe(sim);
    const fires = createFireProbe(sim);
    const grid = new BucketGrid(W * cs, Hc * cs, 200);
    const share = new Float64Array(3);
    const fireOut = new Float64Array(2);
    let hides = new Float64Array(64);

    return () => {
      const tick = state.tick;
      const n = agents.highWater;
      const alive = agents.alive.data;
      const sex = agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data;
      const x = agents.column<Float64Array>('x').data;
      const y = agents.column<Float64Array>('y').data;
      const airC = agents.column<Float64Array>(S.airC.name).data;
      const radiantC = agents.column<Float64Array>(S.radiantC.name).data;
      const humidity = agents.column<Float64Array>(S.humidity.name).data;
      const windMs = agents.column<Float64Array>(S.windMs.name).data;
      const rainMmH = agents.column<Float64Array>(S.rainMmH.name).data;
      const sunWm2 = agents.column<Float64Array>(S.sunWm2.name).data;
      const fireWm2 = agents.column<Float64Array>(S.fireWm2.name).data;
      const hideClo = agents.column<Float64Array>(S.hideClo.name).data;
      const contact = agents.column<Float64Array>(S.contact.name).data;

      // The weather now, the same for the whole map apart from height and storms.
      conditions.refresh(tick);
      const ref = CLIMATE_CONSTANTS.referenceElevationM;
      const airRef = airTemperatureC(config, tick, weather, ref);
      const wet = weather[CLIMATE_FIELDS.wetToday] === 1;
      const hourCos = cosTurn(dayFraction(config, tick) - FIRE_CONSTANTS.driestHour / 24);
      const clearness = wet ? E.wetDayClearness : 1;
      const sun = E.fullSunWm2 * sunlight(config, tick) * (wet ? E.wetDaySun : 1);
      const wind = (E.bodyHeightWind * conditions.windKmh) / 3.6;

      // Hides held, by the holding agent's slot.
      if (hides.length < n) hides = new Float64Array(Math.max(n, 2 * hides.length));
      hides.fill(0, 0, n);
      if (objects.count > 0) {
        const holder = objects.column<Uint32Array>('holder').data;
        const material = objects.column<Uint8Array>('material').data;
        const mass = objects.column<Float32Array>('mass').data;
        const live = objects.alive.data;
        for (let o = 0; o < objects.highWater; o++) {
          if (live[o] !== 1 || holder[o] === 0 || material[o] !== Material.HIDE) continue;
          const slot = agents.slotOf(holder[o]);
          if (slot >= 0) hides[slot] += mass[o];
        }
      }

      let bodies = 0;
      for (let slot = 0; slot < n; slot++) if (alive[slot] === 1 && sex[slot] !== Sex.NONE) bodies++;
      if (bodies > 1) grid.build(x, y, alive, n);

      for (let slot = 0; slot < n; slot++) {
        if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
        const px = x[slot];
        const py = y[slot];
        let i = Math.floor(px / cs);
        let j = Math.floor(py / cs);
        if (i >= W) i = W - 1;
        if (j >= Hc) j = Hc - 1;
        const k = j * W + i;
        shelter.at(px, py, share);
        const open = 1 - share[2];
        const air = airRef - CLIMATE_CONSTANTS.lapseRatePerM * (elevation[k] - ref);
        airC[slot] = air;
        radiantC[slot] = air - E.clearSkyC * open * clearness;
        humidity[slot] = airHumidity(moisture[k], wet, hourCos);
        windMs[slot] = wind * (1 - share[0]);
        rainMmH[slot] = (conditions.stormRateNow(k) + conditions.dayRainOn(k) / 24) * (1 - share[1]);
        sunWm2[slot] = sun * open;
        fires.at(px, py, fireOut);
        fireWm2[slot] = fireOut[1];
        const clo = E.hideCloPerKg * hides[slot];
        hideClo[slot] = clo < E.hideMostClo ? clo : E.hideMostClo;
        let near = 0;
        if (bodies > 1) {
          const found = grid.query(px, py, E.contactM, x, y);
          for (let q = 0; q < found; q++) {
            const other = grid.result[q];
            if (other !== slot && sex[other] !== Sex.NONE) near++;
          }
        }
        contact[slot] = E.contactShare * (near < E.contactMost ? near : E.contactMost);
      }
    };
  },
});
