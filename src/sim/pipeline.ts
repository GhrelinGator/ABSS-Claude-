// The fixed update order of the simulation: the systems that run each tick,
// first to last. Changing this list changes what every run means, so entries
// are added only by the roadmap phase that introduces them.

import type { SystemDef } from './core/registry.ts';
import { aging } from './body/aging.ts';
import { exposure } from './body/exposure.ts';
import { fitness } from './body/fitness.ts';
import { heat } from './body/heat.ts';
import { injury } from './body/injury.ts';
import { metabolism } from './body/metabolism.ts';
import { climate } from './world/climate.ts';
import { animals } from './world/animals.ts';
import { fire } from './world/fire.ts';
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
  // Phase 1.8: lightning and other ignitions, fire spreading, smouldering, burning objects.
  fire,
  // Systems that make agents act (Phase 3 on) go here, before the bodies, so each body is
  // exposed where it ended its acts and charged for what it did in the same tick.
  // Phase 2.2: what each body is in, read from the world at its position.
  exposure,
  // Phase 2.3: wounds, bleeding, broken bones, burns, lightning, infections, healing.
  injury,
  // Phase 2.2: body temperature, shivering and sweat, body water.
  heat,
  // Phase 2.1: what agents' bodies spend, store and starve on.
  metabolism,
  // Phase 2.4: fitness and fatigue from the tick's exertion, strains, trained muscle (skills are kept here too).
  fitness,
  // Phase 2.5: growth along the frame curve, shrinking with age, death by old age.
  aging,
]);
