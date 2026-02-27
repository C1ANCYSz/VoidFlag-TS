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
// API METHODS THROW AFTER DISPOSE
// ================================================================

describe('API methods throw after dispose', () => {
  it('get() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.get('darkMode')).toThrow(VoidFlagError);
  });

  it('enabled() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.enabled('darkMode')).toThrow(VoidFlagError);
  });

  it('allEnabled() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.allEnabled(['darkMode'])).toThrow(VoidFlagError);
  });

  it('flag() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.flag('darkMode')).toThrow(VoidFlagError);
  });

  it('flags.* throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.flags.darkMode).toThrow(VoidFlagError);
  });

  it('snapshot() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.snapshot('themeColor')).toThrow(VoidFlagError);
  });

  it('debugSnapshots() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.debugSnapshots()).toThrow(VoidFlagError);
  });

  it('isRolledOutFor() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.isRolledOutFor('checkoutVariant', 'user')).toThrow(VoidFlagError);
  });

  it('error message mentions "disposed"', () => {
    vf.dispose();
    try {
      vf.get('darkMode');
    } catch (e) {
      expect((e as VoidFlagError).message).toMatch(/disposed/i);
    }
  });
});

// ================================================================
// HELD ACCESSOR REFERENCES THROW AFTER DISPOSE
// ================================================================

describe('held accessor references throw after dispose', () => {
  it('string accessor — all properties throw', () => {
    const acc = vf.flag('themeColor');
    expect(acc.value).toBe('#000000'); // works before dispose
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.fallback).toThrow(VoidFlagError);
    expect(() => acc.enabled).toThrow(VoidFlagError);
    expect(() => acc.rollout).toThrow(VoidFlagError);
  });

  it('boolean accessor — all properties throw', () => {
    const acc = vf.flag('darkMode');
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.fallback).toThrow(VoidFlagError);
    expect(() => acc.enabled).toThrow(VoidFlagError);
  });

  it('number accessor — all properties throw', () => {
    const acc = vf.flag('fontSize');
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.rollout).toThrow(VoidFlagError);
  });

  it('all cached accessors throw after dispose', () => {
    const keys = Object.keys(schema) as (keyof Schema)[];
    const accs = keys.map((k) => vf.flags[k]);
    vf.dispose();
    for (const acc of accs) {
      expect(() => acc.value).toThrow(VoidFlagError);
    }
  });

  it('un-accessed flags also throw after dispose', () => {
    // never touch maxItems before dispose
    vf.dispose();
    expect(() => vf.flags.maxItems).toThrow(VoidFlagError);
  });
});

// ================================================================
// IDEMPOTENCY & IDENTITY
// ================================================================

describe('dispose idempotency & error identity', () => {
  it('dispose() is idempotent — calling many times does not throw', () => {
    for (let i = 0; i < 10; i++) {
      expect(() => vf.dispose()).not.toThrow();
    }
  });

  it('hydrate after dispose does not resurrect accessors', () => {
    const acc = vf.flags.themeColor;
    vf.dispose();
    try {
      vf.hydrate('themeColor', { value: 'ghost' });
    } catch (_) {}
    expect(() => acc.value).toThrow(VoidFlagError);
  });

  it('dispose does not bleed into sibling clients', () => {
    const a = new VoidClient({ schema });
    const b = new VoidClient({ schema });
    a.dispose();
    expect(() => b.get('darkMode')).not.toThrow();
    expect(b.get('darkMode')).toBe(false);
  });
});

// ================================================================
// VoidFlagError IDENTITY
// ================================================================

describe('VoidFlagError', () => {
  it('has name "VoidFlagError"', () => {
    expect(new VoidFlagError('test').name).toBe('VoidFlagError');
  });

  it('has correct message', () => {
    expect(new VoidFlagError('test').message).toBe('test');
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
