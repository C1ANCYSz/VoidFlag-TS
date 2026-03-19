import { describe, it, expect, beforeEach } from 'vitest';
import { VoidClient, defineFlags, boolean, string, number } from '@voidflag/sdk';

// Large schema to stress lazy accessor paths
const schema = defineFlags({
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

let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema, dev: true });
});

// ================================================================
// HIGH-VOLUME READS
// ================================================================

describe('high-volume reads', () => {
  it('10,000 reads on a string accessor stay correct', () => {
    vf.hydrate('themeColor', { value: 'gold', enabled: true });
    const acc = vf.flags.themeColor;
    for (let i = 0; i < 10_000; i++) {
      expect(acc.value).toBe('gold');
    }
  });

  it('10,000 reads on a number accessor stay correct', () => {
    vf.hydrate('fontSize', { value: 99, enabled: true });
    const acc = vf.flags.fontSize;
    for (let i = 0; i < 10_000; i++) {
      expect(acc.value).toBe(99);
    }
  });

  it('10,000 reads on a boolean accessor stay correct', () => {
    vf.hydrate('darkMode', { value: true, enabled: true });
    const acc = vf.flags.darkMode;
    for (let i = 0; i < 10_000; i++) {
      expect(acc.value).toBe(true);
    }
  });

  it('100k reads on a cached accessor return consistent values', () => {
    vf.hydrate('themeColor', { value: 'dark' });
    const node = vf.flags.themeColor;
    for (let i = 0; i < 100_000; i++) {
      if (node.value !== 'dark') throw new Error(`Inconsistency at iteration ${i}`);
    }
  });
});

// ================================================================
// MID-LOOP HYDRATION (value flips at exact iteration)
// ================================================================

describe('mid-loop hydration', () => {
  it('string value flips mid-loop at the correct iteration', () => {
    vf.hydrate('themeColor', { value: 'before', enabled: true });
    const acc = vf.flags.themeColor;
    for (let i = 0; i < 10_000; i++) {
      if (i === 5_000) vf.hydrate('themeColor', { value: 'after' });
      expect(acc.value).toBe(i < 5_000 ? 'before' : 'after');
    }
  });

  it('number value flips mid-loop with multiple transitions', () => {
    vf.hydrate('fontSize', { value: 1, enabled: true });
    const acc = vf.flags.fontSize;
    for (let i = 0; i < 10_000; i++) {
      if (i === 3_000) vf.hydrate('fontSize', { value: 2 });
      if (i === 7_000) vf.hydrate('fontSize', { value: 3 });
      expect(acc.value).toBe(i < 3_000 ? 1 : i < 7_000 ? 2 : 3);
    }
  });

  it('boolean flips mid-loop — enabled toggles value between live and fallback', () => {
    vf.hydrate('darkMode', { value: true, enabled: true });
    const acc = vf.flags.darkMode;
    for (let i = 0; i < 2_000; i++) {
      const on = i % 100 < 50;
      vf.hydrate('darkMode', { enabled: on });
      expect(acc.value).toBe(on ? true : false); // false is fallback
    }
  });

  it('accessor reads interleaved with hydrations always see latest', () => {
    const node = vf.flags.fontSize;
    for (let i = 0; i < 1_000; i++) {
      vf.hydrate('fontSize', { value: i });
      expect(node.value).toBe(i);
    }
  });
});

// ================================================================
// ENABLE/DISABLE TOGGLING
// ================================================================

describe('alternating enable/disable', () => {
  it('1000 toggles — accessor always matches expected state', () => {
    const acc = vf.flags.checkoutVariant;
    vf.hydrate('checkoutVariant', { value: 'treatment' });
    for (let i = 0; i < 1000; i++) {
      const on = i % 2 === 0;
      vf.hydrate('checkoutVariant', { enabled: on });
      expect(acc.value).toBe(on ? 'treatment' : 'control');
      expect(acc.enabled).toBe(on);
    }
  });
});

// ================================================================
// NEVER-ACCESSED FLAGS HYDRATED BEFORE FIRST ACCESS
// ================================================================

describe('hydrate before first access', () => {
  it('flag hydrated before ever being accessed returns correct value', () => {
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
      if (def.type === 'BOOLEAN') expect(vf.flags[key].value).toBe(true);
      else if (def.type === 'STRING') expect(vf.flags[key].value).toBe('hydrated');
      else expect(vf.flags[key].value).toBe(42);
    }
  });
});

// ================================================================
// FULL-SCHEMA RAPID CYCLES
// ================================================================

describe('full-schema rapid hydrate+read cycles', () => {
  it('100 rounds — all flags stay consistent', () => {
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
});
