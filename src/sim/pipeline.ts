// The fixed update order of the simulation: the systems that run each tick,
// first to last. Changing this list changes what every run means, so entries
// are added only by the roadmap phase that introduces them.

import type { SystemDef } from './core/registry.ts';
import { terrain } from './world/terrain.ts';

export const SIM_PIPELINE: readonly SystemDef[] = Object.freeze([
  // Phase 1.1: the landscape, built once before tick 0.
  terrain,
]);
