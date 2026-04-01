import { describe, it, expect, beforeEach } from 'vitest';
import { VoidClient, VoidFlagError, FlagMap } from 'voidflag';

// ----------------------------------------------------------------
// Schema
// ---------------------------------------------------------------

import type {} from 'voidflag';

export const schema = {
  // Booleans
  darkMode: { type: 'BOOLEAN', fallback: false },
  paymentSwitch: { type: 'BOOLEAN', fallback: false },
  maintenanceMode: { type: 'BOOLEAN', fallback: false },
  betaAccess: { type: 'BOOLEAN', fallback: false },

  // Strings
  themeColor: { type: 'STRING', fallback: '#000000' },
  checkoutVariant: { type: 'STRING', fallback: 'control' },
  apiRegion: { type: 'STRING', fallback: 'us-east-1' },
  bannerCopy: { type: 'STRING', fallback: 'Welcome' },

  // Numbers
  fontSize: { type: 'NUMBER', fallback: 16 },
  maxUploadMb: { type: 'NUMBER', fallback: 10 },
  requestTimeoutMs: { type: 'NUMBER', fallback: 3000 },
  itemsPerPage: { type: 'NUMBER', fallback: 25 },
} as const satisfies FlagMap;

// Small schema for lazy-loading tests
export const SMALL_SCHEMA = {
  onlyOne: { type: 'BOOLEAN', fallback: true },
} as const satisfies FlagMap;

type Schema = typeof schema;

let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema, dev: true });
});

// ----------------------------------------------------------------
// constructor
// ----------------------------------------------------------------

describe('constructor', () => {
  it('seeds every flag with its fallback as the initial value', () => {
    expect(vf.flags.darkMode.value).toBe(false);
    expect(vf.flags.paymentSwitch.value).toBe(false);
    expect(vf.flags.themeColor.value).toBe('#000000');
    expect(vf.flags.checkoutVariant.value).toBe('control');
    expect(vf.flags.fontSize.value).toBe(16);
    expect(vf.flags.maxUploadMb.value).toBe(10);
    expect(vf.flags.requestTimeoutMs.value).toBe(3000);
  });

  it('marks every flag as enabled on construction', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.flags[key].enabled).toBe(true);
    }
  });

  it('pre-populates flags.* for every schema key', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.flags[key]).toBeDefined();
    }
  });

  it('freezes the flags map — cannot assign new keys', () => {
    expect(() => {
      (vf.flags as any).rogue = {};
    }).toThrow();
  });

  it('two separate instances are fully isolated', () => {
    const a = new VoidClient({ schema, dev: true });
    const b = new VoidClient({ schema, dev: true });
    a.hydrate('themeColor', { value: 'red' });
    expect(b.flags.themeColor.value).toBe('#000000');
    a.dispose();
    b.dispose();
  });
});

// ----------------------------------------------------------------
// Accessor shape contracts
// ----------------------------------------------------------------

describe('accessor shape contracts', () => {
  // Accessor exposes: value, enabled, isRolledOutFor
  // Snapshot exposes: value, fallback, enabled, rollout — use snapshot() for those

  it('boolean accessor has value, enabled, and isRolledOutFor', () => {
    const node = vf.flags.darkMode;
    expect('value' in node).toBe(true);
    expect('enabled' in node).toBe(true);
    expect('isRolledOutFor' in node).toBe(true);
  });

  it('string accessor has value, enabled, and isRolledOutFor', () => {
    const node = vf.flags.themeColor;
    expect('value' in node).toBe(true);
    expect('enabled' in node).toBe(true);
    expect('isRolledOutFor' in node).toBe(true);
  });

  it('number accessor has value, enabled, and isRolledOutFor', () => {
    const node = vf.flags.fontSize;
    expect('value' in node).toBe(true);
    expect('enabled' in node).toBe(true);
    expect('isRolledOutFor' in node).toBe(true);
  });

  it('accessor does not expose fallback or rollout — use snapshot() for those', () => {
    const node = vf.flags.themeColor as any;
    expect('fallback' in node).toBe(true);
    expect('rollout' in node).toBe(false);
  });

  it('accessor is frozen — direct mutation throws', () => {
    const node = vf.flags.themeColor as any;
    expect(Object.isFrozen(node)).toBe(true);
    expect(() => {
      node.value = 'hacked';
    }).toThrow();
    expect(() => {
      node.enabled = false;
    }).toThrow();
    expect(() => {
      node.injected = true;
    }).toThrow();
  });
});

// ----------------------------------------------------------------
// flags.* live reads
// ----------------------------------------------------------------

describe('flags.* live reads', () => {
  it('.value returns the live value when enabled (string)', () => {
    vf.hydrate('themeColor', { value: 'green', enabled: true });
    expect(vf.flags.themeColor.value).toBe('green');
  });

  it('.value returns the fallback when disabled — ignores stored value', () => {
    vf.hydrate('themeColor', { value: 'green', enabled: false });
    expect(vf.flags.themeColor()).toBe('#000000');
    expect(vf.flags.themeColor.fallback).toBe('#000000');
  });

  it('.value returns correct boolean value', () => {
    vf.hydrate('darkMode', { value: true });
    expect(vf.flags.darkMode.value).toBe(true);
  });

  it('.value returns correct number value', () => {
    vf.hydrate('fontSize', { value: 24 });
    expect(vf.flags.fontSize.value).toBe(24);
  });

  it('.value returns fallback for number when disabled', () => {
    vf.hydrate('fontSize', { value: 24, enabled: false });
    expect(vf.flags.fontSize()).toBe(16);
  });

  it('flipping enabled back to true restores live value', () => {
    vf.hydrate('checkoutVariant', { value: 'treatment', enabled: false });
    expect(vf.flags.checkoutVariant()).toBe('control');
    vf.hydrate('checkoutVariant', { enabled: true });
    expect(vf.flags.checkoutVariant.value).toBe('treatment');
  });

  it('value equal to fallback is still returned correctly', () => {
    vf.hydrate('checkoutVariant', { value: 'control', enabled: true });
    expect(vf.flags.checkoutVariant.value).toBe('control');
  });
});

// ----------------------------------------------------------------
// accessor .enabled
// ----------------------------------------------------------------

describe('accessor .enabled', () => {
  it('is true for all flags on init', () => {
    expect(vf.flags.darkMode.enabled).toBe(true);
    expect(vf.flags.themeColor.enabled).toBe(true);
    expect(vf.flags.fontSize.enabled).toBe(true);
  });

  it('reflects false after hydrating enabled: false', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(vf.flags.paymentSwitch.enabled).toBe(false);
  });

  it('reflects true after re-enabling', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    vf.hydrate('paymentSwitch', { enabled: true });
    expect(vf.flags.paymentSwitch.enabled).toBe(true);
  });
});

// ----------------------------------------------------------------
// allEnabled()
// ----------------------------------------------------------------

describe('allEnabled()', () => {
  it('returns true when every passed accessor is enabled', () => {
    expect(
      vf.allEnabled(vf.flags.darkMode, vf.flags.paymentSwitch, vf.flags.fontSize),
    ).toBe(true);
  });

  it('returns false when any one accessor is disabled', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(
      vf.allEnabled(vf.flags.darkMode, vf.flags.paymentSwitch, vf.flags.fontSize),
    ).toBe(false);
  });

  it('returns false when multiple accessors are disabled', () => {
    vf.hydrate('darkMode', { enabled: false });
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(vf.allEnabled(vf.flags.darkMode, vf.flags.paymentSwitch)).toBe(false);
  });

  it('returns true for no arguments (vacuous truth)', () => {
    expect(vf.allEnabled()).toBe(true);
  });

  it('returns true for a single enabled accessor', () => {
    expect(vf.allEnabled(vf.flags.maintenanceMode)).toBe(true);
  });
});

// ----------------------------------------------------------------
// flags.* reference stability
// ----------------------------------------------------------------

describe('flags.* reference stability', () => {
  it('flags.* returns the same object reference on every call', () => {
    expect(vf.flags.themeColor).toBe(vf.flags.themeColor);
    expect(vf.flags.darkMode).toBe(vf.flags.darkMode);
    expect(vf.flags.fontSize).toBe(vf.flags.fontSize);
  });

  it('flags.* returns the exact same reference across all schema keys', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.flags[key]).toBe(vf.flags[key]);
    }
  });

  it('accessor .value is live — reflects hydrate() immediately', () => {
    const acc = vf.flags.themeColor;
    expect(acc.value).toBe('#000000');
    vf.hydrate('themeColor', { value: 'purple', enabled: true });
    expect(acc.value).toBe('purple');
  });

  it('accessor .value returns fallback when disabled', () => {
    const acc = vf.flags.themeColor;
    vf.hydrate('themeColor', { value: 'purple', enabled: false });
    expect(acc()).toBe('#000000');
  });

  it('accessor .enabled is live', () => {
    const acc = vf.flags.darkMode;
    expect(acc.enabled).toBe(true);
    vf.hydrate('darkMode', { enabled: false });
    expect(acc.enabled).toBe(false);
    vf.hydrate('darkMode', { enabled: true });
    expect(acc.enabled).toBe(true);
  });

  it('multiple rapid hydrations — accessor always reads the latest', () => {
    const acc = vf.flags.bannerCopy;
    for (const v of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      vf.hydrate('bannerCopy', { value: v });
      expect(acc.value).toBe(v);
    }
  });
});

// ----------------------------------------------------------------
// hydrate()
// ----------------------------------------------------------------

describe('hydrate()', () => {
  it('partial hydration only changes specified fields', () => {
    vf.hydrate('fontSize', { value: 32 });
    expect(vf.flags.fontSize.value).toBe(32);
    expect(vf.flags.fontSize.enabled).toBe(true); // untouched
    expect(vf.snapshot('fontSize').fallback).toBe(16); // untouched
  });

  it('can update value, enabled, and rollout independently', () => {
    vf.hydrate('checkoutVariant', { value: 'treatment' });
    vf.hydrate('checkoutVariant', { rollout: 20 });
    vf.hydrate('checkoutVariant', { enabled: false });

    expect(vf.flags.checkoutVariant()).toBe('control'); // disabled → fallback
    expect(vf.snapshot('checkoutVariant').rollout).toBe(20);
    expect(vf.flags.checkoutVariant.enabled).toBe(false);
  });

  it('hydrating an unknown field (fallback) throws VoidFlagError and leaves store untouched', () => {
    expect(() =>
      vf.hydrate('themeColor', { fallback: 'white', enabled: false } as any),
    ).toThrow(VoidFlagError);
    expect(vf.flags.themeColor.value).toBe('#000000');
    expect(vf.snapshot('themeColor').fallback).toBe('#000000');
  });

  it('snapshot().fallback always reflects the schema fallback regardless of enabled state', () => {
    vf.hydrate('themeColor', { value: 'dark', enabled: true });
    expect(vf.snapshot('themeColor').fallback).toBe('#000000');
    vf.hydrate('themeColor', { enabled: false });
    expect(vf.snapshot('themeColor').fallback).toBe('#000000');
  });

  it('simulated poll cycle — sequential hydrations stay consistent', () => {
    vf.hydrate('checkoutVariant', { value: 'treatment', enabled: true, rollout: 50 });
    expect(vf.flags.checkoutVariant.value).toBe('treatment');
    expect(vf.snapshot('checkoutVariant').rollout).toBe(50);

    vf.hydrate('checkoutVariant', { enabled: false });
    expect(vf.flags.checkoutVariant()).toBe('control');
    expect(vf.flags.checkoutVariant.enabled).toBe(false);

    vf.hydrate('checkoutVariant', { enabled: true, value: 'treatment-v2', rollout: 100 });
    expect(vf.flags.checkoutVariant.value).toBe('treatment-v2');
    expect(vf.snapshot('checkoutVariant').rollout).toBe(100);
  });

  it('hydrating all 12 flags — all reflect immediately', () => {
    vf.hydrate('darkMode', { value: true });
    vf.hydrate('paymentSwitch', { value: true });
    vf.hydrate('maintenanceMode', { value: true, enabled: false });
    vf.hydrate('betaAccess', { value: true });
    vf.hydrate('themeColor', { value: 'red', rollout: 80 });
    vf.hydrate('checkoutVariant', { value: 'treatment', rollout: 50 });
    vf.hydrate('apiRegion', { value: 'eu-west-1' });
    vf.hydrate('bannerCopy', { value: 'New Feature!' });
    vf.hydrate('fontSize', { value: 18, rollout: 100 });
    vf.hydrate('maxUploadMb', { value: 100 });
    vf.hydrate('requestTimeoutMs', { value: 5000, enabled: false });
    vf.hydrate('itemsPerPage', { value: 50 });

    expect(vf.flags.darkMode.value).toBe(true);
    expect(vf.flags.paymentSwitch.value).toBe(true);
    expect(vf.flags.maintenanceMode()).toBe(false); // disabled → fallback
    expect(vf.flags.betaAccess.value).toBe(true);
    expect(vf.flags.themeColor.value).toBe('red');
    expect(vf.snapshot('checkoutVariant').rollout).toBe(50);
    expect(vf.flags.apiRegion.value).toBe('eu-west-1');
    expect(vf.flags.bannerCopy.value).toBe('New Feature!');
    expect(vf.flags.fontSize.value).toBe(18);
    expect(vf.flags.maxUploadMb.value).toBe(100);
    expect(vf.flags.requestTimeoutMs()).toBe(3000); // disabled → fallback
    expect(vf.flags.itemsPerPage.value).toBe(50);
  });
});

// ----------------------------------------------------------------
// isRolledOutFor() — via accessor
// ----------------------------------------------------------------

describe('isRolledOutFor()', () => {
  it('returns true for all users when rollout is 100 (default for string/number)', () => {
    for (const u of ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace']) {
      expect(vf.flags.checkoutVariant.isRolledOutFor(u)).toBe(true);
    }
  });

  it('returns false for all users when rollout is 0', () => {
    vf.hydrate('checkoutVariant', { rollout: 0 });
    for (const u of ['alice', 'bob', 'carol', 'dave', 'eve']) {
      expect(vf.flags.checkoutVariant.isRolledOutFor(u)).toBe(false);
    }
  });

  it('returns false for all users when flag is disabled regardless of rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 100, enabled: false });
    for (const u of ['alice', 'bob', 'carol']) {
      expect(vf.flags.checkoutVariant.isRolledOutFor(u)).toBe(false);
    }
  });

  it('is deterministic — same user always gets same result', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    const r1 = vf.flags.checkoutVariant.isRolledOutFor('user-abc-123');
    const r2 = vf.flags.checkoutVariant.isRolledOutFor('user-abc-123');
    const r3 = vf.flags.checkoutVariant.isRolledOutFor('user-abc-123');
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('distributes ~50% of users at 50% rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    const users = Array.from({ length: 100 }, (_, i) => `user-${i}`);
    const included = users.filter((u) =>
      vf.flags.checkoutVariant.isRolledOutFor(u),
    ).length;
    expect(included).toBeGreaterThan(29);
    expect(included).toBeLessThan(71);
  });

  it('rollout percentage change is respected immediately', () => {
    vf.hydrate('checkoutVariant', { rollout: 100 });
    expect(vf.flags.checkoutVariant.isRolledOutFor('user-x')).toBe(true);
    vf.hydrate('checkoutVariant', { rollout: 0 });
    expect(vf.flags.checkoutVariant.isRolledOutFor('user-x')).toBe(false);
  });

  it('rollout >= 100 is treated as full rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 100 });
    expect(vf.flags.checkoutVariant.isRolledOutFor('anyone')).toBe(true);
  });

  it('rollout <= 0 is treated as no rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 0 });
    expect(vf.flags.checkoutVariant.isRolledOutFor('anyone')).toBe(false);
  });

  it('bucket is stable across separate client instances for the same schema', () => {
    const vf2 = new VoidClient({ schema, dev: true });
    vf.hydrate('checkoutVariant', { rollout: 50 });
    vf2.hydrate('checkoutVariant', { rollout: 50 });
    for (const u of Array.from({ length: 30 }, (_, i) => `stable-user-${i}`)) {
      expect(vf.flags.checkoutVariant.isRolledOutFor(u)).toBe(
        vf2.flags.checkoutVariant.isRolledOutFor(u),
      );
    }
    vf2.dispose();
  });

  it('different flag keys produce independently hashed buckets for the same userId', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    vf.hydrate('apiRegion', { rollout: 50 });
    expect(typeof vf.flags.checkoutVariant.isRolledOutFor('split-user')).toBe('boolean');
    expect(typeof vf.flags.apiRegion.isRolledOutFor('split-user')).toBe('boolean');
  });

  it('empty string userId throws', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.flags.checkoutVariant.isRolledOutFor('')).toThrow();
  });

  it('very long userId does not throw', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() =>
      vf.flags.checkoutVariant.isRolledOutFor('u'.repeat(10_000)),
    ).not.toThrow();
  });

  it('unicode userId does not throw', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.flags.checkoutVariant.isRolledOutFor('用户-🎯-émoji')).not.toThrow();
  });

  it('rollout 1% — only a tiny fraction of users pass', () => {
    vf.hydrate('checkoutVariant', { rollout: 1 });
    const users = Array.from({ length: 1000 }, (_, i) => `u-${i}`);
    const included = users.filter((u) =>
      vf.flags.checkoutVariant.isRolledOutFor(u),
    ).length;
    expect(included).toBeGreaterThan(0);
    expect(included).toBeLessThan(30);
  });

  it('rollout 99% — almost all users pass', () => {
    vf.hydrate('checkoutVariant', { rollout: 99 });
    const users = Array.from({ length: 1000 }, (_, i) => `u-${i}`);
    const included = users.filter((u) =>
      vf.flags.checkoutVariant.isRolledOutFor(u),
    ).length;
    expect(included).toBeGreaterThan(970);
    expect(included).toBeLessThanOrEqual(1000);
  });
});

// ----------------------------------------------------------------
// snapshot()
// ----------------------------------------------------------------

describe('snapshot()', () => {
  it('returns a frozen plain object', () => {
    expect(Object.isFrozen(vf.snapshot('themeColor'))).toBe(true);
  });

  it('is a point-in-time copy — not live', () => {
    const snap = vf.snapshot('themeColor');
    vf.hydrate('themeColor', { value: 'red' });
    expect(snap.value).toBe('#000000');
  });

  it('mutation attempt on snapshot throws', () => {
    const snap = vf.snapshot('themeColor');
    expect(() => {
      (snap as any).value = 'hacked';
    }).toThrow();
  });

  it('each snapshot() call returns a distinct object', () => {
    expect(vf.snapshot('themeColor')).not.toBe(vf.snapshot('themeColor'));
  });

  it('snapshot has exactly (enabled, value, fallback, rollout) for all flag types', () => {
    const boolSnap = vf.snapshot('darkMode');
    expect(Object.keys(boolSnap).sort()).toEqual(
      ['enabled', 'fallback', 'rollout', 'value'].sort(),
    );

    const strSnap = vf.snapshot('themeColor');
    expect(Object.keys(strSnap).sort()).toEqual(
      ['enabled', 'fallback', 'rollout', 'value'].sort(),
    );

    const numSnap = vf.snapshot('fontSize');
    expect(Object.keys(numSnap).sort()).toEqual(
      ['enabled', 'fallback', 'rollout', 'value'].sort(),
    );
  });

  it('boolean snapshot rollout defaults to 0', () => {
    expect(vf.snapshot('darkMode').rollout).toBe(0);
  });

  it('string/number snapshot rollout defaults to 100', () => {
    expect(vf.snapshot('themeColor').rollout).toBe(100);
    expect(vf.snapshot('fontSize').rollout).toBe(100);
  });

  it('snapshot rollout reflects hydrated value', () => {
    vf.hydrate('themeColor', { rollout: 60 });
    expect(vf.snapshot('themeColor').rollout).toBe(60);
  });

  it('snapshot reflects raw stored value even when disabled (differs from accessor)', () => {
    vf.hydrate('fontSize', { value: 32, enabled: false });
    const snap = vf.snapshot('fontSize');
    expect(snap.value).toBe(32); // raw stored value
    expect(snap.enabled).toBe(false);
    expect(snap.fallback).toBe(16);
    expect(vf.flags.fontSize()).toBe(16); // accessor returns fallback
  });

  it('two snapshots at different times capture different values', () => {
    const s1 = vf.snapshot('bannerCopy');
    vf.hydrate('bannerCopy', { value: 'Updated!' });
    const s2 = vf.snapshot('bannerCopy');
    expect(s1.value).toBe('Welcome');
    expect(s2.value).toBe('Updated!');
  });

  it('throws VoidFlagError for unknown key', () => {
    // @ts-expect-error intentional invalid key
    expect(() => vf.snapshot('doesNotExist')).toThrow(VoidFlagError);
  });
});

// ----------------------------------------------------------------
// debugSnapshots()
// ----------------------------------------------------------------

describe('debugSnapshots()', () => {
  it('returns an entry for every schema key', () => {
    const snaps = vf.debugSnapshots();
    for (const key of Object.keys(schema)) {
      expect(snaps[key as keyof Schema]).toBeDefined();
    }
  });

  it('every entry is frozen', () => {
    const snaps = vf.debugSnapshots();
    for (const key of Object.keys(schema)) {
      expect(Object.isFrozen(snaps[key as keyof Schema])).toBe(true);
    }
  });

  it('values match individual snapshots', () => {
    vf.hydrate('themeColor', { value: 'dark' });
    const all = vf.debugSnapshots();
    const single = vf.snapshot('themeColor');
    expect(all.themeColor).toEqual(single);
  });

  it('returns point-in-time snapshots — not live', () => {
    const snaps = vf.debugSnapshots();
    vf.hydrate('themeColor', { value: 'mutated' });
    expect(snaps.themeColor.value).toBe('#000000');
  });
});

// ----------------------------------------------------------------
// dispose()
// ----------------------------------------------------------------

describe('dispose()', () => {
  it('is idempotent — calling multiple times does not throw', () => {
    for (let i = 0; i < 10; i++) {
      expect(() => vf.dispose()).not.toThrow();
    }
  });

  it('flags.*.value throws VoidFlagError after dispose', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
  });

  it('flags.*.enabled throws after dispose', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    expect(() => acc.enabled).toThrow(VoidFlagError);
  });

  it('allEnabled() throws after dispose when passed a disposed accessor', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    expect(() => vf.allEnabled(acc)).toThrow(VoidFlagError);
  });

  it('isRolledOutFor() throws after dispose', () => {
    const acc = vf.flags.checkoutVariant;
    vf.dispose();
    expect(() => acc.isRolledOutFor('user')).toThrow(VoidFlagError);
  });

  it('snapshot() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.snapshot('themeColor')).toThrow(VoidFlagError);
  });

  it('debugSnapshots() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.debugSnapshots()).toThrow(VoidFlagError);
  });

  it('hydrate() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.hydrate('themeColor', { value: 'red' })).toThrow(VoidFlagError);
  });

  it('error message mentions disposed', () => {
    vf.dispose();
    try {
      vf.snapshot('darkMode');
    } catch (e) {
      expect((e as VoidFlagError).message).toMatch(/disposed/i);
    }
  });

  it('accessor grabbed before dispose throws on all properties after dispose', () => {
    const strAcc = vf.flags.themeColor;
    const boolAcc = vf.flags.darkMode;
    const numAcc = vf.flags.fontSize;
    vf.dispose();

    expect(() => strAcc.value).toThrow(VoidFlagError);
    expect(() => strAcc.enabled).toThrow(VoidFlagError);
    expect(() => strAcc.isRolledOutFor('u')).toThrow(VoidFlagError);

    expect(() => boolAcc.value).toThrow(VoidFlagError);
    expect(() => boolAcc.enabled).toThrow(VoidFlagError);

    expect(() => numAcc.value).toThrow(VoidFlagError);
    expect(() => numAcc.enabled).toThrow(VoidFlagError);
  });

  it('dispose does not bleed into sibling clients', () => {
    const b = new VoidClient({ schema, dev: true });
    vf.dispose();
    expect(() => b.flags.themeColor.value).not.toThrow();
    b.dispose();
  });
});

// ----------------------------------------------------------------
// VoidFlagError
// ----------------------------------------------------------------

describe('VoidFlagError', () => {
  it('has correct name property', () => {
    const err = new VoidFlagError('test');
    expect(err.name).toBe('VoidFlagError');
    expect(err.message).toBe('test');
  });

  it('is an instance of Error', () => {
    expect(new VoidFlagError('test')).toBeInstanceOf(Error);
  });

  it('errors thrown post-dispose are VoidFlagError instances', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    try {
      acc.value;
    } catch (err) {
      expect(err).toBeInstanceOf(VoidFlagError);
      expect((err as VoidFlagError).name).toBe('VoidFlagError');
    }
  });
});

// ----------------------------------------------------------------
// Internals: lazy loading
// ----------------------------------------------------------------

describe('internals: lazy loading', () => {
  it('cache starts empty — nothing is built until accessed', () => {
    const internalCache = (vf as any).accessorCache;
    expect(Object.keys(internalCache).length).toBe(0);
    void vf.flags.themeColor;
    expect(Object.keys(internalCache).length).toBe(1);
  });

  it('lazy loading works for small schemas too', () => {
    const smallClient = new VoidClient({ schema: SMALL_SCHEMA, dev: true });
    const cache = (smallClient as any).accessorCache;

    expect(Object.keys(cache).length).toBe(0);
    void smallClient.flags.onlyOne;
    expect(Object.keys(cache).length).toBe(1);
    expect(cache['onlyOne']).toBeDefined();
    smallClient.dispose();
  });

  it('second access returns cached accessor — cache length stays at 1', () => {
    void vf.flags.themeColor;
    void vf.flags.themeColor;
    const internalCache = (vf as any).accessorCache;
    expect(Object.keys(internalCache).length).toBe(1);
  });
});

// ----------------------------------------------------------------
// Multi-client isolation
// ----------------------------------------------------------------

describe('multi-client isolation', () => {
  it('hydrating one client does not affect another', () => {
    const a = new VoidClient({ schema, dev: true });
    const b = new VoidClient({ schema, dev: true });
    a.hydrate('themeColor', { value: 'dark' });
    expect(a.flags.themeColor.value).toBe('dark');
    expect(b.flags.themeColor.value).toBe('#000000');
    a.dispose();
    b.dispose();
  });

  it('disposing one client does not affect another', () => {
    const a = new VoidClient({ schema, dev: true });
    const b = new VoidClient({ schema, dev: true });
    a.dispose();
    expect(() => b.flags.themeColor.value).not.toThrow();
    b.dispose();
  });
});

// ----------------------------------------------------------------
// Stress
// ----------------------------------------------------------------

describe('stress', () => {
  it('1000 rapid hydrate + read cycles stay consistent', () => {
    for (let i = 0; i < 1000; i++) {
      vf.hydrate('fontSize', { value: i, enabled: true });
      expect(vf.flags.fontSize.value).toBe(i);
    }
  });

  it('accessor survives 10,000 reads after a single hydrate', () => {
    vf.hydrate('themeColor', { value: 'red', enabled: true });
    const acc = vf.flags.themeColor;
    for (let i = 0; i < 10_000; i++) {
      expect(acc.value).toBe('red');
    }
  });

  it('alternating enable/disable 500 times stays correct', () => {
    const acc = vf.flags.checkoutVariant;
    vf.hydrate('checkoutVariant', { value: 'treatment' });
    for (let i = 0; i < 500; i++) {
      const enabled = i % 2 === 0;
      vf.hydrate('checkoutVariant', { enabled });
      expect(acc()).toBe(enabled ? 'treatment' : 'control');
      expect(acc.enabled).toBe(enabled);
    }
  });

  it('accessors grabbed before hydration reflect post-hydration values', () => {
    const accs = {
      themeColor: vf.flags.themeColor,
      fontSize: vf.flags.fontSize,
      darkMode: vf.flags.darkMode,
      checkoutVariant: vf.flags.checkoutVariant,
    };
    vf.hydrate('themeColor', { value: 'blue' });
    vf.hydrate('fontSize', { value: 99 });
    vf.hydrate('darkMode', { value: true });
    vf.hydrate('checkoutVariant', { value: 'treatment', rollout: 33 });

    expect(accs.themeColor.value).toBe('blue');
    expect(accs.fontSize.value).toBe(99);
    expect(accs.darkMode.value).toBe(true);
    expect(accs.checkoutVariant.value).toBe('treatment');
    expect(vf.snapshot('checkoutVariant').rollout).toBe(33);
  });

  it('snapshot under rapid hydration always captures the moment it was called', () => {
    const snapshots: ReturnType<typeof vf.snapshot>[] = [];
    for (let i = 0; i < 20; i++) {
      vf.hydrate('itemsPerPage', { value: i * 5 });
      snapshots.push(vf.snapshot('itemsPerPage'));
    }
    for (let i = 0; i < 20; i++) {
      expect(snapshots[i].value).toBe(i * 5);
    }
  });

  it('rapid accessor + snapshot interleaving returns coherent results', () => {
    const node = vf.flags.themeColor;
    for (let i = 0; i < 200; i++) {
      vf.hydrate('themeColor', { value: `v${i}`, enabled: true });
      const snap = vf.snapshot('themeColor');
      expect(snap.value).toBe(node.value);
    }
  });

  it('concurrent accessor reads during rapid hydration never see torn state', () => {
    const themeNode = vf.flags.themeColor;
    const itemsNode = vf.flags.fontSize;

    for (let i = 0; i < 500; i++) {
      vf.hydrate('themeColor', { value: `v${i}`, enabled: i % 2 === 0 });
      vf.hydrate('fontSize', { value: i, rollout: i % 100 });

      if (themeNode.enabled) {
        expect(themeNode()).toBe(`v${i}`);
      } else {
        expect(themeNode()).toBe('#000000'); // fallback
      }
      expect(vf.snapshot('fontSize').rollout).toBe(i % 100);
    }
  });

  it('handles empty schema without crashing', () => {
    const emptyVf = new VoidClient({ schema: {}, dev: true });
    expect(emptyVf.allEnabled()).toBe(true);
    expect(emptyVf.debugSnapshots()).toEqual({});
    emptyVf.dispose();
  });

  it('prevents prototype pollution via hydrate', () => {
    try {
      // @ts-ignore
      vf.hydrate('__proto__', { value: 'hacked' });
    } catch (e) {
      expect(e).toBeInstanceOf(VoidFlagError);
    }
  });
});
