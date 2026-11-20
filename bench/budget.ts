// Phase 3.1: what the real world and the real bodies cost now, so the mind's share of the
// budget is measured rather than assumed (docs/DESIGN.md §1.7, §4.7; D-016).
//
//   node bench/budget.ts [agents=500] [days=4] [seed=1]
//
// It builds a real world on the full map with the whole pipeline, places `agents` adult bodies in
// groups of 25 on dry land, keeps them fed and watered with the test keeper (tests/fixtures), warms
// up for a simulated day, then times every system over `days` simulated days. World systems cost
// the same whatever the number of agents; body systems cost per body. Scripted stand-ins only;
// nothing here enters src/.

import { defaultConfig } from '../src/sim/config.ts';
import { createSim, stepSim } from '../src/sim/sim.ts';
import type { StepProbe } from '../src/sim/sim.ts';
import { SIM_PIPELINE } from '../src/sim/pipeline.ts';
import { TERRAIN_LAYERS, Water } from '../src/sim/world/terrain.ts';
import { getMachineInfo } from '../src/harness/manifest.ts';
import { HADZA_MAN, HADZA_WOMAN, fxKeeper, spawnWithBody, withoutMinds } from '../tests/fixtures/bodies.ts';

const N = Number(process.argv[2] ?? 500);
const DAYS = Number(process.argv[3] ?? 4);
const seed = Number(process.argv[4] ?? 1);
const BUDGET_US = 6.94; // DESIGN.md §1.7

const config = defaultConfig(seed);
// The keeper goes where acts will go: after the world, before the bodies.
const pipeline = withoutMinds(SIM_PIPELINE);
pipeline.splice(pipeline.findIndex((d) => d.name === 'body.exposure'), 0, fxKeeper);
const t0 = performance.now();
const sim = createSim(config, pipeline);
const buildMs = performance.now() - t0;

const { widthCells: Wc, heightCells: Hc, cellSizeM: cs } = config.world;
const waterKind = sim.state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
let s = (seed * 2654435761) >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
for (let g = 0; g * 25 < N; g++) {
  let k: number;
  do k = Math.floor(rand() * Wc * Hc);
  while (waterKind[k] !== Water.DRY);
  for (let i = 0; i < 25 && g * 25 + i < N; i++) {
    const x = ((k % Wc) + rand()) * cs;
    const y = (Math.floor(k / Wc) + rand()) * cs;
    spawnWithBody(sim, x, y, { ...(i % 2 === 0 ? HADZA_MAN : HADZA_WOMAN), ageYears: 20 + rand() * 30 });
  }
}

const perDay = config.time.ticksPerDay;
stepSim(sim, perDay); // warm-up day

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
let worldMs = 0;
let bodyMs = 0;
const rows: string[] = [];
sim.pipeline.forEach((def, i) => {
  const isBody = def.name.startsWith('body.');
  const isFixture = def.name.startsWith('fixture.');
  if (isBody) bodyMs += spent[i];
  else if (!isFixture) worldMs += spent[i];
  const perTickUs = (spent[i] * 1000) / ticks;
  rows.push(
    `  ${def.name.padEnd(18)} ${perTickUs.toFixed(1).padStart(9)} us/tick` +
      (isBody ? `   ${(perTickUs / alive).toFixed(3)} us per body` : isFixture ? '   (stand-in, not counted)' : ''),
  );
});
const worldUsPerTick = (worldMs * 1000) / ticks;
const bodyUsPerAgentTick = (bodyMs * 1000) / ticks / alive;
const worldUsPerAgentTick = worldUsPerTick / N;
const machine = getMachineInfo();
console.log(`Machine: ${machine.cpu}, ${machine.cores} cores, Node ${machine.node}`);
console.log(`World built in ${(buildMs / 1000).toFixed(1)} s; ${N} bodies placed, ${alive} alive after ${DAYS + 1} days.`);
console.log(`Timed ${ticks} ticks (${DAYS} days) in ${(wallMs / 1000).toFixed(1)} s, probe overhead included.\n`);
console.log(rows.join('\n'));
console.log(`\nWorld systems: ${worldUsPerTick.toFixed(0)} us a tick, or ${worldUsPerAgentTick.toFixed(2)} us per agent per tick at ${N} agents.`);
console.log(`Body systems:  ${bodyUsPerAgentTick.toFixed(2)} us per agent per tick.`);
console.log(
  `Left for perception and minds at ${N} agents: ${(BUDGET_US - worldUsPerAgentTick - bodyUsPerAgentTick).toFixed(2)} us ` +
    `of the ${BUDGET_US} us budget (kernel overhead not subtracted; D-016 measured it at about 0.5).`,
);
