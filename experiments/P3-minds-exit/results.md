# Results: P3-minds-exit, Phase 3's four checks

- **Run:** 2026-11-20, US Central afternoon, at commit `21da6c7` (the preregistration's own commit; nothing in `src/` changed after it), 40 runs: seeds 11–18 × five conditions, 100 founders, 40 days. About 4.5 minutes on the cloud sandbox's two cores.
- **Reproduce:** `for c in learn blank gut0 bias0 bias1; do node experiments/P3-minds-exit/run.ts $c <seed> > experiments/P3-minds-exit/results/$c-<seed>.json; done`, then `node experiments/P3-minds-exit/analyze.ts`. The raw files are not committed (1.5 MB; each run takes about 11 s); `analysis.txt` is the analysis's whole output.
- **Deviations from the preregistration:** none. (Check 1's early window was set to day 1 after the development run on seed 7 and before this file's runs; the preregistration says so.)

## Summary

| Check | Statistic | Threshold | Result |
|---|---|---|---|
| 1. Foraging efficiency rises over a lifetime against the random-policy baseline | rise(learn) ÷ rise(blank): above 1.25 on 8 of 8 seeds, geometric mean 2.39 | ≥ 7 of 8 and mean > 1.25 | **pass** |
| 2. Avoidance of delayed-toxic plants | ΔP(learn) − ΔP(gut0): negative on 5 of 8 seeds, mean −1.0 pp | ≥ 7 of 8 and mean ≤ −5 pp | **fail** |
| 3a. Hidden-cause nodes form | posited in all 16 `learn` and `bias1` runs, in no `bias0` run | all, and none | **pass** |
| 3b. ... and reduce harm where real hidden causes exist | deaths by animals per founder-day, `bias1` ÷ `bias0`: 1.04 (103 against 101), one-sided p 0.63 | ≤ 0.8 and p < 0.05 | **fail** |
| 4. Spurious hidden-cause associations have a measurable base rate | 1,218 of 2,611 classified nodes, 46.6% (95% interval 44.7–48.6%) | ≥ 50 nodes, interval within ±10 pp | **pass** |

Predictions (written before the runs): check 1 uncertain, 2 fail, 3a pass, 3b fail, 4 pass between 20% and 80%. All came out as predicted except check 1, which was left open and passed.

**Phase 3 does not exit:** two checks fail, and no population can persist (below). None of this is a social outcome, and nothing here is reported as having emerged beyond what each check's threshold and ablation show.

## What each result says

**Check 1 passes.** Founders that learn pull away from the random policy over their lives: in day 1 they take in about 8–43 kcal an awake hour (blank minds 10–11), in days 16–20 about 32–145 (blank 13–24), and their lead over the baseline grows 1.45–6 times between the two windows. Most of it is time: the share of awake hours in which food goes down rises from 13–49% to 46–93%; the handling rate (kcal an hour of eating) rises too, from 52–98 to 70–156, which is partly practice (§4.12). Blank minds practise too, but learners eat more and so practise more: the statistic includes that, as a forager's lifetime gains include skill. The level in days 16–20 is 4.4 times the baseline's (geometric mean; above 1.5 on every seed).

**Check 2 fails, as predicted, and cannot pass while founders starve.** Learners' toxic share rose over their lives on every seed (by 8.2 percentage points on average, sd 3.9; about 0.55 points a day), by about as much as with the prepared-learning kernel ablated (the statistic −1.0 pp). Two things measured before explain it (§4.13.6, §4.14): a novice's dose comes due as a pain step near the salience gate, so little of it is credited; and bitter root carries the most digestible energy of the foods dug (1,200 kcal a kg against tubers' 600), while every learner is in a deep energy deficit by day 15 (below). By the owner's condition, built into choice (D-056, §4.13.4), a starving body is not picky: avoidance of a food that feeds can only show in bodies that are not starving. Check 2 should be run again once founders can feed themselves.

**Check 3a passes; 3b fails, as predicted.** With every founder at bias 1, deaths by animals were 103 in 20,956 founder-days against 101 in 21,315 at bias 0; harm events (pain up by 0.05 or more within an hour) were about 10% more frequent with nodes (below 1 on 2 of 8 seeds), and within the genome runs founders expressing a bias did no better than those at 0 (0.20 harm events a founder-day each). What nodes come to predict (check 4's classification) is mostly cold rising (61% of classified nodes at bias 1) and tiredness; nodes predicting pain were 19 of 2,611. Nodes are active wherever two of place, light and day length match (§4.11.9), so they divide by light and season, which is where cold comes from, and do not pick out the cover and darkness in which cats take persons. The faculty's alibi (that positing an unseen cause reduces harm) is not supported by this mind in this world.

**Check 4 passes.** At bias 1, 46.6% of classified nodes (1,218 of 2,611) predict a change that is no more frequent where they are active than anywhere (sd 9.3 points across seeds); with a stricter cut (no more than 25% more frequent), 67.6%. With founders' own genomes, 49.6% of 819. Nodes predicting tiredness are the most often spurious (65% of 344), nodes predicting cold the least (41% of 1,587): night and season do bring cold, so a node that stands for "at night in the short days" is real, though redundant with cues the mind perceives. That base rate is §7.7's raw material.

## Survival and births (descriptions, not checks)

Learners die later than blank minds but die: alive at day 30, 5–43 of 100 (blank 0–15); at day 40, 0–25 (blank none). Deaths among learners, all seeds: starvation 429, cold 229, animals 107, dehydration 16, shock 4, overheating 1, infection 1. Cold kills more than before because founders now live into the compressed winter (day 36 is the solstice; §4.14.3).

**The births reading.** Once a day, each living woman's fertility factor, the product `mate` multiplies its chance by (fecundity at her age × her energy balance × her nourishment, §3.13): over 11,376 woman-days it was zero on 11,317 and above 0.5 on 19, mean 0.0021. If every woman mated with a man at peak fecundity every second day, the eight worlds would have expected **0.93 conceptions in all**. The energy balance is the reason: fertility falls to zero at a balance of −150 kcal a day (§3.13), and learners that starved ran deficits of about 2,700–3,000 kcal a day on the development seeds (`experiments/P3-viability/starvation.ts`, `DESIGN.md` §4.14.5). A scripted stand-in for mating would therefore show nothing, and every infant would also need nursing, a second door only Phase 4's acts call. The five-generation persistence check cannot be measured in Phase 3 (D-060).
