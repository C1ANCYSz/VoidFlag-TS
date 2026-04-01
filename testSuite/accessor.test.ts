import { describe, it, expect, beforeEach } from 'vitest';
import { VoidClient, VoidFlagError, FlagMap } from 'voidflag';

const schema = {
  darkMode: { type: 'BOOLEAN', fallback: false },
  paymentSwitch: { type: 'BOOLEAN', fallback: true },
  maintenanceMode: { type: 'BOOLEAN', fallback: false },
  betaAccess: { type: 'BOOLEAN', fallback: false },
  themeColor: { type: 'STRING', fallback: '#000000' },
  checkoutVariant: { type: 'STRING', fallback: 'control' },
  fontSize: { type: 'NUMBER', fallback: 16 },
  maxItems: { type: 'NUMBER', fallback: 10 },
} as const satisfies FlagMap;
type Schema = typeof schema;
let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema, dev: true });
});

// ================================================================
// REFERENCE STABILITY
// ================================================================

describe('reference stability', () => {
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
  // Accessor exposes: value, enabled, isRolledOutFor
  // Snapshot exposes: value, fallback, enabled, rollout — use snapshot() for those

  it('number accessor has enabled, value, and isRolledOutFor', () => {
    const node = vf.flags.fontSize;
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('isRolledOutFor' in node).toBe(true);
  });

  it('all boolean flags expose enabled and value', () => {
    expect('enabled' in vf.flags.darkMode).toBe(true);
    expect('value' in vf.flags.darkMode).toBe(true);
    expect('enabled' in vf.flags.paymentSwitch).toBe(true);
    expect('value' in vf.flags.paymentSwitch).toBe(true);
    expect('enabled' in vf.flags.maintenanceMode).toBe(true);
    expect('value' in vf.flags.maintenanceMode).toBe(true);
    expect('enabled' in vf.flags.betaAccess).toBe(true);
    expect('value' in vf.flags.betaAccess).toBe(true);
  });

  it('string accessor has enabled, value, and isRolledOutFor', () => {
    const node = vf.flags.themeColor;
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('isRolledOutFor' in node).toBe(true);
  });

  it('number accessor has enabled, value, and isRolledOutFor', () => {
    const node = vf.flags.maxItems;
    expect('enabled' in node).toBe(true);
    expect('value' in node).toBe(true);
    expect('isRolledOutFor' in node).toBe(true);
  });

  it('snapshot() rollout defaults to 100 for string and number flags', () => {
    expect(vf.snapshot('themeColor').rollout).toBe(100);
    expect(vf.snapshot('fontSize').rollout).toBe(100);
    expect(vf.snapshot('checkoutVariant').rollout).toBe(100);
  });

  it('snapshot() rollout defaults to 0 for boolean flags', () => {
    expect(vf.snapshot('darkMode').rollout).toBe(0);
    expect(vf.snapshot('paymentSwitch').rollout).toBe(0);
    expect(vf.snapshot('betaAccess').rollout).toBe(0);
  });

  it('accessor object is frozen — cannot be mutated from outside', () => {
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

  it('accessor does not expose fallback or rollout directly — use snapshot()', () => {
    const node = vf.flags.themeColor as any;
    expect('fallback' in node).toBe(false);
    expect('rollout' in node).toBe(false);
  });
});

// ================================================================
// LIVE READS (accessor reflects hydration instantly)
// ================================================================

describe('live reads through accessors', () => {
  it('.value reflects hydrate() immediately (string)', () => {
    const acc = vf.flags.themeColor;
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
    const acc = vf.flags.darkMode;
    expect(acc.enabled).toBe(true);
    vf.hydrate('darkMode', { enabled: false });
    expect(acc.enabled).toBe(false);
    vf.hydrate('darkMode', { enabled: true });
    expect(acc.enabled).toBe(true);
  });

  it('snapshot().rollout reflects hydrated rollout', () => {
    vf.hydrate('maxItems', { rollout: 42 });
    expect(vf.snapshot('maxItems').rollout).toBe(42);
  });

  it('snapshot().fallback never changes when only value changes', () => {
    vf.hydrate('themeColor', { value: 'orange' });
    expect(vf.snapshot('themeColor').fallback).toBe('#000000');
    vf.hydrate('themeColor', { value: 'red' });
    expect(vf.snapshot('themeColor').fallback).toBe('#000000');
  });

  it('re-enabling returns live value, not fallback', () => {
    vf.hydrate('themeColor', { value: 'dark', enabled: false });
    expect(vf.flags.themeColor.value).toBe('#000000');
    vf.hydrate('themeColor', { enabled: true });
    expect(vf.flags.themeColor.value).toBe('dark');
  });

  it('multiple rapid hydrations — accessor always reads the latest', () => {
    const acc = vf.flags.checkoutVariant;
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

  it('snapshot().value and flags.*.value always agree', () => {
    vf.hydrate('themeColor', { value: 'red' });
    expect(vf.snapshot('themeColor').value).toBe(vf.flags.themeColor.value);

    vf.hydrate('themeColor', { enabled: false });
    // When disabled, accessor returns fallback; snapshot returns raw stored value
    expect(vf.flags.themeColor.value).toBe('#000000');
    expect(vf.snapshot('themeColor').enabled).toBe(false);
  });
});

// ================================================================
// EAGER vs LAZY LOADING
// ================================================================

describe('eager vs lazy loading', () => {
  it('uses lazy loading for schemas >= 2 keys (cache starts empty)', () => {
    const bigClient = new VoidClient({ schema, dev: true });
    const cache = (bigClient as any).accessorCache;
    expect(Object.keys(cache).length).toBe(0);

    void bigClient.flags.darkMode;
    expect(Object.keys(cache).length).toBe(1);
  });
});
