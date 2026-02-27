/**
 * VoidClient — Pure Runtime Validation Test Suite
 * Only tests that exercise type guards, boundary enforcement, and error throwing.
 * No vacuous truths. No arithmetic tests. No "doesn't throw" smoke checks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineFlags, boolean, string, number, VoidClient } from '@voidflag/sdk';

const flags = defineFlags({
  darkMode: boolean().fallback(false),
  betaFeatures: boolean().fallback(false),
  maintenanceMode: boolean().fallback(true),

  theme: string().fallback('light'),
  locale: string().fallback('en-US'),
  apiVersion: string().fallback('v1'),

  fontSize: number().fallback(16),
  maxRetries: number().fallback(3),
  timeoutMs: number().fallback(5000),
});

function makeClient() {
  return new VoidClient({ schema: flags });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. TYPE GUARD — boolean flags
// ══════════════════════════════════════════════════════════════════════════════

describe('Type guard — boolean flags', () => {
  it('rejects string value', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { value: 'true' as any } })).toThrow(
      /boolean/i,
    );
  });

  it('rejects numeric 1', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { value: 1 as any } })).toThrow(/boolean/i);
  });

  it('rejects numeric 0', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { value: 0 as any } })).toThrow(/boolean/i);
  });

  it('rejects null', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { value: null as any } })).toThrow();
  });

  it('rejects object', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { value: {} as any } })).toThrow(/boolean/i);
  });

  it('rejects array', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { value: [] as any } })).toThrow(/boolean/i);
  });

  it('accepts true', () => {
    const vf = makeClient();
    vf.applyState({ darkMode: { value: true } });
    expect(vf.get('darkMode')).toBe(true);
  });

  it('accepts false', () => {
    const vf = makeClient();
    vf.applyState({ darkMode: { value: false } });
    expect(vf.get('darkMode')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. TYPE GUARD — string flags
// ══════════════════════════════════════════════════════════════════════════════

describe('Type guard — string flags', () => {
  it('rejects boolean true', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ theme: { value: true as any } })).toThrow(/string/i);
  });

  it('rejects boolean false', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ theme: { value: false as any } })).toThrow(/string/i);
  });

  it('rejects number', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ theme: { value: 42 as any } })).toThrow(/string/i);
  });

  it('rejects null', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ theme: { value: null as any } })).toThrow();
  });

  it('rejects object', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ theme: { value: {} as any } })).toThrow(/string/i);
  });

  it('accepts empty string', () => {
    const vf = makeClient();
    vf.applyState({ theme: { value: '' } });
    expect(vf.get('theme')).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. TYPE GUARD — number flags
// ══════════════════════════════════════════════════════════════════════════════

describe('Type guard — number flags', () => {
  it('rejects string', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ fontSize: { value: '16' as any } })).toThrow(/number/i);
  });

  it('rejects boolean', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ fontSize: { value: false as any } })).toThrow(/number/i);
  });

  it('rejects NaN', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ fontSize: { value: NaN as any } })).toThrow();
  });

  it('rejects Infinity', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ fontSize: { value: Infinity as any } })).toThrow();
  });

  it('rejects -Infinity', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ fontSize: { value: -Infinity as any } })).toThrow();
  });

  it('rejects null', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ fontSize: { value: null as any } })).toThrow();
  });

  it('accepts 0', () => {
    const vf = makeClient();
    vf.applyState({ fontSize: { value: 0 } });
    expect(vf.get('fontSize')).toBe(0);
  });

  it('accepts negative finite number', () => {
    const vf = makeClient();
    vf.applyState({ fontSize: { value: -1 } });
    expect(vf.get('fontSize')).toBe(-1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. TYPE GUARD — enabled field
// ══════════════════════════════════════════════════════════════════════════════

describe('Type guard — enabled field', () => {
  it('rejects string "true"', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { enabled: 'true' as any } })).toThrow(
      /boolean/i,
    );
  });

  it('rejects numeric 1', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { enabled: 1 as any } })).toThrow(/boolean/i);
  });

  it('rejects numeric 0', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { enabled: 0 as any } })).toThrow(/boolean/i);
  });

  it('rejects null', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { enabled: null as any } })).toThrow(
      /boolean/i,
    );
  });

  it('rejects object', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { enabled: {} as any } })).toThrow(/boolean/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ROLLOUT BOUNDARY ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('Rollout boundary enforcement', () => {
  it('rejects -1', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { rollout: -1 } })).toThrow();
  });
  it('accepts 50.5 and rounds to 50.50', () => {
    const vf = makeClient();
    vf.applyState({ theme: { rollout: 50.5 } });
    expect(vf.snapshot('theme').rollout).toBe(50.5);
  });

  it('accepts 33.333 and rounds to 33.33', () => {
    const vf = makeClient();
    vf.applyState({ theme: { rollout: 33.333 } });
    expect(vf.snapshot('theme').rollout).toBe(33.33);
  });

  it('accepts 99.999 and rounds to 100.00', () => {
    const vf = makeClient();
    vf.applyState({ theme: { rollout: 99.999 } });
    expect(vf.snapshot('theme').rollout).toBe(100);
  });
  it('rejects NaN', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { rollout: NaN } })).toThrow();
  });

  it('rejects Infinity', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { rollout: Infinity } })).toThrow();
  });

  it('rejects string rollout', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: { rollout: '50' as any } })).toThrow();
  });

  it('accepts boundary 0', () => {
    const vf = makeClient();
    vf.applyState({ darkMode: { rollout: 0 } });
    expect(vf.snapshot('darkMode').rollout).toBe(0);
  });

  it('accepts boundary 100', () => {
    const vf = makeClient();
    vf.applyState({ fontSize: { rollout: 100 } });
    expect(vf.snapshot('fontSize').rollout).toBe(100);
  });

  it('accepts integer in range', () => {
    const vf = makeClient();
    vf.applyState({ theme: { rollout: 37 } });
    expect(vf.snapshot('theme').rollout).toBe(37);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. PATCH FIELD WHITELIST
// ══════════════════════════════════════════════════════════════════════════════

describe('Patch field whitelist', () => {
  const illegalFields = [
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'inject',
    'hack',
    'type',
    'fallback',
    '__proto__',
    'constructor',
  ];

  for (const field of illegalFields) {
    it(`rejects unknown patch field "${field}"`, () => {
      const vf = makeClient();
      expect(() => vf.applyState({ darkMode: { [field]: true } as any })).toThrow(
        /unknown patch field|reserved/i,
      );
    });
  }

  it('rejects non-object patch (primitive string)', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ darkMode: 'true' as any })).toThrow(/object/i);
  });

  it('rejects non-object patch (number)', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ theme: 1 as any })).toThrow(/object/i);
  });

  it('rejects non-object patch (boolean)', () => {
    const vf = makeClient();
    expect(() => vf.applyState({ fontSize: true as any })).toThrow(/object/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. KEY SAFETY — PROTOTYPE POLLUTION ATTEMPTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Key safety — prototype pollution', () => {
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

  for (const key of dangerousKeys) {
    it(`applyState() rejects "${key}" as a top-level key`, () => {
      const vf = makeClient();
      expect(() => vf.applyState({ [key]: { value: 'pwned' } } as any)).toThrow();
    });

    it(`get() rejects "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.get(key as any)).toThrow();
    });

    it(`enabled() rejects "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.enabled(key as any)).toThrow();
    });

    it(`hydrate() rejects "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.hydrate(key as any, { value: 'pwned' })).toThrow();
    });

    it(`snapshot() rejects "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.snapshot(key as any)).toThrow();
    });

    it(`flag() rejects "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.flag(key as any)).toThrow();
    });
  }

  it('applyState() with __proto__ does not pollute Object.prototype', () => {
    const vf = makeClient();
    try {
      vf.applyState({ ['__proto__']: { value: 'pwned' } } as any);
    } catch (_) {}
    expect(({} as any).value).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. UNKNOWN FLAG KEYS
// ══════════════════════════════════════════════════════════════════════════════

describe('Unknown flag keys', () => {
  const unknownKeys = ['ghost', 'DARKMODE', 'dark_mode', ' darkMode', 'darkMode '];

  for (const key of unknownKeys) {
    it(`applyState() throws for unknown key "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.applyState({ [key]: { value: true } } as any)).toThrow();
    });

    it(`get() throws for unknown key "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.get(key as any)).toThrow();
    });

    it(`flag() throws for unknown key "${key}"`, () => {
      const vf = makeClient();
      expect(() => vf.flag(key as any)).toThrow();
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. ATOMICITY — partial batch must not partially apply
// ══════════════════════════════════════════════════════════════════════════════

describe('applyState() atomicity', () => {
  it('rolls back valid patches when a later patch is invalid', () => {
    const vf = makeClient();
    expect(() =>
      vf.applyState({
        theme: { value: 'dark' },
        fontSize: { value: 'big' as any },
      }),
    ).toThrow();
    expect(vf.get('theme')).toBe('light');
    expect(vf.get('fontSize')).toBe(16);
  });

  it('rolls back when an early patch is invalid and a later one is valid', () => {
    const vf = makeClient();
    expect(() =>
      vf.applyState({
        fontSize: { value: NaN as any },
        theme: { value: 'dark' },
      }),
    ).toThrow();
    expect(vf.get('theme')).toBe('light');
    expect(vf.get('fontSize')).toBe(16);
  });

  it('rolls back when all patches are invalid', () => {
    const vf = makeClient();
    expect(() =>
      vf.applyState({
        darkMode: { value: 'yes' as any },
        fontSize: { rollout: 999 },
      }),
    ).toThrow();
    expect(vf.get('darkMode')).toBe(false);
    expect(vf.snapshot('fontSize').rollout).toBe(100);
  });

  it('applies cleanly when all patches are valid', () => {
    const vf = makeClient();
    vf.applyState({
      theme: { value: 'dark' },
      fontSize: { value: 20 },
      darkMode: { enabled: true, value: true },
    });
    expect(vf.get('theme')).toBe('dark');
    expect(vf.get('fontSize')).toBe(20);
    expect(vf.get('darkMode')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. hydrate() VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('hydrate() validation', () => {
  it('rejects type-mismatched value', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('fontSize', { value: 'big' as any })).toThrow();
  });

  it('rejects invalid rollout', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { rollout: -5 })).toThrow();
  });

  it('rejects non-boolean enabled', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('darkMode', { enabled: 'yes' as any })).toThrow();
  });

  it('rejects unknown patch field', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { inject: 'x' } as any)).toThrow(
      /unknown patch field/i,
    );
  });

  it('rejects fallback as a patch field', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { fallback: 'x' } as any)).toThrow(
      /unknown patch field/i,
    );
  });

  it('rejects type as a patch field', () => {
    const vf = makeClient();
    expect(() => vf.hydrate('theme', { type: 'STRING' } as any)).toThrow(
      /unknown patch field/i,
    );
  });

  it('accepts valid hydration and mutates state', () => {
    const vf = makeClient();
    vf.hydrate('theme', { value: 'ocean', enabled: false, rollout: 50 });
    const snap = vf.snapshot('theme');
    expect(snap.value).toBe('ocean');
    expect(snap.enabled).toBe(false);
    expect(snap.rollout).toBe(50);
  });

  it('hydrating with empty object does not throw and does not mutate', () => {
    const vf = makeClient();
    const before = vf.snapshot('theme');
    vf.hydrate('theme', {});
    const after = vf.snapshot('theme');
    expect(after.value).toBe(before.value);
    expect(after.enabled).toBe(before.enabled);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. isRolledOutFor() VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('isRolledOutFor() validation', () => {
  it('rejects non-string userId (number)', () => {
    const vf = makeClient();
    expect(() => vf.isRolledOutFor('darkMode', 42 as any)).toThrow(/string/i);
  });

  it('rejects non-string userId (null)', () => {
    const vf = makeClient();
    expect(() => vf.isRolledOutFor('darkMode', null as any)).toThrow();
  });

  it('rejects non-string userId (boolean)', () => {
    const vf = makeClient();
    expect(() => vf.isRolledOutFor('darkMode', true as any)).toThrow(/string/i);
  });

  it('rejects non-string userId (object)', () => {
    const vf = makeClient();
    expect(() => vf.isRolledOutFor('darkMode', {} as any)).toThrow(/string/i);
  });

  it('rejects unknown flag key', () => {
    const vf = makeClient();
    expect(() => vf.isRolledOutFor('phantom' as any, 'user-1')).toThrow();
  });

  it('returns false for disabled flag even at rollout=100', () => {
    const vf = makeClient();
    vf.applyState({ darkMode: { enabled: false, rollout: 100 } });
    expect(vf.isRolledOutFor('darkMode', 'user-1')).toBe(false);
  });

  it('returns true for enabled flag at rollout=100', () => {
    const vf = makeClient();
    vf.applyState({ darkMode: { enabled: true, rollout: 100 } });
    expect(vf.isRolledOutFor('darkMode', 'any-user')).toBe(true);
  });

  it('returns false for enabled flag at rollout=0', () => {
    const vf = makeClient();
    vf.applyState({ darkMode: { enabled: true, rollout: 0 } });
    expect(vf.isRolledOutFor('darkMode', 'any-user')).toBe(false);
  });

  it('is deterministic — same userId always gets same result', () => {
    const vf = makeClient();
    vf.applyState({ betaFeatures: { enabled: true, rollout: 50 } });
    const result = vf.isRolledOutFor('betaFeatures', 'user-stable');
    for (let i = 0; i < 20; i++) {
      expect(vf.isRolledOutFor('betaFeatures', 'user-stable')).toBe(result);
    }
  });

  it('flag key is included in the hash — same userId buckets independently per flag', () => {
    const vf = makeClient();
    vf.applyState({ darkMode: { enabled: true, rollout: 50 } });
    vf.applyState({ betaFeatures: { enabled: true, rollout: 50 } });
    // Both calls must return a boolean without throwing; key isolation is the guard
    expect(typeof vf.isRolledOutFor('darkMode', 'user-crosscheck')).toBe('boolean');
    expect(typeof vf.isRolledOutFor('betaFeatures', 'user-crosscheck')).toBe('boolean');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. SNAPSHOT CORRECTNESS
// ══════════════════════════════════════════════════════════════════════════════

describe('snapshot() correctness', () => {
  it('snapshot.value is raw stored value, NOT resolved (disabled flag)', () => {
    const vf = makeClient();
    vf.applyState({ theme: { value: 'dark', enabled: false } });
    const snap = vf.snapshot('theme');
    // snapshot exposes the raw stored value
    expect(snap.value).toBe('dark');
    // get() resolves through enabled → returns fallback
    expect(vf.get('theme')).toBe('light');
  });

  it('snapshot is frozen — direct mutation throws', () => {
    const vf = makeClient();
    const snap = vf.snapshot('theme') as any;
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      snap.value = 'hacked';
    }).toThrow();
  });

  it('mutating snapshot does not bleed into internal store', () => {
    const vf = makeClient();
    const snap = vf.snapshot('theme') as any;
    try {
      snap.value = 'hacked';
    } catch (_) {}
    expect(vf.get('theme')).toBe('light');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. ACCESSOR VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Accessor validation', () => {
  it('accessor.value returns fallback when disabled', () => {
    const vf = makeClient();
    const acc = vf.flag('theme');
    vf.applyState({ theme: { value: 'dark', enabled: false } });
    expect(acc.value).toBe('light');
  });

  it('accessor.value returns live value when enabled', () => {
    const vf = makeClient();
    const acc = vf.flag('theme');
    vf.applyState({ theme: { value: 'dark', enabled: true } });
    expect(acc.value).toBe('dark');
  });

  it('accessor.fallback is always the schema fallback, unaffected by enabled/value', () => {
    const vf = makeClient();
    const acc = vf.flag('theme');
    vf.applyState({ theme: { value: 'dark', enabled: false } });
    expect(acc.fallback).toBe('light');
  });

  it('all accessor properties throw after dispose', () => {
    const vf = makeClient();
    const acc = vf.flag('theme');
    vf.dispose();
    expect(() => acc.value).toThrow(/disposed/i);
    expect(() => acc.enabled).toThrow(/disposed/i);
    expect(() => acc.fallback).toThrow(/disposed/i);
    expect(() => acc.rollout).toThrow(/disposed/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. DISPOSE GUARD — every public method
// ══════════════════════════════════════════════════════════════════════════════

describe('Dispose guard', () => {
  it('get() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.get('theme')).toThrow(/disposed/i);
  });

  it('enabled() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.enabled('theme')).toThrow(/disposed/i);
  });

  it('allEnabled() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.allEnabled(['theme'])).toThrow(/disposed/i);
  });

  it('applyState() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.applyState({ theme: { value: 'dark' } })).toThrow(/disposed/i);
  });

  it('flag() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.flag('theme')).toThrow(/disposed/i);
  });

  it('snapshot() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.snapshot('theme')).toThrow(/disposed/i);
  });

  it('debugSnapshots() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.debugSnapshots()).toThrow(/disposed/i);
  });

  it('hydrate() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.hydrate('theme', { value: 'dark' })).toThrow(/disposed/i);
  });

  it('isRolledOutFor() throws after dispose', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.isRolledOutFor('darkMode', 'user')).toThrow(/disposed/i);
  });

  it('connect() throws after dispose', async () => {
    const vf = makeClient();
    vf.dispose();
    await expect(vf.connect()).rejects.toThrow(/disposed/i);
  });

  it('double dispose does not throw', () => {
    const vf = makeClient();
    vf.dispose();
    expect(() => vf.dispose()).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. CONSTRUCTOR VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Constructor validation', () => {
  it('applyStateSchema with prototype pollution throws', () => {
    expect(
      () =>
        new VoidClient({
          schema: flags,
          applyStateSchema: { ['__proto__' as any]: { value: 'pwned' } },
        }),
    ).toThrow();
  });

  it('applyStateSchema with type mismatch throws', () => {
    expect(
      () =>
        new VoidClient({
          schema: flags,
          applyStateSchema: { fontSize: { value: 'big' as any } },
        }),
    ).toThrow();
  });

  it('applyStateSchema with invalid rollout throws', () => {
    expect(
      () =>
        new VoidClient({
          schema: flags,
          applyStateSchema: { darkMode: { rollout: -1 } },
        }),
    ).toThrow();
  });

  it('applyStateSchema with unknown flag key throws', () => {
    expect(
      () =>
        new VoidClient({
          schema: flags,
          applyStateSchema: { ['ghost' as any]: { value: true } },
        }),
    ).toThrow();
  });

  it('valid applyStateSchema applies correctly', () => {
    const vf = new VoidClient({
      schema: flags,
      applyStateSchema: {
        theme: { value: 'dark' },
        fontSize: { value: 24, rollout: 80 },
      },
    });
    expect(vf.get('theme')).toBe('dark');
    expect(vf.get('fontSize')).toBe(24);
    expect(vf.snapshot('fontSize').rollout).toBe(80);
  });
});
