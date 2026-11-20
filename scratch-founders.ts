import { createSim, stepSim } from './src/sim/sim.ts';
import { defaultConfig, validateConfig } from './src/sim/config.ts';
import { SIM_PIPELINE } from './src/sim/pipeline.ts';
const n = Number(process.argv[2] ?? 30);
const days = Number(process.argv[3] ?? 10);
const cfg = validateConfig({ ...JSON.parse(JSON.stringify(defaultConfig(Number(process.argv[4] ?? 7)))), founders: { count: n, radiusM: 3000 } });
const sim = createSim(cfg, SIM_PIPELINE);
const times = new Map<string, number>();
const probe = { before(){}, after(){} };
let t0 = performance.now();
for (let d = 0; d < days; d++) {
  stepSim(sim, 144);
  const dd = sim.state.parts.find(p=>p.name==='body.deaths')!.readings!();
  const a = sim.state.parts.find(p=>p.name==='mind.acts')!.readings!();
  console.log('day', d+1, 'alive', sim.state.agents.count, 'deaths', Array.from(dd).join(','), 'begun', Array.from(a).slice(1,11).join(','), 'failed', Array.from(a).slice(23,33).join(','), 'kgPlant', Array.from(a).slice(33,41).map(x=>x.toFixed(1)).join(','), 'meat', a[41].toFixed(1), 'water', a[42].toFixed(1), 'kcal', a[43].toFixed(0), 'dec/awake', (a[44]/a[45]).toFixed(3), 'int', a[46], 'pieces', a[48], 'embers', a[49], 'fires', a[50]);
}
console.log('ms', (performance.now()-t0).toFixed(0));
