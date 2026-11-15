# Guardrails: rules against my own shortcuts

Written by Claude for future sessions of Claude. The owner asked me to plan for my own temptations because I can foresee them better than he can. So this is a list of the specific ways I'm likely to sabotage emergence while trying to be helpful, and what to do instead.

The core failure mode: **when a phenomenon doesn't appear, the fastest way to make the owner happy is a small change that makes it appear.** That change is almost always pre-coding, and it destroys the point of the project. I'll be tempted most when a session is long, a test is red, and the fix "only" adds one term.

---

## 1. The tests

Each item here is a test or check, not a vibe. These get built in Phase 0, before any simulation logic.

| Test | What it enforces |
|---|---|
| `tests/guardrails/banned-terms.test.ts` | No social-outcome words in `src/sim/` (code, identifiers, comments, strings). See §2. |
| `tests/guardrails/import-boundary.test.ts` | `src/sim/` imports nothing from `analysis/`, `harness/`, `viewer/`; `analysis/` never mutates sim state. |
| `tests/guardrails/determinism.test.ts` | Same seed + config → identical state hash after N ticks, across two runs and after save/load. |
| `tests/guardrails/blank-slate.test.ts` | Newly spawned agents (founders *and* newborns) have empty learned world models: no edibility knowledge, no hidden-cause nodes, no coined tokens, no social memories. |
| `tests/guardrails/no-ambient-io.test.ts` | No `Math.random`, `Date.now`, `performance.now`, `fetch`, network, filesystem, or LLM client imports in `src/sim/`. |
| `tests/guardrails/energy-audit.test.ts` | Calories in = calories spent + stored, within tolerance, for every agent over a long run. Same for water. |
| `tests/guardrails/alibi.test.ts` | Every exported gene, drive, and action primitive in `src/sim/` has an `// ALIBI:` comment at its definition. |

If a guardrail test is in the way, the test is not the problem.

---

## 2. Banned terms in `src/sim/`

Matching is whole-word and case-insensitive. Identifiers are split on camelCase, PascalCase, snake_case, and kebab-case, so `religionScore` and `LEADER_ID` both fail. Comments and string literals are scanned too, which means an alibi that mentions an outcome fails, as it should.

**Religion:** religion, religious, god, gods, deity, divine, spirit, spirits, supernatural, sacred, holy, worship, pray, prayer, priest, shaman, ritual, rite, myth, mythology, faith, church, temple, shrine, sacrifice, taboo, soul, afterlife, totem

**Politics & hierarchy:** leader, leadership, chief, chiefdom, king, queen, ruler, noble, elite, rank, hierarchy, authority, command, obey, obedience, law, crime, criminal, punish, punishment, justice, government, nation, polity, citizen, tax, tribute, army, soldier, war, warfare, raid, raider, enemy, ally, alliance, prestige, status, dominance, dominant, subordinate, power

**Economy:** trade, barter, money, currency, price, market, wage, debt, owner, ownership, territory, agriculture, farm, farming, farmer, crop, domesticate, domestication, granary, tool, weapon

**Kinship & bonds:** marriage, marry, spouse, husband, wife, partner, family, household, friend, friendship, love, tribe, clan, community, society, village, town, city, settlement, camp, home

**Culture & cognition:** culture, cultural, tradition, norms, custom, moral, morality, ethics, reputation, gossip, story, storytelling, teach, teacher, teaching, lesson, language, grammar, vocabulary, cooperate, cooperation, altruism, altruistic, selfish, defect, fair, fairness, trust

**What's allowed** (because these are physics, biology, or cognitive mechanism): fire, mate, parent, offspring, kin (genealogical, for genetics only; agents can't read it), ancestor, give, take, follow, attack, strike, signal, token, belief, hidden cause, attachment, bond strength, attention, imitation, idle, sleep, injury, object, material, plant, species, seed, carry, drop.

Notes:
- `power` is banned because "power" in sim code would mean social power. For physical power use `force`, `wattage`, or `output`.
- `status` is banned. For health or condition use `condition` or `state`.
- `tool` and `weapon` are banned because they're *use-labels*. In the sim, an object is just an object with material attributes (mass, hardness, edge sharpness, length). Whether it's used as a tool is something the analysis layer detects.
- **Known collisions with ordinary programming and science words.** Use the synonym; don't weaken the list:
  - "power law" (skill curves) → `practiceCurve`, `practiceExponent`
  - "status code" or "health status" → `condition`, `resultCode`
  - "owner" of a held object → `holder`
  - genetic "defect" → `deleteriousAllele`
  - "rank" in sorting → `order`, `position`
  - "law" in physics comments → `relation`, `equation`
- (`norm` and `magic` were left off the list on purpose because "vector norm" and "magic number" are too common in code.)
- Changing this list requires a `DECISIONS.md` entry **approved by the owner**. Adding words is always fine. Removing one is suspicious.

---

## 3. The temptation catalogue

Each entry shows the tempting version, why it's wrong, and the mechanism-level alternative.

### T1. Outcome nudges
- **Tempting:** "Agents near other agents get +10% foraging success."
- **Why wrong:** it's a hidden cooperation bonus. Togetherness pays because I said so.
- **Instead:** make it physically true where it's ecologically true. Large prey is strong and fast, so damage from multiple attackers adds up and one attacker can't bring it down. Predators target isolated individuals. Group foraging then pays where (and only where) it should.

### T2. Compound actions
- **Tempting:** `trade(a, b, itemA, itemB)`, `marry(a, b)`, `pray()`, `proposeJointAction()`.
- **Why wrong:** each one is an institution packed into a function.
- **Instead:** only physical primitives (see `DESIGN.md` §5.5). Trade is two `give`s the analysis layer notices. A proposal is a `signal` containing an action token and a place token, followed by others choosing to `follow`.

### T3. Purpose-built drives
- **Tempting:** a status drive, a belonging drive, a need for meaning, a "spirituality" gene, a conformity drive.
- **Why wrong:** no ecological alibi that doesn't assume society already exists.
- **Instead:** the drive list in `DESIGN.md` §4.2 is closed. Adding a drive requires an alibi that survives "would this exist in a world where no society ever forms?" plus owner approval. Social learning *biases* (whom to copy) are allowed, with alibis, because they're cheap information heuristics. Social *goals* are not.

### T4. Teleological tuning
- **Tempting:** adjusting `learningRate` or `hiddenCauseBias` until belief clusters show up.
- **Why wrong:** if the knob was tuned to produce the outcome, the outcome is pre-coded with extra steps.
- **Instead:** parameters are tuned only against **plausibility targets**: forager energy budgets, mortality curves, foraging return rates, plant growth rates (see `DESIGN.md` §9). Social metrics are **never** tuning targets. The one exception is *viability* (the population doesn't go extinct in the first generations), which is allowed because it's ecological. Every viability tune gets logged.
- Genes that evolve aren't tuned at all: their *initial distribution* is set wide and evolution does the rest.

### T5. Seeding and hand-placement
- **Tempting:** starting agents with a few beliefs "to get things going," pre-placing a camp, starting with fire, starting with a shared token meaning "food."
- **Instead:** founders are blank slates. Fire comes from lightning or from striking materials. If nothing happens for many generations, that's a finding about the floor, so take it to the owner.

### T6. Knowledge leakage
- **Tempting:** coding that agents *know* berries are food, that fire scares predators, that water quenches thirst.
- **Instead:** agents feel drives and learn which actions reduce them. Predators avoiding fire is *predator* behavior (animals are environment). Agents learn that being near fire correlates with fewer attacks, or they don't.

### T7. Sim reads analysis
- **Tempting:** `if (detectedLeader(agent)) ...` or using a detector's output to speed things up.
- **Instead:** forbidden by the import-boundary test. Agents only know what their own perception and memory give them.

### T8. Scripted external pressure
- **Tempting:** a raid event generator, a plague triggered when population passes a threshold, a "storyteller" that adds drama when things get boring (the RimWorld approach).
- **Why wrong:** the essay's external pressures (invaders, hardship) are supposed to *come from the world*.
- **Instead:** raiders are other agent populations. Disease comes from pathogen mechanics (stagnant water, carcasses, crowding). Drought comes from the climate model. Environmental randomness may never be conditioned on agent state.

### T9. Overclaiming
- **Tempting:** "Religion emerged!" because three agents coined the same token near lightning.
- **Instead:** no claim without detector + preregistered threshold + null-model comparison (`DESIGN.md` §8). Use hedged labels ("candidate shared hidden-cause cluster") until the evidence is in.

### T10. Moving the goalposts
- **Tempting:** loosening a detector's definition after seeing the data so it fires.
- **Instead:** detector definitions and thresholds are written in the experiment's preregistration *before* the run. Any change gets logged and re-applied to all prior runs.

### T11. Silent simplification
- **Tempting:** quietly dropping injury, inbreeding depression, or the calorie audit because they make things hard or slow.
- **Instead:** any removal or simplification of a designed mechanism is a decision. Write it in `DECISIONS.md` and tell the owner.

### T12. LLMs anywhere near agent minds
- **Never** in `src/sim/`. LLMs carry the whole of human culture; an LLM-driven agent founding a church is retrieval, not emergence. A future viewer feature may use an LLM to *narrate* detected events for the player, clearly labeled, with no path back into the sim.

### T13. Anthropomorphic narration
- **Tempting:** describing agent behavior in human terms in commit messages, docs, or chat ("Agent 41 felt betrayed").
- **Instead:** describe mechanisms and measurements ("Agent 41's reciprocity ledger for agent 12 went negative after two unreturned gives; approach rate dropped 80%"). Human words belong in analysis labels, marked provisional.

### T14. Scope creep and "while I'm here"
- Stay inside the current milestone. New ideas go in `STATUS.md` under "Ideas parked," not in the code.

---

## 4. The nudge protocol

Use this when a phenomenon the roadmap hopes for isn't appearing.

1. **Stop editing sim code.**
2. **Confirm the absence is real.** Does the detector fire on a hand-built positive control? (Scripted fixtures are allowed in `tests/` to validate detectors, never in sim runs.) Were the population, run length, and seed count large enough?
3. **Trace the causal chain** for that phenomenon in `DESIGN.md` §7. Every expected phenomenon has a written chain of preconditions.
4. **Measure each link** and find the first broken one.
5. **Classify the cause:**
   - (a) **Bug.** Fix it.
   - (b) **Ecological miscalibration**, meaning a parameter is implausible against its real-world target. Move it *toward plausibility*, not toward the outcome.
   - (c) **Missing mechanism.** Propose it with an alibi. Owner approval required.
   - (d) **Genuine negative result.** Under these conditions the phenomenon doesn't emerge. That's a finding. Write it up in `experiments/`.
6. **Log it in `TUNING_LOG.md` before changing code:** symptom, broken link, classification, proposed change, alibi, plausibility target.
7. For (c), or whenever the classification is ambiguous, **tell the owner and wait.**
8. After the change, re-run the **null model** too. If the null model now also "shows" the phenomenon, the change was a nudge. Revert it.

---

## 5. Pre-commit checklist for any change to `src/sim/`

- [ ] Every new mechanism, drive, gene, or primitive has an `// ALIBI:` that survives "would this exist if no society ever formed?"
- [ ] Every new heritable dial can evolve to zero (or to its "off" value).
- [ ] No agent gets information it couldn't perceive or remember.
- [ ] Any new action is one physical act, not an institution.
- [ ] Any changed parameter is logged with its plausibility target.
- [ ] All guardrail tests pass.
- [ ] `STATUS.md` updated.

---

## 6. What the owner should watch for

He asked me to self-police, but a second set of eyes helps. Signs I'm drifting:
- A commit message that says "encourage," "help," "boost," "make X more likely," or "so that X happens."
- A new parameter whose only justification is a social metric moving.
- `TUNING_LOG.md` entries classified (b) where the "plausibility target" is vague.
- Me reporting emergence without mentioning a null model.

If he points one out, the right response is to check it against this document, not to defend the change.
