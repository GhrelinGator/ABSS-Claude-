// Sleep a body cannot refuse (docs/DESIGN.md §4.15.6, the owner's answer to Q15, D-062): past a sleep
// pressure of 0.78 an awake body sleeps whatever its mind would choose, and that sleep is ended by pain
// or its usual end, not by another drive crossing 0.8 at the hour.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { HEAT_COLUMNS, fullWaterKg } from '../../src/sim/body/heat.ts';
import { BODY_COLUMNS } from '../../src/sim/body/metabolism.ts';
import { SLEEP, SLEEP_COLUMNS } from '../../src/sim/body/sleep.ts';
import { ACT_COLUMNS, Act, ActEnd, ActTally } from '../../src/sim/mind/acts.ts';
import { CHANNELS, Channel, createInteroception } from '../../src/sim/mind/interoception.ts';
import { MIND_PARTS } from '../../src/sim/mind/mind.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';
import { spawnWithBody } from '../fixtures/bodies.ts';

function world(): Sim {
  const raw = JSON.parse(JSON.stringify(defaultConfig(7)));
  raw.world.widthCells = 48;
  raw.world.heightCells = 48;
  raw.world.circumscription = 0.2;
  return createSim(validateConfig(raw), SIM_PIPELINE);
}

const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;

/** Set a body's act by hand, begun a tick ago, with the drives at its start as they are now. */
function setAct(sim: Sim, slot: number, kind: number, ref: number): void {
  const a = sim.state.agents;
  a.column<Uint8Array>(ACT_COLUMNS.actKind.name).data[slot] = kind;
  a.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data[slot] = ActEnd.GOING;
  f64(sim, ACT_COLUMNS.actRef.name)[slot] = ref;
  f64(sim, ACT_COLUMNS.actStart.name)[slot] = sim.state.tick - 1;
  f64(sim, ACT_COLUMNS.actWorkS.name)[slot] = 0;
  const intero = createInteroception(sim);
  intero.refresh();
  const d = new Float64Array(CHANNELS);
  intero.read(slot, d, 0);
  a.column<Float32Array>(ACT_COLUMNS.actDrives.name).data.set(d, slot * CHANNELS);
}

test('past the limit an awake body sleeps whatever it was doing; under it, it is not made to', () => {
  const sim = world();
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  let k = 0;
  while (water[k] !== Water.DRY) k++;
  const cs = sim.config.world.cellSizeM;
  const x = ((k % 48) + 0.5) * cs;
  const y = (Math.floor(k / 48) + 0.5) * cs;
  const past = spawnWithBody(sim, x, y);
  const under = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  const pressure = f64(sim, SLEEP_COLUMNS.sleepPressure.name);
  pressure[past] = SLEEP.mustSleepAt + 0.05;
  pressure[under] = SLEEP.mustSleepAt - 0.2;
  setAct(sim, past, Act.EXPLORE, 0);
  setAct(sim, under, Act.EXPLORE, 0);
  const tally = sim.state.parts.find((p) => p.name === MIND_PARTS.acts)!.readings!() as Float64Array;
  const before = tally[ActTally.SLEEPS_UNREFUSED];
  stepSim(sim, 1);
  const kind = sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actKind.name).data;
  const ref = f64(sim, ACT_COLUMNS.actRef.name);
  assert.equal(kind[past], Act.SLEEP);
  assert.equal(ref[past], 1, 'marked as a sleep it could not refuse');
  assert.equal(kind[under], Act.EXPLORE, 'its walk goes on');
  assert.equal(tally[ActTally.SLEEPS_UNREFUSED] - before, 1);
});

test('a sleep that could not be refused is not ended by a drive crossing 0.8 at the hour; a chosen one is; pain ends both', () => {
  const sim = world();
  const water = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  let k = 0;
  while (water[k] !== Water.DRY) k++;
  const cs = sim.config.world.cellSizeM;
  const x = ((k % 48) + 0.5) * cs;
  const y = (Math.floor(k / 48) + 0.5) * cs;
  const unrefused = spawnWithBody(sim, x, y);
  const chosen = spawnWithBody(sim, x, y);
  const hurt = spawnWithBody(sim, x, y);
  stepSim(sim, 1);
  const perHour = sim.config.time.ticksPerDay / 24;
  // Up to a tick on the hour, which the next step runs.
  while (sim.state.tick % perHour !== 0) stepSim(sim, 1);
  const pressure = f64(sim, SLEEP_COLUMNS.sleepPressure.name);
  const bodyWater = f64(sim, HEAT_COLUMNS.water.name);
  const lean = f64(sim, BODY_COLUMNS.leanKg.name);
  // Thirsty past 0.8 now, as none was when the sleep began (its drives at the start are set to 0).
  for (const s of [unrefused, chosen]) bodyWater[s] = fullWaterKg(lean[s]) - 0.14 * lean[s] * 1.15;
  pressure[unrefused] = 0.95;
  pressure[chosen] = 0.75;
  pressure[hurt] = 0.95;
  setAct(sim, unrefused, Act.SLEEP, 1);
  setAct(sim, chosen, Act.SLEEP, 0);
  setAct(sim, hurt, Act.SLEEP, 1);
  const startDrives = sim.state.agents.column<Float32Array>(ACT_COLUMNS.actDrives.name).data;
  // Thirst was low when the two sleeps began; pain at the third's start is set 0.5 below now's: pain has risen.
  startDrives[unrefused * CHANNELS + Channel.THIRST] = 0;
  startDrives[chosen * CHANNELS + Channel.THIRST] = 0;
  startDrives[hurt * CHANNELS + Channel.PAIN] -= 0.5;
  const intero = createInteroception(sim);
  intero.refresh();
  const d = new Float64Array(CHANNELS);
  intero.read(chosen, d, 0);
  assert.ok(d[Channel.THIRST] >= 0.8, `thirst ${d[Channel.THIRST]}`);
  const began = sim.state.tick;
  stepSim(sim, 1);
  const started = f64(sim, ACT_COLUMNS.actStart.name);
  const kind = sim.state.agents.column<Uint8Array>(ACT_COLUMNS.actKind.name).data;
  const ref = f64(sim, ACT_COLUMNS.actRef.name);
  assert.equal(started[unrefused], began - 1, 'not woken by thirst');
  assert.equal(kind[unrefused], Act.SLEEP, `unrefused: ${kind[unrefused]}`);
  assert.equal(started[chosen], began, 'woken by thirst: it chose again');
  assert.equal(started[hurt], began, 'woken by pain');
  assert.equal(kind[hurt], Act.SLEEP, `and, still past the limit, asleep again: ${kind[hurt]}`);
  assert.equal(ref[hurt], 1);
});
