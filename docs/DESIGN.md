# Design

The full design of the simulation. Section numbers are referenced from `CLAUDE.md` and `GUARDRAILS.md`. Don't renumber; add subsections instead.

Anything marked **[provisional]** is a starting point to revisit with data. Anything marked **[open]** needs a decision (see `STATUS.md`).

---

## 0. Philosophy and the floor

### 0.1 The rule
Code mechanisms, never outcomes. The simulation contains physics, ecology, bodies, and minds that learn. Society is something the analysis layer finds.

### 0.2 The floor
Something has to be given. The **floor** is the line between what we code and what must emerge. The floor is set at roughly what evolution handed early humans: bodies, drives, a learning mind, the ability to watch and copy others, and pointing. Everything above that has to emerge.

Two principles keep the floor honest:
1. **Every given faculty needs an ecological alibi**: a reason it would exist in a world where society never forms (`GUARDRAILS.md` §3).
2. **Every given bias is a heritable dial.** Evolution can turn it down to its neutral value. Dials that could *produce* a hoped-for outcome start **centered on neutral, with wide variance**, so evolution has to do the pushing. Dials that are *survival-critical* for founders (infant care, for example) start at viable values, and that choice is logged as a viability decision.

### 0.3 What is given vs. what must emerge

| Given (the floor) | Must emerge (never coded) |
|---|---|
| Terrain, water, climate, weather, day/night, light | Camps, home ranges, territories |
| Plants and animals with ecological behavior | Knowing which plants are food or poison |
| Materials with physical attributes; fire as a physical process | Tool making, fire keeping, fire making, cooking |
| Real hidden causes (pathogens, delayed toxins, ambush predators) | Beliefs about invisible causes; gods |
| Metabolism, hydration, thermoregulation, injury, healing, aging | Care for the injured; food sharing |
| Sexual reproduction, gestation, lactation, child dependency | Pair bonds, marriage-like patterns, incest avoidance |
| Genes as heritable dials, recombination, mutation, inbreeding depression | Which social dispositions evolve |
| Perception, drives, associative learning, world model, hidden-cause inference | Superstition, ritual, offerings |
| Watching and copying others, with heritable copying biases | Teaching, traditions, techniques |
| Pointing at perceivable things; coining arbitrary tokens | Shared vocabulary, talking about absent things, myths |
| Physical primitives: give, take, attack, follow, signal, etc. | Trade, leadership, hierarchy, law, raids, war, states |

### 0.4 Language floors
- **Floor 1 (start here):** pointing (deixis) is free. An agent can refer to anything both it and the listener can currently perceive. Referring to anything absent (a place, a person, a hidden cause) requires a **coined token**, an arbitrary symbol the speaker invents. Listeners must *infer* what a coined token means. Messages are unordered bags of up to K tokens (K = 4 [provisional]). Talking about absent things (what linguists call displacement) has to be invented, and myths need displacement.
- **Floor 2 (later):** no free pointing. Signal meanings are learned from scratch through repeated signaling games. Requires a learned-signal implementation of the same interface (§6.6).
- **Floor 3 (research):** compositional language that can express causes, past events, and claims about absent agents. As far as we know, nobody has demonstrated this from scratch. It is not a roadmap milestone; it's a direction.

The signal layer sits behind an interface (§6.6), so the floor can be raised without rewriting anything above it.

### 0.5 No LLMs in agent minds
Agents use small, structured learners whose content is learned. An LLM brings all of human culture with it, so anything it "invents" is retrieval (Project Sid's religion was seeded and LLM-driven). See `GUARDRAILS.md` T12.

---

## 1. Time, space, and scale

### 1.1 Time [provisional]
- Base tick: **10 simulated minutes**. A day is 144 ticks. Day and night are real, because darkness matters (§2.4, §7.6).
- **Calendar compression:** a simulated year is shorter than 365 days (default 48 days, so 12 days per season). Lifespans, maturity, and gestation are expressed in years and scale with it. **Ratios are preserved**: the fraction of life spent as a dependent child, interbirth interval relative to lifespan, and so on. This is the main lever for getting enough generations.
- Sleeping agents update coarsely (once per hour), since little happens while asleep.
- The environment updates on its own slower clock: plants daily, climate per season.
- **Exception for food (D-024, D-026):** anything agents could eat runs on real days, so food per km² per day, and with it how many people the land can feed, is realistic: the edible parts of plants, and animals' eating, hunting, births and deaths. Only the timing (fruiting windows, birth seasons) follows the compressed calendar.

### 1.2 Space [provisional]
- Environment grid: 512 × 512 cells, 100 m per cell (about 51 km per side), so several populations can start out of contact.
- Agents and animals have continuous positions; the grid holds terrain, water, vegetation, and objects.

### 1.3 Scale budget
Mind complexity × population × generations is the budget, and all three can't be maxed. Cultural phenomena (techniques, vocabularies, beliefs) can emerge within a few generations. Genetic changes to dispositions need many. So:
- **Cultural experiments:** hundreds of agents, ~5–20 generations, many seeds.
- **Evolutionary experiments:** fewer seeds, longer runs, simplified minds where justified.

**Phase 0 benchmark target [provisional]:** 500 agents at ≥ 1 generation per ~10 real minutes on one core, so 100 generations is an overnight run. Seeds run in parallel across cores. If TypeScript can't hit this, hot loops port to Rust/WASM (`DECISIONS.md` D-007).

### 1.4 Determinism
Seeded PRNG streams (separate streams for climate, ecology, each agent's decisions, so adding an agent doesn't reshuffle the weather). Fixed update order. State is serializable for snapshot and replay.

### 1.5 Kernel architecture (added in Phase 0)
The kernel is the substrate everything else runs on. It contains no mechanisms of its own.

- **One write routine per piece of state.** All simulation state lives in registered parts (entity stores, the run-wide stream block, world layers). Each part has a single `write(sink)` routine. Snapshots and state hashes both come from that routine, through a byte sink or a hash sink, so what is saved and what is hashed can't drift apart.
- **Snapshots are self-describing:** format version, the canonical config JSON, the pipeline's system names, the tick, then every part in registration order. Loading rebuilds the sim from the embedded config and refuses a snapshot whose pipeline or column layout doesn't match.
- **Entity stores** are structure-of-arrays over typed arrays. Each column declares a **category**: `kernel`, `identity`, `body`, `genome`, or `learned`. A slot is zero-filled when it is assigned and again when it is released, so a reused slot can't inherit anything. Stores grow by doubling. **There is no population cap**, because a cap would be a hidden carrying capacity.
- **Blank slate, enforced at run time.** No system may write learned content for an agent during the tick it was spawned. That makes "every agent spawned this tick holds no learned content" a checkable invariant for founders and newborns alike, whatever code path created them. The only code allowed to assign a slot is `spawnAgent` in the kernel.
- **Conserved quantities.** Columns can be tagged as the stock, cumulative inflow, or cumulative outflow of a conserved quantity (energy, water). The audit checks `stock = inflow − outflow` for every live entity. A founder's starting reserve and a newborn's endowment are recorded as inflows, so the identity holds from the first tick.
- **Pipeline.** A tick runs a fixed, ordered list of systems. Each system is created through `defineSystem` under an `// ALIBI:` comment, may run every N ticks, declares the columns it needs, and is bound to one sim instance. There is no module-level mutable state, so several sims can run in one process.
- **Streams.** The generator is sfc32. Each consumer's stream is seeded by hashing (run seed, domain, id) into 96 bits through three independent lanes. Per-entity streams are keyed by the entity's id, which is never reused.
- **Portable arithmetic.** `src/sim/` may use only operations whose results the standard fixes exactly: `+ − × ÷`, `Math.sqrt`, rounding, and integer and bit operations. Engine-provided transcendental functions (`Math.sin`, `exp`, `log`, `pow`, the `**` operator, and the rest) are implementation-defined, so they are banned. When the sim first needs one, it gets a pure-arithmetic implementation in `src/sim/core/dmath.ts`. The goal: a run the owner watches in a browser can be replayed bit-for-bit in Node. State never holds NaN or infinite values.
- **Derived caches** (the spatial index, id-to-slot maps) are rebuilt from state and never serialized.
- **World setup happens before tick 0** (added in Phase 1.1). A system may have an `init(sim)` step that builds what exists before anything happens, such as the landscape. It runs once, in pipeline order, when a sim is created fresh, and never when a sim is loaded from a snapshot, because the snapshot already holds the result. Setup draws only from the `WORLD_GEN` stream or from hashes of the seed, and must not spawn agents. A system's `create` runs before any setup step and before a snapshot is read, so world layers are still blank inside `create`: a cache derived from them (such as the plants' habitat map) is built on the system's first run, never in `create` itself (added in Phase 1.4, after exactly that mistake).
- **Read-only analysis.** `src/analysis/` reaches the sim only through `src/sim/readonly.ts`. A guardrail test checks that a run with observers attached hashes identically to one without.
- **No asynchrony.** The sim is synchronous: no promises, timers, or workers inside `src/sim/`. Parallelism happens across runs, in the harness.

### 1.6 Simultaneous actions (design rule for Phases 3–4)
Agents decide from the same tick-start state, and conflicts (two agents taking the same object) are resolved afterwards with seeded tie-breaks. No agent gets a standing first-mover advantage from where it sits in memory. The decide phase only reads shared state, which also leaves room to run it in parallel later.

### 1.7 Compute budget (measured in Phase 0)
The §1.3 target (500 agents, one generation per 10 real minutes, one core) works out to **about 6.9 microseconds per agent per tick** for everything: bodies, perception, minds. The arithmetic: a generation is taken as 25 simulated years × 48 days × 144 ticks = 172,800 ticks, so the target is 288 ticks per second at 500 agents. Measured kernel overhead and what it leaves for minds are in `STATUS.md` and `DECISIONS.md` D-016.

### 1.8 Portable math (Phase 1.0)
`src/sim/` may not call the engine's `Math.sin`, `exp`, `log`, or `pow` (§1.5), so the kernel supplies its own. They use only exactly-specified operations, so they return the same bits on every engine. They live in `src/sim/core/dmath.ts`:

| Function | What it is | Notes |
|---|---|---|
| `exp(x)`, `log(x)` | natural exponential and logarithm | the classic fdlibm algorithms |
| `pow(x, y)` | x to the y | repeated multiplication for whole-number y; `exp(y·log x)` otherwise, which is good to about 13 significant digits |
| `sinTurn(t)`, `cosTurn(t)` | sine and cosine of an angle given in **turns** (1 turn = one full cycle) | exact at quarter turns; exactly periodic |
| `nextNormal`, `nextExponential` (in `rng.ts`) | normally and exponentially distributed draws from a stream | polar method; `−log(1 − u)` |

Square roots need nothing special: the standard makes `Math.sqrt` exact.

Accuracy, measured against an arbitrary-precision reference: `exp` and `log` are never more than one representable number away from the correctly rounded result, and `sinTurn` and `cosTurn` never more than two. Agreement between engines has been checked too: Node (the V8 engine) and Bun (JavaScriptCore, the engine in Safari) produce identical results, and GitHub repeats that comparison on every push.

**Rules for using them**
1. **Angles are in turns, never radians.** Everything periodic in the sim is naturally a fraction of a cycle (time of day, time of year, moon phase). Reducing an angle given in turns is exact; reducing one given in radians is not.
2. **Directions are unit vectors, never angles.** Draw a direction by rejection from the unit disc; turn it by adding a perturbation and renormalising with `Math.sqrt`. There is no `atan2` and no need for one.
3. **Call them at setup, not in hot loops, wherever the model allows.** A call costs 15 to 70 nanoseconds on the Phase 0 benchmark machine (1.2 to 2.5 times the engine's built-ins), and the whole budget is 6.9 microseconds per agent per tick (§1.7). A decay with a half-life becomes a constant factor computed once in a system's `create`; the per-agent, per-tick loop only multiplies.
4. **Changing `dmath.ts` changes every run.** A guardrail test (`portable-math.test.ts`) pins its results to recorded digests, which are kept in two places so they can't be changed by accident. Any change needs a `DECISIONS.md` entry.
5. **A machine has to pass the same check before it may produce results.** `src/sim/core/selfcheck.ts` recomputes the digests; the harness runs it before every batch and refuses to start on a mismatch. The viewer should run it in the browser too.

**How the needs of Phases 1 and 2 are met.** This table is about arithmetic only. Whether a mechanism should exist, and in what form, is decided in its own section and phase.

| If a system needs… | Do it this way | Uses |
|---|---|---|
| a seasonal or daily cycle, or moon phase | `cosTurn` / `sinTurn` of the year or day fraction from the calendar | dmath |
| a direction (wind, a step, seed dispersal) | unit vector by rejection; perturb and renormalise | exact operations |
| terrain noise | noise on hashed lattice points with polynomial blending | exact operations |
| growth or decay per step (regrowth, spoilage, fatigue, forgetting) | multiply by a constant factor each step; get the factor from the half-life with `exp`, once, at setup | dmath at setup |
| events at a rate (storms, lightning) | a per-tick probability, `1 − exp(−rate·dt)`, computed once at setup | dmath at setup |
| a hazard that grows exponentially with age | multiply the hazard by a constant factor per year | exact operations |
| normally distributed variation (mutation, developmental noise, climate anomalies) | `nextNormal` on the consumer's own stream | dmath |
| waiting times, dispersal distances | `nextExponential` | dmath |
| scaling with body size (rate ∝ mass^0.75) | `Math.sqrt(Math.sqrt(m·m·m))`, or `pow` | exact operations, or dmath |
| a temperature response that doubles every N degrees | `exp` of a linear function of temperature | dmath |
| diminishing returns from practice | `pow(n, −b)`, or an incremental update | dmath |
| a saturating response | `x / (1 + x)`, or `1 / (1 + exp(−x))` | exact operations, or dmath |
| softmax choice (Phase 3) | `exp`; its cost goes into the Phase 3.1 measurement | dmath |

Measured accuracy and speed are in `DECISIONS.md` D-018.

---

## 2. World

### 2.1 Terrain
Elevation (slope affects movement cost), soil type (affects plant growth), barriers (cliffs, deep water, desert) that make **circumscription** a map property (§7.11). Map generators must be able to produce both open and hemmed-in landscapes from the same parameters, for experiment E3.

### 2.2 Water
Rivers, lakes, springs. **Stagnant water carries pathogen load** that rises with temperature and with carcasses or waste nearby. Flowing water carries less. Agents can't see pathogens (§2.7).

### 2.3 Climate and weather
- Seasonal cycles of temperature and rainfall.
- **Multi-year variability** as a stochastic process (drought runs, cold snaps). Variance is a first-class experiment knob (E1).
- Storms with **lightning**, which can ignite dry vegetation and occasionally strikes animals or agents. These are salient events with no visible cause (§4.4).
- Weather is never conditioned on agent state (`GUARDRAILS.md` T8).
- How it is built: §2.11.

### 2.4 Light
Daylight and night. Moonlight varies by phase. Perception range drops sharply in the dark (§4.1). **Fire emits light** in a radius, so agents near a fire can see each other at night.

**Sun and moon (Phase 1.3)** are pure functions of the tick and the config, in `src/sim/world/light.ts`. They hold no state, so they need no system.
- **The year** starts at the spring equinox: a quarter of the way through is midsummer, three quarters is midwinter. Day length swings from about 9.6 to 14.4 hours, a mid-latitude climate.
- **Sunlight** rises from 0 at sunrise to 1 at noon. A twilight band of about 45 minutes either side fades from 0.08 to darkness.
- **The moon** runs on a 29.53-day cycle of real days, not compressed years (§1.1), because it is something agents see from night to night. Its brightness is set by its phase, and it is only up for part of the night. A full moon rises at sunset and is up all night; a first-quarter moon sets around midnight; a new moon is up only during the day.
- **Ambient light** is the brightest of three sources: sunlight; moonlight (at most 0.06 of full sun at full moon overhead, a deliberate exaggeration so a moonlit night counts as visibly different); and starlight (0.002).
- Fire light is added at a point by `createFireProbe` (Phase 1.8, §2.16), from burning cells and burning objects.

### 2.5 Plants
Each species has attributes:
- calories and nutrients per unit, seasonality, growth and regrowth rates
- **toxicity**, sometimes with a *delayed* effect (illness hours later, which makes cause hard to learn)
- **processing requirements**: some species are only safe or calorie-rich after pounding, soaking, or cooking
- seed dispersal (including seeds passing through or discarded by animals and agents)
- **storability** (decay rate once harvested), **harvest synchrony** (ripens all at once or trickles), **visibility** (above ground vs. underground). These three matter for the appropriability hypothesis (§7.11, E4).
- How it is built: §2.12.

### 2.6 Animals
Animals are environment. Simple drive-based behavior is fine.
- **Prey:** small and fast; large and strong (multiple attackers needed); herd species with seasonal migration.
- **Predators:** pursuit predators; **ambush predators** that hunt at night from tall vegetation; scavengers.
- Predators avoid fire (that's animal behavior; agents have to *learn* the correlation).
- Population dynamics through births and deaths, not fixed counts.

### 2.7 Real hidden causes
The world contains causes agents can't perceive, so inferring hidden causes is sometimes **correct and useful**:
- pathogens in stagnant water and rotting carcasses
- delayed plant toxins
- ambush predators concealed in vegetation at night

This is the ecological alibi for hidden-cause inference (§4.4). Without real hidden causes, evolution would have no reason to keep the bias.

### 2.8 Materials and objects
Objects have physical attributes, never use-labels: mass, length, hardness, **fracture behavior** (some stones flake into sharp edges when struck), edge sharpness, flammability, fuel value, insulation (hides), durability.
- Striking object A on object B can change B (a flake breaks off with an edge) according to the materials.
- Certain stone pairs make sparks when struck; a spark near dry tinder may ignite it.
- **Shelter is physical:** cells with natural cover (caves, overhangs, dense trees) or with enough stacked long wood and hide reduce wind, rain, and heat loss. Huts, if they happen, are accumulations of objects.
- A carried hide reduces heat loss. Clothing, if it happens, is carrying.
- How it is built: §2.15.

### 2.9 Fire
A physical process: needs fuel and oxygen, spreads to adjacent flammable cells by dryness and wind, dies without fuel. A burning stick is a carriable object that keeps burning for a while. Fire gives light (§2.4) and heat (reduces thermoregulation cost nearby), deters predators (§2.6), and cooking raises the calories extracted from some foods and detoxifies others (§2.5).

### 2.10 Map generator (Phase 1.1)
A system with an `init` step (§1.5) builds the landscape once, before tick 0, from the seed and the config. Everything it makes is physical geography. It exists whether or not anything ever lives there, and no part of it is placed with inhabitants in mind.

**The one manipulation knob: `world.circumscription`**, a number from 0 to 1 (default 0.5; experiments set it explicitly). It is experiment E3's independent variable (Carneiro, §7.11). Changing it leaves the seed's axis and noise fields unchanged and adds only:
- **walls**: on both sides of a valley along a random axis through the map centre, the land rises over a 3 km ramp to a plateau up to 1,400 m higher;
- **a creeping desert**: beyond the walls, rain drops to 15% of normal. The desert's edge sits beyond the map at 0 and moves in to the middle of the walls at 1, so the land left between valley and desert shrinks gradually;
- **a graded valley floor**: the valley loses most of its bumps to river sediment and slopes gently toward its centre line, so its water gathers into one river;
- **a wet upper valley**: extra rain at the upstream end of the valley itself (not the uplands beside it), so a river runs the valley's length even when everything around it is dry, like the Nile.

At 0 the landscape is open: rolling relief, rain everywhere, rivers draining to every edge. At 1 it is a river valley about 14 km wide, walled by steep, dry uplands.

**Steps**, all in exact arithmetic (§1.8). Every number lives in `TERRAIN_CONSTANTS` in `src/sim/world/terrain.ts`; horizontal lengths scale with the map, so small test maps keep the same shapes.
1. **Axis.** A unit direction drawn from the `WORLD_GEN` stream, through the map centre. Every cell gets an along-axis coordinate *a* and an across-axis distance *d*. *d* wanders with low-frequency noise (about ±3 km over about 20 km), so the valley meanders.
2. **Relief.** Gradient noise (hashed lattice, eight gradient directions, quintic blending), six octaves, longest wavelength about 25 km: about ±250 m around 400 m. Plus a tilt of 5 m per km along the axis so the valley drains one way. Inside the valley, relief is scaled down by up to 85% and a cross-slope of up to 12 m per km is added, both × knob.
3. **Walls.** Beyond the valley half-width (7 km), a smooth ramp over 3 km: 1,400 m × knob × (0.6 + 0.4 × noise).
4. **Rainfall** (`terrain.rainfall`, the long-term mean, 1 = temperate): a broad noise field around 1 (±25%), cut by 85% in the desert, plus up to 0.9 × knob in the upper valley, never below 0.05. The climate system (Phase 1.2) varies weather around this mean.
5. **Drainage.** A priority-flood from the map edges (Barnes, Lehman & Mulla 2014, the variant with a first-in-first-out queue for cells inside depressions). Cells come off a heap in order of filled height, ties broken by cell index, so the result is deterministic. Each cell drains to the neighbour it was reached from (`water.drain`; −1 means off the map). On flat stretches every neighbour one step nearer the exit is an equally good route, and one is picked by a hash of the seed and the cell. That makes water meander across flats instead of running in straight lines.
6. **Basin infill.** Each closed basin is filled 85% of the way to its spill point, as sediment does over geological time. Random relief has far more closed basins than real land; without this, lakes covered 8–15% of the map.
7. **Flow** (`water.flow`, km²): **runoff**-weighted upstream area, where runoff is rainfall minus 0.3 for evaporation and soaking in, never negative. Deserts feed no rivers of their own; rivers that cross them come from wetter ground.
8. **Lakes.** Cells at least 1 m below the filled surface, in a connected patch of at least 3 cells, whose total inflow (the flow leaving the patch) is at least 0.7 km² and at least 5 times the patch's area, so inflow can offset evaporation from the surface. Depth goes in `water.depth`. Dry basins stay dry.
9. **Rivers**: cells with flow of at least 7 km². **Springs**: river cells that no other river or lake cell drains into, which is where rivers begin. In this version every spring is a river head; isolated groundwater springs in dry land are a known gap.
10. **Soil** (`terrain.soil`), by rules in this order: rock where the steepest slope exceeds 0.35; alluvium on flat ground (slope under 0.05) within 200 m of a large river (flow of at least 28 km²) or a lake; sand where rainfall is below 0.25; thin soil where slope exceeds 0.15 or height exceeds 1,200 m; loam everywhere else. What soil means for plants is decided in Phase 1.4.
11. **Water table** (`water.tableDepth`, m below the ground; added in 1.12). The simplest water table: level with the surface of the water that a cell's water first reaches on its way downhill, so its depth is the ground's height above that water (the "height above the nearest drainage" index; Rennó et al. 2008 and Nobre et al. 2011 found it tracks water-table depth). That water is a river, lake or spring, or a **small stream**: ground where at least 0.5 km² (runoff-weighted, like `water.flow`) drains past. Small streams are too small to show as open water at this scale, but the water table meets the ground along them (an estimate; channel networks drawn from elevation data usually start at 0.1–1 km²). Ground whose water leaves the map before meeting any of these gets 30 m (its stream is off the map). Under the water table the table is real; above it, deeper than about 2 m, it no longer matters (§2.11). A real water table rises under hills rather than lying level, so this one errs deep. It doesn't move: rivers don't shrink in droughts either (§2.11).
12. **Bare ground** (`terrain.bareGround`, the share of a cell's ground with no plant fuel on it: outcrops, stones, bare soil; added in 1.12). On average 60% on rock, 20% on thin soil, 35% on sand, 5% on alluvium (fresh sediment) and 3% on loam, all estimates; each cell's share is its soil's average × 0.5 to 1.5, from a hash of the seed and the cell, as the rock varies from place to place. Fire reads it (§2.16, *Breaks in the fuel*). Plants don't yet: their habitat already follows the soil.

**Layers**, one value per cell: `terrain.elevation` (f32, m), `terrain.rainfall` (f32), `terrain.soil` (u8: 0 rock, 1 thin, 2 loam, 3 alluvium, 4 sand), `water.kind` (u8: 0 dry, 1 spring, 2 river, 3 lake), `water.depth` (f32, m), `water.drain` (i32), `water.flow` (f32, km²), `water.tableDepth` (f32, m), `terrain.bareGround` (f32, share). Slope is computed by whoever needs it, from elevation; it is not stored. Rivers are flowing water and lakes are standing water, the distinction §2.2 needs for pathogens.

**Not in this version:** sea coasts, caves and overhangs (§2.8), and river width or seasonal flooding.

**Manipulation check.** `src/analysis/observers/landscape.ts` measures, for any run: the fraction of the map that is *habitable land* (not open water, slope at most 0.3, and either rainfall at least 0.35 or fresh water within 1.5 km); how much of that habitable land lies in the single largest connected region; and how much of that region's edge is walled by unhabitable land. "Habitable" is the analyst's yardstick for describing the manipulation; agents never see it and the sim never uses it.

Measured over seeds 1, 2, 3, 7 and 8 on the default 512-cell map:

| Knob | Habitable share of the map | Share of it in the largest region |
|---|---|---|
| 0 | 95–98% | 100% |
| 0.25 | 95–97% | 100% |
| 0.5 | 87–93% | 100% |
| 0.75 | 68–72% | 44–55% (land beyond the walls, split up) |
| 1 | 32–39% | 92–94% (one walled valley) |

A test (`tests/unit/terrain.test.ts`) holds the generator to this: habitable land never grows as the knob rises, is at least 90% at 0 and at most 45% at 1, and at 1 lies at least 85% in one region with walls and a river.

### 2.11 Climate and weather (Phase 1.2)
One system, `world.climate`, keeps the weather. It draws only from the `CLIMATE` stream and reads only the landscape and the clock. Nothing an agent does can change it (`GUARDRAILS.md` T8).

**Calibrated per real day.** Days are real and years are compressed (§1.1), so every rate here is a rate per real day: rain in mm per day, warming in degrees per hour. The compressed year only sets how fast the seasons turn. A "year" therefore holds 48 days of weather, not 365; sums over a year are not comparable to real annual totals and are never used as targets.

**Temperature** (°C, a pure function of the stored anomalies, the clock, and the cell's height):
- Yearly mean 12 °C, with a seasonal swing of ±9 °C peaking at midsummer (season fraction 0.25, §2.4).
- A daily swing of ±5 °C, warmest at 15:00, coldest at 03:00.
- 6.5 °C colder per 1,000 m above 400 m.
- Plus a **daily anomaly**: an AR(1) process stepped once a day, persistence 0.75, spread 2.5 °C.
- Plus a **year-scale anomaly**: an AR(1) process stepped once a season (12 days), persistence 0.7, spread 1.2 °C × variability. These are the warm years and the cold snaps.

**Rain** (mm on a cell on a given day):
- Each day is wet or dry, by a two-state Markov chain: a wet day follows a wet day with probability 0.6 and a dry day with probability 0.25 (a long-run wet fraction of about 38%), both scaled by the season.
- A wet day's rain is exponentially distributed with mean 6 mm, times the cell's mean rainfall (`terrain.rainfall`), times the seasonal and wetness factors. At mean rainfall 1 that averages about 2.5 mm per day, typical of temperate climates.
- **Seasonality**: ±25% around the mean, wettest in late spring (season fraction 0.15).
- **Wetness anomaly** (droughts and wet spells): an AR(1) process *w* stepped once a season, persistence 0.75, spread σ = 0.45 × variability. It scales each wet day's rain by exp(*w* − σ²/2). The −σ²/2 makes the long-run average factor exactly 1, so the knob changes how unequal seasons are without changing how wet the climate is on average. A run of low values is a multi-season drought. (A first version also scaled the chance of rain and had no correction: raising the knob from 0 to 2 nearly doubled average rainfall, which would have confounded E1. See D-023.)
- Rain falls on the whole map at once, more where the land is wetter. Moving rain bands are a known simplification.

**The experiment knob: `climate.variability`** (default 1, at least 0). It scales the year-scale temperature and wetness anomalies only. At 0 every year has the same average climate and only day-to-day weather varies; at 2 droughts and cold years are twice as large. This is E1's independent variable: does a *variable* environment, rather than a harsh one, favour learning from others (the essay's harshness claim in `ORIGIN.md`; Potts 1998)? Daily weather is the same at every setting.

**Storms and lightning:**
- On a wet day, the chance of a thunderstorm rises with warmth: 0 at a daily mean of 8 °C or less, up to 0.3 at 23 °C or more.
- A storm starts at a random time between 12:00 and 20:00 and lasts 1 to 3 hours. It covers a disc of radius 4–12 km centred anywhere on the map (centre and radius drawn from the stream), and adds 5–25 mm of rain on average over the disc that day, times each cell's mean rainfall, so storms drop less on dry land. The rain is heaviest under the core: twice the mean at the centre, falling to nothing at the edge, 2 × mean × (1 − (d/R)²) (T-007; strikes reach the light-rain margin, as real lightning does).
- While a storm is active, cloud-to-ground strikes arrive at a Poisson rate of about 12 per 10-minute tick (roughly one a minute, a moderate thunderstorm). Each hits a uniformly random cell inside the disc.
- The cells struck during the current tick are stored, so later systems can read them: fire ignition (Phase 1.8) and injuries (Phase 2). From an agent's point of view a strike has no visible cause (§4.4).

**Soil moisture** (`water.soilMoisture`, a fraction from 0 to 1 of what the ground can hold), a bucket updated once a day for every cell:
- Holding capacity by soil: rock 15 mm, thin 50 mm, loam 120 mm, alluvium 160 mm, sand 60 mm.
- Water in: that day's rain on the cell (including any storm). Whatever overflows the bucket runs off and is not tracked.
- Water out: potential evaporation, 0.2 mm × (daily mean temperature + 3 °C), never negative and at most 7 mm per day, scaled by how full the bucket is.
- **Water from below** (added in 1.12): a shallow water table (§2.10, step 11) tops the bucket up every day by 6 mm × e^(−depth ÷ 0.6 m): 6 mm where the table is at the surface (about a summer day's evaporation, so such ground stays wet), 2.6 mm at 0.5 m, 1.1 mm at 1 m, 0.2 mm at 2 m, nothing worth counting below that. An estimate after the steep fall of capillary rise with depth (Gardner 1958). So the ground along streams and around lakes stays moist through a drought, and the plants there stay green, which keeps it from burning (§2.16).
- River, lake, and spring cells stay at 1.
- At setup, each cell starts at 60% of its mean rainfall factor, capped at 1; the first weeks of a run settle it toward its own climate.
- **Wind** (added in Phase 1.8, §2.16): a daily vector on its own stream, swinging through the day and doubling under storms.
- This is the "dryness" plants (1.4) and fire (1.8) will read. Long-term river flow (§2.10) is static for now; rivers that shrink in droughts are a known gap.

**What gets stored** (all part of the state hash and snapshots): the four anomalies, today's wet flag and rain factor, the active storm (centre, radius, end tick, extra rain), the strikes of the current tick, a count of all strikes so far, and the soil moisture layer. Temperature is computed, not stored.

### 2.12 Plants (Phase 1.4)
One system, `world.plants`, grows eight species over the whole map. Plants are part of the environment: they never respond to agents except through physical removal (eating, digging, trampling, burning), which later phases add.

**Representation.** For every species and every cell: `plants.<species>.cover`, the share of the cell the species occupies (0 to 1), and `plants.<species>.food`, the kilograms of its edible part standing in the cell. All species in a cell share it: total cover never exceeds 1. Species are perceivable categories (§4.1); what they are *for* is something agents learn.

**The catalogue** (`PLANT_SPECIES` in `src/sim/world/plants.ts`). Each species exists to give the world a distinct ecological niche and a distinct problem for a forager to learn. Names describe the plant, not its use.

| Species | Habitat | Edible part | When | What makes it different |
|---|---|---|---|---|
| grass | loam and alluvium, moist to middling ground | small seeds, 3,400 kcal/kg | a short window in early summer; seeds drop within days | ripens **all at once**, seeds keep for years once gathered, very **visible**: the appropriable kind (E4). Raw seeds are poorly digested; pounding and cooking roughly double the yield |
| tuber | loam and sand, tolerates dry ground | underground storage organ, 1,000 kcal/kg | all year, regrowing over months | **invisible** and spread out; must be dug; rots within weeks once dug up |
| berry | most soils, moist ground, sunny | fruit, 600 kcal/kg | mid to late summer, ripening a little at a time | edible raw; rots within days on the bush and once picked |
| nut | trees on loam and thin soil, not too high | nuts in shell, 3,000 kcal/kg | a burst in autumn | keeps for many months; the shell must be cracked |
| greens | wet loam and alluvium | leaves, 300 kcal/kg | spring through summer | everywhere and safe, but few calories per hour of picking |
| bitter root | sand and thin soil, dry tolerant | root, 1,500 kcal/kg | all year | rich in calories but **toxic raw, with a delayed effect** (illness hours later); soaking or cooking removes the toxin |
| nightshade | disturbed ground near water and on loam | berries, 400 kcal/kg | late summer, alongside the edible berries | **toxic, delayed**, no safe preparation |
| reed | at the water's edge: within reach of rivers, lakes, springs | rhizomes, 900 kcal/kg | all year | grows only where the ground stays wet |

Toxin and processing values are stored now and used by bodies (Phase 2) and minds (Phase 3).

**What compresses with the year and what doesn't** (§1.1):
The rule: **the plant is life history, its edible part is daily physiology.**
- **Compressed (per year):** how fast cover grows, spreads, and recovers after drought. These are life-history timescales, and they keep their ratio to agent lifespans.
- **Not compressed (per real day):** how fast fruit and seeds ripen during their window, how fast they rot on the plant, how fast a root or rhizome refills its store of starch, and how long food keeps once picked. These are chemistry and daily physiology. Fruiting windows are fractions of the year, so a berry season is a few days long, but the *daily* amount of food in season matches real stands. Food per real day, averaged over the year, is therefore realistic, and so is the number of people a square kilometre can feed. The yearly total is 48/365 of a real year's. That's expected, never a target.
- **The price:** a tuber patch dug bare refills on a time constant of about a real year, which is about 7.6 compressed years, so depletion lasts longer relative to a lifetime than it does in reality. The first version compressed refilling instead. Roots then refilled 7.6 times faster per real day than real ones and supplied about 60% of all plant food; the total sat near the top of the sanity band below (790,000–960,000 kcal per km² per day on two seeds, against 280,000–350,000 now). Daily food sets carrying capacity, which the circumscription experiment (E3) depends on, so it wins (D-024, T-003).

**The update**, for each species in each cell:
1. **Habitat** (fixed for the run, computed on the system's first run, §1.5): soil fit × mean-rainfall fit × height fit × a species-specific patchiness noise field, giving a carrying capacity *K*. A species with a water-edge limit (reed) has *K* = 0 farther than its reach from open water.
2. **Conditions:** a moisture response (a trapezoid over the species' preferred soil-moisture range from §2.11) and a warmth response (0 below the species' minimum daily mean temperature, rising to 1 over 8 °C).
3. **Growth and spread:** cover grows logistically toward *K*, × moisture × warmth, and seeds from the four neighbouring cells colonise unclaimed space in proportion to the neighbours' cover and the habitat here (that is how bare ground fills back in, but only where the ground is moister than the species' tolerance). If all species together want more than the unclaimed space, each gets the same share of what it wanted.
4. **Dieback:** when soil moisture falls below the species' tolerance, cover shrinks in proportion to how far below. Cover above *K* shrinks back toward it.
5. **Standing stocks** refill toward stock × cover at the species' real-year rate × warmth × moisture response.
6. **Fruit and seeds** accumulate during their window at the species' daily yield × cover × moisture response, then drop or rot at the species' daily rate.

**Schedule.** Step 6 runs every day for every cell. Steps 2 to 5 are slow, so each cell takes them once every 4 days, with 4 days' worth of change; a different quarter of the cells goes each day, so the cost is even. The quarters are a 2 × 2 pattern, so no two neighbouring cells update on the same day, and a cell's neighbours are fixed while it updates: the result doesn't depend on the order cells are visited in. This cut the cost of a day on the full map from 86 ms to 16 ms.

**At setup** each species starts at 80% of its capacity (which already varies with its patchiness field), scaled down in proportion where the species together would cover more than the whole cell, with standing stocks full and no fruit.

**Calibration** (`docs/RESEARCH.md`, *Plants*):
- Wild seed stands: domesticated einkorn yields about 0.9–2 t/ha with little input; wild stands are put at 500 kg/ha, well below that.
- Wild fruit runs about 3.2–3.7 kcal per gram of dry matter (Hadza data); fresh fruit, mostly water, is put at 0.6 kcal/g.
- Sanity band, tested: averaged over a year on land, the most edible plant food that could be taken each day (everything ripe or stored, gathered daily, toxic-and-unprocessable species excluded) comes to 50,000–1,000,000 kcal per km² per day. That is hundreds of times what foragers at real densities eat (roughly 0.04–10 people per km², about 2,000–2,600 kcal each), as it should be: most plant food is never reachable at the right time, and animals take much of it. Real foraging return rates are a Phase 3 calibration target.

**Not in this version:** grazing and browsing (Phase 1.5); seeds carried and dropped by animals (1.5) and by agents (§7.13, once agents eat); fire (1.8); plants as building material (1.7); individual trees; and nutrients other than calories, because bodies (§3) account only energy and water so far. If a body ever needs a nutrient, each species gains a column for it then. Riverbank soil also dries in a drought exactly like any other soil, because §2.11 has no water table; in long runs with large swings, reeds and greens can fall to about a fifth of their starting cover (a question for the ecology review, 1.10).

---

### 2.13 Animals (Phase 1.5)
Animals are environment: simple drives, no learning. They respond to food, water, warmth, and each other, and (from Phase 3) to agents only as large moving bodies. Implemented in `src/sim/world/animals.ts` as one system, `world.animals`, running after the plants.

**Which clock (extends D-024).** A whole animal is food, so everything that sets how much meat and danger a square kilometre holds per day runs on **real days**: eating, drinking, hunting, kill rates, births, deaths, and rotting. Only the *timing* of births follows the compressed calendar: births fall in a short spring window each 48-day year, sized so that births per real day match the real annual rate (a wolf pack's five pups a real year become about 0.66 per compressed year). The price: animal populations rise and fall on real-year timescales, so an area hunted out recovers over many compressed years. Individual animals are not aged; death is a daily hazard, so no animal outlives a human generation in any visible way.

**Kinds.**

| kind | stands for | how represented | edible meat | notes |
|---|---|---|---|---|
| hare | small, fast prey | a density layer, `animals.hare` (animals per cell) | 2.5 kg | breeds spring to midsummer, wanders slowly between neighbouring cells |
| deer | herd prey that migrates with the seasons | groups (typically 8, at most 30) | 55 kg | flees predators it detects; seeks cooler ground in summer and warmer in winter, which moves herds up and down the valleys |
| aurochs | large, strong prey | groups (typically 12, at most 25) | 350 kg | stands its ground; only a wolf pack of four or more can bring one down, and then rarely |
| wolf | pursuit predator | packs (typically 5, at most 8) around a range anchor | 15 kg | one litter a year per pack, however big the pack; hunts when hungry, by day or night, sensing prey within 3 km; chases end in a kill with a fixed chance per chase |
| big cat | ambush predator | one animal around a range anchor | 20 kg | rests by day; hunts at night from tall cover (reeds, nut woods, tall late-summer grass) |
| vulture | scavenger | one number for the whole map | — | eats from every carcass each day; breeds when well fed. Birds range far, so the map shares one pool |

**Groups** live in their own entity store, `animals` (columns: kind, position, count, condition, target, mode, hours since drinking, range anchor, a cooldown, the id of the group being hunted, and the seeds being carried). Positions are continuous metres. Each tick every group moves toward its target; lakes block movement, rivers don't. Each group decides once an hour, on a tick set by its slot so the work is spread out:
- **Herbivores** eat from the plants' forage in their cell, drink when within a cell of open water, and head for water when they haven't drunk for 18 hours, following the shortest way over land (a distance field built on the first run) and stepping sideways along lake shores. Otherwise they compare five spots within 800 m (3 km when below 70% condition: hungry animals range farther) by forage and warmth and move if one is clearly better. Deer that detect a wolf pack (300 m by day, 120 m at night) run 1.5 km away; a pack standing at the deer's own position gives no direction away, so they bolt in a random direction (T-009: a fixed fallback, due east, once trapped deer against the map edge).
- **Wolves** below 70% condition hunt: they head for the nearest deer group within 3 km (an aurochs group only if the pack has four or more and no deer are near), and a chase starts when they come within 300 m. Fed wolves stay by their kill or drift back toward their anchor.
- **Big cats** below 70% condition, at night, stalk the nearest deer group within 3 km, creeping to the tallest cover within striking range (200 m) and waiting there; a deer group within 200 m of a waiting cat is struck. The strike succeeds far more often from tall cover (a quarter as often from open ground). A cat stays with its kill until the meat is gone.
- **Hares** update a quarter of the map each day with four days of change, like the plants; they breed in spring and summer, die faster when crowded, and wander to neighbouring cells. They are caught incidentally by hunting predators, in proportion to the hares nearby.
- **Condition** (0 to 1) stands for fat reserves: it falls by one day's need each day and rises with food eaten. At zero, animals start dying of hunger.

**Carcasses** are meat in a layer, `animals.carcass` (kg per cell), from kills and from every death. Predators eat from the carcass in their cell, vultures take a share of every carcass each day, and the rest rots, faster in warm weather.

**Daily**, each group breeds (in the spring window, if in fair condition) and loses animals to its daily death hazard plus hunger; each death leaves meat. Groups above their maximum split; tiny deer groups join a nearby group. Wolf packs above eight send three wolves to found a pack 10–20 km away where no other pack's anchor is within 15 km; if they find no room, they don't survive. A big cat's young likewise need a spot with no other cat within 4 km.

**Grazing and browsing (in the plants system, §2.12).** Each species carries a standing stock of leaves and stems animals can eat, refilling on real days like roots do. Grass and reeds make `plants.forage` (grass-like, kg per cell); greens, berries, nuts and tuber leaves make `plants.browse`. Aurochs and hares graze grass only; deer browse first and take at most 30% of their food as grass, as real intermediate feeders do, which keeps the two big grazers from competing head-on. No animal can eat the last quarter of a plant's forage (the base it regrows from). Grazed down below 30% of full, a patch's soft plants die back (overgrazing makes bare ground); woody plants (berry bushes, nut trees) survive being stripped.

**Seeds carried by animals (moved here from 1.4).** A herbivore group picks up the seeds of grass, greens, berries, and nuts where it grazes and drops them where it goes, by setting bits in `plants.seedRain`. When a cell's plants next update, any species whose seed arrived, and whose habitat allows it, starts a small patch there. Agents can do the same later (§7.13).

**Starting numbers** (densities per km² of *habitat*, where land counts in proportion to its forage, fully from 100 kg per hectare; T-006): deer 5 per km², aurochs 0.5, hares 30, wolves 2 per 100 km², big cats 1.5 per 100 km², placed where forage is good (predators too, since that is where their prey is), with predators spread out. A predator's range anchor drifts a fifth of the way toward each of its kills, so ranges follow the prey. Calibration sources are in `RESEARCH.md`; tested bands are deliberately wide.

**Not in this version:** disease in carcasses (1.6, since done), animals noticing agents (Phase 3; since done, §2.17), injuries to predators (from persons' blows since 3.3b, §2.17; not from prey), snow, and fish.

### 2.14 Pathogens (Phase 1.6)
The invisible half of §2.7. One system, `world.pathogens`, runs daily after the animals. Agents never perceive these layers (§4); bodies (Phase 2) read them to decide infections, and observers can see them.

**Units.** A load is a share of a full bloom, 0 to 1. Phase 2 turns it into a chance of infection per drink or per kilogram eaten.

**Water** (`water.pathogen`, one value per water cell). Microbes always drift in at a trickle; what happens next depends on whether the water moves:
- **Lakes** (standing water): load grows logistically in warm weather (none below 8 °C, about 0.3 a day at 23 °C) toward a full bloom, and dies back slowly (5% a day) when cold. Lakes are cleanest in winter and foul by late summer.
- **Rivers** (flowing water) flush 60% of their load each day, so they stay clean unless something is rotting beside them.
- **Springs** (groundwater) flush 80% a day and get only half the input.
- **Carcasses** in or next to a water cell add load in proportion to their meat. Waste from agents will add to this in Phase 2.

**Carcasses** (`animals.carcassLoad`, per cell with meat). Fresh meat starts clean; when meat is added to a cell, the load mixes by weight, so a fresh kill on old meat dilutes it. Load grows with warmth (by 0.15 for every 10 degree-days above 4 °C), so meat is foul after about four warm days, and keeps for weeks in the cold. When the meat is gone, the load goes with it.

**Clock:** real days, like all daily physiology (D-024, D-026). Only the seasons are compressed.

**Not in this version:** pathogens carried downstream by rivers, wounds infected from dirt (§3, Phase 2 uses these loads), and cooking killing pathogens (needs fire, 1.8, and bodies, Phase 2).

### 2.15 Materials and objects (Phase 1.7)
One system, `world.materials`, runs daily after the pathogens, plus functions that later phases call when a body acts. Everything here is physics: no object has a purpose, only a material, a size, an edge, and a condition. Implemented in `src/sim/world/materials.ts`.

**The catalogue** (`MATERIALS`). Eight materials, each with density, bulk hardness (roughly Mohs' scale), a way of breaking, the energy that breaks it, the sharpness of a fresh and of a weathered edge, whether particles shaved off it burn (sparks), flammability and fuel value (for fire, 1.8), insulation (for bodies, Phase 2), how much wind screen a kilogram makes when piled or leaned, how much rain that screen sheds, and how fast it rots.

| material | hardness | breaks by | what is distinctive |
|---|---|---|---|
| flint | 7 | conchoidal | flakes easily into the keenest edges (0.95); found as nodules weathered out of limestone |
| quartzite | 7 | conchoidal | flakes, but needs harder blows and gives rougher edges (0.65); common everywhere in small amounts |
| granite | 6 | granular | tough and heavy; crumbles little; blunt when split |
| limestone | 3 | granular | soft; crumbles; never keen |
| sandstone | 4.5 | granular | crumbles fastest |
| pyrite (iron sulfide) | 6.25 | conchoidal | brittle; **struck by harder stone, throws hot sparks**; found as rarer nodules in limestone, in different patches from flint; none in river beds (it rusts and breaks up in water) |
| wood | 2.5 | fibrous | snaps when a blow carries more than about 15 J per kg; burns (16 MJ/kg dry); rots |
| hide | 1.5 | pliable | insulates (0.8 clo per kg wrapped round a body); sheds rain; lies flat unless something holds it up; rots in weeks |

**Loose material** is kept per cell, not as objects, until something picks a piece up:
- **Bedrock** (`materials.bedrock`): granite, limestone or sandstone, from a smooth noise field with a 15 km wavelength, independent of the circumscription knob.
- **Loose stone** (`materials.stone.<material>`, kg per cell), hand-sized pieces on the surface. Amount by ground: rock 30 t/ha, thin soil 8, loam 0.3, alluvium 1.5, sand 0.1, river beds and gravel bars 20, spring heads 2, lakes none. The mix follows the bedrock: granite gives granite with a little vein quartzite; sandstone gives sandstone and quartzite; limestone gives limestone, 18% flint, and 0.1% iron sulfide, the two nodule kinds each patchy at a 2 km scale. In river beds and on alluvium, hard stone survives transport better and soft stone and iron sulfide worse. Rivers carry the local bedrock's stones; transport across bedrock boundaries is not modelled.
- **Fallen wood** (`materials.wood.small` for sticks and branches under 1.5 m, `materials.wood.long` for poles and trunks), kg per cell. Nut trees drop 1.5 t/ha of each per compressed year at full cover, berry bushes 0.4 t/ha of small wood. Wood rots at a rate set by its thickness (about 25% a year for 3 cm sticks, 6% for 8 cm poles), scaled by warmth (0 at or below 0 °C, 1 at 12 °C) and wetness (soil moisture). It starts at the balance of input and rotting. On the default map that is about 1.3 t/ha of small and 5 t/ha of long wood averaged over land, and about 12 t/ha together where nut trees cover more than 30% of a cell.
- **Which clock.** Fallen wood comes from tree life history, so it runs on the compressed year like plant cover (§2.12). A rotting hide is daily microbial physiology, like meat (§2.14), so it runs on real days.

**Rock shelters** (store `rockShelters`: kind, position, floor area) are made once, before tick 0. On dry land steeper than a slope of 0.12, the chance of a shelter rises to full at 0.37: 4% per cell on limestone, 3% on sandstone, 1% on granite. Limestone also has caves opening on gentle ground (sinkholes), 0.2% per cell. 40% of limestone shelters are caves, 5% of sandstone ones, none of granite ones; the rest are overhangs. Overhangs cover 6–40 m², caves 20–150 m². Someone within the radius of a shelter's floor area is inside it. On the default map there are about 14 per 100 km²; on a walled valley about 34; on open country only the few limestone caves (about 1.5). **This is a confound for E3**: the circumscription knob makes cliffs, and cliffs make rock shelters. Real walled valleys have them too, so it stays, but E3's preregistration must name it (for example, by also running with rock shelters removed).

**Objects** (store `objects`): material, position, mass, length, edge sharpness (0 to 1), integrity (1 new, gone at 0), and the id of the agent holding it (0 while it lies on the ground). An object comes into being only through `spawnObject`: when a piece is taken from loose material (`takeStone`, 0.15 to 3 kg, or `takeWood`, a stick or a pole), when a blow breaks a piece off, or (later) when a body cuts something from a carcass. In a run without agents the store stays empty. Wood objects rot like fallen wood of their thickness; hides lose 5% of their integrity a real day at 12 °C on half-wet ground, faster when warm and wet, so a hide left out in summer is gone within weeks; stone never rots.

**Striking** (`strikeObjects(sim, striker, struck, energy, precision, stream)`), the physics behind the `manipulate` and `strike` primitives (§5.5). A hand-swung stone delivers tens of joules; `precision` (0 to 1) is how squarely it lands, which skill will supply (Phase 2.4). The softer of the two takes the larger share of the energy, in proportion to the other's hardness. Then, for each piece:
- an edge dulls against anything about as hard as itself;
- **conchoidal** stone shatters into three if the energy exceeds its breaking energy (flint 300 J per kg, so a small flake shatters easily and a nodule never does by hand); otherwise, above its flaking energy (flint 3 J, quartzite 10 J, iron sulfide 4 J) and with chance `precision`, a flake of 2 g per joule detaches (at most 40% of the piece), its edge `freshEdge × (0.6 + 0.4 × precision)`, and the piece left behind gains a half-keen edge;
- **granular** stone splits in two blunt pieces above its breaking energy, and otherwise loses crumbs;
- **wood** snaps in two above about 15 J per kg (a light stick yes, a heavy pole no), splintered edges 0.3; below that it is slightly damaged;
- **hide** is unharmed.

Mass is conserved except crumbs. **Sparks**: when one material is harder than the other by more than about a point, it shaves particles off it; particles of iron sulfide burn in air, so flint or quartzite on iron sulfide throws about one spark per 9 J with heat near 0.9, granite on iron sulfide cooler ones, and no other pair throws hot sparks. Whether a spark catches is fire's business (1.8).

**Shelter** (`createShelterProbe(sim).at(x, y, out)`), for bodies to read (§3.9): the share of wind and rain kept off at a point and the share of the sky hidden (which keeps off the sun and the cold of a clear night sky), combining three sources as independent screens (`1 − Π(1 − share)`):
- **inside a rock shelter**: overhang 50% / 85% / 60%; cave 95% / 100% / 100%;
- **plant cover in the cell**: wind 0.7 × tree + 0.35 × bush + 0.2 × reed cover (at most 90%); rain 0.3 × tree cover while leaves are out (mid-spring to mid-autumn), 0.1 otherwise, plus 0.1 × bush; sky 0.85 × tree cover while leaves are out, 0.4 otherwise, plus 0.3 × bush [estimates: a closed broadleaf canopy passes about 5–20% of sunlight in leaf, about half when bare];
- **lying objects within 3 m**: things that stand up (stone stacks to any height; wood screens up to its length, full at 1.5 m) make a standing screen of mass × material screen per kg; things that lie flat (hide) count only up to twice the standing screen, because nothing else holds them off the ground. Wind kept off is 90% × screen / (screen + 6 m²); rain, 90% × cover / (cover + 4 m²), where cover is 30% of standing wood's screen plus 95% of held-up hide; sky, the same as rain (what keeps rain off hides the sky). Twenty 3 m poles and four hides (about 170 kg) keep off about 58% of wind and rain. A hut, if one ever appears, is just such a pile. Objects are seen as they lay at the first query of a tick (§1.6).

All protection numbers are estimates. Phase 2.2 replaced the third share, a placeholder "body-heat loss", with the sky hidden, which §3.9's heat balance uses directly (D-041).

**Not in this version:** bones and antlers (natural objects from carcasses and shed antlers), rubbing to grind an edge (friction heat in wood is now in fire, §2.16), trees dying back into fallen wood (the ecology review, 1.10), cutting hides from carcasses (needs bodies acting, Phase 3–4), curing hides so they last, containers, and objects carried by an agent rotting at the agent's position (Phase 3 keeps a held object's position current).

*Added in 3.3:* a piece smaller than **1 g** never breaks off (it stays with the piece it came from as grit), and a stone crumbled below 1 g is gone as crumbs. Agents striking the same small pieces over and over drove masses to zero, which the object store refuses (D-051).

### 2.16 Fire (Phase 1.8)
One system, `world.fire`, runs every tick after the materials, plus functions that later phases call when a body acts (striking sparks, rubbing wood, holding a stick to a flame). Implemented in `src/sim/world/fire.ts`. Fire is physics: it needs dry, cured fine fuel and spreads with the wind and up slopes; nothing about it depends on who watches. It draws from its own stream (`StreamDomain.FIRE`). The numbers below are the ones that came out of the corrections logged in `TUNING_LOG.md` T-005.

**Wind (added to the climate, §2.11).** A daily wind vector at 10 m: each component an AR(1) process stepped once a day, persistence 0.6, spread 2.5 m/s, around a prevailing westerly of 2 m/s (mean speed about 3.5 m/s, usual for temperate lowlands). Through the day the speed swings by ±40%, strongest at 14:00 and calmest before dawn; under an active storm it doubles (gust fronts). Wind has its own stream (`StreamDomain.WIND`), so adding it left every other part of the weather unchanged. Bodies (Phase 2.2) will read it too.

**Fuel** (kg per cell):
- **Fine dead fuel** (`materials.litter`, kept by the materials system like fallen wood): cured grass, dead herbs and fallen leaves. It carries a fire, and it is the tinder a spark or an ember needs. Plants add it during the dying-back season (season fraction 0.45–0.7) at, per full cover and compressed year: grass 3 t/ha, reed 6, nut trees 3, berry bushes 1.5, greens 1, tuber, bitter root and nightshade 0.5 each. It rots at 60% a compressed year at reference conditions, times the same warmth-and-wetness factor as fallen wood. In a cell that has burned since the start of the year, only woody plants (nut trees, berry bushes) add litter for the rest of that year: the fire burned the year's dead grass and herbs where they stood (T-006; without this, burned meadows refuelled within days and burned twice in a year). Like fallen wood it runs on the compressed year (plant life history) and starts at the balance of input and rotting: about 3.4 t/ha where plants cover the ground, almost none on sparse ground.
- **Sticks and poles** (`materials.wood.small`, `materials.wood.long`, §2.15): 40% of the sticks burn in the flames; the rest, and the poles and trunks, smoulder afterwards. Wood does not carry a flaming front: only the litter does.
- **Living plants** don't carry the fire, but green plants hold it back (curing, below) and are damaged by it.

**Fuel moisture** (a share of dry mass), computed when needed from the weather; nothing extra is stored:
- **Fine fuel** follows the air within an hour. Relative humidity, which the climate doesn't keep, is estimated as 50% + 30% × soil moisture, +15% on a wet day, ±20% through the day (driest at 15:00), within 10–100%: summer afternoons about 50–60% and nights 85–95% on moist ground, drier in droughts. Equilibrium moisture then follows Simard's (1968) equations, as used by the US fire-danger rating system. Fuel under trees is shaded: +5 points × tree cover. **Dew** (T-007): where the estimated humidity reaches 88–92% (surfaces are wet with dew at about 90%; Sentelhas et al. 2008), fine fuel under open sky gains up to 15 points, times (1 − tree cover), since a canopy keeps the ground beneath it from cooling enough; it burns off as the morning humidity falls. Rain on the cell today adds 6 points per mm (storm rain from the moment the storm starts). **Rain carried over** (T-007): from the end of the day it fell, that water shrinks by e every 16 hours (the Fine Fuel Moisture Code's two-thirds of a day; Van Wagner 1987), so soaked litter takes one to three drying days to carry fire again. The fire system keeps the map-wide wet-day amount and the last four storms (place, size, amount) as a small state part, `fire.wetting`.
- **Sticks**: equilibrium moisture at the day's mean humidity, plus 2 points, plus 3 points per mm of rain today.
- **Poles and trunks** respond over weeks, so they follow soil moisture alone: 8% + 25% × soil moisture.
- **Moisture of extinction**: fine fuel at 24% or wetter doesn't carry flame when the wind reaching the fire is 10 km/h or more, and at 20% or wetter in a lighter wind (Cheney et al. 1998 for grass; their moisture function has the two forms, Eq. 3.7 in Cruz et al. 2015; until T-007 only the strong-wind one was coded).

**Curing.** Green plants are wet and shade the dead fuel. A cell's greenness is warmth (0 at a daily mean of 5 °C, 1 at 13 °C) × wetness (0 at soil moisture 0.25, 1 at 0.55) × its total live plant cover (at most 1), × 0.6 during the dying-back season. Cured share = 1 − greenness, and the curing factor rises from 0 at 40% cured to 1 at 90% (after Cheney's curing function). So a moist summer meadow or a leafy wood doesn't burn; in a drought, in the cold, or in a dry autumn the same ground does.

**Rate of spread** (head fire; Cheney et al. 1998, natural grassland): with the wind at 10 m *U* in km/h, *R* = 0.054 + 0.269 *U* km/h below 5 km/h and 1.4 + 0.838 (*U* − 5)^0.844 above, times:
- **moisture**: exp(−0.108 *M*) up to *M* = 12%, then falling linearly to 0 at the moisture of extinction (0.684 − 0.0342 *M* below 10 km/h, 0.547 − 0.0228 *M* above);
- **curing** (above);
- **fuel**: 0 below 0.5 t/ha of litter, 1 above 2 t/ha;
- **trees**: under nut-tree cover *c* the wind reaching the fire is (1 − 0.75 *c*) of the open wind, and the compact leaf bed spreads (1 − 0.6 *c*) as fast;
- **slope**: up a slope *s* (rise over run) × (1 + 5.7 *s*), down × 1 / (1 + 5.7 |*s*|), so it doubles each 10° up and halves each 10° down (McArthur's rule of thumb), with *s* at most 0.6.
**Shape**: a fire spreading from a point grows as an ellipse with the ignition at its rear focus, so the rate at angle θ from the wind is head × (1 − *e*) / (1 − *e* cos θ), never below the no-wind rate (0.054 km/h × the same factors). The eccentricity comes from the length-to-breadth ratio *LB* = 1 + 8.729 (1 − e^(−0.030 *U*))^2.155 (Alexander 1985, as used in the Canadian Fire Behaviour Prediction System): about 1.5 at 10 km/h, 2.6 at 20, 5 at 40. Open grass at 20 km/h and 10% moisture runs about 3 km/h and backs into the wind at about 0.1 km/h.

**Spreading between cells: minimum travel time** (after Finney 2002). Each burning cell is an entry in the store `fires` (cell, minutes of flame left, minutes flaming so far, vigour, heat), and `fire.stage` marks it on the grid (1 flaming, 2 smouldering). A neighbour starts flaming exactly when the fire, travelling from a flaming cell at the rate toward that neighbour (using the neighbour's fuel, moisture and curing), reaches it; within each tick, arrivals are taken in time order, so a fast grass fire crosses many cells in ten minutes and a slow one none. Ties go to the lower cell, so the order is fixed. A diagonal step between two water cells is blocked: one-cell rivers are firebreaks. Each cell draws a **vigour** (0.7–1.3) when it starts flaming, which scales its rates, so edges come out irregular. (A first version rolled a chance per neighbour per sub-step; fronts then outran their own rate several times over, because a front of many cells takes the luckiest roll. See T-005.)

**Breaks in the fuel** (added in 1.12, the owner's yes of 2026-11-19, D-034). Two physical pieces real landscapes have and the first version lacked:
- **Damp ground** along streams, springs, rivers and around lakes, from the water table (§2.10, step 11; §2.11). Moist soil keeps plants green there (curing) and raises the humidity estimate (fuel moisture), so in the main fire season a fire meets strips it can't cross. Nothing in fire changes for this; it reads soil moisture as before.
- **Patchy fuel** within a cell, from its bare ground (§2.10, step 12). The litter lies on the share of the ground that isn't bare, so the fuel factor reads the load there (litter ÷ that share). A fire crosses a patchy cell only if its flames bridge the gaps: fuel patches of radius *r* = 0.5 m (an estimate) scattered over a share *c* of the ground cover, once grown by half the flames' reach *L* across bare ground, 1 − (1 − *c*)^((1 + *L*/2*r*)²) of it (overlapping discs); the fire crosses when that passes 0.676, the continuum percolation threshold for discs (Quintanilla, Torquato & Ziff 2000), and its rate is scaled by how far above it the reached share is, from 0 at the threshold to 1 when all is reached. The reach is half the flame length, *L* = 0.5 × 0.0775 *I*^0.46 m (Byram 1959), with *I* the fireline intensity of the fire travelling toward that cell (18,000 kJ/kg × load on the fuelled ground × the rate toward it). So a head fire driven by wind runs over rocky ground; its flanks and back, and any fire on a calm night, stop at it. Loam (3% bare) is almost unaffected; rock (30–90%) mostly stops all but head fires; thin soil (10–30%) slows backing fires.
- A diagonal step between two cells that can't carry flame now (as well as between two water cells) is blocked: it would slip through the corner of the break the two make together.

A cell flames until the fire has left it in every direction: 1.5 cell widths ÷ its slowest (backing) rate, from 10 minutes to 4 hours. Its fine fuel (all but 5%) and 40% of its sticks burn evenly over that time; the heat released is what burns × 18 MJ/kg (litter) or 16 (wood). If its fine fuel becomes too wet (a humid night, rain) or too green, flaming stops early and what is left can burn later.

**Smouldering.** After flaming, or when lightning strikes wood that is too green or wet to flame, a cell with at least 5 kg of wood smoulders: 15% of its sticks and 3% of its poles an hour when dry, less as the poles get wetter, none at 45% moisture. Embers also die by themselves at 6% an hour (half-life about 11 hours). A lightning holdover, smouldering at the base of the struck tree, dies by itself at 1.5% an hour (half-life about two days) until it flares or a front reaches it (T-007; real holdover times run from hours to several days, Moris et al. 2023). A storm puts it out with chance 1% per mm/h falling per tick (at most 20%); a wet day's rain with chance 10% per mm over the day (at most 95%), spread over the day's ticks. Once an hour a smouldering cell whose own fine fuel is dry and cured enough flares into flame with chance 0.3 × the moisture factor. This is how real lightning fires often start: as "holdovers" smouldering in a log until the litter around dries.

**Ignition:**
- **Lightning** (§2.11): a strike on dry land starts a fire with chance 0.03 × the wood present (full at 5 t/ha) × the dryness of the poles (1 at 15% moisture, 0 at 45%), or 0.03 × the readiness of the fine fuel (dry, cured and heavy enough), whichever way it catches. It flames if the fine fuel can carry flame, and otherwise smoulders in the wood (a holdover). In midsummer, with green plants, nearly every lightning start is a holdover that dies within a day or two.
- **Sparks** (`sparksAt(sim, x, y, sparks, heat, stream)`): the caller is whatever struck iron sulfide (`strikeObjects` reports the sparks, §2.15). Each spark catches the litter on the ground with chance 0.04 × its heat × tinder readiness (dry, cured, and at least 0.5 t/ha). A caught spark is a small flame at that point for a moment.
- **Friction** (`rubWood(sim, a, b, energy, precision, stream)`): rubbing two pieces of wood turns work into heat in the dust. If energy × precision² reaches 2,500 J × (1 + 8 × (stick moisture above 8%)) and the sticks hold no more than 22% water, an ember forms; it becomes a small flame with chance 0.5 × tinder readiness. Rubbing grinds off 1 g of dust per kJ. (Real hand-drill fire takes about a minute of hard work with dry wood.)
- **A small flame at a point** (a caught spark or ember) lights wood objects within 0.5 m (chance 0.03 m ÷ thickness × their dryness, at most 1) and the cell's litter with chance 0.3 × readiness. The fire system takes a lit cell up on its next run.

**Burning objects** (column `burnKw` on `objects`, 0 when not burning). A burning piece of wood loses radius at 0.25 mm a minute on its own, or 0.8 mm a minute when two or more other burning pieces lie within 0.5 m (a pile burns hotter), and is gone below a radius of 2 mm: a 2 cm stick lasts about 40 minutes alone, a 6 cm pole in a pile about 40 minutes. Its heat is the mass lost × 16 MJ/kg. A piece thicker than 2.5 cm burning alone goes out with chance 8% a tick (a lone log dies; a pile keeps going). Every tick an unburnt wood piece within 0.5 m of a burning one catches with chance 0.015 m ÷ thickness × its dryness, and wood lying or held in a flaming cell catches with chance 0.03 m ÷ thickness; so a stick held into a fire, or lying in a fire's path, becomes a burning stick that can be carried while it lasts. Rain puts burning pieces out with chance 2% per mm on the cell today per tick (at most 50%), or 50% under an active storm. A burning piece lying on the ground lights the cell's litter with chance 5% × readiness × heat ÷ 20 kW per tick. Hides in a flaming cell lose half their integrity. A burning stick carried by a body moves with it (Phase 3 keeps a held object's position current).

**What a flaming cell does to what's in it** (when it starts flaming), scaled by the fire's severity *s* = *I* / (*I* + 2,000 kW/m), where *I* is Byram's fireline intensity (18,000 kJ/kg × litter per m² × head rate): plant cover loses its top-kill share × *s* (grass 0.15, reed 0.15, greens 0.4, berry 0.5, nut 0.6, nightshade 0.5, tuber and bitter root 0.05); food above ground burns (grass seeds 90%, berries, nightshade and greens' leaves 80%, nuts 50%); food underground (roots, tubers, rhizomes) is untouched; grass forage loses 90% and browse 60% × *s*. The animals system reacts too (below).

**Light and heat** (`createFireProbe(sim).at(x, y, out)`): light, as a share of full sun, is 0.06 × (heat ÷ 20 kW) × (8 m ÷ distance)², summed over fires and capped at 1: a 20 kW fire lights things within 8 m as brightly as the full moon (§2.4), and about 40 m as brightly as starlight; a flaming cell (tens of MW) lights the land for kilometres. Radiant heat is 30% of the heat output spread over a sphere (about 7 W/m² at 8 m from 20 kW, 480 at 1 m), for bodies to read (Phase 2.2). Burning cells count from their centres; burning objects within 100 m and cells within 3 km.

**Animals** (§2.13): every animal keeps away from a fire of 1 MW or more (a burning cell); predators keep away from any fire. The distance kept is 25 m × (heat ÷ 20 kW)^¼ (25 m from a 20 kW fire, about 60 m from a smouldering log pile, about 150–250 m from a flaming cell, counted from the cell's edge). An animal inside that distance moves away (runs from a big fire, walks from a small one; in a random direction if it stands exactly at the fire's point, T-009); wolves won't chase, and cats won't strike at, prey standing inside it, and cats won't wait in cover inside it. In a flaming cell 3% of the hares die each tick, leaving meat; carcass meat loses 5% a tick and half its pathogen load (heat kills microbes, §2.14).

**What's stored** (part of the state hash and snapshots): the store `fires`, the layers `fire.stage` and `fire.lastBurnDay` (day number + 1 of the cell's last flaming, 0 if never), the objects' `burnKw` column, running counts (ignitions by cause, holdovers, cells ignited, flare-ups, objects that caught, embers), and the two wind components in the weather. Fuel moisture, curing and spread rates are computed.

**Which clock.** Ignition and spread follow the weather, on real days. Fuel builds up on the compressed year, like the plants it comes from. So a compressed year holds 48 real days of fire weather and a 48-day year's worth of fuel; burned area per real day is meant to be realistic, and the interval between fires on one spot, counted in compressed years, is about 7.6 times longer than in real years. That is the same choice the storms make (§2.11).

**The fire regime that results** (measured after T-005; a question for the ecology review, 1.10). In the default temperate climate fires are rare and mostly small: on a 26 km map over 30 compressed years, two fires of 18 cells and 3 cells; most lightning starts come in spring and early summer, when plants are green, and die as holdovers. On the full default map (hemmed in 0.75) none in 20 years. Large fires need a drought in the dying-back season: on an open plain with doubled year-to-year swings, one fire burned 27% of the land and a later one nearly all of it. Real lightning-fire regimes in humid temperate land have fire rotations of centuries, so rare is right; whether the drought fires are too big is for 1.10.

**Costs.** Nothing runs while nothing burns, apart from checking the tick's lightning strikes, so a quiet day costs nothing extra. A large fire costs up to about 30 ms per simulated day on the full map while it burns.

**Not in this version:** heat-treating or cracking stone in fire, cooking food (Phase 2: bodies eat), smoke, embers carried by the wind ahead of the front (spotting), crown fires, fire killing animal groups, ash fertilising regrowth, a water table that falls in droughts, plants that see bare ground, and clearing ground of fuel (needs bodies acting). Abrasion (rubbing grinding an edge) stays parked; only rubbing's friction heat is here.


**Fire regime: what the ecology review found, and what 1.11 must do.** The Phase 1 exit check (`experiments/P1-ecology-review/results.md`) found hemmed valleys inside the band (0–0.26% of land burned per compressed year) but open plains burning 1.0–3.6%, all-or-nothing: one fire year in 30–40 burns 50–100% of the plain. Pre-settlement northern mixed-grass prairie burned every 15–30 years at a spot, about 0.4–0.9% of land per compressed year, partly from people's fires, and its fires were mostly local to landscape-sized (tens to thousands of acres), smaller in summer thanks to green fuel and the rain that comes with lightning (`RESEARCH.md`, *Fire regimes*). Milestone 1.11:
- **Targets** (default climate): open country 0.4–0.9% of land per compressed year on average, and no compressed year above 25% of a world's land; hemmed valleys stay at or below 0.5%. Report fire sizes too (largest per run, and how many fires stay under 1 km²).
- **Diagnose before changing anything:** on open seeds 1–4 (256-cell maps for speed, then full size), log each fire: start day and season, the weather (wetness, soil moisture, rain during the fire), how many days it burned, area burned by day and by night, and how much came from flare-ups.
- **Levers to try, one at a time, each physical, each logged in `TUNING_LOG.md` before the change and re-measured:** (1) the rain that comes with lightning: a strike that lands in a storm's rain should wet the fuel it would light; (2) whether fires survive the night too easily: in humid grassland, dew puts most fires out overnight unless something keeps them going; (3) fuel continuity: sparse or grazed ground carries fire poorly (Cheney et al. 1998's "eaten-out" pastures), so the year's litter could scale with the share of its grass that wasn't eaten, linking grazers to fire as the patch-burn literature describes; (4) curing in humid pasture (T-005 round 6 kept 60%).
- **Then re-run the full preregistered check** (`experiments/P1-ecology-review/spec.json`, all 20 worlds, about 75 minutes on 2 cores) and add its results to `results.md`. Phase 1 exits only when all five criteria pass on that run.

**What 1.11 found (2026-11-19; T-007, D-033, `experiments/P1-fire-regime/results.md`).** Ignitions were never the problem; size is. Five physical corrections went in: dew on fine fuel; Cheney's light-wind moisture limit (fire stops at 20% fuel moisture in winds under 10 km/h, a bug); rain held in litter for about two-thirds of a day; storm rain heaviest at the core; lightning holdovers lasting about two days. Lever 3 (litter from uneaten grass) could not matter: grazers eat about 1% of the year's grass litter. After the corrections, hemmed valleys burn 0.21% of their land a compressed year with no year above 18% (on quarter-size maps), but on open country any fire that gets going still burns most of the map: a front of thousands of cells, each with smouldering wood, survives nights and light rain if one cell in a few hundred keeps an ember. Real fires are held to local and landscape sizes by breaks in the fuel; open country here has none but one-cell rivers. **Waiting on the owner** (STATUS, Q9): add sub-cell patchiness of fuel, or moist ground along streams (a water table), or both, as new mechanisms; or another way forward. The full check is re-run after that.

### 2.17 Animals and persons meet (Phase 3.3b) [provisional]
Written in 3.3b (2026-11-20, an [F] milestone run on Opus, unattended) before the code (D-052). Until now animals and agents passed through each other (§4.9.9). These are **world mechanisms**: how animals respond to a large body that walks on two legs, and what a blow does to an animal. Every rule is one an animal follows toward any large animal; nothing here reads a mind, and no agent knows any of it. Numbers are [estimates] unless a source is named; none was set after a run. Code: `src/sim/world/animals.ts` (the responses, the attacks, the door `strikeAnimal`, the part `animals.bites`), `src/sim/body/injury.ts` (bites dealt, a cause of death), `src/sim/mind/acts.ts` and `choice.ts` (strike on an animal).

**What an animal can tell about a person** (and nothing else): where the body is at the end of the last tick; its lean mass (size); its mobility (a limp, §3.10); whether it walked in its last tick (a column the acts keep, `movedTickM`; a body no act moves counts as moving); the tall cover around it (§2.13's `tallCoverOf`, the same rule that hides cats); whether a fire is near it (§2.16's distances); and whether another person of at least **20 kg lean mass** is within a distance (a body too small to fight does not count). Persons are bodies whose sex is set; a pipeline with no such body runs exactly as before (no extra draws, no other change), which a check against `main` confirms.

**1. Keeping away (flight distances).** Each tick, a group that notices a person within its distance leaves, from the nearest such person: a point the stated distance away from that person, in the direction away from it (a random direction when they stand at the same point, as T-009). Distances by day and by night (night: sunlight below 0.02, as for every animal), times 0.4 for a person that did not walk in its last tick, times (1 − 0.7 × tall cover ÷ 0.3, at least 0.3) for a person in tall cover (grass, even tall, hides only a person keeping still; one walking upright shows above it, so for it only reeds, bushes and trees count):

| kind | day | night | leaves | how |
|---|---|---|---|---|
| deer | 100 m | 40 m | 400 m | runs |
| aurochs | 50 m | 20 m | 200 m | walks; not for an hour after it was struck (it stands its ground, as against wolves) |
| wolves | 100 m | 50 m | 400 m | walk; only while fed (condition ≥ 0.7): a hungry pack does not give way |
| big cat | 50 m | 25 m | 300 m | walks; only while fed |

A group already running from something (FLEE) is left to run. Hares are a density layer and do not respond (they cannot be struck either; below). *Alibi:* prey keep their distance from any large animal coming toward them, and fed predators avoid large animals that could hurt them; neither needs anyone to have hunted them. *Source, as remembered:* ungulates flee approaching people at tens of metres to about two hundred (Stankowich 2008, a meta-analysis), farther in the open and when the person moves straight at them. Animals here never learn, so the distances do not grow where persons hunt (a known limit).

**2. Predators taking persons.** A hungry predator chooses its prey among what it already hunts and persons it can take at least risk:
- **Big cats** (at night, hungry, as before): the nearer of the nearest deer group and the nearest **lone person** (no other person of 20 kg lean or more within 50 m), within 3 km and not near a fire. A cat stalks to the tallest cover within striking range of its prey and waits (§2.13). Waiting, each tick it strikes the nearer of a deer group and a lone person within 200 m, not near a fire. The strike lands with the deer's chance: 0.35 from full tall cover, a quarter of that from open ground.
- **Wolves** (hungry, day or night): the nearer of the nearest deer group and the nearest lone person (no other of 20 kg lean or more within 100 m) who is **small (lean mass under 30 kg) or lame (mobility under 0.5)**, within 3 km and not near a fire; aurochs as before when neither. Within 300 m the pack runs the person down (a person cannot outrun it) and attacks, unless by then another person is within 100 m or a fire is near, when it gives up for an hour. *Source, as remembered:* predatory attacks by wolves on people are rare and nine in ten of their victims were children (Linnell et al. 2002).
- *Alibi:* predators take the prey they can bring down with the least risk to themselves: lone animals, small ones, lame ones; ambush hunters strike from cover at night. That is how they hunt deer here already (§2.13), and T1 names it as the physical reason company can pay; nothing in it rewards company for its own sake, and it reads only what a predator could see or smell.

**3. Bites and holds.** A landed attack wounds the person through `injure` (§3.10). It **holds** (a bite to the throat or neck) with chance min(0.9, *H* ÷ lean mass), *H* = 22 kg for a cat and 5 kg for each wolf in the pack: a hold is an open wound of 20 cm² bleeding 1,200 mL a minute, which kills by shock within minutes. Otherwise it **mauls**: a cat two bites of 25 cm² each bleeding 60 mL a minute, breaking the arm (0.7 of its use) with chance 0.15; wolves one bite each of 15 cm² bleeding 40 mL a minute, breaking a leg (0.7) with chance 0.1 a bite. All bites carry dirt 1 (an animal's mouth). Then the predator stands where the person was (it feeds there if the person died, §2.13) and rests an hour (its cooldown). A person **in jaws or under horns this tick does not walk** this tick (the acts read the part `animals.bites`). *Mechanics:* animals run before the mind and bodies, so they cannot reach the body door directly (the world does not import bodies); a landed attack is written to `animals.bites` (agent, wound, bleeding, dirt, leg, arm, the animal's kind), and `body.injury` deals each entry in the same tick, before anything else it does. Deaths by shock within 6 hours of an animal's wound count as **killed by an animal** (a new cause, `DeathCause.ANIMAL`); later deaths of infection count as infection. *Sources, as remembered:* most of the people lions attacked in Tanzania died (Packer et al. 2005); leopards' preferred prey weighs 10–40 kg (Hayward et al. 2006), so an adult person is at the top of what a cat this size holds.

**4. Struck animals.** The act strike (§4.9.3) may now take a deer, aurochs, wolf or big cat as its target, with an object held, through the door `strikeAnimal`. Each blow lands ½ *m v*² × strength joules (the act's blow, §4.9.3) times precision (the share landing where it hurts) times (1 + 3 × the object's edge); an animal is killed by **8 J per kg** of its body mass landed in all, kept per group as `hurt` (the most-hurt animal's share of that, 0 to 1), so **blows from several persons add up on the same animal**. Body masses: deer 90 kg, aurochs 700, wolf 40, big cat 60. At 1 an animal dies: its meat lies in the cell (its kind's edible kg, as any death), the group is one smaller, and `hurt` starts again from 0. `hurt` heals with a half-life of 5 days. Responses, after the blows of a tick:
- **deer**: one blow lands, then the group runs (1.5 km, as from wolves).
- **aurochs**: every blow lands; the group stands its ground for an hour, and the struck animal **gores** the striker with chance 0.4 a tick: a 60 cm² wound bleeding 200 mL a minute, dirt 0.5, breaking a leg (0.7) with chance 0.3.
- **wolves** and **big cats**: one blow lands; the struck animal bites back with chance 0.5 (a wolf's or a cat's mauling bite, as above), and the group runs (wolves 1.5 km) or walks off (a cat 300 m), giving up any hunt.
- Hares cannot be struck: they bolt before reach, and catching one needs throwing, snares or dogs, none built.
*Alibi:* a blow's energy wounds flesh whoever deals it; large prey defend themselves with horns; predators bite what hurts them, then leave. *Consequence, by arithmetic:* a lone novice (precision 0.5) with a 1 kg cobble lands about 16 J a blow, so a wolf takes about 20 such blows, a deer about 45 (it never stays for two), an aurochs about 350 (a lone striker is gored long before); ten strikers with sharp 1 kg stones (edge 0.8) land about 55 J a blow each and bring an aurochs down in about two ticks.

**5. Tallies** (`animals.counts`, appended): cats' strikes at persons and landed ones, wolves' attacks on persons, holds, bites dealt to persons (attacks and fighting back), blows landed on animals by persons, and animals killed by persons, by kind. Bites and gores are counted in `body.injuries` too (a new kind, `ANIMAL`).

**6. Calibration targets, written before the first run** (scripted persons in `tests/`):
- A person walking last tick makes deer leave from 100 m by day and 40 m at night; one standing still in full tall cover is not noticed beyond 12 m by day.
- A landed hold kills a Hadza-like adult by shock within the tick; a mauling does not kill a fed adult with water within the day.
- Landed cat attacks on lone adults kill about half the men (lean 44 kg) and two-thirds of the women (34 kg) outright; on persons under 25 kg lean, 0.9 (by construction of *H*; a sanity check against Packer et al. 2005).
- Wolves never attack a healthy lone adult; they attack a lone child or a lame adult when hungry and no deer is nearer.
- No predator strikes a person with another person of 20 kg lean or more within 50 m (cats) or 100 m (wolves), or near a fire.
- A struck deer takes one blow and runs; an aurochs gores a lone striker in about four ticks in ten; several strikers bring one down where one cannot.
- **No persons, no change:** after 20 days on a full-size map, animal positions, numbers, conditions and carcasses are identical to `main`'s.

**7. Not in this version.** Throwing, spears and traps (no projectiles; a held object's length adds no reach); animals learning where persons hunt; persons noticed by smell or by wind; hares and vultures responding to persons; predators defending a kill (a fed predator gives it up to a person, as leopards and wolves often do; lions often do not); wounded animals dying later or being slowed (a struck animal heals or dies on the spot); scavenging animals eating from a living body; aurochs charging unprovoked; dogs. A predator's attack is resolved within one tick: a person cannot fight it off once it lands, only make it give up by company, fire, or a blow struck before.

## 3. Bodies

### 3.1 Metabolism
As built in Phase 2.1: §3.8.
- Basal rate from body mass, sex, and age, using a standard equation (Schofield or Mifflin–St Jeor) [provisional].
- **Activity cost per action**, scaled by body mass, carried load, terrain slope, and gait, using MET-style multipliers (Compendium of Physical Activities). It doesn't have to be exact; it has to be consistent, so efficiency is something agents can learn.
- **Muscle is expensive:** more muscle raises strength *and* basal cost.
- Energy is stored as fat (with an upper limit) and used when intake falls short. Starvation follows depletion.
- The energy audit test (`GUARDRAILS.md` §1) checks every calorie is accounted for.

### 3.2 Hydration and temperature
As built in Phase 2.2: §3.9.
Water loss scales with heat, activity, and illness. Dehydration kills faster than starvation. Heat and cold change metabolic cost; shelter, fire, hides, and huddling near others reduce exposure.

### 3.3 Injury and healing
As built in Phase 2.3: §3.10.
- Types: lacerations (bleeding, infection risk from pathogens), fractures (reduced mobility for a long time), strains (from overexertion), bites.
- Healing takes time and calories. Immobile agents can't forage, so whether anyone brings them food matters (§7.3).
- Infection risk depends on pathogen exposure (§2.7).

### 3.4 Fitness, fatigue, and skill
As built in Phase 2.4: §3.11.
- **Fitness–fatigue model** (Banister): exertion adds to a slow-rising, slow-decaying *fitness* and a fast-rising, fast-decaying *fatigue*. Performance = base + fitness − fatigue.
- **Injury risk** rises when short-term load outruns long-term load (the acute-to-chronic workload idea from sports science) and when fatigue is high. Muscle tears from overexertion fall out of this.
- **Skills** (per action × object category) improve with practice on a power-law curve, raise success rate and energy efficiency, and decay slowly with disuse. Watching a skilled agent gives a partial boost (§5.6).

### 3.5 Aging and death
As built in Phase 2.5: §3.12.
Growth, maturity, senescence (rising hazard with age), and death from starvation, dehydration, exposure, predation, injury, infection, illness, old age, or violence. Death leaves a carcass (food for scavengers, pathogen source).

### 3.6 Reproduction
As built in Phase 2.6: §3.13.
- Two sexes. Mating requires **both** agents to select the mate action toward each other.
- Conception probability depends on energy balance (fertility drops in energy deficit) and age.
- **Gestation and lactation** carry real energy costs. Infants are fully dependent: they must be carried and fed. Children can forage partially and learn, but don't produce net calories until late in development (calibrated in §9).
- Expensive, slow-maturing children are the ecological reason pair bonds might pay (§7.4). Nothing in the code makes them happen.

### 3.7 Genetics
As built in Phase 2.7 (body dials only so far): §3.14.
- Each heritable dial has two alleles. The expressed value is their mean plus developmental noise. Recombination happens per dial, with Gaussian mutation.
- Separately, a set of **recessive deleterious loci** causes inbreeding depression when two copies match (§7.5).
- The genealogy is tracked for genetics and for the analysis layer. **Agents can't read it.**
- Dial list (each with an alibi at its definition in code): body size, basal efficiency, hiddenCauseBias, learning rate, exploration temperature, risk tolerance, curiosity weight, attachment strength, separation sensitivity, disclosure tendency, copying biases (success, attended-model, conformity), aggression threshold, co-reared mate aversion, signal coining propensity.

### 3.8 Metabolism (Phase 2.1)
What §3.1 became when it was built (D-039). `src/sim/body/metabolism.ts`, the system `body.metabolism`, which runs after the world systems; systems that make agents act (Phase 3 on) run before it, so it charges what the body did in the same tick.

**What a body holds, for energy**
- **Sex** (genome: 1 female, 2 male; 0 means no body) and **birth tick** (identity; founders are born before tick 0). Age in years is in compressed years (§1.1), like every age in the sim.
- **Lean mass** *L* and **fat** *F*, in kg. Body mass *W* = *L* + *F*.
- **Built lean mass** *L*₀, in kg: the lean mass the body has grown to. Set when the body forms; growth (2.5) and training (2.4) will move it.
- **Gut**: food eaten and not yet absorbed, in kcal.
- **Energy**, the conserved stock (kcal) = gut + ρ_F *F* + ρ_L *L*, with ρ_F = 9,441 kcal/kg and ρ_L = 1,816 kcal/kg, the energy densities of fat and of lean-tissue change (39.5 and 7.6 MJ/kg; Hall 2008). Fat is not stored separately: it is what the stock leaves after the gut and the lean mass, so no part of the body can gain energy the stock didn't. Inflow: the body when it forms, then everything eaten. Outflow: heat.

**Each tick**
1. **Absorption.** The gut passes at most 3 kcal a minute into the tissues [estimate; gastric emptying is remembered as 1–4 kcal a minute, unsourced]. Absorbing costs nothing separate: FAO's activity ratios below were set against 24-hour measurements that include the response to food (FAO/WHO/UNU 2004, ch. 2), so charging the thermic effect on top counted it twice (2.1 charged 10% of what was absorbed; T-014 removed it).
2. **Spending.** The basal rate *B* comes from the Schofield equations (FAO/WHO/UNU 2004, Table 5.2) by sex, age band (under 3, 3–10, 10–18, 18–30, 30–60, over 60) and *W*. The tick splits into time spent moving and the rest:
   - The rest costs *B* × the **physical activity ratio** (PAR, multiples of the basal rate) of the effort the body held: sleep 1.0; still, lying or sitting awake 1.4 (FAO "light leisure"); light, standing and handling light things 2.2; moderate, digging, gathering, collecting wood 4.1 (FAO's 4.1–4.4); heavy 6.0 [estimate: FAO names heavy work without a value]. Still is the effort of a tick nobody describes.
   - Time moving costs *B* × 1.4 for the body upright, plus the motion itself (Pandolf et al. 1977, with *W*_t = *W* + load): walking, below 2 m/s, η *W*_t 1.5 *v*² watts; running, at 2 m/s or more, 1 kcal per kg of *W*_t per km (the net cost of running). Climbing costs 0.35 η *W*_t *v G* watts with *G* in percent, which is 35 η J per kg per metre climbed (about 25% efficient work). Going down saves nothing [simplification: real walking down a gentle slope is a little cheaper]. η = 1.2, Pandolf's terrain factor for light brush, everywhere [simplification].
   - A load costs 2.0 *W*_t (load ÷ *W*)² watts for the whole tick (Pandolf's load term).
   - Check: walking at 1.25 m/s comes to about 3.1 × *B* in all, against FAO's 3.2 for "walking at varying paces".
3. **Tissues.** Absorbed minus spent is split between fat and lean mass by **Forbes's rule**, dL/dF = C/F with C = 10.4 kg (Hall 2008, after Forbes): lean people lose more of a deficit from lean tissue, and gain more of a surplus there. The body moves along the curve L = C ln F + constant in both directions, so refeeding restores what a famine took, and fat can approach zero but never reach it. There is no hard ceiling on fat: a ceiling would have to throw energy away. Fat is bounded by how fast the gut absorbs (about 4,300 kcal a day at most) and by what a heavier body costs to carry.
4. **Starvation.** A body whose lean mass falls below two-thirds of its built lean mass dies of starvation [estimate; Leiter & Marliss 1982 found that death in fasting came as fat stores approached exhaustion, and with Forbes's rule a lean adult at that point has 1.5–3 kg of fat left and has lost about 40% of body mass]. The agent is removed and the death counted by cause (`body.deaths`); like every death, it leaves a carcass (§3.12).

**What tells the body what it did.** Five columns, written during the tick by whatever makes the agent act (Phase 3 on; fixtures in `tests/` until then) and cleared by metabolism after it charges them: effort, metres moved, seconds spent moving, metres climbed, load carried in kg. A sixth, the heat made by shivering, is written by `body.heat` (§3.9) and charged and cleared the same way; metabolism writes back the heat it made apart from shivering, for `body.heat` to use next tick. It also writes the tick's exertion, for `body.fitness` (§3.11). Doors: `formBody(sim, slot, …)`, right after `spawnAgent`, sets sex, age, lean mass and fat, and records the body as the first inflow; `ingest(sim, slot, kcal)` puts food in the gut. A live agent without a body stops the run with an error, so a forgotten `formBody` can't pass unnoticed.

**Calibration (scripted bodies in `tests/`, §9).** A Hadza-like day of sleep, sitting, digging and walking, with the travel distances of §9, spends within 15% of §9's ~2,600 kcal (men) and ~1,900 kcal (women). Since 2.8 (T-014): 2,541 and 1,962 kcal, and the test also reports each day as a PAL over Henry's BMR beside Pontzer et al.'s 2.26 and 1.78. A lean adult with water and no food dies in 30–80 days having lost 30–50% of body mass.

**Not in this version.** Adaptive thermogenesis (in real starvation the metabolic rate falls further than lost tissue explains, so these bodies starve somewhat sooner); terrain surface (sand, snow, brush all cost η = 1.2); savings walking downhill; stomach capacity (it needs the mass of food, which arrives with eating in Phase 3); injury and illness (§3.10), fitness and muscle (§3.11: training moves lean and built lean mass together, and *B* follows the mass), growth (§3.12: it moves lean and built lean mass together too, and scales Forbes's constant for a body short of its adult frame), pregnancy and lactation (2.6); the heritable `basalEfficiency` and body-size dials (2.7); carcasses (§3.12). The cost of heat and cold is §3.9's: metabolism charges the shivering it asks for.

### 3.9 Heat and water (Phase 2.2)
What §3.2 became when it was built (D-041). Two systems in `src/sim/body/`: `body.exposure` (`exposure.ts`) reads the world at each body's position, and `body.heat` (`heat.ts`) keeps the body's temperature and water. Both run after the world systems and before `body.metabolism`; systems that make agents act (Phase 3 on) go before `body.exposure`, so a body is exposed where it ended the tick's acts.

**What a body is in** (nine columns, written each tick by `body.exposure`, or by a fixture in `tests/`; columns nobody writes read 0, which is 0 °C, still, dry, dark air, so a forgotten exposure shows up as bodies dying of cold):
- **air temperature** at the cell's height (§2.11);
- **mean radiant temperature** from sky and ground: the air temperature, less 10 °C × the open share of the sky × how clear it is (1 on a dry day, 0.2 on a wet one) [estimate: a clear night sky radiates like a surface some 20 °C colder than the air, and a body sees about half sky, half ground];
- **relative humidity** near the ground, as fire estimates it from soil moisture, a wet day and the hour (§2.16);
- **wind at body height**: the 10 m wind (§2.11) × 0.65 [estimate: a logarithmic profile over short grass, roughness 3 cm, at about 1.2 m] × the share shelter lets through;
- **rain reaching the body**, mm per hour: a storm's rain now plus a wet day's rain spread over its 24 hours, × the share shelter lets through;
- **sunlight reaching the body**, W/m²: 800 × sunlight (§2.4) [estimate; the sun's seasonal height is not modelled] × 0.25 on a wet day (cloud) × the open share of the sky;
- **radiant heat from fires**, W/m² (`createFireProbe`, §2.16);
- **insulation of held hides**, clo: 0.8 clo per kg of hide the body holds (§2.15), at most 4 clo [estimate: about the warmest fur clothing measured];
- **skin against other bodies**: 12% of the skin for each other body within 0.5 m, counting at most three [estimate after Gilbert et al. 2010: huddling saves endotherms 6–53% of their heat]. A neighbour's skin is at about the body's own temperature, so the covered skin exchanges almost nothing. This is heat physics, like the heat of a fire; whether bodies come together is Phase 3–4's.

Shelter (`createShelterProbe`, §2.15) now returns the share of **sky** a spot hides in place of a share of "heat loss": what hides the sky keeps off both the sun and the cold of a clear night sky. That replaces §2.15's placeholder estimates with physics this section can use.

**What a body holds** (columns, beside §3.8's):
- **Core temperature** *T*, °C, starting at 37. One body temperature for the whole body (a one-node model), with heat capacity 3.47 kJ per kg per °C × body mass.
- **Water**, the conserved stock, kg: total body water. It starts at 0.73 × lean mass (the hydration of fat-free mass; Wang et al. 1999) and that start is its first inflow. Inflow: drinking (`drink(sim, slot, kg)`, which the world has already given up) and the water made by burning fuel, 0.12 kg per 1,000 kcal spent [estimate: fat yields about 0.11 g per kcal, carbohydrate about 0.15]. Outflow: breath, skin, sweat and urine. The **water deficit** is 0.73 × lean mass − water: lean tissue lost to hunger releases its water as surplus, which the kidneys pass.
- Two columns shared with metabolism: the heat made last tick apart from shivering (W, written by metabolism), and the shivering asked for this tick (W, charged and cleared by metabolism, like the five columns of what the body did).
`body.heat` gives a body its temperature and water the first tick it sees it, so `formBody` stays the one door for a new body.

**Each tick** (heat flows in W; *A* is skin area, 0.11 × *W*^(2/3) m² [Meeh's form, fitted to DuBois's formula for adults of ordinary build]; *A*_e = *A* × (1 − skin against others)):
1. **Exchange with the air.** Convection *h*_c = 8.3 √*v* W/m²K (*v* the air speed past the body, wind and walking speed combined, at least 0.2 m/s), radiation *h*_r = 4.7. The operative temperature is the mean of air and radiant temperature weighted by *h*_c and *h*_r; absorbed sun and fire heat raise it further (the sol-air temperature): absorbed = 0.25 × *A* × (0.7 × sun + 0.95 × fire) [a quarter of the skin faces a source; skin absorbs 70% of sunlight and 95% of a fire's infrared]. The air layer resists heat by *R*_a = 1 / (*h*_c + *h*_r); hides by 0.155 m²K/W per clo, half of it lost when soaked (fully at 1 mm of rain an hour on the body) [estimate].
2. **Fixed losses.** Breath: 0.0014 *M* (34 − air) by warming and 0.0173 *M* (5.87 − *P*_a) by evaporation (*M* the heat made, *P*_a the air's vapour pressure in kPa, by Tetens's formula; ISO 7933). Skin diffusion: 1.7 W/m² per kPa × (5.32 − *P*_a) [Fanger's form, halved to give about 0.45 kg a day from an adult at 20 °C and 50% humidity, the skin's share of the clinical ~10 mL per kg per day of insensible loss]. Rain cools by warming the water that lands on a quarter of the skin to 34 °C.
3. **Regulation** (after Scholander's scheme). The body aims to return to 37 °C over half an hour: it wants to store *S* = heat capacity × (37 − *T*) / 1,800 s. Its tissue insulation can range from 0.03 m²K/W (blood vessels in the skin open) to 0.08 + 0.3 × fat share (closed; more fat insulates more) [estimates in the range of maximal tissue insulation, about 0.1–0.2]. Dry heat loss is *A*_e (*T* − operative) / (tissue + hides + air).
   - If even the most insulation loses more than the body makes, less *S*: it **shivers** to make up the difference, up to 2.5 × the basal rate [estimate: peak shivering is about 4.9 × resting (Eyolfson et al. 2001), held for hours at about 2–3 ×]. Metabolism charges it in the same tick.
   - If even the least insulation keeps more than *S*: it **sweats** to evaporate the difference, up to what the air can take (*E*_max, from *P*_sk = 5.6 kPa, the Lewis relation 16.5 K/kPa, and hides passing 38% of the vapour that air does; ISO 9920's default) and at most 1 kg of sweat an hour for 1.5 m² of skin, in proportion to skin area [estimate; acclimatised people reach 1–2; fixed at 1 kg for every body until 2.6, T-012]. Sweat that drips costs water without cooling: the share evaporated is 1 − *w*²/2, *w* the wetted share of skin (ISO 7933). Dehydration cuts the most it can sweat, by half at the fatal deficit [estimate].
   - Otherwise insulation alone holds the balance, at no cost.
   Whatever is left heats or cools the body.
4. **Water.** Breath and skin losses, sweat, and urine leave; urine is at least 0.5 kg a day for a body whose basal rate is 1,500 kcal a day, in proportion to its basal rate [estimate: the least that carries away the solutes made by burning food; a fixed 0.5 kg until 2.6 dried out newborns, T-012], and a surplus over 0.73 × lean mass passes within about an hour (at most 1 kg an hour).
5. **Death** (counted in `body.deaths` by cause, agent removed): **dehydration** when the deficit reaches 15% of body mass [estimate; Adolph 1947, as remembered: losses of 15–25% of body weight are fatal]; **hyperthermia** at a core temperature of 42 °C [estimate]; **hypothermia** at 26 °C [estimate: accidental hypothermia is usually fatal below 24–28 °C without rescue].

**Calibration targets, written before the first run** (scripted bodies in `tests/`):
- A naked adult lying still in still, shaded, half-humid air neither shivers nor sweats somewhere between 26 and 33 °C (the classic thermoneutral zone of nude people, about 28–32 °C).
- A naked adult sitting in still air at 5 °C for two hours spends 1.5–3.5 × the resting rate and loses less than 1.5 °C of core temperature (cold-air exposures of nude men).
- An adult resting in shade with no water, by the day's top shade temperature (FM 21-76's table after Adolph, remembered: 2 days at 49 °C, 3 at 43, 5 at 38, 7 at 32, 9 at 27, 10 at 21 °C or less; the 2006 manual's text could not be found to hold it, so this is unverified): dies of dehydration in 0.6–1.6 × 3 days at a top of 43 °C, and in 0.6–1.6 × 10 days at a top of 21 °C, with survival shortening as the heat rises. Dehydration always kills well before starvation (§3.8: 43–57 days).
- A Hadza-like day (§3.8's scripted day) in warm weather (air 20–32 °C, sun on the outing) turns over 2–6 kg of water [estimate; temperate sedentary adults about 2.5].
- Heavy work in hot, humid sun without water overheats a body within a day; the same work in shade at 20 °C does not.
- On a clear, calm night at 0 °C a naked sleeper shivers; a fire 1.5 m away, a hide, or two other bodies against it each cut the shivering.

**Not in this version.** Posture (curling up, lying on cold ground); caves keeping the year's mean temperature inside; the sun's height by season; acclimatisation to heat or cold; wet hides staying wet after the rain stops; evaporation of rain from the skin; water in food (it arrives with food's mass in Phase 3); a gut for water (drinking enters the body at once); dehydration lightening the body for metabolism (§3.8 uses lean + fat; at the fatal deficit that is 15% off); illness raising water loss and fever, and burns from fire, are §3.10's; the stomach's limit on drinking.

### 3.10 Injury, healing and infection (Phase 2.3)
What §3.3 became when it was built (D-042). `src/sim/body/injury.ts`, the system `body.injury`, which runs after `body.exposure` and before `body.heat` and `body.metabolism`: it reads the fire's heat on each body and the tick's lightning strikes, keeps wounds, bleeding, broken bones, strains, burns and infections, and hands `body.heat` a fever and `body.metabolism` the heat that healing and fighting infection make. Every number below is an estimate unless a source is named (`RESEARCH.md`, *Bodies*).

**What a body holds** (columns beside §3.8–§3.9's; all start at 0, a whole and healthy body):
- **Bleeding**, mL a minute, and **circulating volume missing**, litres: blood lost and plasma leaked out of the vessels after burns, not yet refilled. Blood volume is 0.085 L per kg of lean mass (about 5 L for a 70 kg man).
- **Open wound**, cm²: cuts, bites' punctures, torn skin and full-thickness burns, summed. **Partial-thickness burns**, as a share of the skin.
- **Broken bones**: a leg and an arm, each the share of that limb's use lost, 0 to 1. **Strain**, the share of capacity for hard effort lost to torn muscle or tendon.
- **Lean tissue to rebuild**, kg: blood and tissue lost, which healing makes again.
- Two **infections**, each a course with three numbers: severity (0 to 1), the immune response against it, and the virulence of the strain that took hold. One is in wounds, one in the gut.
- Doses waiting to be resolved, in infectious units: into wounds and into the gut. The skin's accumulated heat dose in the current exposure to fire.
- Outputs for others: the **fever** (°C the body's set-point is raised), the **heat of healing** (W, charged by metabolism like shivering), and **mobility** and **arm use** (0 to 1), which Phase 3's acts will read as the share of walking and handling the body can still do.

**Doors** (whatever makes the injury calls them; nothing in a real run does yet except fire and lightning):
- `injure(sim, slot, injury)` with any of: open wound (cm²), bleeding it starts (mL a minute), dirt carried into it (0 for a clean edge, 1 for an animal's mouth or soil), a broken leg or arm (share of use lost), a strain (share lost). A bite is an open wound with dirt near 1, and may break bone; a fall may break bone and start internal bleeding. Phase 3 on (agents' acts, animals that attack bodies) decides what a blow or a bite does; strains from overexertion are 2.4's, from its load model.
- `exposeGut(sim, slot, dose)`, with `waterDose(kg, load)` = 1 unit per kg of water at a full bloom (§2.14), so a litre of fully bloomed lake water makes about two drinkers in three ill, and `meatDose(kg, load)` = 4 units per kg of meat at a full bloom. Phase 3's drinking and eating call them with the load where the water or meat came from; cooking will lower the meat's load.

**Each tick**
1. **Doses.** A body with no infection on a route catches one with probability 1 − e^(−dose). The course starts at severity 0.01 (wounds) or 0.03 (gut), and the strain's virulence *g* is drawn from a log-normal (median 0.5 a day, spread 0.5, in wounds; 0.9 and 0.3 in the gut). An open wound takes in a dose of 0.001 units per cm² per day while it is open (a quarter of that for partial burns), and `injure` adds 0.05 units per cm² × dirt.
2. **Fire.** Skin burns by thermal dose, (*q* − 1.7 kW/m²)^(4/3) × seconds, *q* the radiant heat from fire on the body (`body.exposure`) [after O'Sullivan & Jagger 2004, as remembered; below about 1.7 kW/m² skin carries the heat away indefinitely]. The dose accumulates while the body is in the heat and starts again once it is out. The skin facing the fire (a quarter; three quarters inside a flaming cell) burns partially from 250 units, all of it by 500, and through its full thickness from 1,000, all of it by 2,000. Each share newly burned pushes 2 mL per kg of body per percent of skin out of the vessels over the next hours (time constant 8 hours; half the Parkland formula's 4 mL, which is what replacing the loss takes).
3. **Lightning.** Each strike lands at a uniform point in its cell (drawn for every strike, whoever is near). A body within 10 m is struck by side flash or ground current: its heart stops with probability 0.5 × (2 m ÷ distance)², at most 0.5, and otherwise it takes superficial burns over 3% × the same factor of its skin. Averaged over the 10 m disc that kills about 8% of those struck, near the ~10% usually quoted (Cooper, as remembered).
4. **Blood.** Bleeding slows as it clots, with a time constant of 5 minutes, so a wound bleeding *r* mL a minute loses about 5 *r* mL in all [bleeding time 2–9 minutes]. Lost blood is lost lean tissue: lean mass, its energy (ρ_L, §3.8) and its water (0.73 kg per kg) leave as outflows, and the tissue joins what is to be rebuilt. Plasma leaked after burns stays in the body. The vessels refill from the body's water with a time constant of 12 hours [transcapillary refill takes a day or two], slowed in proportion to dehydration (none at §3.9's fatal deficit).
5. **Infection.** A wound infection follows *ds*/*dt* = *g s* − *m s*, spreading until the response overtakes it; a gut infection *ds*/*dt* = *g s* (1 − *s*) − *m s*, since the gut's lining is finite (T-010). Meanwhile the response grows, *dm*/*dt* = ρ × condition, with ρ = 0.1 a day in wounds and 0.3 in the gut; a course below 0.0001 that the response holds down is over, and the response then fades (half-life 30 days for wounds, 60 for the gut), so a recent illness protects against the next. *Condition* is 0.2 + 0.8 × nourishment, where nourishment rises from 0 at 1% body fat to 1 at 6% or more [estimate: malnourished bodies heal and fight infection slower]. The shape gives every infection a course: the strain grows until the response overtakes it, then dies away; a virulent strain in a poorly nourished body outruns it.
6. **Healing**, all slowed by *condition*: an open wound closes from its edges at 0.7 mm a day (as if round: *dA*/*dt* = −2 √(π*A*) × 0.07 cm), and much slower while infected (at a severity of 0.3 and above, a fifth of the rate); partial burns heal with a half-life of 7 days [superficial partial burns heal in 1–3 weeks]; a broken bone's loss halves every 14 days [adult long bones unite in 6–12 weeks]; a strain's every 7 days. Lean tissue is rebuilt at 1/20 of what is owed a day (scaled by nourishment, and only while fat lasts), which moves energy from fat to lean inside the stock and costs a fifth of the energy rebuilt as heat.
7. **Water.** Burned and open skin evaporates %burned × skin area (m²) mL an hour over intact skin's loss [the excess in the usual (25 + %burned) × area formula for burns]. Diarrhoea takes 10 kg a day × the gut's severity [about 1 L a day in a typical episode; a cholera-like purge at the top]. Both leave the water stock as outflows.
8. **Outputs.** Fever: 3 °C × *S* ÷ (*S* + 0.25), with *S* the wound infection's severity plus half the gut's (at most 1); `body.heat` regulates toward 37 °C + fever. Heat of healing, in multiples of the basal rate (Long et al. 1979's hypermetabolism of injury, as remembered: fractures 10–30%, sepsis 20–60%, burns 40–100%): 0.25 × the broken bones (at most 1), plus 2 × the share of skin burned or open (at most 1), plus 0.7 *S* ÷ (*S* + 0.15), all together at most 1.5, plus the cost of rebuilding. Mobility: (1 − 0.9 × leg) (1 − 0.5 × strain) (1 − 0.5 × circulating loss ÷ fatal loss) (1 − 0.5 × fever ÷ 3); arm use: 1 − 0.9 × arm.
9. **Death** (counted in `body.deaths`, agent removed): **shock** when the circulating volume missing reaches 40% of blood volume [ATLS class IV haemorrhage], from bleeding or burns (counted as **killed by an animal** instead when an animal wounded the body in the last 6 hours, §2.17); **infection** when a wound infection's severity reaches 1 (sepsis); **lightning** when the heart stops. A gut infection kills only through the water it takes, as dehydration (§3.9). A tally, `body.injuries`, counts injuries by kind: wounds dealt through `injure`, burns, bodies struck by lightning, wound infections and gut illnesses caught.

**Calibration targets, written before the first run** (scripted bodies in `tests/`):
- A small clean cut (2 cm², 20 mL a minute, dirt 0.05) on a fed adult with water closes within 3 weeks and kills no one; its lost blood is rebuilt within about two months.
- A wound bleeding 600 mL a minute kills a Hadza-like man by shock within the hour; one bleeding 100 mL a minute does not.
- Of wound infections in fed adults with water, 2–15% kill [the pre-antibiotic death rate of wound sepsis, an estimate]; in adults kept at about 3% body fat, at least twice as many. A wound infection the body clears lasts 1–4 weeks.
- A litre of water at a full bloom makes 50–80% of drinkers ill. A gut illness has diarrhoea above 0.3 kg a day for 2–10 days; with water to drink, fewer than 2% of fed adults die. Drunk again within a month of recovering, the same water makes fewer than a third as many ill.
- An infected body's core temperature at the height of its illness, in thermoneutral surroundings, rises at least 0.5 °C, and it spends more energy than an uninfected twin.
- A leg broken to 0.9 leaves mobility under 0.2 at first and above 0.85 after 8 weeks.
- Burns: with water to drink, burns over 10% of the skin don't kill by shock; burns over 40% do, within two days [before fluid resuscitation, burns over about a third of the skin were mostly fatal; an estimate]. Standing for a tick in a flaming cell burns.
- Lightning kills 3–20% of those it strikes within 10 m.

**Not in this version.** Who or what deals a blow or a bite (Phase 3 on); pain as a signal to the mind (Phase 3's perception reads the body's state); wound infection from the specific pathogen loads where the wound was dirtied (dirt is a number the caller gives); the gut's lost absorption in illness; infection spreading from body to body; cooling by evaporation from burns; lightning favouring tall things and missing bodies in rock shelters; permanent damage (a badly set bone, a lost eye); illness from crowding, and chronic illnesses. Strains from overexertion are §3.11's (2.4), dealt through `injure`; the tally counts them apart from wounds.

### 3.11 Fitness, fatigue, load injuries, muscle and skills (Phase 2.4)
What §3.4 became when it was built (D-043). Two files in `src/sim/body/`: `fitness.ts`, the system `body.fitness`, which runs last, after `body.metabolism`, and reads what the body did from a column metabolism writes; and `skills.ts`, a practice curve kept per act and kind of thing, which acts (Phase 3 on) write through a door and read back. Every number below is an estimate unless a source is named (`RESEARCH.md`, *Fitness, fatigue and skill*).

**Load.** Metabolism (§3.8) now also writes the tick's **exertion**: what the body spent on its activity (effort, standing upright while moving, the motion itself, the load), in multiples of the basal rate, leaving out the thermic effect of food, healing and shivering. A tick's **load** is (exertion − 2.2) × hours, nothing below 2.2: hours at one basal multiple above light standing work (the FAO ratio for standing and handling light things, §3.8). §3.8's scripted Hadza-like day comes to about 8.3 load-hours for both sexes (about 2.5 hours of walking, part of it loaded, and 2–3 hours of digging); **8 load-hours a day is the reference**, the scale on which the numbers below are set. It anchors the scale; it is not a target for anything agents do.

**What a body holds** (columns, category `body`):
- Three running averages of the daily load, each exponentially weighted: **fitness** over 42 days, **fatigue** over 7 days, **chronic load** over 28 days. 42 and 7 days are the usual constants of Banister's fitness–fatigue model (as used in training software); 7 and 28 days are the windows of the acute:chronic workload ratio (Gabbett 2016; the exponentially weighted form after Williams et al. 2017). Fatigue doubles as the acute load.
- **Trained muscle**, kg: lean mass added by the work the body does, on top of its frame. Built lean mass (§3.8) includes it.
- **Conditioned to**, load-hours a day: written by `formBody` from the body's spec (default 0), read once by `body.fitness` the first tick it sees the body, then cleared. A founder formed as an adult who has lived a forager's life comes with that life's fitness and muscle; a newborn comes with none. It sets the three averages to the given load and the trained muscle to its target there, without changing the body's lean mass.

**Each tick**
1. **Averages.** Each average *x* moves toward the tick's load expressed per day: *x* ← *x* e^(−Δt/τ) + (1 − e^(−Δt/τ)) × load × ticks a day.
2. **Performance** (Banister et al. 1975): *p* = *k*₁ τ₁ × fitness − *k*₂ τ₂ × fatigue, with *k*₁ = 1, *k*₂ = 2 [estimate: Banister's fits put fatigue's gain at about twice fitness's]. **Capacity**, the share of a conditioned forager's sustained work rate the body can hold now, is 1 + 0.2 × (*p* − *p*_ref) ÷ *p*_ref, with *p*_ref the steady performance at the reference load (28 × 8), kept between 0.5 and 1.3 [estimate: aerobic capacity of sedentary adults is roughly a fifth below that of active ones, and training raises it by about as much]. So a rested body that has never worked holds 0.8, one conditioned to the reference 1.0, one conditioned to twice the reference 1.2. A block of hard days lowers capacity for a while (fatigue rises fast); rest after it raises capacity above where it started (fatigue falls fast, fitness slowly): the taper. Capacity is computed when asked (`capacityOf`), for Phase 3's acts to read beside mobility (§3.10).
3. **Load injuries.** While the body works (load > 0), it strains a muscle or tendon with probability 1 − e^(−*h*₀ × load × *m*), with *h*₀ = 1.7 × 10⁻⁴ per load-hour [estimate: a body steadily at the reference load strains something about once in two years of real days] and *m* rising with the acute:chronic ratio *R* = fatigue ÷ the larger of chronic load and 1 load-hour a day: *m* = 1 + 4 (*R* − 1)² above *R* = 1, at most 8 [after Gabbett 2016 and Hulin et al., as remembered: ratios of 1.5 and above carried 2–4 times the injury risk of 0.8–1.3; here 2 at 1.5, 5 at 2]. The floor of 1 load-hour a day stands for the walking of ordinary life, so a body that has never worked is not infinitely fragile. High fatigue and short-term load outrunning long-term load are the same measure here, because fatigue is the 7-day load. The strain's severity, the share of capacity for hard effort lost, is 0.05 + 0.55 *u*², *u* uniform (mostly mild, now and then a tear); it is dealt through `injure` (§3.10), which heals it. Draws come from a run-wide stream of their own, `LOAD`.
4. **Muscle.** The trained muscle's target is 0.1 × frame × (1 − e^(−fatigue ÷ 8)), the frame being built lean mass less the trained muscle [estimate: steady work adds up to a tenth of a body's lean mass]. It follows the recent load (the 7-day average) because muscle protein balance answers loading within days. Muscle above the target is lost with a time constant of 20 days, moving energy from lean to fat inside the stock (no cost); muscle below it is built with a time constant of 120 days, scaled by nourishment (§3.10: 0 at 1% body fat, 1 at 6%), drawing on fat above 1% of body mass (0.5 kg before 2.6, §3.13) and paying a fifth of the energy built as heat, as healing does (§3.10). Lean mass and built lean mass move together, so the gap hunger has opened between them (§3.8) is untouched, and starvation's threshold follows the muscle. **Muscle is expensive** (§3.1) through what §3.8 already charges: the Schofield basal rate rises with body mass, about 11–15 kcal a day per kg in adults, near the ~13 of real skeletal muscle (Elia 1992, as remembered), and every kg costs its share of moving. The water a gain needs comes out of the body's water (§3.9's deficit), and a loss's water passes in urine.
5. **Strength** is computed when asked (`strengthOf`): (lean mass ÷ 50 kg)^(2/3) × (1 − 0.5 × strain) [strength follows muscle cross-section, mass to the two-thirds]. Phase 3's acts read it (striking, carrying, `take`'s contest of strength, §5.5).

**Skills** (`skills.ts`).
- **What is kept.** A practice total for each pair of an act and a kind of thing: the acts are four of §5.5's primitives that work on things — strike (hitting it, with or without a held object), manipulate (working it with a held object, striking or rubbing one against it), pick up (getting it: picking, pulling, digging out, lifting from the ground), consume (eating it, including getting the edible part out). The kinds are what agents perceive as categories (§4.1): the eight materials (§2.15), the eight plant species (§2.12), deer, aurochs, wolves, big cats, hares, carcasses, and other agents: 23, so 92 pairs. Phase 3 may change the list; it is a table, not a commitment.
- **Learned.** Skills are acquired during a life, so their columns are categorised `learned` (D-043): every body starts at zero, founders included, and the blank-slate guardrail checks it. They live in the nervous system and shape what the body does rather than what the mind knows, but `learned` is the stricter reading and §5.6 will make them partly transmissible. Practice in the tick a body was spawned is not counted, because no system may write learned content then (§1.5).
- **The practice curve.** Practice is counted in hours on the life clock: an hour of practice counts 365.25 ÷ (days in a compressed year) hours, so a compressed life holds as many practice hours as a real one and the share of life spent becoming skilled is kept (§1.1's preserved ratios; the same reason life history runs on the compressed year, D-024). Skill *s* = 1 − (1 + *P* ÷ 100 h)^(−0.5): the share of the gap between a novice and an expert that practice has closed, the gap shrinking as a practice curve (Newell & Rosenbloom 1981: exponents 0.2–0.6, as remembered). *s* is 0.29 after 100 hours, 0.5 after 300, 0.9 after about 10,000.
- **Disuse.** Practice is not lost while a skill is in use: only after a full compressed year without practice does it start to decay, halving every 5 compressed years of disuse after that [estimate: motor skills are retained for years]. An expert at 0.9 who stops keeps about 0.86 after 6 years and 0.63 after 21. Kept lazily: the total and the tick it was last practised, decayed when read, so idle skills cost nothing per tick.
- **What skill does.** `practice(sim, slot, act, kind, seconds)` adds practice; `skillLevel(sim, slot, act, kind)` reads *s*. Phase 3's acts set, per act, what a novice and an expert achieve per try and per second, and interpolate by *s* (`bySkill(novice, expert, s)`). Skill does not lower an act's metabolic rate: it raises what the act achieves per second and per try, which is where an expert's saving of energy comes from [estimate].
- Watching a skilled agent (§3.4's last clause, §5.6) is between agents and waits for the owner; it is not built.

**Calibration targets, written before the first run** (scripted bodies in `tests/`):
- A body conditioned to the forager's day and living it holds capacity within 0.02 of 1 for 60 days. An untrained body (conditioned to 0) starting the same days begins at 0.8 and closes half of the gap to 1 in 3–10 weeks [aerobic training gains come over weeks to a few months].
- Four weeks at twice the forager's load lower capacity at first; a week of rest after them leaves it higher than at the end of the block (Banister's taper).
- Bodies conditioned to the forager's day strain something 0.2–1 times a year of real days. Untrained bodies starting the forager's day strain at least twice as often in their first four weeks as conditioned ones, and at most eight times.
- A conditioned man (§3.8's Hadza-like man) lying still for 14 days, fed and watered, loses 0.5–2 kg of lean mass [bed-rest studies, as remembered: about 1 kg in two weeks]. An untrained man doing twice the forager's load for 12 weeks, fed, gains 0.5–2.5 kg of lean mass [resistance training adds about 1–2 kg in 12 weeks; heavy daily work, as remembered], and his basal rate rises with it.
- Skill: 0.29, 0.5 and 0.9 at 100, 300 and about 10,000 life-hours. Practising half an hour a real day from age 5, skill at 18 is 80–95% of skill at 33 (Koster et al. 2020: the average hunter has 89% of his peak skill at 18 and peaks at 33). An expert who stops keeps above 0.85 after 5 compressed years and above 0.6 after 20. Nothing is learned in the tick a body is spawned.
- Energy and water audits pass with all of it running.

**Not in this version.** A body's own fatigue within a day (hours of heavy work without rest wearing it down; only the 7-day average exists), and sleepiness, which is Phase 3's drive; injury risk falling as fitness rises other than through the ratio; strains of particular muscles or tendons; muscle that age or sex train differently (2.5–2.7); a heritable trainability; skills improved by watching (§5.6, between agents); skills that transfer between kinds of thing (striking flint teaching something about quartzite); senescence's loss of skill and strength (2.5, §3.12); fat charged by Schofield at the same rate as muscle (real adipose tissue costs about a third as much; for 2.8).

### 3.12 Growth, aging, death and carcasses (Phase 2.5)
What §3.5 became when it was built (D-045). Two files in `src/sim/body/`: `lifecourse.ts`, pure functions of age (the growth curve, the losses after the peak, the hazard of old age), and `aging.ts`, the system `body.aging`, which runs last, after `body.fitness`; and in `metabolism.ts`, beside the death tally, `deathDoor`, the one door every body's death goes through. Ages are compressed years (§1.1), like every life history; the physiology of each day stays in real days (D-024). Every number is an estimate unless a source is named (`RESEARCH.md`, *Growth, aging and death*).

**The frame.** A body's **frame** is its built lean mass less its trained muscle (§3.8, §3.11): the lean mass it has grown to. Each body gets an **adult frame**, kg, the frame it grows toward and ages from: `formBody` takes it from the spec (`adultFrameKg`; 2.6–2.7 will pass the newborn's, from its genes), and otherwise `body.aging` sets it the first tick it sees the body, as the frame then ÷ the curve's share at that age, so a body formed at any age is on its own curve. The **frame curve** is a share of the adult frame by age and sex, interpolated linearly between these points and flat beyond the last:

| age (years) | 0 | 1 | 2 | 5 | 10 | 13 | 15 | 18 | 20 | 22 | 35 | 50 | 65 | 80 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| female | 0.075 | 0.19 | 0.24 | 0.32 | 0.43 | 0.55 | 0.72 | 0.93 | 1 | 1 | 1 | 0.96 | 0.90 | 0.82 | 0.70 |
| male | 0.065 | 0.18 | 0.23 | 0.31 | 0.42 | 0.52 | 0.62 | 0.84 | 0.95 | 1 | 1 | 0.96 | 0.90 | 0.82 | 0.70 |

Growing: slow from weaning to puberty (about 1 kg of lean mass a year), 40–45% of adult size at 10 and a late spurt, as in the foragers Walker et al. (2006) measured (Hadza and Ju/'hoansi at 10 are "only about 40–45% of their adult size"; the spurt ends at 18–19.5 in girls, about 21.5 in boys). A newborn of 2.6–2.9 kg of lean mass sits at the first column for a Hadza-like adult (§3.8's 34 and 44 kg). Aging: lean mass held to 35, then lost at about 0.3% a year to 50 and about 0.5% a year after 65 [estimate, sarcopenia as remembered].

**Each tick** (`body.aging`):
1. **Growth**, while the body is younger than 25 [estimate: the last growth plates close in the mid-twenties]. If the frame is below the curve, it moves toward it with a time constant of 2 days [estimate; short enough that a fed child stays within about 5% of the curve in its first months, when it grows fastest, and within 1% after; the first version's 10 days left a fed one-year-old 13% behind, D-045], scaled by nourishment (§3.10: 0 at 1% body fat, 1 at 6%). The new frame is first claimed from lean tissue the body already holds above its built lean mass (a surplus already laid down, §3.8); the rest is built from fat, paying a fifth of the energy built as heat, as healing and muscle do (§3.10, §3.11), never taking fat below 1% of body mass. Lean mass and built lean mass move together. A child kept short of food grows less, catches up while it is still young enough, and stays small if the shortage lasts past 25.
2. **Shrinking**, from 25 on. If the frame is above the curve (from 35), it follows it down with a time constant of 20 days (§3.11's muscle loss), moving energy from lean to fat inside the stock, at no cost.
3. **Death by old age.** A hazard rising with age, μ(*x*) = *a* e^(*bx*), with *a* = 1.47 × 10⁻⁴ a year and *b* = 0.086 a year: the senescent (Gompertz) term of the Siler model Gurven & Kaplan (2007) fitted to the average of five forager populations (Table 2; the mortality rate doubles every 8.1 years). The first tick it sees a body (formed at age *x*₀), `body.aging` draws a unit exponential *E* from a run-wide stream of its own, `AGING`, and sets the age at which the body dies of old age, *x*_d = ln(e^(*bx*₀) + *bE*/*a*) ÷ *b*: exactly a per-tick hazard of μ, with one draw per body and nothing to compute per tick but a comparison. On its own the hazard kills 0.45% of bodies before 15 and gives a modal age at death of 74.
4. **Losses after the peak**, applied where they are read, not stored: **capacity** (§3.11) × 1 to age 30, falling linearly to 0.65 at 80 and 0.5 at 100 [estimate: aerobic capacity falls about 5–10% a decade after 30, less in active people]; **strength** × 1 to 40, to 0.72 at 80 and 0.58 at 100, on top of the frame's loss [estimate: with the frame's, about 0.63 of peak strength at 80; grip strength at 80 is about 55–70% of its peak, as remembered]; **skill** (§3.11) × 1 to 50, to 0.8 at 80 and 0.6 at 100 [estimate: slower perception and less fine control]. Koster et al. (2020) estimated that an average hunter keeps 89% of peak skill until 56 and about two-thirds at 80; their skill is fitted to returns, which already include strength and endurance, so it is the target for Phase 3's foraging returns by age (2.8), not for any one of these parts.

**Forbes's rule for a body not at its adult frame.** §3.8's constant *C* = 10.4 kg was fitted in adults. A body's *C* is now 10.4 kg × its frame ÷ its adult frame (at most 1) [assumption: the split between fat and lean scales with body size]. Without it a newborn, with half a kilogram of fat, would put about 80% of any surplus into lean tissue, and a well-fed child would carry lean mass far above its frame while its fat stayed near nothing. A grown body (frame = adult frame) keeps 10.4 exactly, so §3.8's calibration stands; an old body's frame has shrunk, and its *C* with it.

**Death and the carcass** (`deathDoor`, in `metabolism.ts`). Every system that kills a body calls one door, `dies(slot, cause)`, made in its `create` with `deathDoor(sim, name)`: it counts the death by cause in `body.deaths` and by age in `body.deathAges` (one-year bins from 0 to 120), leaves a carcass, and removes the agent. The carcass is half the body's mass as meat [estimate: the share of a large mammal's live mass that is muscle, fat and organs; deer here give 55 kg] in `animals.carcass`, in the cell where the body lay, fresh and clean, mixed by weight with any meat already there (§2.14). From there the world treats it like any other carcass: predators and vultures eat it, it rots faster in warmth, its pathogen load grows, it burns in a fire (§2.13–§2.16). `body.metabolism` declares the carcass layers, so a pipeline without animals still holds the meat. Causes in `body.deaths`: starvation, dehydration, hyperthermia, hypothermia, shock, infection, lightning, and now **old age**. Predation, falls and blows will die through the same door when Phase 3 brings what deals them.

**Calibration targets, written before the first run** (`tests/unit/aging.test.ts`; Gurven & Kaplan 2007, §9):
- Old age alone kills fewer than 1% of bodies before 15, so whatever kills children in Phase 3 sets survival to 15 (the target 50–70% cannot be judged until something does). Its modal age at death is 70–78.
- Old age together with Gurven & Kaplan's age-independent hazard (0.013 a year, standing in for the illness, accidents and predation Phase 3 brings) gives a modal adult age at death (deaths after 15) in the late 60s to 70s (65–78) and a life expectancy at 15 of 33–43 more years (theirs: 37.7).
- In the body pipeline, 400 fed 70-year-olds die of old age at the rate the hazard gives (62% within 10 years, within 5 points), each leaving its carcass where it lay.
- A newborn kept fed grows within 5% of its frame curve at 2, 5, 10, 15 and 20, and reaches its adult frame within 2% by 25; it holds 8–25% body fat as it grows. A newborn fed only what it spends grows less (frame at 25 below 90% of its adult frame) and does not starve.
- A fed adult from 35 to 80 keeps its frame on the curve (lean mass at 80 within 3% of 0.82 × at 35), does not starve of it, and has a lower basal rate; its strength at 80 is 55–75% of its strength at 35, its capacity 0.6–0.75 of it, and its skill at an unchanged practice 0.75–0.9 of it (above 0.95 at 56).
- Every way to die leaves a carcass of half the body's mass in its cell; the energy and water audits pass with all of it running.

**Not in this version.** The body's own adult size as a heritable dial (2.7: `adultFrameKg` is its door); pregnancy, birth, lactation, weaning and the cost a child is to anyone (2.6); maturity as fertility (2.6); immune maturation in infancy and its decline in age (infections here strike every age alike), and thermoregulation, sweat and blood volume that differ by age except through size; senescence that depends on the body's condition or history; menopause (2.6); the hazard's split between old age and the illness and frailty Phase 3's causes will add as bodies weaken (the full Gompertz term is counted as old age now, so once acts read capacity and strength, 2.8 must check that age-rising deaths are not counted twice); bones, hide and fat of a carcass as materials (§2.15); a carcass keeping the infection that killed the body; growth's cost when its tissue was laid down by a surplus (Forbes's split charges none, as for adults); injury's and muscle's fixed 0.5 kg floor of fat, which kept a newborn from rebuilding blood or muscle (2.6 made it 1% of body mass, §3.13); a body held at the edge of its fat (fed exactly what it spends, below about 1% fat) drifts slowly toward none through the explicit step of Forbes's split, without starving, since starvation is counted by lean mass (for 2.8).

### 3.13 Reproduction, pregnancy, birth, milk and infancy (Phase 2.6)
What §3.6 became when it was built (D-046). `src/sim/body/reproduction.ts`, the system `body.reproduction`, which runs after `body.heat` and before `body.metabolism`, so what pregnancy and milk cost is charged in the same tick; the pure curves are in `lifecourse.ts`. **The clocks** (D-024, D-045): durations of the life course are compressed years (gestation 0.75 years, 36 days at the default 48-day year; the ages of fertility; the infant's digestion and walking), while everything that is daily physiology keeps real days (what pregnancy adds to the basal rate, milk made and its cost, how fast milk making answers suckling, the energy balance fertility reads). The fetus's tissue, like a child's (§3.12), has to be laid down in compressed time, so its daily cost is steep late in pregnancy (about 800 kcal a day in the last few days) while a whole pregnancy costs little next to a mother's fat (about 15,000 kcal). Lactation, a real-day cost lasting compressed years, is the large one, as in life (real pregnancy about 77,000 kcal against about 2 years of milk at 500–600 kcal a day; here about 15,000 against 60,000–80,000). Every number is an estimate unless a source is named (`RESEARCH.md`, *Reproduction*).

**Mating is a door.** `mate(sim, a, b)` is what Phase 4's acts call when two bodies have both chosen the mate act toward each other (§3.6, §5.5); nothing in 2.6 decides who mates or when. If the two bodies are of opposite sex and the female is not pregnant, she conceives with a chance per act of 0.08 [estimate: with acts every two days, a compressed cycle's chance (fecundability) of about 0.14 and a mean wait of about half a year, near the 0.15 and the seven months or so Bongaarts & Potter (1983) give for natural-fertility populations] × her age factor × her energy factor × her nourishment × his age factor. No menstrual cycle is kept: the chance per act is a cycle's average.
- **Her age** (share by age, linear between points): 0 to 15, 1 from 19 to 30, 0.86 at 35, 0.65 at 40, 0.3 at 44, 0.05 at 48, 0 from 50 [estimate: menarche at about 15–16 in foragers and a few years of anovulatory cycles; the decline after 30 is the shape of Coale & Trussell's natural-fertility schedule; menopause about 50]. **His age:** 0 to 13, 1 from 16 to 45, 0.6 at 70, 0.3 at 90 [estimate].
- **Her energy** (the metabolic-load model, Ellison; Valeggia & Ellison 2009: Toba mothers resumed ovarian function once their energy balance turned positive, whatever their suckling): her energy balance is the daily change in her tissues' energy (fat and lean; food still in the gut does not count; what she puts into a fetus or milk does), averaged over days with a time constant of 4 days (about a cycle of the compressed calendar). The factor is 1 at a balance of 0 or more, falling linearly to 0 at −150 kcal a day [estimate: between the weaker luteal function Ellison's recreational runners showed when losing about a kilogram a month, some 250 kcal a day, and the amenorrhoea of nursing mothers in negative balance]. **Nourishment** is §3.10's (0 at 1% fat, 1 at 6%).
- **Not fertile:** while pregnant, and for 0.1 years after a birth or a lost pregnancy [estimate: the first ovulation after a birth without nursing comes after about six weeks].
- At conception the fetus's sex is drawn (0.512 male), and so are whether the pregnancy will be lost and when (below). Its **adult frame** (§3.12) was, until 2.7 gave bodies genes, the mean of its parents' adult frames, the other sex's scaled by 44 ÷ 34 [placeholder]; it now comes from its own genes (§3.14).

**Pregnancy.** Each tick, at gestation share *g* (time since conception ÷ 0.75 years):
1. **The fetus** grows toward a mass of *m*(*g*) × its birth mass, with a fat share *f*(*g*). Birth mass is its lean mass at birth (the frame curve's share at age 0 × its adult frame, §3.12) ÷ (1 − 0.14). *m*(*g*), linear between: 0 at 0, 0.005 at 0.25, 0.04 at 0.4, 0.09 at 0.5, 0.19 at 0.6, 0.33 at 0.7, 0.53 at 0.8, 0.78 at 0.9, 1 at 1 [estimate: the usual fetal weights by week, 300 g at 20 weeks, 1.1 kg at 28, 2.6 kg at 36, 3.4 kg at 40]. *f*(*g*): 0 to 0.6, 0.03 at 0.7, 0.07 at 0.8, 0.11 at 0.9, 0.14 at 1 [estimate: a fetus lays down most of its fat in the last trimester; newborns are about 12–15% fat]. A newborn of a Hadza-like mother weighs 3.0 kg (girl) to 3.3 kg (boy). The fetus takes what it lacks of its curve each tick × the mother's nourishment, as energy (ρ_L × lean + ρ_F × fat, §3.8) and, when the pipeline keeps water, 0.73 kg of water per kg of lean (§3.9), both drawn from the mother. The energy comes out of her tissues by Forbes's rule (§3.8), as any deficit does. A starving mother's fetus falls behind its curve.
2. **The mother's basal rate** rises by a share of itself: 0 at conception, 0.05 at *g* = 1/3, 0.11 at 2/3, 0.24 at term [estimate: Butte & King 2005 report rises of about 5%, 11% and 24% by trimester in well-nourished women; this rise includes the fetus's own metabolism and the cost of building its tissue, so no separate cost is charged]. It is heat, written to a column `body.metabolism` charges and clears, as healing's is (§3.10).
3. **Carrying it.** The mother's mass for the cost of moving and loads (§3.8) includes 2.5 × the fetus's mass [estimate: of a gain of about 12 kg at term, about 8.5 kg is the fetus, placenta, fluid, the larger womb and blood; the fat she may gain is her own and already counted]. The added mass carries no energy or water of its own: it is a cost, not a stock.
4. **Loss.** A pregnancy is lost with a chance set at conception by the mother's age: 0.09 to 22, 0.11 at 27, 0.15 at 32, 0.25 at 37, 0.51 at 42, 0.75 from 45 [estimate: Nybo Andersen et al. 2000's recognized miscarriages by age, as remembered], at a gestation share drawn uniformly between 0.1 and 0.4. The fetus's energy and water leave (counted as an outflow of the fetus's stocks), and the mother is not fertile for 0.1 years.
5. **Birth** at *g* = 1. A fetus below 0.4 of its curve's birth mass is stillborn [estimate: below about 1.2–1.3 kg, a newborn without care rarely lives]; its tissue leaves as a loss does. Otherwise the newborn is formed with `spawnAgent` at the mother's position and `formBody` (its sex, age 0, the fetus's lean and fat, its adult frame), and takes the fetus's energy and water as its first inflows; its core starts at 37 °C. It records its mother's and father's ids (identity, for 2.7's genealogy and the analysis layer; minds never read them). **The mother bleeds** through `injure` (§3.10) when the pipeline keeps injury: a blood loss drawn log-normally with a median of 350 mL and σ = 0.45 [estimate: about one birth in five loses more than 500 mL and about 1% more than 1,000 mL; the pregnancy's larger blood volume is not modelled, so the fatal loss is §3.10's 40% of an unpregnant volume, about 1.2 L for a Hadza-like woman, and about 0.4% of births kill by bleeding]. **Lactation begins.**

**Milk.** A body that has given birth makes milk into a store (the breast) of at most 0.3 kg [estimate: storage capacity 0.1–0.6 kg, Daly et al. 1996, as remembered] at a rate *r* kg a day: *r* = the larger of 1.5 × the milk taken (removed by `nurse`) averaged over a day, and an onset of 0.3 kg a day × e^(−days since the birth ÷ 5), at most 1.5 kg a day [estimates: production follows removal, so a breast emptied often makes more and one left full makes less; it starts on its own after a birth and stops within a couple of weeks without suckling], × her nourishment. Milk is 0.67 kcal per g and 87.5% water (FAO/WHO/UNU 2004: 0.67 kcal/g; an energetic efficiency of 0.80, so 1.25 kcal of the mother's energy per kcal of milk, the rest heat). Its energy comes out of her tissues by Forbes's rule, its water out of her water. Milk is its own audited stock (kg). Once *r* has fallen below 0.01 kg a day (lactation over), milk left in the store is taken back into her body with a time constant of 2 days.

**Nursing is a door.** `nurse(sim, from, to, kg)` moves up to `kg` of milk from one body's store into another's gut (energy) and water: what Phase 3's acts call when one body suckles at another. Who nurses whom, how often, and when nursing stops (weaning) are not decided here; a body never nursed stops making milk.

**Infancy.** Two limits of a young body, pure functions of age in `lifecourse.ts`, applied where they are read:
- **Solid food.** A young body digests only a share of solid food (`ingest`, §3.8; the rest passes through and is never counted): 0 to 0.3 years, 0.5 at 1, 1 from 2 [estimate: complementary foods from about six months, most adult foods by about two years]. Milk (`nurse`) is always digested. So a newborn lives on milk or not at all.
- **Walking.** Mobility (§3.10) × 0 to 0.75 years, 0.2 at 1.25, 0.5 at 3, 0.8 at 6, 1 from 10 [estimate: first steps at about a year], read through `mobilityOf`. A newborn must be carried.
- A newborn's heat (§3.9) follows from its size: a 3 kg body has much skin for its mass and little fat, and loses heat fast in cool air unless it is held (other bodies against its skin, §3.9) or wrapped. Nothing extra is coded.

**The floor of fat for rebuilding** (§3.10, §3.11) is now 1% of body mass instead of 0.5 kg, so a newborn (about 0.4 kg of fat) can rebuild blood and muscle; for a grown body it moves by less than 0.1 kg.

**Tallies:** `body.births`: conceptions, births, stillbirths, lost pregnancies; `body.birthAges`: births by the mother's age in years.

**Calibration targets, written before the first run** (`tests/unit/reproduction.test.ts`, scripted bodies in `tests/fixtures/`):
- A well-fed Hadza-like woman mated every two days conceives within 0.15–0.8 years; a girl of 12, a woman of 52, and a woman losing 400 kcal a day do not conceive in 300 acts.
- Pregnancy, fed: the newborn's mass is within 5% of 3.0 kg (girl) or 3.3 kg (boy); the mother's extra spending over the pregnancy (basal rise and fetus) is 10,000–20,000 kcal, at most 1,300 kcal on any one day; the energy and water audits pass at every step.
- A newborn nursed on demand and kept in mild surroundings grows within 10% of its frame curve at 0.5 and 1 years. Milk taken by an exclusively nursed infant averages 0.6–1.1 kg a day between 0.1 and 0.5 years, and the mother's cost of making it 500–900 kcal a day. Unnursed, a mother's milk making stops within 20 days of the birth, and a newborn given only solid food starves.
- Interbirth interval: a Hadza-like mother on a forager's day, eating 300 kcal a day more than she spends when neither pregnant nor nursing, mated every two days, with her child nursed on demand and given solid food for a share of its needs that rises from 0 at 0.5 years to all of it at 2.5: births 2.5–4.5 years apart (§9: ~3–4). The same mother fed what she spends, milk included, has them closer than 2.5 years apart; one fed 300 kcal a day less than she spends when not nursing, further than the first.
- Births per 1,000 at the age-specific chance: no births before 15 or after 50; lost pregnancies 8–20% of conceptions in women under 30.

**What the first runs showed** (`tests/unit/reproduction.test.ts`, D-046). Every target above was met: 40 fed women mated every two days waited 0.47 years on average; a fed pregnancy cost 13,000 kcal more than an unpregnant twin, 1,016 kcal on the worst day, and gave a newborn on its curve; 300 conceptions gave 26 lost (8.7%), no stillbirths, and one mother of 274 bled to death; an infant nursed alone took 0.94 kg of milk a day between 0.1 and 0.5 years, costing its mother 800 kcal a day, and grew within 4% of its curve; unnursed, milk stopped 17 days after the birth. Interbirth intervals for eight mothers over eight years: **3.14 years** on the forager schedule (2.5–4.2; all eight alive), 1.32 when fed for all they gave, 3.68 with no surplus, when **all eight mothers starved** within eight years (each child's milk drew on their fat; nothing in their bodies stopped them conceiving again at 7% fat, since only the energy balance and §3.10's nourishment gate fertility). Two corrections to §3.9 came first (T-012): the least urine and the most sweat had been fixed adult numbers, which dried newborns out.
- **The compressed year and infancy (an open question for the owner, Q11).** A newborn's first year of growth happens in 48 real days. At the same mass, a nursed infant here needs about 1.5 times a real infant's energy (about 730 kcal a day at 4 kg against about 470; 1,020 at 7 kg against about 600), almost all of it the cost of laying down tissue, so a nursing mother's peak cost is higher than a real one's. And a newborn's fat (about 4,000 kcal) lasts longer than the 0.3 compressed years before it digests solid food: given only solid food, a newborn here outlives that window and grows to about 80% of its curve by half a year, where a real one would die. Children are thus somewhat more expensive in infancy, and less strictly dependent on milk, than in life. Both come from compressing growth (D-045), not from 2.6. Before Phase 4 (§7.3, §7.4: help to mothers is one of the things whose payoff the analysis will look for) the owner should choose whether to accept this, grow infancy on a less compressed clock, or compress the year less.

**Not in this version.** A menstrual cycle and its phase; lactation's direct (suckling) suppression of ovulation apart from its energy cost; the fat a pregnant woman lays down for lactation (here a mother stores fat only if she eats more); milk supply falling in a new pregnancy; twins; premature birth; obstructed labour, puerperal infection and eclampsia (only bleeding kills at birth), and the larger blood volume of pregnancy; a male's fertility falling in hunger; infant immune maturation and colostrum; milk's composition changing with time; who nurses, carries or feeds a child (Phase 3–4); the newborn's adult frame from genes (2.7).

### 3.14 Genetics (Phase 2.7)
What §3.7 became when it was built (D-047). `src/sim/body/genetics.ts`: the heritable dials, the door `formGenome` for founders, the two steps reproduction calls (`conceiveGenome` at conception, `bearGenome` at birth), the genealogy, and the system `body.genetics`, which runs last, after `body.aging`, and kills bodies of recessive disorders. Its draws come from a run-wide stream of its own, `GENETICS`, so adding it changed no other draw. Every number is an estimate unless a source is named (`RESEARCH.md`, *Genetics*).

**Which dials now (a decision, D-047).** The genome is built for a list of dials, and 2.7 puts on it only the body's dials, which have mechanisms to act on: **`frameScale`** (§3.7's body size) and **`basalScale`** (§3.7's basal efficiency). The mind's dials (learning rate, hiddenCauseBias, copying biases, attachment strength, co-reared mate aversion and the rest) join the list with the Phase 3–4 mechanisms that read them, each with its own alibi, and a dial that is a drive or a bias waits for the owner (`CLAUDE.md`). Adding a dial changes founders' draws after it, as any change of code does, but no draw of any other stream. `sex` stays where 2.6 draws it (a genome column, from `REPRODUCTION`).

**A dial on the genome.** Each body carries two alleles per dial, one from each parent (column `alleles`). The **expressed** value is their mean plus developmental noise (a normal draw, made once, at conception), clamped to the dial's range; it is a body column named after the dial. Neither copy dominates, so all genetic variance is additive.
- **Passing it on.** A gamete takes one of a parent's two alleles, each with chance ½, independently for each dial (dials are unlinked: they stand for genes spread over many chromosomes). Each allele passed on mutates with chance 0.01 [estimate], by a normal step whose spread is the dial's own (below), and is clamped to the dial's range. With these numbers the mutational variance is about 1% of the developmental variance a generation, the upper end of what has been measured for quantitative traits (about 0.1–1%, Lynch & Walsh, as remembered); a run lasts tens of generations, so variation comes mostly from the founders.
- **Founders** draw each allele uniformly from a founding range (`GUARDRAILS.md` T4: wide, at least as wide as the variation in living people, and centred on the dial's neutral value, never on a value chosen for an outcome).

| dial | what it does | range | neutral | founders' alleles | developmental noise (sd) | mutation step (sd) |
|---|---|---|---|---|---|---|
| `frameScale` | adult frame (§3.12) = 32 kg (female) or 41.4 kg (male) × the value: the frames of §3.8's Hadza-like adults (lean mass 34 and 44 kg) less the muscle a forager's working day keeps on them (§3.11, about 2.0 and 2.6 kg) | 0.5–1.5 | 1 | 0.75–1.25 | 0.04 | 0.05 |
| `basalScale` | the body's basal rate = the Schofield rate (§3.8) × the value | 0.7–1.3 | 1 | 0.85–1.15 | 0.04 | 0.03 |

With these, `frameScale` varies with a standard deviation of about 0.11 (adult lean mass varies by about 10–13% [estimate]) and a heritability of about 0.87; `basalScale` by about 0.073 (resting rates at the same mass, sex and age vary by about 7–8% [estimate]) with a heritability of about 0.7 (measured: about 0.4–0.5 [estimate]; the founders' range is the wider side of real variation, as T4 asks).
- **What `frameScale` does.** A fetus's adult frame is fixed at conception from its own expressed value and its sex. It sets the fetus's birth mass (§3.13) and the frame the body grows toward and ages from (§3.12). This replaces 2.6's placeholder (the mean of the parents' frames). In a pipeline without genetics, a fetus's adult frame is the value at 1 for its sex: no inheritance at all.
- **What `basalScale` does.** `body.metabolism` adds (value − 1) × the Schofield basal rate to what the body spends each tick. The body's heat (§3.9) is what it spends, so a lower rate saves food and makes less heat, which costs shivering in the cold; a higher rate does the reverse. The exertion that fitness reads (§3.11) stays in multiples of the Schofield rate, and so do the shares of the basal rate other systems read (pregnancy's rise, §3.13; fever, §3.10; the least urine, §3.9) [simplification].
- **A body formed with its own size keeps it.** Founders in Phase 3 will form their bodies from their genomes (lean mass from the expressed frame and the frame curve at their age). A scripted body in `tests/` formed with a given lean mass keeps that size; its genes only pass on, as if what it grew to had been its surroundings' doing.

**Recessive lethal loci (inbreeding depression, §7.5).** Each haplotype has 64 loci (two 32-bit words, column `loadLoci`: the mother's two words, then the father's). At each locus an allele is working (0) or broken (1). One broken copy does nothing; **two broken copies kill** the body. Loci 0–31 kill before birth: the pregnancy is lost at gestation share 0.1 + 0.8 × (*j* + ½)/32 for locus *j*, through §3.13's lost pregnancy. Loci 32–63 kill after birth, at age 10 × ((*j* − 32 + ½)/32)² years (from a few hours to 9.4 years, half before 2.4), as death by a **congenital disorder**, a new cause through §3.12's door. The earliest locus decides. [Estimates: half of recessive lethality before birth; recessive disorders that kill do so mostly in infancy and early childhood.]
- A gamete takes each locus from one of the parent's two haplotypes with chance ½, independently (unlinked loci), and gains new broken alleles at a Poisson rate of 64*u* a gamete, each at a uniformly drawn locus.
- **Founders** carry a broken allele at each locus with chance *q* = 0.017, the equilibrium of a large random-mating population in which every broken allele is a recessive lethal (*q* = √*u*), so *u* = *q*² = 2.89 × 10⁻⁴ a locus and about 0.0185 new lethal mutations a gamete. That is 1.09 **lethal equivalents a gamete**, half before birth and half after. A founder is a survivor: a draw with two broken copies at a locus that would already have killed it at its age is drawn again.
- **Why these numbers.** Children of first cousins (inbreeding coefficient *F* = 1/16) die before adulthood more often than children of unrelated parents by about 3.5% (Bittles & Black 2010, over many populations, as remembered); here the excess after birth is 1 − e^(−0.54/16) ≈ 3.3%. With *F* the chance of two broken copies at a locus is *Fq* + (1 − *F*)*q*², so the share of conceptions with two broken copies somewhere is about 1.8% for unrelated parents, 8.3% for first cousins and 25% for full siblings or a parent and child (*F* = 1/4).
- **The switch** `config.genetics.recessiveLoad` (default on) turns the load off: founders carry no broken alleles and none arise. It is §7.5's control.

**The genealogy** (`body.genealogy`, a state part): one record for every body given a genome, founders included: its id, mother's id, father's id (0 for founders), sex, birth tick, and the number of loci at which it carries two broken copies. Bodies never read it; the analysis layer does, through `readonly.ts`, and computes kinship and inbreeding coefficients from it (`src/analysis/genealogy.ts`). Records are never removed, so it outlives the dead.

**Each tick** (`body.genetics`): a live body without a genome stops the run with an error (call `formGenome` right after `formBody`), and a body that has reached the age of its recessive disorder dies of it through `deathDoor`, leaving a carcass.

**Calibration targets, written before the first run** (`tests/unit/genetics.test.ts`):
- 4,000 founders: broken alleles a haplotype 1.0–1.18 on average; expressed `frameScale` mean 0.99–1.01 and sd 0.09–0.13; `basalScale` mean 0.99–1.01 and sd 0.06–0.09.
- Passing on, over many families: each parental allele is passed on 48–52% of the time; 0.8–1.2% of alleles passed on are mutated; new lethal mutations 0.015–0.022 a gamete; the regression of a child's expressed `frameScale` on its parents' mean is 0.78–0.95.
- Conceptions with two broken copies at some locus: 1–3% for unrelated founders, 6–11% for first cousins, 20–31% for full siblings, about half of them before birth. With the switch off, none.
- In the body pipeline: a fetus with two broken copies at a locus that acts before birth is lost at that locus's share and counted as lost; a child with two broken copies at a locus that acts after birth dies of a congenital disorder at that locus's age, leaving a carcass; a newborn's adult frame is its sex's 32 or 41.4 kg × its expressed `frameScale`; a body with `basalScale` 0.9 spends 10% of its Schofield basal rate less at rest than its twin at 1 and makes less heat; the energy and water audits pass.
- The genealogy holds every founder and newborn with the right parents, and the analysis computes *F* = 0 for a child of unrelated founders, 1/4 for a child of full siblings and 1/16 for a child of first cousins.

**What the first runs showed** (`tests/unit/genetics.test.ts`, D-047). Every target above was met: 4,000 founders carried 1.095 broken alleles a haplotype, `frameScale` 0.9997 ± 0.110 and `basalScale` 0.999 ± 0.073; over 5,000 families the first copy was passed on 49.8% of the time, 1.01% of alleles passed on were mutated, 0.0175 new lethal mutations were seen a gamete (some fall where the parent already had one) and a child's `frameScale` regressed on its parents' mean with a slope of 0.875; two broken copies somewhere in 1.8% of children of unrelated founders, 8.1% of first cousins' and 23.5% of full siblings' (half of those acting before birth), none with the switch off; the genealogy gave *F* = 0, 1/16 and 1/4 exactly. In the body pipeline the pregnancy was lost at the locus's share, a newborn died of its disorder at 5.74 days as its locus says, leaving a carcass, and the audits and a snapshot held. One number was corrected after the first full test run (T-013): the frame at `frameScale` 1 had been the Hadza-like adults' whole lean mass (34 and 44 kg), which includes the muscle their working day keeps (§3.11), so children were built about 6% larger than their scripted parents and two of 2.6's eight forager mothers starved; it is now their frame, 32 and 41.4 kg, and 2.6's interbirth interval is back to 3.14 years with all eight alive.

**Not in this version.** Mind dials (Phase 3–4, above); linkage (loci and dials are unlinked); dominance and epistasis in dials; mildly deleterious alleles (every broken allele kills, so purging in small groups is faster than for real mild ones) and lethals that act in adults; sex chromosomes and anything sex-linked; mutation rates that rise with a father's age; genes that set when a body matures or ages; developmental noise that depends on the body's nourishment; a genetic part of disease resistance.

---

## 4. Minds

Small, structured learners. The *structure* of the mind is given, the way evolution gave it to us. The *content* is learned.

### 4.1 Perception
*Built in 3.2: §4.8.*
- Range depends on light, terrain, and vegetation. Night with no fire means very short range.
- Agents perceive entity *categories* (species, material type, terrain feature) and recognize *individual* agents they've met before (internal IDs, not names).
- Agents perceive what others are doing (action and target) when in range.
- No access to anything not perceived: no pathogen loads, no genealogy, no others' internal states.

### 4.2 Drives (closed list)
Homeostatic signals the agent tries to reduce. Adding to this list requires an alibi and owner approval (`GUARDRAILS.md` T3).

| Drive | Alibi |
|---|---|
| Hunger | energy balance |
| Thirst | water balance |
| Thermal discomfort | temperature regulation |
| Pain | avoid tissue damage |
| Fatigue / sleepiness | recovery |
| Fear | avoid predators and threats |
| Mating drive | reproduction (age- and energy-dependent) |
| Separation discomfort | infants who stay near caregivers survive, and caregivers who stay near infants raise them. Strength is the heritable `attachmentStrength` dial. |
| Curiosity | exploration finds resources. Information gain is rewarding, weighted by the `curiosity` dial. |

There is **no status drive, belonging drive, meaning drive, or conformity drive.**

### 4.3 Memory and world model
- **Episodic buffer:** recent events (what happened, where, when, who was present, what I did, how drives changed). Decays.
- **Semantic associations:** learned links between features (place, time of day, season, entity categories present, own recent actions, others' recent actions) and outcomes (drive changes, injuries, illness, food found). Updated by prediction error, with the `learningRate` dial.
- **Entity models:** for each entity type *and* each known individual, a model of how it responds to my actions ("when I approach X, X attacks"; "when I give to Y, Y later gives back"). The **same machinery** applies to every entity, including hidden-cause nodes (§4.4). That generality is what allows propitiation-like behavior to emerge without special code.
- **Per-individual ledger** (§5.4).

### 4.4 Hidden-cause inference
- When a **salient event** (injury, illness, death, food appearing or vanishing, lightning, drought) happens with **no perceived entity that explains it**, the agent may posit a **hidden-cause node**, with probability set by the `hiddenCauseBias` dial and the event's salience.
- If an existing hidden-cause node fits the context (similar place, time, preceding features), the agent reinforces that node instead of creating a new one.
- Hidden-cause nodes are ordinary entities in the world model. They gather associations (where and when they act, what precedes their effects), and agents model their "responses" with the same entity-model machinery (§4.3).
- **Ecological alibi:** real hidden causes exist (§2.7). Avoiding the spot where unseen harm happened before is genuinely protective.
- **Expected side effect, which is not coded:** the same machinery over-fires on lightning, drought, and random deaths. That's where superstition, and possibly gods, come from (§7.7).

### 4.5 Learning
- Action–outcome learning from own experience over contextual features. *Designed in 3.1 (§4.7): outcomes are predicted per (cue, act) and weighed by the drives of the moment, with eligibility traces for delays, rather than a temporal-difference cache of action values.*
- **Delays matter.** Associating a plant with illness hours later is hard. *(3.1: it is hard because credit over hours is hard, §4.7.7, with the trace's length a heritable dial; the earlier wording, "by design, because it makes social learning valuable", gave an outcome as the reason and is withdrawn.)*
- Learning from others (§5.6) and from signals (§6) feeds the same world model, weighted by credibility.

### 4.6 Action selection
Value of each available action = expected drive reduction over a short horizon (from the world model), minus expected energy cost and risk (weighted by `riskTolerance`). Choose by softmax with `explorationTemperature`. No scripted behavior trees for agents. *(Made concrete in §4.7.10: energy cost and risk enter through the predicted outcomes themselves.)*

### 4.7 The learning architecture (Phase 3.1) [provisional]

Written in 3.1 (2026-11-20, an [F] milestone done on Opus, D-034) before any mind code, and measured with a prototype at full size on a toy world (`bench/mind.ts`) and against what the real world and bodies now cost (`bench/budget.ts`). It makes §4.3–§4.6 concrete and changes them in three places, each said where it happens: learning is model-based (outcomes are predicted, then weighed by the drives of the moment) rather than a cache of action values (§4.7.6); fear is a prediction, not an outcome to predict (§4.7.4); energy cost and risk are not separate terms (§4.7.10). Phases 3.2–3.6 build it; numbers marked [provisional] are starting points that 3.4's tests and 3.7's checks may move, with a log entry.

**The one idea.** A mind learns *what happens when it does something to something, in some context*, as a change in each of its drives, and chooses by asking which act would leave its drives, as they are now, best off. The structure is given; every association is learned. Nothing in it names a kind of thing, a use, or a person.

#### 4.7.1 Why this shape
- **Devaluation.** A body that has just eaten should not seek food, without having to relearn anything. A cache of action values (model-free TD) learned while hungry keeps valuing food when full. Predicting *outcomes* and weighing them by the current drives (homeostatic reinforcement learning, Keramati & Gutkin 2014) gets this right for free, and it is what goal-directed behaviour in animals looks like (Dickinson's devaluation experiments). There is no habit system; §4.7.15.
- **Cheap and bounded.** Everything is a fixed-size table per agent, read a few dozen times a decision. The mind's cost does not grow with what it has learned.
- **One machinery for everything** (§4.3). Plants, animals, water, places, times of day, other individuals (Phase 4) and hidden-cause nodes (§4.4) are all *cues*, and the same table learns what follows acting on or near each. Propitiation-like behaviour (§7.7) can then appear without special code, or not.
- **Well-studied learning rules.** Rescorla–Wagner with a Kalman gain (Dayan, Kakade & Montague 2000; Gershman 2015) gives one-trial learning of novel things, blocking, latent inhibition (familiar things learn slowly), extinction and relearning, all from one rule, all measured in animals.

#### 4.7.2 The decision cycle: acts last
An agent does not choose every tick. It chooses an **act**, a primitive of §5.5 aimed at a target (or at nothing: rest, sleep, explore), and keeps doing it until it is **done** (the target is reached and used, the patch is empty, the drive it was reducing is gone, the sleep is over), **fails** (the target is gone or out of reach), is **interrupted**, or reaches a time limit. Only then does it learn from what happened and choose again. A target out of reach makes the act a walk to it first (§4.7.9).
- **Interrupts**, checked every tick at a few operations' cost: a rise in pain above a threshold this tick; a perceived cue whose learned prediction of pain is above a threshold coming within range (learned fear); a drive crossing into its top fifth. The thresholds are [provisional]. There is no innate startle to particular kinds of thing: fear of anything but pain itself is learned (T6). An innate response to looming or sudden noise would be a new mind mechanism, for the owner.
- **Sleep** is an act; a sleeping agent checks only hourly (§1.1), and on pain.
- **Why:** the budget (§4.7.12) allows a full decision every few ticks, not every tick; and acts that last are what a 10-minute tick means anyway.

#### 4.7.3 Cues: what a mind can attend to
A cue is a 32-bit id: a 4-bit kind and a 24-bit payload. A cue is a perception, never a label: the mind gets "a thing of perceived class 17", never "berry".
| Kind | Payload | Comes from |
|---|---|---|
| perceived class | plant species × visible state (bare, in leaf, bearing fruit or seed), animal species, carcass, material, water by look (flowing, standing), fire, rock shelter | perception, 3.2 |
| individual | an agent's id (ids are never reused) | recognition, 3.2; used from Phase 4 |
| place | a cell of a 400 m grid [provisional] | path integration: agents know where they are (§4.7.15) |
| light | dark, dim, bright, from the light level perceived (§2.4), not the clock | perception |
| day length | short, lengthening, long, shortening: the photoperiod a body's daily rhythm tracks | perception over days; ALIBI: seasonal food and cold exist without anyone |
| warmth | cold, mild, hot air, from the skin | interoception |
| hidden-cause node | the node's index in this agent's own list (§4.7.8) | inference, 3.5 |
| self | none: the cue of untargeted acts (rest, sleep, explore) | |

At a choice, the **context** is the place, light, day-length and warmth cues, the hidden-cause nodes active here (at most two), and up to two **salient percepts** (the nearest moving animal, agent or fire), so an attack while eating is credited to what was there, not only to what was eaten.

#### 4.7.4 Outcomes: eight drive channels
Outcomes are changes in eight channels, each 0 to 1, read from the body by interoception (3.3): **hunger, thirst, cold, heat, pain, fatigue, mating, separation** (the last two unused until Phase 4). Each is scaled so 1 is the body's limit: hunger by fat and gut toward starvation (§3.8), thirst by the water deficit toward 15% of mass (§3.9), cold and heat by core temperature's distance from its set point toward the fatal range (fever moves the set point, so a rising fever feels cold), pain by wounds, burns, broken bones, strains and infection severity (§3.10: infection is tissue damage), fatigue by Banister's fatigue (§3.11) plus sleep pressure. The mapping is 3.3's to write in full; scaling by the body's own limits keeps it physiology, not a weighting anyone chose.
- **Fear is not a channel.** It is the predicted pain of what is here and what is near (§4.2's fear drive, computed, not stored). It drives the interrupt in §4.7.2 and is counted wherever predicted pain is.
- **Curiosity is not a channel.** It is a bonus for uncertainty (§4.7.10).
- **Energy cost** is not a separate term: it shows up as the hunger, thirst and fatigue an act was followed by.

#### 4.7.5 The association table (semantic memory)
Per agent, an open-addressed hash table of **512 slots** [provisional], each holding one association:
- **Key:** (cue, act kind), 32 bits. Act kind 0 means "whatever was done": the cue alone (Pavlovian; "here, at night, I get cold").
- **Now:** the predicted change in each channel during the act (8 numbers).
- **Later:** the predicted change in each channel in the hours after it (8 numbers, §4.7.7).
- **Uncertainty** of each (a variance for "now", one for "later"); **last used** (a tick).

About 80 bytes a slot, 40 KB an agent [provisional]. **Memory limit:** at three quarters full, a new association replaces the least recently used of 8 slots sampled at random (backward-shift deletion keeps the table exact). The prototype's agents held about 160 associations after 9 toy days. To keep places from filling it, a place's associations are created only when something salient happened there (§4.7.7) or it is in place memory (§4.7.9); otherwise they are only updated if they exist.

**Storage is store columns of category `learned`,** so a new agent's table is zero-filled by the kernel, hashed and saved like any column, and the blank-slate guardrail covers it with no new code. Values are kept as 32-bit floats (rounding is exact and identical on every engine).

#### 4.7.6 Learning now: Kalman–Rescorla–Wagner
When an act ends, the outcome *o* (the change in each channel from the act's start to its end) is compared with the prediction *p* = the sum of the "now" vectors of every key involved: (target, act), (each context cue, act) for light, day length and warmth, and (each context cue, 0) for all of them; hidden-cause nodes and salient percepts take both forms. The error δ = *o* − *p* is shared by Kalman gains: key *k* moves by *g_k* δ with *g_k* = *v_k* / (Σ *v* + *R*), and its variance shrinks to *v_k*(1 − *g_k*).
- **Novel things learn fast, familiar ones slowly**: a new key starts at the prior variance and takes most of a surprise (one-trial learning); an established one barely moves (latent inhibition), and an outcome already predicted teaches nothing new (blocking).
- **Salience by role** [provisional]: a target, a salient percept or a hidden-cause node starts at prior variance *V*₀ = 0.04 (sd 0.2 channel units); context cues at *V*₀/10, so the thing acted on, not the hour, takes the credit first. The toy prototype at *V*₀/4 credited too much to context: food was hardly told from non-food after 30 days.
- **Forgetting and relearning:** variance grows back by *Q* a tick unused (*Q* = 2 × 10⁻⁵ [provisional]: half the prior in about a compressed week for a target), so an association unused for long becomes plastic again, which lets seasonal and changed things be relearned. Values are not erased: forgetting is a return of plasticity, plus replacement when the table is full.
- **`learningRate`** (§4.3), a heritable dial, multiplies *V*₀ and *Q*: plasticity. It is survival-critical (at 0 nothing is learned), so founders start at viable values with wide spread, logged as a viability choice (§0.2). *R* = 0.01 is the outcome noise the rule assumes.

#### 4.7.7 Delays: the episodic buffer and eligibility
The **episodic buffer** (§4.3) holds an agent's last **24 acts** [provisional]: when each ended, its (target, act) key and its place key, the drives at its start, and a credit vector. It serves delayed learning now, hidden-cause matching (§4.7.8), and later recall for signals (Phase 5).
- At every act's end whose error is **salient** (summed over channels above 0.08 [provisional]), every remembered act in the window adds the error, times its **eligibility** *e* = 2^(−age / `traceHalfLife`), to its credit. When the act leaves the buffer, its key's "later" vector moves toward its credit by a Kalman gain from its own "later" variance. So a consistent cause keeps the association and a bystander loses it the next time nothing follows it, and a novel food eaten before an illness is blamed more than a familiar one (latent inhibition again).
- **Delayed harm is discounted** by its eligibility: a toxin felt 3.5 hours later is learned at 30% of its strength with a 2-hour half-life, 55% with 4 hours. Delays are hard here because credit assignment over hours is hard, not because a number was set to make them hard. *(This replaces §4.5's "by design, because it makes social learning valuable", which reads as a reason chosen for an outcome. Whether social learning pays is for Phase 4 to find.)*
- **`traceHalfLife`** is a heritable dial [provisional founders' range 0.25–4 hours, log-uniform]: a faculty's parameter, not a drive or bias (D-047). A longer trace learns slower consequences and more spurious ones. In the toy, half-lives of 2 and 4 hours cut eating of a delayed toxin from 14% to 3% of hungry meals and mean pain by half or more, but foraging was worse and early deaths more frequent than at 1 hour: the trade-off evolution would weigh, with no social content. ALIBI: delayed consequences (plant toxins, §2.7) exist in a world with no one else in it.
- **What this can't learn.** In the bodies of Phase 2 a gut infection is felt about a day or more after the water (§3.10's course from severity 0.03). Traces of hours give that almost nothing; only place-and-season hidden-cause nodes (§4.7.8), and later others (Phase 4), can carry it. That is a property of the world to report, not to fix.
- **Prepared learning is not included.** Real mammals tie gut illness to what they ate over hours, far more readily than to anything else (the Garcia effect). That is a bias in the mind, so it waits for the owner (Q12, `STATUS.md`). The buffer would carry it as a second, longer kernel for ingestion acts on the illness channels, as a heritable dial; without it, the single kernel above stands. *Answered 2026-11-20 (D-056): yes, on the owner's condition that it depend on hunger (starving agents are not picky); milestone 3.6b writes its design here and builds it.*

#### 4.7.8 Hidden-cause nodes (frame for 3.5)
§4.4's "salient event with no perceived entity that explains it" becomes measurable: after the update of §4.7.6, what remains of the error (the part no involved key absorbed, because none was uncertain enough to) is the **unexplained** part. If it is salient, the agent posits a node with probability `hiddenCauseBias` × its size (at most 1), or strengthens an existing node whose signature fits.
- **Signature:** place, light, day length, and the act kinds of the last few acts in the buffer. A node is **active** when at least two of place, light and day length match now. Up to **16 nodes** an agent [provisional], weakest replaced.
- An active node is a context cue at full salience (§4.7.5): it takes credit for outcomes where it is active, gathers "now" and "later" associations with acts done while it is active, and enters every valuation there. That is the generic entity model of §4.3 applied to an unseen cause, with no other code.
- `hiddenCauseBias` could feed hoped-for outcomes (§7.7–§7.8), so founders' values are centred on its neutral value, 0, with wide spread (§0.2); 3.5 fixes the range. The Phase 3 exit check compares harm with and without it (`ROADMAP.md`).

#### 4.7.9 Place memory
Per agent, up to **64 places** [provisional]: a place cell, when it was last seen, the best value found there then, and up to 4 classes perceived there. When choosing, the three remembered places with the highest remembered value, not counting here, become "go there" candidates, valued by what their classes now predict (with the drives of now) plus the place's own Pavlovian association (§4.7.6), minus the trip. **The trip** is the agent's own learned cost of walking, from its (self, explore) association, scaled by distance. Fruit seasons are not remembered as such yet (§4.7.15).

#### 4.7.10 Choosing
**Candidates** (at most 48): each perceived thing (at most 12, nearest of each class first) with each act its physics allows (consume needs edible matter, water or meat; strike needs reach; pick up needs a loose object; approach and avoid apply to anything), the three remembered places, and rest, sleep and explore. Physics decides what can be done to a thing, never the mind's knowledge.

**Value** of a candidate: its predicted change μ in each channel is the context's Pavlovian prediction, plus the context's prediction for that act kind, plus the (target, act) "now" and "later" vectors, plus the trip. An untried act on an unknown thing therefore predicts what happens here anyway, and nothing more. Then, with *d* the drive levels now,

> V = Σ over channels of [ *d*² − clamp(*d* + μ, 0, 1)² ] − (1 − `riskTolerance`) × σ²_pain + `curiosity` × √*v*

- The first term is homeostatic reward with a quadratic drive cost: relief counts more the worse the drive, eating when full is worth nothing (the clamp), and any harm costs even when the agent feels fine (the square). The prototype first left out the Pavlovian part as "common to all acts"; under the clamp it is not, and agents drifted into exploring forever. It stays in.
- σ²_pain is the spread of pain outcomes the key has seen (a ninth number per slot, kept for pain only), so a rare large harm counts as more than its mean. `riskTolerance` is a heritable dial with neutral value 0 (variance counted exactly).
- *v* is the (target, act) uncertainty. `curiosity` (§4.2) is a heritable dial; survival-critical for blank slates (nothing is ever tried without it but by chance), so founders start viable and wide. 0.3 worked in the toy; at 1 the bonus outweighed every real outcome and agents only explored.
- **Choice:** softmax over candidates with `explorationTemperature` (a heritable dial; 0.01 in the toy), using `dmath.exp`.

#### 4.7.11 What Phases 4–5 will plug in (not built now)
- **Watching others** (§5.6): an observed act and its visible outcome (eating, being struck, falling ill) updates the observer's (target, act) association as if experienced, with gain scaled by the copying biases and the model's ledger entry. Same table, no new store.
- **Individuals** are cues, so "what happens when I approach X" is an ordinary association (§4.3's entity models). The ledger (§5.4) stays its own structure.
- **Signals** (§6.5) decode into the same updates; coined tokens bind to cues and nodes (§6.2).
None of this is built or needed in Phase 3; each waits for its own milestone and, where it is a mechanism between agents, for the owner.

#### 4.7.12 Compute budget, measured
- **What is left.** `bench/budget.ts` (2026-11-20, cloud sandbox, Xeon 2.1 GHz): with 500 kept bodies on the full map, the world systems cost about 700–735 µs a tick (1.41–1.47 µs per agent at 500 agents) and the body systems 1.40–1.43 µs per agent per tick, exposure alone 0.81–0.86 (bodies in groups of 25 crowd its 200 m grid). That leaves **about 4.1 µs** of the 6.94 µs budget (§1.7), about 3.5 after the kernel's ~0.5 (D-016).
- **What the mind costs.** `bench/mind.ts` at 500 agents, tables at full size: about **2.3–2.9 µs per agent per tick at 0.415 decisions per agent per tick**, so about 6 µs a decision including the learning when the act ends; the toy world and a random stand-in policy cost 0.6 on top and are not counted. The prototype has no σ²_pain and its dials are constants; both add a few operations a decision. A stand-in for perception (a 7 × 7 window of 100 m cells, 16 layers each) costs about 2.9 µs a perception.
- **At the toy's pace it does not fit:** about 3.6–4 µs against 3.5. Three rules make it fit, and 3.2–3.4 must keep to them and measure again:
  1. **At most about 0.25 full decisions per awake agent per tick.** Acts last (§4.7.2): eating a patch until full or empty, walking to a target, resting. The toy's acts were mostly one or two ticks. Sleeping agents (a third of the day) check hourly.
  2. **Perceive the still world once per place and hour.** Plants, stone, wood and water change on daily or slower clocks; only animals, agents and fire need a fresh look each decision, through the spatial index.
  3. **One index for neighbours.** Perception's spatial index should also serve exposure's touching bodies, which now cost 0.8 µs a body in groups (`STATUS.md`, 2.2 benchmark).
  At 0.25 decisions per awake agent-tick that is roughly 1–1.2 µs for the mind and 0.5 for perception: about half of what is left. *(3.2 measured perception at 0.6–0.9 µs per agent-tick and made exposure 0.35 µs cheaper; §4.8.)*
- **Memory.** About 42 KB an agent (table 40, buffer 1.1, places 0.8, nodes 0.2): 21 MB at 500 agents, saved and hashed with the rest (a full-map world is already about 30 MB). If that proves too much, 256 slots halve it; the prototype's agents used under 200.

#### 4.7.13 The toy check (`bench/mind.ts --learn`)
300 agents, 30 days, a toy world of 32 × 32 places with 40 classes of thing: 10 that feed, 3 kinds of water, one that hurts at once, one that feeds and hurts 3.5 hours later, 25 that do nothing; a predator in one place in 20. Shares of what agents ate when they began eating hungry (hunger ≥ 0.3), first 3 days → last 5:
| Policy | Food | Delayed toxin | Nothing | Immediate harm | Deaths, last 5 days | Mean pain |
|---|---|---|---|---|---|---|
| random stand-in | 19 → 14% | 2.2 → 1.4% | 67 → 70% | 2.1 → 1.9% | 36 | 0.28 |
| learner, no delayed credit | 29 → 42% | 4.6 → 13.9% | 55 → 34% | 1.6 → 0.3% | 14 | 0.15 |
| learner, trace 1 h | 22 → 45% | 3.2 → 8.1% | 64 → 31% | 1.3 → 0.2% | 4 | 0.14 |
| learner, trace 2 h | 18 → 32% | 2.2 → 2.9% | 70 → 50% | 0.7 → 0.3% | 9 | 0.09 |
| learner, trace 4 h | 17 → 21% | 1.7 → 3.4% | 74 → 65% | 0.9 → 0.2% | 14 | 0.05 |
This shows **the code does what this section says** on a toy, nothing about the real world: learners tell food from non-food, stop eating what hurts at once, and with traces stop eating the delayed toxin, at a cost in foraging that grows with the trace. The toy's numbers (drift rates, effects) were picked to exercise the code; three things were corrected while writing it (an agent's first act learned from a garbage "before", context salience too high, the Pavlovian part left out of value), each described above.

#### 4.7.14 Build plan
- **3.2 [O] Perception:** the cue tables of §4.7.3 from the world's layers, range by light, terrain and vegetation (§4.1), the cache of rule 2, the shared spatial index of rule 3, individual recognition (ids of agents perceived). Measure.
- **3.3 [O] Drives, acts and choice:** interoception (§4.7.4), the solo acts of §5.5 as physics written in a new `DESIGN.md` section before coding (consume — drinking is consuming water —, move, rest, sleep, pick up, drop, carry, strike, manipulate, approach, avoid), the body's door for plant toxins (§2.7: the values exist, no body reads them yet), choice (§4.7.10), and **founders**: formed from their genomes (D-047), their conditioning (`BodySpec.conditionedTo`, D-043) and where and in which season they start, each written down as a body choice, not a tune. Acts must read capacity (D-048), or minds working flat out starve as the random policy did.
- **3.3b [F] Animals and agents meet** (added in 3.3, §4.9.9): flight from agents, predators taking agents, striking animals.
- **3.4 [O] Memory** *(done: §4.10, D-053)*: the table, the learning rules, the buffer and delays, place memory; the mind's dials on the genome (`learningRate`, `traceHalfLife`, `curiosity`, `explorationTemperature`, `riskTolerance`), each with its alibi and founders' range. Tests against hand-built cases: one-trial learning, blocking, latent inhibition, extinction, a delayed effect learned and unlearned.
- **3.5 [O] Hidden-cause nodes** (§4.7.8) and `hiddenCauseBias` *(done: §4.11)*.
- **3.6 [O] Skills into acts** (§3.11's `bySkill`).
- **3.7 [F] Viability and the emergence checks:** cold deaths of naked bodies (D-041, D-048), old age counted twice (D-045), founders' survival; tuning is logged and aimed at plausibility only (T4).

#### 4.7.15 Not in this version (known limits)
- **One step of lookahead** plus the trip: no plans of several acts (no "go to the stream, then to the fruit"). Value counts the drives at an act's end, not the time spent in a state, so a pain that lasts hours counts as its peak.
- **No habit system** (model-free caching), no generalisation between classes of thing except through context-by-act associations, one shared uncertainty per association for all channels.
- **Perfect path integration** (agents always know where they are on the 400 m grid) and no fruit-season memory as such (only "last seen bearing").
- **A single exponential trace** for delays; real delays are lumps at a fixed lag, so the learned delayed effect is discounted and smeared.
- **Fear has no innate trigger but pain.**

### 4.8 Perception as built (Phase 3.2) [provisional]

Written in 3.2 (2026-11-20) before the code; makes §4.1 and §4.7.3 concrete. `src/sim/mind/cues.ts` holds the cue kinds and the class catalogue, `src/sim/mind/perception.ts` the door `perceive(slot, out)`. A look returns what one agent can see from where it stands now: a list of percepts (a cue, a distance, a place to walk to, and what it refers to: a cell, an object, an animal group, an agent or a fire) and the context cues. It writes nothing but its own cache (below), and gives nothing that is not on the surface of the world: no pathogen loads, no toxins, no genealogy, nothing underground, nobody's insides (§4.1).

**Classes** (`PERCEIVED_CLASSES`, built in catalogue order, so a class number means the same thing in every run of one version):
- each plant species in one of three looks: **bearing** (its edible part is above ground and at least 1 kg of it stands in the cell), **in leaf** (woody species between mid-spring and mid-autumn, the leaf season of §2.15's canopy; herbs and reeds while the day's mean air at the cell is at least the species' growing minimum, §2.12), or **bare**. A species counts in a cell from 2% cover. Tuber, bitter root and reed keep their food underground, so they are never seen bearing: they must be learned by digging.
- deer, aurochs, wolf, big cat (groups), hare, carcass (at least 1 kg of meat in the cell), and **a person too far away to tell who** (below).
- each material lying on the ground: loose stone of each stone material (at least 5 kg in the cell) or a stone object of it; stone with a keen edge (an object with edge ≥ 0.5: a fresh flake of flint or quartzite) as a class of its own, because an edge is visible; wood, small (at least 5 kg of fallen wood under 1.5 m, or such an object) and long (at least 20 kg of branches and trunks, or an object 1.5 m or longer); hide; litter (at least 50 kg of fine dead plant matter).
- water by look: flowing (river, spring), standing (lake); fire by look: flaming (a flaming cell, or a burning object), smouldering; rock shelter: overhang, cave.

**Range.** Each class has a range in full light on open ground [estimates]: **60 m** for things on the ground (herbs, stone, wood, litter, hides, hares, objects), **150 m** for bushes, reeds, long wood and carcasses, **400 m** for trees, water and rock shelters, **600 m** for large animals and a person's shape, **150 m** to tell who a person is, and **2 km** for fire (smoke by day, glow by night). A look multiplies them by:
- **light at the eye:** the ambient light (§2.4) times the share of sky not hidden by canopy, overhang or cave (§2.15's shelter), plus fire light at the eye. Below 0.01 of full sun it is **dark** (× 0.05: starlight, or a moonlit night under trees), below 0.07 **dim** (× 0.3: moonlight, deep twilight), otherwise **bright** (× 1). Fire's range does not shrink in the dark; a fire's own light is what lets agents near it see each other at night.
- **vegetation around the eye:** × (1 − 0.7 × min(1, tree + ½ bush + reed cover)) in the agent's own cell: about a third of the range in closed wood.
- **concealment** of an animal or a person: × (1 − 0.7 × min(1, tall cover of its cell)), with tall cover as §2.13 counts it for cats in ambush (reeds, trees, half the bushes, tall grass in late summer); × 0.5 more for an animal lying still (resting or in ambush). Ambush predators in reeds at night are therefore hard to see, as the alibi of §4.4 needs them to be.
- **terrain:** a cell, animal or person is hidden if the ground rises above the line from 1.6 m over the eye's cell to 1 m over the target's cell, sampled at the cell centres in between. Fire is not hidden by terrain.

Distances to a cell are to its nearest point, so the agent's own cell is always within reach of the eye; a still percept points at the cell's centre.

**What a look returns.** For each class, the nearest instance seen: the nearest cell holding it, the nearest lying object of it, the nearest group of each kind of animal, the nearest flaming and smouldering fire. Persons: every agent within the range for telling who, as **individual cues** (its id; ids are never reused), nearest first, at most 16; beyond that, up to the shape range, the nearest one as the class "a person too far to tell who". Nothing about how many (a group's size, kilograms in a cell) is returned: 3.3's acts find out by acting.
**Context cues:** the **place** (the 400 m grid square), **light** (dark, dim, bright, as above), **day length** (short, lengthening, long, shortening: quarters of the year centred on the solstices and equinoxes, the photoperiod a body tracks over days), and **warmth** (cold below 10 °C, mild to 25 °C, hot above, from the air at the agent's cell now, as body.exposure gives it to the skin) [provisional bands].

**Cost rules (§4.7.12).**
1. **The still world once per cell and hour.** A cell's still classes (plants and their looks, stone, wood, litter, water, carcass, hares, rock shelters) are worked out at the first look at it in each hour and kept as a 64-bit mask. Within the hour later looks reuse it, so a berry bush eaten bare or burnt at 10:05 can still look bearing at 10:50; the act finds out. Acts that change a cell call `invalidate(cell)`. Hares move, so whether one shows in a cell in an hour is a draw with chance 1 − e^(−hares in the cell), from a hash of the seed, the cell and the hour. Because the mask depends on when it was first made, the cache is **saved state** (`mind.stillView`, not learned content), so a run loaded mid-hour sees exactly what the unbroken run sees.
2. **Moving things fresh,** as they were at the first look of the tick (§1.6: the decide phase reads tick-start state): animals, agents, lying objects and fires are indexed once a tick from copies of their positions.
3. **One index type for neighbours.** Measured in 3.2: exposure's cost was not the touching-bodies query but building its grid, which cleared an array with one entry per 200 m bucket of the whole map (65,536) every tick; the shelter probe's 10 m grid for lying objects had 26 million (about 210 MB, cleared whenever objects existed). Both grid types (`core/spatial.ts`) now sort entities by bucket row and, inside a row, by x (`NeighbourGrid`) or bucket column (`BucketGrid`), and a query binary-searches each row it covers: memory and builds grow with the entities and rows, not the map, and results come in the same order as before (the state hash of runs with touching bodies, lying and held objects and a burning stick is unchanged). `NeighbourGrid` also copies positions at the build, so a query sees them as they were at the first look of the tick. Perception and exposure keep their own instances, because acts move agents between the decide phase and exposure, and a build of 500 agents costs about 10 µs.
4. **Lines of sight once per line, ever.** Terrain does not change after setup, so whether a cell within 7 cells of a viewing cell is hidden from it is worked out the first time a look needs that line and kept for the run (two bits per line; a derived cache, not saved). A cell walked through costs only the lines its looks used.

**Cost, measured** (`bench/perception.ts`, 2026-11-20, cloud sandbox, Xeon 2.3 GHz; 500 bodies in groups of 25 on the full map, awake 16 hours, a look at 0.25 per awake agent-tick, so 0.167 per agent-tick): a look costs about 1.6 µs with every cache warm (0.9 for an agent alone), and on average **3.6 µs standing still, 4.7 µs walking at 0.55 km/h** (about 9 km a day, between Hadza women's and men's daily distances) **and 5.5 µs at 2 km/h**: **0.59, 0.78 and 0.91 µs per agent per tick**, against the 0.5 §4.7.12 set aside. The rest goes to rebuilding the still view every hour, lines of sight from new cells, the once-a-tick indexes (1,500 animal groups take about 30 µs) and memory traffic. It fits because the same work made exposure cheaper: body systems went from about 1.05 to 0.70 µs per agent-tick (`bench/budget.ts`, same machine, 4 days, before and after), so about 4.5 µs per agent-tick is left for perception and minds after the kernel, and about 3.7 after perception, against the 1–1.2 the prototype mind needs at 0.25 decisions per awake agent-tick. A look returns about 22 percepts, 9 of them persons by id in a group of 25. Memory: about 20 MB on the full map (lines of sight 17, still view 3).

**Not in this version:** what others are doing and carrying (§4.1, §5.1: Phase 4); sound and smell (a predator heard in the dark would be a new faculty, for the owner); vultures (they are a count, not at places); haze, rain and fog; the eye's height on a hill beyond the line-of-sight test; stillness of persons (3.3's acts know who is resting).

### 4.9 Drives, acts and choice (Phase 3.3) [provisional]

Written in 3.3 (2026-11-20, an [O] milestone, unattended) before the code. It makes §4.7.2, §4.7.4 and §4.7.10 concrete, gives the solo acts of §5.5 their physics, adds the body state the acts and drives need, and places founders. Numbers marked [estimate] are physiology or physics remembered or reasoned, not tuned toward anything; none was set after an agent ran. Code: `src/sim/mind/interoception.ts`, `acts.ts`, `choice.ts`, `founders.ts`, `mind.ts`; `src/sim/body/gut.ts` and `sleep.ts`; a column each in `heat.ts` and `fitness.ts`.

**What 3.3's minds are.** They feel their drives, see, and choose among the acts physics allows, but they **remember nothing**: the association table, its learning and place memory are 3.4's. Choice reads predictions through one interface (`Predictor`), and 3.3's predictor has learned nothing, so every candidate is valued alike and the choice is uniform among what physics allows. That is the random-policy baseline §7.1 compares learners with, built from the same acts learners will use. Agents in 3.3 die of what they meet; that is expected and is not a viability problem until 3.4–3.7 give them memory.

#### 4.9.1 Interoception: the eight channels
Each channel is 0 to 1, with 1 at the body's limit (§4.7.4), read from body state by `drivesOf(sim, slot, out)`:
- **Hunger** = ½ × (1 − fill) + ½ × depletion. *Fill* is how full the gut is: the larger of the food energy waiting in it ÷ 6 hours of absorption (1,080 kcal at §3.8's 3 kcal a minute) and the stomach's mass ÷ its most (below). *Depletion* = 1 − fat-days ÷ 40, clamped to 0–1, where fat-days is the fat's energy ÷ the body's basal kcal a day [estimate: a lean forager carries about 40–60 days of basal need as fat]. A healthy body with an empty gut feels 0.5 and a full one 0; a starving one feels at least 0.5 whatever it just ate, and 1 with an empty gut. The two halves stand for the gut's short signal and the fat stores' long one (ghrelin and leptin, without naming them) [provisional].
- **Thirst** = water deficit ÷ (15% of body mass), §3.9's fatal deficit, clamped.
- **Cold** = the larger of (set point − core) ÷ (set point − 26 °C) and shivering as a share of its most (§3.9). **Heat** = the larger of (core − set point) ÷ (42 °C − set point) and sweat as a share of its most. The set point is 37 °C plus fever, so a rising fever feels cold. *Change from §4.7.4:* core temperature alone would leave a body shivering at its most, its core still at 37 °C, feeling nothing until it begins to die; what a body feels as cold is mostly its skin and the effort to stay warm. `body.heat` now keeps both shares (`shiverShare`, `sweatShare`) as columns.
- **Pain** = 1 − Π(1 − *p*ᵢ) over: open wounds (cm² ÷ 100), burns (share of skin burned × 5), the worse broken bone (its share of use lost), strain, infection (wound severity + gut severity), and active plant toxin (below) [estimates: what counts as the most pain of each kind].
- **Fatigue** = 1 − (1 − sleepiness)(1 − tiredness), both below.
- **Mating** and **separation**: 0 until Phase 4.

#### 4.9.2 Body state the acts and drives need
All of it is body, not mind, with an alibi that needs no one else (D-034: added without waiting, the owner told).
- **The stomach** (`body.gut`, column `stomachKg`): food mass swallowed and not yet passed on, at most **2 kg**, passing on at **0.3 kg an hour** [estimates: a meal of about a kilogram leaves the stomach in three to four hours]. Eating stops when it is full. Its energy is already in `gut` (§3.8); the stomach adds only bulk, so leafy food fills a body before it feeds it. ALIBI: a stomach holds only so much, whatever is in it.
- **Plant toxins** (`body.gut`, door `poison(sim, slot, dose, delayHours)`): the unit of dose is what Phase 1.4's catalogue gives per kg eaten raw (bitter root 1, nightshade 2), defined here: a dose's **strength** is units × 50 ÷ body mass, so one unit is one unit in a 50 kg adult. The dose waits in an hourly ring for its delay (§2.12: 4 hours for bitter root, 3 for nightshade), then is **active**, cleared with a half-life of **6 hours**. Active toxin hurts (its pain share is strength ÷ 4); at strength **2** the body **vomits**: what is in the stomach and gut is lost (an energy outflow); at strength **8** it dies (**poisoning**, a new cause of death) [estimates for fictional plants, set before any mind ran: a kilogram of nightshade makes a 50 kg body vomit three hours later, four kilograms eaten before the first is felt kill it]. Processing that removes bitter root's toxin (soaking, cooking) needs acts not yet built; all eating is raw. ALIBI: plants defend themselves with poisons, and an animal that eats them is poisoned whether or not anyone else exists.
- **Sleep pressure** (`body.sleep`, column `sleepPressure`): Borbély's process S, rising while awake toward 1 with a time constant of 18.2 hours and falling while asleep with 4.2 hours (Daan, Beersma & Borbély 1984, from memory). **Sleepiness** = S − 0.12 × *C*, with *C* = cos(2π(hour − 17)/24) the circadian process locked to the local solar hour, highest in late afternoon (two-process model amplitude, from memory). A body sleeps when its act is sleep (effort `SLEEP`). Sleep is over when sleepiness falls to **0.17** (the model's lower threshold). ALIBI: every animal with a nervous system sleeps, and a clock tied to the light lets a body that sees by day rest at night; no other body is needed.
- **Tiredness** (`body.fitness`, column `acuteLoad`): the tick's load (§3.11: load-hours above light effort) leaks away with a time constant of **4 hours** [estimate: glycogen and the muscle's own fatigue recover over hours]. Tiredness = acute load ÷ (4 load-hours × capacity), clamped to 1 [estimate]. **This is how acts read capacity (D-048):** walking speed is × mobility × (1 − ½ tiredness) and hand work (eating, cutting) × arm use × (1 − ½ tiredness), so a tired or unfit body slows, its exertion falls, and it cannot keep up the 4,500 kcal days of 2.8's random stand-in. ALIBI: muscles that have worked hard for hours must recover before working hard again.

#### 4.9.3 The solo acts
An act has a kind, a target (a percept's cue and what it refers to, §4.8, or nothing), and a goal position. Each tick an act runs for the tick's 600 seconds: **first it walks** toward its goal if it is out of reach, **then it works** for the time left. What the body did is written to §3.8's columns (effort, metres moved, seconds moving, metres climbed, load), so metabolism, heat and fitness charge for it in the same tick.

**Walking.** 1.2 m/s × mobility × (1 − ½ tiredness) [Hadza walking speed, from memory]; running (avoid only) 3 m/s × the same. A straight line; climbing counted as the rise from the tick's start to its end when positive (ups and downs within a tick are lost: a simplification). The map's edge stops a walk; **lakes cannot be entered** (a walk stops at the shore); rivers and springs are waded. A target in a cell is reached at the cell's nearest point (inside it, or at the shore of a lake); a thing is reached within 2 m. Held objects move with the body and weigh on it (`loadKg`, every tick).

| Act | Target | Work, after walking | Effort | Done | Fails |
|---|---|---|---|---|---|
| consume, plant | a cell with a plant class | eats the species' food there (§2.12's food layer, kg per cell), at *rate* × *D* ÷ (*D* + 20 kg/ha) kg an hour, *D* its density per hectare; rates by hand [estimates, after Hadza returns, from memory]: berries and nightshade 1.5, nuts 1, greens 1, grass seed 0.3, roots dug by hand (tuber, bitter root, reed) 0.5. Energy = kg × kcal per kg × raw digestibility through `ingest`; mass to the stomach; toxin through `poison` | light; moderate when digging | stomach full, fill ≥ 1, the food gone, or 2 hours | nothing eaten in its first tick of work |
| consume, carcass | a cell with carcass meat | meat at 0.2 kg an hour by hand, 2 with a keen edge held (edge ≥ 0.5) [estimates]; 1,500 kcal a kg [estimate, lean game], raw digestibility 0.9; pathogens through `exposeGut(meatDose)` | light | as above | as above |
| consume, water | a cell with water | drinks 1 kg a minute [estimate] until the deficit is made up, through `drink`; pathogens through `exposeGut(waterDose)` | still | the deficit gone | — |
| approach | anything | walks to it and stays by it, following a moving thing where it now is | (walking), then still | its hour is out | gone, or a shore in the way |
| avoid | anything | keeps at least 300 m from it: runs the first minute, walks after, stands when far enough | (running), then still | its hour is out | gone |
| explore | none | walks for 30 minutes on a heading drawn from the agent's stream | (walking) | 30 minutes, or a shore or the edge | — |
| rest | none | lies or sits | still | tiredness < 0.1, or 1 hour | — |
| sleep | none | sleeps; checks hourly, and every tick for pain | sleep | sleepiness ≤ 0.17, or 12 hours | — |
| pick up | a lying object, or a cell's loose stone or fallen wood | takes it into a hand (`takeStone`, `takeWood` make an object of the cell's stock); **two hands**, and at most 25 kg × strength held in all [estimates] | light | at once | hands full, too heavy, gone |
| drop | a held object | lays it where the body stands | — | at once | — |
| strike | a lying object, or (3.3b) a deer, aurochs, wolf or big cat, with the first held object | five blows of ½ × the striker's mass × (8 m/s)² × strength joules each, precision 0.5, through `strikeObjects`, or on an animal through `strikeAnimal` (§2.17: it may run after the first blow, or fight back) [estimates] | moderate | five blows, or the animal gone or dead | nothing held |
| manipulate | the two held objects | two pieces of wood are rubbed: attempts of 2 minutes at 40 W × strength through `rubWood`; anything else is struck together as in strike | heavy | 10 minutes | fewer than two held |

**Carry** is not an act: whatever is held is carried through every act. **Precision** is a novice's 0.5 until 3.6 wires skills in. Eating and drinking take from the world what is there when the act runs; when an act changes what lies or grows in a cell, it calls perception's `invalidate(cell)`. When a body dies, what it held drops where it lay.

#### 4.9.4 The tick
The mind system runs after the world and before the bodies (`pipeline.ts`), in two phases (§1.6):
1. **Decide**, reading tick-start state: every awake agent's drives are read (cheap). An agent chooses when it has no act, its act is done or failed or out of time, or it is **interrupted**: pain risen by more than 0.1 since the act began, or any drive crossed 0.8 since then (§4.7.2; learned fear needs 3.4's memory). A sleeper is checked once an hour, and for pain every tick. Choosing looks (§4.8) and values candidates.
2. **Act**: every agent's act runs for the tick, in an order shuffled each tick from the run's `RESOLVE` stream, so whoever eats a cell's last berries is a seeded draw, not a place in memory.

#### 4.9.5 Choosing (§4.7.10 made concrete)
**Candidates** (at most 64 [provisional]; *3.4: at most 96, from every class seen, §4.10.7*): the 12 nearest percepts, each with every act physics allows on it (consume on plants, carcasses and water; pick up on lying things; strike on a lying object, or (3.3b) on a deer, aurochs, wolf or big cat, while something is held; approach and avoid on anything); drop for each held object; manipulate when two are held; rest, sleep and explore. Persons are targets of approach and avoid only. "Go there" to remembered places waits for 3.4's place memory.

**Value** is §4.7.10's: Σ over channels [*d*² − clamp(*d* + μ, 0, 1)²] − (1 − riskTolerance) σ²_pain + curiosity × √*v*, with μ, *v* and σ²_pain from the `Predictor`, and **softmax** with explorationTemperature, through `dmath.exp`. 3.3's predictor has learned nothing: μ = 0, *v* = *V*₀ = 0.04, σ² = 0 for every key. The dials are constants until 3.4 puts them on the genome: curiosity 0.3, explorationTemperature 0.01, riskTolerance 0 (§4.7.10's toy values) [provisional].

#### 4.9.6 Founders
`config.founders` (optional; default none): **count** and **radiusM**. At tick 0, which is the spring equinox, the founders system places them:
- **Where:** a centre drawn uniformly among land cells within 300 m of flowing water (a river or a spring), from the run's `FOUNDERS` stream; each founder at a point drawn uniformly in the disc of radiusM (default 3 km) around it, redrawn if it falls in a lake or off the map. *Body choice:* a body that cannot yet know where water is dies of thirst in 2–10 days (§3.9), so founders start where water is; positions are independent, nothing joins them, and there is nothing built (T5).
- **When:** spring. *Body choice:* §3.9's naked bodies shiver hard on clear nights even at 20 °C (D-041); winter would kill founders before anything else could, and spring has the year's food ahead.
- **Bodies:** sex drawn half and half; age uniform from 18 to 35; Hadza-like lean and fat for the sex (§3.8's fixture values: men 44 kg lean, 6.9 kg fat; women 34 and 9.0); **conditioned to a forager's load** (8 load-hours a day, `BodySpec.conditionedTo`, D-043); genomes by `formGenome` (D-047). *Body choice:* bodies are what evolution and a working life gave adults; minds start blank (T5, the blank-slate guardrail).
Founders are viability choices in the sense of §0.2 and are logged in `DECISIONS.md` as such; none was tuned.

#### 4.9.7 Budget
The rule is at most about 0.25 decisions per awake agent per tick (§4.7.12). Acts last: eating lasts until full, approach and avoid an hour, explore half an hour, rest an hour, sleep hours. *(Written first with approach and avoid ending on arrival and explore after 600 m; the first measurement gave 0.66 decisions per awake agent-tick, because a random choice picks approach or avoid half the time. Approach became "go and stay by it", avoid "keep away from it", for an hour each, which is also what the words mean.)*

**Measured** (`bench/acts.ts`, 2026-11-20, cloud sandbox; 500 founders in a 5 km disc on the full map, blank minds, two days after a warm-up day, three runs): **0.223 decisions per awake agent-tick**; the mind system **2.5–3.5 µs per agent-tick** (13–18 µs a decision, its share of acts included; a look is about 6 of it); world 1.4–2.2; bodies 1.3–1.8, of which exposure 0.77–1.0, because bodies that walk defeat its caches (`bench/budget.ts` with kept bodies: 0.87 in all, same machine). In all 5.2–7.5 µs per agent-tick before the kernel's ~0.5 and before 3.4's learning, against 6.94 (§1.7): over the budget in the slowest run. 3.4 must measure again with memory and find the saving or take the fallback (fewer agents, slower generations) to the owner (D-016, D-049).

#### 4.9.8 What blank minds do
100 founders on the full map (seed 7, a 3 km disc, 40 days): every one was dead by day 25, 75 of thirst and 25 of hunger; together they ate about 1.2 million kcal (mostly tubers, bitter root and greens dug and picked at random) and drank 34 kg of water. That is the random-policy baseline §7.1 compares learners with, not a viability problem: nothing in 3.3 can learn where water is. *(3.3b, with animals and persons meeting, §2.17; 100 founders, 3 km disc, 40 days:)* seed 7: 62 of thirst, 30 of hunger, 7 killed by animals (31 strikes by a cat at a person, 8 landed, 6 of them holds; one attack by wolves, on a person lamed to a mobility under 0.5, since no founder is small), 1 of cold; seed 8: 61 of thirst, 37 of hunger, 1 killed by a cat, 1 of old age. Lone sleepers with no fire are what a cat takes most easily.

#### 4.9.9 Not in this version
- *(Done in 3.3b, §2.17: animals keep away from persons, predators take lone persons, struck animals are wounded and fight back. Candidates (§4.9.5) gain strike on an animal percept while something is held; a person in an animal's jaws this tick does not walk.)*
- No processing of food (pounding, cracking, soaking, cooking), so bitter root is always toxic and grass seed and nuts poorly digested; no water in food.
- *(Done in 3.4, §4.10: memory, "go there" candidates, the trip, the mind's dials on the genome. Candidates now come from every class seen, and pick up only with a free hand (§4.10.7). The learned fear interrupt was not built; §4.10.10.)*
- Skills do not touch acts (3.6): precision is a novice's.
- Climbing counted start-to-end per tick; rivers waded freely; no swimming; acts on persons are only approach and avoid (Phase 4).

### 4.10 Memory as built (Phase 3.4) [provisional]

Written in 3.4 (2026-11-20, an [O] milestone, unattended) before the code, and corrected in three places after the first runs of founders (T-016; each marked below). It makes §4.7.5–§4.7.10 concrete and puts the mind's dials on the genome. Code: `src/sim/mind/memory.ts` (the table, learning, the episodic buffer, place memory, and the predictor that replaces 3.3's blank one), `src/sim/mind/dials.ts` (the dials); the genome's list in `body/genetics.ts`. **Q12 was not answered, so its default (a) is built: one general kernel for delays and no prepared learning about food and illness** (§4.7.7). Nothing here names a kind of thing, a use or a person; every association starts empty (T5, the blank-slate guardrail).

#### 4.10.1 Storage
All of it is store columns of category `learned`, so a new agent's memory is zero-filled by the kernel, saved and hashed with the rest, and covered by the blank-slate guardrail with no new code (§4.7.5). Per agent:
- **The table:** 512 slots. `memKey` (u32; key = cue × 16 + act kind, never 0 because no cue kind is 0, so 0 marks an empty slot), `memNow` and `memLater` (8 × f32 each: the predicted change in each channel during an act and in the hours after it), `memVar` and `memLaterVar` (f32: their variances), `memPainVar` (f32: σ²_pain), `memUsed` (u32: the tick the slot last learned), and `memCount` (u16: slots in use). Open addressing with linear probing from a multiplicative hash of the key. About 43 KB.
- **The episodic buffer:** 24 records (`epiKey`, `epiPlace`, `epiEnd`, `epiCredit` 8 × f32) and `epiNext`, the record to be written next. About 1 KB. *(§4.7.7 also lists the drives at each act's start; nothing reads them yet, so they are not kept.)*
- **Place memory:** 64 records (`placeId`: the 400 m place + 1, 0 for none; `placeSeen`), each with up to 4 remembered things (`placeKey`: an association key; `placeCell`: the map cell where it was; `placeChannel` and `placeRelief`: the channel it relieved most and by how much). About 3 KB.

#### 4.10.2 Learning when an act ends (§4.7.6)
At a decision, after the look and before choosing, the act that just ended (done, failed, out of time or interrupted; never the agent's first, which has no "before") is learned from. The **outcome** *o* is the drive channels now minus the drives at the act's start (`actDrives`). The **keys** involved, with the context of the look just made (the act's end):
- (target, act): the act's target cue, or the self cue for rest, sleep and explore. Role: thing.
- (light, act), (day length, act), (warmth, act), and (light, 0), (day length, 0), (warmth, 0). Role: context.
- (place, 0). Role: context. *Created only if the error is salient or the place is in place memory* (§4.7.5's rule); otherwise used only if it exists.
- For each of up to two **salient percepts** (the nearest animals, persons, and fires seen): (cue, act), unless the cue is the target's, and (cue, 0). Role: thing.

Each key's effective variance is *v* = min(prior, stored + *Q* × ticks since it last learned), with prior *V*₀ × `learningRate` for things and a tenth of that for context, and *Q* = 2 × 10⁻⁵ × `learningRate` a tick; a missing key enters at its prior with zero predictions. With *p* the sum of the keys' "now" vectors, **held within what the body could show** (each channel clamped to [−*d*₀, 1 − *d*₀], *d*₀ the drive at the act's start), and δ = *o* − *p*, each key moves by *g* δ with *g* = *v* ÷ (Σ*v* + *R*), *R* = 0.01; its variance becomes *v*(1 − *g*), and its σ²_pain moves by *g*(δ_pain² − σ²_pain). σ²_pain is therefore the spread of pain outcomes around what was predicted; counting it in value (below) at `riskTolerance` 0 is exactly the expected cost of an uncertain harm under the quadratic drive cost, because E[(*d* + *X*)²] = (*d* + μ)² + σ².

*Why the hold (T-016):* a drive cannot leave 0–1, so a sated body's sip of water shows a change of 0 whatever drinking does to thirst; compared with the unheld prediction, every sated sip unlearned what thirsty drinking had taught, and founders stopped drinking. Valuation already clamps *d* + μ (§4.7.10); the error now compares like with like. The shared variance still shrinks on such a trial (one uncertainty per association, §4.7.15).

**A full table** (384 of 512 in use, three quarters): before new keys are added, the least recently learned of 8 slots, read from a start drawn by hashing the new key with the tick, is forgotten with backward-shift deletion. No random stream is drawn. Keys are looked up again after a forgetting, because forgetting moves entries.

#### 4.10.3 Delays (§4.7.7)
- When the error is **salient** (Σ|δ| > 0.08), every record in the buffer adds *e* δ to its credit, with eligibility *e* = 2^(−age ÷ `traceHalfLife`), age from the record's act's end to now; records older than 6 half-lives are skipped (*e* < 1/64). At `traceHalfLife` 0 nothing is credited.
- Then the act that just ended becomes a record: its (target, act) key, its (place, 0) key, its end tick, zero credit. If the buffer is full, the oldest record is **closed** first: its key's "later" vector moves toward its credit by *g* = *v*_later ÷ (*v*_later + *R*), and the variance shrinks to *v*_later(1 − *g*), with *v*_later regrown by *Q* like *v*; the same for its place key (created only if the credit is salient or the place is in place memory).
- So an act's delayed consequences are learned about a day later, when its record leaves the buffer (24 acts at about 0.25 decisions per awake tick).

#### 4.10.4 Place memory and "go there" (§4.7.9)
§4.7.9 remembered places and the classes seen there. As built it remembers **things that were worth acting on, where they were**:
- **Remembering:** when an act on a cell (a plant, carcass, water, stone, wood or shelter cell) ends done and its outcome was worth more than 0.01 by the value rule with the drives at its start (Σ *d*₀² − clamp(*d*₀ + *o*, 0, 1)²), its key and cell join the record of the cell's 400 m place, with the channel whose relief was worth most then and how far that channel fell; the place is marked seen now. A new place takes an empty record, or the one seen longest ago; a fifth thing in a record replaces its oldest.
- **Forgetting:** an act on a cell that fails (nothing to eat, no water) removes that key and cell from place memory. A remembered thing that has changed is therefore tried once, learned from, and forgotten.
- **Go there:** at a choice, every remembered thing not in the agent's present place is scored by what its relief would be worth to that channel's drive *now* (*d*² − max(0, *d* − relief)²), and the three with the highest score above 0 become candidates: the same act on the same cell, with the distance to the cell's centre. *(Written first as the three places with the highest worth when last used; food eaten hungry then outscored water drunk mildly thirsty, so remembered water was never offered to a thirsty body, T-016.)* They are valued exactly like a perceived thing, except that the Pavlovian association of the place there replaces the one here (μ += *P*(there) − *P*(here)). A remembered thing already among the perceived candidates is not added twice.
- **Why things rather than places:** a remembered place needs an act to go there and a second choice on arrival, and a value for the place that does not depend on the drives of now; a remembered thing is an ordinary candidate, valued by what it now predicts with the drives of now (devaluation holds), learned by the same keys when it is used, and needs no new act.

#### 4.10.5 Valuing a candidate (§4.7.10)
At each choice, once: the Pavlovian sum *P* = Σ "now" of (place, 0), (light, 0), (day length, 0), (warmth, 0) and each salient percept's (cue, 0); for each act kind that is a candidate (worked out the first time one is valued), the context's prediction for that act, Σ "now" of (light, act), (day length, act), (warmth, act) and each salient percept's (cue, act); and **the trip** per metre, the agent's own (self, explore) "now" vector, each channel floored at 0, ÷ 2,160 m (half an hour's walk at 1.2 m/s, what one explore walks). Then for a candidate (target, act) at distance *x*:
- μ = *P* + context(act) + now(target, act) + later(target, act) + trip × *x* (a salient percept that is also the target is not counted twice);
- *v* = the effective variance of (target, act), or the prior if it is not in the table; σ²_pain its σ²_pain, or 0;
- V = Σ [*d*² − clamp(*d* + μ, 0, 1)²] − (1 − `riskTolerance`) σ²_pain + `curiosity` √*v*, and the softmax at `explorationTemperature` (§4.9.5).
The trip is floored at 0 because walking is what it prices: any relief that happened during an explore (a wound healing, the sun coming up) does not grow with distance.

#### 4.10.6 The mind's dials (§4.7.14)
Five dials join the genome after the body's two (D-047's machinery: two alleles, their mean plus developmental noise at conception, a normal step at mutation, clamped to the range). Each is a faculty's parameter with its alibi in `dials.ts`; none is a drive or a bias toward anything social. Founders draw each allele uniformly from the range below, or log-uniformly where marked, so the expressed value centres on the toy's working value with a spread several times its own size (§0.2: viable and wide; logged as viability choices, not tuned).

| Dial | Range | Neutral (no effect) | Founders' alleles | Noise sd | Mutation sd |
|---|---|---|---|---|---|
| `learningRate` (× *V*₀ and *Q*) | 0–4 | 0: nothing is learned | 0.5–1.5 | 0.05 | 0.1 |
| `traceHalfLife` (hours) | 0–12 | 0: no delayed credit | 0.25–4, log-uniform | 0.05 | 0.25 |
| `curiosity` | 0–2 | 0: no bonus for the untried | 0–0.6 | 0.03 | 0.05 |
| `explorationTemperature` | 0.001–1 | 1: choice almost ignores value | 0.003–0.03, log-uniform | 0.001 | 0.002 |
| `riskTolerance` | −1–1 | 0: the spread counted exactly | −0.5–0.5 | 0.05 | 0.05 |

A pipeline without genetics gives every agent the toy's values (1, 1 hour, 0.3, 0.01, 0). `traceHalfLife` is bounded at 12 hours: past that the 24-act buffer, about a day, ends the trace first.

#### 4.10.7 Candidates (a change to §4.9.5)
**Every class seen is considered** (at most 24 percepts, persons still at most 4; at most 96 candidates), not the 12 nearest. A look holds about 13.5 classes besides persons (at most about 19); water, seen from up to 400 m, ranked 13th (median), so only one sighting in ten of water could be acted on, and 1 of 115 thirsty looks that saw water (T-016). And **pick up is offered only with a free hand**, as strike is only with something held: with both hands full it could only fail.

#### 4.10.8 Cost, measured
Learning touches at most 12 keys an act and 24 records on a salient error; valuing touches one key a candidate plus the context once per act kind; recall scores up to 256 remembered things. `bench/acts.ts` (2026-11-20, cloud sandbox, Xeon 2.1 GHz; 500 founders, 2 days after a warm-up day; interleaved with `main` twice): **the mind 7.7–8.3 µs per agent-tick against `main`'s 3.2–3.6**, 32–35 µs a decision against 16–18, at **0.260 decisions per awake agent-tick** against 0.223; world 2.3–2.8, bodies 1.9–2.1. In all about **12–13 µs per agent-tick against the 6.94 of §1.7**: a generation of 500 agents would take about 18 real minutes instead of 10. A profile puts about a third of a decision in the look (unchanged), a third in valuing (most of it the table lookups of up to 96 candidates), and a fifth in learning. Skipping softmax weights below e^−37 (under the rounding of the sum) changed no choice and no time. **It does not fit; the fallback is for the owner (Q13, `STATUS.md`)**, not a cheaper mind (D-016, D-049).

#### 4.10.9 What learners do
`bench/founders.ts`, 100 founders on the full map, a 3 km disc, 40 days, against the same runs with the blank predictor (same physics and candidates). A description of what the code does, not an emergence check: no null model, no preregistered threshold.

| | Alive at day 10 / 20 / 30 / 40 | Deaths by cause | Eaten, thousand kcal | Water, kg |
|---|---|---|---|---|
| seed 7, learners | 69 / 46 / 27 / 2 | dehydration 57, starvation 24, cold 12, animals 4, infection 1 | 3,977 | 845 |
| seed 7, blank | 96 / 56 / 1 / 0 | dehydration 48, starvation 43, animals 7, cold 2 | 1,316 | 281 |
| seed 8, learners | 82 / 43 / 24 / 12 | dehydration 55, starvation 21, animals 8, cold 2, infection 1, old age 1 | 4,312 | 731 |
| seed 8, blank | 98 / 73 / 1 / 0 | starvation 52, dehydration 45, animals 2, old age 1 | 1,371 | 177 |

- **Learners eat three times as much and drink three to four times as much, and some live until the cold of the compressed year's end**, which kills a few (no clothing, no fire yet).
- **But more learners than blank minds die in the first ten days, of thirst.** A learner settles on what it has found feeds it (digging tubers and bitter root: moderate work, which sweats water away), while a blank mind spends most of its time walking to and standing by things at random, which covers ground and costs less water. A learner that has not drunk while thirsty has nothing to tell it that water helps, and with one step of lookahead (§4.7.15) nothing values searching for what is not in sight. Three quarters of thirsty looks see no water at all. That is a property of this mind on this world, reported, not fixed: an innate pull toward water, or toward moving when a drive is high, would be a new mind mechanism (`GUARDRAILS.md` §4 (c)), for the owner.
- **Learners eat bitter root heavily** (about 2,000–2,500 kg against blank minds' 550–600; its poison makes a body vomit and hurt hours later, §4.9.2): the general kernel learns the delay weakly (§4.7.7, Q12 (a)). No one died of poisoning.

#### 4.10.10 Not in this version
- **The learned fear interrupt** (§4.7.2: a cue whose predicted pain is high coming into view mid-act). It needs a look at moving things every tick for every awake agent, and a look costs about 6 µs, which the budget cannot carry; a cheaper look at moving things alone is work for perception. Until then fear acts at choices: a predicted harm lowers the value of acts on and near what is seen. *(A designed mechanism not built: the owner is told, `GUARDRAILS.md` T11.)*
- Hidden-cause nodes (3.5): built in §4.11.
- Prepared learning about food and illness (Q12 (a), the default).
- No memory of when in the year a thing was found; "last seen" only.

### 4.11 Hidden causes as built (Phase 3.5) [provisional]

Written in 3.5 (2026-11-20, an [O] milestone, unattended) before the code. It makes §4.4 and §4.7.8 concrete. Code: `src/sim/mind/memory.ts` (nodes live beside the association table and are learned by the same rule), the dial in `src/sim/mind/dials.ts`, the genome's list in `body/genetics.ts`. A node is an ordinary cue (kind 7, §4.7.3) that the mind makes up for itself; nothing here names what a node stands for, and every agent starts with none (T5).

#### 4.11.1 What is kept
Per agent, in store columns of category `learned`: up to **16 nodes** (§4.7.8), each with
- `nodeId` (u32): the node's serial, 0 for an empty slot. Its cue is (kind 7, serial). Serials count up per agent (`nodeSerial`) and are never reused within 2²⁴ nodes, so a replaced node's associations are never read as the new node's: they are left in the table unread, and its least-recently-learned forgetting (§4.10.2) clears them first.
- its **signature**: `nodePlace` (the 400 m place), `nodeLight` (light band), `nodeDay` (day-length band) where it was posited, and `nodeActs` (u16: a bit for each act kind among the act that had just ended and the two acts before it in the episodic buffer);
- `nodeStrength` (f32: the summed size of the residuals attributed to it) and `nodeLast` (u32: the tick it was last given one).
Each episodic record also keeps `epiNodes` (2 × u32): the (node, act) keys of the nodes active when its act ended. About 0.5 KB an agent in all.

#### 4.11.2 Active nodes
A node is **active** in a look when at least two of its place, light and day length match the look's (§4.7.8). When more than two are active, the two with the highest **effective strength** are used: strength × 2^(−ticks since `nodeLast` ÷ one compressed year) [provisional]. *(A year, because day length repeats yearly: a node tied to a season meets its season again at half strength.)* Ties go to the lower slot.

#### 4.11.3 A node takes part like a thing (§4.7.8, §4.3)
- **Learning now** (§4.10.2): the two active nodes join the keys of an act's end as things, at prior *V*₀ × `learningRate`: (node, act) and (node, 0). They share the error by their Kalman gains like any other key.
- **Delays** (§4.10.3): a record's `epiNodes` keys gather its credit too; when it closes, their "later" vectors move toward the credit like the target's, if they are still held (never created anew then).
- **Valuing** (§4.10.5): the Pavlovian sum adds (node, 0) of the active nodes, and the context of an act adds (node, act). For a remembered thing elsewhere ("go there"), the nodes active **there** (its place, with the light and day length of now) replace those active here, as the place's own association already does.

#### 4.11.4 The unexplained residual
After the update of an act's end, each key has moved by *g*_k δ, so what remains of the error is **r = δ (1 − Σ*g*) = δ *R* ÷ (Σ*v* + *R*)**: the part no involved key was uncertain enough to absorb (§4.7.8). It is large when everything involved is familiar and the outcome still surprised; when a novel thing was involved it is small, because the novel thing took the surprise. Its **size** is Σ|r| over the eight channels.

#### 4.11.5 Positing and strengthening
When the size is **salient** (above 0.08, the threshold of §4.7.7) and the agent's bias *b* = max(0, `hiddenCauseBias`) is above 0, the residual is **set aside for a hidden cause** with probability *p* = min(1, *b* × size). The draw comes from the agent's own stream, and only when 0 < *p* < 1.
- **Fit:** the best-fitting node is the active one (two or more of place, light and day length matching) with the most matches, then the most act kinds in common between its `nodeActs` and the last three acts, then the highest effective strength, then the lowest slot. If one fits, it is **strengthened**: its strength grows by the size and `nodeLast` becomes now.
- **Otherwise a node is posited** with the signature of now and strength equal to the size, in an empty slot or, when all 16 are in use, in place of the one with the lowest effective strength.
- **The node then learns the residual**, unless it was one of the two that took part in the update (it has already had its share by its gain, §4.11.3): its (node, act) and (node, 0) keys, entering at prior if missing, move by Kalman–Rescorla–Wagner on the error r − (their summed prediction). A new node therefore takes most of a residual at once (both keys at *V*₀, together *g* ≈ 0.89 at `learningRate` 1).
- **At *b* ≤ 0 nothing is ever set aside**: no node is posited, no node key enters any update or valuation, and the mind is exactly the mind of 3.4. That is the ablation of the Phase 3 exit check and of §7.7–§7.8.

#### 4.11.6 The dial: `hiddenCauseBias`, a liability
`hiddenCauseBias` could feed hoped-for outcomes (§7.7–§7.8), so founders must start centred on its neutral value (D-005, §0.2). A probability has a floor at 0, and a founders' range that starts at 0 would still give almost every founder some bias. So the dial is a **liability** (Falconer's threshold model for traits that have a floor): the genome carries a value anywhere in **−4 to 4**, and the mind reads max(0, value). Founders' alleles are drawn uniformly from **−2 to 2**, so the expressed value is centred on 0 and **about half the founders never set anything aside**; the rest spread up to about 2 (a residual of size 0.25 then set aside with probability up to one half). Developmental noise sd 0.1, mutation sd 0.2. Every value at or below 0 is neutral, and mutation moves alleles up and down alike, so evolution has a real neutral side to drift into. A pipeline without genetics uses 0: a mind without a genome posits nothing.

#### 4.11.7 Tallies and doors
The mind's tally (`mind.acts`) counts nodes posited, nodes strengthened and residuals that were salient. Doors for tests and benches: `residual` (the last update's unexplained part), `infer(slot, look, act, tick)` (the step of §4.11.5 on that residual in the context of `look`, its active nodes counted as having taken part), `activeNodes`, `nodeCount`, `node` (a node's signature and strength); `push` takes the record's node keys. The analysis layer reads the node columns through `readonly.ts` (the `minds` observer: nodes held, agents with any, posited and strengthened).

#### 4.11.8 What nodes do, measured
`bench/founders.ts`, 100 founders on the full map, a 3 km disc, 40 days, with every founder's `hiddenCauseBias` set after tick 0 to 0 (the ablation) or 2, or left as the genome drew it (about half at or below 0). A description of what the code does, not the Phase 3 check: single seeds, no preregistered threshold, and animal deaths in single figures. *(Every founder's genome differs from 3.4's runs, because the genome now draws an eighth dial, so the bias-0 rows are not §4.10.9's.)*

| | Alive at day 10 / 20 / 30 / 40 | Deaths by cause | Water, kg | Mean pain, hourly | Salient residuals | Nodes posited / strengthened |
|---|---|---|---|---|---|---|
| seed 7, bias 0 | 64 / 37 / 20 / 1 | dehydration 64, starvation 13, animals 13, cold 9 | 732 | 0.142 | 5,871 | 0 / 0 |
| seed 7, genome | 60 / 32 / 17 / 1 | dehydration 62, animals 17, starvation 13, cold 7 | 624 | 0.139 | 4,792 | 119 / 88 |
| seed 7, bias 2 | 56 / 26 / 15 / 1 | dehydration 72, starvation 13, animals 8, cold 6 | 445 | 0.146 | 3,648 | 387 / 490 |
| seed 8, bias 0 | 81 / 47 / 24 / 10 | dehydration 57, starvation 25, animals 6, cold 1, old age 1 | 797 | 0.154 | 6,749 | 0 / 0 |
| seed 8, genome | 90 / 51 / 24 / 12 | dehydration 50, starvation 30, animals 5, cold 1, infection 1, old age 1 | 928 | 0.168 | 6,373 | 146 / 108 |
| seed 8, bias 2 | 83 / 40 / 17 / 8 | dehydration 64, starvation 21, animals 3, cold 2, infection 1, old age 1 | 502 | 0.135 | 4,728 | 452 / 693 |

- **With every founder at bias 2, fewer were killed by animals (8 against 13, 3 against 6) but they drank about 40% less water and more died of thirst**, so fewer were alive at day 20. Mean pain moved both ways. The genome's biases sit between.
- **Why less water, as far as a look at the nodes shows** (seed 8, day 10): a node's (node, act) key, at a thing's salience, takes up what one kind of act brings across all its targets (the tiredness of digging roots, for one), and a node is active wherever two of place, light and day length match, which is broad (§4.11.9). So a node that learned that consuming tires devalues drinking too, wherever it is active. The largest node associations seen were tiredness and hunger, not pain. That is this mechanism's cost of generalising, reported, not tuned (T4): whether nodes reduce harm where real hidden causes exist is the Phase 3 check's question (3.7), against this ablation.
- **Cost:** `bench/acts.ts` (500 founders, 2 days, interleaved with `main` twice): the mind 8.25–8.67 µs per agent-tick against 8.07–8.56, about +0.1–0.2 (few nodes exist in the first days; each active node adds two keys to an update and one lookup a candidate's act kind). Still over the budget of §1.7 (Q13).

#### 4.11.9 Known limits
- **Activity by two of three makes nodes broad.** A node posited at night in the long days is active at night in the long days everywhere, and fits every later salient residual there, so an agent's nodes divide mostly by light and season (twelve combinations) and place-specific nodes form only where light and season differ. An exact-match fit would make nodes place-specific; the design's reading (fit = active) was built, and 3.7 can revisit it with a log entry.
- **A node never stands for an act or a thing.** It is an unseen context; what follows acting while it is active is learned as (node, act) associations, which is all §4.3's entity model asks.
- **The trigger reads every channel.** Unexplained relief (food or warmth that no known key predicted) is set aside too, as §4.4's "food appearing" asks.
- Nodes are not merged, split or given up when they stop predicting anything; a node whose associations have gone to zero still takes part where it is active, and goes only when it is the weakest of sixteen.

## 5. Interaction primitives

### 5.1 Perceiving others
Agents perceive others' positions, actions, targets, visible condition (injured, carrying something, an infant), and what they're eating.

### 5.2 Familiarity and co-rearing
Agents present together during the younger one's early childhood get a **co-reared** mark in each other's ledgers. That's the *only* kin cue agents have. They can't read the genealogy.

### 5.3 Attachment
Bond strength toward each known individual grows with time in proximity, received gives, physical contact, and co-rearing, and decays with absence. Bonded others' distress and absence feed the separation drive. Harm to bonded others is aversive, which is the alibi for defending offspring.

### 5.4 Per-individual ledger
For each known individual: familiarity, bond strength, co-reared flag, net gives (received minus given, recency-weighted), harm received from them, **signal reliability** (how often their signals proved accurate), and observed foraging success. Alibi: remembering who's dangerous or helpful matters even among strangers.

### 5.5 Action primitives (closed list)
Each is a single physical act. Adding one requires an alibi, and it must not be an institution in disguise (`GUARDRAILS.md` T2).

| Primitive | Notes |
|---|---|
| move(direction, gait) | cost by gait, load, slope |
| rest / sleep | |
| pick up(object) / drop(object) | dropping at a place is how caches, offerings, and stockpiles could emerge |
| consume(object) | |
| carry | holding objects, including hides (insulation), burning sticks, infants |
| strike(target, held object?) | targets objects (fracture), animals, agents |
| manipulate(objectA, objectB) | strike or rub one object against another; physics decides the result |
| give(object, agent) | |
| take(object, from agent or ground) | succeeds unless the holder resists and wins a strength contest |
| approach(entity) / avoid(entity) | |
| touch(agent) | affiliative contact (grooming analog) |
| follow(agent) | move toward where an agent is going |
| attend(agent) | watch or listen; needed for copying and for receiving signals |
| mate(agent) | requires mutual selection |
| signal(tokens) | see §6 |

No `trade`, `marry`, `pray`, `teach`, `lead`, `punish`, `propose`, or `worship`.

### 5.6 Copying others (social learning)
- **Observational learning:** watching an agent act gives vicarious action–outcome associations and a partial skill boost.
- **Whom to copy** depends on heritable biases:
  - `successBias`: copy those observed doing well
  - `attendedModelBias`: copy those whom others are watching (a cheap proxy when success is hard to see)
  - `conformityBias`: weight behaviors many others do
- Alibi: learning edibility by trial and error can kill you. Cheap heuristics for picking whom to copy pay off even in a world without society. All three dials start centered on neutral.

---

## 6. Signals (Floor 1)

### 6.1 Pointing (deixis)
A signal can include **deictic tokens** for perceivable referents: an entity category, a specific individual, a place in view, an action primitive. If the referent is perceivable to the listener, decoding is reliable. Alibi: alarm and food calls plus gaze-following exist widely in social animals, and pointing at present things doesn't need invention.

### 6.2 Coined tokens
To refer to something **not currently perceivable** (an absent place, an absent individual, a hidden-cause node, a past event), a speaker must use a coined token from its own lexicon. If none exists for that internal node, it **coins one**: a new arbitrary ID from a huge space, bound to that node. Coining propensity is a heritable dial.

### 6.3 Listener inference
On hearing a coined token, the listener updates its own lexicon by **cross-situational association**: links between the token and (a) the deictic referents in the same message, (b) its own currently active internal nodes (what just happened, where we are, what's salient), and (c) the speaker's apparent focus. Repeated exposures sharpen the mapping. Shared vocabularies, dialects, and misunderstandings all emerge from this, or don't.

### 6.4 Why agents signal
Signaling is an action chosen by value like any other:
- **Recruiting:** the speaker's world model predicts a better outcome if others act with it (large prey, a threat).
- **Disclosure:** the heritable `disclosureTendency` dial makes emitting world-model content to attending others mildly rewarding, scaled by bond strength toward them. Alibi: information helps offspring and close kin survive. It can evolve to zero.
- **Idle-time effect (not coded):** at night, foraging value collapses (perception), so signaling becomes relatively more valuable. Near a fire, others can be perceived, so it's possible. Night talk can emerge from that combination (§7.6).

### 6.5 Belief transmission
Decoded content updates the listener's world model with a **credibility weight**: the speaker's signal reliability from the ledger, the copying biases, and how many others have said the same thing (conformity). Content includes associations ("food at [coined place]"), hidden-cause associations ("[coined hidden cause] harms near river"), and entity-response claims.

### 6.6 The swappable interface
```ts
interface SignalLayer {
  encode(speaker: AgentView, intent: SignalIntent): Message;
  decode(listener: AgentView, msg: Message, ctx: PerceptualContext): BeliefUpdate[];
}
```
Floor 1 is one implementation. Floor 2 replaces it with learned signaling and no free deixis. Nothing above this interface may depend on Floor 1 internals.

### 6.7 Known limit of Floor 1
Unordered bags of tokens can't express who did what to whom, or why. Claims like "the hidden cause favors this individual" may not be expressible, which would block the legitimation chain (§7.12). If experiments hit this wall, that is the evidence for moving to a higher floor. Don't hack around it.

---

## 7. Causal chains for hoped-for phenomena

Each chain lists the preconditions that must hold for the phenomenon to appear. The nudge protocol (`GUARDRAILS.md` §4) measures each link. None of these chains is coded as such; each link is an independent mechanism above.

### 7.1 Learned foraging
Drives → exploration → consumption outcomes (including delayed illness) → associations → foraging efficiency rises over a lifetime.

### 7.2 Socially learned foraging
§7.1, plus attend → observational learning with copying biases → offspring of skilled foragers outperform orphans; techniques spread through populations.

### 7.3 Food flow to kin and the injured
Attachment (§5.3) makes bonded others' distress aversive. Give reduces it. Co-rearing and proximity create bonds. So gives flow along bonds, which mostly track kin. Care for the injured follows the same path.

### 7.4 Pair bonds
Expensive, slow-maturing children (§3.6) + attachment + mutual gives → offspring of sustained dyads survive better → dispositions favoring sustained dyads spread. Prediction: pair-bond duration rises with child cost. Ablation: cheap children.

### 7.5 Incest avoidance (Westermarck effect)
Inbreeding depression (§3.7) + co-rearing marks (§5.2) + the `coRearedMateAversion` dial (starts centered at neutral) → selection pushes the dial up when inbreeding depression is on. **Control:** inbreeding depression off → the dial drifts. This is the first full emergence test (Phase 4).

### 7.6 Night talk
Darkness lowers foraging value. Fire light allows perception of others. Disclosure plus curiosity make signaling valuable. So the share of signals about absent referents rises at night near fires. Prediction (Wiessner's finding, tested rather than assumed): absent-referent content is concentrated in dark idle periods. Ablation: no darkness penalty.

### 7.7 Superstition and offerings
Hidden-cause inference (§4.4) on unexplained salient events → hidden-cause nodes with spurious associations → noisy action–outcome learning reinforces whatever preceded relief → superstitious action patterns. The generic entity-response model (§4.3) applied to hidden-cause nodes, plus coincidental relief after dropping food at a place → offering-like drops. Ablation: `hiddenCauseBias` = 0.

### 7.8 Shared hidden-cause beliefs (proto-religion candidate)
§7.7 + coined tokens for hidden-cause nodes (§6.2) + transmission (§6.5) + conformity → many agents' hidden-cause nodes bound to the same token with similar associations. **Strongest evidence:** the cluster persists in agents born after everyone who originated it has died. That shows cultural transmission, not repeated independent invention. Ablation: `hiddenCauseBias` = 0, or coining disabled for hidden-cause nodes.

### 7.9 Ritual candidates
§7.8 + copying of hidden-cause–associated actions + shared cues (a death, a storm, night by the fire) → synchronized, energetically costly actions with no measurable material return. If groups whose members do them have stronger bonds and more gives (costly signaling), they may outlast groups that don't.

### 7.10 Following and leadership
Recruiting signals (§6.4) → follow decisions based on the speaker's signal reliability → agents whose signals pay off accumulate followers (a centralized following network). **Crisis amplifier:** in conflicts, damage adds up and outnumbering wins, so converging quickly on one signaler pays. Prediction: centralization spikes during inter-group conflict.

### 7.11 Hierarchy that persists (the ratchet)
After a crisis, centralization decays unless something holds it. Candidate holders, each from independent mechanisms:
- **Leveling** is the default: agents harmed by a frequent attacker or taker join attacks against them (coalitions of harmed individuals). Prediction: in open landscapes, high-take individuals get attacked or abandoned.
- **Exit:** dissatisfied agents `avoid` and leave. If the map is **circumscribed** (Carneiro), exit is costly, so leveling by leaving fails.
- **Appropriable surplus:** storable, visible, synchronously harvested plants allow stockpiles at places → `take` from stockpiles → those who defend or seize stockpiles accumulate. Tubers (low visibility, not stored) don't allow this.
- Predictions: persistent hierarchy is more likely with circumscription (E3) and with storable crops (E4).

### 7.12 Legitimation (divine-right candidate)
A central signaler whose signals co-occur with tokens of widely shared hidden-cause beliefs gets followed more, controlling for signal reliability. That is, belief-based compliance is cheaper than force. **Floor risk:** Floor 1 may not be able to express this (§6.7).

### 7.13 Cultivation
Agents eat fruit near rest sites → seeds deposited (the dump-heap path) → plants grow near rest sites → place–food associations → repeated return → (maybe) learning that dropped seeds become plants. The long delay makes this hard, as it should be. Storable species feed into §7.11.

### 7.14 Inter-group conflict
Multiple founding populations in separate regions → range expansion and drought bring them into contact → competition at water and food → strikes against out-of-ledger individuals → raids as an analysis label for coordinated attacks plus takes. Nothing generates raids; they're other agents.

---

## 8. The anthropologist layer and evidence standards

### 8.1 Rules
- Lives in `src/analysis/`. Read-only snapshots. Never writes to sim state.
- The only code allowed to use social-outcome words.
- Labels are hypotheses: "candidate shared hidden-cause cluster," not "religion."
- Can read the genealogy and ground truth (pathogen loads, etc.) that agents can't.

### 8.2 Detectors (operational definitions written in full in each experiment's preregistration)

| ID | Detector | Measures |
|---|---|---|
| D1 | Give network | directed weighted gives; reciprocity; kin bias (via genealogy); inflow concentration |
| D2 | Sustained dyads | mutual proximity + mutual gives + shared offspring care; duration distribution |
| D3 | Following network | who follows whose signals; centralization; persistence outside crises |
| D4 | Asymmetric harm and take | attack and take flows; coalition attacks on high-take individuals |
| D5 | Lexicon convergence | per coined token, agreement across agents on referent; dialect clusters |
| D6 | Shared hidden-cause clusters | hidden-cause nodes across agents bound to the same token with similar associations; size; **persistence past originators' deaths** |
| D7 | Costly synchrony | repeated actions by ≥ k agents in temporal sync, with energy cost and no attributable drive reduction; linked to hidden-cause tokens |
| D8 | Offering-like drops | valuable items dropped at places linked to hidden-cause nodes |
| D9 | Night/day content | share of signals with absent referents or hidden-cause tokens, by light condition |
| D10 | Technique diffusion | spread curves and transmission chains of learned techniques |
| D11 | Place attachment and accumulation | repeated return sites, stockpiles, seed-deposit plant clusters |
| D12 | Group structure | clusters by lexicon + co-location + gives; inter-group harm rates |
| D13 | Legitimation candidate | following rate vs. hidden-cause token use by signalers, controlling for reliability |

### 8.3 Evidence standard
No phenomenon is reported as emerged without:
1. A **preregistration** in `experiments/` with detector definitions, thresholds, and predictions, written before the run.
2. A **positive control:** the detector fires on a hand-built fixture in `tests/`.
3. A **null model:** the same configuration with the enabling mechanism ablated (each chain in §7 names its ablation), plus permutation tests on network metrics.
4. **Multiple seeds** with effect sizes and spread, not one run.

---

## 9. Calibration targets (plausibility, never social outcomes)

Approximate values from the forager and physiology literature. The table was written from memory at planning; the calibration pass (2.8, 2026-11-20) read what it could at the source. **✓** marks a value read at the source (where, in `RESEARCH.md`); the rest is still from memory and must be checked before anything leans on it.

| Quantity | Target | Source | Bodies (2.8) |
|---|---|---|---|
| Adult total daily energy expenditure | ~2,600 kcal (men), ~1,900 (women) in Hadza (from memory); ✓ as PAL over BMR from Henry's (2005) equations, 2.26 ± 0.48 (men) and 1.78 ± 0.30 (women) | Pontzer et al. 2012: text ✓, Table 1 (masses, kcal) not readable | scripted day 2,541 / 1,962 kcal, PAL 1.87 / 1.76 against Henry (T-014) |
| Daily travel while foraging | ✓ 11.4 ± 2.1 km (men), 5.8 ± 1.7 km (women) in Hadza, by GPS | Pontzer et al. 2012 | scripted day 11.4 / 5.8 km |
| Activity costs | ✓ FAO/WHO/UNU (2004) activity ratios (Table 5.1), which carry the response to food (ch. 2); Pandolf's walking and load costs (from memory) | FAO/WHO/UNU 2004 | §3.8 |
| Survival to age 15 | ✓ 0.57 (0.45–0.66) in five forager populations; ✓ 0.60, the forager mean | Gurven & Kaplan 2007; Kaplan et al. 2000, Table 1 | needs Phase 3–4 (care of the young) |
| Modal adult age at death | ✓ about 72 (68–78) | Gurven & Kaplan 2007 | old age's term alone: 69 (§3.12) |
| Interbirth interval | ✓ 41.3 months (3.4 years), the forager mean; Ache 37.6, Hiwi 45.1 months | Kaplan et al. 2000, Table 1 (some rows garbled in the text read) | scripted forager mother 3.14 years (§3.13) |
| Net food production by children | ✓ "No children in any forager society produced as much as they consumed until they reached their mid- to late teens" | Kaplan et al. 2000 | needs Phase 3 (foraging) |
| Survival without water | ✓ about 10 days for an inactive adult in shade below 21 °C (70 °F); ✓ deficits of 15–25% of body mass fatal; 7–10 days of complete deprivation, death within 48 hours marching across hot desert (summary, not verbatim); the remembered table by temperature (3 days at 43 °C) still unverified | Adolph 1947, via Allen 1956 and Greenleaf 1973; Leithead & Lind 1964 via Greenleaf | 1.7–11.2 days in shade by heat; fatal at 15% (§3.9) |
| Pregnancy and milk | ✓ 321 MJ (about 77,000 kcal) for 12 kg gained, 375 / 1,200 / 1,950 kJ a day by trimester; basal rate +4.5 / 10.8 / 24.0%; fat gained 3.7 kg; milk 2.8 kJ/g (0.67 kcal/g) at 80% efficiency, 749–807 g a day exclusively nursed | Butte & King 2005; FAO/WHO/UNU 2004, ch. 7 | §3.13 |
| Pregnancy loss by age | ✓ 8.9% at 20–24, over half at 42, 74.7% at 45 or more | Nybo Andersen et al. 2000 (abstract) | §3.13 |
| Children of first cousins | ✓ about 3.5% more deaths before adulthood than children of unrelated parents (recent estimates; older ones 11%); 1.1% more infant deaths; 1.5% more stillbirths (0.7% without two outlying studies) | Bittles & Black 2010, *Early Human Development* | 3.3% more after birth (§3.14) |
| Residential group size | ~25–50 | forager ethnography (Marlowe 2005, not readable in 2.8) | Phase 3 on |

Viability tuning (keeping founders from going extinct) is allowed and logged. Social metrics are never targets.

---

## 10. Player and viewer [open]

The player's role is undecided (see `STATUS.md`). Default until decided: **observer** with time controls, map layers, an agent inspector (drives, ledger, world model, lexicon), and a "legends" view of detected events. No interventions.

If a **god mode** is ever added, player interventions must enter the sim as physical events (rain, lightning, a plant appearing) without agent-state conditioning. Then agents who attribute those events to a hidden cause are *correct*, and the experiment changes meaning. That's a design decision for the owner, not a feature to slip in.

### 10.1 The viewer page (Phase 1.9)
The game has its own page (D-012), built from `src/viewer/` and served by GitHub Pages from this repository.
- **The browser runs the real simulation** from the same code Node runs, so what the owner watches is the actual sim, not a recording. The arithmetic self-check (§1.8) runs on load and reports plainly whether this browser computes exactly what Node does.
- **The viewer only reads.** It reaches the sim through the read-only view (`src/sim/readonly.ts`) plus the stepping and creation functions. It never writes to sim state, so a run watched in the browser is the same run the same seed gives anywhere.
- **Build without installing anything:** `node scripts/build-site.ts` strips the TypeScript types with Node's built-in `module.stripTypeScriptTypes`, rewrites `.ts` imports to `.js`, and writes plain ES modules to `dist/site/`. Browsers load them directly; there is no bundler. Only files reachable from `src/viewer/main.ts` are copied.
- **Designed for a phone first:** the map fills the width, controls sit below it, and tapping a cell shows what is there.
- **The address names a world and a moment:** `#seed=7&c=0.75&v=1&t=1546` opens seed 7, hemmed in 0.75, swings 1, at tick 1546. (Addresses work on the GitHub Pages site; the claude.ai preview ignores them.)
- **Weather on the map** (Phase 1.2): a grey veil on wet days, a dark disc over an active storm, a flash for every lightning strike (the page steps one tick at a time so none is missed), and a soil-moisture layer redrawn daily.
- **No flashing.** Two switches turn off the day-and-night shading and the weather effects; the page remembers them on that device. Above 1 simulated day per second both are off regardless, because night and rain would come and go several times a second (accessibility guidelines warn against flashing more than three times a second). Asked for by the owner after watching at year speed.
- **Plants on the map** (Phase 1.4): a Plants layer colours each patch by the species covering most of it, fading to bare ground where cover is thin; a Ripe layer shows the fruit, seeds and nuts waiting to be picked, on a log scale, so the seasons pulse across the map. Both redraw daily. Tapping a cell lists its plants and the food in it, including food underground. At 1 year per second the plants cost about 0.8 s of computing per second on a desktop, so a phone may run slower than the chosen speed.
- **Hidden loads** (Phase 1.6): tapping a water cell shows its pathogen load, and a carcass shows how foul its meat is, both marked as hidden from agents.
- **Stone and wood** (Phase 1.7): a Stone layer colours each patch by its bedrock, darker where little stone lies loose, with flint (50 kg per hectare or more) in slate blue, iron sulfide (5 kg or more) in yellow, and rock shelters as dark triangles (bigger for caves). A Wood layer shows fallen wood, redrawn daily. Tapping land lists its bedrock, loose stone, fallen wood, any rock shelter in the cell, how much wind and rain the spot keeps off right now, and how much of the sky it hides (§3.9).
- **Fire on the map** (Phase 1.8): burning cells are drawn on every layer, bright yellow while flaming and dark red while smouldering, after the night shading so they glow in the dark (burning objects too, once bodies make them). A Fire layer shows the fine dead fuel lying on the land and, in charcoal fading over a year, where fire has burned; it redraws every simulated hour while something burns. The weather line gives the wind and how many patches are burning. Tapping land shows its fine fuel, the moisture of fine fuel, sticks and logs right now, how cured the plants are, how fast a fire would run there now, and when it last burned.
- **Animals on the map** (Phase 1.5): every group is a dot on every layer (brown deer, black aurochs, white wolves, orange big cats; bigger dots for bigger groups). An Animals layer shows hares as a shade and carcasses in red. Tapping a cell lists the hares, any carcass, and every group within 500 m with what it is doing. With animals, a day on the full map costs about 63 ms, so the page runs slower than chosen at 1 year per second.

---

## 11. Open design questions
Tracked in `STATUS.md`. Major ones:
- Player role (§10).
- Exact learning architecture for §4.5 (Phase 3 [F] design task).
- Whether Floor 1's bag-of-tokens is enough for §7.12, or the floor rises earlier.
- Whether minds need to be simplified for long evolutionary runs, and how to do that without breaking any causal chain.
