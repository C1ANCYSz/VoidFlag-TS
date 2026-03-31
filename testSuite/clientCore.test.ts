import { describe, it, expect, beforeEach } from 'vitest';
import { VoidClient, VoidFlagError, type FlagMap } from '@voidflag/sdk';

export const schema = {
  // Booleans
  darkMode: { type: 'BOOLEAN', fallback: false },
  paymentSwitch: { type: 'BOOLEAN', fallback: true },
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

type Schema = typeof schema;
let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema, dev: true });
});

// ================================================================
// CONSTRUCTION
// ================================================================

describe('constructor', () => {
  it('seeds every flag with its fallback as the initial value', () => {
    expect(vf.flags.darkMode.value).toBe(false);
    expect(vf.flags.paymentSwitch.value).toBe(true);
    expect(vf.flags.themeColor.value).toBe('#000000');
    expect(vf.flags.checkoutVariant.value).toBe('control');
    expect(vf.flags.fontSize.value).toBe(16);
    expect(vf.flags.maxUploadMb.value).toBe(10);
    expect(vf.flags.requestTimeoutMs.value).toBe(3000);
    expect(vf.flags.itemsPerPage.value).toBe(25);
  });

  it('marks every flag as enabled on construction', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.flags[key].enabled).toBe(true);
    }
  });

  it('flags.* is accessible for every schema key', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.flags[key]).toBeDefined();
    }
  });

  it('freezes the flags map — cannot assign new keys', () => {
    expect(() => {
      (vf.flags as any).rogue = {};
    }).toThrow();
  });

  it('cannot delete keys from flags', () => {
    expect(() => {
      delete (vf.flags as any).darkMode;
    }).toThrow();
  });

  it('two separate instances are fully isolated', () => {
    const a = new VoidClient({ schema, dev: true });
    const b = new VoidClient({ schema, dev: true });
    a.hydrate('themeColor', { value: 'red' });
    expect(a.flags.themeColor.value).toBe('red');
    expect(b.flags.themeColor.value).toBe('#000000');
  });

  it('empty schema does not crash', () => {
    const empty = new VoidClient({ schema: {}, dev: true });
    expect(empty.allEnabled()).toBe(true);
    expect(empty.debugSnapshots()).toEqual({});
  });
});

// ================================================================
// flags.*.value (replaces get())
// ================================================================

describe('flags.*.value', () => {
  it('returns the live value when enabled', () => {
    vf.hydrate('themeColor', { value: 'green', enabled: true });
    expect(vf.flags.themeColor.value).toBe('green');
  });

  it('returns the fallback when disabled — ignores hydrated value', () => {
    vf.hydrate('themeColor', { value: 'green', enabled: false });
    expect(vf.flags.themeColor.value).toBe('#000000');
  });

  it('returns correct boolean value', () => {
    vf.hydrate('darkMode', { value: true });
    expect(vf.flags.darkMode.value).toBe(true);
  });

  it('returns correct number value', () => {
    vf.hydrate('fontSize', { value: 24 });
    expect(vf.flags.fontSize.value).toBe(24);
  });

  it('returns fallback for number when disabled', () => {
    vf.hydrate('fontSize', { value: 24, enabled: false });
    expect(vf.flags.fontSize.value).toBe(16);
  });

  it('returns fallback for boolean when disabled', () => {
    vf.hydrate('darkMode', { value: true, enabled: false });
    expect(vf.flags.darkMode.value).toBe(false);
  });

  it('flipping enabled back to true restores the hydrated value', () => {
    vf.hydrate('checkoutVariant', { value: 'treatment', enabled: false });
    expect(vf.flags.checkoutVariant.value).toBe('control');
    vf.hydrate('checkoutVariant', { enabled: true });
    expect(vf.flags.checkoutVariant.value).toBe('treatment');
  });

  it('value equal to fallback is still returned correctly', () => {
    vf.hydrate('checkoutVariant', { value: 'control', enabled: true });
    expect(vf.flags.checkoutVariant.value).toBe('control');
  });

  it('throws VoidFlagError for unknown key via snapshot', () => {
    // @ts-expect-error
    expect(() => vf.snapshot('doesNotExist')).toThrow(VoidFlagError);
    // @ts-expect-error
    expect(() => vf.snapshot('doesNotExist')).toThrow(/does not exist/);
  });
});

// ================================================================
// flags.*.enabled / allEnabled()
// ================================================================

describe('flags.*.enabled', () => {
  it('reflects false after hydrating enabled: false', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(vf.flags.paymentSwitch.enabled).toBe(false);
  });

  it('reflects true after re-enabling', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    vf.hydrate('paymentSwitch', { enabled: true });
    expect(vf.flags.paymentSwitch.enabled).toBe(true);
  });

  it('reflects hydration immediately for every flag', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.flags[key].enabled).toBe(true);
      vf.hydrate(key, { enabled: false } as any);
      expect(vf.flags[key].enabled).toBe(false);
      vf.hydrate(key, { enabled: true } as any);
      expect(vf.flags[key].enabled).toBe(true);
    }
  });
});

describe('allEnabled()', () => {
  it('returns true when every listed flag is enabled', () => {
    expect(
      vf.allEnabled(vf.flags.darkMode, vf.flags.paymentSwitch, vf.flags.fontSize),
    ).toBe(true);
  });

  it('returns false when any one flag is disabled', () => {
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(
      vf.allEnabled(vf.flags.darkMode, vf.flags.paymentSwitch, vf.flags.fontSize),
    ).toBe(false);
  });

  it('returns false when multiple flags are disabled', () => {
    vf.hydrate('darkMode', { enabled: false });
    vf.hydrate('paymentSwitch', { enabled: false });
    expect(vf.allEnabled(vf.flags.darkMode, vf.flags.paymentSwitch)).toBe(false);
  });

  it('returns true for no arguments (vacuous truth)', () => {
    expect(vf.allEnabled()).toBe(true);
  });

  it('returns true for a single enabled flag', () => {
    expect(vf.allEnabled(vf.flags.maintenanceMode)).toBe(true);
  });

  it('returns false as soon as one flag is disabled (all keys)', () => {
    const allKeys = Object.keys(schema) as (keyof Schema)[];
    for (const key of allKeys) {
      const fresh = new VoidClient({ schema, dev: true });
      fresh.hydrate(key, { enabled: false } as any);
      const allAccessors = allKeys.map((k) => fresh.flags[k]);
      expect(fresh.allEnabled(...allAccessors)).toBe(false);
    }
  });
});

// ================================================================
// hydrate()
// ================================================================

describe('hydrate()', () => {
  it('partial hydration only changes specified fields', () => {
    vf.hydrate('fontSize', { value: 32 });
    expect(vf.flags.fontSize.value).toBe(32);
    expect(vf.flags.fontSize.enabled).toBe(true);
    expect(vf.snapshot('fontSize').fallback).toBe(16);
  });

  it('can update value, enabled, and rollout independently', () => {
    vf.hydrate('checkoutVariant', { value: 'treatment' });
    vf.hydrate('checkoutVariant', { rollout: 20 });
    vf.hydrate('checkoutVariant', { enabled: false });

    expect(vf.flags.checkoutVariant.value).toBe('control'); // disabled → fallback
    expect(vf.snapshot('checkoutVariant').rollout).toBe(20);
    expect(vf.flags.checkoutVariant.enabled).toBe(false);
  });

  it('hydrating value changes what is returned when disabled', () => {
    vf.hydrate('themeColor', { value: 'white', enabled: false });
    expect(vf.flags.themeColor.value).toBe('#000000');
    expect(vf.snapshot('themeColor').fallback).toBe('#000000'); // untouched
  });

  it('hydrating all flags — all reflect immediately', () => {
    vf.hydrate('darkMode', { value: true });
    vf.hydrate('paymentSwitch', { value: false });
    vf.hydrate('maintenanceMode', { value: true, enabled: false });
    vf.hydrate('themeColor', { value: 'red', rollout: 80 });
    vf.hydrate('checkoutVariant', { value: 'treatment', rollout: 50 });
    vf.hydrate('apiRegion', { value: 'eu-west-1' });
    vf.hydrate('bannerCopy', { value: 'New Feature!' });
    vf.hydrate('fontSize', { value: 18, rollout: 100 });
    vf.hydrate('maxUploadMb', { value: 100 });
    vf.hydrate('requestTimeoutMs', { value: 5000, enabled: false });
    vf.hydrate('itemsPerPage', { value: 50 });

    expect(vf.flags.darkMode.value).toBe(true);
    expect(vf.flags.paymentSwitch.value).toBe(false);
    expect(vf.flags.maintenanceMode.value).toBe(false); // disabled → fallback
    expect(vf.flags.themeColor.value).toBe('red');
    expect(vf.snapshot('checkoutVariant').rollout).toBe(50);
    expect(vf.flags.apiRegion.value).toBe('eu-west-1');
    expect(vf.flags.bannerCopy.value).toBe('New Feature!');
    expect(vf.flags.fontSize.value).toBe(18);
    expect(vf.flags.maxUploadMb.value).toBe(100);
    expect(vf.flags.requestTimeoutMs.value).toBe(3000); // disabled → fallback
    expect(vf.flags.itemsPerPage.value).toBe(50);
  });

  it('simulated poll cycle — sequential hydrations stay consistent', () => {
    vf.hydrate('checkoutVariant', {
      value: 'treatment',
      enabled: true,
      rollout: 50,
    });
    expect(vf.flags.checkoutVariant.value).toBe('treatment');
    expect(vf.snapshot('checkoutVariant').rollout).toBe(50);

    vf.hydrate('checkoutVariant', { enabled: false });
    expect(vf.flags.checkoutVariant.value).toBe('control');

    vf.hydrate('checkoutVariant', {
      enabled: true,
      value: 'treatment-v2',
      rollout: 100,
    });
    expect(vf.flags.checkoutVariant.value).toBe('treatment-v2');
    expect(vf.snapshot('checkoutVariant').rollout).toBe(100);
  });
});
