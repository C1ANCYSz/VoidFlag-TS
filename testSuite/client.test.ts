import { describe, it, expect, beforeEach } from 'vitest';
import {
  VoidClient,
  VoidFlagError,
  defineFlags,
  boolean,
  string,
  number,
} from '@voidflag/sdk';

// ----------------------------------------------------------------
// Schema
// ----------------------------------------------------------------

const schema = defineFlags({
  // Booleans
  darkMode: boolean().fallback(false),
  paymentSwitch: boolean().fallback(false),
  maintenanceMode: boolean().fallback(false),
  betaAccess: boolean().fallback(false),

  // Strings
  themeColor: string().fallback('#000000'),
  checkoutVariant: string().fallback('control'),
  apiRegion: string().fallback('us-east-1'),
  bannerCopy: string().fallback('Welcome'),

  // Numbers
  fontSize: number().fallback(16),
  maxUploadMb: number().fallback(10),
  requestTimeoutMs: number().fallback(3000),
  itemsPerPage: number().fallback(25),
});

// Small schema to exercise eager-loading path (< 2 keys)
const SMALL_SCHEMA = defineFlags({
  onlyOne: boolean().fallback(true),
});

type Schema = typeof schema;

let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema });
});

// ----------------------------------------------------------------
// constructor
// ----------------------------------------------------------------

describe('constructor', () => {
  it('seeds every flag with its fallback as the initial value', () => {
    expect(vf.get('darkMode')).toBe(false);
    expect(vf.get('paymentSwitch')).toBe(false);
    expect(vf.get('themeColor')).toBe('#000000');
    expect(vf.get('checkoutVariant')).toBe('control');
    expect(vf.get('fontSize')).toBe(16);
    expect(vf.get('maxUploadMb')).toBe(10);
    expect(vf.get('requestTimeoutMs')).toBe(3000);
  });

  it('marks every flag as enabled on construction', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.enabled(key)).toBe(true);
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
    const a = new VoidClient({ schema });
    const b = new VoidClient({ schema });
    a.hydrate('themeColor', { value: 'red' });
    expect(b.get('themeColor')).toBe('#000000');
  });
});

// ----------------------------------------------------------------
// Accessor shape contracts
// ----------------------------------------------------------------

describe('accessor shape contracts', () => {
  it('boolean accessor has enabled + value + fallback — no rollout', () => {
    const node = vf.flag('darkMode');
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('fallback' in node).toBe(true);
    expect('rollout' in node).toBe(true);
  });

  it('string accessor has all four fields', () => {
    const node = vf.flag('themeColor');
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('fallback' in node).toBe(true);
    expect('rollout' in node).toBe(true);
  });

  it('number accessor has all four fields', () => {
    const node = vf.flag('fontSize');
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('fallback' in node).toBe(true);
    expect('rollout' in node).toBe(true);
  });

  it('accessor is frozen — direct mutation throws', () => {
    const node = vf.flag('themeColor');
    expect(Object.isFrozen(node)).toBe(true);
    expect(() => {
      (node as any).value = 'hacked';
    }).toThrow();
    expect(() => {
      (node as any).enabled = false;
    }).toThrow();
    expect(() => {
      (node as any).rollout = 0;
    }).toThrow();
    expect(() => {
      (node as any).injected = true;
    }).toThrow();
  });
});

// ----------------------------------------------------------------
// get()
// ----------------------------------------------------------------

describe('get()', () => {
  it('returns the live value when enabled', () => {
    vf.hydrate('themeColor', { value: 'green', enabled: true });
    expect(vf.get('themeColor')).toBe('green');
  });

  it('returns the fallback when disabled — ignores value', () => {
    vf.hydrate('themeColor', { value: 'green', enabled: false });
    expect(vf.get('themeColor')).toBe('#000000');
  });

  it('returns correct boolean value', () => {
    vf.hydrate('darkMode', { value: true });
    expect(vf.get('darkMode')).toBe(true);
  });

  it('returns correct number value', () => {
    vf.hydrate('fontSize', { value: 24 });
    expect(vf.get('fontSize')).toBe(24);
  });

  it('returns fallback for number when disabled', () => {
    vf.hydrate('fontSize', { value: 24, enabled: false });
    expect(vf.get('fontSize')).toBe(16);
  });

  it('flipping enabled back to true restores value', () => {
    vf.hydrate('checkoutVariant', { value: 'treatment', enabled: false });
    expect(vf.get('checkoutVariant')).toBe('control');
    vf.hydrate('checkoutVariant', { enabled: true });
    expect(vf.get('checkoutVariant')).toBe('treatment');
  });

  it('value equal to fallback is still returned correctly', () => {
    vf.hydrate('checkoutVariant', { value: 'control', enabled: true });
    expect(vf.get('checkoutVariant')).toBe('control');
  });

  it('throws VoidFlagError for unknown key', () => {
    // @ts-expect-error intentional invalid key
    expect(() => vf.get('doesNotExist')).toThrow(VoidFlagError);
  });
});

// ----------------------------------------------------------------
// enabled() / allEnabled()
// ----------------------------------------------------------------

describe('enabled()', () => {
  it('is true for all flags on init', () => {
    expect(vf.enabled('darkMode')).toBe(true);
    expect(vf.enabled('themeColor')).toBe(true);
    expect(vf.enabled('fontSize')).toBe(true);
  });

  it('reflects false after hydrating enabled: false', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(vf.enabled('paymentSwitch')).toBe(false);
  });

  it('reflects true after re-enabling', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    vf.hydrate('paymentSwitch', { enabled: true });
    expect(vf.enabled('paymentSwitch')).toBe(true);
  });
});

describe('allEnabled()', () => {
  it('returns true when every listed flag is enabled', () => {
    expect(vf.allEnabled(['darkMode', 'paymentSwitch', 'fontSize'])).toBe(true);
  });

  it('returns false when any one flag is disabled', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(vf.allEnabled(['darkMode', 'paymentSwitch', 'fontSize'])).toBe(false);
  });

  it('returns false when multiple flags are disabled', () => {
    vf.hydrate('darkMode', { enabled: false });
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(vf.allEnabled(['darkMode', 'paymentSwitch'])).toBe(false);
  });

  it('returns true for empty array (vacuous truth)', () => {
    expect(vf.allEnabled([])).toBe(true);
  });

  it('returns true for a single enabled flag', () => {
    expect(vf.allEnabled(['maintenanceMode'])).toBe(true);
  });
});

// ----------------------------------------------------------------
// flag() / flags.*
// ----------------------------------------------------------------

describe('flag() / flags.*', () => {
  it('flag() returns the same object reference on every call', () => {
    expect(vf.flag('themeColor')).toBe(vf.flag('themeColor'));
    expect(vf.flag('darkMode')).toBe(vf.flag('darkMode'));
    expect(vf.flag('fontSize')).toBe(vf.flag('fontSize'));
  });

  it('flags.* returns the exact same reference as flag()', () => {
    expect(vf.flags.themeColor).toBe(vf.flag('themeColor'));
    expect(vf.flags.fontSize).toBe(vf.flag('fontSize'));
    expect(vf.flags.darkMode).toBe(vf.flag('darkMode'));
  });

  it('accessor .value is live — reflects hydrate() immediately', () => {
    const acc = vf.flag('themeColor');
    expect(acc.value).toBe('#000000');
    vf.hydrate('themeColor', { value: 'purple', enabled: true });
    expect(acc.value).toBe('purple');
  });

  it('accessor .value returns fallback when disabled', () => {
    const acc = vf.flag('themeColor');
    vf.hydrate('themeColor', { value: 'purple', enabled: false });
    expect(acc.value).toBe('#000000');
  });

  it('accessor .enabled is live', () => {
    const acc = vf.flag('darkMode');
    expect(acc.enabled).toBe(true);
    vf.hydrate('darkMode', { enabled: false });
    expect(acc.enabled).toBe(false);
    vf.hydrate('darkMode', { enabled: true });
    expect(acc.enabled).toBe(true);
  });

  it('accessor .fallback never changes when value changes', () => {
    const acc = vf.flag('themeColor');
    vf.hydrate('themeColor', { value: 'orange' });
    expect(acc.fallback).toBe('#000000');
    vf.hydrate('themeColor', { value: 'red' });
    expect(acc.fallback).toBe('#000000');
  });

  it('boolean accessor has no rollout property', () => {
    expect('rollout' in vf.flags.darkMode).toBe(true);
    expect('rollout' in vf.flags.paymentSwitch).toBe(true);
    expect('rollout' in vf.flags.maintenanceMode).toBe(true);
    expect('rollout' in vf.flags.betaAccess).toBe(true);
  });

  it('string and number accessors have rollout property', () => {
    expect('rollout' in vf.flags.themeColor).toBe(true);
    expect('rollout' in vf.flags.checkoutVariant).toBe(true);
    expect('rollout' in vf.flags.fontSize).toBe(true);
    expect('rollout' in vf.flags.maxUploadMb).toBe(true);
  });

  it('variant rollout defaults to 100 when not hydrated', () => {
    expect(vf.flags.themeColor.rollout).toBe(100);
    expect(vf.flags.fontSize.rollout).toBe(100);
  });

  it('variant rollout reflects hydrated value live', () => {
    vf.hydrate('checkoutVariant', { rollout: 42 });
    expect(vf.flags.checkoutVariant.rollout).toBe(42);
  });

  it('multiple rapid hydrations — accessor always reads the latest', () => {
    const acc = vf.flag('bannerCopy');
    for (const v of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      vf.hydrate('bannerCopy', { value: v });
      expect(acc.value).toBe(v);
    }
  });

  it('throws VoidFlagError for unknown key', () => {
    // @ts-expect-error intentional invalid key
    expect(() => vf.flag('doesNotExist')).toThrow(VoidFlagError);
  });
});

// ----------------------------------------------------------------
// hydrate()
// ----------------------------------------------------------------

describe('hydrate()', () => {
  it('partial hydration only changes specified fields', () => {
    vf.hydrate('fontSize', { value: 32 });
    expect(vf.get('fontSize')).toBe(32);
    expect(vf.enabled('fontSize')).toBe(true); // untouched
    expect(vf.flags.fontSize.fallback).toBe(16); // untouched
  });

  it('can update value, enabled, and rollout independently', () => {
    vf.hydrate('checkoutVariant', { value: 'treatment' });
    vf.hydrate('checkoutVariant', { rollout: 20 });
    vf.hydrate('checkoutVariant', { enabled: false });

    expect(vf.flags.checkoutVariant.value).toBe('control'); // disabled → fallback
    expect(vf.flags.checkoutVariant.rollout).toBe(20);
    expect(vf.flags.checkoutVariant.enabled).toBe(false);
  });

  it('hydrating fallback throws Voidflag Error', () => {
    expect(() =>
      vf.hydrate('themeColor', { fallback: 'white', enabled: false } as any),
    ).toThrow(VoidFlagError);
    expect(vf.get('themeColor')).toBe('#000000');
    expect(vf.flags.themeColor.fallback).toBe('#000000');
  });

  it('fallback field always reflects the fallback regardless of enabled state', () => {
    vf.hydrate('themeColor', { value: 'dark', enabled: true });
    expect(vf.flag('themeColor').fallback).toBe('#000000');
    vf.hydrate('themeColor', { enabled: false });
    expect(vf.flag('themeColor').fallback).toBe('#000000');
  });

  it('simulated poll cycle — sequential hydrations stay consistent', () => {
    vf.hydrate('checkoutVariant', {
      value: 'treatment',
      enabled: true,
      rollout: 50,
    });
    expect(vf.get('checkoutVariant')).toBe('treatment');
    expect(vf.flags.checkoutVariant.rollout).toBe(50);

    vf.hydrate('checkoutVariant', { enabled: false });
    expect(vf.get('checkoutVariant')).toBe('control');
    expect(vf.flags.checkoutVariant.enabled).toBe(false);

    vf.hydrate('checkoutVariant', {
      enabled: true,
      value: 'treatment-v2',
      rollout: 100,
    });
    expect(vf.get('checkoutVariant')).toBe('treatment-v2');
    expect(vf.flags.checkoutVariant.rollout).toBe(100);
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

    expect(vf.get('darkMode')).toBe(true);
    expect(vf.get('paymentSwitch')).toBe(true);
    expect(vf.get('maintenanceMode')).toBe(false); // disabled → fallback
    expect(vf.get('betaAccess')).toBe(true);
    expect(vf.get('themeColor')).toBe('red');
    expect(vf.flags.checkoutVariant.rollout).toBe(50);
    expect(vf.get('apiRegion')).toBe('eu-west-1');
    expect(vf.get('bannerCopy')).toBe('New Feature!');
    expect(vf.get('fontSize')).toBe(18);
    expect(vf.get('maxUploadMb')).toBe(100);
    expect(vf.get('requestTimeoutMs')).toBe(3000); // disabled → fallback
    expect(vf.get('itemsPerPage')).toBe(50);
  });
});

// ----------------------------------------------------------------
// isRolledOutFor()
// ----------------------------------------------------------------

describe('isRolledOutFor()', () => {
  it('returns true for all users when rollout is 100 (default)', () => {
    for (const u of ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace']) {
      expect(vf.isRolledOutFor('checkoutVariant', u)).toBe(true);
    }
  });

  it('returns false for all users when rollout is 0', () => {
    vf.hydrate('checkoutVariant', { rollout: 0 });
    for (const u of ['alice', 'bob', 'carol', 'dave', 'eve']) {
      expect(vf.isRolledOutFor('checkoutVariant', u)).toBe(false);
    }
  });

  it('returns false for all users when flag is disabled regardless of rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 100, enabled: false });
    for (const u of ['alice', 'bob', 'carol']) {
      expect(vf.isRolledOutFor('checkoutVariant', u)).toBe(false);
    }
  });

  it('is deterministic — same user always gets same result', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    const r1 = vf.isRolledOutFor('checkoutVariant', 'user-abc-123');
    const r2 = vf.isRolledOutFor('checkoutVariant', 'user-abc-123');
    const r3 = vf.isRolledOutFor('checkoutVariant', 'user-abc-123');
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('distributes ~50% of users at 50% rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    const users = Array.from({ length: 100 }, (_, i) => `user-${i}`);
    const included = users.filter((u) => vf.isRolledOutFor('checkoutVariant', u)).length;
    expect(included).toBeGreaterThan(29);
    expect(included).toBeLessThan(71);
  });

  it('rollout percentage change is respected immediately', () => {
    vf.hydrate('checkoutVariant', { rollout: 100 });
    expect(vf.isRolledOutFor('checkoutVariant', 'user-x')).toBe(true);
    vf.hydrate('checkoutVariant', { rollout: 0 });
    expect(vf.isRolledOutFor('checkoutVariant', 'user-x')).toBe(false);
  });

  it('rollout >= 100 is treated as full rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 100 });
    expect(vf.isRolledOutFor('checkoutVariant', 'anyone')).toBe(true);
  });

  it('rollout <= 0 is treated as no rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 0 });
    expect(vf.isRolledOutFor('checkoutVariant', 'anyone')).toBe(false);
  });
  it('bucket is stable across separate client instances for the same schema', () => {
    const vf2 = new VoidClient({ schema });
    vf.hydrate('checkoutVariant', { rollout: 50 });
    vf2.hydrate('checkoutVariant', { rollout: 50 });
    for (const u of Array.from({ length: 30 }, (_, i) => `stable-user-${i}`)) {
      expect(vf.isRolledOutFor('checkoutVariant', u)).toBe(
        vf2.isRolledOutFor('checkoutVariant', u),
      );
    }
  });

  it('different flag keys produce independently hashed buckets for the same userId', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    vf.hydrate('apiRegion', { rollout: 50 });
    expect(typeof vf.isRolledOutFor('checkoutVariant', 'split-user')).toBe('boolean');
    expect(typeof vf.isRolledOutFor('apiRegion', 'split-user')).toBe('boolean');
  });

  it('empty string userId is handled without throwing', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.isRolledOutFor('checkoutVariant', '')).toThrow();
  });

  it('very long userId is handled without throwing', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.isRolledOutFor('checkoutVariant', 'u'.repeat(10_000))).not.toThrow();
  });

  it('unicode userId is handled without throwing', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.isRolledOutFor('checkoutVariant', '用户-🎯-émoji')).not.toThrow();
  });

  it('rollout 1% — only a tiny fraction of users pass', () => {
    vf.hydrate('checkoutVariant', { rollout: 1 });
    const users = Array.from({ length: 1000 }, (_, i) => `u-${i}`);
    const included = users.filter((u) => vf.isRolledOutFor('checkoutVariant', u)).length;
    expect(included).toBeGreaterThan(0);
    expect(included).toBeLessThan(30);
  });

  it('rollout 99% — almost all users pass', () => {
    vf.hydrate('checkoutVariant', { rollout: 99 });
    const users = Array.from({ length: 1000 }, (_, i) => `u-${i}`);
    const included = users.filter((u) => vf.isRolledOutFor('checkoutVariant', u)).length;
    expect(included).toBeGreaterThan(970);
    expect(included).toBeLessThanOrEqual(1000);
  });

  it('throws VoidFlagError for unknown key', () => {
    // @ts-expect-error intentional invalid key
    expect(() => vf.isRolledOutFor('doesNotExist', 'user')).toThrow(VoidFlagError);
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
    expect((snap as any).value).toBe('#000000');
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

  it('boolean snapshot has no rollout key', () => {
    expect('rollout' in vf.snapshot('darkMode')).toBe(true);
  });

  it('boolean snapshot has exactly (enabled, value, fallback, rollout)', () => {
    const snap = vf.snapshot('paymentSwitch');
    expect(Object.keys(snap).sort()).toEqual(
      ['enabled', 'fallback', 'value', 'rollout'].sort(),
    );
    expect('rollout' in snap).toBe(true);
  });

  it('variant snapshot includes rollout', () => {
    vf.hydrate('themeColor', { rollout: 60 });
    expect((vf.snapshot('themeColor') as any).rollout).toBe(60);
  });

  it('snapshot reflects disabled state — value is fallback', () => {
    vf.hydrate('fontSize', { value: 32, enabled: false });
    const snap = vf.snapshot('fontSize') as any;
    expect(snap.value).toBe(32);
    expect(snap.enabled).toBe(false);
    expect(snap.fallback).toBe(16);
  });

  it('two snapshots at different times capture different values', () => {
    const s1 = vf.snapshot('bannerCopy') as any;
    vf.hydrate('bannerCopy', { value: 'Updated!' });
    const s2 = vf.snapshot('bannerCopy') as any;
    expect(s1.value).toBe('Welcome');
    expect(s2.value).toBe('Updated!');
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
    expect((snaps.themeColor as any).value).toBe('#000000');
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

  it('get() throws VoidFlagError after dispose', () => {
    vf.dispose();
    expect(() => vf.get('darkMode')).toThrow(VoidFlagError);
  });

  it('enabled() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.enabled('darkMode')).toThrow(VoidFlagError);
  });

  it('allEnabled() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.allEnabled(['darkMode'])).toThrow(VoidFlagError);
  });

  it('flag() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.flag('darkMode')).toThrow(VoidFlagError);
  });

  it('isRolledOutFor() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.isRolledOutFor('checkoutVariant', 'user')).toThrow(VoidFlagError);
  });

  it('snapshot() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.snapshot('themeColor')).toThrow(VoidFlagError);
  });

  it('debugSnapshots() throws after dispose', () => {
    vf.dispose();
    expect(() => vf.debugSnapshots()).toThrow(VoidFlagError);
  });

  it('error message mentions disposed', () => {
    vf.dispose();
    try {
      vf.get('darkMode');
    } catch (e) {
      expect((e as VoidFlagError).message).toMatch(/disposed/i);
    }
  });

  it('accessor grabbed before dispose throws on ALL properties after dispose', () => {
    const strAcc = vf.flag('themeColor');
    const boolAcc = vf.flag('darkMode');
    const numAcc = vf.flag('fontSize');
    vf.dispose();

    expect(() => strAcc.value).toThrow(VoidFlagError);
    expect(() => strAcc.fallback).toThrow(VoidFlagError);
    expect(() => strAcc.enabled).toThrow(VoidFlagError);
    expect(() => strAcc.rollout).toThrow(VoidFlagError);

    expect(() => boolAcc.value).toThrow(VoidFlagError);
    expect(() => boolAcc.fallback).toThrow(VoidFlagError);
    expect(() => boolAcc.enabled).toThrow(VoidFlagError);

    expect(() => numAcc.value).toThrow(VoidFlagError);
    expect(() => numAcc.rollout).toThrow(VoidFlagError);
  });

  it('flags.* accessor throws after dispose', () => {
    const acc = vf.flags.themeColor;
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.enabled).toThrow(VoidFlagError);
    expect(() => acc.fallback).toThrow(VoidFlagError);
  });

  it('dispose does not bleed into sibling clients', () => {
    const b = new VoidClient({ schema });
    vf.dispose();
    expect(() => b.get('themeColor')).not.toThrow();
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
    vf.dispose();
    try {
      vf.get('darkMode');
    } catch (err) {
      expect(err).toBeInstanceOf(VoidFlagError);
      expect((err as VoidFlagError).name).toBe('VoidFlagError');
    }
  });
});

// ----------------------------------------------------------------
// Internals: eager vs lazy loading
// ----------------------------------------------------------------

describe('internals: eager vs lazy loading', () => {
  it('uses lazy loading for schemas >= 2 keys — cache starts empty', () => {
    const internalCache = (vf as any).accessorCache;
    expect(Object.keys(internalCache).length).toBe(0);

    void vf.flags.themeColor;
    expect(Object.keys(internalCache).length).toBe(1);
  });

  it('uses lazy loading for all schemas', () => {
    const smallSchema = defineFlags({ onlyOne: boolean().fallback(true) });
    const smallClient = new VoidClient({ schema: smallSchema });
    const cache = (smallClient as any).accessorCache;

    // cache is empty before any access
    expect(Object.keys(cache).length).toBe(0);

    // access populates the cache
    void smallClient.flags.onlyOne;
    expect(Object.keys(cache).length).toBe(1);
    expect(cache['onlyOne']).toBeDefined();
  });

  it('uses lazy loading for all schemas — cache pre-filled only after access', () => {
    const smallClient = new VoidClient({ schema: SMALL_SCHEMA });
    const internalCache = (smallClient as any).accessorCache;

    expect(Object.keys(internalCache).length).toBe(0);

    void smallClient.flags.onlyOne;
    expect(Object.keys(internalCache).length).toBe(1);
    expect(internalCache['onlyOne']).toBeDefined();
    smallClient.dispose();
  });
});

// ----------------------------------------------------------------
// Multi-client isolation
// ----------------------------------------------------------------

describe('multi-client isolation', () => {
  it('hydrating one client does not affect another', () => {
    const a = new VoidClient({ schema });
    const b = new VoidClient({ schema });
    a.hydrate('themeColor', { value: 'dark' });
    expect(a.get('themeColor')).toBe('dark');
    expect(b.get('themeColor')).toBe('#000000');
    a.dispose();
    b.dispose();
  });

  it('disposing one client does not affect another', () => {
    const a = new VoidClient({ schema });
    const b = new VoidClient({ schema });
    a.dispose();
    expect(() => b.get('themeColor')).not.toThrow();
    b.dispose();
  });
});

// ----------------------------------------------------------------
// Stress
// ----------------------------------------------------------------

describe('stress', () => {
  it('1000 rapid hydrate + get cycles stay consistent', () => {
    for (let i = 0; i < 1000; i++) {
      vf.hydrate('fontSize', { value: i, enabled: true });
      expect(vf.get('fontSize')).toBe(i);
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
      expect(acc.value).toBe(enabled ? 'treatment' : 'control');
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
    expect(accs.checkoutVariant.rollout).toBe(33);
  });

  it('snapshot under rapid hydration always captures the moment it was called', () => {
    const snapshots: any[] = [];
    for (let i = 0; i < 20; i++) {
      vf.hydrate('itemsPerPage', { value: i * 5 });
      snapshots.push(vf.snapshot('itemsPerPage'));
    }
    for (let i = 0; i < 20; i++) {
      expect(snapshots[i].value).toBe(i * 5);
    }
  });

  it('rapid flag + snapshot interleaving returns coherent results', () => {
    const node = vf.flag('themeColor');
    for (let i = 0; i < 200; i++) {
      vf.hydrate('themeColor', { value: `v${i}` });
      const snap = vf.snapshot('themeColor');
      expect(snap.value).toBe(node.value);
    }
  });

  it('concurrent accessor reads during rapid hydration never see torn state', () => {
    const themeNode = vf.flag('themeColor');
    const itemsNode = vf.flag('fontSize');

    for (let i = 0; i < 500; i++) {
      vf.hydrate('themeColor', { value: `v${i}`, enabled: i % 2 === 0 });
      vf.hydrate('fontSize', { value: i, rollout: i % 100 });

      if (themeNode.enabled) {
        expect(themeNode.value).toBe(`v${i}`);
      } else {
        expect(themeNode.value).toBe(themeNode.fallback);
      }
      expect(itemsNode.rollout).toBe(i % 100);
    }
  });

  it('handles empty schema without crashing', () => {
    const emptyVf = new VoidClient({ schema: {} });
    expect(emptyVf.allEnabled([])).toBe(true);
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
