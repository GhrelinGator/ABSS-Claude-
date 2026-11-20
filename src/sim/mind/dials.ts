// The mind's heritable dials (docs/DESIGN.md §4.7, §4.10.6): parameters of the faculties that learn and
// choose, carried on the genome like the body's dials (body/genetics.ts, D-047). Each can be taken by
// evolution to the value at which it does nothing. None is a drive, and none favours anything done
// with or to another agent.

import { defineDial } from '../core/registry.ts';
import type { DialDef } from '../core/registry.ts';

// ALIBI: how far one experience moves what an animal expects is a property of its nervous system; a mind
// that moves too far chases noise and one that moves too little misses change, whether or not any
// other animal exists. Multiplies the prior variance and its regrowth (§4.7.6).
export const LEARNING_RATE: DialDef = defineDial({ name: 'learningRate', min: 0, max: 4, neutral: 0 });

// ALIBI: what eating a plant or standing in a place brings can arrive hours later (plant poisons, §2.7)
// in a world with no one else in it; a longer memory of what was done catches slower consequences and
// more coincidences. Half-life of eligibility, hours (§4.7.7).
export const TRACE_HALF_LIFE: DialDef = defineDial({ name: 'traceHalfLife', min: 0, max: 12, neutral: 0 });

// ALIBI: an animal that tries what it has not tried finds food and water it would otherwise never find,
// and pays for it in time and harm, with or without any other animal (§4.2). Weight of the bonus for
// uncertainty (§4.7.10).
export const CURIOSITY: DialDef = defineDial({ name: 'curiosity', min: 0, max: 2, neutral: 0 });

// ALIBI: an animal that always does what it expects to be best never learns that it was wrong, and one
// that ignores what it expects wastes what it learned; how much chance enters a choice matters in any
// changing world. Softmax temperature (§4.7.10); at its top, choice almost ignores value.
export const EXPLORATION_TEMPERATURE: DialDef = defineDial({ name: 'explorationTemperature', min: 0.001, max: 1, neutral: 1 });

// ALIBI: the same mean harm can come as a steady small cost or a rare large one, and how much the spread
// counts weighs survival against gain whether or not any group ever forms. At 0 the spread of pain is
// counted exactly as the quadratic drive cost expects it (§4.10.2).
export const RISK_TOLERANCE: DialDef = defineDial({ name: 'riskTolerance', min: -1, max: 1, neutral: 0 });

/** The values a mind uses when its body carries no genome (a pipeline without body.genetics): the toy's (§4.10.6). */
export const MIND_DIAL_DEFAULTS = {
  learningRate: 1,
  traceHalfLife: 1,
  curiosity: 0.3,
  explorationTemperature: 0.01,
  riskTolerance: 0,
} as const;
