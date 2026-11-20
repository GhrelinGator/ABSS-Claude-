// Genetics (docs/DESIGN.md §3.7, §3.14): founders' genomes, passing dials and
// broken alleles on, inbreeding depression at the recessive lethal loci, the
// genealogy, and what the two body dials do. Targets were written in
// DESIGN.md §3.14 before the first run.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditConserved } from '../../src/sim/core/audit.ts';
import { defaultConfig, validateConfig } from '../../src/sim/config.ts';
import type { SimConfig } from '../../src/sim/config.ts';
import type { SystemDef } from '../../src/sim/core/registry.ts';
import { createSim, hashSim, loadSim, saveSim, spawnAgent, stepSim } from '../../src/sim/sim.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { viewOf } from '../../src/sim/readonly.ts';
import { pedigreeOf } from '../../src/analysis/genealogy.ts';
import { genetics as geneticsObserver } from '../../src/analysis/observers/genetics.ts';
import { aging, AGING_COLUMNS } from '../../src/sim/body/aging.ts';
import { fitness } from '../../src/sim/body/fitness.ts';
import { heat } from '../../src/sim/body/heat.ts';
import { injury } from '../../src/sim/body/injury.ts';
import {
  BODY_COLUMNS,
  BODY_PARTS,
  DeathCause,
  Sex,
  basalKcalPerDay,
  fatKgOf,
  formBody,
  metabolism,
} from '../../src/sim/body/metabolism.ts';
import { BirthEvent, REPRODUCTION_COLUMNS, REPRODUCTION_PARTS, mate, reproduction } from '../../src/sim/body/reproduction.ts';
import {
  GENEALOGY_FIELDS,
  GENE_DIALS,
  GENETICS_COLUMNS,
  GENETICS_PARTS,
  LETHAL_MUTATIONS_PER_GAMETE,
  adultFrameFor,
  bearGenome,
  bitCount,
  conceiveGenome,
  formGenome,
  genetics,
  postnatalDeathYears,
  prenatalLossShare,
} from '../../src/sim/body/genetics.ts';
import { CARCASS_LAYER } from '../../src/sim/world/animals.ts';
import { HADZA_MAN, HADZA_WOMAN, fxKeeper, spawnWithBody } from '../fixtures/bodies.ts';
import { fxSurroundings, still } from '../fixtures/surroundings.ts';

const TPD = 144;
const TPY = TPD * 48;
const G = GENETICS_COLUMNS;
const R = REPRODUCTION_COLUMNS;
const f64 = (sim: Sim, name: string) => sim.state.agents.column<Float64Array>(name).data;
const u8 = (sim: Sim, name: string) => sim.state.agents.column<Uint8Array>(name).data;
const u32 = (sim: Sim, name: string) => sim.state.agents.column<Uint32Array>(name).data;
const part = (sim: Sim, name: string) => sim.state.parts.find((p) => p.name === name)!.readings!() as Float64Array;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
};

/** Genes and the bodies they need, nothing else: families are made by calling the doors directly. */
function geneSim(seed: number, load = true): Sim {
  const config: SimConfig = validateConfig({ ...defaultConfig(seed), genetics: { recessiveLoad: load } });
  return createSim(config, [metabolism, genetics]);
}

/** A founder of this sex, with a genome (the fixture forms it). */
const founder = (sim: Sim, sex: 1 | 2) => spawnWithBody(sim, 100, 100, sex === Sex.MALE ? HADZA_MAN : HADZA_WOMAN);

/** A child of these two, made directly through conception's and birth's steps. */
function child(sim: Sim, mother: number, father: number, sex: 1 | 2 = Sex.FEMALE): number {
  conceiveGenome(sim, mother, father);
  const slot = spawnAgent(sim, 100, 100);
  formBody(sim, slot, { sex, ageYears: 0, leanKg: 2.6, fatKg: 0.4 });
  const ids = sim.state.agents.id.data;
  bearGenome(sim, mother, slot, ids[mother], ids[father]);
  return slot;
}

/** Loci at which a body carries two broken copies: [before birth, after birth]. */
function homozygousAt(sim: Sim, slot: number): [number, number] {
  const load = u32(sim, G.loadLoci.name);
  return [bitCount(load[slot * 4] & load[slot * 4 + 2]), bitCount(load[slot * 4 + 1] & load[slot * 4 + 3])];
}

test('the pieces: bit counts, where each lethal locus acts, the mutation rate, the config switch', () => {
  assert.equal(bitCount(0), 0);
  assert.equal(bitCount(0xffffffff), 32);
  assert.equal(bitCount(0x80000001), 2);
  assert.ok(Math.abs(prenatalLossShare(0) - 0.1125) < 1e-12);
  assert.ok(prenatalLossShare(31) < 0.9 && prenatalLossShare(31) > 0.88);
  assert.ok(postnatalDeathYears(0) < 0.01 && postnatalDeathYears(31) > 9 && postnatalDeathYears(31) < 10);
  assert.ok(Math.abs(LETHAL_MUTATIONS_PER_GAMETE - 0.0185) < 0.0005);
  assert.equal(adultFrameFor(Sex.FEMALE, 1), 32);
  assert.equal(adultFrameFor(Sex.MALE, 1.1), 41.4 * 1.1);
  // Configs written before 2.7 get the default; the switch must be true or false.
  const old: Record<string, unknown> = { ...defaultConfig(1) };
  delete old.genetics;
  assert.equal(validateConfig(old).genetics.recessiveLoad, true);
  assert.throws(() => validateConfig({ ...old, genetics: { recessiveLoad: 1 } }), /true or false/);
  assert.throws(() => validateConfig({ ...old, genetics: { recessiveLoad: true, extra: 1 } }), /unknown key/);
});

test('founders: broken alleles at the equilibrium share, dials spread as designed, survivors only', (t) => {
  const sim = geneSim(1);
  const frames: number[] = [];
  const basals: number[] = [];
  let broken = 0;
  let homozygousBefore = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const slot = founder(sim, i % 2 === 0 ? Sex.FEMALE : Sex.MALE);
    frames.push(f64(sim, G.frameScale.name)[slot]);
    basals.push(f64(sim, G.basalScale.name)[slot]);
    const load = u32(sim, G.loadLoci.name);
    for (let w = 0; w < 4; w++) broken += bitCount(load[slot * 4 + w]);
    homozygousBefore += homozygousAt(sim, slot)[0];
    // A 28-year-old founder cannot carry a disorder that would already have killed it.
    assert.equal(f64(sim, G.disorderAtYears.name)[slot], 0);
  }
  const perHaplotype = broken / (2 * n);
  t.diagnostic(
    `${n} founders: ${perHaplotype.toFixed(3)} broken alleles a haplotype; frameScale ${mean(frames).toFixed(4)} ± ${sd(frames).toFixed(4)}; ` +
      `basalScale ${mean(basals).toFixed(4)} ± ${sd(basals).toFixed(4)}`,
  );
  assert.ok(perHaplotype >= 1.0 && perHaplotype <= 1.18, `${perHaplotype} broken alleles a haplotype`);
  assert.ok(Math.abs(mean(frames) - 1) <= 0.01 && sd(frames) >= 0.09 && sd(frames) <= 0.13);
  assert.ok(Math.abs(mean(basals) - 1) <= 0.01 && sd(basals) >= 0.06 && sd(basals) <= 0.09);
  assert.equal(homozygousBefore, 0, 'founders were all born');
  // Every founder is in the genealogy, without parents.
  const rows = part(sim, GENETICS_PARTS.genealogy);
  assert.equal(rows.length, n * GENEALOGY_FIELDS);
  assert.equal(rows[1] + rows[2], 0);
});

test('passing on: a fair draw of each parent\'s two copies, mutation at the designed rates, size heritable', (t) => {
  const sim = geneSim(2);
  const alleles = () => f64(sim, G.alleles.name);
  let picks = 0;
  let firstPicked = 0;
  let mutated = 0;
  let passed = 0;
  let newLethals = 0;
  const midparent: number[] = [];
  const offspring: number[] = [];
  const n = 5000;
  for (let i = 0; i < n; i++) {
    const mother = founder(sim, Sex.FEMALE);
    const father = founder(sim, Sex.MALE);
    const c = child(sim, mother, father);
    const a = alleles();
    const width = 2 * GENE_DIALS.length;
    for (const [parent, k] of [[mother, 0], [father, 1]] as const) {
      for (let d = 0; d < GENE_DIALS.length; d++) {
        const got = a[c * width + 2 * d + k];
        const p0 = a[parent * width + 2 * d];
        const p1 = a[parent * width + 2 * d + 1];
        passed += 1;
        if (got === p0 && got !== p1) {
          picks += 1;
          firstPicked += 1;
        } else if (got === p1 && got !== p0) picks += 1;
        else if (got !== p0 && got !== p1) mutated += 1;
      }
      const load = u32(sim, G.loadLoci.name);
      for (let w = 0; w < 2; w++) {
        const had = load[parent * 4 + w] | load[parent * 4 + 2 + w];
        newLethals += bitCount(load[c * 4 + 2 * k + w] & ~had);
      }
    }
    const fs = f64(sim, G.frameScale.name);
    midparent.push((fs[mother] + fs[father]) / 2);
    offspring.push(fs[c]);
  }
  const mx = mean(midparent);
  const my = mean(offspring);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (midparent[i] - mx) * (offspring[i] - my);
    sxx += (midparent[i] - mx) * (midparent[i] - mx);
  }
  const slope = sxy / sxx;
  const firstShare = firstPicked / picks;
  const mutatedShare = mutated / passed;
  const lethalsPerGamete = newLethals / (2 * n);
  t.diagnostic(
    `${n} families: first copy passed ${(100 * firstShare).toFixed(1)}%; ${(100 * mutatedShare).toFixed(2)}% of alleles mutated; ` +
      `${lethalsPerGamete.toFixed(4)} new lethal mutations a gamete; child on midparent frameScale slope ${slope.toFixed(3)}`,
  );
  assert.ok(firstShare >= 0.48 && firstShare <= 0.52);
  assert.ok(mutatedShare >= 0.008 && mutatedShare <= 0.012);
  assert.ok(lethalsPerGamete >= 0.015 && lethalsPerGamete <= 0.022);
  assert.ok(slope >= 0.78 && slope <= 0.95, `slope ${slope}`);
});

test('inbreeding depression: two broken copies far more often in children of close kin; the genealogy gives their F; off with the switch', (t) => {
  const run = (load: boolean) => {
    const sim = geneSim(3, load);
    const n = 3000;
    const share = { unrelated: 0, cousins: 0, siblings: 0, siblingsBefore: 0 };
    const fs = { unrelated: 0, cousins: 0, siblings: 0 };
    const view = viewOf(sim);
    const lastOf: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      // Unrelated founders.
      const a = child(sim, founder(sim, Sex.FEMALE), founder(sim, Sex.MALE));
      // Full siblings, children of two founders.
      const gm = founder(sim, Sex.FEMALE);
      const gf = founder(sim, Sex.MALE);
      const daughter = child(sim, gm, gf, Sex.FEMALE);
      const son = child(sim, gm, gf, Sex.MALE);
      const b = child(sim, daughter, son);
      // First cousins: the children of that daughter and that son, each with an unrelated founder.
      const x = child(sim, daughter, founder(sim, Sex.MALE), Sex.FEMALE);
      const y = child(sim, founder(sim, Sex.FEMALE), son, Sex.MALE);
      const c = child(sim, x, y);
      for (const [key, slot] of [['unrelated', a], ['siblings', b], ['cousins', c]] as const) {
        const [pre, post] = homozygousAt(sim, slot);
        if (pre + post > 0) share[key] += 1;
        if (key === 'siblings' && pre > 0) share.siblingsBefore += 1;
        lastOf[key] = sim.state.agents.id.data[slot];
      }
    }
    const pedigree = pedigreeOf(view)!;
    fs.unrelated = pedigree.inbreeding(lastOf.unrelated);
    fs.siblings = pedigree.inbreeding(lastOf.siblings);
    fs.cousins = pedigree.inbreeding(lastOf.cousins);
    return { n, share, fs, sim };
  };
  const on = run(true);
  const pct = (x: number) => (100 * x) / on.n;
  t.diagnostic(
    `two broken copies somewhere: unrelated ${pct(on.share.unrelated).toFixed(1)}%, first cousins ${pct(on.share.cousins).toFixed(1)}%, ` +
      `full siblings ${pct(on.share.siblings).toFixed(1)}% (${pct(on.share.siblingsBefore).toFixed(1)}% acting before birth)`,
  );
  assert.ok(pct(on.share.unrelated) >= 1 && pct(on.share.unrelated) <= 3);
  assert.ok(pct(on.share.cousins) >= 6 && pct(on.share.cousins) <= 11);
  assert.ok(pct(on.share.siblings) >= 20 && pct(on.share.siblings) <= 31);
  const before = on.share.siblingsBefore / on.share.siblings;
  assert.ok(before >= 0.4 && before <= 0.65, `${before} of siblings' children affected before birth`);
  assert.equal(on.fs.unrelated, 0);
  assert.equal(on.fs.siblings, 0.25);
  assert.equal(on.fs.cousins, 1 / 16);
  // The observer reads the same genealogy.
  const seen = geneticsObserver.observe(viewOf(on.sim));
  assert.ok(seen.genomes > 0 && seen.genealogyRecords === seen.genomes && seen.meanInbreeding > 0 && seen.meanBrokenAlleles > 1.5);

  const off = run(false);
  assert.deepEqual(off.share, { unrelated: 0, cousins: 0, siblings: 0, siblingsBefore: 0 });
  assert.equal(off.fs.siblings, 0.25);
});

/** The whole body stack with genes, mild scripted surroundings and a keeper; newborns are held. */
function bodySim(seed: number): Sim {
  let ref: Sim | null = null;
  const mild: SystemDef = fxSurroundings((tick, slot) => {
    const born = f64(ref!, BODY_COLUMNS.born.name)[slot];
    return (tick - born) / TPY < 2 ? { ...still(26), contact: 0.3 } : still(26);
  });
  const sim = createSim(defaultConfig(seed), [fxKeeper, mild, injury, heat, reproduction, metabolism, fitness, aging, genetics]);
  ref = sim;
  return sim;
}

/** Mate every tick until she conceives; then make sure age alone does not end the pregnancy. */
function conceive(sim: Sim, female: number, male: number): void {
  for (let t = 0; t < 4000; t++) {
    mate(sim, female, male);
    if (u8(sim, R.pregnant.name)[female] === 1) return;
    stepSim(sim, 1);
  }
  assert.fail('she should conceive');
}

/** Give every haplotype of these bodies a broken allele at this locus (0–63). */
function breakLocus(sim: Sim, slots: number[], locus: number): void {
  const load = u32(sim, G.loadLoci.name);
  const w = locus < 32 ? 0 : 1;
  for (const slot of slots) for (const h of [0, 2]) load[slot * 4 + h + w] = (load[slot * 4 + h + w] | (1 << (locus % 32))) >>> 0;
}

test('in the body: two broken copies before birth end the pregnancy; after birth they kill at their age with a carcass; a newborn\'s frame is its genes\'', (t) => {
  const sim = bodySim(7);
  const man = spawnWithBody(sim, 1050, 2050, HADZA_MAN);
  const woman = spawnWithBody(sim, 1050, 2050, { ...HADZA_WOMAN, ageYears: 22 });
  stepSim(sim, 1);
  for (const slot of [man, woman]) f64(sim, AGING_COLUMNS.oldAgeAtYears.name)[slot] = 1000;
  const births = part(sim, REPRODUCTION_PARTS.births);

  // Before birth: locus 5 broken on all four parental haplotypes.
  const load = u32(sim, G.loadLoci.name);
  for (const slot of [man, woman]) for (let w = 0; w < 4; w++) load[slot * 4 + w] = 0;
  breakLocus(sim, [man, woman], 5);
  conceive(sim, woman, man);
  const lossAt = f64(sim, R.lossAt.name)[woman];
  assert.ok(lossAt > 0 && lossAt <= prenatalLossShare(5) + 1e-12, `lost at ${lossAt}`);
  stepSim(sim, Math.ceil(prenatalLossShare(5) * 0.75 * TPY) + 2);
  assert.equal(u8(sim, R.pregnant.name)[woman], 0);
  assert.equal(births[BirthEvent.LOST], 1);
  assert.equal(births[BirthEvent.BIRTH], 0);
  stepSim(sim, Math.ceil(0.1 * TPY) + 1);

  // After birth: locus 32 + 3 broken instead; the pregnancy is carried to term.
  for (const slot of [man, woman]) for (let w = 0; w < 4; w++) load[slot * 4 + w] = 0;
  breakLocus(sim, [man, woman], 32 + 3);
  conceive(sim, woman, man);
  f64(sim, R.lossAt.name)[woman] = 0;
  const conceivedAt = sim.state.tick;
  while (births[BirthEvent.BIRTH] === 0) {
    stepSim(sim, 1);
    assert.ok(sim.state.tick - conceivedAt < 0.75 * TPY + 5, 'born at term');
    if ((sim.state.tick - conceivedAt) % TPD === 0) assert.deepEqual(auditConserved(sim.state.agents), []);
  }
  const agents = sim.state.agents;
  let baby = -1;
  for (let s = 0; s < agents.highWater; s++) if (agents.isAlive(s) && s !== man && s !== woman) baby = s;
  assert.ok(baby >= 0);
  const sex = u8(sim, BODY_COLUMNS.sex.name)[baby];
  const scale = f64(sim, G.frameScale.name)[baby];
  assert.equal(u8(sim, G.genomeFormed.name)[baby], 1);
  assert.ok(Math.abs(f64(sim, BODY_COLUMNS.adultFrameKg.name)[baby] - adultFrameFor(sex, scale)) < 1e-9);
  assert.equal(f64(sim, G.disorderAtYears.name)[baby], postnatalDeathYears(3));
  const rows = part(sim, GENETICS_PARTS.genealogy);
  const last = Array.from(rows.subarray(rows.length - GENEALOGY_FIELDS));
  const ids = agents.id.data;
  assert.deepEqual(last.slice(0, 4), [ids[baby], ids[woman], ids[man], sex]);
  assert.equal(last[5], 1);
  // A snapshot taken now resumes identically, genealogy and all.
  const resumed = loadSim(saveSim(sim), sim.pipeline);
  stepSim(resumed, TPD);
  stepSim(sim, TPD);
  assert.equal(hashSim(resumed), hashSim(sim));

  const bornAt = f64(sim, BODY_COLUMNS.born.name)[baby];
  const babyId = ids[baby];
  const deaths = part(sim, BODY_PARTS.deaths);
  while (agents.isAlive(baby) && agents.id.data[baby] === babyId) {
    stepSim(sim, 1);
    assert.ok(sim.state.tick - bornAt < postnatalDeathYears(3) * TPY + 5, 'dies at the locus\'s age');
  }
  const diedAt = (sim.state.tick - 1 - bornAt) / TPY;
  t.diagnostic(`newborn (frameScale ${scale.toFixed(3)}) died of a recessive disorder at ${(diedAt * 48).toFixed(2)} days; locus age ${(postnatalDeathYears(3) * 48).toFixed(2)} days`);
  assert.equal(deaths[DeathCause.CONGENITAL], 1);
  assert.ok(Math.abs(diedAt - postnatalDeathYears(3)) < 2 / TPY);
  const cell = Math.floor(2050 / 100) * sim.config.world.widthCells + Math.floor(1050 / 100);
  assert.ok(sim.state.world.layer<Float32Array>(CARCASS_LAYER)[cell] > 1, 'a carcass where it died');
  assert.deepEqual(auditConserved(sim.state.agents), []);
});

test('basal scale: a body at 0.9 spends a tenth of its basal rate less at rest than its twin at 1, and makes less heat', () => {
  const sim = createSim(defaultConfig(9), [metabolism, genetics]);
  const low = spawnWithBody(sim, 100, 100, HADZA_WOMAN);
  const even = spawnWithBody(sim, 100, 100, HADZA_WOMAN);
  f64(sim, G.basalScale.name)[low] = 0.9;
  f64(sim, G.basalScale.name)[even] = 1;
  const lean = f64(sim, BODY_COLUMNS.leanKg.name)[even];
  const mass = lean + fatKgOf(f64(sim, BODY_COLUMNS.energy.name)[even], 0, lean);
  stepSim(sim, TPD);
  const out = f64(sim, BODY_COLUMNS.energyOut.name);
  const saved = out[even] - out[low];
  const expected = 0.1 * basalKcalPerDay(Sex.FEMALE, 28, mass);
  assert.ok(Math.abs(saved / expected - 1) < 0.01, `saved ${saved} kcal, expected ${expected}`);
  assert.ok(f64(sim, BODY_COLUMNS.heatW.name)[low] < f64(sim, BODY_COLUMNS.heatW.name)[even]);
  assert.ok(Math.abs(f64(sim, BODY_COLUMNS.exertion.name)[low] - f64(sim, BODY_COLUMNS.exertion.name)[even]) < 1e-9, 'exertion is in multiples of the Schofield rate');
});

test('a body without a genome stops a run that keeps genes; a genome cannot be given twice', () => {
  const sim = createSim(defaultConfig(10), [metabolism, genetics]);
  const slot = spawnAgent(sim, 100, 100);
  formBody(sim, slot, HADZA_WOMAN);
  assert.throws(() => stepSim(sim, 1), /genome/);
  const other = createSim(defaultConfig(10), [metabolism, genetics]);
  const s2 = spawnWithBody(other, 100, 100, HADZA_WOMAN);
  assert.throws(() => formGenome(other, s2), /already has a genome/);
  const bare = spawnAgent(other, 100, 100);
  assert.throws(() => formGenome(other, bare), /no body/);
});
