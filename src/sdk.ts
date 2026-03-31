import {
  readDevPort,
  RESERVED_KEYS,
  VOIDFLAG_DEV_PORT,
  VOIDFLAG_API_URL,
} from '@voidflag/shared';
import { PollingTransport, SSETransport } from './transport.js';
import { VoidFlagError } from './VoidFlagError.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_PATCH_KEYS = new Set(['value', 'enabled', 'rollout'] as const);

// ─── Type Helpers ─────────────────────────────────────────────────────────────
interface BooleanFlag {
  type: 'BOOLEAN';
  fallback: boolean;
}

interface StringFlag {
  type: 'STRING';
  fallback: string;
}

interface NumberFlag {
  type: 'NUMBER';
  fallback: number;
}

type FlagDefinition = BooleanFlag | StringFlag | NumberFlag;

export interface FlagMap {
  [key: string]: FlagDefinition;
}
type InferFlagValue<F extends FlagDefinition> = F extends BooleanFlag
  ? boolean
  : F extends StringFlag
    ? string
    : F extends NumberFlag
      ? number
      : never;

// ─── Core Domain Types ────────────────────────────────────────────────────────

export interface RuntimeFlag<F extends FlagDefinition> {
  type: F['type'];
  value: InferFlagValue<F>;
  fallback: InferFlagValue<F>;
  enabled: boolean;
  rollout: number;
}

/**
 * The shape accepted by hydrate() and applyState() patches.
 * Using a concrete type instead of a loose object prevents unknown fields
 * from slipping through before #validatePatch runs.
 */
type BooleanPatch = { value?: boolean; enabled?: boolean; rollout?: number };
type StringPatch = { value?: string; enabled?: boolean; rollout?: number };
type NumberPatch = { value?: number; enabled?: boolean; rollout?: number };
export type Patch = BooleanPatch | StringPatch | NumberPatch;

export interface Accessor<F extends FlagDefinition> {
  readonly value: InferFlagValue<F>;
  readonly enabled: boolean;
  isRolledOutFor(userId: string): boolean;
}

export interface Snapshot<F extends FlagDefinition> {
  readonly value: InferFlagValue<F>;
  readonly fallback: InferFlagValue<F>;
  readonly enabled: boolean;
  readonly rollout: number;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

type Store<S extends FlagMap> = { [K in keyof S]: RuntimeFlag<S[K]> };

type PatchFor<F extends FlagDefinition> = F extends { type: 'BOOLEAN' }
  ? BooleanPatch
  : F extends { type: 'STRING' }
    ? StringPatch
    : F extends { type: 'NUMBER' }
      ? NumberPatch
      : never;

type StateMap<S extends FlagMap> = { [K in keyof S]?: PatchFor<S[K]> };
/** @internal — exposes only what transports need, prevents access to the full client API */
export interface VoidClientInternal<S extends FlagMap> {
  readonly envKey?: string;
  hydrate<K extends keyof S>(key: K, patch: Patch): void;
}

// ─── Client Options ───────────────────────────────────────────────────────────
interface BaseClientOptions<S extends FlagMap> {
  schema: S;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Error, attempt: number) => void; // ← add this
  onFallback?: () => void; // ← SSE-specific: fired when giving up and switching to polling
}
interface DevOptions<S extends FlagMap> extends BaseClientOptions<S> {
  dev: true;
  envKey?: never;
}

interface ProdOptions<S extends FlagMap> extends BaseClientOptions<S> {
  envKey: string;
  dev?: never;
}

type ClientOptions<S extends FlagMap> = DevOptions<S> | ProdOptions<S>;

// ─── Connect Response Shapes ──────────────────────────────────────────────────

interface PollingConnectResponse {
  transport: 'polling';
  pollInterval?: number;
}

interface SSEConnectResponse {
  transport: 'sse';
  streamUrl: string;
}

type ConnectResponse = PollingConnectResponse | SSEConnectResponse;

// ─── Transport Interface ──────────────────────────────────────────────────────

interface Transport {
  start(): void | Promise<void>;
  stop(): void;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ConnectError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

// ─── Accessor Builder ─────────────────────────────────────────────────────────

function buildAccessor<F extends FlagDefinition>(
  assertNotDisposed: () => void,
  runtime: RuntimeFlag<F>,
  isRolledOutFor: (userId: string) => boolean,
): Accessor<F> {
  const node = Object.create(null) as Accessor<F>;

  Object.defineProperty(node, 'enabled', {
    get(): boolean {
      assertNotDisposed();
      return runtime.enabled;
    },
    enumerable: true,
  });

  Object.defineProperty(node, 'value', {
    get(): InferFlagValue<F> {
      assertNotDisposed();
      return runtime.enabled ? runtime.value : runtime.fallback;
    },
    enumerable: true,
  });

  Object.defineProperty(node, 'isRolledOutFor', {
    get(): (userId: string) => boolean {
      assertNotDisposed();
      return isRolledOutFor;
    },
    enumerable: true,
  });

  return Object.freeze(node);
}

// ─── Transport Factory ────────────────────────────────────────────────────────

function buildTransport<S extends FlagMap>(
  client: VoidClientInternal<S>,
  data: ConnectResponse,
  baseUrl: string,
  callbacks: {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (err: Error, attempt: number) => void; // ← add this
    onFallback?: () => void;
  },
): Transport {
  switch (data.transport) {
    case 'polling':
      return new PollingTransport(client, client.envKey!, baseUrl, {
        interval: data.pollInterval ?? 60_000,
        onError: (err) => {
          console.error('[VoidClient] polling error:', err);
          callbacks.onError?.(err, 1); // ← polling doesn't track attempts, so always 1
        },
        onConnect: callbacks.onConnect, // ← pass through
        onDisconnect: callbacks.onDisconnect, // ← pass through
      });

    case 'sse': {
      const fallback = new PollingTransport(client, client.envKey!, baseUrl, {
        interval: 30_000,
        onConnect: callbacks.onConnect, // ← pass through
        onDisconnect: callbacks.onDisconnect, // ← pass through

        onError: (err) => {
          console.error('[VoidClient] fallback polling error:', err);
          callbacks.onError?.(err, 1);
        },
      });

      return new SSETransport(client, fallback, {
        baseUrl,
        streamUrl: data.streamUrl,
        onConnect: callbacks.onConnect, // ← pass through
        onDisconnect: callbacks.onDisconnect, // ← pass through
        onError: (err, attempt) => {
          console.error(`[VoidClient] SSE error (attempt ${attempt}):`, err);
          callbacks.onError?.(err, attempt); // ← SSE tracks attempts
        },
        onFallback: () => {
          console.warn('[VoidClient] SSE permanently lost, switched to polling fallback');
          callbacks.onFallback?.();
        },
      });
    }

    default: {
      const _exhaustive: never = data;
      throw new ConnectError(
        `Unsupported transport type from server: ${(_exhaustive as ConnectResponse).transport}`,
        0,
      );
    }
  }
}

// ─── Stable Hash (djb2) ───────────────────────────────────────────────────────

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ─── VoidClient ───────────────────────────────────────────────────────────────

export class VoidClient<S extends FlagMap> {
  public readonly flags: { [K in keyof S]: Accessor<S[K]> };
  private readonly onConnectCallback?: () => void;
  private readonly onDisconnectCallback?: () => void;
  private readonly onErrorCallback?: (err: Error, attempt: number) => void; // ← add this
  private readonly onFallbackCallback?: () => void; // ← ADD THIS

  readonly envKey?: string;

  #disposed = false;
  private readonly dev: boolean = false;
  private transport?: Transport;
  private connected = false;
  private readonly store: Store<S>;
  private readonly accessorCache: Partial<{ [K in keyof S]: Accessor<S[K]> }> =
    Object.create(null);

  constructor(opts: ClientOptions<S>) {
    this.store = Object.create(null) as Store<S>;
    this.onConnectCallback = opts.onConnect;
    this.onDisconnectCallback = opts.onDisconnect;
    this.onErrorCallback = opts.onError; // ← add this
    this.onFallbackCallback = opts.onFallback; // ← ADD THIS

    // Runtime guard — TypeScript prevents this at compile time, but callers
    // can bypass with `as any`, so we keep the check.
    this.#validateSchema(opts.schema);

    if (opts.dev && opts.envKey) {
      throw new VoidFlagError(
        'dev and envKey are mutually exclusive — use one or the other',
      );
    }

    this.#applySchema(opts.schema);
    this.flags = this.#buildLazyFlagsObject(opts.schema);

    if (opts.envKey) {
      this.envKey = opts.envKey;
      this.dev = false;
      void this.connect();
    } else if (opts.dev) {
      this.dev = true;
      void this.connect();
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  #validateSchema(schema: FlagMap): void {
    for (const key of Object.keys(schema)) {
      if (RESERVED_KEYS.has(key)) {
        throw new VoidFlagError(
          `Invalid flag name "${key}" — reserved Object.prototype property`,
        );
      }
    }
  }
  async connect(): Promise<void> {
    this.#assertNotDisposed();

    if (this.dev) {
      const devPort = readDevPort() ?? VOIDFLAG_DEV_PORT;
      const baseUrl = `http://localhost:${devPort}/api`;
      this.transport = new SSETransport(this as VoidClientInternal<S>, null, {
        baseUrl,
        streamUrl: '/stream?dev=true',
        maxRetries: Infinity,
        onConnect: () => {
          this.connected = true;
          console.log(`[voidflag] connected (dev) → http://localhost:${devPort}`);
          this.onConnectCallback?.();
        },
        onDisconnect: () => {
          this.connected = false;
          console.warn(`[voidflag] connection lost`);
          this.onDisconnectCallback?.();
        },
        onError: (err, attempt) => {
          if (attempt === 1) {
            console.warn(
              `\n[voidflag] dev server not running\n` +
                `  url      → http://localhost:${devPort}\n` +
                `  fallback → schema defaults (read-only)\n\n` +
                `  to fix   → run \`vf dev\` to start the local dev server\n`,
            );
          } else {
            console.warn(`[voidflag] retrying (attempt ${attempt})...`);
          }
          this.onErrorCallback?.(err, attempt); // ← fire user callback
        },
      });
      void this.transport.start();
      return;
    }

    if (!this.envKey) {
      throw new VoidFlagError('envKey is required');
    }

    let res: Response;
    try {
      res = await fetch(`${VOIDFLAG_API_URL}/api/connect`, {
        method: 'POST',
        headers: { 'X-API-Key': this.envKey },
      });
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'server unreachable'
          : err instanceof Error
            ? err.message
            : String(err);

      throw new VoidFlagError(
        `connection failed\n` +
          `  url    → ${VOIDFLAG_API_URL}\n` +
          `  reason → ${message}`,
      );
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) detail += ` — ${body.message}`;
      } catch {
        // no parseable body, keep the status-only detail
      }

      throw new VoidFlagError(
        `connection failed\n` +
          `  url    → ${VOIDFLAG_API_URL}\n` +
          `  reason → ${detail}`,
      );
    }

    const data = (await res.json()) as ConnectResponse;
    if (this.#disposed) return;

    this.transport?.stop();
    this.transport = undefined;
    this.connected = false;

    this.transport = buildTransport(
      this as VoidClientInternal<S>,
      data,
      `${VOIDFLAG_API_URL}/api`,
      {
        onConnect: () => {
          this.connected = true;
          console.log(`[voidflag] connected → ${VOIDFLAG_API_URL}`);
          this.onConnectCallback?.(); // ← fire user callback
        },
        onDisconnect: () => {
          this.connected = false;
          console.warn(`[voidflag] connection lost`);
          this.onDisconnectCallback?.(); // ← fire user callback
        },
        onError: (err, attempt) => {
          console.error(`[voidflag] error (attempt ${attempt}):`, err);
          this.onErrorCallback?.(err, attempt); // ← fire user callback
        },
        onFallback: () => {
          console.warn('[voidflag] SSE failed permanently, falling back to polling');
          this.onFallbackCallback?.(); // ← ADD THIS
        },
      },
    );

    await this.transport.start();
    if (this.#disposed) return;
  }

  applyState(overrides: StateMap<S>): this {
    this.#assertNotDisposed();

    if (
      Object.getPrototypeOf(overrides) !== Object.prototype &&
      Object.getPrototypeOf(overrides) !== null
    ) {
      throw new VoidFlagError('Invalid object prototype');
    }

    const validated: Array<[keyof S, Patch]> = [];

    for (const rawKey of Object.keys(overrides)) {
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

    // Two-pass apply — a validation failure mid-loop leaves the store untouched.
    for (const [key, patch] of validated) {
      Object.assign(this.store[key], patch);
    }

    return this;
  }

  allEnabled(...flags: { enabled: boolean }[]): boolean {
    this.#assertNotDisposed();
    return flags.every((f) => f.enabled);
  }

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

  dispose(): void {
    if (this.#disposed) return;
    this.transport?.stop();
    this.connected = false;
    this.#disposed = true;
  }

  // ─── Internal (transport layer only) ──────────────────────────────────────

  /** @internal — called by transports only, not part of the public API */
  hydrate<K extends keyof S>(key: K, patch: Patch): void {
    this.#assertNotDisposed();
    this.#assertSafeKey(String(key));
    this.#assertKeyExists(key);
    const validated = this.#validatePatch(String(key), patch);
    Object.assign(this.store[key], validated);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

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

  #validatePatch(key: string, patch: Patch): Patch {
    const runtime = this.store[key as keyof S];
    const safe: Record<string, unknown> = {};

    for (const field of Object.keys(patch)) {
      if (!ALLOWED_PATCH_KEYS.has(field as keyof Patch)) {
        throw new VoidFlagError(`Unknown patch field "${field}" on flag "${key}"`);
      }
    }

    if (patch.value !== undefined) {
      const rawValue: unknown = patch.value;

      switch (runtime.type) {
        case 'BOOLEAN':
          if (typeof rawValue !== 'boolean')
            throw new VoidFlagError(`"${key}" expects a boolean value`);
          safe.value = rawValue;
          break;
        case 'STRING':
          if (typeof rawValue !== 'string')
            throw new VoidFlagError(`"${key}" expects a string value`);
          safe.value = rawValue;
          break;
        case 'NUMBER':
          if (typeof rawValue !== 'number' || !Number.isFinite(rawValue))
            throw new VoidFlagError(`"${key}" expects a finite number value`);
          safe.value = rawValue;
          break;
        default: {
          const _: never = runtime.type;
          throw new VoidFlagError(`Unknown flag type "${_}" on flag "${key}"`);
        }
      }
    }

    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean')
        throw new VoidFlagError(`"${key}" enabled must be a boolean`);
      safe.enabled = patch.enabled;
    }

    if (patch.rollout !== undefined) {
      safe.rollout = this.#validateRollout(patch.rollout, key);
    }

    return safe as Patch;
  }
  #buildLazyFlagsObject(schema: S): { [K in keyof S]: Accessor<S[K]> } {
    const flags = {} as { [K in keyof S]: Accessor<S[K]> };
    for (const key in schema) {
      Object.defineProperty(flags, key, {
        get: () => {
          if (!this.accessorCache[key]) {
            this.accessorCache[key] = this.#buildAccessor(key);
          }
          return this.accessorCache[key]!;
        },
        enumerable: true,
      });
    }
    return Object.seal(flags);
  }

  #buildAccessor<K extends keyof S>(key: K): Accessor<S[K]> {
    return buildAccessor(
      this.#assertNotDisposed.bind(this),
      this.store[key],
      (userId: string) => this.#computeRollout(key, userId),
    );
  }

  #computeRollout<K extends keyof S>(key: K, userId: string): boolean {
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
