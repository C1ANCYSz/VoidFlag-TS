import { FlagMap } from './schema.js';
import { RuntimeFlag, VoidClient } from './sdk.js';

interface Transport {
  start(): void | Promise<void>;
  stop(): void;
}

// ─── Polling ──────────────────────────────────────────────────────────────────

export class PollingTransport<S extends FlagMap> implements Transport {
  private timer?: ReturnType<typeof setInterval>;
  private abortController?: AbortController;

  constructor(
    private client: VoidClient<S>,
    private apiKey: string,
    private interval: number,
  ) {}

  start() {
    const initialJitter = Math.random() * this.interval * 0.2;

    setTimeout(() => {
      this.fetchFlags();
      this.timer = setInterval(() => this.fetchFlags(), this.interval);
    }, initialJitter);
  }

  stop() {
    clearInterval(this.timer);
    this.abortController?.abort();
    this.timer = undefined;
  }

  private async fetchFlags() {
    this.abortController?.abort();
    this.abortController = new AbortController();

    try {
      const res = await fetch(`http://localhost:3000/v1/flags`, {
        headers: { 'X-API-Key': this.apiKey },
        signal: this.abortController.signal,
      });

      if (!res.ok) return;

      const data = await res.json();
      this.hydrateFlags(data.flags);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // silent fail for network errors
    }
  }
  private hydrateFlags(flags: Record<string, Partial<RuntimeFlag<S[keyof S]>>>) {
    for (const key in flags) {
      this.client.hydrate(key as keyof S, flags[key]);
    }
  }
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export class SSETransport<S extends FlagMap> implements Transport {
  private source?: EventSource;
  private stopped = false;
  private retryCount = 0;

  constructor(
    private client: VoidClient<S>,
    private baseUrl: string,
    private streamUrl: string,
  ) {}

  async start() {
    this.stopped = false;
    await this.connect();
  }

  stop() {
    this.stopped = true;
    this.source?.close();
    this.source = undefined;
  }

  private async connect() {
    if (this.stopped) return;

    const EventSourceImpl = await resolveEventSource();
    const url = `${this.baseUrl}${this.streamUrl}`;

    this.source = new EventSourceImpl(url);

    this.source.addEventListener('update', (e: MessageEvent) => {
      this.retryCount = 0; // reset backoff on successful message
      const payload = JSON.parse(e.data);
      for (const key in payload.flags) {
        this.client.hydrate(key as keyof S, payload.flags[key]);
      }
    });

    this.source.onerror = () => {
      this.source?.close();
      this.source = undefined;

      if (this.stopped) return;

      this.retryCount++;

      const exp = Math.min(BASE_RETRY_MS * 2 ** (this.retryCount - 1), MAX_RETRY_MS);

      const delay = exp * 0.5 + Math.random() * exp * 0.5;
      setTimeout(() => this.connect(), delay);
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveEventSource(): Promise<typeof globalThis.EventSource> {
  // Native: Node 22+, all modern browsers
  if (typeof EventSource !== 'undefined') {
    return EventSource;
  }

  // Node < 22: fall back to the `eventsource` npm package
  try {
    const { EventSource: NodeEventSource } = await import('eventsource');
    return NodeEventSource as unknown as typeof globalThis.EventSource;
  } catch {
    throw new Error(
      'EventSource is not available. On Node < 22, install the `eventsource` package.',
    );
  }
}
