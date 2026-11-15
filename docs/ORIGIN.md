# Origin

The owner wrote this essay in his sophomore year of high school while imagining the game. It's the project's founding vision. Below it is a map from each claim to where the design tests it. **The plan treats the essay's claims as hypotheses to test, not assumptions to build in.**

## The essay (verbatim)

> I pre-suppose religion as the ultimate hierarchy that forms after people have enough time to "ponder", which would probably be in the evening in hunter-gatherer societies, but would still continue to evolve and change based on people's conditions.
>
> Society forms through biological connection (love) and materially under internal pressure that mainly include caloric surplus requirements but also form from conditions like water supply and resources (house making material, tools, etc). External pressures like invaders can also encourage people to band together. External pressures are used to improve cohesiveness when a political system is already instilled. Religion also influences this. For example, an agrarian society experiences a hardship and require a leader, likely due to raiders and the need to rebuild. After the problem is gone, there is no need for a political system anymore, so a leader must use some justification as to their rule. This leads to Divine Right or threat of reoccurrence, or both. When political strength is guaranteed, abstract ideas, such as conquering other territory for possible better material conditions, are used by the government. This leads to the idea that a political system is larger than one's own life, that they should sacrifice themselves for the greater good of a society. For a social simulation to truly bring rise to society, one must create a system in which food, water, shelter, and, in scenarios where AI are used rather than humans, platonic/romantic bonds. Mere existence must result in caloric drainage, with an emphasis on movement. A calculation that quantifies the calories used in each movement is needed, even if not exact to humanity. Furthermore, the risk of injury, primarily due to overexertion and violence (including, but not limited to animals attacking, accidentally cutting yourself). However, the inclusion of such tedious systems to avoid damage will inevitably lead to development issues of gameplay issues. Therefore, a skill system in which "practice makes perfect" should exist, with room for flexibility, like learning from books and whatnot. This will be alongside the risk of injury, such as muscle growth but also muscle tears being risks. If the conditions of life are harsh, and can mimic the reasons why humanity evolved to have certain traits (like the necessity to socialize), then the social simulation will almost certainly result in society.

## Later instructions from the owner (2026-11-15)

- Everything should be emergent, not pre-coded.
- Ideally language would be emergent too. Starting at a lower floor (`DESIGN.md` §0.4) is a practical choice, not the goal.
- Claude should plan around its own temptations to pre-code outcomes (`GUARDRAILS.md`).

## Claims → design

| Essay claim | Where it lives |
|---|---|
| Religion forms when people have time to "ponder," likely in the evening | Night talk §7.6, hidden-cause chain §7.7–7.8, experiment **E2**. Wiessner's firelight study supports the evening part. |
| Religion is the "ultimate hierarchy" | Tested, not assumed. **E5** asks whether shared beliefs come before or after persistent hierarchy. |
| Society forms through biological connection (love) | Attachment §5.3, pair bonds §7.4, kin flow §7.3 |
| Material pressure: calories, water, building materials, tools | Bodies §3, world §2, materials §2.8. Tools must emerge (§0.3). |
| External pressure (invaders) makes people band together | Other agent populations only, never scripted raids (`GUARDRAILS.md` T8). §7.10, §7.14, **E6** |
| A crisis creates a leader; afterward the leader needs a justification | Ratchet §7.11, legitimation §7.12, **E3/E4/E6**. Real societies did dissolve crisis leaders seasonally, so persistence is the question. |
| Divine right or threat of recurrence | Divine right: §7.12 / D13. Threat of recurrence: following persists while learned threat expectations stay high (§7.10). |
| Conquest for better material conditions; self-sacrifice for the system | Beyond Floor 1. Parked until a higher floor (`STATUS.md` ideas). |
| Food, water, shelter, bonds are required | §2, §3, §5 |
| Movement burns calories; per-movement cost | §3.1 (MET-style per-action costs) |
| Injury from overexertion and violence | §3.3, §3.4 (fitness–fatigue, acute-vs-chronic load) |
| Tedium is a gameplay problem | Agents manage their own bodies; the player doesn't (§10). |
| Practice makes perfect; learning from others | Skills §3.4, observational learning §5.6 |
| Learning from books | Requires writing to emerge. Far future; parked. |
| Muscle growth and tears | §3.4, with muscle's metabolic cost in §3.1 |
| Harsh conditions → society, almost certainly | Refined: harshness alone can produce conflict. Cooperation needs routes to evolve through (kin, reciprocity, reputation, spatial structure, group competition), and **variability** may matter more than harshness. **E1** tests it. |
