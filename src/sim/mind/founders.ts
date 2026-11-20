// Founders (docs/DESIGN.md §4.9.6): the first agents, placed at tick 0, the spring equinox, near
// flowing water, each at an independent point of a disc, with adult bodies conditioned to a forager's
// working life and blank minds. Every choice here is about bodies, not behaviour, and none was tuned.

import { cosTurn, sinTurn } from '../core/dmath.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { StreamDomain, globalStreamOffset, nextFloat, nextInt } from '../core/rng.ts';
import { spawnAgent } from '../sim.ts';
import type { Sim } from '../sim.ts';
import { GENETICS_COLUMNS, formGenome } from '../body/genetics.ts';
import { Sex, formBody } from '../body/metabolism.ts';
import type { BodySpec } from '../body/metabolism.ts';
import { TERRAIN_LAYERS, Water } from '../world/terrain.ts';

export const FOUNDERS = {
  /** The centre is within this distance of flowing water, m. */
  nearWaterM: 300,
  /** Ages, years, drawn uniformly. */
  youngestYears: 18,
  oldestYears: 35,
  /**
   * Hadza-like bodies (Pontzer et al. 2012, from memory; the same as §3.8's fixtures): lean and fat, kg,
   * by sex; and the daily load a forager's working life conditioned them to, load-hours (D-043).
   */
  man: { leanKg: 44.0, fatKg: 6.9 },
  woman: { leanKg: 34.0, fatKg: 9.0 },
  conditionedTo: 8,
  /** Draws of a point before giving up. */
  tries: 1000,
} as const;
const K = FOUNDERS;

/** Place the founders the config asks for (none without `config.founders`). Returns their slots. */
export function placeFounders(sim: Sim): number[] {
  const { config, state } = sim;
  const want = config.founders;
  if (!want || want.count === 0) return [];
  const { widthCells: W, heightCells: H, cellSizeM: cs } = config.world;
  const water = state.world.layer<Uint8Array>(TERRAIN_LAYERS.waterKind);
  const s = state.streams;
  const o = globalStreamOffset(StreamDomain.FOUNDERS);

  // Land cells within reach of a river or a spring.
  const r = Math.ceil(K.nearWaterM / cs);
  const near = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (water[k] !== Water.RIVER && water[k] !== Water.SPRING) continue;
    const i0 = k % W;
    const j0 = (k - i0) / W;
    for (let dj = -r; dj <= r; dj++) {
      const j = j0 + dj;
      if (j < 0 || j >= H) continue;
      for (let di = -r; di <= r; di++) {
        const i = i0 + di;
        if (i < 0 || i >= W || (di * di + dj * dj) * cs * cs > K.nearWaterM * K.nearWaterM) continue;
        if (water[j * W + i] !== Water.LAKE) near[j * W + i] = 1;
      }
    }
  }
  const cells: number[] = [];
  for (let k = 0; k < W * H; k++) if (near[k] === 1) cells.push(k);
  if (cells.length === 0) throw new Error('Founders: the map has no land near flowing water.');
  const centre = cells[nextInt(s, o, cells.length)];
  const ci = centre % W;
  const cx = (ci + 0.5) * cs;
  const cy = ((centre - ci) / W + 0.5) * cs;

  const slots: number[] = [];
  const genomes = state.agents.hasColumn(GENETICS_COLUMNS.genomeFormed.name);
  for (let n = 0; n < want.count; n++) {
    let x = -1;
    let y = -1;
    for (let t = 0; ; t++) {
      if (t >= K.tries) throw new Error('Founders: no dry point found in the founding disc.');
      const rr = want.radiusM * Math.sqrt(nextFloat(s, o));
      const u = nextFloat(s, o);
      x = cx + rr * cosTurn(u);
      y = cy + rr * sinTurn(u);
      if (x < 0 || y < 0 || x >= W * cs || y >= H * cs) continue;
      const k = Math.floor(y / cs) * W + Math.floor(x / cs);
      if (water[k] !== Water.LAKE) break;
    }
    const female = nextFloat(s, o) < 0.5;
    const age = K.youngestYears + (K.oldestYears - K.youngestYears) * nextFloat(s, o);
    const size = female ? K.woman : K.man;
    const spec: BodySpec = {
      sex: female ? Sex.FEMALE : Sex.MALE,
      ageYears: age,
      leanKg: size.leanKg,
      fatKg: size.fatKg,
      conditionedTo: K.conditionedTo,
    };
    const slot = spawnAgent(sim, x, y);
    formBody(sim, slot, spec);
    if (genomes) formGenome(sim, slot);
    slots.push(slot);
  }
  return slots;
}

// ALIBI: a population has to begin somewhere: adult bodies, where water is, in the mildest season,
// spread independently over an area with nothing built and nothing known (§4.9.6).
export const founders: SystemDef = defineSystem({
  name: 'founders',
  create(sim: Sim) {
    return () => {
      if (sim.state.tick === 0) placeFounders(sim);
    };
  },
});
