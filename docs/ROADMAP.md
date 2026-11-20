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

**Status: done, 2026-11-19, with the fire criterion failed and accepted as a known limit (D-037, D-038).** The exit check: `experiments/P1-ecology-review/results.md`, last section. It took sessions 3–19 (13 of them building), and the code grew from about 4,900 lines to about 16,700 including tests, the viewer and the experiment scripts.

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
- **1.13 [F]** *Done 2026-11-19 on Opus (T-009, D-038): a trap, not a famine (deer fled due east from a predator at their exact position, into the map edge, and walked back); fixed; the full exit check passes everything but fire, so Phase 1 exits (D-037).* Open seed 6: deer starve beside greens they never eat (500–1,300 a year on `main`, collapse with 1.12; `experiments/P1-ecology-review/results.md`, last section). Diagnose before changing anything: where the deer are, where the greens are, what the deer search, and why they breed at a third of the rate of other open worlds; then fix by the nudge protocol (world and animals: no owner wait, D-034). Check on open seed 6 and four other open seeds. Fire waits for the owner (Q10); re-run the full exit check once Q10 is answered or the owner says to.
- *Fire (the owner, 2026-11-19, D-037): the fire criterion's failure is accepted as a known limit. Phase 1 exits when the other criteria pass, with fire reported as failed; E3 counts fire as a difference between its conditions.*
**Exit:** the ecosystem without agents persists 100 simulated years across 20 seeds (no extinction cascades, no unbounded growth); fire behaves plausibly; both landscape types generate; the viewer runs.

---

## Phase 2: Bodies (~2–3k lines, 3–5 sessions)

- **2.1 [O]** *Done 2026-11-19 (`DESIGN.md` §3.8, D-039): Schofield basal rate, FAO activity ratios, Pandolf's costs of walking, climbing and loads, a gut, fat and lean split by Forbes's rule, starvation; the energy audit checks real bodies. Fat has no hard ceiling (D-039).* Metabolism: basal rate, per-action costs (MET-style), fat storage, starvation. Energy audit test now has teeth.
- **2.2 [O]** *Done 2026-11-19 (`DESIGN.md` §3.9, D-041): exposure to air, sky, sun, wind, rain, fire, hides and other bodies; a one-node core temperature with Scholander's regulation; total body water as an audited stock; death by dehydration, overheating or cold. The shelter probe's third share is now the sky hidden.* Hydration and thermoregulation (shelter, fire, hides, huddling).
- **2.3 [O]** *Done 2026-11-19 (`DESIGN.md` §3.10, D-042): wounds and bleeding, shock, broken bones, strains, burns from fire, lightning, wound and gut infections with an immune response, fever, the heat of healing, mobility; doors `injure` and `exposeGut`. Strains from overexertion wait for 2.4's load model.* Injury types, healing, infection.
- **2.4 [O]** *Done 2026-11-19 (`DESIGN.md` §3.11, D-043): Banister's fitness and fatigue over the load metabolism reports, capacity, strains from the acute:chronic ratio through 2.3's door, trained muscle that moves lean mass, strength, skills as `learned` practice on the life clock. Watching others (§5.6) waits for the owner.* Fitness–fatigue model, acute-vs-chronic load injury risk, muscle cost tradeoff, skill curves.
- **2.5 [O]** *Done 2026-11-19 (`DESIGN.md` §3.12, D-045): a frame curve per sex (forager growth, then sarcopenia) that bodies grow along when they have a surplus and shrink along after 35; death by old age from Gurven & Kaplan's forager Gompertz term, drawn once per body; capacity, strength and skill lose expression with age; one door for every death, which counts it by cause and age and leaves a carcass.* Aging, senescence, death causes, carcasses.
- **2.6 [O]** *Done 2026-11-19 (`DESIGN.md` §3.13, D-046): doors for mating and nursing; fertility by age, energy balance and nourishment; a fetus and milk as audited stocks the mother pays for; birth that bleeds; infants who digest no solid food and cannot walk; a forager mother's interbirth interval 3.14 years. The compressed year makes infancy costly (Q11).* Reproduction: mutual mating, energy-dependent fertility, gestation and lactation costs, infant dependency, child development.
- **2.7 [O]** *Done 2026-11-19 (`DESIGN.md` §3.14, D-047): two alleles for each heritable dial, expressed as their mean plus developmental noise, with only the body's dials (size, resting rate) so far; 64 recessive lethal loci that make children of close kin die more often before or after birth; a genealogy the analysis reads; a switch that turns the load off.* Genetics: diploid dials, recombination, mutation, recessive deleterious loci, genealogy tracking.
- **2.8 [F]** *Done 2026-11-20 on Opus (D-048, T-014): sources read where reachable (`RESEARCH.md`); the thermic effect of food no longer counted twice; §9 rewritten; Phase 2's exit check run (`experiments/P2-bodies-exit/`): its first criteria failed as written, a second set on fresh worlds passed; Phase 2 exits.* Calibration pass against `DESIGN.md` §9 (verify each source first, then fix the table).

**Exit:** energy and water audits pass; test fixtures (scripted bodies in `tests/` only) hit calibration targets within tolerance; agents running a random policy die of a plausible mix of causes.

---

## Phase 3: Individual minds (~3–5k lines, 4–8 sessions)

- **3.1 [F]** Design the learning architecture (`DESIGN.md` §4.5) in writing first: features, value learning, how delays are handled, memory limits, compute cost per agent. Add it to `DESIGN.md` before coding. *Done 2026-11-20: `DESIGN.md` §4.7, D-049.*
- **3.2 [O]** Perception (light, terrain, vegetation), individual recognition. *Done 2026-11-20: `DESIGN.md` §4.8, D-050.*
- **3.3 [O]** Drives (closed list) and action selection, with the solo acts' physics, the body's door for plant toxins, and founders (`DESIGN.md` §4.7.14). *Done 2026-11-20: `DESIGN.md` §4.9, D-051. Minds have learned nothing yet: choice is uniform, the random-policy baseline.*
- **3.3b [F]** Animals and agents meet (added 2026-11-20, D-051): how animals respond to agents (flight distances by kind, predators choosing agents as prey, isolated ones first, ambush from cover at night) and striking animals (wounds by force and edge, several attackers adding up against large prey, prey fighting back). World mechanisms with alibis, written into `DESIGN.md` before code; no agent knows any of it. Without it fear has nothing to learn but fire, and the Phase 3 exit's ambush predators cannot be a real hidden cause. *Done 2026-11-20: `DESIGN.md` §2.17, D-052.*
- **3.4 [O]** Episodic buffer, semantic associations, entity-response models. *Done 2026-11-20: `DESIGN.md` §4.10, D-053. Learners eat and drink far more than random agents and some outlive them by weeks, but more die of thirst in the first ten days; the mind is over the compute budget (Q13).*
- **3.5 [O]** Hidden-cause inference. *Done 2026-11-20: `DESIGN.md` §4.11, D-054. Nodes form from what no known cause explained; with every founder's `hiddenCauseBias` at 2, fewer were killed by animals but they drank about 40% less and more died of thirst (a description; the check is 3.7's).*
- **3.6 [O]** Skills wired into action success and cost. *Done 2026-11-20: `DESIGN.md` §4.12, D-055. Eating rates and precision run from a novice's to an expert's by practice; founders start as novices, so they eat about a third less and more starve; no novice can make fire by friction.*
- **3.6b [O]** Prepared taste-aversion learning (added 2026-11-20, the owner's answer to Q12, D-056). A second, longer eligibility kernel for eating and drinking acts on the illness channels (`DESIGN.md` §4.7.7, §4.10.9), its strength a heritable dial that founders draw widely and evolution can turn to zero, with an alibi (toxins and spoiled food exist with no one else around, and gut illness follows eating by hours). The owner's condition: it depends on hunger, and starving agents are not picky. Choice already weighs predictions by the drives of the moment (§4.7.6), so first write a test that a starving agent with a learned aversion eats that food when nothing else is in reach; if it does not, change how predicted illness is weighed against hunger (logged, with an alibi), not the learning. Write the design into `DESIGN.md` before the code. *Done 2026-11-20: `DESIGN.md` §4.13, D-058. The kernel reads the gut's part of pain; the hunger test passed with no change to choice; founders learn bitter root's delayed pain 3–4 times as strongly as without it, but what they eat did not measurably change in 40 days.*
- **3.7 [F]** Viability tuning (logged), then emergence checks. *Thirst part done 2026-11-20: `DESIGN.md` §4.14, D-059. Learners died of thirst because bodies took no water from food and nothing made them search or try untried acts; water in food was added (a body mechanism), and thirst no longer kills; the mind's gap is Q14 for the owner. Starvation is now the first cause of death.*
- **3.7b [F]** (split from 3.7, D-059) Measure starvation's links and classify them (`GUARDRAILS.md` §4); preregister Phase 3's four checks and run them against their ablations; take and write down a reading on births for the persistence check (conception is a door only Phase 4's acts call). If Q14 is answered first, build the answer first. *Done 2026-11-20 on Opus: `DESIGN.md` §4.14.5, D-060, T-018, `experiments/P3-minds-exit/`. Starvation's first broken link is an hour of digging by hand returning about what it costs; its classification is ambiguous, so it is Q15 for the owner. Checks 1, 3a and 4 pass; 2 and 3b fail. No woman is fertile under the present energy balance, so persistence moved to Phase 4's exit.*
- **3.7c [F]** (waits on Q14 and Q15) Build the owner's answers, written into `DESIGN.md` first; re-run the preregistered checks on seeds 11–18 with the same definitions (check 2 especially, which cannot pass while founders starve); then the single-generation viability check.

**Emergence checks:**
- Foraging efficiency rises over a lifetime vs. a random-policy baseline (§7.1).
- Agents learn to avoid delayed-toxic plants at a measurable rate.
- Hidden-cause nodes form. Where real hidden causes exist, they reduce harm compared with `hiddenCauseBias` = 0 (the alibi is real).
- Spurious hidden-cause associations have a measurable base rate (raw material for §7.7).

**Exit:** the checks above pass against their ablations; ~~a population of solo learners persists for 5 generations~~ *(moved to Phase 4's exit, D-060: births need mating and nursing, doors only Phase 4's acts call)*; **single-generation viability** (D-060): on most seeds, at least half of founders alive after one compressed year (48 days), and women fertile (fertility factor above 0) on at least half of their adult woman-days (viability tuning allowed and logged).

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

**Exit** *(added 2026-11-20, D-060)*: the checks above pass against their nulls; a population persists for 5 generations (moved from Phase 3's exit: births need the mating and nursing acts this phase builds; viability tuning allowed and logged).

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

**7.0 [O], before the long evolutionary runs** (the owner's answer to Q13, D-057): port the mind's hot loops to Rust compiled to WebAssembly (D-007's plan), with state hashes and cross-engine digests identical to the TypeScript, so 500 agents run near §1.7's speed again. Measure before and after.

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
