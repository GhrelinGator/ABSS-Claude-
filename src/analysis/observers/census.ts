// Head count. The simplest possible observer; it exists in Phase 0 mainly so
// the observer plumbing and its guardrails have something real to run.

import type { Observer } from '../observer.ts';

export const census: Observer = {
  name: 'census',
  observe(view) {
    const agents = view.agents;
    const alive = agents.column('alive');
    let scanned = 0;
    for (let slot = 0; slot < agents.highWater; slot++) {
      if (alive[slot] === 1) scanned++;
    }
    return { agents: agents.count, scanned };
  },
};
