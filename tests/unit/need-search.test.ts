// Search under need and restlessness (docs/DESIGN.md §4.15.1–§4.15.3, the owner's answer to Q14, D-061):
// the bonus for uncertainty is (curiosity + needCuriosity × the unmet need) × √v, and a walk on a heading
// gains restlessness × the more pressing intake drive, squared. Both dials are on the genome, neutral at 0,
// and at 0 choice is exactly what it was.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GENE_DIALS } from '../../src/sim/body/genetics.ts';
import { Act } from '../../src/sim/mind/acts.ts';
import { BLANK_PREDICTOR, CHOICE, Candidates, DEFAULT_CHOICE_DIALS, PREDICTION_LENGTH, choose, restlessWorth, unmetNeed, valueOf } from '../../src/sim/mind/choice.ts';
import type { ChoiceDials, Predictor } from '../../src/sim/mind/choice.ts';
import { CueKind, SELF_CUE, cue } from '../../src/sim/mind/cues.ts';
import { MIND_DIAL_DEFAULTS, NEED_CURIOSITY, RESTLESSNESS } from '../../src/sim/mind/dials.ts';
import { CHANNELS, Channel } from '../../src/sim/mind/interoception.ts';
import { STREAM_WORDS } from '../../src/sim/core/rng.ts';

const KNOWN = cue(CueKind.CLASS, 1);
const UNTRIED = cue(CueKind.CLASS, 2);
const OTHER = cue(CueKind.CLASS, 3);

/** A predictor that knows one thing: acting on KNOWN lowers hunger by `relief`, with little spread. */
function stub(relief: number, knownVariance = 0.0001): Predictor {
  return {
    begin() {},
    predict(c, _act, _distM, out) {
      for (let ch = 0; ch < CHANNELS; ch++) out[ch] = 0;
      out[CHANNELS + 1] = 0;
      if (c === KNOWN) {
        out[Channel.HUNGER] = -relief;
        out[CHANNELS] = knownVariance;
      } else {
        out[CHANNELS] = CHOICE.priorVariance;
      }
    },
  };
}

function candidates(): Candidates {
  const cands = new Candidates();
  cands.add(Act.CONSUME, KNOWN, 0, 0, 0, 0, 0);
  cands.add(Act.CONSUME, UNTRIED, 0, 0, 0, 0, 0);
  cands.add(Act.APPROACH, OTHER, 0, 0, 0, 0, 0);
  cands.add(Act.EXPLORE, SELF_CUE, 0, 0, 0, 0, 0);
  return cands;
}

function drives(values: Partial<Record<keyof typeof Channel, number>>): Float64Array {
  const d = new Float64Array(CHANNELS);
  for (const [name, v] of Object.entries(values)) d[Channel[name as keyof typeof Channel]] = v as number;
  return d;
}

/** Values recovered from the softmax weights at temperature 1: log(w_i ÷ w_0) = V_i − V_0. */
function valuesAgainstFirst(cands: Candidates, predictor: Predictor, d: Float64Array, dials: ChoiceDials): number[] {
  const rng = new Uint32Array(STREAM_WORDS);
  rng[0] = 1;
  choose(cands, predictor, d, 0, new Float64Array(PREDICTION_LENGTH), rng, 0, dials);
  const out: number[] = [];
  for (let i = 0; i < cands.n; i++) out.push(Math.log(cands.value[i] / cands.value[0]));
  return out;
}

const dials = (needCuriosity: number, restlessness: number, curiosity = 0): ChoiceDials => ({
  curiosity,
  explorationTemperature: 1,
  riskTolerance: 0,
  needCuriosity,
  restlessness,
});

test('the unmet need is the most pressing drive less the most any candidate is predicted to relieve it', () => {
  const n = 3;
  const pred = new Float64Array(n * CHANNELS);
  pred[0 * CHANNELS + Channel.HUNGER] = -0.3;
  pred[1 * CHANNELS + Channel.HUNGER] = -0.1;
  pred[2 * CHANNELS + Channel.PAIN] = 0.2; // a harm relieves nothing
  assert.ok(Math.abs(unmetNeed(drives({ HUNGER: 0.8 }), 0, pred, n) - 0.5) < 1e-12);
  // Cold that nothing is known to relieve is the larger unmet need.
  assert.ok(Math.abs(unmetNeed(drives({ HUNGER: 0.8, COLD: 0.6 }), 0, pred, n) - 0.6) < 1e-12);
  // Relief is counted at most to the drive: a full relief leaves nothing unmet.
  pred[0 * CHANNELS + Channel.HUNGER] = -1.5;
  assert.equal(unmetNeed(drives({ HUNGER: 0.8 }), 0, pred, n), 0);
});

test('an untried act gains needCuriosity × the unmet need × √v, a well-known one almost nothing', () => {
  const d = drives({ HUNGER: 0.8 });
  const base = valuesAgainstFirst(candidates(), stub(0.3), d, dials(0, 0));
  const withNeed = valuesAgainstFirst(candidates(), stub(0.3), d, dials(1, 0));
  // Known: 0.64 − 0.25 = 0.39, plus 1 × 0.5 × 0.01 with the need; untried: 0, plus 1 × 0.5 × 0.2.
  assert.ok(Math.abs(base[1] - -0.39) < 1e-9, `untried against known without the dial: ${base[1]}`);
  assert.ok(Math.abs(withNeed[1] - (0.5 * 0.2 - (0.39 + 0.5 * 0.01))) < 1e-9, `with it: ${withNeed[1]}`);
  // When the known act relieves the drive fully, nothing is unmet and nothing is gained.
  const relieved = valuesAgainstFirst(candidates(), stub(0.8), d, dials(1, 0));
  const relievedBase = valuesAgainstFirst(candidates(), stub(0.8), d, dials(0, 0));
  assert.ok(Math.abs(relieved[1] - relievedBase[1]) < 1e-12);
});

test('restlessness adds r × the more pressing intake drive, squared, to explore and nothing else; not for pain or cold', () => {
  assert.ok(Math.abs(restlessWorth(drives({ HUNGER: 0.6, THIRST: 0.7 }), 0, 0.5) - 0.5 * 0.49) < 1e-12);
  assert.equal(restlessWorth(drives({ PAIN: 0.9, COLD: 0.9 }), 0, 0.5), 0);
  const d = drives({ THIRST: 0.7 });
  const base = valuesAgainstFirst(candidates(), stub(0), d, dials(0, 0));
  const restless = valuesAgainstFirst(candidates(), stub(0), d, dials(0, 0.5));
  assert.ok(Math.abs(restless[3] - base[3] - 0.5 * 0.49) < 1e-9, 'explore gains it');
  assert.ok(Math.abs(restless[1] - base[1]) < 1e-12 && Math.abs(restless[2] - base[2]) < 1e-12, 'nothing else does');
});

test('at needCuriosity and restlessness 0 every value is exactly what valueOf gives; the blank predictor stays uniform', () => {
  const d = drives({ HUNGER: 0.7, COLD: 0.4, PAIN: 0.2 });
  const cands = candidates();
  const p = stub(0.2, 0.003);
  const scratch = new Float64Array(PREDICTION_LENGTH);
  const expected: number[] = [];
  for (let i = 0; i < cands.n; i++) {
    p.predict(cands.cue[i], cands.act[i], 0, scratch);
    expected.push(valueOf(d, 0, scratch, 0.3, 0));
  }
  const got = valuesAgainstFirst(cands, p, d, dials(0, 0, 0.3));
  for (let i = 1; i < cands.n; i++) assert.ok(Math.abs(got[i] - (expected[i] - expected[0])) < 1e-12);
  // The blank predictor reads the default dials: every candidate alike.
  assert.equal(DEFAULT_CHOICE_DIALS.needCuriosity, 0);
  assert.equal(DEFAULT_CHOICE_DIALS.restlessness, 0);
  const blank = candidates();
  const rng = new Uint32Array(STREAM_WORDS);
  rng[0] = 7;
  choose(blank, BLANK_PREDICTOR, d, 0, scratch, rng, 0);
  for (let i = 0; i < blank.n; i++) assert.equal(blank.value[i], 1);
});

test('both dials are on the genome, neutral at 0, founders drawn wide from 0 up (§4.15.3)', () => {
  const need = GENE_DIALS.find((g) => g.dial === NEED_CURIOSITY);
  const rest = GENE_DIALS.find((g) => g.dial === RESTLESSNESS);
  assert.ok(need && rest);
  assert.deepEqual([need.dial.min, need.dial.max, need.dial.neutral, need.foundersFrom, need.foundersTo], [0, 4, 0, 0, 2]);
  assert.deepEqual([rest.dial.min, rest.dial.max, rest.dial.neutral, rest.foundersFrom, rest.foundersTo], [0, 2, 0, 0, 0.5]);
  assert.equal(MIND_DIAL_DEFAULTS.needCuriosity, 0);
  assert.equal(MIND_DIAL_DEFAULTS.restlessness, 0);
});
