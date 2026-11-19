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
- **Date:** 2026-11-15 · **Status:** Accepted; who merges superseded by D-025
- **Decision:** Each session works on a branch and opens a pull request into `main`. A GitHub Actions workflow runs the tests and type checks on every push. The owner merges.
- **Why:** The owner can't review TypeScript line by line, but he can see a green or red check and read a summary. The check runs on GitHub's machines, so it doesn't depend on Claude reporting its own results honestly.
- **Consequence:** A session must start from an up-to-date `main`. If the previous session's pull request is still open, say so before doing anything else.

### D-018: Portable math: what was built, how good it is, and proof it was needed
- **Date:** 2026-11-15 · **Status:** Accepted (carries out D-014)
- **Decision:** `src/sim/core/dmath.ts` provides `exp`, `log`, `pow`, `sinTurn`, and `cosTurn`, written with exactly-specified operations only. `rng.ts` gains `nextNormal` and `nextExponential`. Angles are measured in turns, directions are unit vectors, and there is no `atan2`. `DESIGN.md` §1.8 says how each arithmetic need of Phases 1 and 2 is met.
- **Proof the ban was needed.** The engines' own functions were compared on 200,000 random inputs each, Node 22.23 (V8) against Bun 1.4.4 (JavaScriptCore, the engine in Safari). Share of results that differed in at least one bit:

  | Built-in | Differed |
  |---|---|
  | `Math.atan2` | 18% |
  | `Math.exp`, `Math.pow`, `**` | 10% |
  | `Math.cbrt` | 8% |
  | `Math.hypot` | 5% |
  | `Math.sin`, `Math.cos` | 3% |
  | `Math.log` | 0.02% |
  | `Math.sqrt` | never |

  A simulation using any of these would give a different history in the owner's browser than in Node, from the same seed.
- **Proof the replacement works.** The same two engines produced identical digests for about 350,000 results of the portable functions and random streams, and identical state hashes for a 2,000-tick run of the kernel's test fixture. GitHub now repeats this comparison on every push.
- **Accuracy**, against a reference computed with arbitrary-precision integers (about 8,000 inputs per function, concentrated on awkward regions):

  | Function | Correctly rounded | Worst case |
  |---|---|---|
  | `exp` | 92.6% | 1 representable number off |
  | `log` | 99.75% | 1 off |
  | `sinTurn`, `cosTurn` | about 80% | 2 off (5 cases in 17,600) |
  | `pow`, fractional exponent | not measured this way | agrees with the engine's to 13 significant digits |

  `exp` and `log` also matched V8's built-ins bit for bit on 400,000 random inputs each, which is expected: both descend from the same published algorithm (fdlibm).
- **Speed** (cloud sandbox, nanoseconds per call, portable against built-in): `exp` 16 against 14; `log` 32 against 13; `pow` with a fractional exponent 69 against 48; `sinTurn` and `cosTurn` 32 against 25; a uniform draw 11; a normal draw 55; an exponential draw 36. `pow` with a whole-number exponent takes 9, faster than the built-in.
- **Choices made along the way:**
  - *Turns, not radians.* Reducing an angle modulo a full circle is the hard part of sine and cosine. In turns it is exact, which also gives exact zeros and exact periodicity. Everything periodic in the sim is a fraction of a cycle anyway.
  - *Normal draws by the polar method.* It is exact and needs only `log` and a square root. The alternative, an inverse-distribution formula, would be faster and would use one uniform draw per result, but it rests on some twenty constants and is only approximately normal. If a hot loop ever needs cheaper noise, that is the upgrade to consider.
  - *`pow` as `exp(y·log x)`.* A correctly rounded `pow` is a large piece of work and nothing here needs one. Whole-number exponents are done by repeated multiplication, so `pow(x, 2)` is exactly `x·x`.
  - *Not built:* `tan`, `atan2`, hyperbolic functions, `log2`, `log10`. Add one when a system needs it, with the same tests and a new digest.
- **Safeguards that came with it:** the recorded digests live in two places (`src/sim/core/selfcheck.ts` and the guardrail test), so the arithmetic can't change by accident; the harness runs the self-check before every batch and refuses to start if this machine's arithmetic differs; the viewer should run it in the browser (Phase 1.9).
- **Licence note:** the `exp`, `log`, sine, and cosine code is ported from fdlibm (Sun Microsystems, 1993), which allows free use provided its notice is kept. The notice is at the top of `dmath.ts`.

### D-019: Setup steps run before tick 0, only for fresh sims
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** A system may have an `init(sim)` step. `createSim` runs every setup step once, in pipeline order, after all systems are bound. `loadSim` never runs them, because the snapshot already holds what they built. The kernel refuses a setup step that spawns agents. See `DESIGN.md` §1.5.
- **Why:** The landscape has to exist at tick 0, so the first state hash and the first frame the viewer shows include it. Regenerating it on every load would cost a quarter second and, worse, would hide a loader bug behind a regenerated copy.
- **Alternatives:** Generating on the first tick (the world would be empty at tick 0); generating inside `create` (it would also run on load).

### D-020: The map generator and its one experimental knob
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** As in `DESIGN.md` §2.10. One config setting, `world.circumscription` from 0 to 1, moves the landscape from open country to a walled river valley. Everything else about the landscape is fixed by the seed.
- **How it got there** (each change was made because a rendered map or a measurement showed a problem, not to produce any social outcome):
  1. First version: lakes covered 8–15% of the map, because random relief has far more closed basins than real land. → Basins are filled 85% with sediment, and a lake must get enough inflow to offset evaporation from its surface. Lakes now cover 0–6%.
  2. Rivers started in the open desert, because all rain counted as runoff. → Runoff is rain minus evaporation, never negative.
  3. Water crossing flat ground ran in dead-straight 45° lines. → On flats, one of the equally short routes to the exit is picked by a hash, so channels meander.
  4. The knob did almost nothing below 0.75, and wet uplands beside the valley left it leaky. → The desert's edge now moves in gradually as the knob rises; the extra upstream rain falls only in the valley.
  5. A smooth valley floor sent rain down in dozens of parallel streams. → The valley floor slopes gently toward its centre line, as real ones do, so the water gathers into one river.
- **Result:** across five seeds, habitable land is 95–98% of the map at 0, 87–93% at 0.5, 68–72% at 0.75 and 32–39% at 1, where 92–94% of it is one walled valley. The landscape is identical in Node (V8) and Bun (JavaScriptCore).
- **Default 0.5**: a moderate world with some desert at the far corners. E3 sets the knob explicitly, so the default only matters for runs that don't mention it.
- **Costs:** building a 512 × 512 world takes about 0.27 s. The landscape adds about 5.5 MiB to every snapshot; hashing the full state now takes about 2 ms.
- **Known gaps:** no sea coasts, caves, river width, seasonal floods, or isolated springs in dry land.

### D-021: Sun and moon as pure functions; the moon keeps real time
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** Light comes from functions of the tick and config in `src/sim/world/light.ts`, with no state and no system (`DESIGN.md` §2.4). Day length swings 9.6–14.4 hours with the season. The moon runs a real 29.53-day cycle even though years are compressed, and rises and sets according to its phase.
- **Why:** Nights differ in how dark they are, which matters for the night-talk hypothesis (§7.6): moonlit nights should be measurably different from moonless ones. Keeping the moon on real days preserves its rhythm relative to the day, which is what agents would experience.

### D-022: The viewer page: built without tools, published two ways
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** `scripts/build-site.ts` turns the TypeScript into plain browser modules with Node's built-in type stripper (no bundler, nothing to install). GitHub Pages serves the result from this repository: `.github/workflows/pages.yml` deploys on every push to `main`, once the owner switches Pages on (Settings → Pages → Source: GitHub Actions; this session's access to that setting was blocked). Until then, and for quick looks, the same files are published as a private claude.ai artifact.
- **Safeguards:** a test builds the page and checks that the built simulation gives the same state fingerprint as the TypeScript source. The page runs the arithmetic self-check in the visitor's own browser and says plainly if it fails. The viewer only reads the sim; it advances the clock like a run would, and that's all.
- **One deliberate liberty:** a fresh world starts at midnight, so the page advances it to noon of the first day before showing it. That's the same run, twelve hours in.

### D-023: The climate, and keeping the variability knob honest
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** As in `DESIGN.md` §2.11. Weather is calibrated per real day: a two-state Markov chain for wet and dry days, exponential rain amounts, temperature from season, time of day, height and two anomalies, warm-season thunderstorms with Poisson lightning, and a daily soil-moisture bucket per cell. One config setting, `climate.variability` (default 1), scales the year-scale anomalies only. It is E1's independent variable.
- **The confound that was caught:** in the first version the wetness anomaly multiplied both the chance of rain and the amount, as exp(anomaly). Over 30 simulated years that raised average rain from 2.6 mm per day at variability 0 to 3.75 at 1 and 5.0 at 2, because the average of exp(x) grows with the spread of x. E1 asks whether a *variable* climate matters, as opposed to a wetter or harsher one, so that would have confounded the experiment. Now the anomaly scales only the amount, as exp(anomaly − spread²/2), whose average is exactly 1. Average rain stays within sampling noise across settings (a test holds it within 20%), while the spread of season-mean rain grows (a test requires at least 1.5× from 0 to 2).
- **Second correction:** storm rain first fell equally on desert and wet land, which kept desert soils at about half the moisture of wet ones. Storm rain is now scaled by each cell's mean rainfall, like ordinary rain.
- **Calibration achieved** (30 simulated years, small map, variability 1): wet days 38–43%; mean rain 2.3–2.6 mm per day where mean rainfall is 1; summer days about 17 °C warmer than winter days; a 10 °C daily swing; about 2–3 thunderstorm days per 48-day year, all in the warm half; soil moisture around 0.7 on temperate land.
- **Same on both engines:** ten days of weather on three landscapes give identical state hashes in Node and Bun; GitHub repeats this on every push.
- **Costs:** about 1.8 ms per simulated day on the 512 × 512 map (mostly the soil-moisture update), a negligible share of the per-tick budget. The soil-moisture layer adds 1 MiB to snapshots (6.5 MiB in all).
- **Known simplifications:** rain falls on the whole map at once; storms are stationary discs; rivers and lakes don't respond to droughts yet; snow isn't modelled.

### D-024: Plants: eight species, and the edible part keeps real time
- **Date:** 2026-11-15 · **Status:** Accepted
- **Decision:** As in `DESIGN.md` §2.12. One system, `world.plants`, grows eight species (grass, tuber, berry, nut, greens, bitter root, nightshade, reed) on every cell, as cover (share of the cell) and food (kilograms of the edible part). Each species is a distinct problem for a forager: synchronous and storable (grass), hidden underground (tuber), perishable (berry), a short burst that keeps (nut), safe but thin (greens), toxic raw with a delayed effect but safe processed (bitter root), toxic with no safe preparation (nightshade), and tied to water (reed). Names describe the plant, never its use.
- **Which clock each process runs on:** the plant itself (cover growing, spreading, dying back) runs on the compressed 48-day year, like any life history. Its edible part (fruit and seed ripening, rotting, and roots refilling their starch) runs on real days, like any daily physiology. So the food a square kilometre can give per day is realistic, and with it the number of people the land can feed, which experiment E3 (circumscription) depends on.
- **What changed on the way:** the first version also compressed root refilling. Measured correctly, it gave 790,000–960,000 kcal per km² per day on two seeds (inside the 50,000–1,000,000 sanity band, near the top), with roots refilling 7.6 times faster than real ones and supplying about 60% of all plant food. Refilling now runs on real days: 280,000–350,000, with roots about 10%. The price is that a patch dug bare takes about a real year (7.6 compressed years) to refill, so depletion lasts longer relative to a lifetime than it does in reality. I first reported the old version at 1.6 million; that figure came from a probe that counted the one-time harvest of the whole standing stock, and is withdrawn.
- **Two kernel lessons:** (1) a system's `create` runs before setup and before a snapshot is read, so world layers are still blank there; anything derived from them is built on the first run (now in `DESIGN.md` §1.5). The first version built its habitat map in `create`, from a blank landscape, and every plant died within two years. (2) Slow work can be staggered: each cell's cover updates every 4 days, a quarter of the map per day, in a 2 × 2 pattern so no two neighbours update together. A day on the full map went from 86 ms to 16 ms.
- **Checked:** setup limits, reeds only near water, desert sparse (a tenth of the cover of wet land), fruit only in season, nuts keeping long after their season while berries rot, all eight species alive after 50 years, a forced drought halving greens while bitter root holds and greens regrowing to 96% within four years, a snapshot taken before the first plant update resuming identically, and the food sanity band. A year of plants gives the same state hash in Node and Bun on three landscapes. Outside the tests, 20 seeds × 100 years on small maps (sweeping both knobs) lost no species and grew none without bound.
- **Not done here:** seed dispersal by animals (moves to 1.5) and by agents (§7.13, once agents eat); nutrients other than calories, which nothing consumes yet.

### D-025: More autonomy: Claude merges its own work, and nightly unattended runs
- **Date:** 2026-11-16 · **Status:** Accepted
- **The owner's words:** "I think you should decide really as much as you want as long as it's inline with the primary goal. If the merging is a matter of permission, you have permission."
- **Decision:** Claude merges its own pull requests once GitHub's checks pass, and decides questions inside a milestone without asking, recording them here. A scheduled task runs one milestone a night (`CLAUDE.md`, "Unattended nightly runs"), starting the night of 2026-11-18, after the owner's weekly usage resets. Supersedes D-017's "the owner merges"; the rest of D-017 stands.
- **What still waits for the owner:** nudge-protocol changes classified (c) or ambiguous, new drives, and merging any work that reports a social phenomenon emerged. These are the points where drift toward pre-coded outcomes is most likely, and the guardrails already require his approval for the first two.
- **Why:** The owner doesn't read code, so his merge was a checkpoint rather than a review, and it made every milestone wait for him. GitHub's checks still run on its machines, independent of what Claude reports. The owner sees each night's result as a notification and can stop the schedule at any time.
- **Checked:** merging through the REST API works with this project's GitHub access (pull request #6 was merged that way).

### D-026: Animals: groups, real-day demography, and two kinds of forage
- **Date:** 2026-11-16 · **Status:** Accepted
- **Decision:** As in `DESIGN.md` §2.13. One system, `world.animals`, after the plants: deer, aurochs, wolf packs and big cats as groups in an entity store `animals`; hares as a density layer; vultures as one number for the map; carcasses as meat per cell. Plants gained two forage stocks (grass-like `plants.forage`, leaves and shoots `plants.browse`) and a seed-rain layer animals drop seeds into.
- **Clock:** extends D-024. A whole animal is food, so eating, hunting, births and deaths run on real days and only the birth season follows the compressed year. Consequence: animal populations change on real-year timescales; a hunted-out area recovers over many compressed years.
- **Kernel addition:** `spawnEntity(state, store)` creates non-agent entities and refuses the agents store, so the guardrail that only the kernel assigns slots still holds (agents only through `spawnAgent`).
- **Calibration:** wolves kill about 0.09 ungulates per wolf per day here, against 0.018–0.12 in field studies (`RESEARCH.md`); big cats about 0.09 deer per cat per day. Other starting numbers are estimates; the ecology review (1.10) judges them.
- **Persistence (outside the tests):** on the full map (seed 2), 100 compressed years kept every kind: deer 9,300–17,300, aurochs 680–1,350, wolves 40–66, big cats 26–40, no plant species below 80% of its start. On four 256-cell maps, three kept everything; in a small hemmed-in valley with large climate swings (seed 3), wolves and big cats died out. Greens and reeds still fall hard under large swings (droughts, already noted for plants).
- **Getting there took eleven rounds (T-004).** The two that mattered most were real ecology I had left out: a wolf pack raises one litter a year however big it is, and packs hold large separate ranges; and deer mostly browse while aurochs graze, with plants keeping an ungrazable base. Without them, predators overshot and deer or aurochs went extinct.
- **Cost:** about 38 ms per simulated day for animals on the full map (63 ms with plants and climate). The page at 1 year per second now runs slower than chosen.
- **Not done:** fire avoidance (1.8), disease in carcasses (1.6), animals noticing agents (Phase 3), predator injuries.

### D-027: Pathogens as loads in water and meat
- **Date:** 2026-11-17 · **Status:** Accepted
- **Decision:** As in `DESIGN.md` §2.14. One system, `world.pathogens`, after the animals: a load (0 to 1, a share of a full bloom) in every water cell and in every cell's carcass meat. Standing water blooms in warm weather and clears slowly in the cold; rivers and springs flush most of their load daily; carcasses foul nearby water; meat goes foul with degree-days above 4 °C and is diluted by weight when fresh meat joins it. Real days, like all daily physiology. No randomness: the loads are deterministic fields, and chance enters only when a body drinks or eats (Phase 2).
- **Why loads, not organisms:** agents can never see pathogens, so only the risk matters, and a load per cell is the cheapest form a body can read. It also makes the hidden cause learnable but noisy: the same lake is safe in spring and dangerous by late summer.
- **Checked:** lakes reach about half a bloom in late summer and fall back in winter; rivers stay near 0.005; a carcass beside a river fouls it and the river runs clean within days of it going; meat is over half foul after five summer days. Node and Bun agree over a year.
- **Not done:** downstream transport in rivers, infection of wounds, cooking (need fire and bodies).

### D-028: Chained runs until the weekly reset
- **Date:** 2026-11-17 · **Status:** Accepted
- **The owner's words:** "Since my reset happens on Wednesday at 7:59pm, you can calculate your token usage and whatnot and schedule as many sessions as you want in that time frame sequentially (like after you complete a task, scheduling the next for a few minutes later)."
- **Decision:** Until 2026-11-18 at 7:59 pm Central, each run that merges a milestone schedules the next run about 5 minutes later, with the same prompt (`CLAUDE.md`, "Chained runs"). The chain stops at an [F] milestone, at an owner decision, at a usage limit, or at the reset; the nightly task (D-025) takes over from 2026-11-19.
- **Note:** Claude can't see the owner's usage meter, so "how many sessions fit" isn't calculated in advance; the chain runs until the limit or a stopping point, and each run pushes as it goes so nothing is lost when a limit cuts it off.

### D-029: Materials as stocks until picked up; striking and shelter as physics functions
- **Date:** 2026-11-17 · **Status:** Accepted
- **Decision:** As in `DESIGN.md` §2.15. One system, `world.materials`, after the pathogens: bedrock, loose stone per material and fallen wood per cell, rock shelters made before tick 0, and daily rotting of fallen wood and of objects. Individual objects (store `objects`) exist only once something takes a piece from the loose stock or breaks one off, so the map holds kilograms per cell rather than millions of entities. Striking (`strikeObjects`) and shelter (`createShelterProbe`) are functions that bodies and minds will call; the analysis layer reads the layers and stores.
- **Why stocks:** a 512 × 512 map would need millions of stones and sticks as entities, which would multiply snapshot size and per-tick cost for objects nothing has touched. Agents perceive material *categories* in a place (§4.1), which a stock answers; a piece becomes individual exactly when an individual history (being carried, struck, dropped somewhere) starts.
- **Why these materials:** each gives the world a distinct physical problem without a use-label. Flint gives keen edges easily, quartzite less well, and granular stone never. Iron sulfide is the one stone that makes hot sparks, and only when struck by something harder, so fire from sparks has to be found in a specific, rare pairing (flint and iron sulfide are both nodules of limestone country, in different patches). Wood snaps, burns and rots; hides insulate and shed rain but rot within weeks unless something is done to them.
- **Clock:** fallen wood on the compressed year (tree life history); hides on real days (like meat).
- **Not tuned:** no parameter was adjusted to make anything happen; the numbers are first estimates (`RESEARCH.md`, *Materials*). One change during building: iron sulfide was first 0.3% of limestone's loose stone and shared flint's patches; on the page it covered most rocky limestone, so it became 0.1% in its own patches. That is an abundance estimate, not an outcome target.
- **Confound noted for E3:** the circumscription knob makes cliffs, cliffs make rock shelters (about 34 per 100 km² walled, 1.5 open, 14 at the default). It stays because it is real geography; E3's preregistration must account for it.
- **Cost:** about 5 ms per simulated day on the full map, and about 8 MB more per snapshot (eight new layers).
- **Not done:** bones and antlers, rubbing (abrasion and friction heat; friction heat moves to 1.8 as an ignition source), tinder and fuel moisture (1.8), cutting and curing hides (Phases 3–4).
### D-030: Claims, a run log, and a weekly cap for unattended runs
- **Date:** 2026-11-17 · **Status:** Accepted; supersedes D-028's end date and the once-a-night schedule of D-025
- **What happened:** the first chained run's one-shot task fired twice, 11 seconds apart. Both sessions built Phase 1.7 in full (one 971-line and one 811-line version, both passing GitHub's checks); the second found the branch name taken and parked its work; neither wrote the docs, opened a pull request, or scheduled the next run. One milestone's work was paid for twice.
- **Decision:** (1) A run claims its milestone first by pushing an empty commit to `milestone-<number>`; a rejected push, or a branch with a commit under 3 hours old, means another run has it. (2) Every run that works on a milestone logs one line in `docs/RUNS.md`. (3) Chains continue all week, capped at 35 runs per reset week. (4) The scheduled task wakes a fresh session every 6 hours instead of once a night, to restart a stopped chain.
- **Why these numbers:** the owner measured the double run at 3% of his weekly limit and 22 points of a 5-hour window, so about 1.5% and 11 points per milestone run. He wants about 10% of the week for himself. At that rate 35 runs cost about 50–55%, leaving room for heavier milestones (Phase 1.5 was several times larger). The real bottleneck is the eight [F] milestones left through Phase 6 (1.10, 2.8, 3.1, 3.7, 4.5, 5.1, 5.5, 6.1), which wait for him to start a Fable session.
- **Which 1.7 to keep:** `phase-1.7-materials` (it covers striking and sparks, which the roadmap names, and is the branch the rules carry on). The parked version adds bone and skin from carcasses and an observer; it stays on GitHub as a source for later.

### D-031: Fire as fuel, weather and minimum travel time; wind and litter join the world
- **Date:** 2026-11-17 · **Status:** Accepted
- **Decision:** As in `DESIGN.md` §2.16. One system, `world.fire`, last in the pipeline: lightning, sparks (`sparksAt`), friction embers (`rubWood`) and burning objects light dry, cured fine fuel; spread follows Cheney's grassland rates with moisture, curing, fuel, canopy and slope factors, an elliptical shape from the wind (Alexander 1985), and minimum travel time between cells; cells that stop flaming smoulder in their wood, flare up when the litter dries, and go out in rain or by themselves; wood objects burn, pass fire to each other, can be carried while burning, and can light the ground. A fire probe gives light and radiant heat at a point. Animals keep away from fire (predators from any, all animals from burning cells); hares die and carcass meat is heated in flaming cells.
- **New world state:** wind (two numbers in the weather, on a new `WIND` stream, so the rest of the weather draws exactly what it drew before) and fine dead fuel (`materials.litter`, kept by the materials system like fallen wood). `GLOBAL_STREAM_SLOTS` went from 8 to 16 to make room for `WIND` (7) and `FIRE` (8); existing streams are seeded as before.
- **Why minimum travel time:** a random roll per neighbour lets a front of many cells take the luckiest roll, so fires outran their own rate several times over off the wind axis and filled whole landscapes (T-005, round 10). With travel times, each cell burns exactly when the fire gets there, and a small random vigour per cell keeps edges irregular.
- **Ignition by agents is physics, not a gift:** sparks need iron sulfide struck by harder stone (D-029) and dry, cured litter; friction needs dry wood and about 2.5 kJ concentrated in the dust. Nothing in the sim knows what fire is for. Fire is never started by the sim except by lightning, as `GUARDRAILS.md` T5 requires.
- **Clock:** ignition and spread on real days (weather); fuel on the compressed year (plant life history). Fire return intervals in compressed years are therefore about 7.6 times longer than in real years, the same trade the storms make.
- **Calibration:** eleven rounds, logged before each change (T-005), all against ecological targets (spread rates, fire shape, rain and night stopping fire, lightning-fire frequency and burned area in temperate land). No social measure exists yet, and none was looked at.
- **Result:** in the default climate fires are rare and mostly small (two fires of 18 and 3 cells in 30 years on a 256-cell map; none in 20 years on the full page world); lightning in spring and early summer makes holdovers that die in green fuel. In severe droughts on open plains a fire can still burn nearly the whole map. That is for the ecology review (1.10 [F]), together with the missing limiters listed in §2.16 (spotting, a water table, sub-cell patchiness).
- **Cost:** about 0.6 ms per quiet simulated day on the full map; materials 4.4 ms with the litter; a large fire adds tens of ms per day while it burns. Snapshots grow by about 2.3 MB (litter, stage and last-burn layers).
- **Not done:** cooking (Phase 2), spotting, crown fires, smoke, fire killing animal groups, stone heat-treatment, abrasion from rubbing.

### D-032: Ecology review (1.10): Phase 1 does not exit yet; two fixes in, fire goes to 1.11
- **Date:** 2026-11-18 · **Status:** Accepted
- **Who:** Opus 5.5 on an [F] milestone, at the owner's request (no Fable credits).
- **Decision:** The preregistered exit check failed on persistence (every hemmed valley lost its deer and, in most, its predators) and on fire (open plains burn all-or-nothing, 1.0–3.6% of land per compressed year against 0.5%). Three corrections went in (T-006): no herbaceous litter on ground burned that year; starting numbers per km² of habitat; hungry grazers search 3 km. A follow-up on 8 of the 20 worlds passes persistence everywhere but still fails fire. Phase 1 stays open: a new milestone, **1.11 [O]**, recalibrates fire on open country to the grassland band (`DESIGN.md` §2.16, end) and re-runs the full check. Phase 2 waits for it.
- **Why 1.11 is [O]:** the diagnosis is done and the targets and levers are written down; what is left is careful, logged calibration. Tagging it [F] would stop the project while the owner has no Fable credits.
- **Why Phase 2 waits:** bodies don't depend on the fire regime, but the check also has to confirm persistence on all 20 worlds, and E3's walled valleys are exactly where the ecology failed. Building agents on an unconfirmed world is how nudges start.
- **Kept for later (`STATUS.md`, risks):** open-country deer settle at 11–18 per km², above field densities with wolves (3–6); greens are browsed down hard on some open seeds; predators in walled valleys number a dozen or fewer.

### D-033: Fire 1.11 stops at an owner decision: fire size needs breaks in the fuel
- **Date:** 2026-11-19 · **Status:** Accepted (the work); the question is open (STATUS Q9)
- **Who:** Opus 5.5, unattended run.
- **Decision:** Five physical corrections to fire go in (T-007): dew on fine fuel; the light-wind form of Cheney et al.'s moisture limit (20% under 10 km/h; a bug: only the 24% form had been coded); rain water held in litter for about two-thirds of a day (a small state part, `fire.wetting`, keeps the map-wide wet-day amount and the last four storms); storm rain heaviest at the core and nothing at the edge, same total (in `climate.ts`, so soil moisture follows it too); lightning holdovers going out at 1.5% an hour instead of 6%. Each is sourced and logged before the change. None limits fire *size*, and the open-country regime is now 2.75% of land per compressed year on 8 quarter-size worlds (1.45% before), with fires that get going burning most of the map. Hemmed valleys sit at 0.21%.
- **Why stop:** what is missing is a mechanism, breaks in the fuel (sub-cell patchiness of fuel, and moist ground along streams), both already listed in `DESIGN.md` §2.16 as not in this version. A new mechanism is a nudge-protocol (c), which waits for the owner (`GUARDRAILS.md` §4, D-025). Tuning a number further (for example how long holdovers last) could move the average into the band, but every fire that escapes would still take the map, so the preregistered worst-year limit could not pass; and choosing numbers by which way the check comes out is what T4 forbids.
- **Why the corrections stay in although the average got worse:** each is physically right, and they turn the regime from "a few huge fires" into "many fires, some small, the big ones bounded only by the map", which is the regime fuel breaks act on. Reverting the ones that raised the average because they raised it would be choosing physics by outcome.
- **Why the full check was not re-run:** the fire criterion cannot pass until sizes are limited; the 75-minute run is better spent after the owner's answer.
- **Pull request left open** (D-025, `CLAUDE.md` unattended rule 6).
