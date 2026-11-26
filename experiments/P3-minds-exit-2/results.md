# Results: P3-minds-exit-2, Phase 3's four checks after 3.7c, and the single-generation viability check

- **Run:** 2026-11-25 to 26, US Central night, at commit `8273b65` (the preregistration's own commit; nothing in `src/` changed after it), 72 runs: seeds 11–18 × eight conditions at 40 days, and `learn` at 48 days. About 13 minutes on the cloud sandbox's two cores (a run now takes about 20 s).
- **Reproduce:** the commands in `preregistration.md`, then `node experiments/P3-minds-exit-2/analyze.ts`. The raw files are not committed (3.4 MB); `analysis.txt` is the analysis's whole output.
- **Deviations from the preregistration:** none in the checks. Two corrections to *descriptions*, made after the first analysis and before this file: the ablations table read day 40 from a list that ends at day 35 (it now reads the living at the end), and the survival table's header, copied from 3.7b, said its seven columns ran to day 40 when they run to day 35. So **3.7b's results.md, which read "at day 40, 0–25", was reading day 35** (a description, not a check; corrected here, not there).

## Summary

| Check | Statistic | Threshold | 3.7b | 3.7c |
|---|---|---|---|---|
| 1. Foraging efficiency rises over a lifetime against the random-policy baseline | rise(learn) ÷ rise(blank): above 1.25 on 6 of 8 seeds, geometric mean 1.59 | ≥ 7 of 8 and mean > 1.25 | pass (8 of 8, 2.39) | **fail** |
| 2. Avoidance of delayed-toxic plants | ΔP(learn) − ΔP(gut0): negative on 4 of 8, mean −2.9 pp | ≥ 7 of 8 and mean ≤ −5 pp | fail (5 of 8, −1.0) | **fail** |
| 3a. Hidden-cause nodes form | in all 16 `learn` and `bias1` runs, in no `bias0` run | all, and none | pass | **pass** |
| 3b. ... and reduce harm where real hidden causes exist | deaths by animals per founder-day, `bias1` ÷ `bias0`: 0.95 (80 against 84), one-sided p 0.41 | ≤ 0.8 and p < 0.05 | fail (1.04) | **fail** |
| 4. Spurious hidden-cause associations have a measurable base rate | 1,979 of 3,698 classified nodes, 53.5% (95% interval 51.9–55.1%) | ≥ 50 nodes, interval within ±10 pp | pass (46.6%) | **pass** |
| Viability (D-060) | founders alive at day 48: 0–4 of 100; women fertile on 0.1–5.6% of their days; both on 0 of 8 seeds | both halves on at least 5 of 8 | — | **fail** |

Predictions (written before the runs): check 1 pass, 2 fail, 3a pass, 3b fail, 4 pass between 20% and 80%, viability fail. All came out as predicted **except check 1, which failed**.

**Phase 3 does not exit.** Founders still starve, and now freeze, within one compressed year. By the owner's rule for this milestone (D-062), that is reported as a true result of these bodies, this world and this mind, and nothing is tuned further. None of this is a social outcome.

## What each result says

**Check 1 fails, where it passed before.** Learners still take in far more than blank minds late in life (days 16–20: 2.85 times the baseline's rate, geometric mean, above 1.5 on 7 of 8 seeds), but they start higher: in day 1 they take in 19–69 kcal an awake hour (3.7b: 8–43), so the rise over a lifetime is smaller (statistic 0.72 on seed 12 and 1.10 on seed 17). On seed 12 learners' handling rate *fell* from 117 to 72 kcal an hour of eating while their toxic share fell from 32% to 16%: they moved from bitter root (1,200 digestible kcal a kg) to tubers (600). The statistic measures a lifetime's rise, so a mind that does better from the first day, or that trades energy for less poison, scores lower on it.

**Check 2 fails, as predicted.** The toxic share fell on 5 of 8 seeds (−0.5 pp on average, sd 11.3), more than in 3.7b (which rose 8.2 pp), but the prepared-learning kernel's own part (against `gut0`) is −2.9 pp, negative on 4 of 8 seeds. Founders still starve, and by the owner's condition starving bodies are not picky (D-056).

**Check 3a passes; 3b fails, as predicted.** Nodes still mostly predict cold (2,728 of 3,698 classified nodes at bias 1) and tiredness; 40 predicted pain.

**Check 4 passes.** 53.5% of classified nodes at bias 1 are spurious by the preregistered definition (52.5% with founders' own genomes).

**Viability fails on every seed.** By day 48 (one compressed year), 6 of 800 founders were alive; deaths: starvation 360, hypothermia 284, animals 99, **poisoning 36**, dehydration 13, infection 2. Women were fertile on 2.2% of their days (the energy balance; mean factor 0.02); if every woman mated every second day with a man at peak fecundity, the eight worlds would expect about 9 conceptions in 40 days (3.7b: 0.9).

## What 3.7c's mechanisms did (descriptions, not checks; 40 days, sums over the 8 seeds of 100 founders)

| Condition | Alive at day 20 / 30 / 40 | Starved | Deaths by cold / animals / poisoning | kcal eaten a founder-day | Plant kg dug with a stick | Sleeps not refused | Decisions per awake agent-tick |
|---|---|---|---|---|---|---|---|
| `learn` (both Q14 dials as drawn) | 719 / 172 / 21 | 353 | 276 / 99 / 36 | 1,436 | 15,994 | 6,081 | 0.282 |
| `need0` | 666 / 157 / 24 | 380 | — | 1,381 | 14,239 | 5,866 | 0.344 |
| `rest0` | 729 / 186 / 29 | 354 | — | 1,456 | 16,615 | 5,932 | 0.279 |
| `q14off` (Q15's physics alone) | 716 / 176 / 25 | 389 | 231 / 75 / 45 | 1,398 | 15,688 | 5,588 | 0.338 |
| `blank` | 759 / 111 / 0 | 627 | — | 518 | 6,660 | 11,122 | 0.207 |

- **The stick is used, by chance.** Learners dug 15,994 kg while holding a stick in the eight worlds (on the development seeds 7 and 8, about half of all the roots they dug), blank minds 6,660, because learners dig far more. A mind cannot learn that the stick is why (`DESIGN.md` §4.15.8: what is in hand is not a cue).
- **Faster digging brought poisoning.** Bitter root is dug as fast as tubers with a stick, so a dose comes due larger: 36 learners died of poisoning in 40 days (45 without the Q14 dials), where 3.7b had none.
- **Sleep:** bodies past the limit slept about 6,000 times in 8 worlds; learners on the development seeds slept about 6.5–7 hours a day (3.7b: 3–4).
- **`needCuriosity`** helped a little: without it, 27 more starved and 53 fewer were alive at day 20 (single runs per seed; not tested). **`restlessness`** did nothing measurable (`rest0` within a few founders of `learn`).
- **Cold is now the second killer** (276 of 800 by day 40), because more founders live into the compressed winter (day 36 is the solstice).
