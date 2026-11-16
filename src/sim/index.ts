// Public surface of the simulation.

import type { SimConfig } from './config.ts';
import { SIM_PIPELINE } from './pipeline.ts';
import { createSim, loadSim } from './sim.ts';
import type { Sim } from './sim.ts';

export { canonicalJson, defaultConfig, validateConfig, worldHeightM, worldWidthM } from './config.ts';
export type { SimConfig } from './config.ts';
export { auditConserved, freshSpawnProblems, learnedContentProblems, nonFiniteProblems } from './core/audit.ts';
export * as clock from './core/clock.ts';
export * as dmath from './core/dmath.ts';
export { defineDial, defineDrive, definePrimitive, defineSystem } from './core/registry.ts';
export type { DialDef, DriveDef, PrimitiveDef, SystemDef, SystemSpec } from './core/registry.ts';
export { RECORDED_MATH_DIGESTS, arithmeticProblems, portableMathDigests } from './core/selfcheck.ts';
export { SIM_PIPELINE } from './pipeline.ts';
export { viewOf } from './readonly.ts';
export type { RoArray, SimView, StoreView } from './readonly.ts';
export { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim, SNAPSHOT_FORMAT } from './sim.ts';
export type { Sim, SimState, StatePart, StepProbe } from './sim.ts';

/** A new simulation at tick 0 running the real pipeline. */
export function createStandardSim(config: SimConfig): Sim {
  return createSim(config, SIM_PIPELINE);
}

/** Restore a snapshot that was taken from a simulation running the real pipeline. */
export function loadStandardSim(bytes: Uint8Array): Sim {
  return loadSim(bytes, SIM_PIPELINE);
}
