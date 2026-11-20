// Minds of the living at the moment of sampling (docs/DESIGN.md §4.10, §4.11): how many agents have a
// memory, the mean number of associations each holds, the hidden-cause nodes they hold (mean a mind, the
// share holding any, their mean strength), and the mind's running counts of salient unexplained residuals
// and of nodes posited and strengthened. A description for the Phase 3 checks, not a detector: a node is
// an inference an agent made, not evidence that anything was there.

import type { Measurements, Observer } from '../observer.ts';
import { ACT_TALLY_PART, ActTally, MEMORY, MEMORY_COLUMNS } from '../../sim/readonly.ts';

export const minds: Observer = {
  name: 'minds',
  observe(view): Measurements {
    const agents = view.agents;
    if (!agents.hasColumn(MEMORY_COLUMNS.memCount.name)) return {};
    const alive = agents.column('alive');
    const sex = agents.column('sex');
    const count = agents.column(MEMORY_COLUMNS.memCount.name);
    const ids = agents.column(MEMORY_COLUMNS.nodeId.name);
    const strength = agents.column(MEMORY_COLUMNS.nodeStrength.name);
    const N = MEMORY.nodes;
    let n = 0;
    let associations = 0;
    let nodes = 0;
    let withAny = 0;
    let strengths = 0;
    for (let slot = 0; slot < agents.highWater; slot++) {
      if (alive[slot] !== 1 || sex[slot] === 0) continue;
      n += 1;
      associations += count[slot];
      let held = 0;
      for (let q = 0; q < N; q++) {
        if (ids[slot * N + q] === 0) continue;
        held += 1;
        strengths += strength[slot * N + q];
      }
      nodes += held;
      if (held > 0) withAny += 1;
    }
    const out: Measurements = { minds: n };
    if (n > 0) {
      out.meanAssociations = associations / n;
      out.meanNodes = nodes / n;
      out.shareWithNodes = withAny / n;
      if (nodes > 0) out.meanNodeStrength = strengths / nodes;
    }
    const tally = view.readings(ACT_TALLY_PART);
    if (tally) {
      out.residualsSalient = tally[ActTally.RESIDUALS_SALIENT];
      out.nodesPosited = tally[ActTally.NODES_POSITED];
      out.nodesStrengthened = tally[ActTally.NODES_STRENGTHENED];
    }
    return out;
  },
};
