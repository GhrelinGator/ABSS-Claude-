// The genealogy as the analysis layer reads it (docs/DESIGN.md §3.14): who
// is whose parent, and from that the kinship coefficient of two bodies and the
// inbreeding coefficient of one. The simulation keeps the records
// (`body.genealogy`); bodies never read them.

import type { SimView } from '../sim/readonly.ts';
import { GENEALOGY_FIELDS, GENETICS_PARTS } from '../sim/readonly.ts';

export interface GenealogyRecord {
  readonly id: number;
  /** 0 for a founder. */
  readonly motherId: number;
  readonly fatherId: number;
  readonly sex: number;
  readonly bornTick: number;
  /** Loci at which the body carries two broken copies (§3.14). */
  readonly homozygousLoci: number;
}

export class Pedigree {
  readonly records = new Map<number, GenealogyRecord>();
  private readonly kinMemo = new Map<string, number>();

  constructor(rows: ArrayLike<number>) {
    for (let i = 0; i + GENEALOGY_FIELDS <= rows.length; i += GENEALOGY_FIELDS) {
      const record = {
        id: rows[i],
        motherId: rows[i + 1],
        fatherId: rows[i + 2],
        sex: rows[i + 3],
        bornTick: rows[i + 4],
        homozygousLoci: rows[i + 5],
      };
      this.records.set(record.id, record);
    }
  }

  /**
   * Kinship coefficient: the chance that an allele drawn from `a` and one drawn from `b` at the same
   * locus are copies of one ancestral allele. Founders are unrelated to each other. 0 for unknown ids.
   */
  kinship(a: number, b: number): number {
    if (a === 0 || b === 0 || !this.records.has(a) || !this.records.has(b)) return 0;
    if (a === b) return (1 + this.inbreeding(a)) / 2;
    // Ids grow with every body made, so a body's parents always have smaller ids: recurse on the younger.
    const young = a > b ? a : b;
    const old = a > b ? b : a;
    const key = `${young},${old}`;
    const known = this.kinMemo.get(key);
    if (known !== undefined) return known;
    const record = this.records.get(young) as GenealogyRecord;
    const value = (this.kinship(record.motherId, old) + this.kinship(record.fatherId, old)) / 2;
    this.kinMemo.set(key, value);
    return value;
  }

  /** Inbreeding coefficient of a body: the kinship of its parents (0 for a founder). */
  inbreeding(id: number): number {
    const record = this.records.get(id);
    if (!record || record.motherId === 0 || record.fatherId === 0) return 0;
    return this.kinship(record.motherId, record.fatherId);
  }
}

/** The pedigree of a run, or null if its pipeline keeps no genealogy. */
export function pedigreeOf(view: SimView): Pedigree | null {
  const rows = view.readings(GENETICS_PARTS.genealogy);
  return rows ? new Pedigree(rows) : null;
}
