// The course of a life, as pure functions of age (docs/DESIGN.md §3.5, §3.12):
// the frame curve a body grows along and shrinks along, what age takes from
// capacity, strength and skill after their peak, and the age at which a body
// dies of old age. Ages are compressed years (§1.1). Nothing here holds state.

import { exp, log } from '../core/dmath.ts';

/** Every number of the life course, in one place. Estimates unless a source is named (docs/RESEARCH.md). */
export const LIFECOURSE = {
  /**
   * The frame curve: share of the adult frame (built lean mass less trained muscle) by age, as
   * [age in years, share] points, interpolated linearly and flat beyond the last. Growth after the
   * foragers of Walker et al. (2006); the loss after 35 is an estimate (sarcopenia, as remembered).
   */
  frameFemale: [
    [0, 0.075], [1, 0.19], [2, 0.24], [5, 0.32], [10, 0.43], [13, 0.55], [15, 0.72], [18, 0.93],
    [20, 1], [35, 1], [50, 0.96], [65, 0.9], [80, 0.82], [100, 0.7],
  ] as ReadonlyArray<readonly [number, number]>,
  frameMale: [
    [0, 0.065], [1, 0.18], [2, 0.23], [5, 0.31], [10, 0.42], [13, 0.52], [15, 0.62], [18, 0.84],
    [20, 0.95], [22, 1], [35, 1], [50, 0.96], [65, 0.9], [80, 0.82], [100, 0.7],
  ] as ReadonlyArray<readonly [number, number]>,
  /** A body grows only while younger than this (years); from then on its frame can only shrink. */
  growthEndsYears: 25,
  /** Time constant of growing toward the curve, days, and of shrinking toward it. */
  growthDays: 2,
  shrinkDays: 20,
  /** Growth never takes fat below this share of body mass. */
  growthKeepsFatShare: 0.01,
  /** What age leaves of capacity, of strength (on top of the frame's loss) and of skill: [age, factor] points. */
  capacityByAge: [[30, 1], [80, 0.65], [100, 0.5]] as ReadonlyArray<readonly [number, number]>,
  strengthByAge: [[40, 1], [80, 0.72], [100, 0.58]] as ReadonlyArray<readonly [number, number]>,
  skillByAge: [[50, 1], [80, 0.8], [100, 0.6]] as ReadonlyArray<readonly [number, number]>,
  /**
   * The hazard of dying of old age, per year: oldAgeA × e^(oldAgeB × age). The senescent (Gompertz)
   * term of the Siler model Gurven & Kaplan (2007, Table 2) fitted to the average of five forager
   * populations: 1.47 × 10⁻⁴ and 0.086 (the rate doubles every 8.1 years).
   */
  oldAgeA: 1.47e-4,
  oldAgeB: 0.086,
} as const;
const K = LIFECOURSE;

/** Linear interpolation in a table of [x, y] points, flat beyond its ends. */
function interpolate(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const hi = points[i];
    if (x <= hi[0]) {
      const lo = points[i - 1];
      return lo[1] + ((hi[1] - lo[1]) * (x - lo[0])) / (hi[0] - lo[0]);
    }
  }
  return points[points.length - 1][1];
}

/** The frame curve: the share of its adult frame a body of this sex (1 female, 2 male) has at this age. */
export function frameShare(sex: number, ageYears: number): number {
  return interpolate(sex === 1 ? K.frameFemale : K.frameMale, ageYears);
}

/** What age leaves of a body's capacity for sustained work (§3.11). */
export function capacityAtAge(ageYears: number): number {
  return interpolate(K.capacityByAge, ageYears);
}

/** What age leaves of a body's strength, on top of what the shrinking frame takes. */
export function strengthAtAge(ageYears: number): number {
  return interpolate(K.strengthByAge, ageYears);
}

/** What age leaves of a skill's expression (§3.11). */
export function skillAtAge(ageYears: number): number {
  return interpolate(K.skillByAge, ageYears);
}

/** The hazard of dying of old age at this age, per year. */
export function oldAgeHazard(ageYears: number): number {
  return K.oldAgeA * exp(K.oldAgeB * ageYears);
}

/**
 * The age at which a body now `ageYears` old dies of old age, given a unit exponential draw `reserve`:
 * where the hazard accumulated since `ageYears` reaches the reserve. Exactly a per-tick hazard of
 * oldAgeHazard, with one draw per body.
 */
export function oldAgeDeathAge(ageYears: number, reserve: number): number {
  const b = K.oldAgeB;
  return log(exp(b * ageYears) + (b * reserve) / K.oldAgeA) / b;
}
