# Results: P1 ecology review (Phase 1 exit, ROADMAP 1.10)

- **Run:** 2026-11-18/19, commit `90f36c0` (preregistration) on `main` at 1.8; 20 full-size worlds, 100 compressed years each, 75 minutes on 2 cores. Follow-up after corrections: 8 worlds (seeds 1–4 of each type), 32 minutes. Analysis: `analyze.ts` in this folder.
- **Model:** Opus 5.5 doing an [F] milestone at the owner's request.

## Verdict as preregistered: Phase 1 does not exit

| Criterion | Preregistered run (20 worlds) | After corrections (8 worlds, not preregistered) |
|---|---|---|
| 1. Persistence | **FAIL**: every hemmed world collapsed; deer fell below 0.4 per km² of land in all 10 (to zero in 2), wolves died out in 8 and big cats in 7 | **pass** in all 8 |
| 2. Bounded (≤ 5× start) | pass | pass (deer reach 3.7× on open land) |
| 3. Fire | **FAIL**: mean 1.24% of land per compressed year (limit 0.5%), worst year 174% (limit 25%) | **FAIL**: mean 1.15%, worst year 105% |
| 4. Both landscape types | pass (every seed: hemmed more walled in, less map edge) | pass |
| 5. Viewer | pass (`npm test` and CI) | pass |

The original criteria stand. The follow-up is not a replacement for them: it shows the corrections work on the worlds they were aimed at, and the next milestone (1.11) re-runs the full preregistered check.

## What went wrong, and why

**Hemmed valleys starved, then lost their predators.** Starting numbers were densities per km² of *all* dry land, but animals were placed only where food grows. A hemmed map is about one-third habitable, so the valleys started at about three times the intended density: 4,000–5,300 animals starved in year 3. After that, deer stayed underfed (births about 5% of the herd a year against 45% when well fed) because they searched only 800 m for food, so groups stripped the same patches while other parts of the valley went unused. Predators, held up by hares and aurochs, kept killing about 200 deer a year until the deer, then the predators, were gone. Corrections: starting numbers per km² of habitat; hungry grazers search 3 km (T-006, rounds 2–3). A probe of seed 2 on a 256-cell hemmed map then showed deer fully fed and growing for 12 years, with only a mild move uphill in summer (about 40 m), so the comfort preference was not to blame.

**Fire burned open country all-or-nothing.** Almost nothing for 30–40 compressed years, then one fire year burning 50–100% of an open plain. Part of this was a bug: burned meadows got almost a full autumn's litter afterwards and burned twice in a year (T-006, round 1; fixed). The rest is not a bug in any one place: a fire that dies down at night smoulders, flares in the morning, and in a dry spell crosses a continuous plain with nothing to stop it. Hemmed valleys burn 0–0.26% of their land per compressed year, inside the band; open plains burn 1.0–3.6%. For comparison, pre-settlement northern mixed-grass prairie burned every 15–30 years at a spot (about 0.4–0.9% of land per compressed year), some of it set by people, and fires there "ranged from local (tens of acres) to landscape level (thousands of acres)", smaller in summer because of green fuel and the rain that comes with lightning (USDA Fire Effects Information System; `RESEARCH.md`). The open plains burn two to four times too often, and their fires are far too big.

**Smaller findings.** With hungry deer finding food, open-country deer settle at 11–18 per km², above Białowieża's 3–6 with wolves present; greens are browsed down to a quarter to two-fifths of their start on two open seeds; big cats and wolves in hemmed valleys number a dozen or fewer, so long runs there can lose them by chance. None breaks a criterion; all go in `STATUS.md` as risks.

## The preregistered run in full
Runs found: 20 (101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101 samples each)

## Animals (per km² of land): start → end [min–max]

| run | deer | aurochs | wolf | cat | hare |
|---|---|---|---|---|---|
| hemmed 1 | 5.00 → 0.02 [0.02–5.31] | 0.50 → 0.21 [0.14–0.50] | 0.84 → 0.99 [0.84–1.34] | 0.77 → 0.15 [0.15–0.92] | 20.51 → 6.67 [6.61–20.51] |
| hemmed 2 | 5.00 → 0.02 [0.01–5.29] | 0.50 → 0.15 [0.12–0.50] | 0.92 → 0.00 [0.00–0.96] | 0.73 → 0.00 [0.00–1.07] | 19.78 → 6.52 [6.39–19.78] |
| hemmed 3 | 5.00 → 0.31 [0.31–5.26] | 0.50 → 0.20 [0.17–0.51] | 0.96 → 0.69 [0.50–1.30] | 0.61 → 0.42 [0.42–0.80] | 17.93 → 5.76 [3.55–17.93] |
| hemmed 4 | 5.00 → 0.08 [0.03–5.11] | 0.50 → 0.08 [0.08–0.51] | 0.96 → 0.00 [0.00–1.30] | 0.77 → 0.00 [0.00–0.77] | 20.39 → 6.75 [4.26–20.39] |
| hemmed 5 | 5.00 → 0.02 [0.02–5.25] | 0.50 → 0.07 [0.07–0.51] | 1.00 → 0.00 [0.00–1.19] | 0.80 → 0.00 [0.00–0.84] | 19.31 → 6.32 [6.20–19.31] |
| hemmed 6 | 5.00 → 0.00 [0.00–5.12] | 0.50 → 0.06 [0.06–0.50] | 0.73 → 0.00 [0.00–1.45] | 0.80 → 0.00 [0.00–0.92] | 22.36 → 7.46 [5.16–22.36] |
| hemmed 7 | 5.00 → 0.39 [0.34–5.12] | 0.50 → 0.10 [0.03–0.51] | 0.57 → 0.00 [0.00–0.84] | 0.73 → 0.27 [0.19–0.73] | 22.27 → 7.39 [4.19–22.27] |
| hemmed 8 | 5.00 → 0.00 [0.00–5.36] | 0.50 → 0.22 [0.16–0.51] | 0.88 → 0.00 [0.00–1.34] | 0.69 → 0.00 [0.00–0.88] | 19.30 → 6.28 [3.43–19.30] |
| hemmed 9 | 5.00 → 0.03 [0.01–5.35] | 0.50 → 0.12 [0.06–0.50] | 0.57 → 0.00 [0.00–1.00] | 0.77 → 0.00 [0.00–0.77] | 20.58 → 6.81 [1.91–20.58] |
| hemmed 10 | 5.00 → 0.12 [0.06–5.12] | 0.50 → 0.09 [0.07–0.51] | 0.96 → 0.00 [0.00–1.07] | 0.69 → 0.00 [0.00–0.73] | 22.29 → 7.38 [3.77–22.29] |
| open 1 | 5.00 → 7.14 [5.00–12.97] | 0.50 → 0.53 [0.34–0.84] | 2.00 → 2.27 [1.60–2.35] | 1.52 → 0.96 [0.92–1.52] | 30.00 → 11.96 [8.63–30.00] |
| open 2 | 5.00 → 7.71 [5.00–12.14] | 0.50 → 0.67 [0.34–0.67] | 1.99 → 2.79 [1.91–2.99] | 1.52 → 0.92 [0.92–1.63] | 30.00 → 20.18 [9.15–30.00] |
| open 3 | 5.00 → 6.50 [5.00–12.88] | 0.50 → 0.58 [0.20–0.58] | 2.01 → 2.09 [1.65–2.25] | 1.49 → 1.37 [1.21–1.53] | 30.00 → 20.24 [6.63–30.00] |
| open 4 | 5.00 → 6.95 [5.00–9.76] | 0.50 → 0.32 [0.31–0.65] | 1.96 → 2.47 [1.88–2.47] | 1.49 → 0.86 [0.74–1.49] | 30.00 → 14.15 [9.78–30.00] |
| open 5 | 5.00 → 6.18 [5.00–13.08] | 0.50 → 0.27 [0.15–0.59] | 1.71 → 2.02 [1.71–2.45] | 1.51 → 1.36 [0.93–1.55] | 30.00 → 19.38 [4.55–30.00] |
| open 6 | 5.00 → 3.38 [2.99–11.00] | 0.50 → 0.76 [0.33–0.76] | 2.00 → 1.72 [1.20–2.08] | 1.48 → 0.96 [0.96–1.56] | 30.00 → 20.19 [9.38–30.00] |
| open 7 | 5.00 → 7.91 [5.00–13.49] | 0.50 → 1.02 [0.46–1.02] | 1.98 → 2.34 [1.63–2.78] | 1.51 → 1.11 [1.11–1.51] | 30.00 → 20.11 [15.77–30.00] |
| open 8 | 5.00 → 7.68 [5.00–12.93] | 0.50 → 0.79 [0.30–0.79] | 1.87 → 1.75 [1.75–2.44] | 1.51 → 1.14 [0.90–1.51] | 30.00 → 20.19 [11.93–30.00] |
| open 9 | 5.00 → 6.52 [5.00–6.98] | 0.50 → 0.19 [0.06–0.60] | 1.99 → 2.61 [1.87–2.80] | 1.52 → 0.82 [0.58–1.52] | 30.00 → 20.28 [3.09–30.00] |
| open 10 | 5.00 → 5.74 [5.00–13.99] | 0.50 → 0.58 [0.46–0.79] | 1.88 → 3.29 [1.84–3.33] | 1.49 → 1.02 [0.98–1.49] | 30.00 → 16.42 [9.40–30.00] |

Wolves and big cats are per 100 km².

## Plants: end cover ÷ start cover (lowest over the run in brackets)

| run | grass | tuber | berry | nut | greens | bitterRoot | nightshade | reed |
|---|---|---|---|---|---|---|---|---|
| hemmed 1 | 1.08 (1.00) | 0.95 (0.93) | 1.11 (1.00) | 1.04 (1.00) | 0.88 (0.86) | 1.21 (1.00) | 1.14 (1.00) | 0.89 (0.89) |
| hemmed 2 | 1.12 (1.00) | 1.13 (1.00) | 1.09 (1.00) | 1.04 (1.00) | 0.72 (0.70) | 1.23 (1.00) | 1.07 (1.00) | 0.78 (0.78) |
| hemmed 3 | 1.21 (1.00) | 1.17 (1.00) | 1.13 (1.00) | 0.96 (0.92) | 0.60 (0.59) | 1.27 (1.00) | 1.15 (1.00) | 0.75 (0.75) |
| hemmed 4 | 1.02 (1.00) | 1.14 (1.00) | 1.02 (0.97) | 0.93 (0.91) | 1.02 (0.84) | 1.22 (1.00) | 1.05 (0.98) | 0.82 (0.82) |
| hemmed 5 | 1.00 (1.00) | 1.08 (1.00) | 1.08 (1.00) | 1.03 (1.00) | 0.92 (0.91) | 1.21 (1.00) | 1.09 (1.00) | 0.73 (0.73) |
| hemmed 6 | 1.06 (1.00) | 1.12 (1.00) | 1.01 (0.97) | 0.94 (0.91) | 1.04 (1.00) | 1.22 (1.00) | 1.03 (0.99) | 0.90 (0.90) |
| hemmed 7 | 1.09 (1.00) | 1.09 (1.00) | 1.01 (0.96) | 0.91 (0.89) | 0.98 (0.85) | 1.22 (1.00) | 1.08 (0.98) | 1.13 (0.96) |
| hemmed 8 | 1.05 (1.00) | 1.26 (1.00) | 1.04 (0.97) | 0.90 (0.87) | 0.95 (0.71) | 1.25 (1.00) | 1.08 (0.96) | 0.62 (0.62) |
| hemmed 9 | 1.15 (0.98) | 1.42 (1.00) | 0.97 (0.85) | 0.80 (0.75) | 0.93 (0.86) | 1.27 (1.00) | 0.96 (0.85) | 0.75 (0.75) |
| hemmed 10 | 1.14 (1.00) | 1.20 (0.99) | 0.98 (0.90) | 0.80 (0.77) | 0.99 (0.87) | 1.25 (1.00) | 1.06 (0.93) | 1.14 (0.97) |
| open 1 | 1.07 (0.95) | 1.17 (1.00) | 0.91 (0.85) | 0.66 (0.64) | 1.14 (0.96) | 1.22 (1.00) | 1.12 (0.90) | 1.04 (0.92) |
| open 2 | 1.23 (0.94) | 1.19 (1.00) | 1.03 (0.89) | 0.85 (0.83) | 0.61 (0.61) | 1.30 (1.00) | 1.11 (0.90) | 0.99 (0.86) |
| open 3 | 1.24 (0.91) | 1.37 (1.00) | 0.97 (0.84) | 0.73 (0.70) | 0.66 (0.66) | 1.39 (1.00) | 1.07 (0.82) | 0.91 (0.82) |
| open 4 | 1.00 (1.00) | 1.37 (1.00) | 0.84 (0.80) | 0.57 (0.56) | 1.28 (0.91) | 1.31 (1.00) | 1.08 (0.92) | 0.89 (0.84) |
| open 5 | 1.20 (0.94) | 1.24 (1.00) | 0.88 (0.78) | 0.59 (0.57) | 0.95 (0.70) | 1.32 (1.00) | 1.14 (0.90) | 1.16 (0.89) |
| open 6 | 1.08 (0.99) | 1.23 (1.00) | 0.93 (0.82) | 0.73 (0.71) | 1.03 (0.89) | 1.20 (1.00) | 1.07 (0.89) | 0.89 (0.89) |
| open 7 | 1.16 (0.99) | 0.96 (0.96) | 1.10 (0.99) | 0.96 (0.94) | 0.66 (0.66) | 1.17 (1.00) | 1.24 (1.00) | 1.02 (0.88) |
| open 8 | 1.22 (0.92) | 1.13 (1.00) | 1.06 (0.91) | 0.91 (0.87) | 0.59 (0.59) | 1.27 (1.00) | 1.12 (0.93) | 0.95 (0.86) |
| open 9 | 1.17 (0.93) | 1.72 (1.00) | 0.77 (0.69) | 0.49 (0.47) | 0.98 (0.86) | 1.52 (1.00) | 0.88 (0.80) | 0.68 (0.66) |
| open 10 | 1.18 (0.98) | 1.05 (0.89) | 1.08 (0.96) | 0.85 (0.83) | 0.68 (0.49) | 1.26 (1.00) | 1.26 (1.00) | 1.10 (0.91) |

## Fire

| run | land cells | fires lit by lightning | holdovers | cells burned | mean burned per compressed year | worst year |
|---|---|---|---|---|---|---|
| hemmed 1 | 261330 | 181 | 181 | 2 | 0.000% | 0.00% |
| hemmed 2 | 261269 | 150 | 150 | 0 | 0.000% | 0.00% |
| hemmed 3 | 261313 | 142 | 142 | 108996 | 0.417% | 41.15% |
| hemmed 4 | 261269 | 154 | 154 | 71522 | 0.274% | 27.37% |
| hemmed 5 | 261151 | 173 | 173 | 45 | 0.000% | 0.02% |
| hemmed 6 | 261556 | 175 | 175 | 43154 | 0.165% | 16.50% |
| hemmed 7 | 261589 | 153 | 153 | 67135 | 0.257% | 25.66% |
| hemmed 8 | 261108 | 154 | 154 | 89848 | 0.344% | 26.79% |
| hemmed 9 | 261264 | 133 | 133 | 168868 | 0.646% | 64.63% |
| hemmed 10 | 261572 | 148 | 148 | 219071 | 0.838% | 65.48% |
| open 1 | 250577 | 380 | 380 | 788453 | 3.147% | 143.12% |
| open 2 | 250784 | 388 | 388 | 276044 | 1.101% | 91.59% |
| open 3 | 248462 | 388 | 388 | 614100 | 2.472% | 173.63% |
| open 4 | 255106 | 357 | 357 | 851381 | 3.337% | 105.65% |
| open 5 | 257583 | 434 | 434 | 747948 | 2.904% | 172.71% |
| open 6 | 249453 | 327 | 327 | 375537 | 1.505% | 105.25% |
| open 7 | 252038 | 409 | 409 | 89290 | 0.354% | 26.71% |
| open 8 | 245757 | 465 | 465 | 362674 | 1.476% | 144.46% |
| open 9 | 256730 | 351 | 351 | 1064133 | 4.145% | 169.73% |
| open 10 | 255410 | 441 | 441 | 370341 | 1.450% | 129.01% |

Mean burned share across all runs: 1.2415% of land per compressed year. Worst single year: 173.63% (open seed 3). Runs with any fire: 19 of 20.

## Landscape types (year 0)

| seed | enclosed edge per cell: open → hemmed | map edge per cell: open → hemmed | habitable: open → hemmed |
|---|---|---|---|
| 1 | 0.0000 → 0.0116 | 0.0080 → 0.0041 | 0.97 → 0.36 |
| 2 | 0.0000 → 0.0121 | 0.0080 → 0.0038 | 0.97 → 0.35 |
| 3 | 0.0000 → 0.0133 | 0.0081 → 0.0039 | 0.96 → 0.32 |
| 4 | 0.0000 → 0.0118 | 0.0079 → 0.0039 | 0.99 → 0.36 |
| 5 | 0.0000 → 0.0123 | 0.0078 → 0.0039 | 1.00 → 0.34 |
| 6 | 0.0000 → 0.0092 | 0.0081 → 0.0045 | 0.97 → 0.39 |
| 7 | 0.0000 → 0.0092 | 0.0080 → 0.0044 | 0.98 → 0.39 |
| 8 | 0.0000 → 0.0124 | 0.0082 → 0.0042 | 0.95 → 0.34 |
| 9 | 0.0000 → 0.0115 | 0.0078 → 0.0040 | 1.00 → 0.37 |
| 10 | 0.0000 → 0.0095 | 0.0079 → 0.0045 | 0.99 → 0.39 |

## Criteria

1. Persistence: **FAIL**. Lost: hemmed seed 2: wolf; hemmed seed 2: cat; hemmed seed 4: wolf; hemmed seed 4: cat; hemmed seed 5: wolf; hemmed seed 5: cat; hemmed seed 6: deer; hemmed seed 6: wolf; hemmed seed 6: cat; hemmed seed 7: wolf; hemmed seed 8: deer; hemmed seed 8: wolf; hemmed seed 8: cat; hemmed seed 9: wolf; hemmed seed 9: cat; hemmed seed 10: wolf; hemmed seed 10: cat.
2. Bounded (never above 5× start): **pass**.
3. Fire: **FAIL** (any fire: true; mean 1.2415% ≤ 0.5%; worst year 173.63% ≤ 25%).
4. Both landscape types: **pass**.
5. Viewer: checked by `npm test` and CI, reported separately.

## Warnings

- Below 5% of start in more than 2 runs: deer (8 runs), wolf (8 runs), cat (7 runs).
- Plant species ending below 20% of start: none.
- Still changing fast over the last 30 years (more than 2× or less than 0.5×): hemmed seed 1: deer 0.19× from years 71–80 to 91–100; hemmed seed 2: deer 0.08× from years 71–80 to 91–100; hemmed seed 2: wolf 0.00× from years 71–80 to 91–100; hemmed seed 2: cat 0.00× from years 71–80 to 91–100; hemmed seed 3: deer 0.36× from years 71–80 to 91–100; hemmed seed 4: wolf 0.00× from years 71–80 to 91–100; hemmed seed 4: cat 0.00× from years 71–80 to 91–100; hemmed seed 5: deer 0.11× from years 71–80 to 91–100; hemmed seed 5: wolf 0.43× from years 71–80 to 91–100; hemmed seed 5: cat 0.00× from years 71–80 to 91–100; hemmed seed 6: deer 0.00× from years 71–80 to 91–100; hemmed seed 6: wolf 0.00× from years 71–80 to 91–100; hemmed seed 6: cat 0.00× from years 71–80 to 91–100; hemmed seed 7: wolf 0.00× from years 71–80 to 91–100; hemmed seed 7: cat 0.46× from years 71–80 to 91–100; hemmed seed 8: deer 0.00× from years 71–80 to 91–100; hemmed seed 8: wolf 0.00× from years 71–80 to 91–100; hemmed seed 8: cat 0.00× from years 71–80 to 91–100; hemmed seed 9: wolf 0.00× from years 71–80 to 91–100; hemmed seed 9: cat 0.00× from years 71–80 to 91–100; hemmed seed 10: deer 0.39× from years 71–80 to 91–100; hemmed seed 10: wolf 0.00× from years 71–80 to 91–100; hemmed seed 10: cat 0.00× from years 71–80 to 91–100.

## The follow-up in full

Runs found: 8 (101, 101, 101, 101, 101, 101, 101, 101 samples each)

## Animals (per km² of land): start → end [min–max]

| run | deer | aurochs | wolf | cat | hare |
|---|---|---|---|---|---|
| hemmed 1 | 1.71 → 3.76 [1.71–3.79] | 0.17 → 0.13 [0.11–0.19] | 0.57 → 0.69 [0.46–0.88] | 0.50 → 0.11 [0.11–0.50] | 16.80 → 6.74 [6.73–16.80] |
| hemmed 2 | 1.65 → 1.59 [1.48–1.89] | 0.16 → 0.12 [0.11–0.19] | 0.65 → 0.19 [0.19–0.96] | 0.50 → 0.80 [0.42–0.80] | 16.33 → 6.43 [6.43–16.33] |
| hemmed 3 | 1.49 → 3.33 [1.49–3.64] | 0.15 → 0.13 [0.11–0.20] | 0.61 → 0.84 [0.57–1.07] | 0.46 → 0.42 [0.27–0.46] | 14.81 → 5.87 [3.46–14.81] |
| hemmed 4 | 1.70 → 1.51 [1.43–1.91] | 0.17 → 0.10 [0.09–0.18] | 0.69 → 0.88 [0.65–1.22] | 0.50 → 0.42 [0.27–0.65] | 16.88 → 6.70 [4.71–16.88] |
| open 1 | 5.00 → 11.30 [5.00–18.73] | 0.50 → 1.03 [0.38–1.03] | 2.00 → 2.35 [1.28–2.35] | 1.52 → 0.96 [0.88–1.52] | 50.63 → 20.11 [7.72–50.63] |
| open 2 | 5.00 → 10.95 [5.00–15.83] | 0.50 → 1.25 [0.44–1.25] | 1.99 → 3.19 [1.87–3.39] | 1.52 → 1.12 [0.92–1.56] | 50.55 → 20.00 [11.50–50.55] |
| open 3 | 5.00 → 5.53 [5.00–18.23] | 0.50 → 0.12 [0.10–0.60] | 2.01 → 2.98 [1.69–3.22] | 1.49 → 0.85 [0.85–1.49] | 50.61 → 11.53 [2.32–50.61] |
| open 4 | 5.00 → 11.82 [5.00–16.86] | 0.50 → 0.83 [0.40–1.39] | 1.96 → 3.06 [1.84–3.06] | 1.49 → 1.18 [0.98–1.49] | 50.66 → 19.59 [8.91–50.66] |

Wolves and big cats are per 100 km².

## Plants: end cover ÷ start cover (lowest over the run in brackets)

| run | grass | tuber | berry | nut | greens | bitterRoot | nightshade | reed |
|---|---|---|---|---|---|---|---|---|
| hemmed 1 | 1.07 (1.00) | 0.95 (0.95) | 1.12 (1.00) | 1.05 (1.00) | 0.87 (0.87) | 1.21 (1.00) | 1.16 (1.00) | 0.86 (0.86) |
| hemmed 2 | 1.03 (0.99) | 1.18 (1.00) | 1.10 (1.00) | 1.04 (1.00) | 0.81 (0.80) | 1.23 (1.00) | 1.07 (1.00) | 0.58 (0.58) |
| hemmed 3 | 1.20 (1.00) | 1.19 (1.00) | 1.12 (1.00) | 0.92 (0.88) | 0.63 (0.63) | 1.27 (1.00) | 1.17 (0.97) | 0.82 (0.79) |
| hemmed 4 | 0.98 (0.96) | 1.17 (1.00) | 1.01 (0.97) | 0.89 (0.87) | 1.11 (0.91) | 1.22 (1.00) | 1.06 (0.99) | 0.78 (0.78) |
| open 1 | 1.43 (0.95) | 0.95 (0.95) | 1.09 (0.87) | 0.74 (0.70) | 0.40 (0.40) | 1.40 (1.00) | 1.40 (0.91) | 1.21 (0.90) |
| open 2 | 1.40 (0.91) | 0.98 (0.98) | 1.18 (0.91) | 0.88 (0.80) | 0.24 (0.24) | 1.43 (1.00) | 1.36 (0.94) | 0.96 (0.79) |
| open 3 | 1.45 (0.94) | 1.65 (1.00) | 0.84 (0.71) | 0.40 (0.38) | 0.55 (0.39) | 1.71 (1.00) | 1.12 (0.83) | 0.93 (0.77) |
| open 4 | 1.23 (1.00) | 1.26 (1.00) | 0.95 (0.85) | 0.57 (0.55) | 0.83 (0.67) | 1.46 (1.00) | 1.26 (0.91) | 1.00 (0.86) |

## Fire

| run | land cells | fires lit by lightning | holdovers | cells burned | mean burned per compressed year | worst year |
|---|---|---|---|---|---|---|
| hemmed 1 | 261330 | 181 | 181 | 2 | 0.000% | 0.00% |
| hemmed 2 | 261269 | 130 | 130 | 0 | 0.000% | 0.00% |
| hemmed 3 | 261313 | 136 | 136 | 67848 | 0.260% | 15.48% |
| hemmed 4 | 261269 | 144 | 144 | 62350 | 0.239% | 13.21% |
| open 1 | 250577 | 396 | 395 | 379125 | 1.513% | 79.16% |
| open 2 | 250784 | 403 | 403 | 256432 | 1.023% | 53.47% |
| open 3 | 248462 | 300 | 300 | 906199 | 3.647% | 104.63% |
| open 4 | 255106 | 360 | 360 | 637192 | 2.498% | 80.10% |

Mean burned share across all runs: 1.1474% of land per compressed year. Worst single year: 104.63% (open seed 3). Runs with any fire: 7 of 8.

## Landscape types (year 0)

| seed | enclosed edge per cell: open → hemmed | map edge per cell: open → hemmed | habitable: open → hemmed |
|---|---|---|---|
| 1 | 0.0000 → 0.0116 | 0.0080 → 0.0041 | 0.97 → 0.36 |
| 2 | 0.0000 → 0.0121 | 0.0080 → 0.0038 | 0.97 → 0.35 |
| 3 | 0.0000 → 0.0133 | 0.0081 → 0.0039 | 0.96 → 0.32 |
| 4 | 0.0000 → 0.0118 | 0.0079 → 0.0039 | 0.99 → 0.36 |

## Criteria

1. Persistence: **pass**.
2. Bounded (never above 5× start): **pass**.
3. Fire: **FAIL** (any fire: true; mean 1.1474% ≤ 0.5%; worst year 104.63% ≤ 25%).
4. Both landscape types: **pass**.
5. Viewer: checked by `npm test` and CI, reported separately.

## Warnings

- Below 5% of start in more than 2 runs: none.
- Plant species ending below 20% of start: none.
- Still changing fast over the last 30 years (more than 2× or less than 0.5×): open seed 3: hare 0.34× from years 71–80 to 91–100.

## Re-run after 1.11 and 1.12 (2026-11-19): Phase 1 still does not exit

- **Run:** 2026-11-19, unattended, Opus 5.5; commit `d9c0cb0` on `milestone-1.12` (1.11's five fire corrections, T-007; 1.12's water table and bare ground, D-035, T-008). The preregistered spec and analysis, unchanged: 20 full-size worlds, 100 compressed years each, 71 minutes on 2 cores.

| Criterion | This run (20 worlds) |
|---|---|
| 1. Persistence | **FAIL**: open seed 6 lost its wolves (year 80) after its deer starved (5.0 → 0.17 per km² by year 75; big cats down to one). Every other world kept every kind. |
| 2. Bounded (≤ 5× start) | pass (open deer reach 4.0× at most) |
| 3. Fire | **FAIL**: mean 0.64% of land per compressed year (limit 0.5%; the preregistered run had 1.24%), worst year 87% (limit 25%; was 174%) |
| 4. Both landscape types | pass |
| 5. Viewer | pass (`npm test` and CI) |

**Fire.** Better on every measure, not good enough. Open country averages 0.95% of its land a compressed year (0.13–2.17% by world; the design band is 0.4–0.9%), hemmed valleys 0.32% (0–1.06%). Six of the ten open worlds and one hemmed world (seed 10, 29%) have a year above 25%. Fires now come in every size, but in a dry autumn one can still cross most of an open world: the damp ground along streams branches like the streams do, and a branching network never closes round anything, so a fire walks round the heads of the streams. Almost all burning happens in autumn and early winter (season 0.5–0.875), after the dying-back season has cured everything and before the cold ends the storms that light fires.

**Open seed 6.** Its deer starved slowly from year 18 (hundreds a year) and collapsed by year 60; then the predators went. Its greens were never eaten down (cover 0.20 → 0.24, while on every other open world deer browsed them to 0.06–0.13), and its deer bred at a third of the rate of the other open worlds. The same world on `main` (the 1.11 merge, without 1.12; null comparison run for this) kept its deer (minimum 4.4 per km²) and its predators, but also starved 500–1,300 deer a year from year 25 to 80. So open seed 6 was already a world where deer starve beside uneaten food; 1.12's moister stream banks (more greens along streams) tipped it over. Why its deer don't reach the greens is not yet diagnosed.

| run | deer per km²: start → end [min–max] | wolves per 100 km² | big cats per 100 km² | greens cover end ÷ start |
|---|---|---|---|---|
| open 6, this run | 5.00 → 0.37 [0.17–7.33] | 2.00 → 0.00 | 1.48 → 0.04 | 1.24 |
| open 6, `main` | 5.00 → 5.78 [4.39–8.48] | 2.00 → 2.20 [1.52 min] | 1.48 → 0.84 | about 1.2 |
| other open worlds, this run | 5.00 → 9.1–13.8 | 1.9–3.5 at the end | 0.7–1.3 | 0.28–0.66 |

Hemmed valleys all kept every kind (deer 1.1–4.5 per km² at the end, wolves 0.3–1.7 and cats 0.2–0.8 per 100 km²). No plant species ended below 20% of its start; greens on open land ended at 28–66% of their start (79–112% on hemmed land, 124% on open seed 6), the browsed-down warning from the 1.10 review.

The full tables (`node experiments/P1-ecology-review/analyze.ts runs/P1-ecology-review`) are reproducible from the commit above; the summary is here.

## Re-run after 1.13 (2026-11-19): Phase 1 exits, with fire reported as failed

- **Run:** 2026-11-19, unattended, Opus 5.5; commit `6fc9b76` on `milestone-1.13` (T-009: deer at a predator's exact position bolt in a random direction, not due east). The preregistered spec and analysis, unchanged: 20 full-size worlds, 100 compressed years each, 85 minutes on 2 cores.
- **The rule for exit** is the owner's (Q10, D-037): Phase 1 exits when the other four criteria pass, with fire reported as failed. The fire criterion itself is not changed.

| Criterion | This run (20 worlds) |
|---|---|
| 1. Persistence | **pass**: every kind present at every yearly sample in all 20 worlds. Open seed 6 ends at 11.4 deer per km² (minimum 5.0), 1.72 wolves and 1.00 big cats per 100 km². |
| 2. Bounded (≤ 5× start) | pass (open deer reach 3.9× at most) |
| 3. Fire | **FAIL**: mean 0.68% of land per compressed year (limit 0.5%; 0.64% in the 1.12 run), worst year 102% (limit 25%; open seed 2; was 87%) |
| 4. Both landscape types | pass |
| 5. Viewer | pass (`npm test` locally, 187 tests; GitHub's checks on the fix commit) |

Warnings: none (no kind below 5% of its start in more than 2 runs, no plant species below 20% of its start, nothing still changing more than 2× over the last 30 years).

**Fire**, as accepted (D-037): open country 1.18% of its land a compressed year (0.58–2.45% by world), hemmed valleys 0.18% (0–0.48%); nine of the ten open worlds have a year above 25%, no hemmed world does (worst 17.9%). Slightly worse than the 1.12 run on open land (0.95%). Weather and fire draw on their own random streams, so the difference comes through the plants and animals: a changed herd changes the fuel a little, and in a regime where one dry autumn decides a world's total, a little is enough. Not a trend to read anything into.

**Open seed 6** now behaves like the other open worlds: deer 5.0 → 11.4 per km² [5.0–18.6], greens browsed to 36% of their start (other open worlds 28–69%). Its diagnosis: `experiments/P1-open-seed-6/results.md`.

**What to watch.** Hemmed seed 5's deer are still falling at year 100 (1.39 per km² at year 70, 0.49 at year 100, the run's minimum). Hunger deaths there are low (20–55 a decade from year 70); wolves and big cats kill 1,800–2,300 deer a decade while births fall from 2,400 to 1,100, and the predators are held up by hares and aurochs. That is a predator pit, an ordinary dynamic, not a fault found; but this world's persistence beyond 100 compressed years is not shown. Hemmed deer elsewhere end at 1.3–5.0 per km².

| run | deer per km²: start → end [min–max] | wolves per 100 km² | big cats per 100 km² |
|---|---|---|---|
| open 6, this run | 5.00 → 11.44 [5.00–18.59] | 2.00 → 1.72 | 1.48 → 1.00 |
| open 6, 1.12 run | 5.00 → 0.37 [0.17–7.33] | 2.00 → 0.00 | 1.48 → 0.04 |
| other open worlds, this run | 5.00 → 9.5–13.7 | 1.6–2.8 at the end | 0.8–1.4 |
| hemmed worlds, this run | 1.5–1.9 → 0.49–5.01 | 0.4–1.2 | 0.2–1.2 |

The full tables (`node experiments/P1-ecology-review/analyze.ts runs/P1-ecology-review`) are reproducible from the commit above; the summary is here.
