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
- **Herbivores** eat from the plants' forage in their cell, drink when within a cell of open water, and head for water when they haven't drunk for 18 hours, following the shortest way over land (a distance field built on the first run) and stepping sideways along lake shores. Otherwise they compare five spots within 800 m (3 km when below 70% condition: hungry animals range farther) by forage and warmth and move if one is clearly better. Deer that detect a wolf pack (300 m by day, 120 m at night) run 1.5 km away.
- **Wolves** below 70% condition hunt: they head for the nearest deer group within 3 km (an aurochs group only if the pack has four or more and no deer are near), and a chase starts when they come within 300 m. Fed wolves stay by their kill or drift back toward their anchor.
- **Big cats** below 70% condition, at night, stalk the nearest deer group within 3 km, creeping to the tallest cover within striking range (200 m) and waiting there; a deer group within 200 m of a waiting cat is struck. The strike succeeds far more often from tall cover (a quarter as often from open ground). A cat stays with its kill until the meat is gone.
- **Hares** update a quarter of the map each day with four days of change, like the plants; they breed in spring and summer, die faster when crowded, and wander to neighbouring cells. They are caught incidentally by hunting predators, in proportion to the hares nearby.
- **Condition** (0 to 1) stands for fat reserves: it falls by one day's need each day and rises with food eaten. At zero, animals start dying of hunger.

**Carcasses** are meat in a layer, `animals.carcass` (kg per cell), from kills and from every death. Predators eat from the carcass in their cell, vultures take a share of every carcass each day, and the rest rots, faster in warm weather.

**Daily**, each group breeds (in the spring window, if in fair condition) and loses animals to its daily death hazard plus hunger; each death leaves meat. Groups above their maximum split; tiny deer groups join a nearby group. Wolf packs above eight send three wolves to found a pack 10–20 km away where no other pack's anchor is within 15 km; if they find no room, they don't survive. A big cat's young likewise need a spot with no other cat within 4 km.

**Grazing and browsing (in the plants system, §2.12).** Each species carries a standing stock of leaves and stems animals can eat, refilling on real days like roots do. Grass and reeds make `plants.forage` (grass-like, kg per cell); greens, berries, nuts and tuber leaves make `plants.browse`. Aurochs and hares graze grass only; deer browse first and take at most 30% of their food as grass, as real intermediate feeders do, which keeps the two big grazers from competing head-on. No animal can eat the last quarter of a plant's forage (the base it regrows from). Grazed down below 30% of full, a patch's soft plants die back (overgrazing makes bare ground); woody plants (berry bushes, nut trees) survive being stripped.

**Seeds carried by animals (moved here from 1.4).** A herbivore group picks up the seeds of grass, greens, berries, and nuts where it grazes and drops them where it goes, by setting bits in `plants.seedRain`. When a cell's plants next update, any species whose seed arrived, and whose habitat allows it, starts a small patch there. Agents can do the same later (§7.13).

**Starting numbers** (densities per km² of *habitat*, where land counts in proportion to its forage, fully from 100 kg per hectare; T-006): deer 5 per km², aurochs 0.5, hares 30, wolves 2 per 100 km², big cats 1.5 per 100 km², placed where forage is good (predators too, since that is where their prey is), with predators spread out. A predator's range anchor drifts a fifth of the way toward each of its kills, so ranges follow the prey. Calibration sources are in `RESEARCH.md`; tested bands are deliberately wide.

**Not in this version:** disease in carcasses (1.6, since done), animals noticing agents (Phase 3), injuries to predators, snow, and fish.

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

**Shelter** (`createShelterProbe(sim).at(x, y, out)`), for bodies to read (Phase 2): the share of wind, rain, and body-heat loss kept off at a point, combining three sources as independent screens (`1 − Π(1 − share)`):
- **inside a rock shelter**: overhang 50% / 85% / 25%; cave 95% / 100% / 60%;
- **plant cover in the cell**: wind 0.7 × tree + 0.35 × bush + 0.2 × reed cover (at most 90%); rain 0.3 × tree cover while leaves are out (mid-spring to mid-autumn), 0.1 otherwise, plus 0.1 × bush; heat loss 0.25 × tree + 0.05 × bush;
- **lying objects within 3 m**: things that stand up (stone stacks to any height; wood screens up to its length, full at 1.5 m) make a standing screen of mass × material screen per kg; things that lie flat (hide) count only up to twice the standing screen, because nothing else holds them off the ground. Wind kept off is 90% × screen / (screen + 6 m²); rain, 90% × cover / (cover + 4 m²), where cover is 30% of standing wood's screen plus 95% of held-up hide; heat loss, 0.3 × wind + 0.3 × rain. Twenty 3 m poles and four hides (about 170 kg) keep off about 58% of wind and rain. A hut, if one ever appears, is just such a pile. Objects are seen as they lay at the first query of a tick (§1.6).

All protection numbers are estimates for Phase 2.2 (thermoregulation) to check against shelter physics.

**Not in this version:** bones and antlers (natural objects from carcasses and shed antlers), rubbing to grind an edge (friction heat in wood is now in fire, §2.16), trees dying back into fallen wood (the ecology review, 1.10), cutting hides from carcasses (needs bodies acting, Phase 3–4), curing hides so they last, containers, and objects carried by an agent rotting at the agent's position (Phase 3 keeps a held object's position current).

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

**Animals** (§2.13): every animal keeps away from a fire of 1 MW or more (a burning cell); predators keep away from any fire. The distance kept is 25 m × (heat ÷ 20 kW)^¼ (25 m from a 20 kW fire, about 60 m from a smouldering log pile, about 150–250 m from a flaming cell, counted from the cell's edge). An animal inside that distance moves away (runs from a big fire, walks from a small one); wolves won't chase, and cats won't strike at, prey standing inside it, and cats won't wait in cover inside it. In a flaming cell 3% of the hares die each tick, leaving meat; carcass meat loses 5% a tick and half its pathogen load (heat kills microbes, §2.14).

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
- **Plants on the map** (Phase 1.4): a Plants layer colours each patch by the species covering most of it, fading to bare ground where cover is thin; a Ripe layer shows the fruit, seeds and nuts waiting to be picked, on a log scale, so the seasons pulse across the map. Both redraw daily. Tapping a cell lists its plants and the food in it, including food underground. At 1 year per second the plants cost about 0.8 s of computing per second on a desktop, so a phone may run slower than the chosen speed.
- **Hidden loads** (Phase 1.6): tapping a water cell shows its pathogen load, and a carcass shows how foul its meat is, both marked as hidden from agents.
- **Stone and wood** (Phase 1.7): a Stone layer colours each patch by its bedrock, darker where little stone lies loose, with flint (50 kg per hectare or more) in slate blue, iron sulfide (5 kg or more) in yellow, and rock shelters as dark triangles (bigger for caves). A Wood layer shows fallen wood, redrawn daily. Tapping land lists its bedrock, loose stone, fallen wood, any rock shelter in the cell, and how much wind, rain and heat loss the spot keeps off right now.
- **Fire on the map** (Phase 1.8): burning cells are drawn on every layer, bright yellow while flaming and dark red while smouldering, after the night shading so they glow in the dark (burning objects too, once bodies make them). A Fire layer shows the fine dead fuel lying on the land and, in charcoal fading over a year, where fire has burned; it redraws every simulated hour while something burns. The weather line gives the wind and how many patches are burning. Tapping land shows its fine fuel, the moisture of fine fuel, sticks and logs right now, how cured the plants are, how fast a fire would run there now, and when it last burned.
- **Animals on the map** (Phase 1.5): every group is a dot on every layer (brown deer, black aurochs, white wolves, orange big cats; bigger dots for bigger groups). An Animals layer shows hares as a shade and carcasses in red. Tapping a cell lists the hares, any carcass, and every group within 500 m with what it is doing. With animals, a day on the full map costs about 63 ms, so the page runs slower than chosen at 1 year per second.

---

## 11. Open design questions
Tracked in `STATUS.md`. Major ones:
- Player role (§10).
- Exact learning architecture for §4.5 (Phase 3 [F] design task).
- Whether Floor 1's bag-of-tokens is enough for §7.12, or the floor rises earlier.
- Whether minds need to be simplified for long evolutionary runs, and how to do that without breaking any causal chain.
