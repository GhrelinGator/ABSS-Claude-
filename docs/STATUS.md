# Status

Update this at the end of every session. Newest information at the top of each section.

## Current state

- **Done:** Phase 0 (foundations), 1.0 (portable math), 1.1 (map generator), 1.2 (climate and soil moisture), 1.3 (sun, moon, and fire light), 1.4 (plants), 1.5 (animals, with grazing, browsing, seeds carried by animals, and keeping away from fire), 1.6 (pathogens in water and carcasses), 1.7 (materials and objects), 1.8 (fire, with wind and litter), 1.11 and 1.12 (fire corrections, a water table, bare ground), and a viewer (1.9) that shows all of it.
- **The world has weather and wind, plants, animals, stone, fallen wood and litter, and fire; no people.** The real pipeline has seven systems: the landscape (built before tick 0), the climate, the plants, the animals, the pathogens, the materials, and fire. Nothing has emerged, because nothing can yet.
- **Next action:** Phase 1.13 [F] (runs on Opus, D-034): open seed 6's deer starve beside greens they never eat; diagnose, then fix by the nudge protocol (`ROADMAP.md` 1.13; `experiments/P1-ecology-review/results.md`, last section; D-036). A full-size open world takes about 8–10 minutes for 100 compressed years on one core, so test on single seeds (`npm run experiment` with a one-seed spec, or `experiments/P1-fire-regime/diagnose.ts` for fire). Then re-run the full exit check: the owner accepted fire's failure as a known limit (Q10, D-037), so Phase 1 exits when the other four criteria pass, with fire reported as failed, not hidden. Runs chain one after another, up to 35 a week, and a scheduled task wakes every 6 hours (`CLAUDE.md`).
- **Blocked on:** nothing. Phase 1 has not exited: the re-run of the exit check (2026-11-19) fails on fire (mean 0.64% of land a compressed year against 0.5%, worst year 87% against 25%) and on persistence (open seed 6). From 2026-11-16 Claude merges its own pull requests once GitHub's checks pass, except work waiting on an owner decision (D-025, `CLAUDE.md`).

## What exists

| Where | What |
|---|---|
| `src/sim/core/` | random streams, state hash, snapshot encoding, entity stores, grid layers, spatial index, calendar, mechanism registry, run-time audits |
| `src/sim/core/dmath.ts`, `selfcheck.ts` | portable `exp`, `log`, `pow`, `sinTurn`, `cosTurn`; the arithmetic self-check |
| `src/sim/sim.ts` | state container, tick loop, save/load, `spawnAgent` |
| `src/sim/pipeline.ts` | the real update order: the landscape, the climate, the plants, the animals, the pathogens, the materials, fire |
| `src/sim/readonly.ts` | the only door the analysis layer may use |
| `src/sim/world/terrain.ts`, `noise.ts` | the map generator, with the water table and bare ground (`DESIGN.md` §2.10) |
| `src/sim/world/light.ts` | sun, moon, and starlight (`DESIGN.md` §2.4) |
| `src/sim/world/climate.ts` | weather, storms, lightning, soil moisture fed by rain and the water table (`DESIGN.md` §2.11) |
| `src/sim/world/plants.ts` | eight plant species: cover, fruit and seed seasons, roots, drought dieback, spreading, forage for grazing and browsing, seed rain (`DESIGN.md` §2.12) |
| `src/sim/world/animals.ts` | deer, aurochs, wolf packs, big cats, hares, vultures, carcasses (`DESIGN.md` §2.13) |
| `src/sim/world/pathogens.ts` | pathogen loads in water and carcass meat (`DESIGN.md` §2.14) |
| `src/sim/world/materials.ts` | eight materials, bedrock, loose stone, fallen wood and litter per cell, rock shelters, objects, striking (flakes, crumbs, snapping, sparks), rotting, and shelter at a point (`DESIGN.md` §2.15) |
| `src/sim/world/fire.ts` | fuel moisture (with dew and rain held in litter) and curing, spread by minimum travel time across patchy fuel, smouldering, lightning holdovers, sparks and friction embers, burning objects, light and heat at a point (`DESIGN.md` §2.16); wind lives in `climate.ts` |
| `src/sim/signal/layer.ts` | the `SignalLayer` interface, as a stub for Phase 5 |
| `src/analysis/` | observer interface; `census` (a head count), `landscape` (the E3 manipulation check), `weather` (the E1 manipulation check), `vegetation` (cover per species and calories standing), `fauna` (animals per km², kills, births, deaths), `pathogens` (loads by kind of water, and in carcass meat), `materials` (loose stone by material, fallen wood, rock shelters, objects), `fire` (burning now, ignitions by cause, land burned in the last year, litter, wind) |
| `src/viewer/`, `scripts/build-site.ts` | the viewer page and its no-install build (`DESIGN.md` §10.1) |
| `src/harness/` | experiment specs, batch runner on worker threads, manifests, JSONL metrics, command line |
| `bench/` | speed benchmark with a scripted stand-in load; timing of the math functions |
| `tests/guardrails/` | the nine guardrail tests (`GUARDRAILS.md` §1) |
| `tests/cross-engine/` | prints digests so two JavaScript engines can be compared |
| `tests/unit/`, `tests/harness/` | tests of the kernel pieces and the harness |
| `experiments/C0-smoke/` | a plumbing check for the harness, not an experiment |
| `experiments/P1-ecology-review/`, `experiments/P1-fire-regime/` | the Phase 1 exit check (preregistered) and the 1.11 fire diagnosis (`diagnose.ts` logs every fire) |

About 15,200 lines of TypeScript including tests after session 13 (fire alone about 1,950); about 9,600 after session 7 (7,800 after session 5 ; 6,000 after Phase 1.0; Phase 0 alone was about 4,900, where the roadmap guessed 1,500–2,500), so **treat the roadmap's size estimates as low by roughly half.**

## Decisions needed from the owner

Nothing is blocking: Q10 was answered on 2026-11-19 (D-037). Q9 was answered on 2026-11-19 (D-034). Answered on 2026-11-15 (D-012): the game gets its own page. Everything else was left to Claude and took the defaults: observer, TypeScript, long runs on the owner's computer, the name ABSS.

| # | Question | Needed by |
|---|---|---|
| Q10 | *Answered 2026-11-19 (D-037):* accept it as a known limit. Phase 1 exits with the fire criterion reported as failed; the open plains keep a huge autumn fire every few decades; E3 counts fire as a difference between open and walled land; a patchier woodland is parked. | — |
| Q6 | *Resolved 2026-11-15:* Pages publishes from GitHub Actions, at https://ghrelingator.github.io/ABSS-Claude-/. If a "pages build and deployment" run (GitHub's README build) ever appears after a merge again, the source has been switched back. | — |
| Q9 | *Answered 2026-11-19 (D-034):* yes to both breaks in the fuel: patchy ground from the soil and rock already on the map, and damp ground along rivers and springs. Milestone 1.12. | — |
| Q8 | Plants kept up on the owner's phone at "1 year per second" (answered 2026-11-16). With animals a day costs about four times as much; does it still keep up? If not, the page could skip ahead in bigger steps or cap the speed. | Whenever |
| Q7 | *Answered 2026-11-16:* a Windows desktop, Intel Core i5-4670 (4 cores, 4 threads, 3.4 GHz, 2013), 32 GB of memory, an RTX 3080 graphics card. That means 3–4 runs side by side, and overnight batches for big experiments. The graphics card can't run the simulation: results must be bit-identical on every machine. Nothing is installed yet; in Phase 3, install Node and link the Claude desktop app so a session can run batches there, and stop the PC sleeping during runs. | Phase 3 |
| Q1 | Player role, if observer-only turns out not to be what he wants (D-011). | Phase 9 |

## For a Fable second look

[F] milestones done on Opus while the owner has no Fable credits (D-034), and Opus work that leaned on [F]-type diagnosis. A Fable session starts here: re-check each judgment call listed, record what it finds in `DECISIONS.md`, and strike the entry.

| Milestone | Pull request | Judgment calls to re-check |
|---|---|---|
| 1.10 Ecology review (2026-11-18, attended) | #14 | The diagnosis of the walled-valley collapse: a start about 3× too crowded, and hungry grazers searching 3 km (T-006 round 3, a borderline missing mechanism). Whether Phase 1 was right to stay open. The fire targets and levers written into `DESIGN.md` §2.16. |
| 1.11 Fire regime (2026-11-19, unattended; tagged [O] but mostly diagnosis) | #15 | That fire *size*, not the number of ignitions, is the problem. The five corrections (T-007), kept although the average burned area rose. That breaks in the fuel are the missing piece. |
| 1.12 Breaks in the fuel (2026-11-19, unattended) | #16 | The water table's design: level with the nearest drained-to water, small streams from 0.5 km², capillary rise 6 mm × e^(−depth/0.6 m) (D-035). The patchy-fuel physics (percolation of discs at 0.676, reach half the Byram flame length). Merging although open seed 6 collapsed (D-036). That no calibration round was made, and the classification of what remains in fire as ambiguous (T-008, Q10). |

## Benchmarks

**2026-11-15, Phase 0.4.** Cloud sandbox: Intel Xeon 2.30 GHz, 2 virtual cores, Node 22.23. Two runs; they differed by about 12%.

| Agents | Ticks per second | Microseconds per agent per tick |
|---|---|---|
| 100 | ~11,100–11,200 | ~0.89 |
| 500 | ~3,700–4,200 | ~0.48–0.54 |
| 2,000 | ~1,100–1,300 | ~0.39–0.45 |

- The load is a scripted stand-in (movement, energy bookkeeping, a neighbour scan), far cheaper than real perception and learning.
- The target in `DESIGN.md` §1.3 allows 6.94 microseconds per agent per tick. The kernel plus stand-in used 7–8% of it.
- Hashing the whole state or saving a snapshot took well under a millisecond at these sizes (no world layers yet).
- Full reasoning and what it demands of Phase 3: `DECISIONS.md` D-016.

**2026-11-19, Phase 1.12.** The full exit check (20 worlds × 100 compressed years) took 71 minutes on 2 cores: open worlds 6–10 minutes each (large fires cost more with the patchy-fuel spread), hemmed worlds 4–5.

**2026-11-17, Phase 1.8.** Fire costs about 0.6 ms per quiet simulated day on the full map (it only checks the tick's lightning strikes); a large fire adds tens of ms per day while it burns. Materials, with the litter, about 4.4 ms. In this run's measurement a full-map day took about 87 ms in all (animals 52, plants 25); the sandbox's speed varies between sessions. Snapshots grow by about 2.3 MB.

**2026-11-17, Phase 1.7.** Materials add about 5 ms per simulated day on the full map (fallen wood rotting in every cell); building a world takes about 0.1 s longer. Snapshots grow by about 8 MB.

**2026-11-16, Phase 1.5.** A day on the full map now takes about 63 ms: animals about 38, plants about 21 (forage added a little), climate 2. Building a world takes about 0.45 s.

**2026-11-15, Phase 1.4 (world systems, same sandbox).** On the 512 × 512 map: a day of plants takes about 16 ms, of climate about 2 ms. That averages 0.13 ms per tick, small next to the agent budget, but at "1 year per second" the page computes 48 days a second: about 0.8 s of work per second on this machine, more on a phone. Building a world takes about 0.4 s. Snapshots grow by 16 MiB (two layers per species).

## Known risks

- **Compute budget** (`DECISIONS.md` D-016). About 6 microseconds per agent per tick is left for bodies and minds. That is tight. Phase 3.1 has to design for it and measure a prototype before building on.
- **Portable math is in place** (D-014, D-018), and measurement showed it was needed: two engines' built-in `exp` disagreed on 10% of inputs. What remains a risk is discipline: a system that needs a function `dmath.ts` lacks (`atan2`, say) has to add it properly, with tests and a digest, not reach for the built-in. The guardrail test blocks the built-ins.
- **Founder viability.** Blank-slate founders may die before learning enough. Viability tuning is allowed (logged), but if it takes heavy tuning, the floor may need rethinking. That's a conversation with the owner, not a quiet fix.
- **Floor 1 expressiveness** (`DESIGN.md` §6.7). The legitimation chain may be inexpressible with unordered token bags.
- **Claude's drift** (`GUARDRAILS.md`). The guardrail tests catch words, imports, and bookkeeping. They can't judge whether an alibi is true or whether a number was tuned toward an outcome.
- **Long-run plant balance** (for 1.10). In 20 seeds × 100 years on small maps, no species died out and none grew without bound, but greens and reeds fell to about a fifth of their starting cover in runs with large year-to-year swings: riverbank soil dried in a drought like any other. Since 1.12 a water table keeps stream banks moist (`DESIGN.md` §2.11). Animals add grazing pressure on top: on open land, deer browse greens down to 28–66% of their start.
- **Fire regime after 1.12** (D-036). With the water table and bare ground, open country burns 0.95% of its land a compressed year and hemmed valleys 0.32%, but a dry autumn can still burn most of an open world (worst year 87%). Q10.
- **Open seed 6** (D-036, 1.13). Deer starve beside greens they never eat; on `main` it held at 4.4 per km² or more, with 1.12 it collapsed and the predators went.
- **Fire regime** (for 1.10). Fires are rare and mostly small in the default climate, which fits humid temperate land, but in a severe drought on an open plain one fire can burn nearly the whole map. Limiters real landscapes have and this model lacks: moist riverbanks (no water table), patchy fuel inside a cell, and spotting (which would make fires bigger, not smaller). Eleven rounds of correction are in T-005; the next look should be by fresh eyes.
- **Rock shelters follow the circumscription knob** (for E3, D-029). Cliffs come with walls, so a walled valley has about 34 rock shelters per 100 km² and open country about 1.5. That is real geography, but E3's preregistration has to account for it.
- **After the ecology review (D-032):** open-country deer settle at 11–18 per km², above field densities with wolves (3–6 per km² in Białowieża); greens are browsed to a quarter to two-fifths of their start on some open seeds; predators in walled valleys number a dozen or fewer, so long runs can lose them by chance.
- **Animal balance** (from 1.5, reviewed in 1.10). Predators die out on a small, hemmed-in map with large climate swings; deer gather in tight clusters on the best browse; most animal numbers are estimates (`RESEARCH.md`). Eleven rounds of correction went into the current balance (T-004), so it should be reviewed by fresh eyes, not just extended.
- **Root refilling rates are estimates** (T-003). Real tuber turnover hasn't been looked up yet; Phase 3's foraging-return calibration will test it.
- **Claude can't watch.** I read numbers; the owner can see behaviour in the viewer once it exists. Odd behaviour he notices is high-value input. Ask him what he's seen.
- **Some checks only run on GitHub.** The full type check of the harness, tests, and benchmark needs the `@types/node` package, which cloud sessions may not be able to install. The simulation and analysis code can be type-checked locally; the rest is checked by the GitHub workflow. For Phase 0 that workflow passed every step (tests and both type checks) on pull request #1.

## Ideas parked (not in scope until a phase claims them)

- A patchier woodland (closed groves that stay damp and calm, open glades between), for when the plants are next revisited; it would also bound fire on the open plains (D-037).
- Conquest for territory and self-sacrifice for the group (needs a higher language floor).
- Writing emerging from marks on objects ("learning from books").
- Containers (hide + fiber), which would change storage dynamics.
- LLM narration of detected events in the viewer, display-only (`GUARDRAILS.md` T12).
- God mode (`DESIGN.md` §10), if the owner wants it.
- Running the decide phase of a tick in parallel (`DESIGN.md` §1.6 leaves room for it).
- A guardrail that scans commit messages for "encourage", "boost", and similar words (`GUARDRAILS.md` §6).

## Session log

- **2026-11-19, session 18** (Opus 5.5, claude.ai; same chat). The owner answered Q10: accept fire on the open plains as a known limit (D-037). Restarted the chain on 1.13, which the 1.12 run had not scheduled.
- **2026-11-19, session 17** (Opus 5.5, unattended chained run). Milestone 1.12 [F] on Opus, breaks in the fuel (D-035): a water table level with the river, lake, spring or small stream each cell drains to, which keeps stream banks moist from below; bare ground by soil; fire crossing patchy fuel only where its flames bridge the gaps. The water table and bare ground show in the page's inspector. Re-ran the full preregistered exit check: fire better (mean 0.64% against 1.24%, worst year 87% against 174%) but still failing, and open seed 6 lost its deer and wolves (fragile on `main` too). No calibration round: nothing left in fire would bound fire size (T-008). Merged; 1.13 diagnoses open seed 6; fire waits for the owner (Q10, D-036).

- **2026-11-19, session 16** (Opus 5.5, claude.ai; same chat). The owner answered (D-034): yes to both breaks in the fuel (Q9); scheduled runs take [F] milestones and list them for a Fable second look; new mechanisms with no social content (the world, agents' bodies) no longer wait for him; keep the chain going. Closed a gap: the weekly cap now stops wake-up runs too. Merged #15 and started the chain on 1.12.
- **2026-11-19, session 15** (Opus 5.5, unattended run). Milestone 1.11, fire on open country. Wrote a diagnostic that logs every fire (`experiments/P1-fire-regime/diagnose.ts`) and found the problem is size, not ignitions: fires creep through nights and come back after rain. Five corrections, each logged before the change (T-007): dew; Cheney's light-wind moisture limit (a bug); rain held in litter about two-thirds of a day; storm rain heaviest at the core (`climate.ts`); lightning holdovers lasting about two days. None limits a fire's size once it is going; that needs breaks in the fuel, a new mechanism, so the run stopped for the owner (Q9, D-033). Pull request left open; full exit check not re-run.

- **2026-11-18, session 14** (Opus 5.5, claude.ai; same chat). Did the ecology review (1.10, an [F] milestone) at the owner's request. Preregistered the Phase 1 exit check and ran it: 20 full-size worlds for 100 compressed years. It failed on persistence (hemmed valleys collapsed) and fire (open plains burn all-or-nothing). Fixed three causes (T-006), confirmed on 8 worlds, and wrote milestone 1.11 for the rest of the fire work (D-032). Checked big-cat, bison and hare numbers against sources (`RESEARCH.md`).
- **2026-11-17, session 13** (Opus 5.5, unattended chained run). Built Phase 1.8: fire (`DESIGN.md` §2.16, D-031), with wind added to the weather on its own stream, fine dead fuel (litter) added to the materials, fire light and heat at a point, and animals keeping away from fire. Spread uses minimum travel time and an elliptical fire shape after a random-roll version let fronts outrun their rate. Eleven calibration rounds, each logged before the change (T-005): fires first never started, then burned half the map, then settled at rare and mostly small. A `fire` observer, a Fire layer on the page, live fire on every layer, wind in the weather line, fuel in the inspector. The next milestone (1.10) is [F], so the chain stops here.

- **2026-11-17, session 12** (Opus 5.5, claude.ai; same chat). The first chained run fired twice; two sessions built 1.7 and neither finished. Added claims, a run log (`docs/RUNS.md`), a weekly cap of 35 runs, and a 6-hourly wake-up (D-030), using the owner's usage readings. Restarted the chain to finish 1.7.
- **2026-11-17, session 11** (Opus 5.5, unattended chained run). Built Phase 1.7: materials and objects (`DESIGN.md` §2.15, D-029): bedrock, loose stone with flint and iron-sulfide nodules in limestone country, fallen wood that rots, rock shelters and caves, an `objects` store, striking physics (flaking, crumbling, snapping, hot sparks only from iron sulfide), and shelter at a point from rock, plants and piled objects. A `materials` observer and Stone and Wood layers on the page. No tuning. Took the roadmap's "sparks" to mean producing them; whether one catches is fire's (1.8), as is friction heat from rubbing.

- **2026-11-17, session 10** (Opus 5.5, claude.ai; same chat). Built Phase 1.6: pathogen loads in water and carcass meat (`DESIGN.md` §2.14, D-027), a `pathogens` observer, and hidden loads in the page's inspector. No tuning needed. At the owner's request, set up chained runs until his weekly reset (D-028) and started the chain for 1.7.
- **2026-11-16, session 9** (Opus 5.5, claude.ai; same chat). Built Phase 1.5: animals (`DESIGN.md` §2.13, D-026), grazing and browsing stocks and seed rain in the plants, the `fauna` observer, animals on the page, and `spawnEntity` in the kernel. Took eleven rounds of correction (T-004); persistence over 100 compressed years checked on five maps. Merged its own pull request (D-025).
- **2026-11-16, session 8** (Opus 5.5, claude.ai; same chat). No code. Measured what a milestone costs: Phase 1.4 took 86 requests and about 3.1 million tokens of usage, 60% of it Claude's fixed instructions re-read on every step, so cost follows the number of steps. Estimated 150–250 million more through Phase 6. The owner answered Q7 and gave Claude broad autonomy (D-025): Claude now merges its own pull requests (merged #6), and a nightly scheduled task does one milestone at a time from the night of 2026-11-18. Ideas from the owner's side, for later: another AI as an outside skeptic of emergence claims, an anthropology professor's view on the detector definitions (Phase 6), and paywalled papers through his university library.
- **2026-11-15, session 7** (Opus 5.5, claude.ai; same chat). Owner merged #4 and #5. Built Phase 1.4: eight plant species (`DESIGN.md` §2.12, D-024), the `vegetation` observer, and Plants and Ripe layers on the page. Mistakes caught on the way: the habitat map was first built before the landscape existed, so everything died (rule added to `DESIGN.md` §1.5); a division by zero put NaN in plant cover (the non-finite guardrail now runs a full year and was shown to catch it); and I misreported the old root-refilling version's food at 1.6 million kcal per km² per day, an artifact of my probe (corrected in D-024 and T-003). Moved root refilling to real days (T-003). Made the plant update 5× faster by staggering slow work. Lengthened the Node-vs-Bun comparison to a full year. Opened pull request #6.
- **2026-11-15, session 6** (Opus 5.5, claude.ai; same chat). Owner switched the Pages source to GitHub Actions; the live site now shows the viewer (redeployed by hand once). At the owner's request, added switches for day-and-night and weather effects, off automatically above 1 day per second so the map can't flash. Pull request #5.
- **2026-11-15, session 5** (Opus 5.5, claude.ai; same chat). Owner merged #1–#3 and switched Pages on, but with the branch source (see Q6). Built Phase 1.2: climate, storms, lightning, soil moisture, the `weather` observer, and weather in the viewer, plus opening the page at a moment named in its address. Caught and fixed a confound: the variability knob was raising average rain (D-023). Republished the preview to the same artifact. Opened pull request #4.
- **2026-11-15, session 4** (Opus 5.5, claude.ai; same chat). Phase 1.1 map generator, sun and moon (1.3), and viewer v0 (1.9), on branch `phase-1.1-terrain-viewer`, stacked on #2 because #1 and #2 were still unmerged. Iterated on the generator five times from rendered maps (D-020). Added the kernel's setup step (D-019), the `landscape` observer, the page build and its Pages workflow, and a test that the built page runs the same simulation as the source. Published a preview of the page as a private claude.ai artifact: https://claude.ai/artifact/NuwgaZCS8EtX3qTfnz6bFJ (slug `b1744980-a2ab-4b1a-a42e-66a75f44dcfd`). Later sessions should republish to that slug (`npm run build:site`, then publish every file under `dist/site/`) rather than create a new one. Opened pull request #3; GitHub's checks passed.
- **2026-11-15, session 3** (Fable 5.2, claude.ai; same chat as session 2). Phase 1.0, portable math, on branch `phase-1.0-portable-math`, built on the unmerged Phase 0 branch because pull request #1 was still open. Added `dmath.ts`, `selfcheck.ts`, normal and exponential draws, accuracy tests against an arbitrary-precision reference, recorded digests, a second-engine comparison (Bun) locally and on GitHub, and `DESIGN.md` §1.8. Recorded D-018. Opened pull request #2.
- **2026-11-15, session 2** (Fable 5.2, claude.ai). Built all of Phase 0 on branch `phase-0-foundations`: kernel (0.1), guardrail tests (0.2), harness (0.3), benchmark (0.4), stack checkpoint (0.5). Milestones 0.2–0.4 were tagged for Opus; they were done in the same Fable session because the owner had already switched models and splitting would have cost him a round trip. Recorded D-012 to D-017. Added `DESIGN.md` §1.5–§1.7. Opened pull request #1; GitHub's checks passed. The session was interrupted once partway and resumed from the files on disk.
- **2026-11-15, session 1** (Opus 5.5, claude.ai). Wrote the full plan: `CLAUDE.md`, `GUARDRAILS.md`, `DESIGN.md`, `ROADMAP.md`, `DECISIONS.md`, `RESEARCH.md`, `ORIGIN.md`, experiment template, tuning log. No code, per the owner's instruction to brainstorm and plan first.
