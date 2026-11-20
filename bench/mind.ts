// Phase 3.1: a prototype of the learning architecture in docs/DESIGN.md §4.7, run on a toy world, to
// measure what a mind costs per agent per tick before anything is built on it (D-016), and to check
// that its pieces do what §4.7 says on a problem small enough to read.
//
//   node bench/mind.ts                 speed at 500 agents, then the toy learning checks
//   node bench/mind.ts --speed         speed only
//   node bench/mind.ts --learn         learning checks only
//   node bench/mind.ts --debug         one agent's associations after 10 days, and its choices now and then
//
// Nothing here enters src/. The toy world (places, categories of things with fixed effects, a
// predator, a toy body whose drives drift) is a stand-in for Phases 1–2 and 3.2, chosen to exercise
// the mind's code paths, not to resemble the real world's numbers. The mind's data structures,
// lookups, valuation, softmax and learning follow §4.7 at full size, so their cost is the real one.

import { exp } from '../src/sim/core/dmath.ts';
import { nextFloat, nextInt, seedStream } from '../src/sim/core/rng.ts';

// ---- Sizes (§4.7) ------------------------------------------------------------------------------
const DEBUG = process.argv.includes('--debug');
const CH = 8; // outcome channels: hunger, thirst, cold, heat, pain, fatigue, mating, separation
const HUNGER = 0;
const THIRST = 1;
const PAIN = 4;
const FATIGUE = 5;
const LOG2S = 9;
const S = 1 << LOG2S; // association slots per agent
const MASK = S - 1;
const MAXLIVE = 384; // load factor 0.75, then the weakest entry in a sampled window is forgotten
const E = 24; // episodic buffer: acts remembered for delayed credit
const H = 16; // hidden-cause nodes
const M = 64; // places remembered
const K = 12; // percepts kept at a decision
const MAXC = 48; // candidate acts at a decision

// ---- Learning constants (§4.7.5; provisional) ---------------------------------------------------
const V0 = 0.04; // prior variance of a new association about a thing or a hidden cause (sd 0.2 drive units)
// Context cues (place, light, season, temperature) start ten times less plastic: salience by role (§4.7.5).
const priorOf = (k: number) => {
  const tag = k >>> 28;
  return tag === T_PLACE || tag === T_LIGHT || tag === T_SEASON || tag === T_TEMP ? V0 / 10 : V0;
};
const R = 0.01; // outcome noise variance (sd 0.1)
const Q = 0.00002; // variance regained per tick unused (forgetting and relearning)
const SALIENT = 0.08; // residual (sum of |channel|) that counts as an unexplained event

// ---- Act kinds (§4.7.2) -------------------------------------------------------------------------
const A_NONE = 0; // Pavlovian: the cue alone, whatever was done
const A_EXPLORE = 1;
const A_REST = 2;
const A_SLEEP = 3;
const A_CONSUME = 4;
const A_AVOID = 5;
const A_STRIKE = 6;
const A_GOTO = 7;
const ACT_KINDS = 8;
const A_UNBORN = 15; // no act yet: a new agent decides first and learns nothing from 'before'

// ---- Cue tags (§4.7.3) --------------------------------------------------------------------------
const T_CAT = 1;
const T_PLACE = 2;
const T_LIGHT = 3;
const T_SEASON = 4;
const T_TEMP = 5;
const T_NODE = 6;
const T_SELF = 8;
const cue = (tag: number, payload: number) => ((tag << 24) | payload) >>> 0;
const key = (c: number, act: number) => ((c << 4) | act) >>> 0;
const SELF = cue(T_SELF, 0);

// ---- Toy world ----------------------------------------------------------------------------------
const GRID = 32; // places on a side (400 m each, notionally)
const PREDATOR = 40;
const TICKS_PER_DAY = 144;
const TOXIN_DELAY = 21; // 3.5 hours
const kindOf = (c: number) =>
  c < 10 ? 'food' : c < 13 ? 'water' : c === 13 ? 'harm' : c === 14 ? 'toxin' : c === PREDATOR ? 'predator' : 'inedible';

function cellCats(cell: number, out: Int32Array): number {
  // A fixed set of up to 8 categories per place, by hash; about a third of places have water.
  let h = Math.imul(cell + 1, 0x9e3779b1) >>> 0;
  let n = 0;
  const step = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return h >>> 0;
  };
  if (step() % 3 === 0) out[n++] = 10 + (step() % 3);
  if (step() % 20 === 0) out[n++] = PREDATOR;
  while (n < 8) {
    const c = step() % 40;
    if (c >= 10 && c < 13) continue;
    let dup = false;
    for (let i = 0; i < n; i++) if (out[i] === c) dup = true;
    if (!dup) out[n++] = c;
  }
  return n;
}

// ---- One population of minds ---------------------------------------------------------------------
interface Options {
  agents: number;
  seed: number;
  traceHalfLifeH: number; // 0 turns delayed credit off
  learn: boolean; // false: a stand-in policy that picks uniformly among the candidates
  hiddenCauseBias: number;
}

function makePopulation(o: Options) {
  const N = o.agents;
  // Association table (§4.7.4)
  const tKey = new Uint32Array(N * S);
  const tMu = new Float32Array(N * S * CH);
  const tDl = new Float32Array(N * S * CH);
  const tVar = new Float32Array(N * S);
  const tDvar = new Float32Array(N * S);
  const tLast = new Uint32Array(N * S);
  const tLive = new Uint16Array(N);
  // Episodic buffer (§4.7.6)
  const eEnd = new Uint32Array(N * E);
  const eKeyT = new Uint32Array(N * E);
  const eKeyP = new Uint32Array(N * E);
  const eCredit = new Float32Array(N * E * CH);
  const eUsed = new Uint8Array(N * E);
  const eHead = new Uint8Array(N);
  // Hidden-cause nodes (§4.7.7): signature place, light, season; strength
  const hPlace = new Uint32Array(N * H);
  const hLight = new Uint8Array(N * H);
  const hSeason = new Uint8Array(N * H);
  const hStrength = new Float32Array(N * H);
  // Place memory (§4.7.8)
  const pCell = new Int32Array(N * M).fill(-1);
  const pSeen = new Uint32Array(N * M);
  const pGain = new Float32Array(N * M);
  // Acts and the toy body
  const actKind = new Uint8Array(N);
  const actCue = new Uint32Array(N);
  const actLeft = new Int16Array(N);
  const actGoal = new Int32Array(N);
  const actStart = new Float32Array(N * CH);
  const drive = new Float32Array(N * CH);
  const cell = new Int32Array(N);
  const toxinAt = new Int32Array(N).fill(-1);
  const streams = new Uint32Array(N * 4);
  // A new agent, or one that died (hunger or thirst at the limit) replaced by a newcomer with an empty mind.
  function spawn(a: number) {
    tKey.fill(0, a * S, a * S + S);
    tLive[a] = 0;
    eUsed.fill(0, a * E, a * E + E);
    hStrength.fill(0, a * H, a * H + H);
    pCell.fill(-1, a * M, a * M + M);
    drive.fill(0, a * CH, a * CH + CH);
    cell[a] = nextInt(streams, a * 4, GRID * GRID);
    drive[a * CH + HUNGER] = 0.3;
    drive[a * CH + THIRST] = 0.3;
    drive[a * CH + FATIGUE] = 0.2;
    actKind[a] = A_UNBORN;
    actLeft[a] = 0;
    toxinAt[a] = -1;
  }
  for (let a = 0; a < N; a++) {
    seedStream(streams, a * 4, o.seed, 99, a);
    spawn(a);
  }
  // Eligibility by age in ticks, computed once (§1.8 rule 3).
  const WINDOW = o.traceHalfLifeH > 0 ? Math.ceil(o.traceHalfLifeH * 6 * 4) : 0;
  const trace = new Float64Array(WINDOW + 1);
  for (let t = 0; t <= WINDOW; t++) trace[t] = exp((-t * 0.6931471805599453) / (o.traceHalfLifeH * 6));

  // Scratch
  const ks = new Int32Array(32);
  const vs = new Float64Array(32);
  const pred = new Float64Array(CH);
  const res = new Float64Array(CH);
  const err = new Float64Array(CH);
  const out = new Float64Array(CH);
  const cats = new Int32Array(16);
  const pcCue = new Uint32Array(K);
  const pcDist = new Float64Array(K);
  const ctx = new Uint32Array(8);
  const ctxAct = new Float64Array(ACT_KINDS * CH);
  const pav = new Float64Array(CH);
  const pavHere = new Float64Array(CH);
  const cKind = new Uint8Array(MAXC);
  const cCue = new Uint32Array(MAXC);
  const cGoal = new Int32Array(MAXC);
  const cDist = new Float64Array(MAXC);
  const cVal = new Float64Array(MAXC);
  const mu = new Float64Array(CH);
  const stats = {
    decisions: 0,
    consumeByKind: {} as Record<string, number>,
    attacks: 0,
    nodes: 0,
    evictions: 0,
    salient: 0,
    deaths: 0,
    hungerSum: 0,
    painSum: 0,
    samples: 0,
  };

  const home = (k: number) => Math.imul(k, 0x9e3779b1) >>> (32 - LOG2S);
  function find(a: number, k: number): number {
    const base = a * S;
    let i = home(k);
    for (;;) {
      const kk = tKey[base + i];
      if (kk === k) return base + i;
      if (kk === 0) return -1;
      i = (i + 1) & MASK;
    }
  }
  function moveSlot(from: number, to: number) {
    tKey[to] = tKey[from];
    tVar[to] = tVar[from];
    tDvar[to] = tDvar[from];
    tLast[to] = tLast[from];
    for (let c = 0; c < CH; c++) {
      tMu[to * CH + c] = tMu[from * CH + c];
      tDl[to * CH + c] = tDl[from * CH + c];
    }
  }
  function evict(a: number) {
    // Forget the least recently used of 8 sampled slots; backward-shift deletion keeps probing valid.
    const base = a * S;
    let start = nextInt(streams, a * 4, S);
    let victim = -1;
    let oldest = 0xffffffff;
    for (let n = 0; n < 8; n++) {
      const i = (start + n) & MASK;
      if (tKey[base + i] !== 0 && tLast[base + i] < oldest) {
        oldest = tLast[base + i];
        victim = i;
      }
    }
    if (victim < 0) {
      for (let i = 0; i < S; i++) if (tKey[base + i] !== 0) victim = i;
    }
    let i = victim;
    for (;;) {
      tKey[base + i] = 0;
      let j = i;
      for (;;) {
        j = (j + 1) & MASK;
        const k = tKey[base + j];
        if (k === 0) {
          tLive[a]--;
          stats.evictions++;
          return;
        }
        const h = home(k);
        const between = i <= j ? i < h && h <= j : i < h || h <= j;
        if (between) continue;
        moveSlot(base + j, base + i);
        i = j;
        break;
      }
    }
  }
  // Make room for n new entries first: forgetting moves entries (backward shift), so slots found
  // before an eviction could go stale.
  function reserve(a: number, n: number) {
    while (tLive[a] + n > MAXLIVE) evict(a);
  }
  function findOrAdd(a: number, k: number, tick: number): number {
    const f = find(a, k);
    if (f >= 0) return f;
    if (tLive[a] >= MAXLIVE) throw new Error('reserve() first');
    const base = a * S;
    let i = home(k);
    while (tKey[base + i] !== 0) i = (i + 1) & MASK;
    const s = base + i;
    tKey[s] = k;
    tVar[s] = priorOf(k);
    tDvar[s] = priorOf(k);
    tLast[s] = tick;
    for (let c = 0; c < CH; c++) {
      tMu[s * CH + c] = 0;
      tDl[s * CH + c] = 0;
    }
    tLive[a]++;
    return s;
  }

  function contextOf(a: number, tick: number): number {
    const tod = tick % TICKS_PER_DAY;
    const light = tod < 30 || tod >= 114 ? 0 : tod < 42 || tod >= 102 ? 1 : 2;
    const season = Math.floor(tick / (12 * TICKS_PER_DAY)) % 4;
    let n = 0;
    ctx[n++] = cue(T_PLACE, cell[a]);
    ctx[n++] = cue(T_LIGHT, light);
    ctx[n++] = cue(T_SEASON, season);
    ctx[n++] = cue(T_TEMP, light === 0 ? 0 : 1);
    // Active hidden-cause nodes: two of three signature features match (at most two nodes).
    let active = 0;
    for (let h = 0; h < H && active < 2; h++) {
      const j = a * H + h;
      if (hStrength[j] <= 0) continue;
      const m = (hPlace[j] === cell[a] ? 1 : 0) + (hLight[j] === light ? 1 : 0) + (hSeason[j] === season ? 1 : 0);
      if (m >= 2) {
        ctx[n++] = cue(T_NODE, h);
        active++;
      }
    }
    // Salient things perceived here (animals, agents, fire) are cues too: the predator, in the toy.
    const nc = cellCats(cell[a], cats);
    for (let i = 0; i < nc; i++) if (cats[i] === PREDATOR) ctx[n++] = cue(T_CAT, PREDATOR);
    return n;
  }

  // Kalman–Rescorla–Wagner update of `n` slots in ks sharing outcome `out`; residual left in `res`.
  function learnNow(n: number, tick: number) {
    let sumV = 0;
    for (let c = 0; c < CH; c++) pred[c] = 0;
    for (let i = 0; i < n; i++) {
      const s = ks[i];
      const v = Math.min(priorOf(tKey[s]), tVar[s] + Q * (tick - tLast[s]));
      vs[i] = v;
      sumV += v;
      for (let c = 0; c < CH; c++) pred[c] += tMu[s * CH + c];
    }
    const denom = sumV + R;
    let errSize = 0;
    for (let c = 0; c < CH; c++) {
      res[c] = out[c] - pred[c];
      err[c] = res[c];
      errSize += Math.abs(res[c]);
    }
    for (let i = 0; i < n; i++) {
      const s = ks[i];
      const g = vs[i] / denom;
      for (let c = 0; c < CH; c++) tMu[s * CH + c] += g * res[c];
      tVar[s] = vs[i] * (1 - g);
      tLast[s] = tick;
    }
    const left = 1 - sumV / denom;
    for (let c = 0; c < CH; c++) res[c] *= left;
    return errSize;
  }

  function closeRecord(a: number, j: number, tick: number) {
    // The record leaves the buffer: its delayed prediction moves toward the credit it gathered.
    reserve(a, 2);
    for (let w = 0; w < 2; w++) {
      const k = w === 0 ? eKeyT[j] : eKeyP[j];
      const s = findOrAdd(a, k, tick);
      const g = tDvar[s] / (tDvar[s] + R);
      for (let c = 0; c < CH; c++) tDl[s * CH + c] += g * (eCredit[j * CH + c] - tDl[s * CH + c]);
      tDvar[s] *= 1 - g;
    }
  }

  function endAct(a: number, tick: number) {
    const kind = actKind[a];
    const d = a * CH;
    for (let c = 0; c < CH; c++) out[c] = drive[d + c] - actStart[d + c];
    if (!o.learn) return;
    const nctx = contextOf(a, tick);
    reserve(a, 3 + 2 * nctx);
    let n = 0;
    ks[n++] = findOrAdd(a, key(actCue[a], kind), tick);
    for (let i = 0; i < nctx; i++) {
      ks[n++] = findOrAdd(a, key(ctx[i], kind), tick);
      ks[n++] = findOrAdd(a, key(ctx[i], A_NONE), tick);
    }
    const size = learnNow(n, tick);
    let unexplained = 0;
    for (let c = 0; c < CH; c++) unexplained += Math.abs(res[c]);
    // What the present can't explain is offered to the recent past (§4.7.6).
    if (size > SALIENT) {
      stats.salient++;
      // Every remembered act in the window gathers the surprise, weighted by its eligibility; each
      // learns from its own total when it leaves the buffer (closeRecord), so a consistent cause keeps
      // the association and a bystander loses it the next time nothing follows it.
      if (WINDOW > 0) {
        for (let r = 0; r < E; r++) {
          const j = a * E + r;
          const age = tick - eEnd[j];
          if (!eUsed[j] || age > WINDOW) continue;
          const e = trace[age];
          for (let c = 0; c < CH; c++) eCredit[j * CH + c] += e * err[c];
        }
      }
      // An unexplained event may posit a hidden cause, or strengthen one that fits (§4.4).
      if (o.hiddenCauseBias > 0 && unexplained > SALIENT && nextFloat(streams, a * 4) < o.hiddenCauseBias * Math.min(1, unexplained)) {
        const tod = tick % TICKS_PER_DAY;
        const light = tod < 30 || tod >= 114 ? 0 : tod < 42 || tod >= 102 ? 1 : 2;
        const season = Math.floor(tick / (12 * TICKS_PER_DAY)) % 4;
        let best = -1;
        let weakest = 0;
        for (let h = 0; h < H; h++) {
          const j = a * H + h;
          if (hStrength[j] > 0 && hPlace[j] === cell[a] && hSeason[j] === season) best = h;
          if (hStrength[j] < hStrength[a * H + weakest]) weakest = h;
        }
        if (best < 0) {
          best = weakest;
          stats.nodes++;
          hPlace[a * H + best] = cell[a];
          hLight[a * H + best] = light;
          hSeason[a * H + best] = season;
          hStrength[a * H + best] = 0;
        }
        hStrength[a * H + best] += unexplained;
      }
    }
    // Push this act into the buffer, closing the record it replaces.
    const j = a * E + eHead[a];
    if (eUsed[j]) closeRecord(a, j, tick);
    eUsed[j] = 1;
    eEnd[j] = tick;
    eKeyT[j] = key(actCue[a], kind);
    eKeyP[j] = key(cue(T_PLACE, cell[a]), A_NONE);
    for (let c = 0; c < CH; c++) eCredit[j * CH + c] = 0;
    eHead[a] = (eHead[a] + 1) % E;
  }

  function perceive(a: number): number {
    // Toy perception: what is in this place (0–200 m) and in the four next to it (about 400 m).
    let n = 0;
    const here = cell[a];
    const cx = here % GRID;
    const cy = (here - cx) / GRID;
    for (let q = 0; q < 5 && n < K; q++) {
      const x = q === 1 ? cx - 1 : q === 2 ? cx + 1 : cx;
      const y = q === 3 ? cy - 1 : q === 4 ? cy + 1 : cy;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
      const m = cellCats(y * GRID + x, cats);
      for (let i = 0; i < m && n < K; i += q === 0 ? 1 : 3) {
        pcCue[n] = cue(T_CAT, cats[i]);
        pcDist[n] = q === 0 ? 100 : 400;
        n++;
      }
    }
    return n;
  }

  function rememberPlace(a: number, tick: number, gain: number) {
    let slot = -1;
    let oldest = 0;
    for (let p = 0; p < M; p++) {
      const j = a * M + p;
      if (pCell[j] === cell[a]) {
        slot = p;
        break;
      }
      if (pCell[j] < 0 || pSeen[j] < pSeen[a * M + oldest]) oldest = p;
    }
    if (slot < 0) slot = oldest;
    const j = a * M + slot;
    pCell[j] = cell[a];
    pSeen[j] = tick;
    pGain[j] = gain;
  }

  let moveSlotNow = -1;
  function valueOf(a: number, kind: number, c: number, dist: number, tick: number, curiosity: number): number {
    const d = a * CH;
    const s = find(a, key(c, kind));
    const k0 = key(c, kind);
    const v = s >= 0 ? Math.min(priorOf(k0), tVar[s] + Q * (tick - tLast[s])) : priorOf(k0);
    // What happens here whatever is done (the Pavlovian part), plus what this act adds in this context,
    // plus what it adds done to this thing, now and later. An untried act predicts the baseline.
    for (let ch = 0; ch < CH; ch++) {
      mu[ch] = pav[ch] + ctxAct[kind * CH + ch] + (s >= 0 ? tMu[s * CH + ch] + tDl[s * CH + ch] : 0);
    }
    // Going somewhere remembered: that place's baseline replaces this one's.
    if (kind === A_GOTO) {
      const there = find(a, key(c, A_NONE));
      for (let ch = 0; ch < CH; ch++) mu[ch] += (there >= 0 ? tMu[there * CH + ch] : 0) - pavHere[ch];
    }
    // Getting there: the agent's own measured cost of moving, per metre (from its (self, explore) entry).
    if (dist > 0) {
      const m = moveSlotNow;
      if (m >= 0) for (let ch = 0; ch < CH; ch++) mu[ch] += (tMu[m * CH + ch] * dist) / 400;
    }
    let value = 0;
    for (let ch = 0; ch < CH; ch++) {
      const now = drive[d + ch];
      let next = now + mu[ch];
      if (next < 0) next = 0;
      else if (next > 1) next = 1;
      value += now * now - next * next;
    }
    return value + curiosity * Math.sqrt(v);
  }

  function decide(a: number, tick: number) {
    stats.decisions++;
    const st = a * 4;
    const np = perceive(a);
    let nc = 0;
    const add = (kind: number, c: number, dist: number, goal: number) => {
      if (nc >= MAXC) return;
      cKind[nc] = kind;
      cCue[nc] = c;
      cDist[nc] = dist;
      cGoal[nc] = goal;
      nc++;
    };
    for (let i = 0; i < np; i++) {
      const cat = pcCue[i] & 0xffffff;
      if (cat === PREDATOR) {
        add(A_AVOID, pcCue[i], 0, -1);
        add(A_STRIKE, pcCue[i], pcDist[i], -1);
      } else {
        add(A_CONSUME, pcCue[i], pcDist[i], -1);
      }
    }
    add(A_EXPLORE, SELF, 0, -1);
    add(A_REST, SELF, 0, -1);
    add(A_SLEEP, SELF, 0, -1);
    // The three remembered places with the best remembered gain, if not here.
    if (o.learn) {
      let b0 = -1, b1 = -1, b2 = -1;
      for (let p = 0; p < M; p++) {
        const j = a * M + p;
        if (pCell[j] < 0 || pCell[j] === cell[a]) continue;
        const g = pGain[j];
        if (b0 < 0 || g > pGain[a * M + b0]) {
          b2 = b1;
          b1 = b0;
          b0 = p;
        } else if (b1 < 0 || g > pGain[a * M + b1]) {
          b2 = b1;
          b1 = p;
        } else if (b2 < 0 || g > pGain[a * M + b2]) b2 = p;
      }
      for (let q = 0; q < 3; q++) {
        const p = q === 0 ? b0 : q === 1 ? b1 : b2;
        if (p < 0) continue;
        const goal = pCell[a * M + p];
        const dx = Math.abs((goal % GRID) - (cell[a] % GRID));
        const dy = Math.abs(Math.floor(goal / GRID) - Math.floor(cell[a] / GRID));
        add(A_GOTO, cue(T_PLACE, goal), (dx + dy) * 400, goal);
      }
    }
    let choice: number;
    if (!o.learn) {
      choice = nextInt(streams, st, nc);
    } else {
      // What the context predicts for each act kind, summed once (§4.7.9).
      const nctx = contextOf(a, tick);
      for (let ch = 0; ch < CH; ch++) pav[ch] = 0;
      for (let i = 0; i < nctx; i++) {
        const s = find(a, key(ctx[i], A_NONE));
        if (s < 0) continue;
        for (let ch = 0; ch < CH; ch++) pav[ch] += tMu[s * CH + ch];
        if (i === 0) for (let ch = 0; ch < CH; ch++) pavHere[ch] = tMu[s * CH + ch];
        else if (i === 0) pavHere.fill(0);
      }
      // Only for the act kinds among the candidates.
      let kinds = 0;
      for (let i = 0; i < nc; i++) kinds |= 1 << cKind[i];
      for (let kind = 1; kind < ACT_KINDS; kind++) {
        if ((kinds & (1 << kind)) === 0) continue;
        for (let ch = 0; ch < CH; ch++) ctxAct[kind * CH + ch] = 0;
        for (let i = 0; i < nctx; i++) {
          const s = find(a, key(ctx[i], kind));
          if (s < 0) continue;
          for (let ch = 0; ch < CH; ch++) ctxAct[kind * CH + ch] += tMu[s * CH + ch];
        }
      }
      moveSlotNow = find(a, key(SELF, A_EXPLORE));
      const curiosity = 0.3;
      const temperature = 0.01;
      let best = -Infinity;
      for (let i = 0; i < nc; i++) {
        cVal[i] = valueOf(a, cKind[i], cCue[i], cDist[i], tick, curiosity);
        if (cVal[i] > best) best = cVal[i];
      }
      if (DEBUG && a === 0 && tick % 300 === 0) {
        const parts: string[] = [];
        for (let i = 0; i < nc; i++) parts.push(`${cKind[i]}:${cCue[i] >>> 24}/${cCue[i] & 0xffffff}=${cVal[i].toFixed(3)}`);
        console.log(tick, 'pav', Array.from(pav).map((x) => x.toFixed(3)).join(','), parts.join(' '));
      }
      let sum = 0;
      for (let i = 0; i < nc; i++) {
        cVal[i] = exp((cVal[i] - best) / temperature);
        sum += cVal[i];
      }
      let r = nextFloat(streams, st) * sum;
      choice = nc - 1;
      for (let i = 0; i < nc; i++) {
        r -= cVal[i];
        if (r <= 0) {
          choice = i;
          break;
        }
      }
      rememberPlace(a, tick, best);
    }
    actKind[a] = cKind[choice];
    actCue[a] = cCue[choice];
    actGoal[a] = cGoal[choice];
    const travel = Math.ceil(cDist[choice] / 720);
    actLeft[a] =
      cKind[choice] === A_REST ? 3 : cKind[choice] === A_SLEEP ? 48 : cKind[choice] === A_EXPLORE ? 2 : cKind[choice] === A_CONSUME ? 1 + travel : Math.max(1, travel);
    for (let ch = 0; ch < CH; ch++) actStart[a * CH + ch] = drive[a * CH + ch];
  }

  function neighbour(a: number) {
    const here = cell[a];
    const x = here % GRID;
    const y = (here - x) / GRID;
    const dir = nextInt(streams, a * 4, 4);
    const nx = Math.min(GRID - 1, Math.max(0, x + (dir === 0 ? 1 : dir === 1 ? -1 : 0)));
    const ny = Math.min(GRID - 1, Math.max(0, y + (dir === 2 ? 1 : dir === 3 ? -1 : 0)));
    cell[a] = ny * GRID + nx;
  }

  // The toy body and the act's effect, then the mind. One tick for every agent.
  function step(tick: number) {
    for (let a = 0; a < N; a++) {
      const d = a * CH;
      const asleep = actKind[a] === A_SLEEP;
      drive[d + HUNGER] = Math.min(1, drive[d + HUNGER] + 0.005);
      drive[d + THIRST] = Math.min(1, drive[d + THIRST] + (asleep ? 0.0015 : 0.0035));
      drive[d + FATIGUE] = Math.max(0, Math.min(1, drive[d + FATIGUE] + (asleep ? -0.016 : actKind[a] === A_REST ? 0.002 : 0.0065)));
      drive[d + PAIN] *= 0.98;
      stats.hungerSum += drive[d + HUNGER];
      stats.painSum += drive[d + PAIN];
      stats.samples++;
      if (toxinAt[a] === tick) {
        drive[d + PAIN] = Math.min(1, drive[d + PAIN] + 0.7);
        toxinAt[a] = -1;
      }
      // The predator strikes now and then where it lives, unless the agent is moving away.
      let struck = false;
      if (actKind[a] !== A_AVOID) {
        const nc = cellCats(cell[a], cats);
        for (let i = 0; i < nc; i++) {
          if (cats[i] === PREDATOR && nextFloat(streams, a * 4) < 0.03) {
            drive[d + PAIN] = Math.min(1, drive[d + PAIN] + 0.4);
            stats.attacks++;
            struck = true;
          }
        }
      }
      // The act runs; sleeping agents check in hourly (§1.1).
      actLeft[a]--;
      const kind = actKind[a];
      if (kind === A_SLEEP && drive[d + FATIGUE] < 0.1) actLeft[a] = 0;
      const due = actLeft[a] <= 0 || struck;
      if (!due) continue;
      if (kind === A_CONSUME && !struck) {
        const cat = actCue[a] & 0xffffff;
        const k = kindOf(cat);
        // Counted only when the act began hungry (hunger at least 0.3), where choosing well matters.
        if (actStart[d + HUNGER] >= 0.3) stats.consumeByKind[k] = (stats.consumeByKind[k] ?? 0) + 1;
        if (k === 'food') drive[d + HUNGER] = Math.max(0, drive[d + HUNGER] - (0.12 + 0.02 * (cat % 5)));
        else if (k === 'water') drive[d + THIRST] = Math.max(0, drive[d + THIRST] - 0.45);
        else if (k === 'harm') {
          drive[d + PAIN] = Math.min(1, drive[d + PAIN] + 0.35);
          drive[d + HUNGER] = Math.max(0, drive[d + HUNGER] - 0.05);
        } else if (k === 'toxin') {
          drive[d + HUNGER] = Math.max(0, drive[d + HUNGER] - 0.25);
          toxinAt[a] = tick + TOXIN_DELAY;
        }
      } else if (kind === A_EXPLORE || kind === A_AVOID) neighbour(a);
      else if (kind === A_GOTO && !struck) cell[a] = actGoal[a];
      if (drive[d + HUNGER] >= 1 || drive[d + THIRST] >= 1) {
        stats.deaths++;
        spawn(a);
      } else if (kind !== A_UNBORN) endAct(a, tick);
      decide(a, tick);
    }
  }

  function dump(a: number) {
    const rows: string[] = [];
    for (let i = 0; i < S; i++) {
      const s0 = a * S + i;
      const k = tKey[s0];
      if (k === 0) continue;
      const act = k & 15;
      const c = k >>> 4;
      const tag = c >>> 24;
      const pay = c & 0xffffff;
      const v = (j: number) => tMu[s0 * CH + j].toFixed(3);
      const dl = (j: number) => tDl[s0 * CH + j].toFixed(3);
      rows.push(`tag ${tag} ${tag === T_CAT ? kindOf(pay) + pay : pay} act ${act}: hunger ${v(0)} thirst ${v(1)} pain ${v(4)} fatigue ${v(5)} | delayed pain ${dl(4)} hunger ${dl(0)} | var ${tVar[s0].toFixed(4)}`);
    }
    rows.sort();
    console.log(rows.join('\n'));
    console.log('drives', Array.from(drive.slice(a * CH, a * CH + CH)).map((x) => x.toFixed(2)).join(' '));
  }
  return { step, stats, tLive, N, dump };
}

// ---- Speed ----------------------------------------------------------------------------------------
function speed(agents: number, learn: boolean, days: number) {
  const pop = makePopulation({ agents, seed: 1, traceHalfLifeH: 2, learn, hiddenCauseBias: 0.5 });
  let tick = 0;
  for (; tick < 3 * TICKS_PER_DAY; tick++) pop.step(tick); // tables fill
  const d0 = pop.stats.decisions;
  const t0 = performance.now();
  const end = tick + days * TICKS_PER_DAY;
  for (; tick < end; tick++) pop.step(tick);
  const ms = performance.now() - t0;
  const ticks = days * TICKS_PER_DAY;
  let live = 0;
  for (let a = 0; a < agents; a++) live += pop.tLive[a];
  return {
    usPerAgentTick: (ms * 1000) / ticks / agents,
    decisionsPerAgentTick: (pop.stats.decisions - d0) / ticks / agents,
    meanEntries: live / agents,
    evictions: pop.stats.evictions,
  };
}

// A stand-in for 3.2's perception on real-sized layers: a 7 × 7 window of 100 m cells around a random
// point, reading 16 one-byte or float layers a cell, as a decision's perception would (§4.7.10).
function perceptionCost(): number {
  const W = 512;
  const layers: (Uint8Array | Float32Array)[] = [];
  for (let i = 0; i < 16; i++) layers.push(i % 2 === 0 ? new Uint8Array(W * W).fill(i) : new Float32Array(W * W).fill(i));
  const s = new Uint32Array(4);
  seedStream(s, 0, 7, 98, 0);
  let acc = 0;
  const n = 200_000;
  const t0 = performance.now();
  for (let q = 0; q < n; q++) {
    const cx = 3 + nextInt(s, 0, W - 6);
    const cy = 3 + nextInt(s, 0, W - 6);
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        const k = y * W + x;
        for (let l = 0; l < 16; l++) acc += layers[l][k];
      }
    }
  }
  const us = ((performance.now() - t0) * 1000) / n;
  if (acc === 0.5) console.log(''); // keep the loop
  return us;
}

// ---- Learning checks --------------------------------------------------------------------------------
function learning(traceHalfLifeH: number, learn: boolean, days: number) {
  const pop = makePopulation({ agents: 300, seed: 3, traceHalfLifeH, learn, hiddenCauseBias: 0 });
  const rows: Record<string, number>[] = [];
  let tick = 0;
  for (let day = 0; day < days; day++) {
    const before = { ...pop.stats.consumeByKind };
    const attacksBefore = pop.stats.attacks;
    const deathsBefore = pop.stats.deaths;
    const hb = pop.stats.hungerSum;
    const pb = pop.stats.painSum;
    const sb = pop.stats.samples;
    for (let t = 0; t < TICKS_PER_DAY; t++, tick++) pop.step(tick);
    const row: Record<string, number> = {};
    for (const k of ['food', 'water', 'harm', 'toxin', 'inedible']) row[k] = (pop.stats.consumeByKind[k] ?? 0) - (before[k] ?? 0);
    row.attacks = pop.stats.attacks - attacksBefore;
    row.deaths = pop.stats.deaths - deathsBefore;
    row.hunger = (pop.stats.hungerSum - hb) / (pop.stats.samples - sb);
    row.pain = (pop.stats.painSum - pb) / (pop.stats.samples - sb);
    rows.push(row);
  }
  const sum = (from: number, to: number) => {
    const s: Record<string, number> = { food: 0, water: 0, harm: 0, toxin: 0, inedible: 0, attacks: 0, deaths: 0, hunger: 0, pain: 0 };
    for (let d = from; d < to; d++) for (const k in s) s[k] += rows[d][k];
    s.hunger /= to - from;
    s.pain /= to - from;
    return s;
  };
  return { first: sum(0, 3), last: sum(days - 5, days) };
}

const args = process.argv.slice(2);
const doSpeed = args.length === 0 || args.includes('--speed');
const doLearn = args.length === 0 || args.includes('--learn');
if (args.includes('--debug')) {
  const pop = makePopulation({ agents: 50, seed: 3, traceHalfLifeH: 2, learn: true, hiddenCauseBias: 0 });
  for (let t = 0; t < 10 * TICKS_PER_DAY; t++) pop.step(t);
  pop.dump(0);
  console.log(pop.stats.consumeByKind, 'salient', pop.stats.salient);
}
if (doSpeed) {
  const p = perceptionCost();
  console.log(`Perception stand-in (7 x 7 cells x 16 layers): ${p.toFixed(2)} us a decision.`);
  for (const agents of [500]) {
    const full = speed(agents, true, 6);
    const stand = speed(agents, false, 6);
    console.log(
      `${agents} agents: mind ${full.usPerAgentTick.toFixed(3)} us per agent per tick, toy world and random stand-in ` +
        `${stand.usPerAgentTick.toFixed(3)}; difference ${(full.usPerAgentTick - stand.usPerAgentTick).toFixed(3)}. ` +
        `Decisions ${full.decisionsPerAgentTick.toFixed(3)} per agent per tick; ` +
        `${full.meanEntries.toFixed(0)} associations an agent; ${full.evictions} forgotten.`,
    );
    console.log(
      `  With perception at the stand-in's cost: about ${(full.usPerAgentTick - stand.usPerAgentTick + full.decisionsPerAgentTick * p).toFixed(2)} us per agent per tick for perception and mind.`,
    );
  }
}
if (doLearn) {
  const days = 30;
  const show = (label: string, r: ReturnType<typeof learning>) => {
    const f = r.first;
    const l = r.last;
    const pct = (x: Record<string, number>, k: string) => {
      const total = x.food + x.water + x.harm + x.toxin + x.inedible;
      return ((100 * x[k]) / Math.max(1, total)).toFixed(1).padStart(5);
    };
    console.log(
      `${label.padEnd(26)} first 3 days: food ${pct(f, 'food')}%  harm ${pct(f, 'harm')}%  toxin ${pct(f, 'toxin')}%  inedible ${pct(f, 'inedible')}%  attacks ${f.attacks}  deaths ${f.deaths}  hunger ${f.hunger.toFixed(2)}  pain ${f.pain.toFixed(3)}` +
        `\n${''.padEnd(26)} last 5 days:  food ${pct(l, 'food')}%  harm ${pct(l, 'harm')}%  toxin ${pct(l, 'toxin')}%  inedible ${pct(l, 'inedible')}%  attacks ${l.attacks}  deaths ${l.deaths}  hunger ${l.hunger.toFixed(2)}  pain ${l.pain.toFixed(3)}`,
    );
  };
  console.log(`\nToy learning check, 300 agents, ${days} days (shares of consume acts begun at hunger 0.3 or more, by what the thing really does):`);
  show('random stand-in', learning(2, false, days));
  show('learner, no delayed credit', learning(0, true, days));
  show('learner, trace 1 h', learning(1, true, days));
  show('learner, trace 2 h', learning(2, true, days));
  show('learner, trace 4 h', learning(4, true, days));
}
