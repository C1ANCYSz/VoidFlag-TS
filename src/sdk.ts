import {
  BooleanFlag,
  FlagDefinition,
  FlagMap,
  NumberFlag,
  StringFlag,
} from './schema.js';
import { RESERVED_KEYS } from '@voidflag/shared';
import { PollingTransport, SSETransport } from './transport.js';
import { VoidFlagError } from './VoidFlagError.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_PATCH_KEYS = new Set(['value', 'enabled', 'rollout'] as const);

const BASE_URL = 'http://localhost:3000/api';

// ─── Type Helpers ─────────────────────────────────────────────────────────────

type InferFlagValue<F extends FlagDefinition> = F extends BooleanFlag
  ? boolean
  : F extends StringFlag
    ? string
    : F extends NumberFlag
      ? number
      : never;

// ─── Runtime Flag Shape ───────────────────────────────────────────────────────

export type RuntimeFlag<F extends FlagDefinition> = {
  type: F['type'];
  value: InferFlagValue<F>;
  fallback: InferFlagValue<F>;
  enabled: boolean;
  rollout: number;
};

// ─── Patch / Accessor / Snapshot ─────────────────────────────────────────────

/**
 * The shape accepted by hydrate() and applyState() patches.
 * Using a concrete type instead of a loose object prevents unknown fields
 * from slipping through before #validatePatch runs.
 */
type Patch = {
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

// ─── FlagPayload (used by transport layer) ────────────────────────────────────

export type FlagPayload<S extends FlagMap> = Record<
  string,
  Partial<RuntimeFlag<S[keyof S]>>
>;

// ─── StateMap / Client Options ────────────────────────────────────────────────

type StateMap<S extends FlagMap> = {
  [K in keyof S]?: Patch;
};

interface ClientOptions<S extends FlagMap> {
  schema: S;
  applyStateSchema?: StateMap<S>;
  apiKey?: string;
}

// ─── Connect response shapes ──────────────────────────────────────────────────

interface ConnectResponseBase {
  flags: Record<string, Patch>;
}

interface PollingConnectResponse extends ConnectResponseBase {
  transport: 'polling';
  pollInterval?: number;
}

interface SSEConnectResponse extends ConnectResponseBase {
  transport: 'sse';
  streamUrl: string;
}

type ConnectResponse = PollingConnectResponse | SSEConnectResponse;

// ─── ConnectError ─────────────────────────────────────────────────────────────

export class ConnectError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

// ─── Transport interface ──────────────────────────────────────────────────────

interface Transport {
  start(): void | Promise<void>;
  stop(): void;
}

// ─── Store type ───────────────────────────────────────────────────────────────

type Store<S extends FlagMap> = { [K in keyof S]: RuntimeFlag<S[K]> };

// ─── Accessor Builder ─────────────────────────────────────────────────────────

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

// ─── VoidClient ───────────────────────────────────────────────────────────────

export class VoidClient<S extends FlagMap> {
  public readonly flags: { [K in keyof S]: Accessor<S[K]> };

  #disposed = false;

  // `apiKey` is `readonly` — it is set once at construction and never mutated.
  // It is not `private` so that transport.ts can read it when building the
  // fallback PollingTransport inside buildTransport().
  readonly apiKey: string | undefined;

  private transport?: Transport;
  private connected = false;
  private readonly store: Store<S>;
  private readonly accessorCache: Partial<{ [K in keyof S]: Accessor<S[K]> }> =
    Object.create(null);

  constructor(opts: ClientOptions<S>) {
    this.store = Object.create(null) as Store<S>;
    this.apiKey = opts.apiKey;
    this.#applySchema(opts.schema);

    if (opts.applyStateSchema) {
      this.applyState(opts.applyStateSchema);
    }

    this.flags = this.#buildLazyFlagsObject(opts.schema);
  }

  // ─── Schema ────────────────────────────────────────────────────────────────

  #applySchema(schema: S): void {
    for (const key in schema) {
      const def = schema[key];
      this.store[key] = Object.assign(Object.create(null), {
        type: def.type,
        value: def.fallback as InferFlagValue<typeof def>,
        fallback: def.fallback as InferFlagValue<typeof def>,
        enabled: true,
        // Booleans start at 0% rollout (off by default); other types at 100%.
        rollout: def.type === 'BOOLEAN' ? 0 : 100,
      });
    }
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  #validateRollout(value: number, key: string): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new VoidFlagError(
        `applyState(): "${key}" rollout must be a number between 0 and 100`,
      );
    }
    return parseFloat(value.toFixed(2));
  }

  /**
   * Validates an incoming patch against the stored flag type and returns a
   * SafeUpdate containing only known, type-correct fields.
   *
   * Previously the return value of #validateRollout was not used, meaning
   * the rounded, clamped value was discarded and the raw input was applied.
   */
  #validatePatch(key: string, patch: Patch): Patch {
    const runtime = this.store[key as keyof S];
    const safe: Patch = {};

    for (const field of Object.keys(patch)) {
      if (!ALLOWED_PATCH_KEYS.has(field as keyof Patch)) {
        throw new VoidFlagError(`Unknown patch field "${field}" on flag "${key}"`);
      }
    }

    if (patch.value !== undefined) {
      switch (runtime.type) {
        case 'BOOLEAN':
          if (typeof patch.value !== 'boolean')
            throw new VoidFlagError(`"${key}" expects a boolean value`);
          break;
        case 'STRING':
          if (typeof patch.value !== 'string')
            throw new VoidFlagError(`"${key}" expects a string value`);
          break;
        case 'NUMBER':
          if (typeof patch.value !== 'number' || !Number.isFinite(patch.value))
            throw new VoidFlagError(`"${key}" expects a finite number value`);
          break;
        default: {
          // Exhaustiveness guard — new flag types will cause a compile error here.
          const _: never = runtime.type;
          throw new VoidFlagError(`Unknown flag type "${_}" on flag "${key}"`);
        }
      }
      safe.value = patch.value;
    }

    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean')
        throw new VoidFlagError(`"${key}" enabled must be a boolean`);
      safe.enabled = patch.enabled;
    }

    if (patch.rollout !== undefined) {
      // Bug fix: previously called #validateRollout but discarded its return
      // value, so the raw (unrounded) number was always written to the store.
      safe.rollout = this.#validateRollout(patch.rollout, key);
    }

    return safe;
  }

  // ─── connect() ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.#assertNotDisposed();

    if (!this.apiKey) return;

    const res = await fetch(`${BASE_URL}/connect`, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey },
    });

    if (!res.ok) {
      throw new ConnectError(`Connect failed with HTTP ${res.status}`, res.status);
    }

    const data = (await res.json()) as ConnectResponse;

    // Tear down any previously active transport before replacing it.
    // Without this, reconnect() would orphan a still-running transport.
    this.transport?.stop();
    this.transport = undefined;
    this.connected = false;

    // Hydrate the initial snapshot delivered with the connect response.
    for (const key in data.flags) {
      this.hydrate(key as keyof S, data.flags[key]);
    }

    // Build and start the transport the server requested.
    // buildTransport() is exhaustive over ConnectResponse — an unrecognised
    // transport variant from the server will throw rather than silently no-op.
    this.transport = buildTransport(this, data);
    await this.transport.start();

    // Only mark connected after the await resolves cleanly. Previously this
    // was set before start() resolved, so a throwing async start() left the
    // client in an inconsistent connected=true state.
    this.connected = true;
  }

  // ─── applyState() ──────────────────────────────────────────────────────────

  applyState(overrides: StateMap<S>): this {
    this.#assertNotDisposed();

    const validated: Array<[keyof S, Patch]> = [];

    for (const rawKey in overrides) {
      if (!Object.prototype.hasOwnProperty.call(overrides, rawKey)) continue;

      this.#assertSafeKey(rawKey);

      const key = rawKey as keyof S;
      this.#assertKeyExists(key);

      const patch = overrides[key];
      if (patch == null) continue;
      if (typeof patch !== 'object') {
        throw new VoidFlagError(`"${String(key)}" patch must be an object`);
      }

      validated.push([key, this.#validatePatch(String(key), patch)]);
    }

    // Apply all validated patches in a second pass so that a validation
    // failure mid-loop leaves the store completely untouched.
    for (const [key, patch] of validated) {
      Object.assign(this.store[key], patch);
    }

    return this;
  }

  // ─── flag() / get() / enabled() ────────────────────────────────────────────

  flag<K extends keyof S>(key: K): Accessor<S[K]> {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    if (!this.accessorCache[key]) {
      this.accessorCache[key] = this.#buildAccessor(key);
    }
    return this.accessorCache[key]!;
  }

  get<K extends keyof S>(key: K): InferFlagValue<S[K]> {
    this.#assertNotDisposed();
    this.#assertSafeKey(String(key));
    this.#assertKeyExists(key);
    const f = this.store[key];
    return (f.enabled ? f.value : f.fallback) as InferFlagValue<S[K]>;
  }

  enabled<K extends keyof S>(key: K): boolean {
    this.#assertNotDisposed();
    this.#assertSafeKey(String(key));
    this.#assertKeyExists(key);
    return this.store[key].enabled;
  }

  allEnabled(keys: (keyof S)[]): boolean {
    this.#assertNotDisposed();
    return keys.every((k) => this.enabled(k));
  }

  // ─── isRolledOutFor() ──────────────────────────────────────────────────────

  isRolledOutFor<K extends keyof S>(key: K, userId: string): boolean {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new VoidFlagError(`isRolledOutFor(): userId must be a non-empty string`);
    }
    const f = this.store[key];
    if (!f.enabled) return false;
    if (f.rollout >= 100) return true;
    if (f.rollout <= 0) return false;

    const bucket = stableHash(`${String(key)}:${userId}`) % 100;
    return bucket < f.rollout;
  }

  // ─── hydrate() ─────────────────────────────────────────────────────────────

  /**
   * Called by transports to push server-side flag updates into the store.
   *
   * Previously the type was `applyPatch` (a local alias with a confusing name
   * and `value?: InferFlagValue<FlagDefinition>` which admitted `never` for
   * unknown flag types). Now uses the same `Patch` type as applyState().
   */
  hydrate<K extends keyof S>(key: K, patch: Patch): void {
    this.#assertNotDisposed();
    this.#assertSafeKey(String(key));
    this.#assertKeyExists(key);

    const validated = this.#validatePatch(String(key), patch);
    Object.assign(this.store[key], validated);
  }

  // ─── snapshot() / debugSnapshots() ─────────────────────────────────────────

  snapshot<K extends keyof S>(key: K): Snapshot<S[K]> {
    this.#assertNotDisposed();
    this.#assertKeyExists(key);
    const f = this.store[key];
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

  // ─── dispose() / isConnected() ─────────────────────────────────────────────

  isConnected(): boolean {
    return this.connected;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.transport?.stop();
    this.connected = false;
    this.#disposed = true;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  #buildLazyFlagsObject(schema: S): { [K in keyof S]: Accessor<S[K]> } {
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
    return buildAccessor(
      this.#assertNotDisposed.bind(this),
      this.store[key] as RuntimeFlag<FlagDefinition>,
    ) as Accessor<S[K]>;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new VoidFlagError(
        'VoidClient has been disposed. Create a new instance to continue using flags.',
      );
    }
  }

  #assertSafeKey(key: string): void {
    if (RESERVED_KEYS.has(key)) {
      throw new VoidFlagError(`Invalid flag key "${key}"`);
    }
  }

  #assertKeyExists(key: keyof S): void {
    if (!Object.prototype.hasOwnProperty.call(this.store, key)) {
      throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    }
  }
}

// ─── Transport factory ────────────────────────────────────────────────────────

function buildTransport<S extends FlagMap>(
  client: VoidClient<S>,
  data: ConnectResponse,
): Transport {
  switch (data.transport) {
    case 'polling':
      return new PollingTransport(client, client.apiKey!, {
        interval: data.pollInterval ?? 60_000,
        onError: (err) => console.error('[VoidClient] polling error:', err),
      });

    case 'sse': {
      const fallback = new PollingTransport(client, client.apiKey!, {
        interval: 60_000,
        onError: (err) => console.error('[VoidClient] fallback polling error:', err),
      });

      return new SSETransport(client, fallback, {
        baseUrl: BASE_URL,
        streamUrl: data.streamUrl,
        onError: (err, attempt) =>
          console.error(`[VoidClient] SSE error (attempt ${attempt}):`, err),
        onFallback: () =>
          console.warn('[VoidClient] SSE permanently lost, switched to polling fallback'),
      });
    }

    default: {
      // Exhaustiveness guard: TypeScript will error here if a new variant is
      // added to ConnectResponse without a corresponding case above.
      const _exhaustive: never = data;
      throw new ConnectError(
        `Unsupported transport type from server: ${(_exhaustive as ConnectResponse).transport}`,
        0,
      );
    }
  }
}

// ─── Stable hash (djb2) ───────────────────────────────────────────────────────

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash;
}
