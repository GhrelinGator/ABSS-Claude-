# Preregistration: P3-minds-exit-2, Phase 3's four checks again, and the single-generation viability check

- **Date written:** 2026-11-25, US Central evening, before any run of this code on the seeds below.
- **Commit:** the commit that adds this file (with `run.ts` and `analyze.ts`); the results name the commit they ran.
- **Author/model:** Opus 5.5, unattended run, milestone 3.7c (an [F] milestone on Opus, D-034).
- **What changed since `experiments/P3-minds-exit/` (3.7b, D-060), and is named here as the reason for running again:** milestone 3.7c (`DESIGN.md` §4.15, D-061, D-062, T-019): two mind dials on the genome, `needCuriosity` (the bonus for the untried weighed up by the unmet need) and `restlessness` (a walk worth more when hunger or thirst presses), the owner's answer to Q14; and the owner's answer to Q15: rates by hand checked against measured returns (unchanged, within what was measured), hand work keeping its pace until the endurance time of the work (× 0.75 past it, not × (1 − ½ tiredness)), a held stick of 0.5 m digging roots at Hadza women's measured rate, and sleep a body cannot refuse past a sleep pressure of 0.78. The genome now draws eleven dials, so every founder differs from 3.7b's.
- **What was seen before writing it:** 3.7b's results on these same seeds with the old code (`experiments/P3-minds-exit/results.md`): the roadmap asks for the checks to be re-run on seeds 11–18 with the same definitions, so they are not fresh worlds. With this code, only the development seeds 7 and 8 have been run (`bench/founders.ts`, `experiments/P3-viability/starvation.ts`, 100 founders, 40 days): alive at day 40, 4 and 11 of 100; starvation 49 and 50, cold 19 and 10, animals 18 and 17, poisoning 9 and 6; about 6.5–6.8 hours asleep a founder-day; about half of the roots dug were dug with a stick; starving learners took in about 950–1,100 kcal a day against about 3,800 spent.

## Question
After 3.7c, do Phase 3's minds pass the four checks `ROADMAP.md` sets (§7.1's learned foraging, avoidance of delayed-toxic plants, hidden-cause nodes that form and reduce harm, a measurable base rate of spurious nodes), and do founders pass the single-generation viability check (D-060)? None of this is a social outcome.

## Conditions
Exactly as `experiments/P3-minds-exit/preregistration.md` (100 founders, 3 km disc, spring equinox, 40 days, the full map): `learn`, `blank`, `gut0`, `bias0`, `bias1`. Added, as descriptions only (no threshold, no check rests on them): `need0`, `rest0` and `q14off` (every founder's `needCuriosity`, `restlessness`, or both set to 0 after tick 0; `q14off` is Q15's physics without Q14's dials). The viability check runs `learn` for **48 days** (one compressed year), separately.

## Detectors and thresholds
**Checks 1–4: word for word as in `experiments/P3-minds-exit/preregistration.md`**, with the same thresholds, windows and statistics (the analysis script is a copy with its four checks unchanged). Check 2 especially: ΔP(`learn`) − ΔP(`gut0`) negative on at least 7 of 8 seeds and a mean of −5 percentage points or less.

**Viability (D-060, set in 3.7b before any run that tests it):** on each seed, (a) at least half of the founders alive at the end of day 48, and (b) women fertile, a fertility factor above 0 (the births reading of 3.7b: fecundity at her age × energy balance × nourishment, §3.13), on at least half of the living women's days. **Pass:** both (a) and (b) on most seeds, at least 5 of 8.

## Positive controls
As in 3.7b. `bias0` must posit no node. `run.ts` is 3.7b's with the conditions, the living at the end and 3.7c's tallies added; a smoke run (seed 7, 20 founders, 3 days) ran before this file.

## Predictions (written before running)
- **Check 1:** pass. Learners still take in several times what blank minds do; the dials may lower the statistic (more untried acts), not below 1.25.
- **Check 2:** fail. Founders still starve, and by the owner's condition (D-056) starving bodies are not picky; a stick also digs bitter root faster.
- **Check 3:** (a) pass; (b) fail, as in 3.7b: nodes mostly predict cold and tiredness.
- **Check 4:** pass, with a base rate between 20% and 80%.
- **Viability:** fail. On the development seeds about half the founders starved by day 40 and a tenth or fewer were alive at day 40; no woman's energy balance allows fertility for long.
Both outcomes are reportable. If viability fails, D-062 says that is a true result: naked novices with no edge, a stick they cannot learn to keep, and no fire cannot live on raw food, and nothing is tuned further (T4, T10).

## Runs
Seeds 11–18, eight conditions at 40 days (64 runs) and `learn` at 48 days (8 runs): `node experiments/P3-minds-exit-2/run.ts <condition> <seed> > experiments/P3-minds-exit-2/results/<condition>-<seed>.json`, and `... run.ts learn <seed> 100 48 > experiments/P3-minds-exit-2/results-48/learn-<seed>.json`.

## Analysis plan
`node experiments/P3-minds-exit-2/analyze.ts` prints every statistic of checks 1–4 with its threshold (unchanged from 3.7b), the viability table and verdict, and the descriptions of the ablations. Effect sizes per seed and their spread are reported for every check.
