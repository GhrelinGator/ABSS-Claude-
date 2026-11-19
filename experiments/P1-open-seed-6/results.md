# Open seed 6: deer that starve beside food (milestone 1.13)

- **Run:** 2026-11-19, unattended, Opus 5.5 (an [F] milestone on Opus, D-034). Commit: the 1.13 branch; the fix is T-009.
- **Not an experiment.** No agents, nothing social. A diagnosis of why one world of the Phase 1 exit check (`experiments/P1-ecology-review/results.md`, last section) lost its deer and then its predators.
- **Tools:** `diagnose.ts` (eight samples a compressed year: where the deer are, how fed, what food each group could find from where it stands, where the food is, births and deaths a year, and coarse maps) and `follow.ts` (follows the starving groups hour by hour from a saved moment). Both read the sim and write nothing to it.

## What the numbers said first

Full-size open seed 6 against open seed 1, 35 compressed years, before any change.

| | seed 6, year 20 | seed 1, year 20 | seed 6, year 34 | seed 1, year 34 |
|---|---|---|---|---|
| deer | 18,200 | 19,800 | 12,700 | 31,600 |
| mean condition | 0.98 | 1.00 | 0.98 | 0.98 |
| deer below 0.3 condition (starving) | 1–2% | 0% | 0–2% | 0% |
| deer food within 1 km of a deer group | 73% | 72% | 59% | 85% |
| hunger deaths that year (all kinds of group) | 731 | 36 | 596 | 53 |
| births per deer that year | 5.8% | 5.8% | 6.0% | 5.5% |

Food was not short. Seed 1 carried more deer with almost no hunger deaths, and seed 6's herd as a whole was well fed and bred at the same rate per deer. The deaths came from a small share of the herd that was starving outright.

## Where the starving deer were

At year 20 every starving group (26 groups, 230 deer), and every deer that had gone more than 100 hours without drinking (409), stood on one row of cells, 32.65 km north, between 49.95 km east and the map's east edge at 51.2 km. Followed hour by hour, each group shuttled between the two ends of that row:

1. At the edge, thirsty, a group walks the shortest way toward water, a stretch of 12 cells at a time. From the edge cell the stretch ends exactly at the centre of cell (499, 326), 1.25 km west.
2. A wolf pack (7, fully fed) and a big cat sit at exactly that point, at a carcass: deer stop at cell centres, so predators that kill them there end up at the same point.
3. At distance zero, `flee()` has no direction away from the wolves, so it used its fallback: due east. The deer run 1.5 km east, into the map edge, and stop there.
4. An hour later they are still thirsty, and the walk to water takes them back to exactly the same point.

They never reached water (some had gone 1,400 hours, 58 days; animals here don't die of thirst), never searched for food (thirst and flight come before the food search), and ate the row bare. The predators never left: the deer starving beside them kept feeding them. Groups that drifted into the row stayed until they died, hundreds of deer a year for decades. As the trap drained the herd faster than it bred, births fell with the herd, which is the low breeding the 1.12 exit run saw.

The greens were not out of reach. They were left uneaten because the herd shrank; with the trap gone, seed 6's deer browse greens like any other open world's (cover 0.21 at year 34, against 0.25 on seed 1 and 0.19 on seed 3).

## The fix (T-009)

At distance zero, `flee()` and `leaveFire()` now pick a random direction (uniform over the circle, from the ecology stream) instead of due east. Classified as a bug: a fixed compass direction in a degenerate case.

| | before | after |
|---|---|---|
| Year-20 moment, reloaded with the fix | 409 deer more than 100 h without water | none after one day; starving deer fell from 230 to 68 in 12 days as they fed |
| Seed 6, hunger deaths a year, years 18–34 | 490–980 | 0–56 |
| Seed 6, deer at year 34 | 12,700 | 32,000 (seed 1: 31,600; seed 3: 29,800) |

The same world on `main` before 1.12 also starved 500–1,300 deer a year from year 25 (`experiments/P1-ecology-review/results.md`, last section). That run was not repeated here; the same trap at another point on the edge, with 1.12's streams moving the routes to water, is the likely cause, not a verified one.

## What is left

- The map edge still stops a flight dead. A wolf pack within 1.5 km of the edge, on a route to water, could hold deer in a shorter loop (flee to the edge, walk back to within 300 m, flee again). None was seen in the runs after the fix; the full exit check below is the test.
- Animals don't die of thirst. That is part of their simple design (§2.13), not changed here.

The full preregistered exit check, re-run with the fix, is in `experiments/P1-ecology-review/results.md`, last section.
