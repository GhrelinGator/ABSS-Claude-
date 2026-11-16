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

### T-001: Map generator adjustments (five rounds)
- **Date / session model:** 2026-11-15, Opus 5.5.
- **Process note:** the protocol says to log before changing code. These five changes were made in quick succession while looking at rendered maps, and logged together at the end of the session, before committing. Next time, log each one first.
- **Symptoms and changes** (all landscape geometry; no agents exist yet):
  1. Lakes covered 8–15% of the map (seeds 7, 8). Classification **(b)**. Change: 85% sediment infill of closed basins, plus a water-balance rule for lakes. Target: real lake cover is a few percent of land; result 0–6%.
  2. Rivers rose in the open desert. **(b)**. Change: runoff = rainfall − 0.3, never negative (was: all rainfall). Target: deserts have no perennial rivers of their own.
  3. Dead-straight 45° channels on flats. **(a), an artifact of the routing.** Change: depression queue plus hashed choice among equally short routes.
  4. The knob had almost no effect below 0.75, and wet uplands beside the valley left it open. **Design of the manipulation, not ecology.** Change: the desert's edge moves inward with the knob; the extra upstream rain falls only inside the valley. Target: the manipulation check in `DESIGN.md` §2.10 (habitable land falls steadily and ends up walled in).
  5. Parallel straight streams on the graded valley floor. **(b)**. Change: valley floor slopes toward its centre line (12 m per km × knob); relief inside the valley reduced up to 85%. Target: valley floors drain to one trunk river.
- **Social metrics involved:** none. The only measured targets were lake cover, the presence of desert rivers, channel shape, and the habitable-land yardstick that defines the E3 manipulation.
- **Null-model re-run:** not applicable; nothing here is a hoped-for social phenomenon.
