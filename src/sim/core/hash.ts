// 128-bit non-cryptographic hash over a stream of 32-bit words, using
// MurmurHash3-style block mixing. Its only job is to say whether two
// simulation states are identical. It is not a security primitive.

const C1 = 0x239b961b;
const C2 = 0xab0e9789;
const C3 = 0x38b34ae5;
const C4 = 0xa1e38b93;

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

function hex8(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class Hasher {
  private h1 = 0x9e3779b9 | 0;
  private h2 = 0x7f4a7c15 | 0;
  private h3 = 0xf39cc060 | 0;
  private h4 = 0x5cedc834 | 0;
  private readonly pending = new Uint32Array(4);
  private fill = 0;
  private total = 0;

  /** Absorb one 32-bit word. */
  u32(k: number): void {
    this.pending[this.fill++] = k;
    this.total++;
    if (this.fill === 4) {
      this.blocks(this.pending, 0, 1);
      this.fill = 0;
    }
  }

  /** Absorb an array of 32-bit words. Equivalent to calling u32 on each element. */
  words(a: Uint32Array): void {
    const n = a.length;
    let i = 0;
    while (this.fill !== 0 && i < n) this.u32(a[i++]);
    const whole = (n - i) >>> 2;
    if (whole > 0) {
      this.blocks(a, i, whole);
      this.total += whole * 4;
      i += whole * 4;
    }
    while (i < n) this.u32(a[i++]);
  }

  /** The hash of everything absorbed so far, as 32 hex digits. Can be called repeatedly. */
  digest(): string {
    const s1 = this.h1;
    const s2 = this.h2;
    const s3 = this.h3;
    const s4 = this.h4;
    if (this.fill > 0) {
      const tail = new Uint32Array(4);
      tail.set(this.pending.subarray(0, this.fill));
      this.blocks(tail, 0, 1);
    }
    let h1 = this.h1;
    let h2 = this.h2;
    let h3 = this.h3;
    let h4 = this.h4;
    this.h1 = s1;
    this.h2 = s2;
    this.h3 = s3;
    this.h4 = s4;

    const len = this.total | 0;
    h1 ^= len;
    h2 ^= len;
    h3 ^= len;
    h4 ^= len;
    h1 = (h1 + h2) | 0;
    h1 = (h1 + h3) | 0;
    h1 = (h1 + h4) | 0;
    h2 = (h2 + h1) | 0;
    h3 = (h3 + h1) | 0;
    h4 = (h4 + h1) | 0;
    h1 = fmix32(h1);
    h2 = fmix32(h2);
    h3 = fmix32(h3);
    h4 = fmix32(h4);
    h1 = (h1 + h2) | 0;
    h1 = (h1 + h3) | 0;
    h1 = (h1 + h4) | 0;
    h2 = (h2 + h1) | 0;
    h3 = (h3 + h1) | 0;
    h4 = (h4 + h1) | 0;
    return hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4);
  }

  private blocks(a: Uint32Array, start: number, count: number): void {
    let h1 = this.h1;
    let h2 = this.h2;
    let h3 = this.h3;
    let h4 = this.h4;
    const end = start + count * 4;
    for (let i = start; i < end; i += 4) {
      let k1 = a[i];
      let k2 = a[i + 1];
      let k3 = a[i + 2];
      let k4 = a[i + 3];

      k1 = Math.imul(k1, C1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, C2);
      h1 ^= k1;
      h1 = (h1 << 19) | (h1 >>> 13);
      h1 = (h1 + h2) | 0;
      h1 = (Math.imul(h1, 5) + 0x561ccd1b) | 0;

      k2 = Math.imul(k2, C2);
      k2 = (k2 << 16) | (k2 >>> 16);
      k2 = Math.imul(k2, C3);
      h2 ^= k2;
      h2 = (h2 << 17) | (h2 >>> 15);
      h2 = (h2 + h3) | 0;
      h2 = (Math.imul(h2, 5) + 0x0bcaa747) | 0;

      k3 = Math.imul(k3, C3);
      k3 = (k3 << 17) | (k3 >>> 15);
      k3 = Math.imul(k3, C4);
      h3 ^= k3;
      h3 = (h3 << 15) | (h3 >>> 17);
      h3 = (h3 + h4) | 0;
      h3 = (Math.imul(h3, 5) + 0x96cd1c35) | 0;

      k4 = Math.imul(k4, C4);
      k4 = (k4 << 18) | (k4 >>> 14);
      k4 = Math.imul(k4, C1);
      h4 ^= k4;
      h4 = (h4 << 13) | (h4 >>> 19);
      h4 = (h4 + h1) | 0;
      h4 = (Math.imul(h4, 5) + 0x32ac3b17) | 0;
    }
    this.h1 = h1;
    this.h2 = h2;
    this.h3 = h3;
    this.h4 = h4;
  }
}
