import { describe, it, expect, beforeEach } from 'vitest';
import {
  VoidClient,
  VoidFlagError,
  defineFlags,
  boolean,
  string,
  number,
} from '@voidflag/sdk';

/*

REFERENCE STABILITY
NODE SHAPE CONTRACTS
LIVE READS (accessor reflects hydration instantly)
EAGER vs LAZY LOADING
BASELINE — fallback-driven injection
RUNTIME SWAP — hydrate flips the injected impl
DISABLED FLAG — fallback injected regardless of value
ROLLOUT — isRolledOutFor drives per-user injection
ACCESSOR STABILITY — cached ref always reflects current injection
ATOMIC MULTI-FLAG INJECTION — applyState drives container setup
GUARD RAILS — invalid inputs must not corrupt injection state
SNAPSHOT — injection state captured correctly at any point

*/

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = defineFlags({
  useStripe: boolean().fallback(false),
  checkoutVariant: string().fallback('legacy'),
  themeEngine: string().fallback('default'),
  apiVersion: string().fallback('v1'),
  logLevel: string().fallback('warn'),
  workerCount: number().fallback(1),
});

type Schema = typeof schema;

// ─── Fake services ────────────────────────────────────────────────────────────

class StripeService {
  readonly name = 'stripe';
}
class PayPalService {
  readonly name = 'paypal';
}
class ExpressCheckout {
  readonly name = 'express';
}
class LegacyCheckout {
  readonly name = 'legacy';
}
class OceanThemeService {
  readonly name = 'ocean';
}
class DefaultThemeService {
  readonly name = 'default';
}
class ApiV2Service {
  readonly name = 'v2';
}
class ApiV1Service {
  readonly name = 'v1';
}

// ─── DI resolver helpers — mirrors real injection decision points ──────────────

function resolvePayment(vf: VoidClient<Schema>) {
  return vf.flags.useStripe.value ? new StripeService() : new PayPalService();
}

function resolveCheckout(vf: VoidClient<Schema>) {
  return vf.flags.checkoutVariant.value === 'express'
    ? new ExpressCheckout()
    : new LegacyCheckout();
}

function resolveTheme(vf: VoidClient<Schema>) {
  return vf.flags.themeEngine.value === 'ocean'
    ? new OceanThemeService()
    : new DefaultThemeService();
}

function resolveApi(vf: VoidClient<Schema>) {
  return vf.flags.apiVersion.value === 'v2' ? new ApiV2Service() : new ApiV1Service();
}

function resolveWorkerPool(vf: VoidClient<Schema>): number {
  return vf.flags.workerCount.value;
}

// ─── djb2 — matches SDK stableHash exactly ────────────────────────────────────

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema, dev: true });
});

// ================================================================
// BASELINE — flags off, fallbacks drive injection
// ================================================================

describe('baseline — fallback-driven injection', () => {
  it('resolves PayPal when useStripe is off by default', () => {
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
  });

  it('resolves LegacyCheckout when checkoutVariant fallback is "legacy"', () => {
    expect(resolveCheckout(vf)).toBeInstanceOf(LegacyCheckout);
  });

  it('resolves DefaultThemeService when themeEngine fallback is "default"', () => {
    expect(resolveTheme(vf)).toBeInstanceOf(DefaultThemeService);
  });

  it('resolves ApiV1Service when apiVersion fallback is "v1"', () => {
    expect(resolveApi(vf)).toBeInstanceOf(ApiV1Service);
  });

  it('worker pool defaults to 1', () => {
    expect(resolveWorkerPool(vf)).toBe(1);
  });
});

// ================================================================
// RUNTIME SWAP — hydrate flips the injected impl
// ================================================================

describe('runtime swap via hydrate()', () => {
  it('switches from PayPal → Stripe after hydrate', () => {
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
    vf.hydrate('useStripe', { value: true });
    expect(resolvePayment(vf)).toBeInstanceOf(StripeService);
  });

  it('switches back Stripe → PayPal on second hydrate', () => {
    vf.hydrate('useStripe', { value: true });
    vf.hydrate('useStripe', { value: false });
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
  });

  it('switches checkout impl mid-flight', () => {
    vf.hydrate('checkoutVariant', { value: 'express' });
    expect(resolveCheckout(vf)).toBeInstanceOf(ExpressCheckout);
    vf.hydrate('checkoutVariant', { value: 'legacy' });
    expect(resolveCheckout(vf)).toBeInstanceOf(LegacyCheckout);
  });

  it('switches theme engine mid-flight', () => {
    vf.hydrate('themeEngine', { value: 'ocean' });
    expect(resolveTheme(vf)).toBeInstanceOf(OceanThemeService);
  });

  it('scales worker pool via hydrate', () => {
    vf.hydrate('workerCount', { value: 8 });
    expect(resolveWorkerPool(vf)).toBe(8);
  });

  it('rapid hydration — resolver always reflects latest value', () => {
    const values = ['v1', 'v2', 'v1', 'v2', 'v2', 'v1'] as const;
    const expected = [
      ApiV1Service,
      ApiV2Service,
      ApiV1Service,
      ApiV2Service,
      ApiV2Service,
      ApiV1Service,
    ];
    values.forEach((v, i) => {
      vf.hydrate('apiVersion', { value: v });
      expect(resolveApi(vf)).toBeInstanceOf(expected[i]);
    });
  });
});

// ================================================================
// DISABLED FLAG — fallback always injected regardless of value
// ================================================================

describe('disabled flag — fallback injected regardless of value', () => {
  it('injects PayPal even when value=true if flag is disabled', () => {
    vf.hydrate('useStripe', { value: true, enabled: false });
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
  });

  it('injects LegacyCheckout even when value="express" if flag is disabled', () => {
    vf.hydrate('checkoutVariant', { value: 'express', enabled: false });
    expect(resolveCheckout(vf)).toBeInstanceOf(LegacyCheckout);
  });

  it('re-enabling restores value-driven injection', () => {
    vf.hydrate('useStripe', { value: true, enabled: false });
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
    vf.hydrate('useStripe', { enabled: true });
    expect(resolvePayment(vf)).toBeInstanceOf(StripeService);
  });

  it('disabling then re-enabling multiple times stays consistent', () => {
    vf.hydrate('themeEngine', { value: 'ocean' });
    for (let i = 0; i < 5; i++) {
      vf.hydrate('themeEngine', { enabled: false });
      expect(resolveTheme(vf)).toBeInstanceOf(DefaultThemeService);
      vf.hydrate('themeEngine', { enabled: true });
      expect(resolveTheme(vf)).toBeInstanceOf(OceanThemeService);
    }
  });
});

// ================================================================
// ROLLOUT — isRolledOutFor drives per-user injection
// ================================================================

describe('rollout-based injection via isRolledOutFor()', () => {
  it('injects Stripe only for users inside the rollout bucket', () => {
    vf.hydrate('useStripe', { value: true, rollout: 50 });

    const results = new Set<string>();
    for (const uid of [
      'user_1',
      'user_2',
      'user_3',
      'user_4',
      'user_5',
      'user_6',
      'user_7',
      'user_8',
      'user_9',
      'user_10',
    ]) {
      const gets = vf.flags.useStripe.isRolledOutFor(uid);
      results.add(gets ? 'stripe' : 'paypal');
    }
    // at 50% rollout across 10 users both impls should appear
    expect(results.has('stripe')).toBe(true);
    expect(results.has('paypal')).toBe(true);
  });

  it('100% rollout — every user gets Stripe', () => {
    vf.hydrate('useStripe', { value: true, rollout: 100 });
    for (const uid of ['u1', 'u2', 'u3', 'u4', 'u5']) {
      expect(vf.flags.useStripe.isRolledOutFor(uid)).toBe(true);
    }
  });

  it('0% rollout — no user gets Stripe', () => {
    vf.hydrate('useStripe', { value: true, rollout: 0 });
    for (const uid of ['u1', 'u2', 'u3', 'u4', 'u5']) {
      expect(vf.flags.useStripe.isRolledOutFor(uid)).toBe(false);
    }
  });

  it('same userId always hashes to same bucket — deterministic', () => {
    vf.hydrate('useStripe', { value: true, rollout: 50 });
    const uid = 'user_stable';
    const first = vf.flags.useStripe.isRolledOutFor(uid);
    for (let i = 0; i < 20; i++) {
      expect(vf.flags.useStripe.isRolledOutFor(uid)).toBe(first);
    }
  });

  it('isRolledOutFor returns false when flag is disabled, regardless of rollout', () => {
    vf.hydrate('useStripe', { value: true, rollout: 100, enabled: false });
    for (const uid of ['u1', 'u2', 'u3']) {
      expect(vf.flags.useStripe.isRolledOutFor(uid)).toBe(false);
    }
  });

  it('bucket matches manual djb2 hash', () => {
    vf.hydrate('useStripe', { value: true, rollout: 50 });
    const uid = 'user_42';
    const bucket = stableHash(`useStripe:${uid}`);
    const expected = bucket < 50;
    expect(vf.flags.useStripe.isRolledOutFor(uid)).toBe(expected);
  });
});

// ================================================================
// ACCESSOR STABILITY — cached ref always reflects current injection
// ================================================================

describe('accessor stability under injection switches', () => {
  it('cached accessor ref reflects post-hydration injection decision', () => {
    const acc = vf.flags.useStripe;
    expect(acc.value).toBe(false);
    vf.hydrate('useStripe', { value: true });
    // same ref, new value
    expect(acc.value).toBe(true);
    expect(resolvePayment(vf)).toBeInstanceOf(StripeService);
  });

  it('accessor grabbed before hydration drives correct injection after', () => {
    const acc = vf.flags.checkoutVariant;
    vf.hydrate('checkoutVariant', { value: 'express' });
    expect(acc.value).toBe('express');
    expect(resolveCheckout(vf)).toBeInstanceOf(ExpressCheckout);
  });

  it('multiple accessors grabbed upfront all reflect hydration', () => {
    const payment = vf.flags.useStripe;
    const checkout = vf.flags.checkoutVariant;
    const theme = vf.flags.themeEngine;

    vf.hydrate('useStripe', { value: true });
    vf.hydrate('checkoutVariant', { value: 'express' });
    vf.hydrate('themeEngine', { value: 'ocean' });

    expect(payment.value).toBe(true);
    expect(checkout.value).toBe('express');
    expect(theme.value).toBe('ocean');

    expect(resolvePayment(vf)).toBeInstanceOf(StripeService);
    expect(resolveCheckout(vf)).toBeInstanceOf(ExpressCheckout);
    expect(resolveTheme(vf)).toBeInstanceOf(OceanThemeService);
  });
});

// ================================================================
// ATOMIC MULTI-FLAG INJECTION — applyState drives container setup
// ================================================================

describe('applyState — atomic multi-flag injection bootstrap', () => {
  it('bootstraps all injections from a single applyState call', () => {
    vf.applyState({
      useStripe: { value: true, enabled: true },
      checkoutVariant: { value: 'express', enabled: true },
      themeEngine: { value: 'ocean', enabled: true },
      apiVersion: { value: 'v2', enabled: true },
      workerCount: { value: 4, enabled: true },
    });

    expect(resolvePayment(vf)).toBeInstanceOf(StripeService);
    expect(resolveCheckout(vf)).toBeInstanceOf(ExpressCheckout);
    expect(resolveTheme(vf)).toBeInstanceOf(OceanThemeService);
    expect(resolveApi(vf)).toBeInstanceOf(ApiV2Service);
    expect(resolveWorkerPool(vf)).toBe(4);
  });

  it('partial applyState only affects specified flags', () => {
    vf.applyState({ useStripe: { value: true } });
    expect(resolvePayment(vf)).toBeInstanceOf(StripeService);
    expect(resolveCheckout(vf)).toBeInstanceOf(LegacyCheckout); // untouched
  });

  it('applyState with enabled: false forces fallback injection across all flags', () => {
    vf.applyState({
      useStripe: { value: true, enabled: false },
      checkoutVariant: { value: 'express', enabled: false },
      themeEngine: { value: 'ocean', enabled: false },
      apiVersion: { value: 'v2', enabled: false },
    });

    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
    expect(resolveCheckout(vf)).toBeInstanceOf(LegacyCheckout);
    expect(resolveTheme(vf)).toBeInstanceOf(DefaultThemeService);
    expect(resolveApi(vf)).toBeInstanceOf(ApiV1Service);
  });
});

// ================================================================
// GUARD RAILS — invalid injection inputs throw, don't silently corrupt
// ================================================================

describe('guard rails — invalid inputs must not corrupt injection state', () => {
  it('wrong type for boolean flag throws and leaves resolver intact', () => {
    expect(() => vf.hydrate('useStripe', { value: 'yes' as any })).toThrow(VoidFlagError);
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
  });

  it('wrong type for string flag throws and leaves resolver intact', () => {
    expect(() => vf.hydrate('checkoutVariant', { value: 123 as any })).toThrow(
      VoidFlagError,
    );
    expect(resolveCheckout(vf)).toBeInstanceOf(LegacyCheckout);
  });

  it('wrong type for number flag throws and leaves resolver intact', () => {
    expect(() => vf.hydrate('workerCount', { value: 'many' as any })).toThrow(
      VoidFlagError,
    );
    expect(resolveWorkerPool(vf)).toBe(1);
  });

  it('unknown flag key throws', () => {
    expect(() => vf.hydrate('nonExistent' as any, { value: true })).toThrow(
      VoidFlagError,
    );
  });

  it('rollout out of range throws and leaves resolver intact', () => {
    expect(() => vf.hydrate('useStripe', { rollout: 150 })).toThrow(VoidFlagError);
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
  });

  it('isRolledOutFor with empty userId throws', () => {
    expect(() => vf.flags.useStripe.isRolledOutFor('')).toThrow(VoidFlagError);
  });

  it('disposed client throws on any injection read', () => {
    vf.dispose();
    expect(() => resolvePayment(vf)).toThrow(VoidFlagError);
    expect(() => resolveCheckout(vf)).toThrow(VoidFlagError);
    expect(() => vf.flags.useStripe.isRolledOutFor('u1')).toThrow(VoidFlagError);
  });

  it('applyState with bad type mid-batch leaves entire store untouched', () => {
    expect(() =>
      vf.applyState({
        useStripe: { value: true },
        checkoutVariant: { value: 999 as any }, // bad — should abort whole batch
      }),
    ).toThrow(VoidFlagError);

    // both should still be at defaults
    expect(resolvePayment(vf)).toBeInstanceOf(PayPalService);
    expect(resolveCheckout(vf)).toBeInstanceOf(LegacyCheckout);
  });
});

// ================================================================
// SNAPSHOT — injection state captured correctly at any point
// ================================================================

describe('snapshot — captures injection state point-in-time', () => {
  it('snapshot reflects current injection-driving values', () => {
    vf.hydrate('useStripe', { value: true, rollout: 75 });
    const snap = vf.snapshot('useStripe');
    expect(snap.value).toBe(true);
    expect(snap.rollout).toBe(75);
    expect(snap.enabled).toBe(true);
  });

  it('snapshot is frozen — cannot be mutated', () => {
    const snap = vf.snapshot('useStripe') as any;
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      snap.value = true;
    }).toThrow();
  });

  it('snapshot does not change after subsequent hydration', () => {
    const snap = vf.snapshot('useStripe');
    vf.hydrate('useStripe', { value: true });
    expect(snap.value).toBe(false); // snapshot is point-in-time
  });

  it('debugSnapshots captures full injection state', () => {
    vf.hydrate('useStripe', { value: true });
    vf.hydrate('checkoutVariant', { value: 'express' });
    const snaps = vf.debugSnapshots();
    expect(snaps.useStripe.value).toBe(true);
    expect(snaps.checkoutVariant.value).toBe('express');
    expect(snaps.themeEngine.value).toBe('default'); // untouched
  });
});
