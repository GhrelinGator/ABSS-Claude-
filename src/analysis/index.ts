// Registry of observers, looked up by name from experiment specs.

import type { Observer } from './observer.ts';
import { census } from './observers/census.ts';

export type { Measurements, Observer } from './observer.ts';

const OBSERVERS: readonly Observer[] = [census];

export function observerNames(): string[] {
  return OBSERVERS.map((observer) => observer.name);
}

export function getObserver(name: string): Observer {
  const observer = OBSERVERS.find((candidate) => candidate.name === name);
  if (!observer) throw new Error(`Unknown observer "${name}". Known observers: ${observerNames().join(', ')}.`);
  return observer;
}
