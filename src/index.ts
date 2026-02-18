import { FlagDefinition, FlagMap } from '@voidflag/schema';
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

type InferFlagValue<F extends FlagDefinition> = F extends { type: 'BOOLEAN' }
  ? boolean
  : F extends { type: 'STRING' }
    ? string
    : F extends { type: 'NUMBER' }
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
      return runtime.enabled
        ? (runtime.value as boolean)
        : (runtime.fallback as boolean);
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

export class VoidClient<S extends FlagMap> {
  private store: {
    [K in keyof S]: RuntimeFlag<S[K]>;
  };

  // One stable accessor object per flag key, created lazily on first call.
  private accessorCache: Partial<{
    [K in keyof S]: Accessor<S[K]>;
  }> = Object.create(null);

  // private accessorCache: Partial<{
  //   [K in keyof S]: Accessor<S[K]>;
  // }> = {};

  // Disposed guard — set to true after dispose() is called.
  #disposed = false;
  /**
   * Typed property-based access to all flags.
   *
   * @example
   * vf.flags.fontSize.value
   * vf.flags.themeColor.rollout
   */
  public readonly flags: {
    [K in keyof S]: Accessor<S[K]>;
  };
  constructor(schema: S) {
    type Store = { [K in keyof S]: RuntimeFlag<S[K]> };

    this.store = Object.create(null) as Store;

    for (const key in schema) {
      const def = schema[key];

      this.store[key] = {
        type: def.type,
        value: def.fallback as InferFlagValue<typeof def>,
        fallback: def.fallback as InferFlagValue<typeof def>,
        enabled: true,
      };
    }

    if (Object.keys(schema).length < EAGER_ACCESSOR_THRESHOLD) {
      this.flags = this.#buildEagerFlags(schema);
    } else {
      this.flags = this.#buildLazyFlagsObject(schema);
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
          runtime as RuntimeFlag<
            FlagDefinition & { type: 'STRING' | 'NUMBER' }
          >,
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
   * - BOOLEAN → value or fallback
   * - STRING/NUMBER → variant value or fallback
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
  isRolledOutFor<K extends RolloutCapableKeys<S>>(
    key: K,
    userId: string,
  ): boolean {
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
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new VoidFlagError(`Invalid flag key "${String(key)}"`);
    }

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
      value: f.enabled ? f.value : f.fallback,
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
    ) as { [K in keyof S]: Snapshot<S[K]> };
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
  }
}

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash;
}
