import { FlagMap } from './schema.js';
import { RuntimeFlag, VoidClient } from './sdk.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transport {
  start(): void | Promise<void>;
  stop(): void;
}

type FlagPayload<S extends FlagMap> = Record<string, Partial<RuntimeFlag<S[keyof S]>>>;

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

  constructor(
    private readonly client: VoidClient<S>,
    private readonly apiKey: string,
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
      res = await fetch(`http://localhost:3000/v1/flags`, {
        headers: { 'X-API-Key': this.apiKey },
        signal: this.abortController.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;

      this.failCount++;
      const wrapped = new FetchFlagsError(
        `Network error after ${this.failCount} failure(s): ${err instanceof Error ? err.message : String(err)}`,
      );
      this.options.onError?.(wrapped);
      return;
    }

    if (!res.ok) {
      this.failCount++;
      const wrapped = new FetchFlagsError(
        `HTTP ${res.status} after ${this.failCount} failure(s)`,
        res.status,
      );
      this.options.onError?.(wrapped);
      return;
    }

    this.failCount = 0;

    const data = (await res.json()) as { flags: FlagPayload<S> };
    this.hydrateFlags(data.flags);
  }

  private hydrateFlags(flags: FlagPayload<S>): void {
    for (const key in flags) {
      this.client.hydrate(key as keyof S, flags[key]);
    }
  }
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

export interface SSETransportOptions {
  baseUrl: string;
  streamUrl: string;
  /**
   * After this many consecutive SSE failures the transport gives up on SSE
   * and hands off to the provided fallback (usually a PollingTransport).
   * Defaults to 5.
   */
  maxRetries?: number;
  /** Called on every connection error so the caller can log or react. */
  onError?: (err: Error, attempt: number) => void;
  /** Called when SSE is permanently abandoned and the fallback is started. */
  onFallback?: () => void;
}

export class SSETransport<S extends FlagMap> implements Transport {
  private source?: EventSource;
  private stopped = false;
  private retryCount = 0;
  private readonly maxRetries: number;

  constructor(
    private readonly client: VoidClient<S>,
    private readonly fallback: Transport,
    private readonly options: SSETransportOptions,
  ) {
    this.maxRetries = options.maxRetries ?? 5;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = undefined;
    this.fallback.stop();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const EventSourceImpl = await resolveEventSource();
    const url = `${this.options.baseUrl}${this.options.streamUrl}`;

    this.source = new EventSourceImpl(url);

    this.source.addEventListener('update', (e: MessageEvent) => {
      this.retryCount = 0; // reset backoff on successful message
      const payload = JSON.parse(e.data as string) as { flags: FlagPayload<S> };
      for (const key in payload.flags) {
        this.client.hydrate(key as keyof S, payload.flags[key]);
      }
    });

    this.source.onerror = () => {
      this.source?.close();
      this.source = undefined;

      if (this.stopped) return;

      this.retryCount++;

      const err = new Error(`SSE connection lost (attempt ${this.retryCount})`);
      this.options.onError?.(err, this.retryCount);

      if (this.retryCount >= this.maxRetries) {
        this.options.onFallback?.();
        void this.fallback.start();
        return;
      }

      // Jittered exponential backoff: each reconnect waits longer but not
      // in sync with other clients.
      const delay = backoffDelay(this.retryCount);
      setTimeout(() => void this.connect(), delay);
    };
  }
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
    // The `eventsource` package ships its own ambient declaration that makes
    // EventSource match the global interface, so no cast is needed.
    const mod = await import('eventsource');
    return mod.EventSource;
  } catch {
    throw new Error(
      'EventSource is not available. On Node < 22, install the `eventsource` package.',
    );
  }
}
