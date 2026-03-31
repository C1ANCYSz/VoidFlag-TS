import {
  BooleanFlag,
  FlagDefinition,
  FlagMap,
  NumberFlag,
  StringFlag,
} from '../schema.js';
const EAGER_ACCESSOR_THRESHOLD = 2;

export class VoidFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoidFlagError';
  }
}

/* --------------------------------------------
   Type Helpers
-------------------------------------------- */

// type InferFlagValue<F extends FlagDefinition> = F extends { type: 'BOOLEAN' }
//   ? boolean
//   : F extends { type: 'STRING' }
//     ? string
//     : F extends { type: 'NUMBER' }
//       ? number
//       : never;
type InferFlagValue<F extends FlagDefinition> = F extends BooleanFlag
  ? boolean
  : F extends StringFlag
    ? string
    : F extends NumberFlag
      ? number
      : never;

/* --------------------------------------------
   Runtime Flag Shape
-------------------------------------------- */

export type RuntimeFlag<F extends FlagDefinition> = {
  type: F['type'];

  value: InferFlagValue<F>;
  fallback: InferFlagValue<F>;

  enabled: boolean;

  rollout?: number;
};
type SeedingProps = {
  enabled?: boolean;
  value?: boolean | string | number;
  rollout?: number;
};

type SeedMap<S extends FlagMap> = {
  [K in keyof S]?: S[K] extends { type: 'BOOLEAN' }
    ? {
        value?: boolean;
        enabled?: boolean;
      }
    : {
        value?: InferFlagValue<S[K]>;
        enabled?: boolean;
        rollout?: number;
      };
};

/* --------------------------------------------
   Node Shapes (Compile-time Correct)
-------------------------------------------- */

type BooleanNode = {
  value: boolean;
  fallback: boolean;
  enabled: boolean;
};

type VariantNode<T> = {
  value: T;
  fallback: T;
  enabled: boolean;
  rollout: number;
};

type NodeFor<F extends FlagDefinition> = F extends { type: 'BOOLEAN' }
  ? BooleanNode
  : VariantNode<InferFlagValue<F>>;

/* --------------------------------------------
   Accessor / Snapshot Shape
-------------------------------------------- */
type RolloutCapableKeys<S extends FlagMap> = {
  [K in keyof S]: NodeFor<S[K]> extends { rollout: number } ? K : never;
}[keyof S];

export type Accessor<F extends FlagDefinition> = Readonly<NodeFor<F>>;
export type Snapshot<F extends FlagDefinition> = Readonly<NodeFor<F>>;

/* --------------------------------------------
   VoidClient
-------------------------------------------- */

function buildBooleanAccessor(
  assertNotDisposed: () => void,
  runtime: RuntimeFlag<FlagDefinition & { type: 'BOOLEAN' }>,
): Readonly<BooleanNode> {
  const node = {} as BooleanNode;
  Object.defineProperty(node, 'enabled', {
    get(): boolean {
      assertNotDisposed();
      return runtime.enabled;
    },
    enumerable: true,
  });
  Object.defineProperty(node, 'value', {
    get(): boolean {
      assertNotDisposed();
      return runtime.enabled ? (runtime.value as boolean) : (runtime.fallback as boolean);
    },
    enumerable: true,
  });
  Object.defineProperty(node, 'fallback', {
    get(): boolean {
      assertNotDisposed();
      return runtime.fallback as boolean;
    },
    enumerable: true,
  });
  return Object.freeze(node);
}

function buildVariantAccessor<T extends string | number>(
  assertNotDisposed: () => void,
  runtime: RuntimeFlag<FlagDefinition & { type: 'STRING' | 'NUMBER' }>,
): Readonly<VariantNode<T>> {
  const node = {} as VariantNode<T>;
  Object.defineProperty(node, 'enabled', {
    get(): boolean {
      assertNotDisposed();
      return runtime.enabled;
    },
    enumerable: true,
  });
  Object.defineProperty(node, 'value', {
    get(): T {
      assertNotDisposed();
      return (runtime.enabled ? runtime.value : runtime.fallback) as T;
    },
    enumerable: true,
  });
  Object.defineProperty(node, 'fallback', {
    get(): T {
      assertNotDisposed();
      return runtime.fallback as T;
    },
    enumerable: true,
  });
  Object.defineProperty(node, 'rollout', {
    get(): number {
      assertNotDisposed();
      return runtime.rollout ?? 100;
    },
    enumerable: true,
  });
  return Object.freeze(node);
}
interface ClientOptions<S extends FlagMap> {
  schema: S;
  seedingSchema?: SeedMap<S>; // ✅ now linked to S
  apiKey?: string;
}

export class VoidClient<S extends FlagMap> {
  #disposed = false;

  private store: {
    [K in keyof S]: RuntimeFlag<S[K]>;
  };

  private accessorCache: Partial<{
    [K in keyof S]: Accessor<S[K]>;
  }> = Object.create(null);

  public readonly flags: {
    [K in keyof S]: Accessor<S[K]>;
  };

  constructor(opts: ClientOptions<S>) {
    type Store = { [K in keyof S]: RuntimeFlag<S[K]> };
    this.store = Object.create(null) as Store;

    for (const key in opts.schema) {
      const def = opts.schema[key];

      this.store[key] = {
        type: def.type,
        value: def.fallback as InferFlagValue<typeof def>,
        fallback: def.fallback as InferFlagValue<typeof def>,
        enabled: true,
      };
    }
    if (opts.seedingSchema) {
      this.seed(opts.seedingSchema);
    }

    if (Object.keys(opts.schema).length < EAGER_ACCESSOR_THRESHOLD) {
      this.flags = this.#buildEagerFlags(opts.schema);
    } else {
      this.flags = this.#buildLazyFlagsObject(opts.schema);
    }
  }
  /* --------------------------------------------
   seed()

   Bulk-overrides flag values before the client
   is used in earnest — intended to be called once
   at startup with a local seed file so consumers
   can develop/test without hitting your server.

   Accepts a partial map of flag keys → partial
   RuntimeFlag overrides. Unknown keys throw to
   catch typos in seed files early.

   Returns `this` for chaining:
     const vf = new VoidClient(schema).seed(localSeeds);

   In production, call seed() before any network
   hydration — server values will overwrite seeds
   via hydrate() as normal.
-------------------------------------------- */
  seed(overrides: SeedMap<S>): this {
    this.#assertNotDisposed();

    for (const rawKey in overrides) {
      this.#assertSafeKey(rawKey);

      const key = rawKey as keyof S;
      this.#assertKeyExists(key);

      const patch = overrides[key];
      if (!patch) continue;

      const runtime = this.store[key];

      // --- value type runtime guard ---
      if (patch.value !== undefined) {
        if (runtime.type === 'BOOLEAN' && typeof patch.value !== 'boolean') {
          throw new VoidFlagError(`seed(): "${String(key)}" expects boolean`);
        }

        if (runtime.type === 'STRING' && typeof patch.value !== 'string') {
          throw new VoidFlagError(`seed(): "${String(key)}" expects string`);
        }

        if (runtime.type === 'NUMBER' && typeof patch.value !== 'number') {
          throw new VoidFlagError(`seed(): "${String(key)}" expects number`);
        }
      }

      // --- rollout guard ---
      if ('rollout' in patch && patch.rollout !== undefined) {
        if (runtime.type === 'BOOLEAN') {
          throw new VoidFlagError(
            `seed(): "${String(key)}" is BOOLEAN and cannot have rollout`,
          );
        }

        if (patch.rollout < 0 || patch.rollout > 100) {
          throw new VoidFlagError(
            `seed(): "${String(key)}" rollout must be between 0–100`,
          );
        }
      }

      Object.assign(runtime, patch);
    }

    return this;
  }

  #assertSafeKey(key: string) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new VoidFlagError(`Invalid flag key "${key}"`);
    }
  }

  #buildEagerFlags(schema: S): Readonly<{ [K in keyof S]: Accessor<S[K]> }> {
    const flags = {} as { [K in keyof S]: Accessor<S[K]> };

    for (const key in schema) {
      const accessor = this.#buildAccessor(key);
      this.accessorCache[key] = accessor;
      flags[key] = accessor;
    }

    return Object.freeze(flags);
  }

  #buildLazyFlagsObject(schema: S) {
    const flags = {} as { [K in keyof S]: Accessor<S[K]> };

    for (const key in schema) {
      Object.defineProperty(flags, key, {
        get: () => this.flag(key),
        enumerable: true,
      });
    }

    return Object.seal(flags);
  }

  #buildAccessor<K extends keyof S>(key: K): Accessor<S[K]> {
    const runtime = this.store[key];
    const assert = this.#assertNotDisposed.bind(this);

    switch (runtime.type) {
      case 'BOOLEAN':
        return buildBooleanAccessor(
          assert,
          runtime as RuntimeFlag<FlagDefinition & { type: 'BOOLEAN' }>,
        ) as Accessor<S[K]>;
      default:
        return buildVariantAccessor(
          assert,
          runtime as RuntimeFlag<FlagDefinition & { type: 'STRING' | 'NUMBER' }>,
        ) as Accessor<S[K]>;
    }
  }
  /* --------------------------------------------
     Disposed Guard
  -------------------------------------------- */

  #assertNotDisposed() {
    if (this.#disposed) {
      throw new VoidFlagError(
        'VoidClient has been disposed. Create a new instance to continue using flags.',
      );
    }
  }

  /* --------------------------------------------
     Typed Flag Access (No rollout on BOOLEAN)
  -------------------------------------------- */

  /* --------------------------------------------
     enabled() / allEnabled()

     enabled()    → single key, mirrors the natural SDK ergonomic.
     allEnabled() → convenience for "are all of these on?" gate checks.

     Both check store[k].enabled directly — consistent with get()
     for all types including KILLSWITCH.
  -------------------------------------------- */

  enabled<K extends keyof S>(key: K): boolean {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    return this.store[key].enabled;
  }

  allEnabled(keys: (keyof S)[]): boolean {
    this.#assertNotDisposed();
    return keys.every((k) => this.enabled(k));
  }

  /* --------------------------------------------
     get()

     Returns the resolved scalar value for a flag.
     - KILLSWITCH → returns enabled (boolean)
     - Others     → returns value if enabled, fallback otherwise
  -------------------------------------------- */

  /**
   * Returns the resolved scalar value of a flag.
   *
   * - enabled  → value
   * - disabled → fallback
   *
   * @example
   * ```ts
   * const size = vf.get("fontSize");
   * ```
   */
  get<K extends keyof S>(key: K): InferFlagValue<S[K]> {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    const f = this.store[key];
    return (f.enabled ? f.value : f.fallback) as InferFlagValue<S[K]>;
  }

  /* --------------------------------------------
     flag()

     Returns a stable live reference to the flag.
     The same object is returned on every call — reads are always current.
     For a one-time snapshot, use snapshot() instead.
  -------------------------------------------- */
  /**
   * Returns a stable live accessor for a flag.
   *
   * This object is cached and does not allocate on repeated calls.
   *
   * @example
   * ```ts
   * const flag = vf.flag("themeColor");
   * console.log(flag.value);
   * console.log(flag.enabled);
   * ```
   */
  flag<K extends keyof S>(key: K): Accessor<S[K]> {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    if (!this.accessorCache[key]) {
      this.accessorCache[key] = this.#buildAccessor(key);
    }
    return this.accessorCache[key]!;
  }
  #assertKeyExists(key: keyof S) {
    if (!this.store[key]) {
      throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    }
  }
  /* --------------------------------------------
     isRolledOutFor()

     Evaluates whether a given user ID falls within
     the flag's rollout percentage using a stable
     deterministic hash. Non-variant flags (KILLSWITCH,
     BOOLEAN) are not subject to rollout — returns
     enabled state directly.
  -------------------------------------------- */
  isRolledOutFor<K extends RolloutCapableKeys<S>>(key: K, userId: string): boolean {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    const f = this.store[key];

    if (!f.enabled) return false;

    const rollout = f.rollout ?? 100;
    if (rollout >= 100) return true;
    if (rollout <= 0) return false;

    const bucket = stableHash(`${String(key)}:${userId}`) % 100;
    return bucket < rollout;
  }

  /* --------------------------------------------
     hydrate() — internal store mutation.
  -------------------------------------------- */

  hydrate<K extends keyof S>(key: K, data: Partial<RuntimeFlag<S[K]>>) {
    this.#assertNotDisposed();

    // 🚨 Prototype pollution guard

    this.#assertSafeKey(String(key));
    this.#assertKeyExists(key);

    // Safe merge
    Object.assign(this.store[key], data);
  }

  /* --------------------------------------------
     snapshot() / debug()
  -------------------------------------------- */

  snapshot<K extends keyof S>(key: K): Snapshot<S[K]> {
    this.#assertNotDisposed();
    const f = this.store[key];
    if (!f) throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    const base = {
      enabled: f.enabled,
      value: f.value,
      fallback: f.fallback,
    };
    return Object.freeze(
      f.type === 'BOOLEAN' ? base : { ...base, rollout: f.rollout ?? 100 },
    ) as Snapshot<S[K]>;
  }

  debugSnapshots(): { [K in keyof S]: Snapshot<S[K]> } {
    this.#assertNotDisposed();
    return Object.fromEntries(
      Object.keys(this.store).map((k) => [k, this.snapshot(k as keyof S)]),
    ) as {
      [K in keyof S]: Snapshot<S[K]>;
    };
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
  }
}

function stableHash(input: string): number {
  //djb2
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash;
}
