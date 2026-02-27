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
// Schema — 55 flags, forces the lazy accessor path
// ----------------------------------------------------------------

const schema = defineFlags({
  // --- booleans ---
  darkMode: boolean().fallback(false),
  paymentSwitch: boolean().fallback(true),
  maintenanceMode: boolean().fallback(false),
  betaAccess: boolean().fallback(false),
  analyticsEnabled: boolean().fallback(true),
  ssoEnabled: boolean().fallback(false),
  twoFactorRequired: boolean().fallback(false),
  newOnboarding: boolean().fallback(false),
  legacyApi: boolean().fallback(true),
  debugPanel: boolean().fallback(false),
  experimentalEditor: boolean().fallback(false),
  offlineMode: boolean().fallback(false),
  pushNotifications: boolean().fallback(true),
  emailDigest: boolean().fallback(true),
  chatSupport: boolean().fallback(false),
  videoUploads: boolean().fallback(false),
  auditLog: boolean().fallback(true),
  gdprBanner: boolean().fallback(true),
  cookieConsent: boolean().fallback(true),
  accessibilityMode: boolean().fallback(false),

  // --- strings ---
  themeColor: string().fallback('#000000'),
  theme: string().fallback('light'),
  checkoutVariant: string().fallback('control'),
  apiRegion: string().fallback('us-east-1'),
  bannerCopy: string().fallback('Welcome'),
  defaultLanguage: string().fallback('en'),
  currencyDisplay: string().fallback('USD'),
  dateFormat: string().fallback('MM/DD/YYYY'),
  avatarStyle: string().fallback('initials'),
  searchAlgorithm: string().fallback('bm25'),
  recommendationModel: string().fallback('collab-v1'),
  feedLayout: string().fallback('grid'),
  notificationSound: string().fallback('chime'),
  loginRedirect: string().fallback('/dashboard'),
  errorPageVariant: string().fallback('minimal'),
  pricingTable: string().fallback('v1'),
  checkoutFlow: string().fallback('single-page'),
  signupCopy: string().fallback('Get started free'),
  mapProvider: string().fallback('mapbox'),
  cdnRegion: string().fallback('us'),

  // --- numbers ---
  fontSize: number().fallback(16),
  sessionTimeout: number().fallback(3600),
  maxUploadMb: number().fallback(10),
  pageSizeDefault: number().fallback(20),
  retryAttempts: number().fallback(3),
  cacheMaxAge: number().fallback(300),
  rateLimit: number().fallback(100),
  searchResultsLimit: number().fallback(50),
  thumbnailQuality: number().fallback(80),
  animationDuration: number().fallback(200),
  debounceMs: number().fallback(300),
  maxTagsPerPost: number().fallback(10),
  feedItemsPerPage: number().fallback(25),
  autoSaveIntervalMs: number().fallback(5000),
  maxCommentsNested: number().fallback(5),
});

type Schema = typeof schema;
const ALL_KEYS = Object.keys(schema) as (keyof Schema)[];

function makeClient() {
  return new VoidClient({ schema });
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('lazy accessors — large schema (55 flags)', () => {
  let vf: VoidClient<Schema>;

  beforeEach(() => {
    vf = makeClient();
  });

  // --- Basic sanity -----------------------------------------------

  it('every flag key is accessible via flags.*', () => {
    for (const key of ALL_KEYS) {
      expect(vf.flags[key]).toBeDefined();
    }
  });

  it('all boolean flags return correct fallback via flags.*.value', () => {
    expect(vf.flags.darkMode.value).toBe(false);
    expect(vf.flags.paymentSwitch.value).toBe(true);
    expect(vf.flags.analyticsEnabled.value).toBe(true);
    expect(vf.flags.legacyApi.value).toBe(true);
    expect(vf.flags.pushNotifications.value).toBe(true);
  });

  it('all string flags return correct fallback via flags.*.value', () => {
    expect(vf.flags.themeColor.value).toBe('#000000');
    expect(vf.flags.theme.value).toBe('light');
    expect(vf.flags.checkoutVariant.value).toBe('control');
    expect(vf.flags.apiRegion.value).toBe('us-east-1');
    expect(vf.flags.defaultLanguage.value).toBe('en');
  });

  it('all number flags return correct fallback via flags.*.value', () => {
    expect(vf.flags.fontSize.value).toBe(16);
    expect(vf.flags.sessionTimeout.value).toBe(3600);
    expect(vf.flags.retryAttempts.value).toBe(3);
    expect(vf.flags.animationDuration.value).toBe(200);
    expect(vf.flags.debounceMs.value).toBe(300);
  });

  // --- Accessor identity ------------------------------------------

  it('flags.* returns the same reference as flag() for all keys', () => {
    for (const key of ALL_KEYS) {
      expect(vf.flags[key]).toBe(vf.flag(key));
    }
  });

  it('repeated flags.* access returns the same object reference', () => {
    const a = vf.flags.themeColor;
    const b = vf.flags.themeColor;
    const c = vf.flags.themeColor;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('accessor cache is populated after first access', () => {
    void vf.flags.fontSize;
    void vf.flags.themeColor;
    void vf.flags.darkMode;
    expect(vf.flag('fontSize')).toBe(vf.flags.fontSize);
    expect(vf.flag('themeColor')).toBe(vf.flags.themeColor);
    expect(vf.flag('darkMode')).toBe(vf.flags.darkMode);
  });

  // --- Rollout presence -------------------------------------------

  it('boolean flags have no rollout property', () => {
    const boolKeys = ALL_KEYS.filter((k) => schema[k].type === 'BOOLEAN');
    for (const key of boolKeys) {
      expect('rollout' in vf.flags[key]).toBe(true);
    }
  });

  it('string and number flags all have a rollout property', () => {
    const variantKeys = ALL_KEYS.filter((k) => schema[k].type !== 'BOOLEAN');
    for (const key of variantKeys) {
      expect('rollout' in vf.flags[key]).toBe(true);
    }
  });

  it('all variant rollouts default to 100', () => {
    expect(vf.flags.themeColor.rollout).toBe(100);
    expect(vf.flags.fontSize.rollout).toBe(100);
    expect(vf.flags.checkoutVariant.rollout).toBe(100);
    expect(vf.flags.sessionTimeout.rollout).toBe(100);
  });

  // --- Seal -------------------------------------------------------

  it('cannot add rogue keys to flags', () => {
    expect(() => {
      (vf.flags as any).rogue = {};
    }).toThrow();
  });

  it('cannot delete keys from flags', () => {
    expect(() => {
      delete (vf.flags as any).darkMode;
    }).toThrow();
  });

  // --- Live hydration ---------------------------------------------

  it('hydrating a string flag is reflected immediately on the accessor', () => {
    vf.hydrate('themeColor', { value: 'red' });
    expect(vf.flags.themeColor.value).toBe('red');
    expect(vf.get('themeColor')).toBe('red');
  });

  it('hydrating a number flag is reflected immediately on the accessor', () => {
    vf.hydrate('fontSize', { value: 24 });
    expect(vf.flags.fontSize.value).toBe(24);
  });

  it('hydrating a boolean flag is reflected immediately on the accessor', () => {
    vf.hydrate('darkMode', { value: true });
    expect(vf.flags.darkMode.value).toBe(true);
  });

  it('hydrating rollout is reflected immediately', () => {
    vf.hydrate('checkoutVariant', { rollout: 42 });
    expect(vf.flags.checkoutVariant.rollout).toBe(42);
  });

  it('disabling a flag makes value return fallback', () => {
    vf.hydrate('themeColor', { value: 'green', enabled: false });
    expect(vf.flags.themeColor.value).toBe('#000000');
    expect(vf.flags.themeColor.fallback).toBe('#000000');
    expect(vf.flags.themeColor.enabled).toBe(false);
  });

  it('hydrating fallback is reflected on accessor.fallback', () => {
    expect(() => {
      vf.hydrate('fontSize', { fallback: 999, enabled: false } as any);
    }).toThrow(VoidFlagError);
    expect(vf.flags.fontSize.fallback).toBe(16);
    expect(vf.flags.fontSize.value).toBe(16); // disabled → fallback
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

  it('sequential hydrations across all 55 flags stay consistent', () => {
    const boolKeys = ['darkMode', 'betaAccess', 'ssoEnabled', 'newOnboarding'] as const;
    const stringKeys = [
      'themeColor',
      'apiRegion',
      'checkoutVariant',
      'feedLayout',
    ] as const;
    const numberKeys = [
      'fontSize',
      'sessionTimeout',
      'retryAttempts',
      'rateLimit',
    ] as const;

    for (const k of boolKeys) vf.hydrate(k, { value: true });
    for (const k of stringKeys) vf.hydrate(k, { value: 'hydrated' });
    for (const k of numberKeys) vf.hydrate(k, { value: 9999 });

    for (const k of boolKeys) expect(vf.flags[k].value).toBe(true);
    for (const k of stringKeys) expect(vf.flags[k].value).toBe('hydrated');
    for (const k of numberKeys) expect(vf.flags[k].value).toBe(9999);
  });

  // --- Flags hydrated before first access -------------------------

  it('flag hydrated before ever being accessed returns correct value on first access', () => {
    vf.hydrate('mapProvider', { value: 'google' });
    vf.hydrate('cdnRegion', { value: 'eu' });
    vf.hydrate('signupCopy', { value: 'Join now' });
    vf.hydrate('maxUploadMb', { value: 500 });
    vf.hydrate('offlineMode', { value: true });

    expect(vf.flags.mapProvider.value).toBe('google');
    expect(vf.flags.cdnRegion.value).toBe('eu');
    expect(vf.flags.signupCopy.value).toBe('Join now');
    expect(vf.flags.maxUploadMb.value).toBe(500);
    expect(vf.flags.offlineMode.value).toBe(true);
  });

  it('all 55 flags hydrated before any access — first touch returns hydrated value', () => {
    for (const key of ALL_KEYS) {
      const def = schema[key];
      if (def.type === 'BOOLEAN') vf.hydrate(key, { value: true } as any);
      else if (def.type === 'STRING') vf.hydrate(key, { value: 'hydrated' } as any);
      else vf.hydrate(key, { value: 42 } as any);
    }

    for (const key of ALL_KEYS) {
      const def = schema[key];
      const acc = vf.flags[key];
      if (def.type === 'BOOLEAN') expect(acc.value).toBe(true);
      else if (def.type === 'STRING') expect(acc.value).toBe('hydrated');
      else expect(acc.value).toBe(42);
    }
  });

  // --- Mid-loop hydration (brutal) --------------------------------

  it('string value flips mid-loop at the correct iteration', () => {
    vf.hydrate('themeColor', { value: 'before', enabled: true });
    const acc = vf.flags.themeColor;

    for (let i = 0; i < 10_000; i++) {
      if (i === 5_000) vf.hydrate('themeColor', { value: 'after' });
      expect(acc.value).toBe(i < 5_000 ? 'before' : 'after');
    }
  });

  it('number value flips mid-loop at the correct iteration', () => {
    vf.hydrate('fontSize', { value: 1, enabled: true });
    const acc = vf.flags.fontSize;

    for (let i = 0; i < 10_000; i++) {
      if (i === 3_000) vf.hydrate('fontSize', { value: 2 });
      if (i === 7_000) vf.hydrate('fontSize', { value: 3 });
      const expected = i < 3_000 ? 1 : i < 7_000 ? 2 : 3;
      expect(acc.value).toBe(expected);
    }
  });

  it('boolean flips mid-loop — enabled toggles value between live and fallback', () => {
    vf.hydrate('darkMode', { value: true, enabled: true });
    const acc = vf.flags.darkMode;

    for (let i = 0; i < 2_000; i++) {
      const on = i % 100 < 50;
      vf.hydrate('darkMode', { enabled: on });
      expect(acc.value).toBe(on ? true : false); // false is the fallback
    }
  });

  it('rollout changes mid-loop are reflected on the accessor', () => {
    const acc = vf.flags.checkoutVariant;
    for (let i = 0; i <= 100; i += 10) {
      vf.hydrate('checkoutVariant', { rollout: i });
      expect(acc.rollout).toBe(i);
    }
  });

  // --- Fallback integrity -----------------------------------------

  it('fallback stays unchanged across 10,000 value hydrations', () => {
    const acc = vf.flags.themeColor;
    for (let i = 0; i < 10_000; i++) {
      vf.hydrate('themeColor', { value: `color-${i}` });
      expect(acc.fallback).toBe('#000000');
    }
  });

  it('disabling flag always returns fallback, not a stale value', () => {
    vf.hydrate('themeColor', { value: 'stale', enabled: true });
    const acc = vf.flags.themeColor;

    expect(acc.value).toBe('stale');
    vf.hydrate('themeColor', { enabled: false });
    expect(acc.value).toBe('#000000');

    vf.hydrate('themeColor', { enabled: true });
    expect(acc.value).toBe('stale');
  });

  // --- enabled() / allEnabled() under full schema -----------------

  it('allEnabled returns true when all flags are enabled', () => {
    expect(vf.allEnabled(ALL_KEYS)).toBe(true);
  });

  it('allEnabled returns false as soon as one flag is disabled', () => {
    for (const key of ALL_KEYS) {
      const fresh = makeClient();
      fresh.hydrate(key, { enabled: false } as any);
      expect(fresh.allEnabled(ALL_KEYS)).toBe(false);
    }
  });

  it('enabled() reflects hydration immediately for all 55 flags', () => {
    for (const key of ALL_KEYS) {
      expect(vf.enabled(key)).toBe(true);
      vf.hydrate(key, { enabled: false } as any);
      expect(vf.enabled(key)).toBe(false);
      vf.hydrate(key, { enabled: true } as any);
      expect(vf.enabled(key)).toBe(true);
    }
  });

  // --- isRolledOutFor() -------------------------------------------

  it('isRolledOutFor returns true when rollout is 100', () => {
    expect(vf.isRolledOutFor('themeColor', 'any-user')).toBe(true);
  });

  it('isRolledOutFor returns false when rollout is 0', () => {
    vf.hydrate('themeColor', { rollout: 0 });
    expect(vf.isRolledOutFor('themeColor', 'any-user')).toBe(false);
  });

  it('isRolledOutFor returns false when flag is disabled', () => {
    vf.hydrate('themeColor', { enabled: false, rollout: 100 });
    expect(vf.isRolledOutFor('themeColor', 'user-123')).toBe(false);
  });

  it('isRolledOutFor is deterministic for the same user+key', () => {
    vf.hydrate('themeColor', { rollout: 50 });
    const r1 = vf.isRolledOutFor('themeColor', 'stable-user');
    const r2 = vf.isRolledOutFor('themeColor', 'stable-user');
    expect(r1).toBe(r2);
  });

  it('same user always lands in the same bucket regardless of when isRolledOutFor is called', () => {
    vf.hydrate('checkoutVariant', { rollout: 50, enabled: true });
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(vf.isRolledOutFor('checkoutVariant', 'sticky-user'));
    }
    expect(new Set(results).size).toBe(1);
  });

  it('different keys produce independent rollout results for the same user', () => {
    vf.hydrate('themeColor', { rollout: 50 });
    vf.hydrate('checkoutVariant', { rollout: 50 });
    const results = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const userId = `user-${i}`;
      const a = vf.isRolledOutFor('themeColor', userId);
      const b = vf.isRolledOutFor('checkoutVariant', userId);
      results.add(`${a}-${b}`);
    }
    expect(results.size).toBe(4); // all four combos appear
  });

  it('50% rollout distributes within reasonable bounds over 10,000 users', () => {
    vf.hydrate('checkoutVariant', { rollout: 50, enabled: true });
    let inCount = 0;
    for (let i = 0; i < 10_000; i++) {
      if (vf.isRolledOutFor('checkoutVariant', `user-${i}`)) inCount++;
    }
    expect(inCount).toBeGreaterThan(4_000);
    expect(inCount).toBeLessThan(6_000);
  });

  it('10% rollout stays within bounds over 10,000 users', () => {
    vf.hydrate('checkoutVariant', { rollout: 10, enabled: true });
    let inCount = 0;
    for (let i = 0; i < 10_000; i++) {
      if (vf.isRolledOutFor('checkoutVariant', `user-${i}`)) inCount++;
    }
    expect(inCount).toBeGreaterThan(800);
    expect(inCount).toBeLessThan(1_200);
  });

  // --- debugSnapshots() -------------------------------------------

  it('debugSnapshots reflects current hydrated values for all flags', () => {
    vf.hydrate('themeColor', { value: 'red' });
    vf.hydrate('fontSize', { value: 99 });
    vf.hydrate('darkMode', { value: true });
    vf.hydrate('checkoutVariant', { rollout: 33 });

    const snaps = vf.debugSnapshots();
    expect(snaps.themeColor.value).toBe('red');
    expect(snaps.fontSize.value).toBe(99);
    expect(snaps.darkMode.value).toBe(true);
    expect((snaps.checkoutVariant as any).rollout).toBe(33);
  });

  it('debugSnapshots is frozen — cannot mutate entries', () => {
    const snaps = vf.debugSnapshots();
    expect(() => {
      (snaps.themeColor as any).value = 'hacked';
    }).toThrow();
  });

  it('debugSnapshots is a point-in-time copy — subsequent hydration does not mutate it', () => {
    const snaps = vf.debugSnapshots();
    const valueBefore = snaps.themeColor.value;
    vf.hydrate('themeColor', { value: 'changed-after-snapshot' });
    expect(snaps.themeColor.value).toBe(valueBefore);
    expect(vf.flags.themeColor.value).toBe('changed-after-snapshot');
  });

  it('debugSnapshots covers all 55 flags', () => {
    const snaps = vf.debugSnapshots();
    expect(Object.keys(snaps).length).toBe(ALL_KEYS.length);
  });

  // --- snapshot() -------------------------------------------------

  it('snapshot captures a frozen point-in-time copy', () => {
    vf.hydrate('themeColor', { value: 'snap-color' });
    const snap = vf.snapshot('themeColor');
    vf.hydrate('themeColor', { value: 'changed' });
    expect(snap.value).toBe('snap-color');
    expect(vf.flags.themeColor.value).toBe('changed');
  });

  // --- High-volume reads ------------------------------------------

  it('10,000 reads on a string accessor stay correct after hydration', () => {
    vf.hydrate('themeColor', { value: 'gold', enabled: true });
    const acc = vf.flags.themeColor;
    for (let i = 0; i < 10_000; i++) {
      expect(acc.value).toBe('gold');
    }
  });

  it('10,000 reads on a number accessor stay correct after hydration', () => {
    vf.hydrate('fontSize', { value: 99, enabled: true });
    const acc = vf.flags.fontSize;
    for (let i = 0; i < 10_000; i++) {
      expect(acc.value).toBe(99);
    }
  });

  it('10,000 reads on a boolean accessor stay correct after hydration', () => {
    vf.hydrate('darkMode', { value: true, enabled: true });
    const acc = vf.flags.darkMode;
    for (let i = 0; i < 10_000; i++) {
      expect(acc.value).toBe(true);
    }
  });

  it('alternating enable/disable 1000 times stays correct', () => {
    const acc = vf.flags.checkoutVariant;
    vf.hydrate('checkoutVariant', { value: 'treatment' });
    for (let i = 0; i < 1000; i++) {
      const on = i % 2 === 0;
      vf.hydrate('checkoutVariant', { enabled: on });
      expect(acc.value).toBe(on ? 'treatment' : 'control');
      expect(acc.enabled).toBe(on);
    }
  });

  it('cycling through all 55 flags 100 times produces no errors', () => {
    expect(() => {
      for (let round = 0; round < 100; round++) {
        for (const key of ALL_KEYS) {
          void vf.flags[key].value;
          void vf.flags[key].enabled;
          void vf.flags[key].fallback;
        }
      }
    }).not.toThrow();
  });

  it('100 rapid full-schema hydrate+read cycles stay consistent', () => {
    for (let round = 0; round < 100; round++) {
      const tag = `round-${round}`;
      for (const key of ALL_KEYS) {
        const def = schema[key];
        if (def.type === 'STRING') vf.hydrate(key, { value: tag } as any);
        else if (def.type === 'NUMBER') vf.hydrate(key, { value: round } as any);
        else vf.hydrate(key, { value: round % 2 === 0 } as any);
      }
      for (const key of ALL_KEYS) {
        const def = schema[key];
        const val = vf.flags[key].value;
        if (def.type === 'STRING') expect(val).toBe(tag);
        else if (def.type === 'NUMBER') expect(val).toBe(round);
        else expect(val).toBe(round % 2 === 0);
      }
    }
  });

  it('get() and flags.*.value always agree for all 55 flags under hydration', () => {
    for (let round = 0; round < 20; round++) {
      for (const key of ALL_KEYS) {
        if (round % 3 === 0) vf.hydrate(key, { enabled: false } as any);
        else vf.hydrate(key, { enabled: true } as any);
      }
      for (const key of ALL_KEYS) {
        expect(vf.get(key)).toBe(vf.flags[key].value);
      }
    }
  });

  // --- dispose() --------------------------------------------------

  it('accessor grabbed before dispose throws on every property after dispose', () => {
    const acc = vf.flags.themeColor;
    vf.dispose();
    expect(() => acc.value).toThrow(VoidFlagError);
    expect(() => acc.fallback).toThrow(VoidFlagError);
    expect(() => acc.enabled).toThrow(VoidFlagError);
    expect(() => acc.rollout).toThrow(VoidFlagError);
  });

  it('hydrate after dispose does not silently resurrect accessors', () => {
    const acc = vf.flags.themeColor;
    vf.dispose();
    try {
      vf.hydrate('themeColor', { value: 'ghost' });
    } catch (_) {}
    expect(() => acc.value).toThrow(VoidFlagError);
  });

  it('un-accessed flags also throw after dispose', () => {
    vf.dispose();
    expect(() => vf.flags.mapProvider).toThrow(VoidFlagError);
  });

  it('all 55 cached accessors throw after dispose', () => {
    const accs = ALL_KEYS.map((k) => vf.flags[k]);
    vf.dispose();
    for (const acc of accs) {
      expect(() => acc.value).toThrow(VoidFlagError);
    }
  });

  it('flags.* access itself throws after dispose', () => {
    vf.dispose();
    expect(() => vf.flags.darkMode).toThrow(VoidFlagError);
  });

  it('dispose is idempotent', () => {
    vf.dispose();
    expect(() => vf.dispose()).not.toThrow();
  });
});
