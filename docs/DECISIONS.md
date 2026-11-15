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
- **Date:** 2026-11-15 · **Status:** Provisional, pending owner confirmation (STATUS Q2) and the Phase 0.5 checkpoint
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
