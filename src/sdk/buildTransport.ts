import { ConnectResponse } from '../types/ConnectionResponse.js';
import { FlagMap } from '../types/FlagMap.js';
import { HydrateFn } from '../types/HydrateFn.js';
import { Transport } from '../types/Transport.js';
import { PollingTransport, SSETransport } from './transport.js';
class ConnectError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}
export function buildTransport<S extends FlagMap>(
  hydrate: HydrateFn<S>,
  envKey: string,
  data: ConnectResponse,
  baseUrl: string,
  callbacks: {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (err: Error, attempt: number) => void;
    onFallback?: () => void;
  },
): Transport {
  switch (data.transport) {
    case 'polling':
      return new PollingTransport(hydrate, envKey, baseUrl, {
        interval: data.pollInterval ?? 60_000,
        onError: (err) => {
          console.error('[VoidClient] polling error:', err);
          callbacks.onError?.(err, 1); // ← polling doesn't track attempts, so always 1
        },
        onConnect: callbacks.onConnect, // ← pass through
        onDisconnect: callbacks.onDisconnect, // ← pass through
      });

    case 'sse': {
      const fallback = new PollingTransport(hydrate, envKey, baseUrl, {
        interval: 30_000,
        onConnect: callbacks.onConnect, // ← pass through
        onDisconnect: callbacks.onDisconnect, // ← pass through

        onError: (err) => {
          console.error('[VoidClient] fallback polling error:', err);
          callbacks.onError?.(err, 1);
        },
      });

      return new SSETransport(hydrate, fallback, {
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
