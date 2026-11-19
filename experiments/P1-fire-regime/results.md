# Fire regime on open country (milestone 1.11): diagnosis and five corrections

- **Run:** 2026-11-19, unattended, Opus 5.5. Branch `milestone-1.11`. Tuning log: `docs/TUNING_LOG.md` T-007. Decision: `docs/DECISIONS.md` D-033.
- **Method:** `diagnose.ts` in this folder runs the world without agents for 100 compressed years on 256 × 256-cell maps (25.6 km across, a quarter of the full map, for speed) and logs every fire that flamed. Open country (`circumscription` 0), seeds 1–4 at first, 1–8 from round 2 on. Each round changed one thing, written in T-007 before the change.
- **This is a calibration record, not the exit check.** The preregistered Phase 1 check (`../P1-ecology-review/`) was not re-run: the fire criterion cannot pass until fire sizes are limited, and that needs an owner decision (below).

## What the diagnosis found (before any change)

- Ignitions are not the problem. Of 150–165 lightning holdovers per world, only 3–4 ever flamed; every lightning start was a holdover, because the storm's rain already wet the fine fuel it struck.
- Size is. The fires that flamed started in the dying-back season (season 0.46–0.64), usually on soil that was *not* in drought (0.43–0.93), and burned 6–30 days, through 3–36 nights and 4–10 wet days, taking 25–113% of the map.
- Nights didn't stop them. A third of cell ignitions came between 19:00 and 07:00. In a day-by-day trace (open seed 4, year 44), fine fuel at the burning edge sat at 21–23% moisture at 03:00, just under the 24% at which the code let it stop.
- Rain didn't stop them either. In a trace of a wet-year fire (open seed 5, year 28, soil 0.93–1.00) the fire survived rains of 31.5, 22.5 and 26.2 mm: a few of its 600–3,500 smouldering cells outlasted each, and the next dry afternoon the litter was at 11–12% moisture again.
- Open country is a grassy woodland: 96% of its land has 10–40% tree cover, 3.2–4.3 t/ha of litter and 4–7.5 t/ha of fallen wood, all of it continuous.
- Grazing can't break the fuel up: grazers eat about 1% of the year's grass litter (the compressed year gives plants 48 days' worth of animal appetite against a year's growth).

## The five corrections and what each did

Mean share of land burned per compressed year (counting every ignition, as the preregistered check does), the worst single year, and how many fires flamed (how many of them stayed under 1 km²). Open country, 256-cell maps, 100 compressed years.

| seed | before | 1: dew | 2: light-wind limit | 3: rain kept in litter | 4: storm rain heaviest at the core | 5: holdovers last ~2 days |
|---|---|---|---|---|---|---|
| 1 | 1.28%, 73%, 4 (0) | 2.88%, 88%, 5 (1) | 0.94%, 93%, 4 (2) | 0, 0, 0 | 0.002%, 0.2%, 3 (2) | 2.92%, 104%, 13 (7) |
| 2 | 1.59%, 113%, 3 (1) | 0.81%, 45%, 6 (3) | 2.12%, 97%, 4 (1) | 0, 0, 0 | 0.000%, 0.0%, 1 (1) | 1.40%, 100%, 8 (4) |
| 3 | 0.02%, 1.5%, 4 (3) | 0.18%, 18%, 4 (3) | 0.54%, 54%, 2 (1) | 0.18%, 18%, 2 (1) | 0, 0, 0 | 1.75%, 106%, 6 (1) |
| 4 | 2.91%, 103%, 4 (1) | 1.59%, 103%, 6 (3) | 3.09%, 104%, 5 (1) | 0.86%, 86%, 1 (0) | 0.70%, 70%, 2 (1) | 4.11%, 95%, 10 (2) |
| 5 | | | 1.19%, 88%, 3 (0) | 0, 0, 0 | 0, 0, 0 | 4.08%, 106%, 10 (5) |
| 6 | | | 0.67%, 67%, 4 (3) | 0, 0, 0 | 0, 0, 0 | 1.79%, 82%, 9 (3) |
| 7 | | | 0.34%, 34%, 1 (0) | 0, 0, 0 | 0.000%, 0.0%, 1 (1) | 0.82%, 82%, 2 (1) |
| 8 | | | about 0.1%, 5%, 3 (2) | 0, 0, 0 | 0.000%, 0.0%, 1 (1) | 5.09%, 110%, 12 (4) |
| **mean** | **1.45%** | **1.37%** | **1.12%** | **0.13%** | **0.09%** | **2.75%** |

Target (`DESIGN.md` §2.16): 0.4–0.9% on open country and no year above 25%. On these quarter-size maps a fire of fixed size takes four times the share it would on the full map, so the worst-year column overstates what the full check would see; but most of these fires were stopped by the map's edge, so they would be larger on a larger map.

1. **Dew** on fine fuel when the air is humid enough (about 90%). Physically right, little effect: on this ground the humidity estimate reaches 90% only on wet soil.
2. **The light-wind moisture limit**, a bug fix: Cheney et al.'s grass model stops fire at 20% fuel moisture in winds under 10 km/h, and only the strong-wind 24% had been coded. Night spread fell from about a third of ignitions to 12–35%.
3. **Rain kept in the litter** for about two-thirds of a day after it falls (the Fine Fuel Moisture Code's time lag). Fires now pause for a day or two after real rain. But lightning comes only with storms, so this also kept the litter around every strike too wet until the holdover had gone out: fire nearly vanished.
4. **Storm rain heaviest at the core**, the same total water. Strikes at the storm's light-rain edge now start a few small fires in flame. Still almost no fire.
5. **Lightning holdovers last about two days** (half-life 46 h, from holdover-time data; the embers a front leaves keep their 11-hour half-life). Fires start again, ten or so per world, half of them staying under 1 km². The ones that get going still burn most of the map.

## Where this leaves the fire regime

Each correction is physically right on its own terms, and none of them limits the size of a fire once it is going. The reason is arithmetic. A fire front is 1,000–4,000 burning cells, each with tonnes of smouldering wood. A night, a dew, or a day of light rain stops the flames everywhere, but if even one cell in a few hundred keeps an ember until the litter dries, the fire comes back. Only rain heavy enough to keep the litter wet for several days, longer than the embers last, stops it. Between such rains, a fire spreads until it runs out of map.

Real fires stop for a reason this world lacks: **breaks in the fuel**. Real ground has bare and rocky patches, wet hollows, trails, and moist strips along streams, so a front keeps losing pieces of itself and has to find connected fuel. Here, 96% of open land carries the same 3–4 t/ha of litter from edge to edge, and only one-cell rivers break it. The design already lists both missing pieces ("sub-cell patchiness of fuel", "a water table that keeps riverbanks moist", `DESIGN.md` §2.16, *Not in this version*). Adding either is a new mechanism, which needs the owner's approval (`GUARDRAILS.md` §4, D-025). That is where this run stops.

## Hemmed valleys (after all five corrections)

Same method, `circumscription` 1, seeds 1–4:

| seed | mean burned per compressed year | worst year | fires that flamed (under 1 km²) | largest fires, cells |
|---|---|---|---|---|
| 1 | 0.42% | 17.9% | 7 (3) | 11,658; 8,198; 4,627 |
| 2 | 0.003% | 0.3% | 2 (1) | 200; 1 |
| 3 | 0.15% | 7.5% | 4 (0) | 4,874; 4,630; 276 |
| 4 | 0.25% | 16.1% | 5 (1) | 10,499; 3,511; 2,053 |
| **mean** | **0.21%** | | | |

Inside their band (at most 0.5%), and no year above 25% even on quarter-size maps. Valley walls are fuel breaks, and the fires stop at them: the same physics on ground with breaks gives the kind of regime the targets describe. That supports the diagnosis above.
