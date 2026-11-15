# Decisions

Append-only. To change a decision, add a new one that supersedes it and mark the old one `Superseded by D-xxx`. Never delete.

Format: ID, date, status, decision, why, alternatives considered.

---

### D-001: Emergence over scripting
- **Date:** 2026-11-15 · **Status:** Accepted (owner's requirement)
- **Decision:** Social phenomena are never coded. The sim contains mechanisms; outcomes are detected by the analysis layer.
- **Why:** The project's whole point. A scripted religion answers no questions.
- **Alternatives:** Scripted civ-builder (WorldBox, Civilization style). Rejected.

### D-002: No LLMs in agent cognition
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** Agents use small structured learners. No LLM calls anywhere in `src/sim/`.
- **Why:** LLMs contain human culture, so their "inventions" are retrieval. In Project Sid (Altera, 2024), the religion that spread was set up by the researchers, and the team itself described the agents as *mirroring* human social dynamics.
- **Alternatives:** LLM agents (Generative Agents, Project Sid). Rejected for the sim. Possible later as display-only narration in the viewer.

### D-003: Start at language Floor 1, behind a swappable interface
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** Free pointing at perceivable things. Absent referents require coined tokens whose meanings listeners infer. Unordered token bags. All behind the `SignalLayer` interface (`DESIGN.md` §6.6).
- **Why:** Fully emergent language from scratch is beyond demonstrated research. Floor 1 still makes talking about absent things (which myths require) something agents must invent. The interface lets Floor 2 replace it later without a rewrite.
- **Alternatives:** Fixed vocabulary (too much given); fully emergent signals from day one (high risk of getting stuck before any social experiment runs).

### D-004: Structured learners, not evolved neural nets or deep RL (for v1)
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** The mind's *structure* is given (perception, drives, associative world model, hidden-cause inference, entity-response models, copying). Its *content* is learned. Tunable biases are heritable dials.
- **Why:** Evolved neural nets need astronomical compute to reach this level of cognition. Deep RL is expensive per agent and opaque, which makes the anthropologist layer much harder. Structured learners are cheap, inspectable, and still learn everything that matters.
- **Alternatives:** Neuroevolution (Polyworld or Bibites style); multi-agent deep RL. Both possible for Floor 2 signaling specifically.

### D-005: The alibi rule and neutral-start dials
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** Every mechanism needs an ecological alibi. Every given bias is a heritable dial that can reach neutral. Dials that could produce hoped-for outcomes start centered on neutral; survival-critical founder dials start at viable values, and that choice is logged.
- **Why:** This is the line between "evolution gave them this" and "we gave them the answer."

### D-006: Separate anthropologist layer with an evidence standard
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** `src/analysis/` is read-only and the only place social-outcome words appear. Claims need preregistration, positive controls, null models, and multiple seeds (`DESIGN.md` §8.3).
- **Why:** Without labels in the sim, detection is the only way to know anything happened. Without null models, detectors find patterns in noise.

### D-007: TypeScript stack (provisional until the Phase 0 benchmark)
- **Date:** 2026-11-15 · **Status:** Accepted. Confirmed by D-012 (owner delegated the choice) and D-016 (benchmark). The Vitest part is superseded by D-013.
- **Decision:** TypeScript (strict), Node for headless batches, browser for the viewer, Vitest. Data-oriented hot loops so they can port to Rust/WASM.
- **Why:** One codebase for headless runs and the viewer; the owner already builds web games; fast enough for Floor 1 at hundreds of agents if written carefully.
- **Alternatives:** Rust (faster, slower to iterate, harder for the owner to read); Python (best for analysis, too slow for the per-agent loop); C++.

### D-008: Model routing by milestone
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** Fable 5.2 for architecture, integration, diagnosis, and experiment design; Opus 5.5 for well-specified implementation. Tags in `ROADMAP.md`.
- **Why:** Fable leads on long, multi-part work but costs twice as much per token. Anthropic recommends starting most coding with Opus 5.5.

### D-009: External pressure comes only from the world or other agents
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** No event generators conditioned on agent state: no scripted raids, no threshold-triggered plagues, no drama director.
- **Why:** The essay's raiders and hardships have to be real consequences of the world, or the leadership and legitimation questions are meaningless.

### D-010: Calendar compression that preserves ratios
- **Date:** 2026-11-15 · **Status:** Provisional (tune in Phase 0–2)
- **Decision:** Real days (for day/night), compressed years (default 48 days). Life-history timings scale with the year, preserving ratios.
- **Why:** Generations are the scarcest resource. Day/night can't be compressed without breaking the night-talk hypothesis.

### D-011: Observer is the default player role
- **Date:** 2026-11-15 · **Status:** Provisional (STATUS Q1)
- **Decision:** Until the owner decides, the viewer is observation-only.
- **Why:** Any intervention is a physical event agents may attribute to a hidden cause, which changes what the religion experiments mean.

### D-012: Owner's answers to the open questions
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** The owner said: "I'd like for the game to have its own page. Otherwise, everything else is up to you." So:
  - **Q4, viewer hosting:** the game gets its own page, served from this repository (GitHub Pages), not a spot inside his other web-games site. Built in Phase 1.9.
  - **Q1, player role:** observer, until he says otherwise (D-011 stands).
  - **Q2, stack:** TypeScript (D-007 confirmed).
  - **Q3, long runs:** on the owner's computer, when Phase 3 needs them.
  - **Q5, name:** stays "ABSS" until he picks one.
- **Scope of the delegation:** it covers those five questions. It is **not** advance approval for anything `GUARDRAILS.md` says needs the owner: shrinking the banned list, adding a drive, adding a missing mechanism under the nudge protocol. Those still get asked one at a time.

### D-013: No dependencies; Node runs the TypeScript directly
- **Date:** 2026-11-15 · **Status:** Accepted (supersedes the Vitest part of D-007)
- **Decision:** Node 22.18 or newer runs the `.ts` files as they are, and tests use Node's built-in runner (`node --test`). Nothing has to be installed to run the simulation, the tests, the harness, or the benchmark. The only development dependencies are `typescript` and `@types/node`, for type-checking. Code sticks to TypeScript syntax that can be erased (no enums, namespaces, or parameter properties), which the compiler enforces.
- **Why:** The guardrail tests are only worth something if they run everywhere without setup, including cloud sessions that can't install packages (the session that built Phase 0 couldn't). Fewer moving parts also means old runs stay reproducible for longer.
- **Alternatives:** Vitest (nicer output, but an install step and a dependency tree); compiling to JavaScript first (an extra step that can go stale).
- **Consequence:** The browser viewer will need a build step that turns `.ts` into `.js` (the compiler can do this). That is Phase 1.9's problem.

### D-014: Portable arithmetic, so a run replays bit-for-bit on any engine
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** `src/sim/` uses only operations whose results the JavaScript standard fixes exactly. Engine-provided `Math.sin`, `cos`, `exp`, `log`, `pow`, `**` and the like are banned by a guardrail test. When the sim needs such a function, it gets a pure-arithmetic implementation in `src/sim/core/dmath.ts`, or the model is written to avoid it (a seasonal cycle doesn't have to be a sine).
- **Why:** The owner will watch runs in a browser and Claude will analyze them in Node. Those are different engines, and the standard lets them return slightly different values for these functions. In a chaotic simulation, one differing bit becomes a different history. "Seed 42 did something odd in year 30" is only useful if seed 42 does the same thing on both machines.
- **Cost:** Pure-arithmetic versions are slower than the built-ins, and writing them is real work. First needed in Phase 1 (climate) and Phase 2 (mutation needs normally distributed draws).

### D-015: Kernel architecture
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** As written in `DESIGN.md` §1.5 and §1.6. The choices that matter most for the project's honesty:
  - one write routine feeds both snapshots and hashes;
  - every column is categorised, and learned state is checked empty at spawn, every tick;
  - stores grow without limit, so there is no hidden population cap;
  - systems enter only through `defineSystem`, under an `// ALIBI:`;
  - the real pipeline started empty, and each phase adds to it deliberately;
  - agents will act simultaneously from the same tick-start state, with seeded tie-breaks.
- **Why:** Each of these closes a way for outcomes to leak in unnoticed, or for a bug to make runs unrepeatable.

### D-016: Phase 0.5 checkpoint: stay on TypeScript
- **Date:** 2026-11-15 · **Status:** Accepted; to be re-examined in Phase 3.1 with a real mind prototype
- **Measured** (cloud sandbox: Intel Xeon 2.30 GHz, 2 virtual cores, Node 22.23; two runs, which differed by about 12%):

  | Agents | Ticks per second | Microseconds per agent per tick | Generations per hour |
  |---|---|---|---|
  | 100 | ~11,100–11,200 | ~0.89 | ~230 |
  | 500 | ~3,700–4,200 | ~0.48–0.54 | ~77–87 |
  | 2,000 | ~1,100–1,300 | ~0.39–0.45 | ~23–27 |

  The load was a stand-in: tethered random movement, energy bookkeeping, and a 300 m neighbour scan over groups of 30. The neighbour scan took about 90% of the time. A generation is counted as 25 simulated years.
- **Budget:** the `DESIGN.md` §1.3 target (500 agents, one generation per 10 minutes, one core) allows **6.94 microseconds per agent per tick**. The kernel plus the stand-in load used 7–8% of that, leaving roughly **6.4 microseconds** for real bodies and minds on this machine.
- **Decision:** Stay on TypeScript. The kernel is nowhere near being the bottleneck.
- **What this does not show:** that real minds will fit. Six microseconds is a few thousand simple operations. A mind that re-examines everything it knows every tick will not fit, in any language. For scale: at the budget, 20 generations of 500 agents take about 3.3 hours per run on one core; at ten times over budget, about 33 hours.
- **Requirements this puts on Phase 3.1:**
  1. Mind state lives in typed arrays. No per-agent object graphs or hash maps on the every-tick path.
  2. Consider letting an agent keep doing what it is doing until the action ends or something salient interrupts, instead of deciding afresh every tick. This is probably the biggest lever, but it changes behaviour, so it needs an alibi and a `DESIGN.md` entry before it is used.
  3. Sleeping agents update coarsely (already in `DESIGN.md` §1.1).
  4. Prototype the mind and re-run this benchmark before building the rest of Phase 3.
  5. If it still doesn't fit: port the measured hot loops to Rust/WASM (the typed-array layout was chosen so this stays possible), or accept slower evolutionary runs.
- **The owner's machine will differ.** `npm run bench` prints the same table there.

### D-017: Work lands through pull requests, checked by GitHub
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** Each session works on a branch and opens a pull request into `main`. A GitHub Actions workflow runs the tests and type checks on every push. The owner merges.
- **Why:** The owner can't review TypeScript line by line, but he can see a green or red check and read a summary. The check runs on GitHub's machines, so it doesn't depend on Claude reporting its own results honestly.
- **Consequence:** A session must start from an up-to-date `main`. If the previous session's pull request is still open, say so before doing anything else.
