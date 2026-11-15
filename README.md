# ABSS: Agent-Based Social Simulation

A simulation where society, hierarchy, and religion are meant to **emerge**, not be scripted. Agents start knowing nothing. They have bodies that burn calories, get hurt, age, and reproduce; minds that learn from experience and from each other; and the ability to point and to invent signals. Everything social, from food sharing and pair bonds to leaders and gods, has to grow out of that, or it doesn't happen.

**Status:** the foundations are built (Phase 0). The world itself is still empty: no terrain, bodies, or minds yet. See [`docs/STATUS.md`](docs/STATUS.md).

## The one rule

> Code mechanisms, never outcomes.

Words like "religion", "leader", and "trade" are not allowed anywhere in the simulation's code. A test enforces it. Only the separate analysis code, which watches runs and looks for patterns, may use them.

## Where to start

| File | What it is |
|---|---|
| [`docs/ORIGIN.md`](docs/ORIGIN.md) | The original high-school essay and how each idea maps to the design |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Full design: world, bodies, minds, signals, the causal chains, and how emergence gets detected |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases, milestones, exit criteria, and which Claude model each step suits |
| [`docs/GUARDRAILS.md`](docs/GUARDRAILS.md) | Rules, and the tests behind them, that stop the builder (Claude) from quietly pre-coding outcomes |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why things are the way they are |
| [`docs/STATUS.md`](docs/STATUS.md) | Where things stand and what the owner needs to decide |
| [`CLAUDE.md`](CLAUDE.md) | Instructions Claude loads at the start of every session |

## Running it

You need [Node.js](https://nodejs.org) 22.18 or newer. Nothing else has to be installed.

```
npm test                   run every test
npm run test:guardrails    run only the guardrail tests
npm run bench              measure speed on this machine
npm run experiment -- experiments/C0-smoke/spec.json
```

The last command runs a small batch and writes its results to `runs/`. Right now there is nothing to watch: the first visual viewer arrives in Phase 1.

## Layout

```
src/sim/        the simulation: deterministic, seeded, imports nothing but itself
src/analysis/   read-only observers that measure what happens in a run
src/harness/    batch runner for experiments
bench/          speed benchmark
tests/          guardrail tests and unit tests
experiments/    one folder per experiment: predictions first, results after
docs/           design, roadmap, decisions, status
```
