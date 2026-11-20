# Preregistration: P2 bodies exit check (ROADMAP Phase 2, exit; milestone 2.8)

- **Date written:** 2026-11-20 (US Central 2026-11-19, evening), before any run of `random-policy.ts`
- **Commit:** the commit that adds this file (the code it runs is `main` at 2.7 plus T-014)
- **Author/model:** Opus 5.5, unattended run on an [F] milestone (no Fable credits, D-034); `CLAUDE.md` says to proceed and be extra careful.

This is not a social experiment. Nothing here measures or can measure a social outcome: bodies have no minds, and the policy that acts for them is random and scripted (`tests/` stand-ins only; nothing here enters `src/`). It checks Phase 2's exit criteria, written before the run so the thresholds can't be chosen to fit the results.

## Phase 2's exit criteria (`ROADMAP.md`)
1. Energy and water audits pass.
2. The scripted fixtures in `tests/` hit their calibration targets within tolerance.
3. Agents running a random policy die of a plausible mix of causes.

Criteria 1 and 2 are the test suite (`npm test`: `tests/guardrails/energy-audit.test.ts` and every calibration test in `tests/unit/`), run locally and on GitHub; criterion 1 is also checked inside the run below. Criterion 3 is this experiment.

## What a "plausible mix" means here
A random policy is not a forager, so Gurven & Kaplan's (2007) forager causes of death are not the target. The target is physiology: each cause should kill the bodies whose circumstances lead to it, in the order and on the time scale the physiology sets, and only those. Thirst kills before hunger; hunger takes weeks; cold kills in the cold season; old age kills the old; every death has one cause and is counted once.

## Setup (`random-policy.ts`)
- **Worlds:** the real pipeline (`SIM_PIPELINE`, all fifteen systems) on full-size default worlds (512 × 512 cells of 100 m), seeds 1 and 2. 4 compressed years (27,648 ticks of 10 minutes).
- **Bodies:** 600 per world, formed at tick 0 at uniformly random land cells (no river, lake or spring), alternating sex, Hadza-like bodies (`tests/fixtures/bodies.ts`: 44 kg lean and 6.9 kg fat for men, 34 and 9.0 for women, conditioned to a forager's working day) with ages drawn uniformly from 15 to 75 compressed years, each with a founder's genome. Naked, no hides, no fire, never moving from where formed. No mating or nursing.
- **The random policy** (the fixture stream, so no world draw changes):
  - Each hour, every body takes an effort drawn uniformly from sleep, still, light, moderate and heavy, and with chance 0.3 walks for a random share of that hour at a random speed up to 2 m/s (reported to metabolism; the position does not change).
  - Each body is given, once, a food supply *F* uniform on 0–4,000 kcal a day and a water supply *W* uniform on 0–6 kg a day. Each hour it eats with chance 1/4 a meal of U(0, 2) × *F*/6 kcal, and drinks with chance 1/2 U(0, 2) × *W*/12 kg. Supply never responds to need.
  - Accidents and foul water as in the energy-audit fixture (`fxBodyWork`): with chance 0.0002 a tick (about one a month) a wound of U(0, 30) cm², bleeding U(0,1)² × 150 mL a minute, dirt U(0, 1), a broken leg with chance 0.2 and a strain with chance 0.3; with chance 0.001 a tick a litre of water at up to 0.3 of a full bloom.
- **Recorded:** each body's *F*, *W*, sex, age at formation; for each death, the tick, the age and the cause (from the change in `body.deaths` that tick: a tick whose deaths have more than one cause is counted as ambiguous, and those bodies are left out of per-body tests but kept in totals); the daily mean air temperature over the living bodies (`airC`); the conserved-stock audit every simulated day.

## Pass criteria (all must hold in both worlds)
1. **Audits:** no mismatch in any daily audit; no NaN or infinite value in any body column at the end.
2. **One cause per death:** the bodies lost equal the deaths tallied by cause, and every tally belongs to a defined cause.
3. **Thirst before hunger:** of bodies with *W* < 1 kg a day, at least 90% die of dehydration, none of starvation, and their median time to death is 2–12 days (resting adults in shade last about 10 days below 21 °C and a day or two in desert heat: Adolph, via Allen 1956 and Leithead & Lind 1964; these bodies are not resting).
4. **Hunger takes weeks:** of bodies with *W* ≥ 3 kg and *F* < 400 kcal a day, at most 10% die of dehydration, and those that die of starvation die after 15–80 days (§3.8: a lean adult fasting with water dies in 30–80 days; these work harder at random and may be cold).
5. **Supply buys time:** the median survival of bodies with *F* ≥ 3,000 kcal and *W* ≥ 4 kg a day is at least 5 times that of the group in criterion 3 (bodies alive at the end count as surviving the whole run).
6. **Cold kills in the cold:** if there are at least 10 deaths by hypothermia, at least two-thirds fall on days colder than the run's median day; if at least 10 by hyperthermia, at least two-thirds on days warmer than the median.
7. **Old age kills the old:** if there are at least 5 deaths by old age, at least 90% are at 45 or older.
8. **A mix:** at least four causes kill someone, and no cause accounts for more than 90% of all deaths.

## Reported, not pass/fail
Deaths by cause and by supply group; the share of ambiguous ticks; how many bodies live to the end; shock and infection deaths per wound dealt; lightning deaths; congenital deaths (expected 0: founders are drawn as survivors and no one is born).

## Analysis plan
`random-policy.ts` prints the counts and each criterion with its numbers, and writes them to `results.md` by hand. No criterion is changed after seeing results; if one turns out to be ill-posed, that is said in `results.md`, and the original stands. A failure is diagnosed by the nudge protocol (`GUARDRAILS.md` §4) before any change, and every change is logged in `TUNING_LOG.md` first.
