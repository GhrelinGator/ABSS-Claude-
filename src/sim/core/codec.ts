// Canonical binary encoding of simulation state. Design: docs/DESIGN.md §1.5.
//
// Every value is written as little-endian bytes padded to a 4-byte boundary,
// so a sequence of writes is also a sequence of 32-bit words. Two sinks
// consume that sequence: ByteSink keeps the bytes (snapshots) and HashSink
// feeds the words to a Hasher (state hashes). Both are driven by the same
// write routines, so a snapshot and its hash can never describe different
// things.

import type { Hasher } from './hash.ts';

export type TypedArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array;

export type DType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'f64';

const DTYPE_CODE: Readonly<Record<DType, number>> = {
  u8: 1,
  i8: 2,
  u16: 3,
  i16: 4,
  u32: 5,
  i32: 6,
  f32: 7,
  f64: 8,
};

if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) {
  throw new Error('Big-endian platforms are not supported.');
}

export function allocArray(dtype: DType, length: number): TypedArray {
  switch (dtype) {
    case 'u8':
      return new Uint8Array(length);
    case 'i8':
      return new Int8Array(length);
    case 'u16':
      return new Uint16Array(length);
    case 'i16':
      return new Int16Array(length);
    case 'u32':
      return new Uint32Array(length);
    case 'i32':
      return new Int32Array(length);
    case 'f32':
      return new Float32Array(length);
    case 'f64':
      return new Float64Array(length);
  }
}

export function dtypeOf(a: TypedArray): DType {
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint8Array) return 'u8';
  return 'i8';
}

export function isFloatDType(dtype: DType): boolean {
  return dtype === 'f32' || dtype === 'f64';
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function checkU32(v: number): void {
  if (!(Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) {
    throw new RangeError(`Expected an unsigned 32-bit integer, got ${v}`);
  }
}

function checkFinite(v: number): void {
  if (!Number.isFinite(v)) throw new RangeError(`Expected a finite number, got ${v}`);
}

function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i) as number;
    if (c > 0xffff) i++;
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return Uint8Array.from(out);
}

function utf8Decode(b: Uint8Array, start: number, end: number): string {
  let s = '';
  let i = start;
  while (i < end) {
    const b0 = b[i++];
    let c: number;
    if (b0 < 0x80) {
      c = b0;
    } else if (b0 < 0xe0) {
      c = ((b0 & 31) << 6) | (b[i++] & 63);
    } else if (b0 < 0xf0) {
      c = ((b0 & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    } else {
      c = ((b0 & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    }
    s += String.fromCodePoint(c);
  }
  return s;
}

/** Destination for the canonical encoding. */
export interface Sink {
  /** An unsigned 32-bit integer. */
  u32(v: number): void;
  /** A finite double. */
  f64(v: number): void;
  /** A string (UTF-8, length-prefixed). */
  str(s: string): void;
  /** A typed array: element type, element count, then the raw elements. */
  array(a: TypedArray): void;
}

/** Collects the canonical encoding as bytes. */
export class ByteSink implements Sink {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  u32(v: number): void {
    checkU32(v);
    this.reserve(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  f64(v: number): void {
    checkFinite(v);
    this.reserve(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }

  str(s: string): void {
    const b = utf8Encode(s);
    this.u32(b.length);
    this.raw(b);
  }

  array(a: TypedArray): void {
    this.u32(DTYPE_CODE[dtypeOf(a)]);
    this.u32(a.length);
    this.raw(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }

  /** A copy of everything written so far. */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }

  private raw(b: Uint8Array): void {
    const padded = pad4(b.length);
    this.reserve(padded);
    this.buf.set(b, this.pos);
    // Padding bytes stay zero: this region of the buffer has never been written.
    this.pos += padded;
  }

  private reserve(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let capacity = this.buf.length * 2;
    while (capacity < this.pos + n) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
}

const F64_SCRATCH = new Float64Array(1);
const F64_SCRATCH_WORDS = new Uint32Array(F64_SCRATCH.buffer);

/** Feeds the canonical encoding to a Hasher, word for word what ByteSink would store. */
export class HashSink implements Sink {
  private readonly hasher: Hasher;

  constructor(hasher: Hasher) {
    this.hasher = hasher;
  }

  u32(v: number): void {
    checkU32(v);
    this.hasher.u32(v);
  }

  f64(v: number): void {
    checkFinite(v);
    F64_SCRATCH[0] = v;
    this.hasher.u32(F64_SCRATCH_WORDS[0]);
    this.hasher.u32(F64_SCRATCH_WORDS[1]);
  }

  str(s: string): void {
    const b = utf8Encode(s);
    this.u32(b.length);
    this.raw(b);
  }

  array(a: TypedArray): void {
    this.u32(DTYPE_CODE[dtypeOf(a)]);
    this.u32(a.length);
    this.raw(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }

  private raw(b: Uint8Array): void {
    const whole = b.length >>> 2;
    if (whole > 0) {
      if (b.byteOffset % 4 === 0) {
        this.hasher.words(new Uint32Array(b.buffer, b.byteOffset, whole));
      } else {
        const aligned = new Uint8Array(whole * 4);
        aligned.set(b.subarray(0, whole * 4));
        this.hasher.words(new Uint32Array(aligned.buffer));
      }
    }
    const rest = b.length & 3;
    if (rest > 0) {
      const base = whole * 4;
      let w = 0;
      for (let i = 0; i < rest; i++) w |= b[base + i] << (8 * i);
      this.hasher.u32(w >>> 0);
    }
  }
}

/** Hash bytes produced by a ByteSink. The result equals what a HashSink would have produced for the same writes. */
export function hashEncodedBytes(hasher: Hasher, bytes: Uint8Array): void {
  if (bytes.length % 4 !== 0) throw new RangeError('Encoded byte length must be a multiple of 4.');
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  hasher.words(new Uint32Array(aligned.buffer));
}

/** Reads back what a ByteSink wrote. */
export class Source {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.buf = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  str(): string {
    const n = this.u32();
    this.need(pad4(n));
    const s = utf8Decode(this.buf, this.pos, this.pos + n);
    this.pos += pad4(n);
    return s;
  }

  /** Read a typed array, checking that it has the expected element type. Returns a fresh copy. */
  array(dtype: DType): TypedArray {
    const code = this.u32();
    if (code !== DTYPE_CODE[dtype]) {
      throw new Error(`Snapshot holds element type code ${code} where ${dtype} (${DTYPE_CODE[dtype]}) was expected.`);
    }
    const n = this.u32();
    const out = allocArray(dtype, n);
    const nbytes = out.byteLength;
    this.need(pad4(nbytes));
    new Uint8Array(out.buffer).set(this.buf.subarray(this.pos, this.pos + nbytes));
    this.pos += pad4(nbytes);
    return out;
  }

  /** True once every byte has been read. */
  get done(): boolean {
    return this.pos === this.buf.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error('Snapshot ended unexpectedly.');
  }
}
