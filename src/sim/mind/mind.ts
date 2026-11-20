// The mind system (docs/DESIGN.md §4.7.2, §4.9.4): each tick, first every agent that must choose looks
// and chooses, reading the state as the tick began (§1.6); then every agent's act runs, in an order
// drawn afresh each tick, so no agent has a standing first claim on what is left in a cell.

import type { Sink, Source } from '../core/codec.ts';
import { defineSystem } from '../core/registry.ts';
import type { SystemDef } from '../core/registry.ts';
import { STREAM_WORDS, StreamDomain, globalStreamOffset, nextInt } from '../core/rng.ts';
import type { Sim, SimState, StatePart } from '../sim.ts';
import { Sex, BODY_COLUMNS } from '../body/metabolism.ts';
import { Material, OBJECT_STORE } from '../world/materials.ts';
import { ACT_COLUMNS, ACT_TALLY_PART, Act, ActEnd, ActTally, createActs, declareActs } from './acts.ts';
import { CHOICE, Candidates, DEFAULT_CHOICE_DIALS, PREDICTION_LENGTH, choose, gatherCandidates, interrupts } from './choice.ts';
import { BLANK_PREDICTOR } from './choice.ts';
import type { Predictor } from './choice.ts';
import { CueKind, SELF_CUE, cue, materialClass } from './cues.ts';
import { CHANNELS, Channel, createInteroception } from './interoception.ts';
import { PERCEPTION, Percepts, createPerception, declarePerception } from './perception.ts';
import { createMemory, declareMemory } from './memory.ts';

export const MIND_PARTS = { acts: ACT_TALLY_PART } as const;

function actTally(): StatePart {
  const counts = new Float64Array(ActTally.LENGTH);
  return {
    name: MIND_PARTS.acts,
    holdsLearned: false,
    readings: () => counts,
    write(sink: Sink) {
      sink.array(counts);
    },
    read(source: Source) {
      const saved = source.array('f64');
      if (saved.length !== counts.length) throw new Error(`${MIND_PARTS.acts}: snapshot has the wrong length.`);
      counts.set(saved);
    },
  };
}

/**
 * Build the mind system with a given predictor factory: memory in the real pipeline (`mind` below), the
 * blank predictor for the random-policy baseline (`blankMind`), or a stand-in in tests.
 */
export function mindSystem(makePredictor: (sim: Sim) => Predictor): SystemDef {
  // ALIBI: an animal that feels its body, sees around it and does one thing at a time, chosen among what
  // it can do to what it sees, needs no other animal to do so (§4.7, §4.9).
  return defineSystem({
    name: 'mind',
    declare(state: SimState) {
      declarePerception(state);
      declareActs(state);
      declareMemory(state);
      state.addPart(actTally());
    },
    create(sim: Sim) {
      const { config, state } = sim;
      const agents = state.agents;
      const objects = state.store(OBJECT_STORE);
      const tallyPart = state.parts.find((p) => p.name === MIND_PARTS.acts);
      if (!tallyPart || !tallyPart.readings) throw new Error('mind: its tally is missing.');
      const tally = tallyPart.readings() as Float64Array;
      const perception = createPerception(sim);
      const intero = createInteroception(sim);
      const acts = createActs(sim, perception, tally);
      const predictor = makePredictor(sim);
      const ticksPerHour = Math.max(1, Math.round(config.time.ticksPerDay / 24));
      const look = new Percepts();
      const cands = new Candidates();
      const order = new Int32Array(Percepts.CAPACITY);
      const drives = new Float64Array(CHANNELS);
      const prediction = new Float64Array(PREDICTION_LENGTH);
      const heldIds = new Float64Array(2);
      const heldCues = new Uint32Array(2);
      let shuffle = new Int32Array(64);
      const resolve = globalStreamOffset(StreamDomain.RESOLVE);

      function heldCuesOf(slot: number): number {
        const n = acts.heldBy(slot, heldIds);
        const material = objects.column<Uint8Array>('material').data;
        const edge = objects.column<Float32Array>('edge').data;
        const length = objects.column<Float32Array>('length').data;
        for (let h = 0; h < n; h++) {
          const o = objects.slotOf(heldIds[h]);
          const m = material[o];
          const c = materialClass(m, m !== Material.WOOD && edge[o] >= PERCEPTION.edgedFrom, length[o] >= PERCEPTION.longWoodM);
          heldCues[h] = c >= 0 ? cue(CueKind.CLASS, c) : SELF_CUE;
        }
        return n;
      }

      function decide(slot: number): void {
        perception.perceive(slot, look);
        // The act that just ended is learned from before the next is chosen (§4.10.2).
        if (predictor.learn) predictor.learn(slot, look, drives, 0, intero.gutPain(slot));
        const heldN = heldCuesOf(slot);
        gatherCandidates(look, heldIds, heldCues, heldN, order, cands);
        if (predictor.recall) predictor.recall(slot, look, cands, drives, 0);
        predictor.begin(slot, look);
        const rng = agents.column<Uint32Array>('rng').data;
        const i = choose(cands, predictor, drives, 0, prediction, rng, slot * STREAM_WORDS, predictor.dials ?? DEFAULT_CHOICE_DIALS);
        acts.begin(slot, cands.act[i], cands.cue[i], cands.source[i], cands.ref[i], cands.x[i], cands.y[i], drives, 0);
        tally[ActTally.DECISIONS] += 1;
      }

      return () => {
        const tick = state.tick;
        intero.refresh();
        acts.refresh();
        if (predictor.refresh) predictor.refresh();
        const alive = agents.alive.data;
        const sex = agents.column<Uint8Array>(BODY_COLUMNS.sex.name).data;
        const kind = agents.column<Uint8Array>(ACT_COLUMNS.actKind.name).data;
        const end = agents.column<Uint8Array>(ACT_COLUMNS.actEnd.name).data;
        const started = agents.column<Float64Array>(ACT_COLUMNS.actStart.name).data;
        const before = agents.column<Float32Array>(ACT_COLUMNS.actDrives.name).data;

        // What a dead body held drops where it lay.
        if (objects.count > 0) {
          const holder = objects.column<Uint32Array>('holder').data;
          for (let o = 0; o < objects.highWater; o++) {
            if (objects.alive.data[o] === 1 && holder[o] !== 0 && agents.slotOf(holder[o]) < 0) holder[o] = 0;
          }
        }

        // 1. Decide, from the state as the tick began.
        const onTheHour = tick % ticksPerHour === 0;
        let n = 0;
        for (let slot = 0; slot < agents.highWater; slot++) {
          if (alive[slot] !== 1 || sex[slot] === Sex.NONE) continue;
          if (n === shuffle.length) {
            const grown = new Int32Array(shuffle.length * 2);
            grown.set(shuffle);
            shuffle = grown;
          }
          shuffle[n++] = slot;
          intero.read(slot, drives, 0);
          const k = kind[slot];
          const asleep = k === Act.SLEEP && end[slot] === ActEnd.GOING;
          if (!asleep) tally[ActTally.AWAKE_TICKS] += 1;
          if (k === Act.NONE || end[slot] !== ActEnd.GOING) {
            decide(slot);
            continue;
          }
          if (tick - started[slot] >= acts.limitTicks(k)) {
            decide(slot);
            continue;
          }
          const woken = asleep
            ? drives[Channel.PAIN] - before[slot * CHANNELS + Channel.PAIN] > 0.1 || (onTheHour && interrupts(before, slot * CHANNELS, drives, 0))
            : interrupts(before, slot * CHANNELS, drives, 0);
          if (woken) {
            tally[ActTally.INTERRUPTS] += 1;
            decide(slot);
          }
        }

        // 2. Act, in an order drawn afresh each tick (§1.6).
        const s = state.streams;
        for (let i = n - 1; i > 0; i--) {
          const j = nextInt(s, resolve, i + 1);
          const t = shuffle[i];
          shuffle[i] = shuffle[j];
          shuffle[j] = t;
        }
        for (let i = 0; i < n; i++) {
          const slot = shuffle[i];
          if (alive[slot] === 1) acts.run(slot);
        }
      };
    },
  });
}

/** The mind system of the real pipeline: it learns (§4.10). */
export const mind: SystemDef = mindSystem(createMemory);

/** The same mind with a predictor that never learns: the random-policy baseline (§4.9, §7.1). */
export const blankMind: SystemDef = mindSystem(() => BLANK_PREDICTOR);

export { CHOICE };
