# Results: P2 bodies exit check (2026-11-20)

`node experiments/P2-bodies-exit/random-policy.ts <seed> 600 4`, each world about 25 s on the cloud sandbox. Code: branch `milestone-2.8` (after T-014). Preregistration: `preregistration.md` (part one before any run; part two after the first run, before seeds 3 and 4).

## Part one (seeds 1 and 2, then also reported for 3 and 4): failed

| Criterion | Seed 1 | Seed 2 | Seed 3 | Seed 4 |
|---|---|---|---|---|
| 1 audits | pass | pass | pass | pass |
| 2 one cause per death | pass | pass | pass | pass |
| 3 thirst before hunger (*W* < 1 kg) | **fail**: 47% dehydration, median 18.1 days | **fail**: 54%, 17.7 days | **fail**: 74%, 11.9 days | **fail**: 75%, 8.6 days |
| 4 hunger takes weeks | **fail**: starvation at 14.3–20.3 days | **fail**: 14.7–21.3 | **pass**: 15.0–22.8 | pass: 15.6–21.7 |
| 5 supply buys time (5×) | **fail**: 37.9 against 18.1 days | **fail**: 37.2 against 17.7 | **fail**: 40.9 against 11.9 | **fail**: 33.3 against 8.6 |
| 6 cold kills in the cold | pass: 39 of 39 hypothermia on colder days | pass: 74 of 74 | pass: 56 of 56; hyperthermia 2 of 2 on warmer | pass: 153 of 153; hyperthermia 30 of 30 |
| 7 old age kills the old | **fail**: 4 of 6 at 45 or older | pass: 15 of 16 | pass: 5 of 5 | **fail**: 8 of 10 |
| 8 a mix | pass: 5 causes, largest 78% | pass: 5, 70% | pass: 6, 72% | pass: 6, 42% |

(Seed 1 and 2's first printing of criterion 7 read every age at death as 0–4 years: an analysis bug, below. The table shows the corrected run, which changed nothing else.)

Deaths by cause, 600 bodies a world over 4 compressed years:

| Seed | Starvation | Dehydration | Hypothermia | Hyperthermia | Infection | Old age | Ambiguous tick | Alive at end |
|---|---|---|---|---|---|---|---|---|
| 1 | 465 | 54 | 39 | 0 | 17 | 6 | 14 | 5 |
| 2 | 417 | 65 | 74 | 0 | 14 | 16 | 10 | 4 |
| 3 | 427 | 85 | 56 | 2 | 10 | 5 | 12 | 3 |
| 4 | 254 | 95 | 153 | 30 | 6 | 10 | 51 | 1 |

No deaths by shock, lightning or congenital disorder in any world. (Shock needs a wound bleeding hard enough; the accidents' bleeding, U(0,1)² × 150 mL a minute, rarely reaches it. Founders are drawn as survivors and no one was born.)

## Diagnosis (nudge protocol, `GUARDRAILS.md` §4)

1. **An analysis bug.** The script read each body's birth tick after the death door had removed it, and the store clears a removed slot, so every age at death came out as the years since tick 0. Fixed in the script (age at formation + time since); nothing in `src/` was involved.
2. **The policy spends more than any body can eat.** Bodies under the random policy spent a median 4,513–4,804 kcal a day over their lives (men 4,958–5,365, women 4,194–4,449): efforts drawn uniformly average about 2.9 × the basal rate, plus walking, plus shivering on days whose median is 10–11 °C. A man's gut passes at most 4,320 kcal a day (§3.8), so no food supply in the run (at most 4,000) keeps a body: everyone starves in the end unless something else comes first. Part one's "supplied" group (criterion 5) was not supplied. (Real people have a ceiling near 2.5 × the basal rate on what they can sustain, which a policy free to ignore capacity runs straight through; Phase 3's acts read capacity.)
3. **Mild thirst is not severe at this spending.** Burning 4,500–5,000 kcal a day makes about 0.6 kg of water a day (§3.9), and on cool days bodies sweat little, so 0.5–1 kg of drink a day nearly balances; those bodies starve first. Criterion 3 assumed under 1 kg a day was well below need. Bodies with under 0.25 kg a day died of dehydration in 72–97% of cases, at medians of 7.6–11.8 days, beside Adolph's ~10 days resting in shade below 21 °C.
4. **Hunger at this spending takes about 15–22 days,** not the 30–80 of a resting fast: a Hadza-like body can draw about 90,000 kcal before it starves, at 4,500–5,500 a day. Criterion 4's floor of 15 days was a resting fast's.
5. **Old age is at the hazard's rate.** The Gompertz term (§3.12) predicts 7.4, 7.8, 7.1 and 6.3 deaths by old age over the time these bodies lived; 6, 16, 5 and 10 happened (37 in all against 28.6), with 5 under 45 against 1.9 expected. With 6 or 10 deaths, one or two under 45 fail a 90% rule by chance.

Classification: **none of the failures is a fault in the bodies.** One analysis bug (fixed), and criteria set against a policy I had not measured: (d)-like for the criteria, not for the simulation. Nothing in `src/` changed for this check.

## Part two (seeds 3 and 4, written before they ran): passed

| Criterion | Seed 3 | Seed 4 |
|---|---|---|
| 1, 2 | pass | pass |
| 3b severe thirst (*W* < 0.25 kg): ≥ 70% dehydration, median 5–15 days | pass: 96.9%, 9.4 days | pass: 95.5%, 7.6 days |
| 4b hunger at this spending: no dehydration, starvation at 10–40 days | pass: 15.0–22.8 days | pass: 15.6–21.7 days |
| 5b survival rises with food (water ≥ 3 kg), top ≥ 1.5 × bottom; and with water (< 1 kg) | pass: 21.0 < 27.3 < 34.1 < 40.9; 9.4 < 12.7 < 14.3 < 18.2 | pass: 19.8 < 26.1 < 28.7 < 33.3; 7.6 < 8.6 < 8.7 < 16.6 |
| 6 cold in the cold | pass | pass |
| 7b old age inside the 99% Poisson range of the hazard's prediction | pass: 5 in 1–15; under 45, 0 in 0–3 | pass: 10 in 1–14; under 45, 2 in 0–3 |
| 8 a mix | pass | pass |

## What this says, and what it doesn't
- **Exit criteria 1 and 2** (audits; scripted fixtures at their calibration targets) pass: `npm test`, here and on GitHub.
- **Exit criterion 3:** under a random stand-in policy, bodies die of hunger, thirst, cold, heat, infection and old age, each where its conditions are, in the order and on the time scales the physiology sets: thirst kills in about a week to ten days when it is severe, hunger in weeks at whatever the body spends, cold on cold days and heat on hot ones, old age at the rate the hazard says. The preregistered version of that check (part one) failed, for the reasons above; part two, written after the first run and tested on worlds not seen, passed.
- It can't say what real agents will die of: the policy is a stand-in that ignores capacity, never moves, never shelters, never meets an animal. The death mix that matters is Phase 3's random-action baseline, with real foraging, drinking and danger. Worth noting for Phase 3: **naked bodies in this climate die of cold a lot** (39–153 of 600 here, and in seed 4 more of the best-fed died of cold than of hunger), the risk already listed in `STATUS.md`.
- A judgment call for a Fable second look: whether a part two posed after seeing part one's failures is a fair test (it ran on fresh seeds, and part one's failure stands as written).
