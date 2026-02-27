/**
 * client.adversarial.test.ts
 *
 * This suite is NOT about happy paths. Every test below was written by reading
 * the implementation and asking: "what assumption can I violate, what edge can
 * I drive off, what invariant can I break?" Tests that currently PASS indicate
 * the SDK is solid there. Tests that FAIL expose real bugs to fix.
 *
 * Each describe block has a comment explaining the exact vulnerability being probed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VoidClient,
  VoidFlagError,
  defineFlags,
  boolean,
  string,
  number,
} from '@voidflag/sdk';

/* ============================================================
   Schema
============================================================ */

const schema = defineFlags({
  darkMode: boolean().fallback(false),
  analyticsEnabled: boolean().fallback(true),
  theme: string().fallback('light'),
  locale: string().fallback('en-US'),
  fontSize: number().fallback(16),
  rateLimit: number().fallback(100),
  newOnboarding: boolean().fallback(false),
  betaMode: boolean().fallback(false),
  maxUploadMb: number().fallback(10),
  colorScheme: string().fallback('default'),
});

function make() {
  return new VoidClient({ schema });
}

/* ============================================================
   VULNERABILITY 1
   Object.assign(runtime, patch) writes ALL keys on the patch.
   The SDK only validates value/enabled/rollout but never strips
   extra keys. So passing { value: true, fallback: false, type: 'STRING' }
   will silently overwrite the runtime's `fallback` and `type` fields,
   corrupting the store permanently.
============================================================ */

describe('VULN 1 — Object.assign writes extra keys straight to the runtime store', () => {
  it('should NOT let a patch overwrite the stored fallback via applyState()', () => {
    const client = make();
    // Sneak `fallback` into the patch alongside a valid `value`
    expect(() => {
      client.applyState({
        theme: { value: 'dark', ...({ fallback: 'HACKED' } as any) },
      } as any);
    }).toThrowError(VoidFlagError);
    // The fallback should still be the schema-defined 'light'
    expect(client.snapshot('theme').fallback).toBe('light');
  });

  it('should NOT let a patch overwrite the stored type via applyState()', () => {
    const client = make();
    expect(() => {
      client.applyState({
        darkMode: { value: true, ...({ type: 'STRING' } as any) },
      } as any);
    }).toThrowError(VoidFlagError);
    // Subsequent applyState with a boolean should still work (type not corrupted)
    expect(() => client.applyState({ darkMode: { value: false } })).not.toThrow();
    // And a string should still be rejected
    expect(() =>
      client.applyState({ darkMode: { value: 'yes' as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('should NOT let patch inject arbitrary properties onto the runtime object', () => {
    const client = make();
    const evilPatch = { value: 'dark', __evilProp: 'injected' } as any;
    expect(() => client.applyState({ theme: evilPatch })).toThrow(VoidFlagError);
    // The store's runtime should not have __evilProp
    const snap = client.snapshot('theme') as any;
    expect(snap.__evilProp).toBeUndefined();
  });
});

/* ============================================================
   VULNERABILITY 2
   `!patch` falsy-check in applyState(). The loop does:
     const patch = overrides[key]; if (!patch) continue;
   This correctly skips null/undefined. But what if the patch
   is the number 0 or boolean false (cast via `as any`)?
   Those are falsy → silently skipped instead of throwing.
   A caller who makes a typo and passes a primitive instead of
   an object gets no error feedback.
============================================================ */

describe('VULN 2 — falsy patch values (0, false, "") are silently skipped instead of throwing', () => {
  it('passing 0 as a patch should throw, not silently skip', () => {
    const client = make();
    expect(() => client.applyState({ theme: 0 as any })).toThrowError(VoidFlagError);
  });

  it('passing false as a patch should throw, not silently skip', () => {
    const client = make();
    expect(() => client.applyState({ theme: false as any })).toThrowError(VoidFlagError);
  });

  it('passing empty string as a patch should throw, not silently skip', () => {
    const client = make();
    expect(() => client.applyState({ theme: '' as any })).toThrowError(VoidFlagError);
  });
});

/* ============================================================
   VULNERABILITY 3
   applyState() is NOT atomic. If the overrides object contains
   5 flags and flag 3 fails validation, flags 1 and 2 are already
   mutated. The store is left in a partially-applied, inconsistent
   state with no rollback.
============================================================ */

describe('VULN 3 — applyState() partial mutation on validation failure (no atomicity)', () => {
  it('a validation failure mid-loop should not have mutated earlier flags', () => {
    const client = make();
    // theme (first) is valid, darkMode (second) gets a bad value
    try {
      client.applyState({
        theme: { value: 'dark' }, // valid
        darkMode: { value: 'yes' as unknown as boolean }, // INVALID
      });
    } catch (_) {}
    // theme should NOT have been changed — but it will be, exposing the bug
    expect(client.get('theme')).toBe('light');
  });

  it('a rollout validation failure should not mutate the value applied earlier in the same call', () => {
    const client = make();
    try {
      client.applyState({
        fontSize: { value: 99, rollout: -1 }, // value valid, rollout invalid
      });
    } catch (_) {}
    // fontSize value should not have been changed
    expect(client.get('fontSize')).toBe(16);
  });

  it('a failed applyState() call should leave the client in the exact same state as before', () => {
    const client = make();
    const before = client.debugSnapshots();
    try {
      client.applyState({
        theme: { value: 'dark' },
        fontSize: { value: 99 },
        locale: { value: 42 as unknown as string }, // boom
      });
    } catch (_) {}
    const after = client.debugSnapshots();
    expect(after).toEqual(before);
  });
});

/* ============================================================
   VULNERABILITY 4
   `hydrate()` has zero type validation. You can hydrate a STRING
   value onto a BOOLEAN flag, a negative rollout, a null value —
   anything goes. The store gets silently corrupted and the accessor
   starts returning the wrong type with no error.
============================================================ */

describe('VULN 4 — hydrate() has no type or bounds validation', () => {
  it('hydrating a string value onto a boolean flag should throw', () => {
    const client = make();
    expect(() =>
      client.hydrate('darkMode', { value: 'yes' as unknown as boolean }),
    ).toThrowError(VoidFlagError);
  });

  it('hydrating a number value onto a string flag should throw', () => {
    const client = make();
    expect(() =>
      client.hydrate('theme', { value: 42 as unknown as string }),
    ).toThrowError(VoidFlagError);
  });

  it('hydrating rollout: -1 should throw', () => {
    const client = make();
    expect(() => client.hydrate('fontSize', { rollout: -1 })).toThrowError(VoidFlagError);
  });

  it('hydrating rollout: 101 should throw', () => {
    const client = make();
    expect(() => client.hydrate('theme', { rollout: 101 })).toThrowError(VoidFlagError);
  });

  it('hydrating value: null should throw', () => {
    const client = make();
    expect(() =>
      client.hydrate('darkMode', { value: null as unknown as boolean }),
    ).toThrowError(VoidFlagError);
  });

  it('hydrating an unknown key should throw', () => {
    const client = make();
    expect(() => client.hydrate('ghost' as any, { value: true as any })).toThrowError(
      VoidFlagError,
    );
  });

  it('after a corrupting hydrate, get() should not return the wrong type', () => {
    const client = make();
    // Force corruption — if hydrate() has no validation this will silently work
    try {
      client.hydrate('darkMode', { value: 'corrupted' as unknown as boolean });
    } catch (_) {}
    // Either it threw (good) or it didn't — either way the value must still be boolean
    const val = client.get('darkMode');
    expect(typeof val).toBe('boolean');
  });
});

/* ============================================================
   VULNERABILITY 5
   `for...in` on the overrides object walks the prototype chain.
   If someone passes an object whose prototype has enumerable
   properties matching real flag keys, those inherited keys are
   iterated and applied. The safe-key check only blocks
   __proto__/prototype/constructor, not arbitrary inherited keys.
============================================================ */

describe('VULN 5 — for...in iterates inherited enumerable prototype properties', () => {
  it('inherited prototype key matching a real flag name should not be applied', () => {
    const client = make();
    const proto = { theme: { value: 'HACKED' } };
    const overrides = Object.create(proto); // inherited `theme`
    // `theme` is not an own property, it's inherited
    client.applyState(overrides as any);
    // theme should be unchanged
    expect(client.get('theme')).toBe('light');
  });

  it('only own enumerable keys on the overrides object should be processed', () => {
    const client = make();
    const proto = { fontSize: { value: 999 } };
    const overrides = Object.create(proto);
    // own property — fine
    overrides.locale = { value: 'fr-FR' };
    client.applyState(overrides as any);
    expect(client.get('locale')).toBe('fr-FR');
    // inherited — should NOT have been applied
    expect(client.get('fontSize')).toBe(16);
  });
});

/* ============================================================
   VULNERABILITY 6
   `applyState()` accepts `value: null` without throwing because
   `null !== undefined` passes the first guard, but `typeof null`
   is 'object' which matches none of the type cases in the switch
   — so the switch falls through with no break/default and
   Object.assign silently writes null into the store.
============================================================ */

describe('VULN 6 — value: null bypasses type validation and corrupts the store', () => {
  it('applyState with value: null on a boolean flag should throw', () => {
    const client = make();
    expect(() =>
      client.applyState({ darkMode: { value: null as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('applyState with value: null on a string flag should throw', () => {
    const client = make();
    expect(() =>
      client.applyState({ theme: { value: null as unknown as string } }),
    ).toThrowError(VoidFlagError);
  });

  it('applyState with value: null on a number flag should throw', () => {
    const client = make();
    expect(() =>
      client.applyState({ fontSize: { value: null as unknown as number } }),
    ).toThrowError(VoidFlagError);
  });

  it('after null injection attempt, get() must still return the correct type', () => {
    const client = make();
    try {
      client.applyState({ darkMode: { value: null as unknown as boolean } });
    } catch (_) {}
    expect(typeof client.get('darkMode')).toBe('boolean');
  });
});

/* ============================================================
   VULNERABILITY 7
   `applyState()` does not validate `enabled` — it accepts any
   type for the enabled field. Passing a non-boolean truthy/falsy
   value (e.g. 1, 0, "yes", null) silently sets `runtime.enabled`
   to a non-boolean. The `enabled()` method then returns a non-boolean,
   and the accessor's value getter (`runtime.enabled ? ...`) still
   works due to JS truthiness — but `enabled()` violating its
   return type contract is a real bug.
============================================================ */

describe('VULN 7 — enabled field accepts non-boolean values without throwing', () => {
  it('passing enabled: 1 should throw (not silently coerce to true)', () => {
    const client = make();
    expect(() =>
      client.applyState({ darkMode: { enabled: 1 as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('passing enabled: 0 should throw (not silently coerce to false)', () => {
    const client = make();
    expect(() =>
      client.applyState({ theme: { enabled: 0 as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('passing enabled: "true" should throw', () => {
    const client = make();
    expect(() =>
      client.applyState({ theme: { enabled: 'true' as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('passing enabled: null should throw', () => {
    const client = make();
    expect(() =>
      client.applyState({ darkMode: { enabled: null as unknown as boolean } }),
    ).toThrowError(VoidFlagError);
  });

  it('after non-boolean enabled, client.enabled() must still return a strict boolean', () => {
    const client = make();
    try {
      client.applyState({ darkMode: { enabled: 1 as unknown as boolean } });
    } catch (_) {}
    expect(client.enabled('darkMode')).toBe(true); // unchanged, strict boolean
    expect(typeof client.enabled('darkMode')).toBe('boolean');
  });
});

/* ============================================================
   VULNERABILITY 8
   `allEnabled([])` — calling with an empty array.
   Array.prototype.every() on an empty array vacuously returns true.
   This is mathematically correct but is likely an unexpected contract
   for callers: "are zero flags all enabled?" returning true could mask
   bugs. Additionally, `#assertNotDisposed` runs before `every()` so
   a disposed client would still throw. But more critically — the
   implementation calls `this.enabled(k)` for each k, which calls
   `#assertKeyExists`. With an empty array, no key validation runs.
   Passing an array of invalid keys should throw, but with an empty
   array no validation occurs. The question is: is `allEnabled([])`
   with a mix of valid and invalid keys consistent?
============================================================ */

describe('VULN 8 — allEnabled() edge cases', () => {
  it('allEnabled([]) returns true (vacuous truth) — document this contract explicitly', () => {
    const client = make();
    expect(client.allEnabled([])).toBe(true);
  });

  it('allEnabled([]) should still throw on a disposed client', () => {
    const client = make();
    client.dispose();
    expect(() => client.allEnabled([])).toThrowError(VoidFlagError);
  });

  it('allEnabled() with an unknown key in the array should throw', () => {
    const client = make();
    expect(() => client.allEnabled(['theme', 'DOES_NOT_EXIST' as any])).toThrowError(
      VoidFlagError,
    );
  });

  it('allEnabled() stops at the first disabled flag (short-circuits correctly)', () => {
    const client = make();
    client.applyState({ darkMode: { enabled: false } });
    // DOES_NOT_EXIST is after darkMode; if short-circuit works it should never reach it
    // If it DOESN'T short-circuit it'll throw on the unknown key — either way we validate behavior
    const result = client.allEnabled(['darkMode', 'theme', 'fontSize']);
    expect(result).toBe(false);
  });
});

/* ============================================================
   VULNERABILITY 9
   `isRolledOutFor()` with degenerate userId values.
   Empty string, very long string, unicode, null coerced to string,
   undefined coerced to string — stableHash has no guards and
   processes any string, but the caller contract says `userId: string`.
   Passing non-string values coerces via template literal which may
   produce unexpected bucket assignments.
============================================================ */

describe('VULN 9 — isRolledOutFor() with degenerate userId values', () => {
  it('empty string userId throws', () => {
    const client = make();
    client.applyState({ newOnboarding: { rollout: 50 } });

    expect(() => client.isRolledOutFor('newOnboarding', '')).toThrow();
  });

  it('very long userId (10k chars) does not cause stack overflow or hang', () => {
    const client = make();
    client.applyState({ newOnboarding: { rollout: 50 } });
    const longId = 'x'.repeat(10_000);
    expect(() => client.isRolledOutFor('newOnboarding', longId)).not.toThrow();
  });

  it('unicode userId produces a deterministic boolean result', () => {
    const client = make();
    client.applyState({ newOnboarding: { rollout: 50 } });
    const r1 = client.isRolledOutFor('newOnboarding', '用户🎌🔥');
    const r2 = client.isRolledOutFor('newOnboarding', '用户🎌🔥');
    expect(r1).toBe(r2);
  });

  it('null coerced as userId should throw, not silently hash "null"', () => {
    const client = make();
    client.applyState({ newOnboarding: { rollout: 50 } });
    expect(() =>
      client.isRolledOutFor('newOnboarding', null as unknown as string),
    ).toThrowError(VoidFlagError);
  });

  it('undefined coerced as userId should throw, not silently hash "undefined"', () => {
    const client = make();
    client.applyState({ newOnboarding: { rollout: 50 } });
    expect(() =>
      client.isRolledOutFor('newOnboarding', undefined as unknown as string),
    ).toThrowError(VoidFlagError);
  });

  it('different userIds with the same hash prefix but different suffix produce different results', () => {
    // This is a statistical sanity check — not a crypto guarantee
    const client = make();
    client.applyState({ newOnboarding: { rollout: 50 } });
    const results = new Set<boolean>();
    for (let i = 0; i < 200; i++) {
      results.add(client.isRolledOutFor('newOnboarding', `user-${i}`));
    }
    // With 200 users and 50% rollout there must be both true and false
    expect(results.size).toBe(2);
  });
});

/* ============================================================
   VULNERABILITY 10
   `applyState()` validates rollout AFTER value but before
   Object.assign. However the value check and rollout check are
   both checked before assign. What happens if both value AND
   rollout are invalid — does it throw on value (first), not
   rollout? And crucially: if value is valid but rollout is invalid,
   does Object.assign still run and apply the valid value before
   the rollout throws? Order matters.
============================================================ */

describe('VULN 10 — validation ordering: value checked before rollout, assign after both', () => {
  it('invalid rollout throws even when value is valid, without mutating anything', () => {
    const client = make();
    expect(() =>
      client.applyState({ fontSize: { value: 20, rollout: 999 } }),
    ).toThrowError(VoidFlagError);
    // value must NOT have been applied
    expect(client.get('fontSize')).toBe(16);
  });

  it('when both value and rollout are invalid, throws on value (first check wins)', () => {
    const client = make();
    expect(() =>
      client.applyState({
        fontSize: { value: 'bad' as unknown as number, rollout: 999 },
      }),
    ).toThrowError(VoidFlagError);
  });

  it('after a rollout-only failure, the value in the store is unchanged', () => {
    const client = make();
    client.applyState({ fontSize: { value: 24 } }); // set valid value first
    try {
      client.applyState({ fontSize: { value: 32, rollout: -1 } }); // rollout bad
    } catch (_) {}
    expect(client.get('fontSize')).toBe(24); // still the previous value, not 32
  });
});

/* ============================================================
   VULNERABILITY 11
   Accessor cache identity + re-use after state changes.
   `flag()` caches the accessor by key. The cached accessor closes
   over the runtime object reference. After `applyState()` mutates
   the runtime, the existing accessor should reflect the new state.
   BUT: if the implementation were to ever replace the runtime
   object entirely (instead of mutating it in-place), the cached
   accessor would be stale forever. We verify the cache always
   reflects live state.
============================================================ */

describe('VULN 11 — accessor cache staleness after applyState()', () => {
  it('cached accessor from before applyState() reflects the new value', () => {
    const client = make();
    const accessor = client.flag('theme'); // cache it
    client.applyState({ theme: { value: 'dark' } });
    expect(accessor.value).toBe('dark'); // must NOT be stale
  });

  it('cached accessor reflects enabled=false after applyState()', () => {
    const client = make();
    const accessor = client.flag('fontSize');
    client.applyState({ fontSize: { value: 32, enabled: false } });
    expect(accessor.enabled).toBe(false);
    expect(accessor.value).toBe(16); // fallback, not 32
  });

  it('flag() always returns the exact same object reference (no re-creation)', () => {
    const client = make();
    const a = client.flag('theme');
    client.applyState({ theme: { value: 'dark' } });
    const b = client.flag('theme');
    expect(a).toBe(b); // same reference, not a new object
  });

  it('flags proxy accessor is the same object reference as flag() result', () => {
    const client = make();
    const fromFlag = client.flag('theme');
    const fromProxy = client.flags.theme;
    // Both should be the same cached accessor instance
    expect(fromFlag).toBe(fromProxy);
  });
});

/* ============================================================
   VULNERABILITY 12
   `applyState()` on a schema key that exists in the schema but
   whose value in the store is `undefined` or `0` (falsy) — the
   `#assertKeyExists` check uses `!this.store[key]`. If the runtime
   object itself is somehow falsy or the store key maps to a falsy
   value, it'd throw incorrectly. This tests the boundary between
   key-existence check and value falsy-ness.
   More critically: what if the schema has a key named "hasOwnProperty"
   or "toString"? These are inherited on plain objects but
   `Object.create(null)` removes them — verify this works.
============================================================ */

describe('VULN 12 — schema keys that shadow Object prototype methods', () => {
  //   it('a flag named "toString" works correctly with applyState()', () => {
  //     const weirdSchema = defineFlags({
  //       toString: string().fallback('default'),
  //       valueOf: string().fallback('val'),
  //       hasOwnProperty: boolean().fallback(false),
  //     });
  //     const client = new VoidClient({ schema: weirdSchema });
  //     expect(() => client.applyState({ toString: { value: 'custom' } })).not.toThrow();
  //     expect(client.get('toString')).toBe('custom');
  //   });

  it('a flag named "valueOf" throws', () => {
    expect(() => defineFlags({ valueOf: string().fallback('val') })).toThrowError(
      VoidFlagError,
    );
  });
  it('a flag named "hasOwnProperty" is rejected at schema definition time', () => {
    expect(() => defineFlags({ hasOwnProperty: boolean().fallback(false) })).toThrow(
      /reserved|invalid/i,
    );
  });
});

/* ============================================================
   VULNERABILITY 13
   `applyState()` with a patch that has `value: undefined` explicitly
   vs. a patch that simply doesn't have a `value` key. Both should
   be treated identically (skip value mutation). The guard is
   `if (patch.value !== undefined)` — so explicit undefined is
   correctly skipped. But what about `value: void 0`? Same thing.
   And what about a patch where `value` is a getter that throws?
============================================================ */

describe('VULN 13 — explicit undefined value vs missing value key', () => {
  it('patch with explicit value: undefined does not mutate the stored value', () => {
    const client = make();
    client.applyState({ theme: { value: undefined as unknown as string } });
    expect(client.get('theme')).toBe('light'); // unchanged
  });

  it('patch with value: void 0 is treated same as missing value', () => {
    const client = make();
    client.applyState({ fontSize: { value: void 0 as unknown as number } });
    expect(client.get('fontSize')).toBe(16);
  });

  it('patch that is an empty object {} does not throw and does not mutate', () => {
    const client = make();
    client.applyState({ theme: {} as any });
    expect(client.get('theme')).toBe('light');
    expect(client.snapshot('theme').rollout).toBe(100);
    expect(client.enabled('theme')).toBe(true);
  });

  it('patch with a throwing getter on value should propagate the error, not swallow it', () => {
    const client = make();
    const evilPatch = Object.defineProperty({}, 'value', {
      get() {
        throw new TypeError('getter exploded');
      },
      enumerable: true,
    });
    expect(() => client.applyState({ theme: evilPatch as any })).toThrow();
  });
});

/* ============================================================
   VULNERABILITY 14
   `debugSnapshots()` uses `Object.keys(this.store)` — since store
   is `Object.create(null)`, this is safe from prototype pollution.
   But `Object.fromEntries` with `Object.keys` means the result
   is a plain `{}` object (with prototype). An attacker who managed
   to inject a key named "__proto__" into the store could potentially
   cause Object.fromEntries to set a property on Object.prototype.
   We verify this can't happen.
============================================================ */

describe('VULN 14 — debugSnapshots() prototype pollution via __proto__ key', () => {
  it('debugSnapshots() does not pollute Object.prototype', () => {
    const client = make();
    const snapshots = client.debugSnapshots();
    // Object.prototype must not have been touched
    expect((Object.prototype as any).darkMode).toBeUndefined();
    expect((Object.prototype as any).theme).toBeUndefined();
  });

  it('debugSnapshots() result does not contain __proto__ as a key', () => {
    const client = make();
    const snapshots = client.debugSnapshots();
    expect(Object.keys(snapshots)).not.toContain('__proto__');
  });
});

/* ============================================================
   VULNERABILITY 15
   Race condition / interleaving: calling `dispose()` between
   constructing an accessor and reading from it. The accessor
   closes over `assertNotDisposed` which reads `#disposed`. If
   dispose() fires between obtaining the accessor and reading its
   `.value`, the accessor should throw. Verify this is consistent.
   Also: what if dispose() is called DURING the applyState() loop
   (simulated by a getter that calls dispose mid-iteration)?
============================================================ */

describe('VULN 15 — dispose() interleaving with applyState() and accessors', () => {
  it('accessor obtained before dispose() throws after dispose()', () => {
    const client = make();
    const acc = client.flag('theme');
    client.dispose();
    expect(() => acc.value).toThrowError(VoidFlagError);
  });

  it('a patch getter that calls dispose() mid-applyState() leaves the client disposed', () => {
    const client = make();
    let called = false;
    const evilPatch = Object.defineProperty({} as any, 'value', {
      get() {
        if (!called) {
          called = true;
          client.dispose();
        }
        return 'dark';
      },
      enumerable: true,
    });
    // applyState will try to read patch.value, which disposes the client mid-loop
    // After this, the client should be disposed
    try {
      client.applyState({ theme: evilPatch as any });
    } catch (_) {}
    expect(() => client.get('theme')).toThrowError(VoidFlagError);
  });

  it('all public methods throw after dispose()', () => {
    const client = make();
    client.dispose();
    expect(() => client.get('theme')).toThrowError(VoidFlagError);
    expect(() => client.enabled('theme')).toThrowError(VoidFlagError);
    expect(() => client.allEnabled(['theme'])).toThrowError(VoidFlagError);
    expect(() => client.flag('theme')).toThrowError(VoidFlagError);
    expect(() => client.snapshot('theme')).toThrowError(VoidFlagError);
    expect(() => client.debugSnapshots()).toThrowError(VoidFlagError);
    expect(() => client.isRolledOutFor('theme', 'u')).toThrowError(VoidFlagError);
    expect(() => client.hydrate('theme', {})).toThrowError(VoidFlagError);
    expect(() => client.applyState({ theme: { value: 'x' } })).toThrowError(
      VoidFlagError,
    );
  });
});

/* ============================================================
   VULNERABILITY 16
   `applyState()` calls `#assertSafeKey` then `#assertKeyExists`,
   but the safe key list is limited to exactly 3 strings. There are
   other dangerous key names in JavaScript that could cause problems
   depending on implementation: "then" (thenable poisoning),
   "constructor" on null-prototype objects, Symbol keys coerced
   to string, numeric-looking string keys, etc.
============================================================ */

describe('VULN 16 — dangerous key names not in the safe-key allowlist', () => {
  it('"then" key (thenable poisoning) is not in schema so assertKeyExists throws', () => {
    const client = make();
    expect(() => client.applyState({ then: { value: true } } as any)).toThrowError(
      VoidFlagError,
    );
  });

  it('numeric string key "0" not in schema throws correctly', () => {
    const client = make();
    expect(() => client.applyState({ '0': { value: true } } as any)).toThrowError(
      VoidFlagError,
    );
  });

  it('key with leading/trailing whitespace " darkMode " is not the same as "darkMode"', () => {
    const client = make();
    expect(() =>
      client.applyState({ ' darkMode ': { value: true } } as any),
    ).toThrowError(VoidFlagError);
  });

  it('Symbol key coercion — Symbols cannot be used in for...in so they are silently ignored', () => {
    const client = make();
    const sym = Symbol('darkMode');
    const overrides: any = {};
    overrides[sym] = { value: true };
    // for...in doesn't iterate symbols — should be a no-op, not a throw
    expect(() => client.applyState(overrides)).not.toThrow();
    expect(client.get('darkMode')).toBe(false); // unchanged
  });
});

/* ============================================================
   VULNERABILITY 17
   `applyState()` with `value: NaN` on a number flag. `typeof NaN`
   is 'number', so it passes the type check. But NaN is not a valid
   flag value — `get()` would return NaN, breaking numeric comparisons
   downstream. The SDK should reject NaN (and Infinity, -Infinity).
============================================================ */

describe('VULN 17 — NaN and Infinity as number flag values', () => {
  it('applyState with value: NaN on a number flag should throw', () => {
    const client = make();
    expect(() => client.applyState({ fontSize: { value: NaN } })).toThrowError(
      VoidFlagError,
    );
  });

  it('applyState with value: Infinity should throw', () => {
    const client = make();
    expect(() => client.applyState({ fontSize: { value: Infinity } })).toThrowError(
      VoidFlagError,
    );
  });

  it('applyState with value: -Infinity should throw', () => {
    const client = make();
    expect(() => client.applyState({ rateLimit: { value: -Infinity } })).toThrowError(
      VoidFlagError,
    );
  });

  it('after NaN injection attempt, get() must still return a finite number', () => {
    const client = make();
    try {
      client.applyState({ fontSize: { value: NaN } });
    } catch (_) {}
    const val = client.get('fontSize');
    expect(Number.isFinite(val)).toBe(true);
  });
});

/* ============================================================
   VULNERABILITY 18
   The `flags` proxy is built once in the constructor and sealed
   (lazy path) or frozen (eager path). After `applyState()`, the
   proxy's getters still point to `flag()` which reads the live store.
   But: can someone write to `client.flags.theme` (attempt to
   override a flag value directly on the proxy)? The sealed/frozen
   object should prevent this — verify it throws in strict mode.
============================================================ */

describe('VULN 18 — flags proxy immutability (cannot be written to directly)', () => {
  it('attempting to write to flags.theme directly throws in strict mode', () => {
    const client = make();
    expect(() => {
      (client.flags as any).theme = { value: 'hacked' };
    }).toThrow();
  });

  it('attempting to delete a flag from flags proxy throws', () => {
    const client = make();
    expect(() => {
      delete (client.flags as any).theme;
    }).toThrow();
  });

  it('attempting to add a new key to flags proxy throws', () => {
    const client = make();
    expect(() => {
      (client.flags as any).newKey = 'surprise';
    }).toThrow();
  });

  it('the value on client.flags accessor is not writable', () => {
    const client = make();
    const acc = client.flags.theme;
    expect(() => {
      (acc as any).value = 'mutated';
    }).toThrow();
  });
});

/* ============================================================
   VULNERABILITY 19
   `applyState()` with a massive overrides object (1000 keys,
   all invalid). Should it throw on the first invalid key or process
   all? More importantly: it should not OOM, hang, or produce
   a partial state where some mutations leaked.
============================================================ */

describe('VULN 19 — applyState() with massive invalid overrides object', () => {
  it('a 1000-key overrides object with all unknown keys throws on the first', () => {
    const client = make();
    const bigOverrides: Record<string, any> = {};
    for (let i = 0; i < 1000; i++) bigOverrides[`unknownFlag_${i}`] = { value: i };
    expect(() => client.applyState(bigOverrides as any)).toThrowError(VoidFlagError);
  });

  it('a mixed overrides object with valid flags first and invalid last applies nothing', () => {
    const client = make();
    const overrides: any = {
      theme: { value: 'dark' },
      fontSize: { value: 20 },
      locale: { value: 42 as unknown as string }, // invalid — type mismatch
    };
    try {
      client.applyState(overrides);
    } catch (_) {}
    // Due to non-atomicity this currently fails — it documents the bug
    expect(client.get('theme')).toBe('light');
    expect(client.get('fontSize')).toBe(16);
  });
});

/* ============================================================
   VULNERABILITY 20
   Snapshot immutability — `Object.freeze()` is shallow. If any
   snapshot field were an object (they're not currently — all are
   primitives), the nested object would be mutable. Verify that
   attempts to mutate snapshot fields throw, and that the store
   is NOT mutated through the snapshot reference.
============================================================ */

describe('VULN 20 — snapshot is a true immutable copy, not a live reference', () => {
  it('snapshot fields cannot be reassigned', () => {
    const client = make();
    const snap = client.snapshot('theme') as any;
    expect(() => {
      snap.value = 'mutated';
    }).toThrow();
    expect(() => {
      snap.enabled = false;
    }).toThrow();
    expect(() => {
      snap.rollout = 0;
    }).toThrow();
  });

  it('mutating a snapshot does not affect the live store', () => {
    const client = make();
    const snap = client.snapshot('theme') as any;
    try {
      snap.value = 'mutated';
    } catch (_) {}
    expect(client.get('theme')).toBe('light');
  });

  it('snapshot taken after applyState() is a point-in-time copy, not a live view', () => {
    const client = make();
    client.applyState({ theme: { value: 'dark' } });
    const snap = client.snapshot('theme');
    client.applyState({ theme: { value: 'light' } }); // revert
    expect(snap.value).toBe('dark'); // snapshot still holds the old value
    expect(client.get('theme')).toBe('light'); // live store updated
  });
});
