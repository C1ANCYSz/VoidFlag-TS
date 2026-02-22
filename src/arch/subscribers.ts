import { FlagDefinition, FlagMap } from '../schema.js';

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
   Subscriber type
-------------------------------------------- */

type SubscriberCallback<F extends FlagDefinition> = (
  snapshot: Snapshot<F>,
  previous: Snapshot<F>,
) => void;

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
export class VoidClient<S extends FlagMap> {
  private store: {
    [K in keyof S]: RuntimeFlag<S[K]>;
  };

  // One stable accessor object per flag key, created lazily on first call.
  private accessorCache: Partial<{
    [K in keyof S]: Accessor<S[K]>;
  }> = {};

  // Subscribers per flag key.
  private subscribers: Partial<{
    [K in keyof S]: Set<SubscriberCallback<S[K]>>;
  }> = {};

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
    this.store = {} as {
      [K in keyof S]: RuntimeFlag<S[K]>;
    };

    for (const key in schema) {
      const def = schema[key];

      this.store[key] = {
        type: def.type,
        value: def.fallback as InferFlagValue<typeof def>,
        fallback: def.fallback as InferFlagValue<typeof def>,
        enabled: true,
      };
    }

    this.flags = new Proxy({} as any, {
      get: (_, key: string) => {
        this.#assertKeyExists(key);
        return this.flag(key as keyof S);
      },
    });
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

  #resolve<K extends keyof S>(key: K): NodeFor<S[K]> {
    const f = this.store[key];

    if (!f) {
      throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    }
    switch (f.type) {
      case 'BOOLEAN':
        return {
          enabled: f.enabled,
          value: f.enabled ? f.value : f.fallback,
          fallback: f.fallback,
        } as NodeFor<S[K]>;

      default:
        return {
          enabled: f.enabled,
          value: f.enabled ? f.value : f.fallback,
          fallback: f.fallback,
          rollout: f.rollout ?? 100,
        } as NodeFor<S[K]>;
    }
  }

  /* --------------------------------------------
     enabled() / allEnabled()

     enabled()    → single key, mirrors the natural SDK ergonomic.
     allEnabled() → convenience for "are all of these on?" gate checks.

     Both check store[k].enabled directly — consistent with get()
     for all types including KILLSWITCH.
  -------------------------------------------- */

  enabled<K extends keyof S>(key: K): boolean {
    this.#assertNotDisposed();
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
   * - KILLSWITCH → returns enabled state
   *
   * @example
   * ```ts
   * const size = vf.get("fontSize");
   * ```
   */
  get<K extends keyof S>(key: K): InferFlagValue<S[K]> {
    this.#assertNotDisposed();
    return this.#resolve(key).value as InferFlagValue<S[K]>;
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

    if (this.accessorCache[key] !== undefined) {
      return this.accessorCache[key]!;
    }

    const runtime = this.store[key];
    if (!runtime) {
      throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    }

    const assert = this.#assertNotDisposed.bind(this);

    let accessor: Accessor<S[K]>;

    switch (runtime.type) {
      case 'BOOLEAN':
        accessor = buildBooleanAccessor(
          assert,
          runtime as RuntimeFlag<FlagDefinition & { type: 'BOOLEAN' }>,
        ) as Accessor<S[K]>;
        break;

      default:
        accessor = buildVariantAccessor(
          assert,
          runtime as RuntimeFlag<FlagDefinition & { type: 'STRING' | 'NUMBER' }>,
        ) as Accessor<S[K]>;
        break;
    }

    this.accessorCache[key] = accessor;
    return accessor;
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
     subscribe()

     Register a callback that fires whenever a flag's
     resolved snapshot changes. Returns an unsubscribe
     function for easy cleanup.

     Usage:
       const unsub = client.subscribe('dark-mode', (next, prev) => {
         applyTheme(next.value);
       });
       // later:
       unsub();
  -------------------------------------------- */

  subscribe<K extends keyof S>(key: K, callback: SubscriberCallback<S[K]>): () => void {
    this.#assertNotDisposed();

    if (!this.subscribers[key]) {
      this.subscribers[key] = new Set() as Set<SubscriberCallback<S[K]>>;
    }

    (this.subscribers[key] as Set<SubscriberCallback<S[K]>>).add(callback);

    return () => {
      (this.subscribers[key] as Set<SubscriberCallback<S[K]>>).delete(callback);
    };
  }

  /* --------------------------------------------
     notify()

     Called internally after any store mutation.
     Fires subscribers for the changed key with
     next and previous snapshots.
  -------------------------------------------- */

  private notify<K extends keyof S>(key: K, previous: Snapshot<S[K]>) {
    const subs = this.subscribers[key] as Set<SubscriberCallback<S[K]>> | undefined;

    if (!subs || subs.size === 0) return;

    const next = this.snapshot(key);

    // Shallow compare: bail out if nothing the caller can observe has changed.
    // Snapshots are plain frozen objects with at most 4 keys — a full key
    // iteration is cheaper than a deep-equal library and avoids false fires.
    if (snapshotsEqual(next, previous)) return;

    subs.forEach((cb) => cb(next, previous));
  }

  /* --------------------------------------------
     hydrate() — internal store mutation.
     Notifies subscribers after patching.
  -------------------------------------------- */

  hydrate<K extends keyof S>(key: K, data: Partial<RuntimeFlag<S[K]>>) {
    const previous = this.snapshot(key);
    Object.assign(this.store[key], data);
    this.notify(key, previous);
  }

  /* --------------------------------------------
     snapshot() / debug()
  -------------------------------------------- */

  snapshot<K extends keyof S>(key: K): Snapshot<S[K]> {
    this.#assertNotDisposed();
    return Object.freeze({ ...this.#resolve(key) });
  }

  /**
   * Returns a full snapshot of every flag in the store.
   * Intended for development/debugging only — allocates one frozen object
   * per flag. Do not call in hot paths or production monitoring loops.
   */
  debugSnapshots(): { [K in keyof S]: Snapshot<S[K]> } {
    this.#assertNotDisposed();
    return Object.fromEntries(
      Object.keys(this.store).map((k) => [k, this.snapshot(k as keyof S)]),
    ) as { [K in keyof S]: Snapshot<S[K]> };
  }

  /* --------------------------------------------
     Cache / Lifecycle
  -------------------------------------------- */

  private clearCache(key?: keyof S) {
    if (key) delete this.accessorCache[key];
    else this.accessorCache = {};
  }

  dispose() {
    if (this.#disposed) return; // idempotent

    // Mark disposed FIRST so any in-flight getter calls thrown immediately.
    // We intentionally do NOT wipe the store — accessors hold a reference
    // to runtime objects and would silently read stale data if we replaced
    // store with {}. Instead, the #disposed flag + #assertNotDisposed() in
    // every getter is the single source of truth.
    this.#disposed = true;

    this.clearCache();
    this.subscribers = {};
  }
}

/* --------------------------------------------
   Helpers
-------------------------------------------- */

/**
 * Fast, deterministic non-cryptographic string hash (djb2).
 * Produces a stable bucket index for rollout evaluation.
 */
function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash >>> 0); // coerce to unsigned 32-bit
}

/**
 * Shallow equality check for flag snapshots.
 * Snapshots have at most 4 primitive keys (enabled, value, fallback, rollout)
 * so a full key walk is cheaper and safer than any deep-equal library.
 */
function snapshotsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
