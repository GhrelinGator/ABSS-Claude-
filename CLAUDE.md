# ABSS — Agent-Based Social Simulation

This file is written by Claude, for Claude. It loads at the start of every session in this repo. Read it all before acting.

## What this project is

A simulation in which society, hierarchy, and religion **emerge** from agents who start knowing nothing. The agents have bodies that burn calories, can be injured, age, reproduce, and pass on genes. Their minds learn from experience and from each other. Nothing social is hand-coded. The owner (GitHub: GhrelinGator) first imagined it in high school; the original essay is in `docs/ORIGIN.md`.

The goal is to grow these things, not script them. **A run where religion does not appear is a valid result. A run where religion appears because we nudged it there is a failed project.**

## The Prime Directive

> **Code mechanisms, never outcomes.**

Social outcomes (religion, leadership, marriage, trade, law, war, states) are things the analysis layer *finds* in the data. They are never things the simulation *contains*.

## Read before you write any code

1. `docs/STATUS.md`: where the project is and what's next.
2. `docs/GUARDRAILS.md`: the full rules against my own shortcuts. Re-read it every session that touches `src/sim/`. I know I drift.
3. The current phase in `docs/ROADMAP.md`, including its exit criteria and recommended model.
4. `docs/DESIGN.md`: the sections for the systems you're touching.

## The five rules I'm most likely to break

1. **The alibi rule.** Every mechanism, drive, bias, or faculty in `src/sim/` needs an *ecological alibi*: a reason it would exist in a world where no society ever forms. Write the alibi in a comment at the definition, as `// ALIBI: ...`. "It helps religion/cooperation/hierarchy emerge" is not an alibi; it's a confession.
2. **Every given drive or bias is a heritable dial.** If it's in the genome, evolution must be able to turn it down to zero. No social behavior is forced.
3. **No social-outcome words in `src/sim/`.** The banned list is in `docs/GUARDRAILS.md` and enforced by `tests/guardrails/banned-terms.test.ts`. If you want to add an exception, you're about to pre-code something. Stop.
4. **No seeding.** New agents start with empty world models: no edibility knowledge, no beliefs, no tokens with meanings beyond direct perception. No pre-built camps, no starting culture. (Project Sid's religion was seeded. Ours won't be.)
5. **When something won't emerge, follow the nudge protocol** in `docs/GUARDRAILS.md`. Do not add a "small bonus." Diagnose, write it down, propose a *mechanism* change with an alibi, log it in `docs/TUNING_LOG.md`, and tell the owner.

## Architecture boundaries (enforced by tests)

```
src/sim/       the world, bodies, minds, social primitives, signal layer. Pure, deterministic, seeded.
src/analysis/  the "anthropologist": read-only observers and detectors. The ONLY code allowed to name social outcomes.
src/harness/   experiment runner: seeds, conditions, ablations, batch runs, metric export.
src/viewer/    browser visualization (later phases).
tests/         unit tests, guardrail tests, determinism tests, scripted fixtures.
bench/         speed benchmark and its scripted stand-in load.
experiments/   preregistrations (predictions written BEFORE running) and results.
docs/          design, roadmap, status, decisions, research, tuning log.
```

- `src/sim/` must never import from `analysis/`, `harness/`, or `viewer/`.
- `src/analysis/` must never write to sim state. It reaches the sim only through `src/sim/readonly.ts`.
- Nothing under `src/` imports from `tests/` or `bench/`. Scripted behaviour never enters a real run.
- Same seed + same config = bit-identical state hash after N ticks. Always.

## Session workflow

**Start:** list open pull requests with `gh api "repos/GhrelinGator/ABSS-Claude-/pulls?state=open"` (plain `gh pr` commands don't work in cloud sessions; the REST API does). If an earlier session's pull request is still open, `main` is behind: merge it if GitHub's checks passed and it isn't waiting on an owner decision (D-025); otherwise tell the owner before building anything (in an unattended run, stop) → read `STATUS.md` → re-read `GUARDRAILS.md` if touching sim → check the roadmap milestone → confirm the plan with the owner if the task is ambiguous or expensive → create a branch.

**During:** keep changes inside the current milestone. If you discover design work that isn't in `DESIGN.md`, write it there before coding it. Run guardrail tests before every commit.

**End (non-negotiable):**
- Update `docs/STATUS.md`: what changed, what's next, open questions.
- Append any design decision to `docs/DECISIONS.md` (append-only; supersede, never delete).
- Append any parameter or mechanism change made for tuning reasons to `docs/TUNING_LOG.md`.
- Run `npm test` and the type checks.
- Commit with a message that says *why*, push the branch, and open a pull request (D-017): `gh api repos/GhrelinGator/ABSS-Claude-/pulls -X POST -f title=... -f head=<branch> -f base=main -F body=@file`.
- Check that GitHub's run of the tests comes back green: `gh api "repos/GhrelinGator/ABSS-Claude-/actions/runs?branch=<branch>&per_page=3"`. Report its result, not just the local one.
- When it's green, merge it yourself (D-025): `gh api repos/GhrelinGator/ABSS-Claude-/pulls/<n>/merge -X PUT -f merge_method=merge`. Leave it open, and say why, only if it waits on one of the owner decisions below.

## Owner's standing instructions (2026-11-16, D-025; 2026-11-19, D-034)

- **Decide as much as you want, as long as it serves the primary goal** (the Prime Directive). Don't ask about choices inside a milestone; record them in `DECISIONS.md` instead.
- **Still ask the owner, and wait,** before: a missing mechanism (nudge-protocol (c), `GUARDRAILS.md` §4) in agents' minds (perception, learning, memory, choice, drives, biases) or between agents (signals, imitation, giving, mate choice); a classification that is ambiguous; adding a drive (`GUARDRAILS.md`); and merging any work that reports a social phenomenon emerged (he sees the claim and its null model first).
- **Tell him, without waiting,** about a new mechanism with no social content: in the world (land, water, weather, plants, animals, pathogens, materials, fire) or in agents' bodies (energy and water, injury, illness, aging, growth, pregnancy and birth) (D-034); about removing or simplifying a designed mechanism (`GUARDRAILS.md`); and about anything surprising. The alibi rule, the banned terms, logging before a change and preregistration still apply to all of it; only the wait is gone.

## Unattended runs (D-025, D-030, D-034)

Scheduled sessions build the project while the owner is away; he doesn't code. A scheduled task wakes a fresh session every hour (D-040; the owner set it hourly on 2026-11-19, the closest the app offered to 2 hours), and each run that merges a milestone starts the next one about 5 minutes later (a chain). In any such run:
1. **Check the weekly cap, then claim before building.** If `docs/RUNS.md` already shows 35 runs since the last weekly reset ("Chained runs"), stop at once: the rest of the week is the owner's (D-034). Otherwise: the milestone's branch is `milestone-<number>` (for example `milestone-1.8`), unless `STATUS.md` names an existing branch to carry on. If that branch doesn't exist, create it from `main` with one empty commit, `claim <milestone> for session <this session's id>`, and push it. If the push is rejected, or the branch already exists and its newest commit is under 3 hours old, another run has the milestone: stop at once, commit nothing, schedule nothing. (Two sessions once fired 11 seconds apart and both built the same milestone; D-030.) An older branch holds abandoned work: merge `main` into it and carry it on.
2. **No questions.** Take the most reasonable reading, and write down which one you took.
3. **Do the next milestone** named in `STATUS.md` under "Next action": one milestone, or two when `STATUS.md` says they're small enough to share a run.
4. **[F] milestones run on Opus too** (D-034: the owner has no Fable credits). Be extra careful on them, and when one merges, add it to "For a Fable second look" in `STATUS.md` with its pull request and the judgment calls a Fable session should re-check.
5. **Push as you go.** Commit and push whenever a piece passes its tests, so a run cut off by a usage limit leaves its work on GitHub.
6. **Stop at owner decisions** (the list above): write the question under "Decisions needed from the owner" in `STATUS.md`, push it, and leave the pull request open.
7. **Log the run.** Before merging, add one line to `docs/RUNS.md`: date and time (US Central), milestone, outcome, and pull request. Runs that stop at once (rule 1) don't log.
8. **Spend carefully.** The owner's usage limits are the project's budget. Batch checks into few commands; don't probe what a test already shows.
9. **End with three plain sentences at most:** what was built, what to look at on the page, and anything that needs him or that he should hear about (such as a new mechanism added without waiting, D-034).

## Chained runs

**Scheduled runs can't schedule (2026-11-19):** the scheduling tool refuses a scheduled run's request to create a scheduled task unless the owner approves it in a reply, so the runs for 2.2, 2.3 and 2.4 all failed to chain. The hourly wake-up is the chain now. Don't try to schedule; in the run log, write "next run: the hourly wake-up". The rest of this section applies only to a session the owner is talking to.

After rule 7, schedule the next run if the milestone merged, the next milestone isn't waiting on the owner, and `docs/RUNS.md` shows fewer than **35 runs since the last weekly reset** (Wednesdays at 7:59 pm US Central). Schedule it as a one-shot scheduled task (`create_trigger` with `run_once_at` about 5 minutes from now, `initiation` human_schedule, push notifications on) whose prompt is this run's own prompt, word for word. Otherwise schedule nothing; the hourly wake-up restarts the chain later (after the weekly reset, when the cap was the reason). The owner wants the chain kept going (2026-11-19): don't stop it for anything these rules don't name.

The cap keeps about 10% of the owner's weekly limit for his own use (his request, 2026-11-17). A milestone run measured about 1.5% of his weekly limit and 11% of a 5-hour window; 35 runs leave room for heavier milestones. If he reports his usage running high, lower the cap here.

I have no memory between sessions. These files are my memory. If it isn't written down, the next session won't know it.

## Model routing

The owner picks the model per session. Each roadmap milestone is tagged:
- **[F] Fable 5.2:** architecture, cross-system integration, diagnosing why something did or didn't emerge, designing experiments, reviewing guardrail compliance.
- **[O] Opus 5.5:** implementing well-specified modules, tests, tooling, viewer work.

If the session's model doesn't match the tag, proceed anyway, but say so at the start and be extra careful on [F] work. Unattended runs take [F] milestones too while the owner has no Fable credits, and list them in `STATUS.md` under "For a Fable second look"; a Fable session starts with that list (D-034).

## Honesty requirements

- Never report that something "emerged" without a detector result, a threshold, and a **null-model comparison** (the same run with the enabling mechanism ablated). See `docs/DESIGN.md` §8.
- Distinguish "the code runs" from "the behavior is plausible" from "the phenomenon emerged."
- If a requested change would violate the Prime Directive, say so plainly before doing anything, even if the owner asked for it. Then offer the mechanism-level alternative.

## Tech stack (DECISIONS.md D-007, D-013, D-014; revisit only via a new decision)

TypeScript, strict mode, erasable syntax only (no enums, namespaces, or parameter properties). Node 22.18+ runs the `.ts` files directly: there is no build step and nothing to install. Tests use Node's built-in runner. Hot loops are data-oriented (typed arrays) so they can be ported to Rust/WASM if a benchmark demands it.

Inside `src/sim/`: seeded streams only (`Math.random` is banned), and only arithmetic that is bit-identical on every JavaScript engine. That means no `Math.sin`, `exp`, `log`, `pow`, or `**`: use `src/sim/core/dmath.ts` instead, with angles in turns and directions as unit vectors (`DESIGN.md` §1.8).

```
npm test                   all tests
npm run test:guardrails    guardrail tests only
npm run typecheck          full type check: sim, viewer, everything else (needs `npm install` once)
tsc -p tsconfig.pure.json  type check of sim + analysis alone; works without `npm install` if tsc is on the PATH
npm run bench              speed benchmark (`node bench/math.ts` times the math functions)
node tests/cross-engine/print-digests.ts    run with `bun` too and diff: two engines must print the same
npm run experiment -- experiments/<id>/spec.json
npm run build:site         build the viewer page into dist/site/ (open it through any static web server)
```

## How a mechanism gets added (kernel contract, `DESIGN.md` §1.5)

- A mechanism is a system: `defineSystem({ name, every?, declare?, create })`, written directly under an `// ALIBI:` comment and added to `src/sim/pipeline.ts` where the design says it runs. The pipeline started empty; every entry is deliberate.
- State lives in store columns (`ensureColumn`, with a category) or registered state parts. Anything acquired during a life is categorised `learned` (or `holdsLearned` for a part), and no system writes it for an agent during the tick that agent was spawned.
- Energy and water columns carry `conserved` tags so the audit can check them.
- Agents are created only through `spawnAgent`.
- No module-level mutable state in `src/sim/`. Bind everything inside `create(sim)`.
