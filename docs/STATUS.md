# Status

Update this at the end of every session. Newest information at the top of each section.

## Current state

- **Done:** Phase 0 (foundations), 1.0 (portable math), 1.1 (map generator), 1.2 (climate and soil moisture), the sun-and-moon part of 1.3, 1.4 (plants), 1.5 (animals, with grazing, browsing, and seeds carried by animals), 1.6 (pathogens in water and carcasses), and a viewer (1.9) that shows all of it.
- **The world has weather, plants and animals; no people.** The real pipeline has five systems: the landscape (built before tick 0), the climate, the plants, the animals, and the pathogens. Nothing has emerged, because nothing can yet.
- **Next action:** Phase 1.7 [O], materials and objects (`DESIGN.md` §2.8). One milestone per run. Then fire (1.8 [O]: lightning strikes, dryness and plant cover as fuel, fire light, and predators keeping away from fire), then the ecology review (1.10 [F]), which waits for a Fable session. Until 2026-11-18 at 7:59 pm Central, runs chain one after another (`CLAUDE.md`, D-028).
- **Blocked on:** nothing. #1–#6 are merged. From 2026-11-16 Claude merges its own pull requests once GitHub's checks pass, and a nightly scheduled run does one milestone at a time (D-025, `CLAUDE.md`).

## What exists

| Where | What |
|---|---|
| `src/sim/core/` | random streams, state hash, snapshot encoding, entity stores, grid layers, spatial index, calendar, mechanism registry, run-time audits |
| `src/sim/core/dmath.ts`, `selfcheck.ts` | portable `exp`, `log`, `pow`, `sinTurn`, `cosTurn`; the arithmetic self-check |
| `src/sim/sim.ts` | state container, tick loop, save/load, `spawnAgent` |
| `src/sim/pipeline.ts` | the real update order: the landscape, the climate, the plants, the animals, the pathogens |
| `src/sim/readonly.ts` | the only door the analysis layer may use |
| `src/sim/world/terrain.ts`, `noise.ts` | the map generator (`DESIGN.md` §2.10) |
| `src/sim/world/light.ts` | sun, moon, and starlight (`DESIGN.md` §2.4) |
| `src/sim/world/climate.ts` | weather, storms, lightning, soil moisture (`DESIGN.md` §2.11) |
| `src/sim/world/plants.ts` | eight plant species: cover, fruit and seed seasons, roots, drought dieback, spreading, forage for grazing and browsing, seed rain (`DESIGN.md` §2.12) |
| `src/sim/world/animals.ts` | deer, aurochs, wolf packs, big cats, hares, vultures, carcasses (`DESIGN.md` §2.13) |
| `src/sim/world/pathogens.ts` | pathogen loads in water and carcass meat (`DESIGN.md` §2.14) |
| `src/sim/signal/layer.ts` | the `SignalLayer` interface, as a stub for Phase 5 |
| `src/analysis/` | observer interface; `census` (a head count), `landscape` (the E3 manipulation check), `weather` (the E1 manipulation check), `vegetation` (cover per species and calories standing), `fauna` (animals per km², kills, births, deaths), `pathogens` (loads by kind of water, and in carcass meat) |
| `src/viewer/`, `scripts/build-site.ts` | the viewer page and its no-install build (`DESIGN.md` §10.1) |
| `src/harness/` | experiment specs, batch runner on worker threads, manifests, JSONL metrics, command line |
| `bench/` | speed benchmark with a scripted stand-in load; timing of the math functions |
| `tests/guardrails/` | the nine guardrail tests (`GUARDRAILS.md` §1) |
| `tests/cross-engine/` | prints digests so two JavaScript engines can be compared |
| `tests/unit/`, `tests/harness/` | tests of the kernel pieces and the harness |
| `experiments/C0-smoke/` | a plumbing check for the harness, not an experiment |

About 9,600 lines of TypeScript including tests after session 7 (7,800 after session 5 ; 6,000 after Phase 1.0; Phase 0 alone was about 4,900, where the roadmap guessed 1,500–2,500), so **treat the roadmap's size estimates as low by roughly half.**

## Decisions needed from the owner

Nothing is blocking. Answered on 2026-11-15 (D-012): the game gets its own page. Everything else was left to Claude and took the defaults: observer, TypeScript, long runs on the owner's computer, the name ABSS.

| # | Question | Needed by |
|---|---|---|
| Q6 | *Resolved 2026-11-15:* Pages publishes from GitHub Actions, at https://ghrelingator.github.io/ABSS-Claude-/. If a "pages build and deployment" run (GitHub's README build) ever appears after a merge again, the source has been switched back. | — |
| Q8 | Plants kept up on the owner's phone at "1 year per second" (answered 2026-11-16). With animals a day costs about four times as much; does it still keep up? If not, the page could skip ahead in bigger steps or cap the speed. | Whenever |
| Q7 | *Answered 2026-11-16:* a Windows desktop, Intel Core i5-4670 (4 cores, 4 threads, 3.4 GHz, 2013), 32 GB of memory, an RTX 3080 graphics card. That means 3–4 runs side by side, and overnight batches for big experiments. The graphics card can't run the simulation: results must be bit-identical on every machine. Nothing is installed yet; in Phase 3, install Node and link the Claude desktop app so a session can run batches there, and stop the PC sleeping during runs. | Phase 3 |
| Q1 | Player role, if observer-only turns out not to be what he wants (D-011). | Phase 9 |

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

**2026-11-16, Phase 1.5.** A day on the full map now takes about 63 ms: animals about 38, plants about 21 (forage added a little), climate 2. Building a world takes about 0.45 s.

**2026-11-15, Phase 1.4 (world systems, same sandbox).** On the 512 × 512 map: a day of plants takes about 16 ms, of climate about 2 ms. That averages 0.13 ms per tick, small next to the agent budget, but at "1 year per second" the page computes 48 days a second: about 0.8 s of work per second on this machine, more on a phone. Building a world takes about 0.4 s. Snapshots grow by 16 MiB (two layers per species).

## Known risks

- **Compute budget** (`DECISIONS.md` D-016). About 6 microseconds per agent per tick is left for bodies and minds. That is tight. Phase 3.1 has to design for it and measure a prototype before building on.
- **Portable math is in place** (D-014, D-018), and measurement showed it was needed: two engines' built-in `exp` disagreed on 10% of inputs. What remains a risk is discipline: a system that needs a function `dmath.ts` lacks (`atan2`, say) has to add it properly, with tests and a digest, not reach for the built-in. The guardrail test blocks the built-ins.
- **Founder viability.** Blank-slate founders may die before learning enough. Viability tuning is allowed (logged), but if it takes heavy tuning, the floor may need rethinking. That's a conversation with the owner, not a quiet fix.
- **Floor 1 expressiveness** (`DESIGN.md` §6.7). The legitimation chain may be inexpressible with unordered token bags.
- **Claude's drift** (`GUARDRAILS.md`). The guardrail tests catch words, imports, and bookkeeping. They can't judge whether an alibi is true or whether a number was tuned toward an outcome.
- **Long-run plant balance** (for 1.10). In 20 seeds × 100 years on small maps, no species died out and none grew without bound, but greens and reeds fell to about a fifth of their starting cover in runs with large year-to-year swings: riverbank soil dries in a drought like any other, because the soil-moisture model has no water table (`DESIGN.md` §2.12). Animals will add grazing pressure on top.
- **Animal balance** (for 1.10). Predators die out on a small, hemmed-in map with large climate swings; deer gather in tight clusters on the best browse; most animal numbers are estimates (`RESEARCH.md`). Eleven rounds of correction went into the current balance (T-004), so it should be reviewed by fresh eyes, not just extended.
- **Root refilling rates are estimates** (T-003). Real tuber turnover hasn't been looked up yet; Phase 3's foraging-return calibration will test it.
- **Claude can't watch.** I read numbers; the owner can see behaviour in the viewer once it exists. Odd behaviour he notices is high-value input. Ask him what he's seen.
- **Some checks only run on GitHub.** The full type check of the harness, tests, and benchmark needs the `@types/node` package, which cloud sessions may not be able to install. The simulation and analysis code can be type-checked locally; the rest is checked by the GitHub workflow. For Phase 0 that workflow passed every step (tests and both type checks) on pull request #1.

## Ideas parked (not in scope until a phase claims them)

- Conquest for territory and self-sacrifice for the group (needs a higher language floor).
- Writing emerging from marks on objects ("learning from books").
- Containers (hide + fiber), which would change storage dynamics.
- LLM narration of detected events in the viewer, display-only (`GUARDRAILS.md` T12).
- God mode (`DESIGN.md` §10), if the owner wants it.
- Running the decide phase of a tick in parallel (`DESIGN.md` §1.6 leaves room for it).
- A guardrail that scans commit messages for "encourage", "boost", and similar words (`GUARDRAILS.md` §6).

## Session log

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
