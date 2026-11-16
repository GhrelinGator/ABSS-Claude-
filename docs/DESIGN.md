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
- **World setup happens before tick 0** (added in Phase 1.1). A system may have an `init(sim)` step that builds what exists before anything happens, such as the landscape. It runs once, in pipeline order, when a sim is created fresh, and never when a sim is loaded from a snapshot, because the snapshot already holds the result. Setup draws only from the `WORLD_GEN` stream or from hashes of the seed, and must not spawn agents.
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
- Fire light gets added in Phase 1.8, per cell.

### 2.5 Plants
Each species has attributes:
- calories and nutrients per unit, seasonality, growth and regrowth rates
- **toxicity**, sometimes with a *delayed* effect (illness hours later, which makes cause hard to learn)
- **processing requirements**: some species are only safe or calorie-rich after pounding, soaking, or cooking
- seed dispersal (including seeds passing through or discarded by animals and agents)
- **storability** (decay rate once harvested), **harvest synchrony** (ripens all at once or trickles), **visibility** (above ground vs. underground). These three matter for the appropriability hypothesis (§7.11, E4).

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

**Layers**, one value per cell: `terrain.elevation` (f32, m), `terrain.rainfall` (f32), `terrain.soil` (u8: 0 rock, 1 thin, 2 loam, 3 alluvium, 4 sand), `water.kind` (u8: 0 dry, 1 spring, 2 river, 3 lake), `water.depth` (f32, m), `water.drain` (i32), `water.flow` (f32, km²). Slope is computed by whoever needs it, from elevation; it is not stored. Rivers are flowing water and lakes are standing water, the distinction §2.2 needs for pathogens.

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
- A storm starts at a random time between 12:00 and 20:00 and lasts 1 to 3 hours. It covers a disc of radius 4–12 km centred anywhere on the map (centre and radius drawn from the stream), and adds 5–25 mm of rain inside the disc that day, times each cell's mean rainfall, so storms drop less on dry land.
- While a storm is active, cloud-to-ground strikes arrive at a Poisson rate of about 12 per 10-minute tick (roughly one a minute, a moderate thunderstorm). Each hits a uniformly random cell inside the disc.
- The cells struck during the current tick are stored, so later systems can read them: fire ignition (Phase 1.8) and injuries (Phase 2). From an agent's point of view a strike has no visible cause (§4.4).

**Soil moisture** (`water.soilMoisture`, a fraction from 0 to 1 of what the ground can hold), a bucket updated once a day for every cell:
- Holding capacity by soil: rock 15 mm, thin 50 mm, loam 120 mm, alluvium 160 mm, sand 60 mm.
- Water in: that day's rain on the cell (including any storm). Whatever overflows the bucket runs off and is not tracked.
- Water out: potential evaporation, 0.2 mm × (daily mean temperature + 3 °C), never negative and at most 7 mm per day, scaled by how full the bucket is.
- River, lake, and spring cells stay at 1.
- At setup, each cell starts at 60% of its mean rainfall factor, capped at 1; the first weeks of a run settle it toward its own climate.
- This is the "dryness" plants (1.4) and fire (1.8) will read. Long-term river flow (§2.10) is static for now; rivers that shrink in droughts are a known gap.

**What gets stored** (all part of the state hash and snapshots): the four anomalies, today's wet flag and rain factor, the active storm (centre, radius, end tick, extra rain), the strikes of the current tick, a count of all strikes so far, and the soil moisture layer. Temperature is computed, not stored.

---

## 3. Bodies

### 3.1 Metabolism
- Basal rate from body mass, sex, and age, using a standard equation (Schofield or Mifflin–St Jeor) [provisional].
- **Activity cost per action**, scaled by body mass, carried load, terrain slope, and gait, using MET-style multipliers (Compendium of Physical Activities). It doesn't have to be exact; it has to be consistent, so efficiency is something agents can learn.
- **Muscle is expensive:** more muscle raises strength *and* basal cost.
- Energy is stored as fat (with an upper limit) and used when intake falls short. Starvation follows depletion.
- The energy audit test (`GUARDRAILS.md` §1) checks every calorie is accounted for.

### 3.2 Hydration and temperature
Water loss scales with heat, activity, and illness. Dehydration kills faster than starvation. Heat and cold change metabolic cost; shelter, fire, hides, and huddling near others reduce exposure.

### 3.3 Injury and healing
- Types: lacerations (bleeding, infection risk from pathogens), fractures (reduced mobility for a long time), strains (from overexertion), bites.
- Healing takes time and calories. Immobile agents can't forage, so whether anyone brings them food matters (§7.3).
- Infection risk depends on pathogen exposure (§2.7).

### 3.4 Fitness, fatigue, and skill
- **Fitness–fatigue model** (Banister): exertion adds to a slow-rising, slow-decaying *fitness* and a fast-rising, fast-decaying *fatigue*. Performance = base + fitness − fatigue.
- **Injury risk** rises when short-term load outruns long-term load (the acute-to-chronic workload idea from sports science) and when fatigue is high. Muscle tears from overexertion fall out of this.
- **Skills** (per action × object category) improve with practice on a power-law curve, raise success rate and energy efficiency, and decay slowly with disuse. Watching a skilled agent gives a partial boost (§5.6).

### 3.5 Aging and death
Growth, maturity, senescence (rising hazard with age), and death from starvation, dehydration, exposure, predation, injury, infection, illness, old age, or violence. Death leaves a carcass (food for scavengers, pathogen source).

### 3.6 Reproduction
- Two sexes. Mating requires **both** agents to select the mate action toward each other.
- Conception probability depends on energy balance (fertility drops in energy deficit) and age.
- **Gestation and lactation** carry real energy costs. Infants are fully dependent: they must be carried and fed. Children can forage partially and learn, but don't produce net calories until late in development (calibrated in §9).
- Expensive, slow-maturing children are the ecological reason pair bonds might pay (§7.4). Nothing in the code makes them happen.

### 3.7 Genetics
- Each heritable dial has two alleles. The expressed value is their mean plus developmental noise. Recombination happens per dial, with Gaussian mutation.
- Separately, a set of **recessive deleterious loci** causes inbreeding depression when two copies match (§7.5).
- The genealogy is tracked for genetics and for the analysis layer. **Agents can't read it.**
- Dial list (each with an alibi at its definition in code): body size, basal efficiency, hiddenCauseBias, learning rate, exploration temperature, risk tolerance, curiosity weight, attachment strength, separation sensitivity, disclosure tendency, copying biases (success, attended-model, conformity), aggression threshold, co-reared mate aversion, signal coining propensity.

---

## 4. Minds

Small, structured learners. The *structure* of the mind is given, the way evolution gave it to us. The *content* is learned.

### 4.1 Perception
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
- Action–outcome learning from own experience (temporal-difference style over contextual features) [provisional; architecture to be designed in Phase 3 as an [F] task].
- **Delays matter.** Associating a plant with illness hours later is hard, by design, because it makes social learning valuable.
- Learning from others (§5.6) and from signals (§6) feeds the same world model, weighted by credibility.

### 4.6 Action selection
Value of each available action = expected drive reduction over a short horizon (from the world model), minus expected energy cost and risk (weighted by `riskTolerance`). Choose by softmax with `explorationTemperature`. No scripted behavior trees for agents.

---

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

Approximate values from the forager literature. **Verify each against its source before implementing**, since these were written from memory (see `RESEARCH.md`).

| Quantity | Target (approximate) | Source to verify |
|---|---|---|
| Adult total daily energy expenditure | ~2,600 kcal (men), ~1,900 kcal (women) in Hadza | Pontzer et al. 2012 |
| Daily travel while foraging | ~11 km (men), ~6 km (women) in Hadza | Pontzer et al. 2012 |
| Activity costs | MET values (walking ~3–3.5, running ~8–10, load carriage higher) | Compendium of Physical Activities |
| Survival to age 15 | roughly 50–70% | Gurven & Kaplan 2007 |
| Modal adult age at death | late 60s to 70s | Gurven & Kaplan 2007 |
| Interbirth interval | ~3–4 years | forager demography literature |
| Net food production by children | negative until late adolescence | Kaplan et al. 2000 |
| Survival without water | ~3 days in heat | physiology references |
| Residential group size | ~25–50 | forager ethnography |

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

---

## 11. Open design questions
Tracked in `STATUS.md`. Major ones:
- Player role (§10).
- Exact learning architecture for §4.5 (Phase 3 [F] design task).
- Whether Floor 1's bag-of-tokens is enough for §7.12, or the floor rises earlier.
- Whether minds need to be simplified for long evolutionary runs, and how to do that without breaking any causal chain.
