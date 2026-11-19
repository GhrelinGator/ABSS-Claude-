# Research references

Grouped by the part of the design they inform. **✓** means checked against a source during planning (2026-11-15). Everything else was written from memory. **Verify a reference before relying on its specifics**, especially any number used in `DESIGN.md` §9.

## Prior art: simulations and agents

- Epstein & Axtell (1996), *Growing Artificial Societies: Social Science from the Bottom Up* (Sugarscape). The classic bottom-up model.
- Axelrod (1997), "The dissemination of culture," *Journal of Conflict Resolution*. Local convergence with global polarization.
- Yaeger (1994), Polyworld. Evolved neural-net agents in an ecology.
- Leibo et al. (2017), "Multi-agent reinforcement learning in sequential social dilemmas."
- Baker et al. (2019), "Emergent tool use from multi-agent autocurricula" (OpenAI hide-and-seek).
- Park et al. (2023), "Generative Agents: Interactive simulacra of human behavior" (Smallville). LLM agents.
- ✓ Altera.AL (2024), "Project Sid: Many-agent simulations toward AI civilization," arXiv:2411.00114. Up to 1,000 LLM agents in Minecraft; tax voting; a religion that was set up by the researchers and spread. **The anti-example for this project** (D-002).
- Dwarf Fortress (Legends mode), RimWorld (storyteller). Game references: the first for history-as-gameplay, the second for what *not* to do (scripted drama).

## Cooperation and its evolution

- Hamilton (1964), kin selection.
- Trivers (1971), "The evolution of reciprocal altruism."
- Nowak (2006), "Five rules for the evolution of cooperation," *Science*. Kin selection, direct reciprocity, indirect reciprocity, network reciprocity, group selection. Checklist for E1.
- Potts (1998), "Variability selection in hominid evolution," *Evolutionary Anthropology*. Variable environments favor flexible behavior.

## Culture and social learning

- Boyd & Richerson (1985), *Culture and the Evolutionary Process*; (2005), *Not by Genes Alone*. Dual inheritance, copying biases.
- Henrich & Gil-White (2001), "The evolution of prestige," *Evolution and Human Behavior*. Copying whom others attend to.
- Newell & Rosenbloom (1981). Power law of practice.

## Religion

- Guthrie (1993), *Faces in the Clouds*. Anthropomorphism and over-detection.
- Barrett (2000), "Exploring the natural foundations of religion," *Trends in Cognitive Sciences*. Hyperactive agency detection.
- Skinner (1948), "'Superstition' in the pigeon," *Journal of Experimental Psychology*.
- Sosis & Alcorta (2003), "Signaling, solidarity, and the sacred," *Evolutionary Anthropology*. Costly ritual as commitment signal.
- Norenzayan (2013), *Big Gods*; Norenzayan et al. (2016), "The cultural evolution of prosocial religions," *Behavioral and Brain Sciences*. Moralizing gods and large-scale cooperation. Whether they came before or after social complexity is contested (E5).
- ✓ Wiessner (2014), "Embers of society: Firelight talk among the Ju/'hoansi Bushmen," *PNAS* 111(39):14027–14035. Day talk centered on economic matters and gossip; night talk by firelight was mostly stories, singing, dancing, and ceremony. Supports the essay's evening intuition (§7.6, E2).

## Hierarchy and the state

- Boehm (1999), *Hierarchy in the Forest*. Reverse dominance hierarchy: egalitarian foragers actively level would-be bosses.
- Carneiro (1970), "A theory of the origin of the state," *Science*. Environmental circumscription + warfare (E3).
- Weber, *Economy and Society*. Routinization of charisma; types of legitimacy (§7.12).
- Olson (1993), "Dictatorship, democracy, and development," *American Political Science Review*. The stationary bandit.
- Mayshar, Moav & Pascali (2022), "The origin of the state: Land productivity or appropriability?" *Journal of Political Economy*. Storable cereals vs. tubers (E4).
- Scott (2017), *Against the Grain*. Grain, taxation, early states.
- Graeber & Wengrow (2021), *The Dawn of Everything*. Seasonal hierarchies that formed and dissolved.
- Turchin (2016), *Ultrasociety*. Inter-group competition and scale.

## Kinship, mating, life history

- Westermarck (1891), *The History of Human Marriage*. Co-rearing and sexual aversion (§7.5).
- Kaplan, Hill, Lancaster & Hurtado (2000), "A theory of human life history evolution," *Evolutionary Anthropology*. Long childhood, net-negative child production.
- Hrdy (2009), *Mothers and Others*. Cooperative breeding.
- Gurven & Kaplan (2007), "Longevity among hunter-gatherers," *Population and Development Review*. Mortality targets (§9).

## Bodies and energetics

- Pontzer et al. (2012), "Hunter-gatherer energetics and human obesity," *PLoS ONE*. Hadza energy expenditure and travel distances (§9).
- Ainsworth et al., *Compendium of Physical Activities*. MET values (§3.1).
- Banister et al. (1975), fitness–fatigue (impulse-response) model of training (§3.4).
- Gabbett (2016), "The training–injury prevention paradox," *British Journal of Sports Medicine*. Acute-vs-chronic workload and injury (§3.4).
- Wrangham (2009), *Catching Fire*. Cooking and human evolution (§2.9).

### Metabolism (✓ checked 2026-11-19 by web search, Phase 2.1)
- ✓ Schofield equations, kcal a day from weight in kg, FAO/WHO/UNU (2004), *Human energy requirements*, Table 5.2 (fao.org/3/y5686e/y5686e07.htm), cross-checked against Wikipedia's "Schofield equation": men 18–30 15.057W + 692.2, 30–60 11.472W + 873.1, over 60 11.711W + 587.7; women 18–30 14.818W + 486.6, 30–60 8.126W + 845.6, over 60 9.082W + 658.5; children's bands (under 3, 3–10, 10–18) likewise.
- ✓ Physical activity ratios (multiples of the basal rate), same report, Table 5.1: sleeping 1; light leisure 1.4; sitting 1.5; standing and carrying light loads 2.2; walking at varying paces 3.2; non-mechanised farm work (planting, weeding, gathering) 4.1; collecting water or wood 4.4. Heavy work is named without a value. Lifestyle PALs: sedentary 1.40–1.69, active 1.70–1.99, vigorous 2.00–2.40.
- ✓ Hall (2008), "What is the required energy deficit per unit weight loss?", *International Journal of Obesity* (PMC2376744): fat 39.5 MJ/kg, lean-tissue change 7.6 MJ/kg; Forbes's relation with C = 10.4 kg (from Forbes's fit in 166 women); people with more fat lose less of a deficit from lean tissue.
- ✓ Leiter & Marliss (1982), "Survival during fasting may depend on fat as well as protein stores," *JAMA* 248:2306 (abstract only): death came as fat stores approached exhaustion.
- **Not checked:** Pontzer et al. (2012) returned a bot check, so the Hadza bodies (about 51 kg and 13.5% fat for men, 43 kg and 21% for women) and §9's figures are still from memory; Pandolf et al. (1977)'s load-carriage equation and terrain factors; the net cost of running (about 1 kcal per kg per km); the thermic effect of food (about 10%); gastric emptying (1–4 kcal a minute); the 1981 hunger strikers' 46–73 days (Scientific American's page refuses fetching).

### Heat and water (Phase 2.2; mostly from memory, 2026-11-19)
- ✓ Eyolfson et al. (2001), "Measurement and prediction of peak shivering intensity in humans," *European Journal of Applied Physiology* 84:100–106 (PubMed 11394237, abstract only): peak shivering 22.1 mL O₂/kg/min, 4.9 ± 0.8 × resting metabolism, 41.7% of VO₂max, in 15 young adults. §3.9 caps shivering lower (2.5 × basal) for hours-long cold.
- **Not found:** the survival table "days without water by the day's top shade temperature" (2 days at 120 °F … 10 days at 70 °F and below), remembered from FM 21-76 after Adolph (1947), *Physiology of Man in the Desert*. The 2006 FM 21-76's desert chapter, read in full as text, does not contain it (it may be an image, or from an older edition).
- **Not checked (standard values, from memory):** convective and radiative coefficients (8.3 √v and 4.7 W/m²K), breath losses and the efficiency of sweating (ISO 7933), clothing vapour permeability 0.38 (ISO 9920), Tetens's vapour pressure formula, hydration of fat-free mass 0.73 (Wang et al. 1999), heat capacity of the body 3.47 kJ/kg/K, metabolic water (fat about 1.07 g per g), insensible loss about 10 mL/kg/day, maximal tissue insulation 0.1–0.2 m²K/W, huddling savings of 6–53% (Gilbert et al. 2010, *Biological Reviews*), the thermoneutral zone of nude people (about 28–32 °C), death thresholds (water deficits of 15–25% of body mass; core temperatures near 42 °C and below 24–28 °C).

### Injury, healing and infection (Phase 2.3; from memory, 2026-11-19, not checked against sources)

The 2.8 calibration pass should check these first; every number in `DESIGN.md` §3.10 not listed here is an estimate.
- **Blood volume** about 70 mL per kg of body mass in adult men (about 5 L at 70 kg), here 0.085 L per kg of lean mass. **Shock:** the ATLS classes of haemorrhage, class IV above 40% of blood volume lost, immediately life-threatening.
- **Bleeding time** (a standard cut) 2–9 minutes; **transcapillary refill** restores plasma volume over a day or two after a haemorrhage; red cells take weeks (haemoglobin recovers in a median of about 5 weeks after a whole-blood donation).
- **Burns:** the Parkland formula, 4 mL per kg per percent of skin burned in the first 24 hours, half in the first 8; evaporative water loss from burns, (25 + %burned) × body surface (m²) mL an hour; before fluid resuscitation, burns over about a third of the skin were mostly fatal (no source in hand).
- O'Sullivan & Jagger (2004), *Human vulnerability to thermal radiation offshore* (UK HSE report): thermal dose in (kW/m²)^(4/3)·s, roughly 80–130 for first-degree burns, 240–730 for second-degree, 1,000–3,100 for third-degree; about 1.6–1.7 kW/m² tolerable indefinitely.
- **Lightning:** Cooper's figures as usually quoted: about 10% of people struck die, mostly of cardiac arrest; ground current, side flash and contact cause most injuries, direct strikes 3–5%.
- Long et al. (1979), "Metabolic response to injury and illness: estimation of energy and protein needs from indirect calorimetry and nitrogen balance," *Journal of Parenteral and Enteral Nutrition* 3:452–456: resting energy expenditure above normal by 0–10% after minor surgery, 10–30% with skeletal trauma, 20–60% in sepsis, 40–100% or more with major burns.
- **Infection doses:** the exponential dose–response model of quantitative microbial risk assessment, P = 1 − e^(−r × dose), is standard (Haas, Rose & Gerba, *Quantitative Microbial Risk Assessment*); the doses per kg of water and meat at a "full bloom" (§2.14) are this project's estimates. Robson's classic threshold for wound infection, about 10⁵ organisms per gram of tissue, shaped the idea of a dose that the body clears below and is overrun above.
- **Wound healing:** wounds left open close from their edges by contraction and epithelial growth at roughly 0.5–1 mm a day; adult long bones unite in about 6–12 weeks; superficial partial-thickness burns heal in 1–3 weeks. Malnutrition slows healing and weakens the immune response (well established; the shape used here is an estimate).
- **Dog bites** become infected in roughly 3–18% of cases, cat bites in up to half (often quoted, with treatment); pre-antibiotic death rates of wound infection are not in hand.

### Growth, aging and death (Phase 2.5, 2026-11-19)
- ✓ Gurven & Kaplan (2007), "Longevity among hunter-gatherers: a cross-cultural examination," *Population and Development Review* 33:321–365 (read at gurven.anth.ucsb.edu, the PDF's first 16 pages as text; the table's columns came out garbled, so its values were matched against the text). Table 2, Siler fits, average of five hunter-gatherer populations (Hadza, Ache, Hiwi, !Kung, Agta): *a*₁ = 0.422, *b*₁ = 1.131, *a*₂ = 0.013, *a*₃ = 1.47 × 10⁻⁴, *b*₃ = 0.086; mortality rate doubling time 8.1 years (ln 2 ÷ *b*₃; 2.8–17.5 across the five); survival to 15, 0.57 (0.45–0.66); life expectancy at 15, 37.7 more years (28.6–42.5). Text: "on average 57 percent … of children born survive to age 15 years among hunter-gatherers"; the hazard "has slowed to 0.01 by age 10, doubled to about 0.02 by age 40, doubled yet again before age 60, and again by age 70"; "an average modal adult life span of about 72 years, with a range of 68–78 years (Table 4)", the mode of deaths after 15, for a sample of premodern populations (Hadza 76, Hiwi 68, Ache 71, !Kung 74). The parameters give a modal adult age at death of 69 and e15 of 37.5 when integrated here. The causes of death by age (illness, degenerative, violence, accidents) are in the part of the paper not read.
- ✓ Walker et al. (2006), "Growth rates and life histories in twenty-two small-scale societies," *American Journal of Human Biology* 18:295–311 (read at unm.edu, the first half as text): growth "is slow from weaning to puberty (1–2 kg/year and 4–6 cm/year), followed by a marked adolescent growth spurt"; Ju/'hoansi, Hadza and Maya children are "only about 40–45% of their adult size at age 10"; the spurt ends (velocity back to its take-off level) at 18 in Hadza girls, 16 in Ache girls and 18.5 in Ache boys, 19.5 and 21.5 in Ju/'hoansi girls and boys; adult masses, kg, female and male: Hadza 48 and 54, Ache 53.7 and 59.8, Ju/'hoansi 42.2 and 50.6, Agta 40.3 and 46.4; poorer conditions mean slower growth and later menarche (12 in affluent societies to about 18). The frame curve of `DESIGN.md` §3.12 is drawn through these; shares at other ages are estimates.
- **From memory, not checked:** lean mass lost with age (about 0.3% a year in middle age, 0.5–1% after 65); aerobic capacity falling about 5–10% a decade after 30; grip strength at 80 about 55–70% of its peak; the last growth plates closing in the mid-twenties; the share of a large mammal's live mass a scavenger eats (about half).

### Fitness, fatigue and skill (Phase 2.4, 2026-11-19; mostly from memory)
- ✓ Koster et al. (2020), "The life history of human foraging: Cross-cultural and individual variation," *Science Advances* 6:eaax9070 (read at escholarship.org, full text): "The statistically average hunter in this sample peaks at 33 years of age"; "At age 18, this fictional average hunter has 89% of maximum skill"; skill "falls below 89% of maximum only after age 56"; "an 80-year-old may retain two-thirds of maximum skill"; site-level peaks cluster around 30 (range about 24–45). §3.11's practice curve gives 92.7% at 18 with half an hour's practice a day from age 5.
- **Not read (a bot check blocked PubMed Central):** Gabbett (2016), "The training–injury prevention paradox," *British Journal of Sports Medicine* 50:273. As remembered: acute load the past week, chronic load a 4-week rolling average; a "sweet spot" of 0.8–1.3; ratios of 1.5 and above carried 2–4 times the injury risk in the following week (after Hulin et al. 2014, 2016). Williams et al. (2017) proposed the exponentially weighted form used here. The ratio has since been criticised as a statistical artefact (Impellizzeri et al. 2020, as remembered): the mechanism here is the physiology it stands for (tissue not yet adapted to a load), not a claim the ratio is the best predictor.
- **Banister's model** (Banister et al. 1975; Banister & Calvert 1980), from memory: performance = p₀ + k₁ × fitness − k₂ × fatigue, each an impulse response to training; time constants usually quoted about 42–50 days (fitness) and 7–15 days (fatigue), with k₂ about twice k₁. A web summary of a 2025 arXiv paper (2505.20859) quoted one fitted set as τ₁ = 38 days, τ₂ = 1.9 days, k₁ = 0.048, k₂ = 0.117 (not read in full). Training software's defaults are 42 and 7 days.
- **Practice curves** (Newell & Rosenbloom 1981, from memory): time per trial falls as a power of the number of trials, exponents roughly 0.2–0.6. Skill retention (Arthur et al. 1998, from memory): substantial loss after a year or more of disuse, less for physical, continuous tasks.
- **Muscle** (from memory, not checked): bed rest costs young adults about 1 kg of lean mass in two weeks; resistance training adds about 1–2 kg in 12 weeks in untrained adults; resting skeletal muscle uses about 13 kcal per kg a day and adipose tissue about 4.5 (Elia 1992); strength follows cross-sectional area. Aerobic capacity of sedentary adults is roughly a fifth below that of active ones; training raises it by about 15–20% over weeks to months.

## Plants and foraging (✓ checked 2026-11-15 by web search)

- ✓ Einkorn yields: about 1–2 t/ha (2000m2.eu crop profile); about 832 lb/acre (≈ 930 kg/ha) in low-input Wyoming trials (University of Wyoming Extension, via sciencesocieties.org). Wild stands are put below these (§2.12).
- ✓ Preece et al. (2017/2018), "Cereal progenitors differ in stand harvest characteristics from related wild grasses," *Journal of Ecology* 106(3):1286–1297. Progenitors have a higher harvest index, but stands don't out-yield related wild grasses per area.
- ✓ Crittenden et al. (2009), "Foraging strategies and diet composition of Hadza children," *American Journal of Physical Anthropology*. Baobab 346, berries 320, figs 365 kcal per 100 g dry matter.
- ✓ Pretelli et al. (2022), *Science Advances*. Mikea children average 656 net kcal per hour on ovy tubers; a Hadza 6-year-old produced 7,000 kcal in a day of fig collecting; tubers and game need more skill than fruit. (Phase 3 calibration.)
- ✓ Forager population densities: from about 1 person per 10–50 square miles in harsh environments to 10–30 per square mile in rich ones (Palomar College anthropology notes); Ache 0.04 per km² (as compiled by Marlowe 2005, in a table at pmc.ncbi.nlm.nih.gov/articles/PMC2999363). Zhu et al. (2021), *Nature Ecology & Evolution*: short growing seasons limit forager density.

## Emergent communication (Floor 2+)

- Lewis (1969), *Convention*; Skyrms (2010), *Signals*. Signaling games.
- Lazaridou, Peysakhovich & Baroni (2017), "Multi-agent cooperation and the emergence of (natural) language," ICLR.
- Mordatch & Abbeel (2018), "Emergence of grounded compositional language in multi-agent populations," AAAI.
- Hockett (1960), "The origin of speech," *Scientific American*. Design features of language, including displacement (§0.4).

## Animals (✓ checked 2026-11-16 by web search)

- **Wolf kill rates, red-deer system:** in Białowieża Primeval Forest (Poland), hunting groups averaged 4.4 wolves and killed 0.513 prey per pack per day; per capita 0.116 ungulates per wolf per day, eating 5.58 kg per wolf per day; 63% of prey were red deer, at winter densities of 3–6 deer per km² (Jędrzejewski et al. 2002, *Ecology*, via an abstract on peeref.com). The mean mass of ungulates killed there was 55 kg, and wolves removed 57–105 red deer per 100 km² per year in 1991–96 (Jędrzejewski et al. 2000, *Journal of Mammalogy* 81:197).
- **Wolf kill rates, large prey:** in the Southern Lakes, Yukon, winter kill rates were 0.018 ungulates per wolf per day (moose and caribou) and consumption 3.49 kg per wolf per day (Yukon government wolf programme summary, 2023).
- **Wolf minimum need:** about 3.7 kg per wolf per day (Metz et al. 2011, cited by the Yellowstone Wolf Project).
- **Big cats (✓ checked 2026-11-18, ecology review):** a radio-tracked female leopard in Bardia National Park, Nepal, ate 4.0 ± 0.3 kg a day and killed an ungulate every 10.6 ± 0.7 days, and some prey every 5.6 days counting birds and primates (Odden & Wegge 2009, *Mammal Research* 54:23, abstract via agris.fao.org). Leopard densities in Asia range down to 1.0 per 100 km² (Srepok, Cambodia, one of the lowest reported) from 3.6 at the same site in 2009 (PMC5830728). The sim's cats eat 3.5 kg a day, kill about one deer every 11 days, and settle at 1.0–1.6 per 100 km² on the full map: inside the range.
- **Aurochs, by way of European bison (✓ checked 2026-11-18):** historical densities in Białowieża Primeval Forest were 0–1.5 bison per km² alongside 0–5.4 red deer and 0.2–3.8 wild boar (*Acta Theriologica* 42, via rcin.org.pl). A reintroduced herd at 12.5 per 1,000 ha (1.25 per km²) was held back by its own density, with births of 16.4% of the herd a year and growth of 16.5% (Ozery population, smz.waw.pl); a Borecka Forest herd lived at 6–8 per 1,000 ha in summer. The sim starts aurochs at 0.5 per km² with births 25% and deaths 8% a year: births a little high, net growth about right.
- **Hares (✓ checked 2026-11-18):** mean densities of 10–30 per km² in favourable farmland (as summarised in a 2025 Catalonia study, researchsquare.com rs-10546061); 20.8 per km² in spring in the Slovak Danubian lowland (preprints.org 202407.0901); up to 340 per km² under ideal conditions and 3.4 in a declining Danish population (*Wildlife Biology* 2020, wlb.00645). Density dependence is the main short-term driver of growth. The sim starts at 30 and settles around 16–30.
- **Still estimates:** vulture numbers, carcass rotting rates, forage stocks and regrowth, and deer birth rates. None of them bears on a calibration target yet; Phase 2's foraging calibration should revisit forage.

## Materials (written from memory 2026-11-17, not checked against sources)

Phase 1.7's numbers are first estimates. Before Phase 2.2 (thermoregulation) or Phase 3 relies on any of them, check them.
- Mohs hardness: flint and quartzite about 7, pyrite 6–6.5, granite about 6 (quartz and feldspar grains), limestone (calcite) 3. Standard mineralogy.
- Flint and chert break conchoidally; flake edges are among the sharpest natural edges. Quartzite flakes less predictably. Struck flint on flint gives faint cold flashes (triboluminescence), not fire.
- Fire from sparks: iron pyrite or marcasite struck with flint was a prehistoric fire-making method. Sorensen, Claud & Soressi (2018), "Neandertal fire-making technology inferred from microwear analysis," *Scientific Reports* 8:10065, report wear on Neandertal bifaces consistent with striking pyrite. Marcasite and flint nodules both occur in chalk.
- Fallen wood: Harmon et al. (1986), "Ecology of coarse woody debris in temperate ecosystems," *Advances in Ecological Research* 15, is the standard review of how much dead wood lies in temperate forests and how fast it decays (decay constants of a few percent a year for large pieces, faster for small ones).
- Not yet sourced at all: the energies to flake, split and snap; the share of iron sulfide in limestone's loose stone; rock-shelter frequency; how much wind and rain trees and piled objects keep off; the insulation of a hide.

## Fire (written from memory 2026-11-17, not checked against sources)

Phase 1.8's numbers come from these as remembered; check them before the ecology review (1.10) or Phase 2.2 relies on them.
- Cheney, Gould & Catchpole (1998), "Prediction of fire spread in grasslands," *International Journal of Wildland Fire* 8:1–13. Head-fire rate in natural pasture: 0.054 + 0.269 *U* km/h below 5 km/h of 10 m wind, 1.4 + 0.838 (*U* − 5)^0.844 above; moisture damping exp(−0.108 *M*) to 12% moisture; no spread above about 24%; a curing function that makes spread negligible below about 50% cured.
- Simard (1968), *The moisture content of forest fuels*, Canadian Department of Forestry: equilibrium moisture of fine fuel from temperature and relative humidity (three ranges of humidity), used in the US National Fire Danger Rating System.
- Alexander (1985), length-to-breadth ratio of wind-driven fires, LB = 1 + 8.729 (1 − e^(−0.030 *U*))^2.155, as used in the Canadian Fire Behavior Prediction System (Forestry Canada 1992).
- Finney (2002), "Fire growth using minimum travel time methods," *Canadian Journal of Forest Research* 32:1420–1424. The spread method.
- Byram (1959): fireline intensity *I* = *H w R*.
- McArthur's rule of thumb: spread roughly doubles for every 10° upslope.
- Anderson (2002), Latham & Williams (2001): lightning ignitions often smoulder ("holdovers") for days before spreading; only a small share of strikes start fires.
- Temperate deciduous leaf litterfall about 3–4 t/ha a year, decaying 30–70% a year; cured grassland fuel loads about 2–6 t/ha.
- Not yet sourced at all: the relative-humidity estimate from soil moisture (a stand-in: the climate keeps no humidity), smouldering rates and how fast embers die, how rain puts out smouldering wood and burning sticks, the burning rate of single sticks and piles (char rates of about 0.6–1 mm a minute are typical of wood in a fire), the energy to make a friction ember, how often sparks catch, plant top-kill shares, and how far animals keep from fire.

## Fire regimes (✓ checked 2026-11-18 by web search, ecology review)

- **Northern mixed-grass prairie:** pre-European-settlement fire-return intervals of 15–30 years were estimated for the region from the Platte rivers to the Black Hills and the Kansas border (Wendtland & Dodd 1990, as cited in a fire-interval study of northeast Wyoming, *Journal of Range Management*, journals.uair.arizona.edu). That is about 0.4–0.9% of the land a compressed year.
- **Fire sizes in mixed-grass prairie:** fires "ranged from local (tens of acres) to landscape level (thousands of acres)"; dormant-season fires spread widely, while growing-season lightning fires were often smaller because of green fuel and the rain that follows lightning (USDA Fire Effects Information System, biophysical setting 3911410).
- **Lightning versus people:** in the southern Canadian Rockies, lightning fires are judged too few to explain the historical burn pattern, and native burning is credited with much of it (Kay, via nrfirescience.org). Lightning-only regimes, which are what the simulation has, should sit at the long end of the historical intervals.
- **A grassland fire history with people present:** a mean fire interval of 4.4 years before 1901 at a site surrounded by grassland, falling to 1.7 years in the severe drought of 1855–1880 (*Fire Ecology* 5(2):51).
