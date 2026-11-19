# Preregistration: P1 ecology review (Phase 1 exit, ROADMAP 1.10)

- **Date written:** 2026-11-18, before any runs
- **Commit:** the commit that adds this file (the code it runs is `main` at 1.8, `dcc2147`)
- **Author/model:** Opus 5.5, on an [F] milestone at the owner's request (no Fable credits); `CLAUDE.md` says to proceed and be extra careful.

This is not a social experiment. Nothing here measures or can measure a social outcome; there are no agents. It checks the Phase 1 exit criteria, written in advance so the numbers can't be chosen to fit the results.

## Question
Does the world without agents persist for 100 compressed years across 20 worlds spanning both landscape types, with no extinction cascades, no unbounded growth, and a plausible fire regime?

## Conditions
| Condition | What changes | Everything else |
|---|---|---|
| open | `world.circumscription` = 0 | default (512 × 512 cells of 100 m, climate variability 1) |
| hemmed | `world.circumscription` = 1 | identical |

Seeds 1–10 under each condition: 20 different worlds (the knob changes the terrain).

## Measures (once a compressed year, years 0–100)
`fauna` (animals per km² of land by kind), `vegetation` (cover per plant species), `fire` (running counts: cells ignited, lightning ignitions, holdovers), `landscape` (manipulation check), `weather`, `pathogens`.

## Pass criteria
1. **Persistence:** in every run, deer, aurochs, wolves, big cats, hares, and every plant species are present at every yearly sample. Vultures have a floor (20 birds drifting in), so they are not tested.
2. **Bounded:** no kind's density ever exceeds 5 times its starting density, in any run.
3. **Fire:** fire happens somewhere (at least one run burns at least one cell), the mean burned area across all runs is at most 0.5% of the land per compressed year, and no run burns more than 25% of its land in any single compressed year. (Lightning-only temperate regimes burn roughly 0.1–1% of the land per real year, about 0.01–0.15% per compressed year; T-005.)
4. **Both landscape types:** for every seed, the hemmed world's largest habitable region is more walled in (`enclosedEdgePerCell`) and has less room off the map edge (`mapEdgePerCell`) than the open world's.
5. **Viewer:** the page builds and its build test passes (`npm test`, CI).

## Warnings (reported, not pass/fail)
- Any kind falling below 5% of its starting density in more than 2 of the 20 runs: a near-cascade worth fixing even if nothing dies out.
- Any plant species ending below 20% of its starting cover.
- Kinds still rising or falling steeply over the last 30 years (end of run not near a balance).

## Analysis plan
`analyze.ts` in this folder reads `runs/P1-ecology-review/**/metrics.jsonl` and prints, per run and kind: start, minimum, maximum, end; extinctions; burned share of land per compressed year (from the change in cells ignited); and the criteria above. The summary goes in `results.md`. No criterion is changed after seeing results; if one turns out to be ill-posed, that is said in `results.md`, and the original stands.
