// Choosing (docs/DESIGN.md §4.7.10, §4.9.5, §4.10.5): the candidates physics allows, each valued by the
// change in the drive channels its predictions say it brings, weighed by the drives as they are now, and
// a softmax over them. Predictions come through one interface: the blank predictor has learned nothing,
// so every candidate is valued alike (the random-policy baseline); memory (3.4) is the real one.

import { exp } from '../core/dmath.ts';
import { nextFloat } from '../core/rng.ts';
import { ACTS, Act } from './acts.ts';
import { CHANNELS, Channel } from './interoception.ts';
import { ClassKind, CueKind, classKind, cueKind, cuePayload, SELF_CUE } from './cues.ts';
import { PerceptSource } from './perception.ts';
import type { Percepts } from './perception.ts';

export const CHOICE = {
  /** Percepts considered, nearest first, and the most of them that may be persons [provisional]. */
  percepts: 24,
  persons: 4,
  /** Most candidates (§4.9.5). */
  most: 96,
  /** The choosing dials of a mind with no genome, and of the blank predictor (§4.7.10's toy values; 3.4 puts them on the genome) [provisional]. */
  curiosity: 0.3,
  explorationTemperature: 0.01,
  riskTolerance: 0,
  /** Prior variance of a key no experience has touched (§4.7.6). */
  priorVariance: 0.04,
} as const;
const K = CHOICE;

/** What a predictor writes: the predicted change in each channel, then v and σ²_pain. */
export const PREDICTION_LENGTH = CHANNELS + 2;

/** The dials a choice reads (§4.7.10, §4.10.6). */
export interface ChoiceDials {
  curiosity: number;
  explorationTemperature: number;
  riskTolerance: number;
}
export const DEFAULT_CHOICE_DIALS: Readonly<ChoiceDials> = Object.freeze({
  curiosity: K.curiosity,
  explorationTemperature: K.explorationTemperature,
  riskTolerance: K.riskTolerance,
});

/** Where a mind's predictions come from (§4.7.5–§4.7.9, §4.10). */
export interface Predictor {
  /** Fetch whatever it reads afresh: once a tick, before any agent decides. */
  refresh?(): void;
  /** Learn from agent `slot`'s act that just ended, before it chooses again (§4.10.2). */
  learn?(slot: number, look: Percepts, drives: Float64Array, offset: number): void;
  /** Add remembered things to the candidates, by their worth to drives `drives` (from `offset`) (§4.10.4). */
  recall?(slot: number, look: Percepts, cands: Candidates, drives: Float64Array, offset: number): void;
  /** A choice is about to be valued by agent `slot`, in the context of this look. */
  begin(slot: number, look: Percepts): void;
  /**
   * Predict for act `act` on cue `c` (with the trip of `distM`; `there`, a place cue, if the thing is
   * remembered elsewhere): changes in `out[0..7]`, v in `out[8]`, σ²_pain in `out[9]`.
   */
  predict(c: number, act: number, distM: number, out: Float64Array, there?: number): void;
  /** The choosing dials of the agent last begun; the defaults if absent. */
  readonly dials?: ChoiceDials;
}

/** A predictor that has learned nothing (3.3): no change expected, prior uncertainty everywhere. */
export const BLANK_PREDICTOR: Predictor = {
  begin() {},
  predict(_c, _act, _distM, out) {
    for (let ch = 0; ch < CHANNELS; ch++) out[ch] = 0;
    out[CHANNELS] = K.priorVariance;
    out[CHANNELS + 1] = 0;
  },
};

/** Value of a predicted outcome for drives `d` (from `offset`), §4.7.10. */
export function valueOf(d: Float64Array, offset: number, p: Float64Array, curiosity: number, riskTolerance: number): number {
  let v = 0;
  for (let ch = 0; ch < CHANNELS; ch++) {
    const now = d[offset + ch];
    let next = now + p[ch];
    if (next < 0) next = 0;
    else if (next > 1) next = 1;
    v += now * now - next * next;
  }
  const variance = p[CHANNELS] > 0 ? p[CHANNELS] : 0;
  return v - (1 - riskTolerance) * p[CHANNELS + 1] + curiosity * Math.sqrt(variance);
}

/** The candidates of one choice. */
export class Candidates {
  n = 0;
  readonly act = new Uint8Array(K.most);
  readonly cue = new Uint32Array(K.most);
  readonly source = new Uint8Array(K.most);
  readonly ref = new Float64Array(K.most);
  readonly x = new Float64Array(K.most);
  readonly y = new Float64Array(K.most);
  readonly dist = new Float64Array(K.most);
  /** For a remembered thing, the place cue where it was (§4.10.4); 0 for what is seen. */
  readonly place = new Uint32Array(K.most);
  readonly value = new Float64Array(K.most);

  add(act: number, c: number, source: number, ref: number, x: number, y: number, dist: number, place = 0): void {
    if (this.n >= K.most) return;
    const i = this.n++;
    this.act[i] = act;
    this.cue[i] = c;
    this.source[i] = source;
    this.ref[i] = ref;
    this.x[i] = x;
    this.y[i] = y;
    this.dist[i] = dist;
    this.place[i] = place;
  }
}

/**
 * Fill `out` with what physics allows (§4.9.5): the nearest percepts with their acts, the held objects'
 * acts, rest, sleep and explore. `heldIds` and `heldCues` are the objects in hand and how they look.
 */
export function gatherCandidates(look: Percepts, heldIds: Float64Array, heldCues: Uint32Array, heldN: number, order: Int32Array, out: Candidates): void {
  out.n = 0;
  // The nearest percepts first (insertion sort of their indices by distance, ties by index).
  const n = look.n;
  for (let i = 0; i < n; i++) {
    let j = i;
    while (j > 0 && look.dist[order[j - 1]] > look.dist[i]) {
      order[j] = order[j - 1];
      j--;
    }
    order[j] = i;
  }
  let taken = 0;
  let persons = 0;
  for (let q = 0; q < n && taken < K.percepts; q++) {
    const i = order[q];
    const c = look.cue[i];
    const src = look.source[i];
    const x = look.x[i];
    const y = look.y[i];
    const d = look.dist[i];
    const ref = look.ref[i];
    const ck = cueKind(c);
    const kind = ck === CueKind.CLASS ? classKind(cuePayload(c)) : ck === CueKind.INDIVIDUAL ? ClassKind.FIGURE : 0;
    if (kind === 0) continue;
    if (kind === ClassKind.FIGURE) {
      if (persons >= K.persons) continue;
      persons++;
    }
    taken++;
    switch (kind) {
      case ClassKind.PLANT:
      case ClassKind.CARCASS:
      case ClassKind.WATER:
        out.add(Act.CONSUME, c, src, ref, x, y, d);
        break;
      case ClassKind.STONE:
      case ClassKind.WOOD:
      case ClassKind.HIDE:
        // A thing can be taken up only into a free hand (3.4: offered with both hands full, it could only fail).
        if (heldN < ACTS.hands) out.add(Act.PICK_UP, c, src, ref, x, y, d);
        if (src === PerceptSource.OBJECT && heldN > 0) out.add(Act.STRIKE, c, src, ref, x, y, d);
        break;
      case ClassKind.ANIMAL:
        // A deer, aurochs, wolf or big cat can be struck with something held (§2.17).
        if (src === PerceptSource.ANIMAL && heldN > 0) out.add(Act.STRIKE, c, src, ref, x, y, d);
        break;
      default:
        break;
    }
    out.add(Act.APPROACH, c, src, ref, x, y, d);
    out.add(Act.AVOID, c, src, ref, x, y, d);
  }
  for (let h = 0; h < heldN; h++) out.add(Act.DROP, heldCues[h], PerceptSource.OBJECT, heldIds[h], 0, 0, 0);
  if (heldN >= 2) out.add(Act.MANIPULATE, heldCues[0], PerceptSource.OBJECT, heldIds[0], 0, 0, 0);
  out.add(Act.REST, SELF_CUE, 0, 0, 0, 0, 0);
  out.add(Act.SLEEP, SELF_CUE, 0, 0, 0, 0, 0);
  out.add(Act.EXPLORE, SELF_CUE, 0, 0, 0, 0, 0);
}

/**
 * Value every candidate with `predictor` for drives `d` (from `offset`) and draw one by softmax from the
 * agent's stream (`s`, `o`), with the agent's choosing dials. Returns its index.
 */
export function choose(
  cands: Candidates,
  predictor: Predictor,
  d: Float64Array,
  offset: number,
  scratch: Float64Array,
  s: Uint32Array,
  o: number,
  dials: Readonly<ChoiceDials> = DEFAULT_CHOICE_DIALS,
): number {
  const n = cands.n;
  let best = -Infinity;
  for (let i = 0; i < n; i++) {
    predictor.predict(cands.cue[i], cands.act[i], cands.dist[i], scratch, cands.place[i]);
    const v = valueOf(d, offset, scratch, dials.curiosity, dials.riskTolerance);
    cands.value[i] = v;
    if (v > best) best = v;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    // exp(0) is exactly 1, and below e^-37 a weight is under half the rounding step of a sum of at least
    // 1 (the best's own weight): skipping exp for both changes nothing but the time.
    const z = (cands.value[i] - best) / dials.explorationTemperature;
    const w = z === 0 ? 1 : z < -37 ? 0 : exp(z);
    cands.value[i] = w;
    sum += w;
  }
  let r = nextFloat(s, o) * sum;
  for (let i = 0; i < n; i++) {
    r -= cands.value[i];
    if (r < 0) return i;
  }
  return n - 1;
}

/** Channels whose crossing into their top fifth interrupts an act (§4.7.2). */
export const INTERRUPT = { painRise: 0.1, driveHigh: 0.8 } as const;

/** Does going from drives `before` to `now` interrupt an act (§4.7.2, §4.9.4)? */
export function interrupts(before: Float32Array, bOff: number, now: Float64Array, nOff: number): boolean {
  if (now[nOff + Channel.PAIN] - before[bOff + Channel.PAIN] > INTERRUPT.painRise) return true;
  for (let ch = 0; ch < CHANNELS; ch++) {
    if (now[nOff + ch] >= INTERRUPT.driveHigh && before[bOff + ch] < INTERRUPT.driveHigh) return true;
  }
  return false;
}
