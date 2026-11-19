// Follow starving deer groups hour by hour (milestone 1.13). First run saves a snapshot at the
// given year; later runs load it, so the probe can be repeated quickly.
//   node experiments/P1-open-seed-6/follow.ts --seed 6 --year 18 --days 4 --groups 8 [--snap path]
// Reads the sim only.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import { SIM_PIPELINE } from '../../src/sim/pipeline.ts';
import { createSim, loadSim, saveSim, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { ANIMAL_STORE, AnimalKind, GROUP_KINDS } from '../../src/sim/world/animals.ts';
import { BROWSE_LAYER, FORAGE_LAYER, PLANT_CONSTANTS, PLANT_SPECIES, coverLayer } from '../../src/sim/world/plants.ts';
import { TERRAIN_LAYERS, Water } from '../../src/sim/world/terrain.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const seed = Number(arg('seed', '6'));
const year = Number(arg('year', '18'));
const days = Number(arg('days', '4'));
const groups = Number(arg('groups', '8'));
const circ = Number(arg('circ', '0'));
const snap = arg('snap', `${process.env.TMPDIR ?? '/tmp'}/abss-seed${seed}-c${circ}-y${year}.snap`);

let sim: Sim;
if (existsSync(snap)) {
  sim = loadSim(new Uint8Array(readFileSync(snap)), SIM_PIPELINE);
} else {
  const raw = JSON.parse(JSON.stringify(defaultConfig(seed)));
  raw.world.circumscription = circ;
  sim = createSim(validateConfig(raw), SIM_PIPELINE);
  const perYear = sim.config.time.ticksPerDay * sim.config.time.daysPerYear;
  stepSim(sim, year * perYear - sim.state.tick);
  writeFileSync(snap, saveSim(sim));
}
const { state, config } = sim;
const world = state.world;
const W = config.world.widthCells;
const cs = config.world.cellSizeM;
const areaHa = (cs * cs) / 10_000;
const elevation = world.layer<Float32Array>(TERRAIN_LAYERS.elevation);
const water = world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
const forage = world.layer<Float32Array>(FORAGE_LAYER);
const browse = world.layer<Float32Array>(BROWSE_LAYER);
const cover = PLANT_SPECIES.map((sp) => world.layer<Float32Array>(coverLayer(sp)));
const store = state.store(ANIMAL_STORE);
const deer = GROUP_KINDS.find((k) => k.kind === AnimalKind.DEER)!;
function reachable(k: number, kind: 'graze' | 'browse'): number {
  let floor = 0;
  for (let s = 0; s < PLANT_SPECIES.length; s++) {
    const sp = PLANT_SPECIES[s];
    if (sp.forageKind === kind) floor += cover[s][k] * sp.forageKgHa * areaHa * PLANT_CONSTANTS.ungrazableShare;
  }
  const r = (kind === 'graze' ? forage[k] : browse[k]) - floor;
  return r > 0 ? r : 0;
}
const deerFood = (k: number) => reachable(k, 'browse') + reachable(k, 'graze') * deer.grassShareMax;
const col = <T>(name: string) => store.column(name).data as T;

// The starving groups now, worst first.
const kind = col<Uint8Array>('kind');
const condition = col<Float32Array>('condition');
const picked: number[] = [];
for (let s = 0; s < store.highWater; s++) if (store.isAlive(s) && kind[s] === AnimalKind.DEER && condition[s] < 0.3) picked.push(s);
picked.sort((a, b) => condition[a] - condition[b]);
console.log(`tick ${state.tick}: ${picked.length} starving deer groups`);
const follow = picked.slice(0, groups);
const idCol = col<Uint32Array>('id');
const ids = follow.map((s) => idCol[s]);
const modeName = ['rest', 'move', 'flee', 'hunt', 'feed', 'ambush'];
const ticksPerHour = config.time.ticksPerDay / 24;
for (let h = 0; h < days * 24; h++) {
  for (let g = 0; g < follow.length; g++) {
    const slot = store.slotOf(ids[g]);
    if (slot < 0) continue;
    const x = col<Float32Array>('x')[slot];
    const y = col<Float32Array>('y')[slot];
    const k = Math.floor(y / cs) * W + Math.floor(x / cs);
    const tx = col<Float32Array>('targetX')[slot];
    const ty = col<Float32Array>('targetY')[slot];
    const n = col<Uint16Array>('count')[slot];
    console.log(
      `h${String(h).padStart(3)} g${g} n${n} cond ${col<Float32Array>('condition')[slot].toFixed(3)} ${modeName[col<Uint8Array>('mode')[slot]]} thirst ${col<Float32Array>('thirst')[slot]} at (${(x / 1000).toFixed(2)}, ${(y / 1000).toFixed(2)}) km elev ${elevation[k].toFixed(0)} water ${water[k]} food ${deerFood(k).toFixed(1)} kg (day need ${(n * deer.needKgPerDay).toFixed(0)}) target (${(tx / 1000).toFixed(2)}, ${(ty / 1000).toFixed(2)}) d ${Math.hypot(tx - x, ty - y).toFixed(0)} m`,
    );
  }
  stepSim(sim, ticksPerHour);
}
