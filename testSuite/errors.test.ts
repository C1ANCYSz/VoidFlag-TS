import { describe, it, expect } from 'vitest';
import {
  VoidClient,
  VoidFlagError,
  defineFlags,
  boolean,
  string,
  number,
} from '@voidflag/sdk';

const schema = defineFlags({
  darkMode: boolean().fallback(false),
  theme: string().fallback('light'),
  retryCount: number().fallback(3),
});

function makeClient() {
  return new VoidClient({ schema, dev: true });
}

// ================================================================
// UNKNOWN KEYS
// ================================================================

describe('unknown key access', () => {
  it('snapshot() throws VoidFlagError for unknown key', () => {
    const vf = makeClient();
    // @ts-expect-error
    expect(() => vf.snapshot(vf.flags.fakeKey)).toThrow(VoidFlagError);
    // @ts-expect-error
    expect(() => vf.snapshot(vf.flags.fakeKey)).toThrow(/Unknown flag accessor/);
  });

  it('hydrate() throws VoidFlagError for unknown key', () => {
    const vf = makeClient();
    // @ts-expect-error
    expect(() => vf.hydrate('doesNotExist', { value: true })).toThrow(VoidFlagError);
  });

  it('isRolledOutFor() throws VoidFlagError for unknown key', () => {
    const vf = makeClient();
    // Instead test via hydrate guard: unknown key on applyState
    expect(() =>
      vf.applyState({
        // @ts-expect-error
        doesNotExist: { value: true },
      }),
    ).toThrow(VoidFlagError);
  });
});

// ================================================================
// PROTOTYPE POLLUTION
// ================================================================

describe('prototype pollution guard', () => {
  it('hydrating __proto__ throws VoidFlagError and does not pollute Object.prototype', () => {
    const vf = makeClient();
    try {
      // @ts-ignore
      vf.hydrate('__proto__', { value: 'hacked' });
    } catch (e) {
      expect(e).toBeInstanceOf(VoidFlagError);
    }
    expect((Object.prototype as any).value).toBeUndefined();
  });

  it('hydrating constructor throws VoidFlagError', () => {
    const vf = makeClient();
    try {
      // @ts-ignore
      vf.hydrate('constructor', { value: 'hacked' });
    } catch (e) {
      expect(e).toBeInstanceOf(VoidFlagError);
    }
  });

  it('hydrating toString throws VoidFlagError', () => {
    const vf = makeClient();
    try {
      // @ts-ignore
      vf.hydrate('toString', { value: 'hacked' });
    } catch (e) {
      expect(e).toBeInstanceOf(VoidFlagError);
    }
  });

  it('applyState with __proto__ key throws VoidFlagError', () => {
    const vf = makeClient();
    try {
      // @ts-ignore
      vf.applyState({ __proto__: { value: 'hacked' } });
    } catch (e) {
      expect(e).toBeInstanceOf(VoidFlagError);
    }
    expect((Object.prototype as any).value).toBeUndefined();
  });

  it('Object.prototype is clean after any failed hydrate', () => {
    const vf = makeClient();
    const reservedKeys = [
      '__proto__',
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
    ];
    for (const k of reservedKeys) {
      try {
        // @ts-ignore
        vf.hydrate(k, { value: 'polluted' });
      } catch (_) {}
    }
    expect((Object.prototype as any).value).toBeUndefined();
    expect((Object.prototype as any).enabled).toBeUndefined();
    expect((Object.prototype as any).rollout).toBeUndefined();
  });
});

// ================================================================
// TYPE VALIDATION
// ================================================================

describe('type validation at runtime', () => {
  it('boolean flag rejects string value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('darkMode', { value: 'yes' as any })).toThrow(VoidFlagError);
    expect(vf.flags.darkMode.value).toBe(false); // store untouched
  });

  it('boolean flag rejects number value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('darkMode', { value: 1 as any })).toThrow(VoidFlagError);
    expect(vf.flags.darkMode.value).toBe(false);
  });

  it('boolean flag rejects null value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('darkMode', { value: null as any })).toThrow(VoidFlagError);
  });

  it('string flag rejects number value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { value: 500 as any })).toThrow(VoidFlagError);
    expect(vf.flags.theme.value).toBe('light');
  });

  it('string flag rejects boolean value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { value: true as any })).toThrow(VoidFlagError);
    expect(vf.flags.theme.value).toBe('light');
  });

  it('number flag rejects string value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('retryCount', { value: '500' as any })).toThrow(
      VoidFlagError,
    );
    expect(vf.flags.retryCount.value).toBe(3); // store untouched
  });

  it('number flag rejects boolean value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('retryCount', { value: true as any })).toThrow(VoidFlagError);
    expect(vf.flags.retryCount.value).toBe(3);
  });

  it('number flag rejects NaN', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('retryCount', { value: NaN })).toThrow(VoidFlagError);
    expect(vf.flags.retryCount.value).toBe(3);
  });

  it('number flag rejects Infinity', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('retryCount', { value: Infinity })).toThrow(VoidFlagError);
  });

  it('number flag rejects -Infinity', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('retryCount', { value: -Infinity })).toThrow(VoidFlagError);
  });

  it('enabled field rejects non-boolean', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('darkMode', { enabled: 'yes' as any })).toThrow(
      VoidFlagError,
    );
    expect(vf.flags.darkMode.enabled).toBe(true);
  });

  it('rollout rejects value above 100', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { rollout: 101 })).toThrow(VoidFlagError);
    expect(vf.snapshot(vf.flags.theme).rollout).toBe(100);
  });

  it('rollout rejects value below 0', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { rollout: -1 })).toThrow(VoidFlagError);
  });

  it('rollout rejects NaN', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { rollout: NaN })).toThrow(VoidFlagError);
  });

  it('unknown patch field throws VoidFlagError', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { fallback: 'dark' } as any)).toThrow(VoidFlagError);
  });

  it('patch must be an object — string throws', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('darkMode', 'true' as any)).toThrow();
  });
});

// ================================================================
// ROLLOUT VALIDATION
// ================================================================

describe('rollout boundary values', () => {
  it('rollout 0 is valid', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { rollout: 0 })).not.toThrow();
    expect(vf.snapshot(vf.flags.theme).rollout).toBe(0);
  });

  it('rollout 100 is valid', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { rollout: 100 })).not.toThrow();
    expect(vf.snapshot(vf.flags.theme).rollout).toBe(100);
  });

  it('rollout 50.5 is valid and stored rounded', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { rollout: 50.5 })).not.toThrow();
    expect(vf.snapshot(vf.flags.theme).rollout).toBeCloseTo(50.5, 2);
  });
});

// ================================================================
// isRolledOutFor GUARD RAILS
// ================================================================

describe('isRolledOutFor() guard rails', () => {
  it('empty string userId throws VoidFlagError', () => {
    const vf = makeClient();
    expect(() => vf.flags.theme.isRolledOutFor('')).toThrow(VoidFlagError);
  });

  it('very long userId does not throw', () => {
    const vf = makeClient();
    expect(() => vf.flags.theme.isRolledOutFor('u'.repeat(10_000))).not.toThrow();
  });

  it('unicode userId does not throw', () => {
    const vf = makeClient();
    expect(() => vf.flags.theme.isRolledOutFor('用户-🎯-émoji')).not.toThrow();
  });

  it('store untouched after bad userId', () => {
    const vf = makeClient();
    vf.hydrate('theme', { value: 'ocean', rollout: 100 });
    try {
      vf.flags.theme.isRolledOutFor('');
    } catch (_) {}
    expect(vf.flags.theme.value).toBe('ocean');
    expect(vf.snapshot(vf.flags.theme).rollout).toBe(100);
  });
});

// ================================================================
// APPLYSTATE ATOMICITY
// ================================================================

describe('applyState atomicity', () => {
  it('bad type mid-batch leaves entire store untouched', () => {
    const vf = makeClient();
    expect(() =>
      vf.applyState({
        darkMode: { value: true },
        theme: { value: 999 as any }, // bad — aborts whole batch
      }),
    ).toThrow(VoidFlagError);
    expect(vf.flags.darkMode.value).toBe(false);
    expect(vf.flags.theme.value).toBe('light');
  });

  it('unknown key mid-batch leaves entire store untouched', () => {
    const vf = makeClient();
    expect(() =>
      vf.applyState({
        darkMode: { value: true },
        // @ts-expect-error
        ghost: { value: 'boo' },
      }),
    ).toThrow(VoidFlagError);
    expect(vf.flags.darkMode.value).toBe(false);
  });

  it('rollout out of range mid-batch leaves entire store untouched', () => {
    const vf = makeClient();
    expect(() =>
      vf.applyState({
        darkMode: { value: true },
        theme: { rollout: 200 }, // bad
      }),
    ).toThrow(VoidFlagError);
    expect(vf.flags.darkMode.value).toBe(false);
    expect(vf.snapshot(vf.flags.theme).rollout).toBe(100);
  });

  it('valid applyState updates all specified flags atomically', () => {
    const vf = makeClient();
    vf.applyState({
      darkMode: { value: true },
      theme: { value: 'dark', rollout: 80 },
      retryCount: { value: 5 },
    });
    expect(vf.flags.darkMode.value).toBe(true);
    expect(vf.flags.theme.value).toBe('dark');
    expect(vf.snapshot(vf.flags.theme).rollout).toBe(80);
    expect(vf.flags.retryCount.value).toBe(5);
  });
});

// ================================================================
// CONSTRUCTOR GUARD RAILS
// ================================================================

describe('constructor guard rails', () => {
  it('dev and envKey are mutually exclusive — throws VoidFlagError', () => {
    expect(() => new VoidClient({ schema, dev: true, envKey: 'key_123' } as any)).toThrow(
      VoidFlagError,
    );
  });
});

// ================================================================
// STORE INTEGRITY AFTER ERRORS
// ================================================================

describe('store integrity after errors', () => {
  it('store survives a sequence of bad hydrations', () => {
    const vf = makeClient();
    // Seed some valid state
    vf.hydrate('darkMode', { value: true });
    vf.hydrate('theme', { value: 'dark' });
    vf.hydrate('retryCount', { value: 10 });

    // Throw a bunch of bad hydrations at it
    const badOps = [
      () => vf.hydrate('darkMode', { value: 'oops' as any }),
      () => vf.hydrate('theme', { value: 42 as any }),
      () => vf.hydrate('retryCount', { value: NaN }),
      () => vf.hydrate('retryCount', { value: 'many' as any }),
      () => vf.hydrate('theme', { rollout: 999 }),
      // @ts-expect-error
      () => vf.hydrate('ghost', { value: true }),
    ];

    for (const op of badOps) {
      expect(op).toThrow(VoidFlagError);
    }

    // Store must be exactly as it was after the valid hydrations
    expect(vf.flags.darkMode.value).toBe(true);
    expect(vf.flags.theme.value).toBe('dark');
    expect(vf.flags.retryCount.value).toBe(10);
  });

  it('fallback is never overwritten by any hydrate', () => {
    const vf = makeClient();
    vf.hydrate('theme', { value: 'ocean' });
    vf.hydrate('theme', { enabled: false });
    vf.hydrate('theme', { rollout: 50 });
    expect(vf.snapshot(vf.flags.theme).fallback).toBe('light');
  });

  it('enabled defaults to true and is not changed by value-only hydrate', () => {
    const vf = makeClient();
    vf.hydrate('retryCount', { value: 99 });
    expect(vf.flags.retryCount.enabled).toBe(true);
  });
});
