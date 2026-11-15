// Named per-cell layers of the environment grid (terrain, water, vegetation,
// and so on). Phase 0 only provides the container; Phase 1 declares layers.

import type { DType, Sink, Source, TypedArray } from './codec.ts';
import { allocArray } from './codec.ts';

interface Layer {
  readonly name: string;
  readonly dtype: DType;
  readonly data: TypedArray;
}

export class GridLayers {
  readonly name = 'world.layers';
  readonly holdsLearned = false;
  readonly widthCells: number;
  readonly heightCells: number;

  private readonly layers: Layer[] = [];
  private readonly byName = new Map<string, Layer>();
  private sealed = false;

  constructor(widthCells: number, heightCells: number) {
    this.widthCells = widthCells;
    this.heightCells = heightCells;
  }

  /** Declare a layer (one value per cell), or fetch it if it was already declared with the same element type. */
  ensureLayer<T extends TypedArray = TypedArray>(name: string, dtype: DType): T {
    const existing = this.byName.get(name);
    if (existing) {
      if (existing.dtype !== dtype) throw new Error(`Layer "${name}" was declared twice with different element types.`);
      return existing.data as T;
    }
    if (this.sealed) throw new Error(`Layer "${name}" was declared after the grid was sealed.`);
    const layer: Layer = { name, dtype, data: allocArray(dtype, this.widthCells * this.heightCells) };
    this.layers.push(layer);
    this.byName.set(name, layer);
    return layer.data as T;
  }

  layer<T extends TypedArray = TypedArray>(name: string): T {
    const layer = this.byName.get(name);
    if (!layer) throw new Error(`The grid has no layer "${name}".`);
    return layer.data as T;
  }

  layerNames(): string[] {
    return this.layers.map((layer) => layer.name);
  }

  seal(): void {
    this.sealed = true;
  }

  write(sink: Sink): void {
    sink.u32(this.widthCells);
    sink.u32(this.heightCells);
    sink.u32(this.layers.length);
    for (const layer of this.layers) {
      sink.str(layer.name);
      sink.array(layer.data);
    }
  }

  read(source: Source): void {
    const widthCells = source.u32();
    const heightCells = source.u32();
    const nlayers = source.u32();
    if (widthCells !== this.widthCells || heightCells !== this.heightCells || nlayers !== this.layers.length) {
      throw new Error('Snapshot grid does not match the grid this pipeline declares.');
    }
    for (const layer of this.layers) {
      const name = source.str();
      if (name !== layer.name) throw new Error(`Snapshot layer "${name}" does not match "${layer.name}".`);
      const data = source.array(layer.dtype);
      if (data.length !== layer.data.length) throw new Error(`Snapshot layer "${name}" has the wrong length.`);
      layer.data.set(data);
    }
  }
}
