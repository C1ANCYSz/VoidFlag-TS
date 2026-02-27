import { describe, it, expect, beforeEach } from 'vitest';
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
  paymentSwitch: boolean().fallback(true),
  maintenanceMode: boolean().fallback(false),
  betaAccess: boolean().fallback(false),
  themeColor: string().fallback('#000000'),
  checkoutVariant: string().fallback('control'),
  fontSize: number().fallback(16),
  maxItems: number().fallback(10),
});

type Schema = typeof schema;
let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema });
});

// ================================================================
// REFERENCE STABILITY
// ================================================================

describe('reference stability', () => {
  it('flag() returns the same object reference on every call', () => {
    expect(vf.flag('themeColor')).toBe(vf.flag('themeColor'));
    expect(vf.flag('darkMode')).toBe(vf.flag('darkMode'));
    expect(vf.flag('fontSize')).toBe(vf.flag('fontSize'));
  });

  it('flags.* returns the exact same reference as flag()', () => {
    for (const key of Object.keys(schema) as (keyof Schema)[]) {
      expect(vf.flags[key]).toBe(vf.flag(key));
    }
  });

  it('repeated flags.* access returns the same object', () => {
    const a = vf.flags.themeColor;
    const b = vf.flags.themeColor;
    const c = vf.flags.themeColor;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('does not recreate accessors on hydration', () => {
    const refBefore = vf.flags.themeColor;
    vf.hydrate('themeColor', { value: 'red' });
    const refAfter = vf.flags.themeColor;
    expect(refBefore).toBe(refAfter);
    expect(refBefore.value).toBe('red');
  });
});

// ================================================================
// NODE SHAPE CONTRACTS
// ================================================================

describe('node shape contracts', () => {
  it('boolean accessor has enabled + value + fallback — no rollout', () => {
    const node = vf.flag('darkMode');
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('fallback' in node).toBe(true);
    expect('rollout' in node).toBe(true);
  });

  it('all boolean flags  expose rollout', () => {
    expect('rollout' in vf.flags.darkMode).toBe(true);
    expect('rollout' in vf.flags.paymentSwitch).toBe(true);
    expect('rollout' in vf.flags.maintenanceMode).toBe(true);
    expect('rollout' in vf.flags.betaAccess).toBe(true);
  });

  it('string accessor has all four fields (enabled, value, fallback, rollout)', () => {
    const node = vf.flag('themeColor');
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('fallback' in node).toBe(true);
    expect('rollout' in node).toBe(true);
  });

  it('number accessor has all four fields', () => {
    const node = vf.flag('maxItems');
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('fallback' in node).toBe(true);
    expect('rollout' in node).toBe(true);
  });

  it('variant rollout defaults to 100', () => {
    expect(vf.flags.themeColor.rollout).toBe(100);
    expect(vf.flags.fontSize.rollout).toBe(100);
    expect(vf.flags.checkoutVariant.rollout).toBe(100);
  });

  it('accessor object is frozen — cannot be mutated from outside', () => {
    const node = vf.flag('themeColor') as any;
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

// ================================================================
// LIVE READS (accessor reflects hydration instantly)
// ================================================================

describe('live reads through accessors', () => {
  it('.value reflects hydrate() immediately (string)', () => {
    const acc = vf.flag('themeColor');
    expect(acc.value).toBe('#000000');
    vf.hydrate('themeColor', { value: 'purple' });
    expect(acc.value).toBe('purple');
  });

  it('.value reflects hydrate() immediately (number)', () => {
    vf.hydrate('fontSize', { value: 24 });
    expect(vf.flags.fontSize.value).toBe(24);
  });

  it('.value reflects hydrate() immediately (boolean)', () => {
    vf.hydrate('darkMode', { value: true });
    expect(vf.flags.darkMode.value).toBe(true);
  });

  it('.value returns fallback when disabled', () => {
    vf.hydrate('themeColor', { value: 'purple', enabled: false });
    expect(vf.flags.themeColor.value).toBe('#000000');
  });

  it('.enabled reflects enable/disable transitions', () => {
    const acc = vf.flag('darkMode');
    expect(acc.enabled).toBe(true);
    vf.hydrate('darkMode', { enabled: false });
    expect(acc.enabled).toBe(false);
    vf.hydrate('darkMode', { enabled: true });
    expect(acc.enabled).toBe(true);
  });

  it('.rollout reflects hydrated rollout', () => {
    vf.hydrate('maxItems', { rollout: 42 });
    expect(vf.flags.maxItems.rollout).toBe(42);
  });

  it('.fallback never changes when only value changes', () => {
    const acc = vf.flag('themeColor');
    vf.hydrate('themeColor', { value: 'orange' });
    expect(acc.fallback).toBe('#000000');
    vf.hydrate('themeColor', { value: 'red' });
    expect(acc.fallback).toBe('#000000');
  });

  it('re-enabling returns live value, not fallback', () => {
    vf.hydrate('themeColor', { value: 'dark', enabled: false });
    expect(vf.flag('themeColor').value).toBe('#000000');
    vf.hydrate('themeColor', { enabled: true });
    expect(vf.flag('themeColor').value).toBe('dark');
  });

  it('multiple rapid hydrations — accessor always reads the latest', () => {
    const acc = vf.flag('checkoutVariant');
    for (const v of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      vf.hydrate('checkoutVariant', { value: v });
      expect(acc.value).toBe(v);
    }
  });

  it('accessors grabbed before hydration reflect post-hydration values', () => {
    const theme = vf.flags.themeColor;
    const size = vf.flags.fontSize;
    const dark = vf.flags.darkMode;

    vf.hydrate('themeColor', { value: 'purple' });
    vf.hydrate('fontSize', { value: 32 });
    vf.hydrate('darkMode', { value: true });

    expect(theme.value).toBe('purple');
    expect(size.value).toBe(32);
    expect(dark.value).toBe(true);
  });

  it('get() and flags.*.value always agree', () => {
    vf.hydrate('themeColor', { value: 'red' });
    expect(vf.get('themeColor')).toBe(vf.flags.themeColor.value);

    vf.hydrate('themeColor', { enabled: false });
    expect(vf.get('themeColor')).toBe(vf.flags.themeColor.value);
  });
});

// ================================================================
// EAGER vs LAZY LOADING
// ================================================================

describe('eager vs lazy loading', () => {
  it('uses lazy loading for schemas >= 2 keys (cache starts empty)', () => {
    const bigClient = new VoidClient({ schema });
    const cache = (bigClient as any).accessorCache;
    expect(Object.keys(cache).length).toBe(0);

    void bigClient.flags.darkMode;
    expect(Object.keys(cache).length).toBe(1);
  });
});
