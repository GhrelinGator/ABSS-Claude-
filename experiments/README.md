# Experiments

Every experiment gets its own folder: `experiments/E<id>-<short-name>/`, containing:

1. `PREREGISTRATION.md`: written and committed **before** any run (copy `TEMPLATE.md`).
2. `spec.json`: the exact conditions, seeds, and run length. Conditions differ only in config, which is how ablations and null models are expressed.
3. `RESULTS.md`: written after, including negative and null results.

The rule from `GUARDRAILS.md` T10: detector definitions and thresholds can't change after you've seen the data. If one must, log the change in `RESULTS.md` and re-apply it to every prior run.

Phase-level emergence checks (Phases 3–5) use the same structure with IDs like `C3-foraging`, `C4-westermarck`.

## Running one

```
npm run experiment -- experiments/<folder>/spec.json
```

Results land in `runs/<name>/<condition>/seed-<n>/`:

- `manifest.json`: the config, the seed, the commit the code was at, the machine, and the final state hash. Enough to reproduce the run exactly.
- `metrics.jsonl`: one line per sample, with each observer's measurements.

`runs/` is not committed to the repository. An existing results folder is never overwritten unless `--overwrite` is passed. Every run uses the real simulation pipeline; scripted test fixtures can't be loaded through the harness.

## `C0-smoke`

A plumbing check for the harness, not an experiment. It advances the empty Phase 0 world for four days under two calendar settings. It has no preregistration because it tests no hypothesis.
