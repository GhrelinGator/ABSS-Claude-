// The anthropologist layer (docs/DESIGN.md §8). Observers look at the
// simulation through a read-only view and report numbers. They never write
// to it, and this is the only part of the codebase allowed to name social
// outcomes. Labels here are hypotheses about the data, not facts in the sim.

import type { SimView } from '../sim/readonly.ts';

export type Measurements = Record<string, number>;

export interface Observer {
  /** Short unique name; becomes the key of this observer's block in metrics output. */
  readonly name: string;
  observe(view: SimView): Measurements;
}
