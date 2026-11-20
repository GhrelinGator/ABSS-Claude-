# Preregistration: P3-minds-exit, Phase 3's four checks

- **Date written:** 2026-11-20, US Central afternoon, before any run on the seeds below.
- **Commit:** the commit that adds this file (`run.ts`, `analyze.ts` and this file together); the results name the commit they ran.
- **Author/model:** Opus 5.5, unattended run, milestone 3.7b (an [F] milestone on Opus, D-034).
- **What was seen before writing it:** seeds 7 and 8, the development worlds of 3.4–3.7 (`DESIGN.md` §4.10.9–§4.14.3), and one run of every condition on seed 7 to debug the scripts (check 1's early window was then moved from days 1–2 to day 1, nearer birth, for the reason given under Check 1; no threshold was changed after it). Seeds 11–18 have never been run with minds.

## Question
Do Phase 3's minds do what `ROADMAP.md` asks of them before Phase 4: learn to forage better than a random policy over a lifetime (`DESIGN.md` §7.1), learn to avoid plants whose harm comes hours later (§4.13), posit hidden causes that reduce harm where real hidden causes exist (§4.11, the alibi of `hiddenCauseBias`), and posit spurious ones at a measurable base rate (raw material for §7.7)? None of these is a social outcome; each is a property of a lone learner.

## Conditions
All on the real pipeline, 100 founders placed by the config in a 3 km disc at the spring equinox (`DESIGN.md` §4.9.6), 40 days.

| Condition | What changes | Everything else |
|---|---|---|
| `learn` | nothing: founders' genomes as drawn (`hiddenCauseBias` a liability centred on 0, `gutTraceHalfLife` 0–12 h) | identical |
| `blank` | the mind swapped for one that never learns (the random-policy baseline, §4.9.8) | identical |
| `gut0` | every founder's `gutTraceHalfLife` set to 0 after tick 0 (the ablation of §4.13) | identical |
| `bias0` | every founder's `hiddenCauseBias` set to 0 after tick 0 (the ablation of §4.11.5) | identical |
| `bias1` | every founder's `hiddenCauseBias` set to 1 after tick 0 (the faculty at a moderate setting in every founder, for power; 1 is the mean of founders' expressed values above 0) | identical |

## Detectors and thresholds
Read-only measurements of the run (`run.ts`); the minds see none of them.

**Check 1, foraging efficiency rises over a lifetime against the random-policy baseline.** For the founders alive at day 20, the acquisition rate R = kcal taken in (`energyIn`) ÷ awake hours, in window A (day 1: the founders begin with nothing learned) and window B (days 16–20). Rise = R_B ÷ R_A. Statistic per seed = rise(`learn`) ÷ rise(`blank`), which equals (R_B(learn) ÷ R_B(blank)) ÷ (R_A(learn) ÷ R_A(blank)): how much learners pull further ahead of the baseline over their lives. Comparing with the baseline's own rise takes out the season and the practice (§4.12) that blank minds also get. **Pass:** above 1.25 on at least 7 of 8 seeds and a geometric mean over seeds above 1.25. Reported, not a criterion: the level R_B(learn) ÷ R_B(blank); handling rate (kcal per hour in which food went down) and the share of awake hours eating, in both windows. *Why day 1, not days 1–2 (changed after the development run):* learning acts within hours, so the early window must sit as near birth as possible while holding enough eating to measure; a day is the shortest window with a full day and night in it.

**Check 2, avoidance of delayed-toxic plants.** Toxic share P = kg of bitter root and nightshade ÷ kg of all plants eaten, by the population, in days 1–5 and days 16–20; ΔP = P(16–20) − P(1–5). Statistic per seed = ΔP(`learn`) − ΔP(`gut0`): the part of the change the prepared-learning kernel makes. **Pass:** negative on at least 7 of 8 seeds and a mean over seeds of −5 percentage points or less. Reported: ΔP(`learn`) itself as the rate (percentage points a day), and ΔP(`learn`) − ΔP(`blank`).

**Check 3, hidden-cause nodes form and reduce harm where real hidden causes exist.** (a) **Pass:** nodes are posited in every `bias1` and `learn` run and in no `bias0` run. (b) The world's real hidden cause is predators taking persons at night from cover (§2.17). Deaths by animals per founder-day, pooled over the 8 seeds, `bias1` against `bias0`. **Pass:** a rate ratio of 0.8 or less and a one-sided exact conditional test (given the total of such deaths, the `bias1` count is binomial with the share of founder-days) p < 0.05. Reported: harm events (interoceptive pain up by at least 0.05 over an hour) per founder-day per seed, `bias1` ÷ `bias0`; mean pain; `learn` against `bias0`; within the `learn` runs, harm events per founder-day for founders expressing a bias above 0 against those at 0.

**Check 4, a measurable base rate of spurious hidden-cause associations.** Nodes held by living founders, snapshot at days 10, 20, 30 and 40 (each node counted once, at its last snapshot), in `bias1` (primary) and `learn` (reported). A node predicts, by its (node, 0) association (§4.11.3), a change in its dominant channel (largest |change|) in that direction. Over every founder-hour of the run, an *event* is that channel changing by at least 0.05 over the hour in the predicted direction. The node is *classified* when it is active (two of place, light and day length matching its signature, §4.11.2) in at least 24 founder-hours and predicts a change of at least 0.005, and *spurious* when the event rate where it is active is no higher than over all founder-hours (ratio ≤ 1): no real contingency in its context. **Pass ("measurable"):** at least 50 classified nodes pooled over the seeds and a 95% Wilson interval for the spurious share no wider than ±10 percentage points. Reported: the rate per seed and its spread, the rate with a cut of 1.25, and the rate by the channel predicted. *A node that duplicates a cue the mind does perceive (cold at night) is not spurious by this definition: it is redundant, which matters for §7.7 differently.*

## Positive controls
- Check 1–2: none needed beyond the conditions themselves; the ablations are the nulls. The acquisition and plant tallies are the mind's own (`ActTally`), checked against `bench/founders.ts` on seed 7 (identical: kcal 4,787,184, consume begun 38,905, nodes posited 141).
- Check 3 (a): `bias0` must posit nothing; a node in any `bias0` run fails the check and the ablation.
- Check 4: `tests/unit/hidden-causes.test.ts` (3.5) shows nodes form from unexplained residuals and learn them.
- `run.ts` looks through a perception of its own over a still view of its own; a first version shared the minds' still view and changed the run by a few acts in a thousand, which the comparison above caught.

## Predictions (written before running)
- **Check 1:** uncertain. Learners take in several times what blank minds do (§4.14.3), but most of that lead may already be there in day 1, since learning acts within hours; if so, the statistic sits near 1 and the check fails even though learning works.
- **Check 2:** fail. In 3.6b the toxic share rose over the run with the kernel and without it (§4.13.6), and a novice's dose is felt near the salience gate.
- **Check 3:** (a) pass; (b) fail. Nodes mostly predict cold and tiredness (§4.11.8), not pain, so they have little to do with predators; the bias also cut drinking in 3.5.
- **Check 4:** pass, with a base rate somewhere between 20% and 80%.
- **Viability (not a check):** every condition's founders mostly dead by day 40, chiefly of starvation (§4.14.3); no woman fertile at any day (the births reading).
Both outcomes are reportable. A fail is a finding about the present mind, to be diagnosed by `GUARDRAILS.md` §4, not a reason to tune toward a pass (T4, T10).

## Runs
Seeds 11–18 (8 fresh worlds), 5 conditions each, 40 runs; 100 founders, 40 days, the full map (`defaultConfig`). Eight seeds give a sign test at 7 of 8 a one-sided p of 0.035 and pool about 2,500–3,000 founder-days a condition for check 3. Each run takes about 11 s.

## Analysis plan
`node experiments/P3-minds-exit/analyze.ts` reads `results/*.json` and prints every statistic above with its threshold. Effect sizes per seed and their spread across seeds are reported for every check, not only the pass or fail. Nothing here is a network metric, so no permutation tests. The births reading (each living woman's fertility factor once a day, the product `mate` would multiply by: fecundity by age × energy balance × nourishment, §3.13) is a description, not a check.
