// The fixed update order of the simulation: the systems that run each tick,
// first to last. Changing this list changes what every run means, so entries
// are added only by the roadmap phase that introduces them.
//
// Phase 0 has no systems. The kernel alone advances the clock.

import type { SystemDef } from './core/registry.ts';

export const SIM_PIPELINE: readonly SystemDef[] = Object.freeze([]);
