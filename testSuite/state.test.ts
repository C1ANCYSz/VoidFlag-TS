import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VoidClient,
  VoidFlagError,
  defineFlags,
  boolean,
  string,
  number,
} from '@voidflag/sdk';

/* ============================================================
   Schemas
============================================================ */

const smallSchema = defineFlags({
  darkMode: boolean().fallback(false),
  theme: string().fallback('light'),
  fontSize: number().fallback(16),
});

// Big schema — exercises lazy flags path (>= EAGER_ACCESSOR_THRESHOLD)
const bigSchema = defineFlags({
  darkMode: boolean().fallback(false),
  betaMode: boolean().fallback(false),
  maintenanceMode: boolean().fallback(false),
  analyticsEnabled: boolean().fallback(true),
  experimentalEditor: boolean().fallback(false),
  newOnboarding: boolean().fallback(false),
  strictMode: boolean().fallback(true),
  featurePreview: boolean().fallback(false),
  theme: string().fallback('light'),
  locale: string().fallback('en-US'),
  currency: string().fallback('USD'),
  apiVersion: string().fallback('v1'),
  colorScheme: string().fallback('default'),
  layoutVariant: string().fallback('grid'),
  fontFamily: string().fallback('Inter'),
  buttonStyle: string().fallback('rounded'),
  fontSize: number().fallback(16),
  maxUploadMb: number().fallback(10),
  sessionTimeoutMin: number().fallback(30),
  maxRetries: number().fallback(3),
  cacheTtlSec: number().fallback(300),
  paginationSize: number().fallback(20),
  debounceMs: number().fallback(300),
  rateLimit: number().fallback(100),
});

/* ============================================================
   Helpers
============================================================ */

function makeBigClient() {
  return new VoidClient({ schema: bigSchema });
}

/* ============================================================
   1. Constructor — initial state
============================================================ */

describe('constructor — initial state', () => {
  it('initialises every boolean flag with its fallback value and enabled=true', () => {
    const client = makeBigClient();
    expect(client.get('darkMode')).toBe(false);
    expect(client.get('betaMode')).toBe(false);
    expect(client.get('analyticsEnabled')).toBe(true);
    expect(client.enabled('darkMode')).toBe(true);
  });

  it('initialises every string flag with its fallback value', () => {
    const client = makeBigClient();
    expect(client.get('theme')).toBe('light');
    expect(client.get('locale')).toBe('en-US');
    expect(client.get('apiVersion')).toBe('v1');
    expect(client.get('fontFamily')).toBe('Inter');
  });

  it('initialises every number flag with its fallback value', () => {
    const client = makeBigClient();
    expect(client.get('fontSize')).toBe(16);
    expect(client.get('maxUploadMb')).toBe(10);
    expect(client.get('rateLimit')).toBe(100);
  });

  it('sets rollout=0 for boolean flags and rollout=100 for string/number flags', () => {
    const client = makeBigClient();
    expect(client.snapshot('darkMode').rollout).toBe(0);
    expect(client.snapshot('betaMode').rollout).toBe(0);
    expect(client.snapshot('theme').rollout).toBe(100);
    expect(client.snapshot('fontSize').rollout).toBe(100);
  });

  it('applies applyStateSchema during construction', () => {
    const client = new VoidClient({
      schema: bigSchema,
      applyStateSchema: {
        darkMode: { value: true, enabled: true },
        theme: { value: 'dark' },
        fontSize: { value: 24 },
        rateLimit: { value: 50, rollout: 75 },
      },
    });
    expect(client.get('darkMode')).toBe(true);
    expect(client.get('theme')).toBe('dark');
    expect(client.get('fontSize')).toBe(24);
    expect(client.snapshot('rateLimit').rollout).toBe(75);
  });

  it('constructor applyStateSchema does not mutate flags not listed', () => {
    const client = new VoidClient({
      schema: bigSchema,
      applyStateSchema: { darkMode: { value: true } },
    });
    expect(client.get('theme')).toBe('light');
    expect(client.get('fontSize')).toBe(16);
    expect(client.get('locale')).toBe('en-US');
  });
});

/* ============================================================
   2. applyState() — happy path: values
============================================================ */

describe('applyState() — value overrides', () => {
  it('overrides a boolean flag value', () => {
    const client = makeBigClient();
    client.applyState({ darkMode: { value: true } });
    expect(client.get('darkMode')).toBe(true);
  });

  it('overrides a string flag value', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark' } });
    expect(client.get('theme')).toBe('dark');
  });

  it('overrides a number flag value', () => {
    const client = makeBigClient();
    client.applyState({ fontSize: { value: 20 } });
    expect(client.get('fontSize')).toBe(20);
  });

  it('overrides multiple flags in a single call', () => {
    const client = makeBigClient();
    client.applyState({
      darkMode: { value: true },
      theme: { value: 'midnight' },
      fontSize: { value: 18 },
      locale: { value: 'fr-FR' },
      maxRetries: { value: 5 },
      sessionTimeoutMin: { value: 60 },
      layoutVariant: { value: 'list' },
      buttonStyle: { value: 'square' },
    });
    expect(client.get('darkMode')).toBe(true);
    expect(client.get('theme')).toBe('midnight');
    expect(client.get('fontSize')).toBe(18);
    expect(client.get('locale')).toBe('fr-FR');
    expect(client.get('maxRetries')).toBe(5);
    expect(client.get('sessionTimeoutMin')).toBe(60);
    expect(client.get('layoutVariant')).toBe('list');
    expect(client.get('buttonStyle')).toBe('square');
  });

  it('overriding a value does not touch the fallback', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark' } });
    expect(client.snapshot('theme').fallback).toBe('light');
  });

  it('overriding a value does not change enabled state', () => {
    const client = makeBigClient();
    client.applyState({ analyticsEnabled: { value: false } });
    expect(client.enabled('analyticsEnabled')).toBe(true);
  });

  it('supports value=0 (falsy number)', () => {
    const client = makeBigClient();
    client.applyState({ fontSize: { value: 0 } });
    expect(client.get('fontSize')).toBe(0);
  });

  it('supports value="" (empty string)', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: '' } });
    expect(client.get('theme')).toBe('');
  });

  it('supports value=false on a boolean flag that defaults true', () => {
    const client = makeBigClient();
    client.applyState({ analyticsEnabled: { value: false } });
    expect(client.get('analyticsEnabled')).toBe(false);
  });

  it('chaining applyState() calls accumulates state', () => {
    const client = makeBigClient();
    client
      .applyState({ darkMode: { value: true } })
      .applyState({ theme: { value: 'dim' } })
      .applyState({ fontSize: { value: 14 } });
    expect(client.get('darkMode')).toBe(true);
    expect(client.get('theme')).toBe('dim');
    expect(client.get('fontSize')).toBe(14);
  });

  it('second applyState() call overwrites first for the same flag', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark' } });
    client.applyState({ theme: { value: 'sepia' } });
    expect(client.get('theme')).toBe('sepia');
  });

  it('returns `this` for chaining', () => {
    const client = makeBigClient();
    const result = client.applyState({ darkMode: { value: true } });
    expect(result).toBe(client);
  });
});

/* ============================================================
   3. applyState() — enabled overrides
============================================================ */

describe('applyState() — enabled overrides', () => {
  it('disabling a flag makes get() return the fallback', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark', enabled: false } });
    expect(client.get('theme')).toBe('light');
  });

  it('disabling a boolean flag makes get() return the boolean fallback', () => {
    const client = makeBigClient();
    client.applyState({ analyticsEnabled: { value: false, enabled: false } });
    // fallback is true, flag is disabled → should return fallback
    expect(client.get('analyticsEnabled')).toBe(true);
  });

  it('disabling a number flag makes get() return the numeric fallback', () => {
    const client = makeBigClient();
    client.applyState({ fontSize: { value: 32, enabled: false } });
    expect(client.get('fontSize')).toBe(16);
  });

  it('enabled: false is visible via enabled()', () => {
    const client = makeBigClient();
    client.applyState({ darkMode: { enabled: false } });
    expect(client.enabled('darkMode')).toBe(false);
  });

  it('re-enabling a flag restores value access', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark', enabled: false } });
    expect(client.get('theme')).toBe('light');
    client.applyState({ theme: { enabled: true } });
    expect(client.get('theme')).toBe('dark');
  });

  it('accessor .value respects enabled=false', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'cosmic', enabled: false } });
    expect(client.flag('theme').value).toBe('light');
    expect(client.flag('theme').enabled).toBe(false);
  });

  it('accessor .value reflects re-enable live', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'cosmic', enabled: false } });
    const accessor = client.flag('theme');
    client.applyState({ theme: { enabled: true } });
    expect(accessor.value).toBe('cosmic');
    expect(accessor.enabled).toBe(true);
  });

  it('allEnabled() returns false when any flag is disabled', () => {
    const client = makeBigClient();
    client.applyState({ darkMode: { enabled: false } });
    expect(client.allEnabled(['darkMode', 'theme'])).toBe(false);
  });

  it('allEnabled() returns true when all flags are enabled', () => {
    const client = makeBigClient();
    expect(client.allEnabled(['theme', 'fontSize', 'locale'])).toBe(true);
  });
});

/* ============================================================
   4. applyState() — rollout overrides
============================================================ */

describe('applyState() — rollout overrides', () => {
  it('sets rollout to a valid boundary value 0', () => {
    const client = makeBigClient();
    client.applyState({ theme: { rollout: 0 } });
    expect(client.snapshot('theme').rollout).toBe(0);
  });

  it('sets rollout to a valid boundary value 100', () => {
    const client = makeBigClient();
    client.applyState({ fontSize: { rollout: 100 } });
    expect(client.snapshot('fontSize').rollout).toBe(100);
  });

  it('sets rollout to an arbitrary mid-range integer', () => {
    const client = makeBigClient();
    client.applyState({ newOnboarding: { rollout: 42 } });
    expect(client.snapshot('newOnboarding').rollout).toBe(42);
  });

  it('rollout=100 means isRolledOutFor() is always true (when enabled)', () => {
    const client = makeBigClient();
    client.applyState({ theme: { rollout: 100 } });
    for (let i = 0; i < 50; i++) {
      expect(client.isRolledOutFor('theme', `user-${i}`)).toBe(true);
    }
  });

  it('rollout=0 means isRolledOutFor() is always false', () => {
    const client = makeBigClient();
    client.applyState({ theme: { rollout: 0 } });
    for (let i = 0; i < 50; i++) {
      expect(client.isRolledOutFor('theme', `user-${i}`)).toBe(false);
    }
  });

  it('isRolledOutFor() returns false when flag is disabled regardless of rollout', () => {
    const client = makeBigClient();
    client.applyState({ theme: { rollout: 100, enabled: false } });
    expect(client.isRolledOutFor('theme', 'any-user')).toBe(false);
  });

  it('rollout=50 produces a distribution roughly around 50%', () => {
    const client = makeBigClient();
    client.applyState({ newOnboarding: { rollout: 50 } });
    let trueCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (client.isRolledOutFor('newOnboarding', `user-${i}`)) trueCount++;
    }
    expect(trueCount).toBeGreaterThan(400);
    expect(trueCount).toBeLessThan(600);
  });

  it('stableHash produces deterministic results for the same userId', () => {
    const client = makeBigClient();
    client.applyState({ newOnboarding: { rollout: 50 } });
    const first = client.isRolledOutFor('newOnboarding', 'stable-user-99');
    const second = client.isRolledOutFor('newOnboarding', 'stable-user-99');
    expect(first).toBe(second);
  });

  it('throws for rollout -1', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ theme: { rollout: -1 } })).toThrowError(
      VoidFlagError,
    );
  });

  it('throws for rollout 101', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ theme: { rollout: 101 } })).toThrowError(
      VoidFlagError,
    );
  });

  it('accepts float rollout like 50.5 and rounds to 2dp', () => {
    const client = makeBigClient();
    client.applyState({ theme: { rollout: 50.5 } });
    expect(client.snapshot('theme').rollout).toBe(50.5);
  });
  it('throws for NaN rollout', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ theme: { rollout: NaN } })).toThrowError(
      VoidFlagError,
    );
  });

  it('throws for Infinity rollout', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ theme: { rollout: Infinity } })).toThrowError(
      VoidFlagError,
    );
  });

  it('error message contains the flag key', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ fontSize: { rollout: -5 } })).toThrowError(
      'fontSize',
    );
  });

  it('error message mentions applyState()', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ fontSize: { rollout: 200 } })).toThrowError(
      'applyState()',
    );
  });
});

/* ============================================================
   5. applyState() — type validation errors
============================================================ */

describe('applyState() — type mismatches', () => {
  it('throws when passing a string to a boolean flag', () => {
    const client = makeBigClient();
    expect(() =>
      client.applyState({ darkMode: { value: 'yes' as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('throws when passing a number to a boolean flag', () => {
    const client = makeBigClient();
    expect(() =>
      client.applyState({ darkMode: { value: 1 as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('throws when passing a boolean to a string flag', () => {
    const client = makeBigClient();
    expect(() =>
      client.applyState({ theme: { value: true as unknown as string } }),
    ).toThrowError(VoidFlagError);
  });

  it('throws when passing a number to a string flag', () => {
    const client = makeBigClient();
    expect(() =>
      client.applyState({ theme: { value: 99 as unknown as string } }),
    ).toThrowError(VoidFlagError);
  });

  it('throws when passing a string to a number flag', () => {
    const client = makeBigClient();
    expect(() =>
      client.applyState({ fontSize: { value: '16px' as unknown as number } }),
    ).toThrowError(VoidFlagError);
  });

  it('throws when passing a boolean to a number flag', () => {
    const client = makeBigClient();
    expect(() =>
      client.applyState({ fontSize: { value: true as unknown as number } }),
    ).toThrowError(VoidFlagError);
  });

  it('error message contains the flag key on type mismatch', () => {
    const client = makeBigClient();
    expect(() =>
      client.applyState({ colorScheme: { value: 42 as unknown as string } }),
    ).toThrowError('colorScheme');
  });

  it('does not throw when value is omitted (only enabled override)', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ darkMode: { enabled: false } })).not.toThrow();
  });

  it('does not throw when value is omitted (only rollout override)', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ rateLimit: { rollout: 50 } })).not.toThrow();
  });
});

/* ============================================================
   6. applyState() — unknown / prototype-poisoning keys
============================================================ */

describe('applyState() — key safety', () => {
  it('throws for a flag key that does not exist in the schema', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ nonExistent: { value: true } } as any)).toThrowError(
      VoidFlagError,
    );
  });

  it('__proto__ key is silently ignored — null-prototype store is unaffected', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ __proto__: { value: true } } as any)).not.toThrow();
    // Confirm no flags were mutated
    expect(client.get('darkMode')).toBe(false);
    expect(client.get('theme')).toBe('light');
  });

  it('throws for prototype key', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ prototype: { value: true } } as any)).toThrowError(
      VoidFlagError,
    );
  });

  it('throws for constructor key', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ constructor: { value: true } } as any)).toThrowError(
      VoidFlagError,
    );
  });

  it('skips null/undefined patches gracefully', () => {
    const client = makeBigClient();
    expect(() => client.applyState({ darkMode: undefined } as any)).not.toThrow();
    expect(client.get('darkMode')).toBe(false);
  });
});

/* ============================================================
   7. applyState() — disposed client
============================================================ */

describe('applyState() — disposed client', () => {
  it('throws VoidFlagError when calling applyState after dispose()', () => {
    const client = makeBigClient();
    client.dispose();
    expect(() => client.applyState({ darkMode: { value: true } })).toThrowError(
      VoidFlagError,
    );
  });

  it('error message mentions disposed', () => {
    const client = makeBigClient();
    client.dispose();
    expect(() => client.applyState({ theme: { value: 'dark' } })).toThrowError(
      'disposed',
    );
  });

  it('double dispose() does not throw', () => {
    const client = makeBigClient();
    client.dispose();
    expect(() => client.dispose()).not.toThrow();
  });
});

/* ============================================================
   8. Accessor reactivity after applyState()
============================================================ */

describe('accessor reactivity after applyState()', () => {
  it('previously obtained accessor reflects new value after applyState()', () => {
    const client = makeBigClient();
    const accessor = client.flag('theme');
    expect(accessor.value).toBe('light');
    client.applyState({ theme: { value: 'dark' } });
    expect(accessor.value).toBe('dark');
  });

  it('flags proxy reflects new value after applyState()', () => {
    const client = makeBigClient();
    const { theme } = client.flags;
    client.applyState({ theme: { value: 'solarized' } });
    expect(theme.value).toBe('solarized');
  });

  it('accessor fallback is not mutated by applyState() value change', () => {
    const client = makeBigClient();
    const accessor = client.flag('fontSize');
    client.applyState({ fontSize: { value: 32 } });
    expect(accessor.fallback).toBe(16);
  });

  it('accessor rollout updates after applyState()', () => {
    const client = makeBigClient();
    const accessor = client.flag('paginationSize');
    client.applyState({ paginationSize: { rollout: 55 } });
    expect(accessor.rollout).toBe(55);
  });

  it('accessor is frozen (immutable shape)', () => {
    const client = makeBigClient();
    const accessor = client.flag('theme');
    expect(Object.isFrozen(accessor)).toBe(true);
  });

  it('accessor throws after client is disposed', () => {
    const client = makeBigClient();
    const accessor = client.flag('theme');
    client.dispose();
    expect(() => accessor.value).toThrowError(VoidFlagError);
    expect(() => accessor.enabled).toThrowError(VoidFlagError);
    expect(() => accessor.fallback).toThrowError(VoidFlagError);
    expect(() => accessor.rollout).toThrowError(VoidFlagError);
  });

  it('flag() returns the same cached accessor instance on repeated calls', () => {
    const client = makeBigClient();
    const a = client.flag('theme');
    const b = client.flag('theme');
    expect(a).toBe(b);
  });
});

/* ============================================================
   9. get() / enabled() / allEnabled() after applyState()
============================================================ */

describe('get() / enabled() / allEnabled() after applyState()', () => {
  it('get() returns fallback after disable', () => {
    const client = makeBigClient();
    client.applyState({ currency: { value: 'EUR', enabled: false } });
    expect(client.get('currency')).toBe('USD');
  });

  it('enabled() is false after applyState disable', () => {
    const client = makeBigClient();
    client.applyState({ currency: { enabled: false } });
    expect(client.enabled('currency')).toBe(false);
  });

  it('allEnabled() returns false if one flag among many is disabled', () => {
    const client = makeBigClient();
    client.applyState({ betaMode: { enabled: false } });
    expect(
      client.allEnabled([
        'darkMode',
        'betaMode',
        'analyticsEnabled',
        'theme',
        'fontSize',
      ]),
    ).toBe(false);
  });

  it('allEnabled() returns true for all-enabled set', () => {
    const client = makeBigClient();
    expect(
      client.allEnabled(['theme', 'fontSize', 'locale', 'currency', 'apiVersion']),
    ).toBe(true);
  });

  it('get() throws on unknown key', () => {
    const client = makeBigClient();
    expect(() => client.get('unknown' as any)).toThrowError(VoidFlagError);
  });

  it('enabled() throws on unknown key', () => {
    const client = makeBigClient();
    expect(() => client.enabled('unknown' as any)).toThrowError(VoidFlagError);
  });
});

/* ============================================================
   10. snapshot() / debugSnapshots() after applyState()
============================================================ */

describe('snapshot() / debugSnapshots() after applyState()', () => {
  it('snapshot reflects applied state', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark', rollout: 80, enabled: false } });
    const snap = client.snapshot('theme');
    expect(snap.value).toBe('dark');
    expect(snap.rollout).toBe(80);
    expect(snap.enabled).toBe(false);
    expect(snap.fallback).toBe('light');
  });

  it('snapshot is frozen', () => {
    const client = makeBigClient();
    const snap = client.snapshot('fontSize');
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('snapshot does not update after further applyState() — it is a point-in-time copy', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark' } });
    const snap = client.snapshot('theme');
    client.applyState({ theme: { value: 'solarized' } });
    // snapshot was captured before second applyState
    expect(snap.value).toBe('dark');
    // live get() reflects the new value
    expect(client.get('theme')).toBe('solarized');
  });

  it('debugSnapshots() covers all keys in schema', () => {
    const client = makeBigClient();
    const all = client.debugSnapshots();
    const schemaKeys = Object.keys(bigSchema);
    expect(Object.keys(all).sort()).toEqual(schemaKeys.sort());
  });

  it('debugSnapshots() reflects applied state for every touched flag', () => {
    const client = makeBigClient();
    client.applyState({
      darkMode: { value: true },
      locale: { value: 'ja-JP' },
      debounceMs: { value: 500 },
    });
    const all = client.debugSnapshots();
    expect(all.darkMode.value).toBe(true);
    expect(all.locale.value).toBe('ja-JP');
    expect(all.debounceMs.value).toBe(500);
  });

  it('snapshot() throws on unknown key', () => {
    const client = makeBigClient();
    expect(() => client.snapshot('unknown' as any)).toThrowError(VoidFlagError);
  });
});

/* ============================================================
   11. hydrate() interaction with applyState()
============================================================ */

describe('hydrate() interaction with applyState()', () => {
  it('hydrate() after applyState() overwrites the value', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark' } });
    client.hydrate('theme', { value: 'solarized' });
    expect(client.get('theme')).toBe('solarized');
  });

  it('applyState() after hydrate() overwrites the hydrated value', () => {
    const client = makeBigClient();
    client.hydrate('theme', { value: 'solarized' });
    client.applyState({ theme: { value: 'dark' } });
    expect(client.get('theme')).toBe('dark');
  });

  it('hydrate() with enabled=false is reflected by get()', () => {
    const client = makeBigClient();
    client.applyState({ theme: { value: 'dark' } });
    client.hydrate('theme', { enabled: false });
    expect(client.get('theme')).toBe('light');
  });
});

/* ============================================================
   12. applyState() on the small schema (eager flags path)
============================================================ */

describe('applyState() — eager flags path (< EAGER_ACCESSOR_THRESHOLD)', () => {
  it('applyState() works on a 1-flag schema', () => {
    const oneFlag = defineFlags({ darkMode: boolean().fallback(false) });
    const client = new VoidClient({ schema: oneFlag });
    client.applyState({ darkMode: { value: true } });
    expect(client.get('darkMode')).toBe(true);
  });

  it('flags object is frozen on the eager path', () => {
    const oneFlag = defineFlags({ darkMode: boolean().fallback(false) });
    const client = new VoidClient({ schema: oneFlag });
    expect(Object.isFrozen(client.flags)).toBe(true);
  });

  it('small schema with applyStateSchema in constructor works', () => {
    const client = new VoidClient({
      schema: smallSchema,
      applyStateSchema: {
        darkMode: { value: true },
        theme: { value: 'dark' },
        fontSize: { value: 14 },
      },
    });
    expect(client.get('darkMode')).toBe(true);
    expect(client.get('theme')).toBe('dark');
    expect(client.get('fontSize')).toBe(14);
  });
});

/* ============================================================
   13. isRolledOutFor() with applyState()
============================================================ */

describe('isRolledOutFor() after applyState()', () => {
  it('returns false for all users when rollout=0', () => {
    const client = makeBigClient();
    client.applyState({ newOnboarding: { rollout: 0 } });
    expect(client.isRolledOutFor('newOnboarding', 'alice')).toBe(false);
    expect(client.isRolledOutFor('newOnboarding', 'bob')).toBe(false);
    expect(client.isRolledOutFor('newOnboarding', 'charlie')).toBe(false);
  });

  it('returns true for all users when rollout=100', () => {
    const client = makeBigClient();
    client.applyState({ newOnboarding: { rollout: 100 } });
    expect(client.isRolledOutFor('newOnboarding', 'alice')).toBe(true);
    expect(client.isRolledOutFor('newOnboarding', 'bob')).toBe(true);
    expect(client.isRolledOutFor('newOnboarding', 'charlie')).toBe(true);
  });

  it('returns false regardless of rollout when flag is disabled', () => {
    const client = makeBigClient();
    client.applyState({ featurePreview: { rollout: 100, enabled: false } });
    expect(client.isRolledOutFor('featurePreview', 'alice')).toBe(false);
  });

  it('throws on unknown key', () => {
    const client = makeBigClient();
    expect(() => client.isRolledOutFor('ghost' as any, 'user-1')).toThrowError(
      VoidFlagError,
    );
  });
});

/* ============================================================
   14. Full-schema stress: applyState() then validate all flags
============================================================ */

describe('full-schema stress test', () => {
  it('applying state to every single flag in the big schema at once works correctly', () => {
    const client = makeBigClient();
    client.applyState({
      darkMode: { value: true, rollout: 80 },
      betaMode: { value: true, rollout: 10 },
      maintenanceMode: { value: true, enabled: false },
      analyticsEnabled: { value: false, rollout: 100 },
      experimentalEditor: { value: true, rollout: 25 },
      newOnboarding: { value: true, rollout: 50 },
      strictMode: { value: false, rollout: 90 },
      featurePreview: { value: true, rollout: 5 },
      theme: { value: 'midnight', rollout: 100 },
      locale: { value: 'de-DE' },
      currency: { value: 'EUR' },
      apiVersion: { value: 'v3' },
      colorScheme: { value: 'amoled' },
      layoutVariant: { value: 'masonry' },
      fontFamily: { value: 'JetBrains Mono' },
      buttonStyle: { value: 'pill' },
      fontSize: { value: 14, rollout: 100 },
      maxUploadMb: { value: 50 },
      sessionTimeoutMin: { value: 15 },
      maxRetries: { value: 10 },
      cacheTtlSec: { value: 600 },
      paginationSize: { value: 50 },
      debounceMs: { value: 150 },
      rateLimit: { value: 200, rollout: 60 },
    });

    // booleans
    expect(client.get('darkMode')).toBe(true);
    expect(client.get('betaMode')).toBe(true);
    expect(client.get('maintenanceMode')).toBe(false); // disabled → fallback
    expect(client.get('analyticsEnabled')).toBe(false);
    expect(client.get('strictMode')).toBe(false);

    // strings
    expect(client.get('theme')).toBe('midnight');
    expect(client.get('locale')).toBe('de-DE');
    expect(client.get('currency')).toBe('EUR');
    expect(client.get('apiVersion')).toBe('v3');
    expect(client.get('fontFamily')).toBe('JetBrains Mono');

    // numbers
    expect(client.get('fontSize')).toBe(14);
    expect(client.get('maxUploadMb')).toBe(50);
    expect(client.get('sessionTimeoutMin')).toBe(15);
    expect(client.get('cacheTtlSec')).toBe(600);
    expect(client.get('rateLimit')).toBe(200);

    // disabled flag returns fallback
    expect(client.enabled('maintenanceMode')).toBe(false);
    expect(client.snapshot('maintenanceMode').fallback).toBe(false);

    // rollouts
    expect(client.snapshot('darkMode').rollout).toBe(80);
    expect(client.snapshot('rateLimit').rollout).toBe(60);
    expect(client.snapshot('featurePreview').rollout).toBe(5);
  });
});
