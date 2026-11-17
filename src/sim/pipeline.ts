// The fixed update order of the simulation: the systems that run each tick,
// first to last. Changing this list changes what every run means, so entries
// are added only by the roadmap phase that introduces them.

import type { SystemDef } from './core/registry.ts';
import { climate } from './world/climate.ts';
import { animals } from './world/animals.ts';
import { materials } from './world/materials.ts';
import { pathogens } from './world/pathogens.ts';
import { plants } from './world/plants.ts';
import { terrain } from './world/terrain.ts';

export const SIM_PIPELINE: readonly SystemDef[] = Object.freeze([
  // Phase 1.1: the landscape, built once before tick 0.
  terrain,
  // Phase 1.2: weather, storms, lightning, soil moisture.
  climate,
  // Phase 1.4: eight plant species growing, fruiting, spreading, dying back.
  plants,
  // Phase 1.5: grazers, predators, scavengers, carcasses.
  animals,
  // Phase 1.6: pathogens in standing water and rotting meat.
  pathogens,
  // Phase 1.7: loose stone and fallen wood, rock shelters, objects and what striking them does.
  materials,
]);
