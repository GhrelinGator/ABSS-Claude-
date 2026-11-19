# Roadmap

Phases run in order. Each milestone is tagged with a recommended model (**[F]** Fable 5.2, **[O]** Opus 5.5; see `CLAUDE.md`). A phase isn't done until its **exit criteria** pass. Emergence checks are real experiments: they follow the evidence standard in `DESIGN.md` §8.3, scaled to the phase.

Size estimates are rough (lines include tests). Phases 0–6 (everything through Floor 1 and the viewer) total roughly **16–27k lines, about 23–45 working sessions**. Phase 7 onward is open-ended experimentation.

---

## Phase 0: Foundations (~1.5–2.5k lines, 2–4 sessions)

**Status: done, 2026-11-15.** It came to about 4,900 lines including tests, roughly double the estimate above, so read the later estimates as low. Results: `STATUS.md`; checkpoint: `DECISIONS.md` D-016.

Nothing interesting happens in this phase. It builds the rails that keep everything after it honest.

- **0.1 [F]** Architecture skeleton: module layout per `CLAUDE.md`, core types (world, agent, entity, object), tick loop with fixed update order, seeded PRNG streams (§1.4), state serialization and hashing, `SignalLayer` interface stub.
- **0.2 [O]** All seven guardrail tests from `GUARDRAILS.md` §1, including the identifier-splitting banned-terms scanner. Some trivially pass on an empty sim; that's fine.
- **0.3 [O]** Experiment harness: config files, seed lists, conditions, batch runner using worker threads, metric export (JSONL), run manifests (config + commit hash + seed).
- **0.4 [O]** Benchmark: dummy agents (random walk + metabolism stub) at 100 / 500 / 2,000 agents. Record ticks per second and projected generations per hour.
- **0.5 [F]** Checkpoint decision: does TypeScript meet the §1.3 target? Record the result as a decision. If not, plan the Rust/WASM port of hot loops.

**Exit:** all guardrail tests exist and pass; determinism holds over 10k ticks including a save/load round trip; benchmark recorded in `STATUS.md`.

---

## Phase 1: World and ecology (~3–5k lines, 4–8 sessions)

- **1.0 [F]** *Done 2026-11-15 (`DESIGN.md` §1.8, `DECISIONS.md` D-018).* Portable math (D-014). List the functions Phases 1 and 2 actually need: a seasonal cycle, growth and decay curves, normally distributed draws. For each one, either write a pure-arithmetic version in `src/sim/core/dmath.ts` with accuracy tests, or pick a formulation that avoids it. Decide before any system uses one.
- **1.1 [O]** *Done 2026-11-15 (`DESIGN.md` §2.10, D-019, D-020).* Map generator: elevation, soil, rivers, lakes, springs, barriers. One parameter sweeps from open to circumscribed.
- **1.2 [O]** *Done 2026-11-15 (`DESIGN.md` §2.11, D-023), plus a daily soil-moisture layer for plants and fire to read.* Climate: seasons, multi-year variability process (variance as a config knob), storms, lightning.
- **1.3 [O]** *Done: sun and moon 2026-11-15 (`DESIGN.md` §2.4, D-021); fire light 2026-11-17 with 1.8 (§2.16).* Light: day/night, moon phase, fire light radius.
- **1.4 [O]** *Done 2026-11-15 (`DESIGN.md` §2.12, D-024, T-003), except seed dispersal by animals (moved to 1.5) and by agents (§7.13, once agents eat). Nutrients other than calories wait until a body needs one.* Plants: species attributes from `DESIGN.md` §2.5, including delayed toxicity, processing needs, storability, synchrony, visibility, and seed dispersal.
- **1.5 [O]** *Done 2026-11-16 (`DESIGN.md` §2.13, D-026, T-004); fire avoidance added with 1.8 (§2.16).* Animals: prey types, pursuit and ambush predators, scavengers, migration, fire avoidance, population dynamics. Also, from 1.4: grazing and browsing on plant cover, and seeds that animals carry and drop.
- **1.6 [O]** *Done 2026-11-17 (`DESIGN.md` §2.14, D-027).* Real hidden causes: pathogen load in stagnant water and carcasses.
- **1.7 [O]** *Done 2026-11-17 (`DESIGN.md` §2.15, D-029). Rubbing (abrasion, friction heat) moves to 1.8 as an ignition source; bones and antlers wait.* Materials and objects: attributes, fracture on strike, sparks, natural shelter, accumulation shelter.
- **1.8 [O]** *Done 2026-11-17 (`DESIGN.md` §2.16, D-031, T-005), with wind, litter, friction heat from rubbing, fire light, and predators keeping away from fire. Cooking waits for bodies (Phase 2).* Fire: ignition, spread, fuel, burnout, carriable burning sticks.
- **1.9 [O]** *First version done 2026-11-15 (`DESIGN.md` §10.1, D-022): terrain layers, day and night, time controls, cell inspector, in-browser self-check. Grows as later milestones add things to see.* **Debug viewer v0** (browser): map layers, animals, fire, time controls. It gets **its own page, served from this repository** (D-012), which needs a build step from `.ts` to `.js` and a GitHub Pages deployment. The owner should be able to *watch* from this point on, because I can't (`STATUS.md` explains why that matters). Consider moving this earlier in the phase: a viewer that shows only terrain and weather is already useful. On load, the viewer should run the arithmetic self-check (`src/sim/core/selfcheck.ts`) in the owner's own browser and say so plainly if it fails.
- **1.10 [F]** *Reviewed 2026-11-18 by Opus at the owner's request (D-032): the preregistered exit check failed on persistence and fire; persistence fixed and confirmed on 8 worlds; fire moved to 1.11.* Ecology balance review. Includes the fire regime: rare and small in the default climate, but near-total burns of open plains in severe droughts (T-005, `DESIGN.md` §2.16).

- **1.11 [O]** *Diagnosed and corrected 2026-11-19 (T-007, D-033): fire size on open country needs breaks in the fuel, a new mechanism; the owner said yes (D-034), so they are 1.12. Exit check not yet re-run.* Fire regime on open country, to the grassland band, then the full preregistered Phase 1 exit check again (`DESIGN.md` §2.16, end; D-032).
- **1.12 [F]** *Done 2026-11-19 on Opus (D-035, D-036, T-008): water table with small streams, bare ground, patchy-fuel spread; the exit check re-run fails on fire (mean 0.64%, worst year 87%) and on open seed 6's deer. Fire's next step waits for the owner (Q10).* Breaks in the fuel (the owner's yes, 2026-11-19, D-034): (a) patchy ground fuel within a cell, from the soil and rock already on the map; (b) damp ground along rivers and springs, from a simple water table. Design first (`DESIGN.md` §2.16), then calibrate fire to the grassland band (§2.16, end) and re-run the full preregistered Phase 1 exit check.
- **1.13 [F]** Open seed 6: deer starve beside greens they never eat (500–1,300 a year on `main`, collapse with 1.12; `experiments/P1-ecology-review/results.md`, last section). Diagnose before changing anything: where the deer are, where the greens are, what the deer search, and why they breed at a third of the rate of other open worlds; then fix by the nudge protocol (world and animals: no owner wait, D-034). Check on open seed 6 and four other open seeds. Fire waits for the owner (Q10); re-run the full exit check once Q10 is answered or the owner says to.
- *Fire (the owner, 2026-11-19, D-037): the fire criterion's failure is accepted as a known limit. Phase 1 exits when the other criteria pass, with fire reported as failed; E3 counts fire as a difference between its conditions.*
**Exit:** the ecosystem without agents persists 100 simulated years across 20 seeds (no extinction cascades, no unbounded growth); fire behaves plausibly; both landscape types generate; the viewer runs.

---

## Phase 2: Bodies (~2–3k lines, 3–5 sessions)

- **2.1 [O]** Metabolism: basal rate, per-action costs (MET-style), fat storage, starvation. Energy audit test now has teeth.
- **2.2 [O]** Hydration and thermoregulation (shelter, fire, hides, huddling).
- **2.3 [O]** Injury types, healing, infection.
- **2.4 [O]** Fitness–fatigue model, acute-vs-chronic load injury risk, muscle cost tradeoff, skill curves.
- **2.5 [O]** Aging, senescence, death causes, carcasses.
- **2.6 [O]** Reproduction: mutual mating, energy-dependent fertility, gestation and lactation costs, infant dependency, child development.
- **2.7 [O]** Genetics: diploid dials, recombination, mutation, recessive deleterious loci, genealogy tracking.
- **2.8 [F]** Calibration pass against `DESIGN.md` §9 (verify each source first, then fix the table).

**Exit:** energy and water audits pass; test fixtures (scripted bodies in `tests/` only) hit calibration targets within tolerance; agents running a random policy die of a plausible mix of causes.

---

## Phase 3: Individual minds (~3–5k lines, 4–8 sessions)

- **3.1 [F]** Design the learning architecture (`DESIGN.md` §4.5) in writing first: features, value learning, how delays are handled, memory limits, compute cost per agent. Add it to `DESIGN.md` before coding.
- **3.2 [O]** Perception (light, terrain, vegetation), individual recognition.
- **3.3 [O]** Drives (closed list) and action selection.
- **3.4 [O]** Episodic buffer, semantic associations, entity-response models.
- **3.5 [O]** Hidden-cause inference.
- **3.6 [O]** Skills wired into action success and cost.
- **3.7 [F]** Viability tuning (logged), then emergence checks.

**Emergence checks:**
- Foraging efficiency rises over a lifetime vs. a random-policy baseline (§7.1).
- Agents learn to avoid delayed-toxic plants at a measurable rate.
- Hidden-cause nodes form. Where real hidden causes exist, they reduce harm compared with `hiddenCauseBias` = 0 (the alibi is real).
- Spurious hidden-cause associations have a measurable base rate (raw material for §7.7).

**Exit:** the checks above pass against their ablations; a population of solo learners persists for 5 generations (viability tuning allowed and logged).

---

## Phase 4: Interaction (~2–3k lines, 3–6 sessions)

- **4.1 [O]** Perceiving others' actions, targets, and condition.
- **4.2 [O]** Co-rearing marks, attachment, separation drive, per-individual ledger.
- **4.3 [O]** Primitives: give, take (with resistance contest), strike agents, approach/avoid, touch, follow, attend, mate.
- **4.4 [O]** Observational learning and the three copying biases.
- **4.5 [F]** Emergence checks.

**Emergence checks:**
- Socially learned foraging beats solo learning; techniques spread (§7.2).
- Gives flow preferentially along bonds and to injured bonded individuals (§7.3), versus a shuffled-ledger null.
- Sustained-dyad duration rises with child cost (§7.4), versus a cheap-children ablation.
- **The Westermarck test (§7.5):** with inbreeding depression on, `coRearedMateAversion` evolves upward; with it off, the dial drifts. This is the project's first full emergence result. Write it up in `experiments/`.

---

## Phase 5: Signals and transmission, Floor 1 (~1.5–3k lines, 3–6 sessions)

- **5.1 [F]** Detailed design of encode/decode for Floor 1 and the credibility weighting, added to `DESIGN.md` §6 first.
- **5.2 [O]** Deictic tokens, coined tokens, the coining dial.
- **5.3 [O]** Listener cross-situational inference, per-agent lexicons.
- **5.4 [O]** Signaling motives (recruiting, disclosure), belief transmission into world models.
- **5.5 [F]** Emergence checks.

**Emergence checks:**
- Lexicon convergence (D5) beats a shuffled null; dialects appear between separated groups.
- Recruiting signals raise large-prey success.
- Night talk (§7.6): absent-referent content concentrates in dark periods near fire, versus a no-darkness ablation.

---

## Phase 6: Anthropologist layer and viewer v1 (~3–5k lines, 4–8 sessions)

Detectors get built incrementally in Phases 3–5 as checks need them. This phase completes and hardens them.

- **6.1 [F]** Full written specs for D1–D13, each with a positive-control fixture.
- **6.2 [O]** Implement the remaining detectors, the null-model runner (ablations + permutation tests), and the multi-seed report generator.
- **6.3 [O]** Viewer v1: agent inspector (drives, ledger, world model, lexicon, hidden-cause nodes), network overlays, a "legends" timeline of detected events.

**Exit:** every detector fires on its positive control and stays quiet on its null; a full report can be generated from a batch of runs.

---

## Phase 7: Experiments on the essay's hypotheses [F], open-ended

Each experiment: preregistration in `experiments/` → batch runs → write-up, including negative results. These are the questions from `ORIGIN.md`, tested instead of assumed.

| ID | Question | Manipulation | Detectors |
|---|---|---|---|
| E1 | Does harshness or *variability* drive cooperation? | climate mean vs. climate variance | D1, D2, D10 |
| E2 | Does idle time ("pondering in the evening") produce shared beliefs about hidden causes? | night length, fire availability, `hiddenCauseBias` ablation | D6, D7, D8, D9 |
| E3 | Does circumscription make hierarchy persist? | open vs. walled landscape | D3, D4 |
| E4 | Does storable surplus make hierarchy persist? | storable vs. non-storable staple species | D4, D11 |
| E5 | Do shared hidden-cause beliefs come before or after persistent hierarchy? | observational, across many runs | D3, D4, D6 |
| E6 | Does a crisis leader persist, and do beliefs help? (the raider scenario) | inter-group contact timing | D3, D13 |

Expect E5 and E6 to hit Floor 1's limits (`DESIGN.md` §6.7). That would be a finding in itself.

---

## Phase 8: Floor 2 [F]

Learned signaling with no free pointing behind the same `SignalLayer` interface. Re-run the Phase 5 checks and the Phase 7 experiments; compare.

---

## Phase 9: Game layer [open]

Depends on the player-role decision (`DESIGN.md` §10). Not planned until that's settled.
