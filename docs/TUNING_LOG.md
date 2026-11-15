# Tuning log

Append-only. Every parameter or mechanism change made for tuning reasons goes here **before** the code changes (`GUARDRAILS.md` §4, step 6). If you're about to change a number and there's no entry here, stop.

## Entry format

```
### T-NNN: short title
- Date / session model:
- Symptom: what was observed (with run IDs)
- Causal chain + broken link: (DESIGN.md §7.x, which link, how it was measured)
- Classification: (a) bug / (b) ecological miscalibration / (c) missing mechanism / (d) genuine negative result / viability
- Change: exact parameter or mechanism, old → new
- Alibi or plausibility target: (for b: the real-world target and its source; for c: the alibi; for viability: why founders were dying)
- Owner approval: (required for c and ambiguous cases; link or quote)
- Null-model re-run: did the ablated run stay quiet? (if not, revert)
```

## Entries

None yet.
