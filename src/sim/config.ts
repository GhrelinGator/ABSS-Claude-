// Run configuration. Plain data: everything that distinguishes one run from
// another lives here, and its canonical JSON form is part of every snapshot
// and state hash. Unknown keys are rejected, so a typo cannot silently
// leave a setting at its default.

export interface SimConfig {
  /** Run seed: an unsigned 32-bit integer. */
  readonly seed: number;
  readonly time: {
    /** Ticks per simulated day. 144 means 10-minute ticks. */
    readonly ticksPerDay: number;
    /** Days per simulated year (calendar compression, docs/DESIGN.md §1.1). */
    readonly daysPerYear: number;
  };
  readonly world: {
    readonly widthCells: number;
    readonly heightCells: number;
    /** Side of one environment cell, in metres. */
    readonly cellSizeM: number;
    /**
     * How hemmed in the land is, from 0 (open country) to 1 (a river valley
     * walled by dry uplands). Experiment E3's independent variable; see
     * docs/DESIGN.md §2.10.
     */
    readonly circumscription: number;
  };
  readonly climate: {
    /**
     * Size of year-to-year swings in warmth and wetness (droughts, wet
     * spells, cold years), from 0 (every year alike) upward; 1 is the
     * default. Experiment E1's independent variable; see docs/DESIGN.md §2.11.
     */
    readonly variability: number;
  };
}

/** The defaults from docs/DESIGN.md §1.1 and §1.2. */
export function defaultConfig(seed = 1): SimConfig {
  return validateConfig({
    seed,
    time: { ticksPerDay: 144, daysPerYear: 48 },
    world: { widthCells: 512, heightCells: 512, cellSizeM: 100, circumscription: 0.5 },
    climate: { variability: 1 },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function section(where: string, value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`Config: "${where}" must be an object.`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Config: unknown key "${where}.${key}".`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`Config: missing key "${where}.${key}".`);
  }
  return value;
}

function integer(where: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Config: "${where}" must be an integer in [${min}, ${max}], got ${String(value)}.`);
  }
  return value;
}

function fraction(where: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Config: "${where}" must be a number from 0 to 1, got ${String(value)}.`);
  }
  return value;
}

function between(where: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Config: "${where}" must be a number from ${min} to ${max}, got ${String(value)}.`);
  }
  return value;
}

function positive(where: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Config: "${where}" must be a positive number, got ${String(value)}.`);
  }
  return value;
}

/** Check a config and return a frozen, normalised copy. Throws on anything unexpected. */
export function validateConfig(input: unknown): SimConfig {
  const root = section('config', input, ['seed', 'time', 'world', 'climate']);
  const time = section('config.time', root.time, ['ticksPerDay', 'daysPerYear']);
  const world = section('config.world', root.world, ['widthCells', 'heightCells', 'cellSizeM', 'circumscription']);
  const climate = section('config.climate', root.climate, ['variability']);
  return Object.freeze({
    seed: integer('config.seed', root.seed, 0, 0xffffffff),
    time: Object.freeze({
      ticksPerDay: integer('config.time.ticksPerDay', time.ticksPerDay, 1, 86400),
      daysPerYear: integer('config.time.daysPerYear', time.daysPerYear, 1, 1000),
    }),
    world: Object.freeze({
      widthCells: integer('config.world.widthCells', world.widthCells, 1, 8192),
      heightCells: integer('config.world.heightCells', world.heightCells, 1, 8192),
      cellSizeM: positive('config.world.cellSizeM', world.cellSizeM),
      circumscription: fraction('config.world.circumscription', world.circumscription),
    }),
    climate: Object.freeze({
      variability: between('config.climate.variability', climate.variability, 0, 5),
    }),
  });
}

/** JSON with object keys in sorted order, so equal configs always produce equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: unsupported value of type ${typeof value}.`);
}

/** Width of the world in metres. */
export function worldWidthM(config: SimConfig): number {
  return config.world.widthCells * config.world.cellSizeM;
}

/** Height of the world in metres. */
export function worldHeightM(config: SimConfig): number {
  return config.world.heightCells * config.world.cellSizeM;
}
