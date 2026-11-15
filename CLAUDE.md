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

**Start:** run `gh pr list`. If an earlier session's pull request is still open, `main` is behind: tell the owner before building anything → read `STATUS.md` → re-read `GUARDRAILS.md` if touching sim → check the roadmap milestone → confirm the plan with the owner if the task is ambiguous or expensive → create a branch.

**During:** keep changes inside the current milestone. If you discover design work that isn't in `DESIGN.md`, write it there before coding it. Run guardrail tests before every commit.

**End (non-negotiable):**
- Update `docs/STATUS.md`: what changed, what's next, open questions.
- Append any design decision to `docs/DECISIONS.md` (append-only; supersede, never delete).
- Append any parameter or mechanism change made for tuning reasons to `docs/TUNING_LOG.md`.
- Run `npm test` and the type checks.
- Commit with a message that says *why*, push the branch, and open a pull request for the owner to merge (D-017). Check that GitHub's run of the tests comes back green.

I have no memory between sessions. These files are my memory. If it isn't written down, the next session won't know it.

## Model routing

The owner picks the model per session. Each roadmap milestone is tagged:
- **[F] Fable 5.2:** architecture, cross-system integration, diagnosing why something did or didn't emerge, designing experiments, reviewing guardrail compliance.
- **[O] Opus 5.5:** implementing well-specified modules, tests, tooling, viewer work.

If the session's model doesn't match the tag, proceed anyway, but say so at the start and be extra careful on [F] work.

## Honesty requirements

- Never report that something "emerged" without a detector result, a threshold, and a **null-model comparison** (the same run with the enabling mechanism ablated). See `docs/DESIGN.md` §8.
- Distinguish "the code runs" from "the behavior is plausible" from "the phenomenon emerged."
- If a requested change would violate the Prime Directive, say so plainly before doing anything, even if the owner asked for it. Then offer the mechanism-level alternative.

## Tech stack (DECISIONS.md D-007, D-013, D-014; revisit only via a new decision)

TypeScript, strict mode, erasable syntax only (no enums, namespaces, or parameter properties). Node 22.18+ runs the `.ts` files directly: there is no build step and nothing to install. Tests use Node's built-in runner. Hot loops are data-oriented (typed arrays) so they can be ported to Rust/WASM if a benchmark demands it.

Inside `src/sim/`: seeded streams only (`Math.random` is banned), and only arithmetic that is bit-identical on every JavaScript engine (no `Math.sin`, `exp`, `log`, `pow`, or `**`; see `DESIGN.md` §1.5).

```
npm test                   all tests
npm run test:guardrails    guardrail tests only
npm run typecheck          full type check (needs `npm install` once)
tsc -p tsconfig.pure.json  type check of sim + analysis alone; works without `npm install` if tsc is on the PATH
npm run bench              speed benchmark
npm run experiment -- experiments/<id>/spec.json
```

## How a mechanism gets added (kernel contract, `DESIGN.md` §1.5)

- A mechanism is a system: `defineSystem({ name, every?, declare?, create })`, written directly under an `// ALIBI:` comment and added to `src/sim/pipeline.ts` where the design says it runs. The pipeline started empty; every entry is deliberate.
- State lives in store columns (`ensureColumn`, with a category) or registered state parts. Anything acquired during a life is categorised `learned` (or `holdsLearned` for a part), and no system writes it for an agent during the tick that agent was spawned.
- Energy and water columns carry `conserved` tags so the audit can check them.
- Agents are created only through `spawnAgent`.
- No module-level mutable state in `src/sim/`. Bind everything inside `create(sim)`.
