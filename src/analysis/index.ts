// Registry of observers, looked up by name from experiment specs.

import type { Observer } from './observer.ts';
import { bodies } from './observers/bodies.ts';
import { census } from './observers/census.ts';
import { landscape } from './observers/landscape.ts';
import { fauna } from './observers/fauna.ts';
import { fire } from './observers/fire.ts';
import { materials } from './observers/materials.ts';
import { pathogens } from './observers/pathogens.ts';
import { vegetation } from './observers/vegetation.ts';
import { weather } from './observers/weather.ts';

export type { Measurements, Observer } from './observer.ts';
export { HABITABLE, summarizeLandscape } from './observers/landscape.ts';
export type { LandscapeSummary } from './observers/landscape.ts';

const OBSERVERS: readonly Observer[] = [census, landscape, weather, vegetation, fauna, pathogens, materials, fire, bodies];

export function observerNames(): string[] {
  return OBSERVERS.map((observer) => observer.name);
}

export function getObserver(name: string): Observer {
  const observer = OBSERVERS.find((candidate) => candidate.name === name);
  if (!observer) throw new Error(`Unknown observer "${name}". Known observers: ${observerNames().join(', ')}.`);
  return observer;
}
