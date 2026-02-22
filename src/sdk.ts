import {
  BooleanFlag,
  FlagDefinition,
  FlagMap,
  NumberFlag,
  StringFlag,
} from './schema.js';

import { PollingTransport, SSETransport } from './transport.js';

const EAGER_ACCESSOR_THRESHOLD = 2;

const BASE_URL = 'http://localhost:3000';

export class VoidFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoidFlagError';
  }
}

/* --------------------------------------------
   Type Helpers
-------------------------------------------- */

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
  rollout: number;
};

/* --------------------------------------------
   Unified Node / Accessor / Snapshot Shape
-------------------------------------------- */
type applyPatch = {
  value?: InferFlagValue<FlagDefinition>;
  enabled?: boolean;
  rollout?: number;
};
type SafeUpdate = {
  value?: boolean | string | number;
  enabled?: boolean;
  rollout?: number;
};
type FlagNode<T> = {
  value: T;
  fallback: T;
  enabled: boolean;
  rollout: number;
};

type NodeFor<F extends FlagDefinition> = FlagNode<InferFlagValue<F>>;

export type Accessor<F extends FlagDefinition> = Readonly<NodeFor<F>>;
export type Snapshot<F extends FlagDefinition> = Readonly<NodeFor<F>>;

/* --------------------------------------------
   StateMap / Client Options
-------------------------------------------- */

type StateMap<S extends FlagMap> = {
  [K in keyof S]?: {
    value?: InferFlagValue<S[K]>;
    enabled?: boolean;
    rollout?: number;
  };
};

interface ClientOptions<S extends FlagMap> {
  schema: S;
  applyStateSchema?: StateMap<S>;
  apiKey?: string;
}

/* --------------------------------------------
   Accessor Builder
-------------------------------------------- */

function buildAccessor<T extends boolean | string | number>(
  assertNotDisposed: () => void,
  runtime: RuntimeFlag<FlagDefinition>,
): Readonly<FlagNode<T>> {
  const node = {} as FlagNode<T>;

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
      return runtime.rollout;
    },
    enumerable: true,
  });

  return Object.freeze(node);
}

/* --------------------------------------------
   VoidClient
-------------------------------------------- */
interface Transport {
  start(): void;
  stop(): void;
}
export class VoidClient<S extends FlagMap> {
  #disposed = false;
  private apiKey?: string;
  private transport?: Transport;
  private connected = false;
  private store: { [K in keyof S]: RuntimeFlag<S[K]> };
  private accessorCache: Partial<{ [K in keyof S]: Accessor<S[K]> }> =
    Object.create(null);

  public readonly flags: { [K in keyof S]: Accessor<S[K]> };

  constructor(opts: ClientOptions<S>) {
    type Store = { [K in keyof S]: RuntimeFlag<S[K]> };
    this.store = Object.create(null) as Store;
    this.apiKey = opts.apiKey;
    for (const key in opts.schema) {
      const def = opts.schema[key];
      this.store[key] = {
        type: def.type,
        value: def.fallback as InferFlagValue<typeof def>,
        fallback: def.fallback as InferFlagValue<typeof def>,
        enabled: true,
        rollout: def.type === 'BOOLEAN' ? 0 : 100,
      };
    }

    if (opts.applyStateSchema) {
      this.applyState(opts.applyStateSchema);
    }

    this.flags =
      Object.keys(opts.schema).length < EAGER_ACCESSOR_THRESHOLD
        ? this.#buildEagerFlags(opts.schema)
        : this.#buildLazyFlagsObject(opts.schema);
  }
  private validateRollout(value: number, key: string) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new VoidFlagError(
        `applyState(): "${key}" rollout must be an integer between 0 and 100`,
      );
    }
  }

  #validatePatch(key: string, patch: applyPatch): SafeUpdate {
    const runtime = this.store[key as keyof S];
    const safeUpdate: Record<string, unknown> = {};

    if (patch.value !== undefined) {
      if (patch.value === null) {
        throw new VoidFlagError(`"${key}" value must not be null`);
      }
      switch (runtime.type) {
        case 'BOOLEAN':
          if (typeof patch.value !== 'boolean')
            throw new VoidFlagError(`"${key}" expects boolean`);
          break;
        case 'STRING':
          if (typeof patch.value !== 'string')
            throw new VoidFlagError(`"${key}" expects string`);
          break;
        case 'NUMBER':
          if (typeof patch.value !== 'number')
            throw new VoidFlagError(`"${key}" expects number`);
          if (!Number.isFinite(patch.value))
            throw new VoidFlagError(`"${key}" expects a finite number`);
          break;
      }
      safeUpdate.value = patch.value;
    }

    if (patch.enabled !== undefined) {
      if (patch.enabled === null || typeof patch.enabled !== 'boolean')
        throw new VoidFlagError(`"${key}" enabled must be a boolean`);
      safeUpdate.enabled = patch.enabled;
    }

    if (patch.rollout !== undefined) {
      this.validateRollout(patch.rollout, key);
      safeUpdate.rollout = patch.rollout;
    }

    return safeUpdate;
  }

  async connect(): Promise<void> {
    this.#assertNotDisposed();

    if (!this.apiKey) return;

    const res = await fetch(`${BASE_URL}/v1/connect`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (!res.ok) {
      // fail silently — flags fallback still work
      return;
    }

    const data = await res.json();

    // 1️⃣ hydrate initial snapshot
    for (const key in data.flags) {
      this.hydrate(key as keyof S, data.flags[key]);
    }

    // 2️⃣ choose transport (server decides)
    if (data.transport === 'polling') {
      this.transport = new PollingTransport(
        this,
        this.apiKey,
        data.pollInterval ?? 60000,
      );
    }

    if (data.transport === 'sse') {
      this.transport = new SSETransport(this, BASE_URL, data.streamUrl);
    }

    this.transport?.start();
    this.connected = true;
  }

  /* --------------------------------------------
   applyState()
-------------------------------------------- */
  applyState(overrides: StateMap<S>): this {
    this.#assertNotDisposed();

    for (const rawKey in overrides) {
      this.#assertSafeKey(rawKey);

      const key = rawKey as keyof S;
      this.#assertKeyExists(key);

      const patch = overrides[key];
      if (patch == null) continue; // only skips null and undefined

      const runtime = this.store[key];

      /* ----------------------------
       Value Validation
    ---------------------------- */
      if (patch.value !== undefined) {
        switch (runtime.type) {
          case 'BOOLEAN':
            if (typeof patch.value !== 'boolean') {
              throw new VoidFlagError(`applyState(): "${String(key)}" expects boolean`);
            }
            break;

          case 'STRING':
            if (typeof patch.value !== 'string') {
              throw new VoidFlagError(`applyState(): "${String(key)}" expects string`);
            }
            break;

          case 'NUMBER':
            if (Number.isNaN(patch.value)) {
            }
            if (typeof patch.value !== 'number') {
              throw new VoidFlagError(`applyState(): "${String(key)}" expects number`);
            }
            break;
        }
      }

      /* ----------------------------
       Rollout Validation
    ---------------------------- */
      if (patch.rollout !== undefined) {
        this.validateRollout(patch.rollout, String(key));
      }

      /* ----------------------------
       Apply Patch
    ---------------------------- */
      Object.assign(runtime, patch);
    }

    return this;
  }
  #assertNaN(value: number, key: string) {
    if (Number.isNaN(value)) {
      throw new VoidFlagError(`applyState(): "${String(key)}" expects number`);
    }
  }
  /* --------------------------------------------
     flag() — stable live accessor
  -------------------------------------------- */
  flag<K extends keyof S>(key: K): Accessor<S[K]> {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    if (!this.accessorCache[key]) {
      this.accessorCache[key] = this.#buildAccessor(key);
    }
    return this.accessorCache[key]!;
  }

  /* --------------------------------------------
     get() — resolved scalar value
  -------------------------------------------- */
  get<K extends keyof S>(key: K): InferFlagValue<S[K]> {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    const f = this.store[key];

    return (f.enabled ? f.value : f.fallback) as InferFlagValue<S[K]>;
  }

  /* --------------------------------------------
     enabled() / allEnabled()
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
     isRolledOutFor()
  -------------------------------------------- */
  isRolledOutFor<K extends keyof S>(key: K, userId: string): boolean {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    if (typeof userId !== 'string') {
      throw new VoidFlagError(`isRolledOutFor(): userId must be a string`);
    }
    const f = this.store[key];

    if (!f.enabled) return false;
    if (f.rollout >= 100) return true;
    if (f.rollout <= 0) return false;

    const bucket = stableHash(`${String(key)}:${userId}`) % 100;
    return bucket < f.rollout;
  }

  /* --------------------------------------------
     hydrate()
  -------------------------------------------- */
  hydrate<K extends keyof S>(key: K, data: Partial<RuntimeFlag<S[K]>>) {
    this.#assertNotDisposed();
    this.#assertSafeKey(String(key));
    this.#assertKeyExists(key);
    Object.assign(this.store[key], data);
  }

  /* --------------------------------------------
     snapshot() / debugSnapshots()
  -------------------------------------------- */
  snapshot<K extends keyof S>(key: K): Snapshot<S[K]> {
    this.#assertNotDisposed();
    const f = this.store[key];
    if (!f) throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    return Object.freeze({
      enabled: f.enabled,
      value: f.value,
      fallback: f.fallback,
      rollout: f.rollout,
    }) as Snapshot<S[K]>;
  }

  debugSnapshots(): { [K in keyof S]: Snapshot<S[K]> } {
    this.#assertNotDisposed();
    return Object.fromEntries(
      Object.keys(this.store).map((k) => [k, this.snapshot(k as keyof S)]),
    ) as { [K in keyof S]: Snapshot<S[K]> };
  }

  dispose() {
    if (this.#disposed) return;
    this.transport?.stop();
    this.#disposed = true;
  }
  /* --------------------------------------------
     Private Helpers
  -------------------------------------------- */

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

  isConnected(): boolean {
    return this.connected;
  }
  #buildAccessor<K extends keyof S>(key: K): Accessor<S[K]> {
    return buildAccessor(
      this.#assertNotDisposed.bind(this),
      this.store[key] as RuntimeFlag<FlagDefinition>,
    ) as Accessor<S[K]>;
  }

  #assertNotDisposed() {
    if (this.#disposed) {
      throw new VoidFlagError(
        'VoidClient has been disposed. Create a new instance to continue using flags.',
      );
    }
  }

  #assertSafeKey(key: string) {
    if (
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      key === 'toString' ||
      key === 'valueOf'
    ) {
      throw new VoidFlagError(`Invalid flag key "${key}"`);
    }
  }

  #assertKeyExists(key: keyof S) {
    if (!this.store[key]) {
      throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    }
  }
}

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash;
}
