// Genomes of the living at the moment of sampling (docs/DESIGN.md §3.14):
// how many, the mean expressed value of each heritable dial, the mean number
// of broken alleles a genome carries at the recessive lethal loci, the mean
// inbreeding coefficient of the living from the genealogy, and the number of
// bodies the genealogy holds so far.

import type { Measurements, Observer } from '../observer.ts';
import { GENETICS_COLUMNS, GENE_DIALS, bitCount } from '../../sim/readonly.ts';
import { pedigreeOf } from '../genealogy.ts';

export const genetics: Observer = {
  name: 'genetics',
  observe(view): Measurements {
    const agents = view.agents;
    if (!agents.hasColumn(GENETICS_COLUMNS.genomeFormed.name)) return {};
    const alive = agents.column('alive');
    const ids = agents.column('id');
    const formed = agents.column(GENETICS_COLUMNS.genomeFormed.name);
    const load = agents.column(GENETICS_COLUMNS.loadLoci.name);
    const expressed = GENE_DIALS.map((g) => agents.column(g.dial.name));
    const sums = GENE_DIALS.map(() => 0);
    const pedigree = pedigreeOf(view);
    let n = 0;
    let broken = 0;
    let inbred = 0;
    for (let slot = 0; slot < agents.highWater; slot++) {
      if (alive[slot] !== 1 || formed[slot] !== 1) continue;
      n += 1;
      for (let d = 0; d < sums.length; d++) sums[d] += expressed[d][slot];
      for (let w = 0; w < 4; w++) broken += bitCount(load[slot * 4 + w]);
      if (pedigree) inbred += pedigree.inbreeding(ids[slot]);
    }
    const out: Measurements = { genomes: n };
    if (n > 0) {
      GENE_DIALS.forEach((g, d) => {
        out[`mean.${g.dial.name}`] = sums[d] / n;
      });
      out.meanBrokenAlleles = broken / n;
      if (pedigree) out.meanInbreeding = inbred / n;
    }
    if (pedigree) out.genealogyRecords = pedigree.records.size;
    return out;
  },
};
