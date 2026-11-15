# Experiments

Every experiment gets its own folder: `experiments/E<id>-<short-name>/`, containing:

1. `PREREGISTRATION.md`: written and committed **before** any run (copy `TEMPLATE.md`).
2. `configs/`: the exact run configs.
3. `RESULTS.md`: written after, including negative and null results.

The rule from `GUARDRAILS.md` T10: detector definitions and thresholds can't change after you've seen the data. If one must, log the change in `RESULTS.md` and re-apply it to every prior run.

Phase-level emergence checks (Phases 3–5) use the same structure with IDs like `C3-foraging`, `C4-westermarck`.
