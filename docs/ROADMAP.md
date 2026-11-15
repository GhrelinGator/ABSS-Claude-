# Roadmap

Phases run in order. Each milestone is tagged with a recommended model (**[F]** Fable 5.2, **[O]** Opus 5.5; see `CLAUDE.md`). A phase isn't done until its **exit criteria** pass. Emergence checks are real experiments: they follow the evidence standard in `DESIGN.md` §8.3, scaled to the phase.

Size estimates are rough (lines include tests). Phases 0–6 (everything through Floor 1 and the viewer) total roughly **16–27k lines, about 23–45 working sessions**. Phase 7 onward is open-ended experimentation.

---

## Phase 0: Foundations (~1.5–2.5k lines, 2–4 sessions)

Nothing interesting happens in this phase. It builds the rails that keep everything after it honest.

- **0.1 [F]** Architecture skeleton: module layout per `CLAUDE.md`, core types (world, agent, entity, object), tick loop with fixed update order, seeded PRNG streams (§1.4), state serialization and hashing, `SignalLayer` interface stub.
- **0.2 [O]** All seven guardrail tests from `GUARDRAILS.md` §1, including the identifier-splitting banned-terms scanner. Some trivially pass on an empty sim; that's fine.
- **0.3 [O]** Experiment harness: config files, seed lists, conditions, batch runner using worker threads, metric export (JSONL), run manifests (config + commit hash + seed).
- **0.4 [O]** Benchmark: dummy agents (random walk + metabolism stub) at 100 / 500 / 2,000 agents. Record ticks per second and projected generations per hour.
- **0.5 [F]** Checkpoint decision: does TypeScript meet the §1.3 target? Record the result as a decision. If not, plan the Rust/WASM port of hot loops.

**Exit:** all guardrail tests exist and pass; determinism holds over 10k ticks including a save/load round trip; benchmark recorded in `STATUS.md`.

---

## Phase 1: World and ecology (~3–5k lines, 4–8 sessions)

- **1.1 [O]** Map generator: elevation, soil, rivers, lakes, springs, barriers. One parameter sweeps from open to circumscribed.
- **1.2 [O]** Climate: seasons, multi-year variability process (variance as a config knob), storms, lightning.
- **1.3 [O]** Light: day/night, moon phase, fire light radius.
- **1.4 [O]** Plants: species attributes from `DESIGN.md` §2.5, including delayed toxicity, processing needs, storability, synchrony, visibility, and seed dispersal.
- **1.5 [O]** Animals: prey types, pursuit and ambush predators, scavengers, migration, fire avoidance, population dynamics.
- **1.6 [O]** Real hidden causes: pathogen load in stagnant water and carcasses.
- **1.7 [O]** Materials and objects: attributes, fracture on strike, sparks, natural shelter, accumulation shelter.
- **1.8 [O]** Fire: ignition, spread, fuel, burnout, carriable burning sticks.
- **1.9 [O]** **Debug viewer v0** (browser): map layers, animals, fire, time controls. The owner should be able to *watch* from this point on, because I can't (`STATUS.md` explains why that matters).
- **1.10 [F]** Ecology balance review.

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
