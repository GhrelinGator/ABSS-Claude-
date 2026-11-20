// Phase 3.2: what perception costs on the real world at full size, against the share of the budget
// docs/DESIGN.md §4.7.12 leaves it (about 0.5 us per agent per tick at 0.25 decisions per awake agent-tick).
//
//   node bench/perception.ts [agents=500] [days=4] [seed=1] [rate=0.25] [kmh=0.55]
//
// It builds a real world on the full map with the whole pipeline, places `agents` adult bodies in groups
// of 25 on dry land, keeps them fed and watered (the test keeper), and moves each group about by day
// at `kmh` on average: 0.55 km/h is about 9 km over 16 waking hours, between Hadza women's and men's
// daily distances (about 6 and 11 km, Pontzer et al. 2012, remembered and not re-checked). Moving
// groups keep reaching cells not yet seen from, which is what the caches cost. Awake agents (6:00
// to 22:00) look at `rate` looks per tick each, as minds will at that many decisions; sleepers do not.
// Scripted stand-ins only; nothing here enters src/.

import { defaultConfig } from '../src/sim/config.ts';
import { tickOfDay } from '../src/sim/core/clock.ts';
import { defineSystem } from '../src/sim/core/registry.ts';
import { PERCEIVED_CLASSES } from '../src/sim/mind/cues.ts';
import { Percepts, createPerception, declarePerception } from '../src/sim/mind/perception.ts';
import { SIM_PIPELINE } from '../src/sim/pipeline.ts';
import { createSim, stepSim } from '../src/sim/sim.ts';
import type { StepProbe } from '../src/sim/sim.ts';
import { TERRAIN_LAYERS, Water } from '../src/sim/world/terrain.ts';
import { getMachineInfo } from '../src/harness/manifest.ts';
import { HADZA_MAN, HADZA_WOMAN, fxKeeper, spawnWithBody } from '../tests/fixtures/bodies.ts';

const N = Number(process.argv[2] ?? 500);
const DAYS = Number(process.argv[3] ?? 4);
const seed = Number(process.argv[4] ?? 1);
const RATE = Number(process.argv[5] ?? 0.25);
const KMH = Number(process.argv[6] ?? 0.55);
const SHARE_US = 0.5; // DESIGN.md §4.7.12: perception's share at 0.25 decisions per awake agent-tick
const GROUP = 25;

let s = (seed * 2654435761) >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let looks = 0;
let percepts = 0;
const classSeen = new Float64Array(PERCEIVED_CLASSES.length);
let individuals = 0;

// Groups wander: a heading that turns a little each tick, at KMH by day; members jitter a few metres.
const fxMover = defineSystem({
  name: 'fixture.mover',
  create: (sim) => {
    const heading = new Float64Array(Math.ceil(N / GROUP)).map(() => rand() * 2 * Math.PI);
    const widthM = sim.config.world.widthCells * sim.config.world.cellSizeM;
    return () => {
      const hourOfDay = (tickOfDay(sim.config, sim.state.tick) * 24) / sim.config.time.ticksPerDay;
      if (hourOfDay < 6 || hourOfDay >= 22) return;
      const agents = sim.state.agents;
      const x = agents.column<Float64Array>('x').data;
      const y = agents.column<Float64Array>('y').data;
      for (let g = 0; g < heading.length; g++) heading[g] += (rand() - 0.5) * 0.6;
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (agents.alive.data[slot] !== 1) continue;
        const g = Math.floor(slot / GROUP) % heading.length;
        const step = (KMH * 1000) / 6; // metres per 10 minutes
        let nx = x[slot] + step * Math.cos(heading[g]) + (rand() - 0.5) * 10;
        let ny = y[slot] + step * Math.sin(heading[g]) + (rand() - 0.5) * 10;
        if (nx < 100 || nx > widthM - 100 || ny < 100 || ny > widthM - 100) {
          heading[g] += Math.PI;
          nx = x[slot];
          ny = y[slot];
        }
        x[slot] = nx;
        y[slot] = ny;
      }
    };
  },
});

const fxLooker = defineSystem({
  name: 'fixture.looker',
  declare: declarePerception,
  create: (sim) => {
    const eye = createPerception(sim);
    const out = new Percepts();
    return () => {
      const hourOfDay = (tickOfDay(sim.config, sim.state.tick) * 24) / sim.config.time.ticksPerDay;
      if (hourOfDay < 6 || hourOfDay >= 22) return;
      const agents = sim.state.agents;
      const every = Math.round(1 / RATE);
      for (let slot = 0; slot < agents.highWater; slot++) {
        if (agents.alive.data[slot] !== 1 || (sim.state.tick + slot) % every !== 0) continue;
        const n = eye.perceive(slot, out);
        looks++;
        percepts += n;
        for (let q = 0; q < n; q++) {
          const c = out.cue[q];
          if (c >>> 24 === 1) classSeen[c & 0xffffff]++;
          else if (c >>> 24 === 2) individuals++;
        }
      }
    };
  },
});

const config = defaultConfig(seed);
const pipeline = [...SIM_PIPELINE];
const at = pipeline.findIndex((d) => d.name === 'body.exposure');
// Looks come first in a tick (the decide phase reads tick-start state, §1.6), then the moves, as acts will.
pipeline.splice(at, 0, fxLooker, fxMover, fxKeeper);
const t0 = performance.now();
const sim = createSim(config, pipeline);
const buildMs = performance.now() - t0;

const { widthCells: Wc, heightCells: Hc, cellSizeM: cs } = config.world;
const waterKind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
for (let g = 0; g * GROUP < N; g++) {
  let k: number;
  do k = Math.floor(rand() * Wc * Hc);
  while (waterKind[k] !== Water.DRY);
  for (let i = 0; i < GROUP && g * GROUP + i < N; i++) {
    const x = ((k % Wc) + 0.35 + 0.3 * rand()) * cs;
    const y = (Math.floor(k / Wc) + 0.35 + 0.3 * rand()) * cs;
    spawnWithBody(sim, x, y, { ...(i % 2 === 0 ? HADZA_MAN : HADZA_WOMAN), ageYears: 20 + rand() * 30 });
  }
}

const perDay = config.time.ticksPerDay;
stepSim(sim, perDay); // warm-up day: lines of sight from the first cells are worked out here
looks = 0;
percepts = 0;
classSeen.fill(0);
individuals = 0;

const spent = new Array<number>(sim.pipeline.length).fill(0);
let entered = 0;
const probe: StepProbe = {
  enter() {
    entered = performance.now();
  },
  exit(i) {
    spent[i] += performance.now() - entered;
  },
};
const w0 = performance.now();
stepSim(sim, DAYS * perDay, probe);
const wallMs = performance.now() - w0;
const ticks = DAYS * perDay;
const alive = sim.state.agents.count;
const timeOf = (name: string) => spent[sim.pipeline.findIndex((d) => d.name === name)];

const lookUs = (timeOf('fixture.looker') * 1000) / looks;
const perAgentTick = (timeOf('fixture.looker') * 1000) / ticks / alive;
const awakeShare = 16 / 24;
const machine = getMachineInfo();
console.log(`Machine: ${machine.cpu}, ${machine.cores} cores, Node ${machine.node}`);
console.log(`World built in ${(buildMs / 1000).toFixed(1)} s; ${N} bodies in groups of ${GROUP}, ${alive} alive; ${DAYS} days timed in ${(wallMs / 1000).toFixed(1)} s.`);
console.log(`Groups walk ${KMH} km/h by day.`);
console.log(`Looks: ${looks} (${(looks / ticks / alive).toFixed(3)} per agent-tick; ${RATE} per awake agent-tick, awake ${(awakeShare * 100).toFixed(0)}% of the day).`);
console.log(`  ${lookUs.toFixed(2)} us a look, ${(percepts / looks).toFixed(1)} percepts a look (${(individuals / looks).toFixed(1)} of them persons by id).`);
console.log(`  ${perAgentTick.toFixed(3)} us per agent per tick for perception, against about ${SHARE_US} in DESIGN.md §4.7.12.`);
console.log(`  body.exposure: ${((timeOf('body.exposure') * 1000) / ticks / alive).toFixed(3)} us per body per tick.`);
const common = [...classSeen.keys()].sort((a, b) => classSeen[b] - classSeen[a]).slice(0, 8);
console.log(`  Most often seen: ${common.map((c) => `${PERCEIVED_CLASSES[c].name} ${((classSeen[c] / looks) * 100).toFixed(0)}%`).join(', ')}.`);
