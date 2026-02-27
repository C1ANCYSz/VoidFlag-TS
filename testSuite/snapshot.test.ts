import { describe, it, expect, beforeEach } from 'vitest';
import { VoidClient, defineFlags, boolean, string, number } from '@voidflag/sdk';

const schema = defineFlags({
  darkMode: boolean().fallback(false),
  paymentSwitch: boolean().fallback(true),
  themeColor: string().fallback('#000000'),
  bannerCopy: string().fallback('Welcome'),
  fontSize: number().fallback(16),
  itemsPerPage: number().fallback(25),
});

type Schema = typeof schema;
let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema });
});

// ================================================================
// snapshot()
// ================================================================

describe('snapshot()', () => {
  it('returns a frozen plain object', () => {
    expect(Object.isFrozen(vf.snapshot('themeColor'))).toBe(true);
  });

  it('mutation attempt on snapshot throws', () => {
    const snap = vf.snapshot('themeColor');
    expect(() => {
      (snap as any).value = 'hacked';
    }).toThrow();
  });

  it('is a point-in-time copy — later hydration does not change it', () => {
    const snap = vf.snapshot('themeColor');
    vf.hydrate('themeColor', { value: 'red' });
    expect(snap.value).toBe('#000000');
    expect(vf.flags.themeColor.value).toBe('red');
  });

  it('each snapshot() call returns a distinct object', () => {
    const a = vf.snapshot('themeColor');
    const b = vf.snapshot('themeColor');
    expect(a).not.toBe(b);
  });

  it('snapshot reflects disabled state — preserves stored value', () => {
    vf.hydrate('fontSize', { value: 32, enabled: false });
    const snap = vf.snapshot('fontSize') as any;
    expect(snap.value).toBe(32);
    expect(snap.enabled).toBe(false);
    expect(snap.fallback).toBe(16);
    expect(snap.rollout).toBe(100);
  });
  it('get() returns fallback when disabled', () => {
    vf.hydrate('fontSize', { value: 32, enabled: false });

    expect(vf.get('fontSize')).toBe(16); // resolved
  });

  it('boolean snapshot has rollout key', () => {
    const snap = vf.snapshot('darkMode');
    expect('rollout' in snap).toBe(true);
  });

  it('boolean snapshot shape: enabled, value, fallback only', () => {
    const snap = vf.snapshot('paymentSwitch');
    expect(Object.keys(snap).sort()).toEqual(
      ['enabled', 'fallback', 'value', 'rollout'].sort(),
    );
  });

  it('variant snapshot includes rollout', () => {
    vf.hydrate('themeColor', { rollout: 60 });
    expect((vf.snapshot('themeColor') as any).rollout).toBe(60);
  });

  it('two snapshots at different times capture different values', () => {
    const s1 = vf.snapshot('bannerCopy') as any;
    vf.hydrate('bannerCopy', { value: 'Updated!' });
    const s2 = vf.snapshot('bannerCopy') as any;
    expect(s1.value).toBe('Welcome');
    expect(s2.value).toBe('Updated!');
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
});

// ================================================================
// debugSnapshots()
// ================================================================

describe('debugSnapshots()', () => {
  it('returns an entry for every schema key', () => {
    const snaps = vf.debugSnapshots();
    for (const key of Object.keys(schema)) {
      expect(snaps[key as keyof Schema]).toBeDefined();
    }
  });

  it('every entry is frozen', () => {
    const snaps = vf.debugSnapshots();
    for (const snap of Object.values(snaps)) {
      expect(Object.isFrozen(snap)).toBe(true);
    }
  });

  it('returns point-in-time snapshots — not live', () => {
    const snaps = vf.debugSnapshots();
    vf.hydrate('themeColor', { value: 'mutated' });
    expect((snaps.themeColor as any).value).toBe('#000000');
  });

  it('values match individual snapshots', () => {
    vf.hydrate('themeColor', { value: 'dark' });
    const all = vf.debugSnapshots();
    const single = vf.snapshot('themeColor');
    expect(all.themeColor).toEqual(single);
  });

  it('reflects current hydrated values', () => {
    vf.hydrate('themeColor', { value: 'red' });
    vf.hydrate('fontSize', { value: 99 });
    vf.hydrate('darkMode', { value: true });
    const snaps = vf.debugSnapshots();
    expect(snaps.themeColor.value).toBe('red');
    expect(snaps.fontSize.value).toBe(99);
    expect(snaps.darkMode.value).toBe(true);
  });
});
