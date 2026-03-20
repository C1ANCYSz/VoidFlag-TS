import { FlagMap } from './sdk.js';
import { Patch, VoidClientInternal } from './sdk.js';

// ─── Transport interface ──────────────────────────────────────────────────────

interface Transport {
  start(): void | Promise<void>;
  stop(): void;
}

// ─── Payload ──────────────────────────────────────────────────────────────────

type FlagPayload = {
  flags: Record<string, Patch>;
  version: number;
};
// ─── Errors ───────────────────────────────────────────────────────────────────

export class FetchFlagsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchFlagsError';
  }
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * Full-jitter exponential backoff.
 * Each delay is a random value in [base * 2^(attempt-1) * 0.5, base * 2^(attempt-1)],
 * capped at MAX_RETRY_MS. This avoids synchronized retries across many clients
 * while still backing off meaningfully.
 */
function backoffDelay(attempt: number): number {
  const exp = Math.min(BASE_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
  return exp * 0.5 + Math.random() * exp * 0.5;
}

// ─── EventSource resolution ───────────────────────────────────────────────────

/**
 * Returns the platform's EventSource constructor without casting through `any`.
 * - Node 22+ and all modern browsers have a native EventSource.
 * - Older Node versions require the `eventsource` npm package.
 */
async function resolveEventSource(): Promise<typeof EventSource> {
  if (typeof EventSource !== 'undefined') {
    return EventSource;
  }
  try {
    const mod = await import('eventsource');
    return mod.EventSource;
  } catch {
    throw new Error(
      'EventSource is not available. On Node < 22, install the `eventsource` package.',
    );
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

export interface PollingTransportOptions {
  /** Base polling interval in milliseconds. */
  interval: number;
  /** Called when a fetch fails so the caller can log or react. */
  onError?: (err: FetchFlagsError) => void;
}

export class PollingTransport<S extends FlagMap> implements Transport {
  private timer?: ReturnType<typeof setInterval>;
  private abortController?: AbortController;
  private failCount = 0;
  private version = 0; // 0 = fresh client, triggers full fetch

  constructor(
    private readonly client: VoidClientInternal<S>,
    private readonly envKey: string,
    private readonly baseUrl: string,
    private readonly options: PollingTransportOptions,
  ) {}

  start(): void {
    // Jitter the first poll so a fleet of clients starting simultaneously
    // doesn't hit the server in lockstep.
    const initialJitter = Math.random() * this.options.interval * 0.2;
    setTimeout(() => {
      void this.fetchFlags();
      this.timer = setInterval(() => void this.fetchFlags(), this.options.interval);
    }, initialJitter);
  }

  stop(): void {
    clearInterval(this.timer);
    this.abortController?.abort();
    this.timer = undefined;
  }

  private async fetchFlags(): Promise<void> {
    // Cancel any in-flight request before issuing a new one.
    this.abortController?.abort();
    this.abortController = new AbortController();

    let res: Response;

    try {
      res = await fetch(`${this.baseUrl}/flags?v=${this.version}`, {
        headers: { 'X-API-Key': this.envKey },
        signal: this.abortController.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      this.failCount++;
      this.options.onError?.(
        new FetchFlagsError(
          `Network error after ${this.failCount} failure(s): ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    if (res.status === 204) return;

    if (!res.ok) {
      this.failCount++;
      this.options.onError?.(
        new FetchFlagsError(
          `HTTP ${res.status} after ${this.failCount} failure(s)`,
          res.status,
        ),
      );
      return;
    }

    this.failCount = 0;
    const data = (await res.json()) as FlagPayload;
    this.version = data.version;
    for (const key in data.flags) {
      this.client.hydrate(key as keyof S, data.flags[key]);
    }
  }
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

export interface SSETransportOptions {
  baseUrl: string;
  streamUrl: string;
  maxRetries?: number;
  onError?: (err: Error, attempt: number) => void;
  onFallback?: () => void;
  probeInterval?: number;
  onRestore?: () => void;
  /** Called on every successful SSE connection (initial or reconnect). */
  onConnect?: () => void;
  /** Called when SSE connection is lost. */
  onDisconnect?: () => void;
}

export class SSETransport<S extends FlagMap> implements Transport {
  private source?: EventSource;
  private stopped = false;
  private retryCount = 0;
  private readonly maxRetries: number;
  private pollingFallbackActive = false;
  private probeTimer?: ReturnType<typeof setTimeout>;
  private readonly probeInterval: number;
  private wasConnected = false;

  constructor(
    private readonly client: VoidClientInternal<S>,
    private readonly fallback: Transport | null,
    private readonly options: SSETransportOptions,
  ) {
    this.maxRetries = options.maxRetries ?? 5;
    this.probeInterval = options.probeInterval ?? 10_000;
  }

  // ─── Public ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.stopped = false;
    return new Promise((resolve, reject) => {
      void this.connect(resolve, reject);
    });
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = undefined;
    clearTimeout(this.probeTimer);
    this.probeTimer = undefined;
    this.fallback?.stop();
  }

  // ─── Connection ────────────────────────────────────────────────────────────

  private async connect(
    onReady?: () => void,
    onFail?: (err: Error) => void,
  ): Promise<void> {
    if (this.stopped) return;

    const EventSourceImpl = await resolveEventSource();
    const url = `${this.options.baseUrl}${this.options.streamUrl}`;
    this.source = new EventSourceImpl(url);
    this.attachListeners(onReady, onFail);
  }

  private attachListeners(onReady?: () => void, onFail?: (err: Error) => void): void {
    if (!this.source) return;

    this.source.onopen = () => {
      const isReconnect = this.wasConnected;
      this.wasConnected = true;
      this.retryCount = 0;

      // Fire onConnect for every successful connection
      this.options.onConnect?.();

      // Fire onRestore only on reconnects (not initial connection)
      if (isReconnect) {
        this.options.onRestore?.();
      }

      onReady?.();
      onReady = undefined;
    };

    this.source.addEventListener('update', (e: MessageEvent) => {
      const payload = JSON.parse(e.data as string) as FlagPayload;
      for (const key in payload.flags) {
        this.client.hydrate(key as keyof S, payload.flags[key]);
      }
    });

    this.source.onerror = () => {
      this.source?.close();
      this.source = undefined;
      if (this.stopped) return;

      // Fire onDisconnect when we lose connection
      if (this.wasConnected && this.retryCount === 0) {
        this.options.onDisconnect?.();
      }

      this.retryCount++;
      const err = new Error(`SSE connection lost (attempt ${this.retryCount})`);
      this.options.onError?.(err, this.retryCount);

      if (this.retryCount >= this.maxRetries) {
        onFail?.(err);
        onFail = undefined;
        onReady = undefined;

        if (this.fallback) {
          this.pollingFallbackActive = true;
          this.options.onFallback?.();
          void this.fallback.start();
          this.scheduleProbe();
        }
        return;
      }

      const delay = backoffDelay(this.retryCount);
      setTimeout(() => void this.connect(onReady, onFail), delay);
    };
  }

  // ─── SSE recovery probe ────────────────────────────────────────────────────

  private scheduleProbe(): void {
    if (!this.fallback) return;
    this.probeTimer = setTimeout(() => void this.probe(), this.probeInterval);
  }

  private async probe(): Promise<void> {
    if (this.stopped || !this.pollingFallbackActive) return;

    try {
      const EventSourceImpl = await resolveEventSource();
      const url = `${this.options.baseUrl}${this.options.streamUrl}`;
      const source = new EventSourceImpl(url);

      const timeout = setTimeout(() => {
        source.close();
        this.scheduleProbe();
      }, 5_000);

      source.addEventListener('open', () => {
        clearTimeout(timeout);
        this.fallback?.stop();
        this.pollingFallbackActive = false;
        this.retryCount = 0;
        this.source = source;
        this.attachListeners();
        this.options.onConnect?.();
        this.options.onRestore?.();
      });

      source.onerror = () => {
        clearTimeout(timeout);
        source.close();
        this.scheduleProbe();
      };
    } catch {
      this.scheduleProbe();
    }
  }
}
