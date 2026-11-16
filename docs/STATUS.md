# Status

Update this at the end of every session. Newest information at the top of each section.

## Current state

- **Phase 0 (foundations) and Phase 1.0 (portable math) are done.** The kernel, the guardrail tests, the experiment harness, the benchmark, and the math functions the world will need all exist and pass.
- **The simulation itself is still empty.** The real pipeline has no systems: no terrain, no weather, no bodies, no minds. Nothing has emerged, because nothing can yet. Anyone who reports otherwise at this stage is wrong.
- **Next action:** Phase 1.1 [O] (map generator) and onward. See `ROADMAP.md`. Consider doing the viewer (1.9) early, so the owner has something to look at.
- **Blocked on:** the owner merging the open pull requests into `main`. #1 (`phase-0-foundations`) is Phase 0. #2 (`phase-1.0-portable-math`) is built on top of #1 and contains both, so merging #2 alone is enough. The next session starts from `main`.

## What exists

| Where | What |
|---|---|
| `src/sim/core/` | random streams, state hash, snapshot encoding, entity stores, grid layers, spatial index, calendar, mechanism registry, run-time audits |
| `src/sim/core/dmath.ts`, `selfcheck.ts` | portable `exp`, `log`, `pow`, `sinTurn`, `cosTurn`; the arithmetic self-check |
| `src/sim/sim.ts` | state container, tick loop, save/load, `spawnAgent` |
| `src/sim/pipeline.ts` | the real update order. **Empty.** |
| `src/sim/readonly.ts` | the only door the analysis layer may use |
| `src/sim/signal/layer.ts` | the `SignalLayer` interface, as a stub for Phase 5 |
| `src/analysis/` | observer interface and one observer (`census`, a head count) |
| `src/harness/` | experiment specs, batch runner on worker threads, manifests, JSONL metrics, command line |
| `bench/` | speed benchmark with a scripted stand-in load; timing of the math functions |
| `tests/guardrails/` | the nine guardrail tests (`GUARDRAILS.md` §1) |
| `tests/cross-engine/` | prints digests so two JavaScript engines can be compared |
| `tests/unit/`, `tests/harness/` | tests of the kernel pieces and the harness |
| `experiments/C0-smoke/` | a plumbing check for the harness, not an experiment |

About 6,000 lines including tests after Phase 1.0 (Phase 0 alone was about 4,900: 1,900 in `src/sim/`, 2,100 of tests). The roadmap guessed 1,500–2,500 for this phase, so **treat the roadmap's size estimates as low by roughly half.**

## Decisions needed from the owner

Nothing is blocking. Answered on 2026-11-15 (D-012): the game gets its own page. Everything else was left to Claude and took the defaults: observer, TypeScript, long runs on the owner's computer, the name ABSS.

Coming up:

| # | Question | Needed by |
|---|---|---|
| Q6 | Turn on GitHub Pages for this repository (one setting), so the viewer has its own page. | Phase 1.9 |
| Q7 | Can the owner's computer run Node 22.18 or newer for long batches, and how many cores does it have? Cloud sessions stop background work a few minutes after a reply. | Phase 3 |
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

## Known risks

- **Compute budget** (`DECISIONS.md` D-016). About 6 microseconds per agent per tick is left for bodies and minds. That is tight. Phase 3.1 has to design for it and measure a prototype before building on.
- **Portable math is in place** (D-014, D-018), and measurement showed it was needed: two engines' built-in `exp` disagreed on 10% of inputs. What remains a risk is discipline: a system that needs a function `dmath.ts` lacks (`atan2`, say) has to add it properly, with tests and a digest, not reach for the built-in. The guardrail test blocks the built-ins.
- **Founder viability.** Blank-slate founders may die before learning enough. Viability tuning is allowed (logged), but if it takes heavy tuning, the floor may need rethinking. That's a conversation with the owner, not a quiet fix.
- **Floor 1 expressiveness** (`DESIGN.md` §6.7). The legitimation chain may be inexpressible with unordered token bags.
- **Claude's drift** (`GUARDRAILS.md`). The guardrail tests catch words, imports, and bookkeeping. They can't judge whether an alibi is true or whether a number was tuned toward an outcome.
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

- **2026-11-15, session 3** (Fable 5.2, claude.ai; same chat as session 2). Phase 1.0, portable math, on branch `phase-1.0-portable-math`, built on the unmerged Phase 0 branch because pull request #1 was still open. Added `dmath.ts`, `selfcheck.ts`, normal and exponential draws, accuracy tests against an arbitrary-precision reference, recorded digests, a second-engine comparison (Bun) locally and on GitHub, and `DESIGN.md` §1.8. Recorded D-018. Opened pull request #2.
- **2026-11-15, session 2** (Fable 5.2, claude.ai). Built all of Phase 0 on branch `phase-0-foundations`: kernel (0.1), guardrail tests (0.2), harness (0.3), benchmark (0.4), stack checkpoint (0.5). Milestones 0.2–0.4 were tagged for Opus; they were done in the same Fable session because the owner had already switched models and splitting would have cost him a round trip. Recorded D-012 to D-017. Added `DESIGN.md` §1.5–§1.7. Opened pull request #1; GitHub's checks passed. The session was interrupted once partway and resumed from the files on disk.
- **2026-11-15, session 1** (Opus 5.5, claude.ai). Wrote the full plan: `CLAUDE.md`, `GUARDRAILS.md`, `DESIGN.md`, `ROADMAP.md`, `DECISIONS.md`, `RESEARCH.md`, `ORIGIN.md`, experiment template, tuning log. No code, per the owner's instruction to brainstorm and plan first.
