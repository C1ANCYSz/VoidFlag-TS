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
  vf = new VoidClient({ schema, dev: true });
});

// ================================================================
// API METHODS THROW AFTER DISPOSE
// ================================================================

describe('API methods throw after dispose', () => {
  it('flags.*.value throws VoidFlagError', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
  });

  it('flags.*.enabled throws VoidFlagError', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    expect(() => acc.enabled).toThrow(VoidFlagError);
  });

  it('allEnabled() throws VoidFlagError when accessor is disposed', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    expect(() => vf.allEnabled(acc)).toThrow(VoidFlagError);
  });

  it('isRolledOutFor() throws VoidFlagError', () => {
    const acc = vf.flags.checkoutVariant;
    vf.dispose();
    expect(() => acc.isRolledOutFor('user')).toThrow(VoidFlagError);
  });

  it('snapshot() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.snapshot(vf.flags.themeColor)).toThrow(VoidFlagError);
  });

  it('debugSnapshots() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.debugSnapshots()).toThrow(VoidFlagError);
  });

  it('hydrate() throws VoidFlagError', () => {
    vf.dispose();
    expect(() => vf.hydrate('darkMode', { value: true })).toThrow(VoidFlagError);
  });

  it('error message mentions "disposed"', () => {
    vf.dispose();
    try {
      vf.snapshot(vf.flags.darkMode);
    } catch (e) {
      expect((e as VoidFlagError).message).toMatch(/disposed/i);
    }
  });
});

// ================================================================
// HELD ACCESSOR REFERENCES THROW AFTER DISPOSE
// ================================================================

describe('held accessor references throw after dispose', () => {
  it('string accessor — value and enabled throw', () => {
    const acc = vf.flags.themeColor;
    expect(acc.value).toBe('#000000'); // works before dispose
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.enabled).toThrow(VoidFlagError);
    expect(() => acc.isRolledOutFor('u')).toThrow(VoidFlagError);
  });

  it('boolean accessor — value and enabled throw', () => {
    const acc = vf.flags.darkMode;
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.enabled).toThrow(VoidFlagError);
  });

  it('number accessor — value and enabled throw', () => {
    const acc = vf.flags.fontSize;
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.enabled).toThrow(VoidFlagError);
  });

  it('all cached accessors throw after dispose', () => {
    const keys = Object.keys(schema) as (keyof Schema)[];
    const accs = keys.map((k) => vf.flags[k]);
    vf.dispose();
    for (const acc of accs) {
      expect(() => acc.value).toThrow(VoidFlagError);
    }
  });

  it('un-accessed flag accessor throws after dispose', () => {
    // never touch maxItems before dispose — grab it after
    vf.dispose();
    // flags proxy itself doesn't throw; the accessor's property getters do
    const acc = vf.flags.maxItems;
    expect(() => acc.value).toThrow(VoidFlagError);
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
    const a = new VoidClient({ schema, dev: true });
    const b = new VoidClient({ schema, dev: true });
    a.dispose();
    expect(() => b.flags.darkMode.value).not.toThrow();
    expect(b.flags.darkMode.value).toBe(false);
    b.dispose();
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
