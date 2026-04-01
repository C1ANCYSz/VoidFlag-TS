import { readDevPort, VOIDFLAG_DEV_PORT, VOIDFLAG_API_URL } from '@voidflag/shared';

import { SSETransport } from './transport.js';
import { VoidFlagError } from './VoidFlagError.js';
import { buildTransport } from './buildTransport.js';
import { stableHash } from './stableHash.js';
import { buildAccessor } from './buildAccessor.js';
import { ALLOWED_PATCH_KEYS } from './constants/allowedPatchKeys.js';

import type {
  Snapshot,
  Accessor,
  PatchFor,
  Transport,
  Patch,
  HydrateFn,
  RuntimeFlag,
  InferFlagValue,
  ClientOptions,
  ConnectResponse,
  FlagMap,
} from '../types/index.js';
import { assertSafeKey, validateRollout, validateSchema } from './validation.js';

type Store<S extends FlagMap> = { [K in keyof S]: RuntimeFlag<S[K]> };

type StateMap<S extends FlagMap> = { [K in keyof S]?: PatchFor<S[K]> };

export class VoidClient<S extends FlagMap> {
  public readonly flags: { [K in keyof S]: Accessor<S[K]> };
  private readonly onConnectCallback?: () => void;
  private readonly onDisconnectCallback?: () => void;
  private readonly onErrorCallback?: (err: Error, attempt: number) => void;
  private readonly onFallbackCallback?: () => void;
  #hydrateRef: HydrateFn<S>;

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
    this.onErrorCallback = opts.onError;
    this.onFallbackCallback = opts.onFallback;
    this.#hydrateRef = this.#hydrate.bind(this);

    validateSchema(opts.schema);

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

  async connect(): Promise<void> {
    this.#assertNotDisposed();

    if (this.dev) {
      const devPort = readDevPort() ?? VOIDFLAG_DEV_PORT;
      const baseUrl = `http://localhost:${devPort}/api`;
      this.transport = new SSETransport(this.#hydrateRef, null, {
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
      this.#hydrateRef,
      this.envKey,
      data,
      `${VOIDFLAG_API_URL}/api`,
      {
        onConnect: () => {
          this.connected = true;
          console.log(`[voidflag] connected → ${VOIDFLAG_API_URL}`);
          this.onConnectCallback?.();
        },
        onDisconnect: () => {
          this.connected = false;
          console.warn(`[voidflag] connection lost`);
          this.onDisconnectCallback?.();
        },
        onError: (err, attempt) => {
          console.error(`[voidflag] error (attempt ${attempt}):`, err);
          this.onErrorCallback?.(err, attempt);
        },
        onFallback: () => {
          console.warn('[voidflag] SSE failed permanently, falling back to polling');
          this.onFallbackCallback?.();
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

      assertSafeKey(rawKey);

      const key = rawKey as keyof S;
      this.#assertKeyExists(key);

      const patch = overrides[key];
      if (patch == null) continue;
      if (typeof patch !== 'object') {
        throw new VoidFlagError(`"${String(key)}" patch must be an object`);
      }

      validated.push([key, this.#validatePatch(String(key), patch)]);
    }

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
  hydrate<K extends keyof S>(key: K, patch: PatchFor<S[K]>): void {
    if (!this.dev) {
      throw new VoidFlagError('hydrate() is only available when dev: true');
    }
    this.#assertNotDisposed();
    assertSafeKey(String(key));
    this.#assertKeyExists(key);
    this.#hydrate(key, patch);
  }
  /** @internal — called by transports only, not part of the public API */
  #hydrate<K extends keyof S>(key: K, patch: PatchFor<S[K]>): void {
    if (this.#disposed) return;
    if (!Object.prototype.hasOwnProperty.call(this.store, key)) return;
    assertSafeKey(String(key)); // still guard against poison keys from wire
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
        rollout: def.type === 'BOOLEAN' ? 0 : 100,
      });
    }
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
      safe.rollout = validateRollout(patch.rollout, key);
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

  #assertKeyExists(key: keyof S): void {
    if (!Object.prototype.hasOwnProperty.call(this.store, key)) {
      throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
    }
  }
}
