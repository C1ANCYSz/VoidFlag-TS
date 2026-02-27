import { describe, it, expect, beforeEach } from 'vitest';
import {
  VoidClient,
  defineFlags,
  boolean,
  string,
  number,
  VoidFlagError,
} from '@voidflag/sdk';

const schema = defineFlags({
  checkoutVariant: string().fallback('control'),
  apiRegion: string().fallback('us-east-1'),
  themeColor: string().fallback('#000000'),
  maxItems: number().fallback(10),
});

type Schema = typeof schema;
let vf: VoidClient<Schema>;

beforeEach(() => {
  vf = new VoidClient({ schema });
});

// ================================================================
// DETERMINISM & BASIC RULES
// ================================================================

describe('isRolledOutFor() — rules', () => {
  it('is deterministic for the same (flag, user) pair', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    const r1 = vf.isRolledOutFor('checkoutVariant', 'user-abc');
    const r2 = vf.isRolledOutFor('checkoutVariant', 'user-abc');
    const r3 = vf.isRolledOutFor('checkoutVariant', 'user-abc');
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('rollout 0 always returns false', () => {
    vf.hydrate('checkoutVariant', { rollout: 0 });
    for (let i = 0; i < 100; i++) {
      expect(vf.isRolledOutFor('checkoutVariant', `user-${i}`)).toBe(false);
    }
  });

  it('rollout 100 always returns true when enabled', () => {
    vf.hydrate('checkoutVariant', { rollout: 100 });
    for (let i = 0; i < 100; i++) {
      expect(vf.isRolledOutFor('checkoutVariant', `user-${i}`)).toBe(true);
    }
  });

  it('disabled flag returns false regardless of rollout', () => {
    vf.hydrate('checkoutVariant', { rollout: 100, enabled: false });
    for (const u of ['alice', 'bob', 'carol']) {
      expect(vf.isRolledOutFor('checkoutVariant', u)).toBe(false);
    }
  });

  it('enabled flag with rollout 0 returns false', () => {
    vf.hydrate('checkoutVariant', { enabled: true, rollout: 0 });
    expect(vf.isRolledOutFor('checkoutVariant', 'anyUser')).toBe(false);
  });

  it('rollout >= 100 throws, and defaults to 100 if non boolean, 100 if boolean', () => {
    expect(() => {
      vf.hydrate('checkoutVariant', { rollout: 999 });
    }).toThrowError(VoidFlagError);
    expect(vf.isRolledOutFor('checkoutVariant', 'anyone')).toBe(true);
  });

  it('rollout <= 0 throws, and defaults to 100 if non boolean, 100 if boolean', () => {
    expect(() => {
      vf.hydrate('checkoutVariant', { rollout: -10 });
    }).toThrow(VoidFlagError);
    expect(vf.isRolledOutFor('checkoutVariant', 'anyone')).toBe(true);
  });

  it('rollout percentage change is respected immediately', () => {
    vf.hydrate('checkoutVariant', { rollout: 100 });
    expect(vf.isRolledOutFor('checkoutVariant', 'user-x')).toBe(true);
    vf.hydrate('checkoutVariant', { rollout: 0 });
    expect(vf.isRolledOutFor('checkoutVariant', 'user-x')).toBe(false);
  });
});

// ================================================================
// DISTRIBUTION
// ================================================================

describe('isRolledOutFor() — distribution', () => {
  it('~50% at rollout 50 over 10,000 users (within 40–60%)', () => {
    vf.hydrate('checkoutVariant', { rollout: 50, enabled: true });
    let count = 0;
    for (let i = 0; i < 10_000; i++) {
      if (vf.isRolledOutFor('checkoutVariant', `user-${i}`)) count++;
    }
    expect(count).toBeGreaterThan(4_000);
    expect(count).toBeLessThan(6_000);
  });

  it('~10% at rollout 10 over 10,000 users (within 8–12%)', () => {
    vf.hydrate('checkoutVariant', { rollout: 10, enabled: true });
    let count = 0;
    for (let i = 0; i < 10_000; i++) {
      if (vf.isRolledOutFor('checkoutVariant', `user-${i}`)) count++;
    }
    expect(count).toBeGreaterThan(800);
    expect(count).toBeLessThan(1_200);
  });

  it('~1% at rollout 1 over 1,000 users', () => {
    vf.hydrate('checkoutVariant', { rollout: 1 });
    const users = Array.from({ length: 1000 }, (_, i) => `u-${i}`);
    const count = users.filter((u) => vf.isRolledOutFor('checkoutVariant', u)).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(30);
  });

  it('~99% at rollout 99 over 1,000 users', () => {
    vf.hydrate('checkoutVariant', { rollout: 99 });
    const users = Array.from({ length: 1000 }, (_, i) => `u-${i}`);
    const count = users.filter((u) => vf.isRolledOutFor('checkoutVariant', u)).length;
    expect(count).toBeGreaterThan(970);
    expect(count).toBeLessThanOrEqual(1000);
  });
});

// ================================================================
// INDEPENDENCE & STABILITY
// ================================================================

describe('isRolledOutFor() — independence & cross-instance stability', () => {
  it('different flag keys produce independent hash buckets', () => {
    vf.hydrate('themeColor', { rollout: 50 });
    vf.hydrate('checkoutVariant', { rollout: 50 });

    const results = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const userId = `user-${i}`;
      const a = vf.isRolledOutFor('themeColor', userId);
      const b = vf.isRolledOutFor('checkoutVariant', userId);
      results.add(`${a}-${b}`);
    }
    // All four combos should appear
    expect(results.size).toBe(4);
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

  it('same user always lands in the same bucket (100 calls)', () => {
    vf.hydrate('checkoutVariant', { rollout: 50, enabled: true });
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(vf.isRolledOutFor('checkoutVariant', 'sticky-user'));
    }
    expect(new Set(results).size).toBe(1);
  });
});

// ================================================================
// EDGE CASE INPUTS
// ================================================================

describe('isRolledOutFor() — edge inputs', () => {
  it('empty string userId does not throw', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.isRolledOutFor('checkoutVariant', '')).toThrow(VoidFlagError);
  });

  it('very long userId does not throw', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.isRolledOutFor('checkoutVariant', 'u'.repeat(10_000))).not.toThrow();
  });

  it('unicode userId does not throw', () => {
    vf.hydrate('checkoutVariant', { rollout: 50 });
    expect(() => vf.isRolledOutFor('checkoutVariant', '用户-🎯-émoji')).not.toThrow();
  });
});
