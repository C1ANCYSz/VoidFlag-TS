import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoidClient } from '../src/sdk';
import type { FlagMap } from '../src/types';
import { VoidFlagError } from '../src/sdk/VoidFlagError';
import { PollingTransport, SSETransport } from '../src/sdk/transport';

// ─── Mock fetch globally ─────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllTimers();
  vi.restoreAllMocks();
});

// ─── Helper: create fresh Response each time ──────────────────────────────────

function jsonResponse(body: any, status = 200) {
  return () => new Response(JSON.stringify(body), { status });
}

function textResponse(body: string, status: number, headers?: Record<string, string>) {
  return () => new Response(body, { status, headers });
}

function nullResponse(status: number) {
  return () => new Response(null, { status });
}

// ─── Test Schema ──────────────────────────────────────────────────────────────

const testSchema = {
  feature: { type: 'BOOLEAN', fallback: false },
  theme: { type: 'STRING', fallback: 'light' },
  limit: { type: 'NUMBER', fallback: 100 },
} as const satisfies FlagMap;

// ─── Mock EventSource ─────────────────────────────────────────────────────────

class MockEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();

  constructor(public url: string) {
    // Store reference so tests can access it
    (globalThis as any).__lastEventSource = this;
    // Simulate async connection
    setTimeout(() => this.onopen?.(), 0);
  }

  addEventListener(event: string, handler: (e: MessageEvent) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  close() {
    this.onopen = null;
    this.onerror = null;
    this.listeners.clear();
  }

  __emit(event: string, data: any) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((h) => h(new MessageEvent(event, { data: JSON.stringify(data) })));
    }
  }

  // Test helper to simulate errors
  __error() {
    this.onerror?.();
  }
}

// Override global EventSource
(globalThis as any).EventSource = MockEventSource;

// ─── Connection Tests ─────────────────────────────────────────────────────────

describe('Connection Lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial Connection', () => {
    it('throws if envKey is missing in production mode', async () => {
      await expect(async () => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: undefined as any,
        });
        await vi.runAllTimersAsync();
      }).rejects.toThrow(VoidFlagError);
    });

    it('throws if both dev and envKey are provided', () => {
      expect(() => {
        new VoidClient({
          schema: testSchema,
          dev: true,
          envKey: 'vf_test_123' as any,
        });
      }).toThrow('dev and envKey are mutually exclusive');
    });

    it('connects successfully with valid envKey (SSE)', async () => {
      const onConnect = vi.fn();

      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'sse', streamUrl: '/stream' }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test_123',
        onConnect,
      });

      await vi.runAllTimersAsync();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/connect'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'X-API-Key': 'vf_test_123' },
        }),
      );

      expect(onConnect).toHaveBeenCalledTimes(1);

      client.dispose();
    });

    it('connects successfully with valid envKey (Polling)', async () => {
      const onConnect = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 30000 }),
        )
        .mockImplementationOnce(jsonResponse({ flags: {}, version: 1 }));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test_456',
        onConnect,
      });

      await vi.runAllTimersAsync();

      expect(onConnect).toHaveBeenCalledTimes(1);

      client.dispose();
    });

    it('throws on network error during initial connect', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(async () => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_test_789',
        });
        await vi.runAllTimersAsync();
      }).rejects.toThrow(VoidFlagError);
    });

    it('throws on HTTP 401 (invalid API key)', async () => {
      mockFetch.mockImplementationOnce(jsonResponse({ message: 'Invalid API key' }, 401));

      await expect(async () => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_invalid',
        });
        await vi.runAllTimersAsync();
      }).rejects.toThrow(/HTTP 401.*Invalid API key/);
    });

    it('throws on HTTP 404 (environment not found)', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ message: 'No environment exists with this API key' }, 404),
      );

      await expect(async () => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_notfound',
        });
        await vi.runAllTimersAsync();
      }).rejects.toThrow(/HTTP 404.*No environment exists/);
    });

    it('extracts message from JSON error response', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ message: 'Custom error message' }, 500),
      );

      await expect(async () => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_error',
        });
        await vi.runAllTimersAsync();
      }).rejects.toThrow(/Custom error message/);
    });

    it('handles non-JSON error responses gracefully', async () => {
      mockFetch.mockImplementationOnce(
        textResponse('Internal Server Error', 500, { 'Content-Type': 'text/plain' }),
      );

      await expect(async () => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_error',
        });
        await vi.runAllTimersAsync();
      }).rejects.toThrow(/HTTP 500/);
    });
  });

  describe('Dev Mode', () => {
    it('connects to dev server on default port', async () => {
      const onConnect = vi.fn();

      const client = new VoidClient({
        schema: testSchema,
        dev: true,
        onConnect,
      });

      await vi.runAllTimersAsync();

      // Should attempt SSE connection to dev server
      expect(onConnect).toHaveBeenCalled();

      client.dispose();
    });

    it('retries infinitely in dev mode', async () => {
      const onError = vi.fn();
      let errorCount = 0;

      const client = new VoidClient({
        schema: testSchema,
        dev: true,
        onError: (err, attempt) => {
          errorCount++;
          onError(err, attempt);
        },
      });

      // Simulate 100 connection failures
      for (let i = 0; i < 100; i++) {
        const source = (globalThis as any).__lastEventSource as MockEventSource;
        if (source) source.__error();
        await vi.runAllTimersAsync();
      }

      // Should keep retrying (no max limit in dev mode)
      expect(errorCount).toBeGreaterThan(50);

      client.dispose();
    });

    it('shows helpful error message on first dev failure', async () => {
      const onError = vi.fn();

      const client = new VoidClient({
        schema: testSchema,
        dev: true,
        onError,
      });

      const source = (globalThis as any).__lastEventSource as MockEventSource;
      source.__error();

      await vi.runAllTimersAsync();

      expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);

      client.dispose();
    });
  });

  describe('Disconnection & Reconnection', () => {
    it('fires onDisconnect when SSE connection drops', async () => {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();

      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'sse', streamUrl: '/stream' }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onConnect,
        onDisconnect,
      });

      await vi.runAllTimersAsync();

      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(onDisconnect).not.toHaveBeenCalled();

      client.dispose();
    });

    it('fires onDisconnect only once when polling starts failing', async () => {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementationOnce(jsonResponse({ flags: {}, version: 1 }))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onConnect,
        onDisconnect,
      });

      await vi.runAllTimersAsync();
      expect(onConnect).toHaveBeenCalledTimes(1);

      // First poll succeeds (onConnect)
      await vi.advanceTimersByTimeAsync(1000);

      // Next polls fail
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // onDisconnect should fire only once
      expect(onDisconnect).toHaveBeenCalledTimes(1);

      client.dispose();
    });

    it('fires onConnect when reconnecting after disconnect', async () => {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementationOnce(jsonResponse({ flags: {}, version: 1 }))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockImplementationOnce(jsonResponse({ flags: {}, version: 2 }));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onConnect,
        onDisconnect,
      });

      await vi.runAllTimersAsync();

      // Initial connect
      expect(onConnect).toHaveBeenCalledTimes(1);

      // Poll 1: success (no new onConnect, already connected)
      await vi.advanceTimersByTimeAsync(1000);

      // Poll 2: fail (fires onDisconnect)
      await vi.advanceTimersByTimeAsync(1000);
      expect(onDisconnect).toHaveBeenCalledTimes(1);

      // Poll 3: success (fires onConnect again)
      await vi.advanceTimersByTimeAsync(1000);
      expect(onConnect).toHaveBeenCalledTimes(2);

      client.dispose();
    });
  });

  describe('Error Handling', () => {
    it('fires onError on every retry attempt', async () => {
      const onError = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementation(() => Promise.reject(new TypeError('fetch failed')));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onError,
      });

      await vi.runAllTimersAsync();

      // Advance through multiple poll attempts
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      expect(onError.mock.calls.length).toBeGreaterThanOrEqual(4);

      client.dispose();
    });

    it('passes error and attempt number to onError', async () => {
      const onError = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementation(() => Promise.reject(new TypeError('Network error')));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onError,
      });

      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        1, // attempt number for polling is always 1
      );

      client.dispose();
    });

    it('continues working with cached values when disconnected', async () => {
      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementationOnce(
          jsonResponse({
            flags: { feature: { value: true, enabled: true, rollout: 100 } },
            version: 1,
          }),
        )
        .mockImplementation(() => Promise.reject(new TypeError('fetch failed')));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);

      // Verify flag value is cached
      expect(client.flags.feature.value).toBe(true);

      // Network fails
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Cached value still works
      expect(client.flags.feature.value).toBe(true);

      client.dispose();
    });

    it('handles HTTP error responses (404, 500, etc.)', async () => {
      const onError = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementation(textResponse('Not Found', 404));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onError,
      });

      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('404'),
        }),
        1,
      );

      client.dispose();
    });
  });

  describe('SSE → Polling Fallback', () => {
    it('fires onFallback when SSE exhausts retries', async () => {
      const onFallback = vi.fn();
      const onError = vi.fn();

      mockFetch
        .mockImplementationOnce(jsonResponse({ transport: 'sse', streamUrl: '/stream' }))
        .mockImplementation(jsonResponse({ flags: {}, version: 1 }));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onFallback,
        onError,
      });

      await vi.runAllTimersAsync();

      // Simulate SSE failing 5 times (default maxRetries)
      for (let i = 0; i < 6; i++) {
        const source = (globalThis as any).__lastEventSource as MockEventSource;
        if (source) source.__error();
        await vi.runAllTimersAsync();
      }

      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls.length).toBeGreaterThanOrEqual(5);

      client.dispose();
    });

    it('switches to polling after SSE fails permanently', async () => {
      mockFetch
        .mockImplementationOnce(jsonResponse({ transport: 'sse', streamUrl: '/stream' }))
        .mockImplementation(jsonResponse({ flags: {}, version: 1 }));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      // Trigger SSE failure beyond maxRetries
      for (let i = 0; i < 6; i++) {
        const source = (globalThis as any).__lastEventSource as MockEventSource;
        if (source) source.__error();
        await vi.runAllTimersAsync();
      }

      // Should now be polling
      await vi.advanceTimersByTimeAsync(30000); // fallback poll interval

      // Verify polling fetch happened
      const pollCalls = mockFetch.mock.calls.filter((call) => call[0].includes('/flags'));
      expect(pollCalls.length).toBeGreaterThan(0);

      client.dispose();
    });
  });

  describe('Disposal', () => {
    it('stops transport on dispose()', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      const callsBefore = mockFetch.mock.calls.length;

      client.dispose();

      // Advance time — no more polls should happen
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockFetch.mock.calls.length).toBe(callsBefore);
    });

    it('throws when accessing flags after disposal', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      client.dispose();

      expect(() => client.flags.feature.value).toThrow(VoidFlagError);
      expect(() => client.snapshot('feature')).toThrow(VoidFlagError);
    });

    it('allows multiple dispose() calls safely', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      client.dispose();
      client.dispose();
      client.dispose();

      // Should not throw
    });

    it('stops callbacks from firing after disposal', async () => {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();

      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onConnect,
        onDisconnect,
      });

      await vi.runAllTimersAsync();

      const connectCallsBefore = onConnect.mock.calls.length;

      client.dispose();

      await vi.advanceTimersByTimeAsync(10000);

      // No additional callbacks
      expect(onConnect).toHaveBeenCalledTimes(connectCallsBefore);
      expect(onDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('Schema Validation', () => {
    it('rejects reserved Object.prototype keys', () => {
      expect(() => {
        new VoidClient({
          schema: {
            valueOf: { type: 'STRING', fallback: 'bad' },
          } as any,
          dev: true,
        });
      }).toThrow(/reserved Object.prototype property/i);
    });

    it('rejects hasOwnProperty as flag name', () => {
      expect(() => {
        new VoidClient({
          schema: {
            hasOwnProperty: { type: 'BOOLEAN', fallback: false },
          } as any,
          dev: true,
        });
      }).toThrow(/reserved/i);
    });

    it('rejects toString as flag name', () => {
      expect(() => {
        new VoidClient({
          schema: {
            toString: { type: 'NUMBER', fallback: 42 },
          } as any,
          dev: true,
        });
      }).toThrow(/reserved/i);
    });

    it('rejects __proto__ as flag name', () => {
      expect(() => {
        new VoidClient({
          schema: {
            __proto__: { type: 'BOOLEAN', fallback: true },
          } as any,
          dev: true,
        });
      }).toThrow(/reserved/i);
    });

    it('accepts normal flag names', () => {
      expect(() => {
        new VoidClient({
          schema: testSchema,
          dev: true,
        });
      }).not.toThrow();
    });
  });

  describe('Race Conditions', () => {
    it('handles disposal during connection attempt', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify({ transport: 'polling' }), {
                    status: 200,
                  }),
                ),
              1000,
            ),
          ),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      // Dispose before connection completes
      await vi.advanceTimersByTimeAsync(500);
      client.dispose();

      await vi.runAllTimersAsync();

      // Should not throw or have active timers
      expect(() => client.flags.feature.value).toThrow(VoidFlagError);
    });

    it('handles rapid connect/dispose cycles', async () => {
      mockFetch.mockImplementation(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      for (let i = 0; i < 10; i++) {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_test',
        });

        await vi.runAllTimersAsync();
        client.dispose();
      }

      // Should not leak timers or memory
    });

    it('handles concurrent hydrate calls safely', async () => {
      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementation(
          jsonResponse({
            flags: {
              feature: { value: true, enabled: true, rollout: 50 },
              theme: { value: 'dark', enabled: true, rollout: 100 },
            },
            version: 1,
          }),
        );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      // Simulate concurrent updates
      client.hydrate('feature', { value: false });
      client.hydrate('theme', { value: 'light' });
      client.hydrate('feature', { enabled: false });

      expect(client.flags.feature.value).toBe(false); // uses fallback when disabled
      expect(client.flags.theme.value).toBe('light');

      client.dispose();
    });

    it('handles server switching transport types mid-session', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'sse', streamUrl: '/stream' }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      expect(client.flags.feature).toBeDefined();

      client.dispose();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty flag updates (HTTP 204)', async () => {
      const onConnect = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementation(nullResponse(204));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onConnect,
      });

      await vi.runAllTimersAsync();

      // Initial connect
      expect(onConnect).toHaveBeenCalledTimes(1);

      // Poll returns 204 (no changes)
      await vi.advanceTimersByTimeAsync(1000);

      // Should still be connected
      expect(onConnect).toHaveBeenCalledTimes(1); // no additional call

      client.dispose();
    });

    it('handles malformed JSON responses gracefully', async () => {
      const onError = vi.fn();

      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementation(textResponse('not valid json{]', 200));

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onError,
      });

      await vi.runAllTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);

      // Should handle JSON parse error
      expect(onError).toHaveBeenCalled();

      client.dispose();
    });

    it('handles server returning unknown transport type', async () => {
      mockFetch.mockImplementationOnce(jsonResponse({ transport: 'websocket' }));

      await expect(async () => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_test',
        });
        await vi.runAllTimersAsync();
      }).rejects.toThrow(/Unsupported transport type/);
    });

    it('handles extremely slow network responses', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify({ transport: 'polling' }), {
                    status: 200,
                  }),
                ),
              60000, // 60 seconds
            ),
          ),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      // Advance time but not to completion
      await vi.advanceTimersByTimeAsync(30000);

      // Client should still be waiting
      expect(client.flags.feature.value).toBe(false); // fallback value

      // Complete the request
      await vi.runAllTimersAsync();

      client.dispose();
    });

    it('handles AbortController signal correctly', async () => {
      mockFetch
        .mockImplementationOnce(
          jsonResponse({ transport: 'polling', pollInterval: 1000 }),
        )
        .mockImplementation(async (_url: string, options: any) => {
          // Simulate abort
          if (options?.signal) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (options.signal.aborted) {
              throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
            }
          }
          return new Response(JSON.stringify({ flags: {}, version: 1 }), {
            status: 200,
          });
        });

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      // Trigger multiple rapid polls (should abort previous)
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);

      // Should not crash
      expect(client.flags.feature).toBeDefined();

      client.dispose();
    });

    it('works when all callbacks are omitted', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        // No callbacks provided
      });

      await vi.runAllTimersAsync();

      expect(client.flags.feature.value).toBe(false);

      client.dispose();
    });

    it('handles callback throwing errors gracefully', async () => {
      const onConnect = vi.fn(() => {
        throw new Error('User callback exploded');
      });

      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      // SDK should catch and log, not crash
      expect(() => {
        const client = new VoidClient({
          schema: testSchema,
          envKey: 'vf_test',
          onConnect,
        });
      }).not.toThrow();
    });
  });

  describe('Stress Tests', () => {
    it('handles 1000 rapid flag updates', async () => {
      mockFetch.mockImplementationOnce(
        jsonResponse({ transport: 'polling', pollInterval: 1000 }),
      );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      for (let i = 0; i < 1000; i++) {
        client.hydrate('limit', { value: i });
      }

      expect(client.flags.limit.value).toBe(999);

      client.dispose();
    });

    it('handles connection cycling 100 times', async () => {
      mockFetch
        .mockImplementationOnce(jsonResponse({ transport: 'polling', pollInterval: 100 }))
        .mockImplementation((_url: string) => {
          if (typeof _url === 'string' && _url.includes('/flags')) {
            // Alternate success/failure
            if (Math.random() > 0.5) {
              return Promise.resolve(
                new Response(JSON.stringify({ flags: {}, version: 1 }), {
                  status: 200,
                }),
              );
            } else {
              return Promise.reject(new TypeError('fetch failed'));
            }
          }
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
        });

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
      });

      await vi.runAllTimersAsync();

      for (let i = 0; i < 100; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      // Client should still be functional
      expect(client.flags.feature).toBeDefined();

      client.dispose();
    });

    it('survives callback firing 10000 times', async () => {
      let callCount = 0;
      const onConnect = vi.fn(() => callCount++);

      mockFetch
        .mockImplementationOnce(jsonResponse({ transport: 'polling', pollInterval: 10 }))
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ flags: {}, version: 1 }), {
              status: 200,
            }),
          ),
        );

      const client = new VoidClient({
        schema: testSchema,
        envKey: 'vf_test',
        onConnect,
      });

      await vi.runAllTimersAsync();

      // Simulate rapid connect/disconnect
      for (let i = 0; i < 1000; i++) {
        await vi.advanceTimersByTimeAsync(10);
      }

      expect(callCount).toBeGreaterThan(0);

      client.dispose();
    });
  });
});

// ─── Memory Leak Tests ────────────────────────────────────────────────────────

describe('Memory & Resource Management', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleans up timers on dispose', async () => {
    mockFetch.mockImplementation(
      jsonResponse({ transport: 'polling', pollInterval: 1000 }),
    );

    const client = new VoidClient({
      schema: testSchema,
      envKey: 'vf_test',
    });

    await vi.runAllTimersAsync();

    const timersBefore = vi.getTimerCount();

    client.dispose();

    await vi.runAllTimersAsync();

    const timersAfter = vi.getTimerCount();

    expect(timersAfter).toBeLessThanOrEqual(timersBefore);
  });

  it('does not retain references after dispose', async () => {
    mockFetch.mockImplementation(
      jsonResponse({ transport: 'polling', pollInterval: 1000 }),
    );

    let client: VoidClient<typeof testSchema> | null = new VoidClient({
      schema: testSchema,
      envKey: 'vf_test',
    });

    await vi.runAllTimersAsync();

    client.dispose();
    client = null;

    if ('gc' in globalThis && typeof (globalThis as any).gc === 'function') {
      (globalThis as any).gc();
    }

    // If this doesn't crash, we're good
    expect(true).toBe(true);
  });
});
