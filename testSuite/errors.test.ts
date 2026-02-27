import { describe, it, expect } from 'vitest';
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
  theme: string().fallback('light'),
  retryCount: number().fallback(3),
});

function makeClient() {
  return new VoidClient({ schema });
}

// ================================================================
// UNKNOWN KEYS
// ================================================================

describe('unknown key access', () => {
  it('get() throws VoidFlagError for unknown key', () => {
    const vf = makeClient();
    // @ts-expect-error
    expect(() => vf.get('fake_key')).toThrow(VoidFlagError);
    // @ts-expect-error
    expect(() => vf.get('fake_key')).toThrow(/does not exist/);
  });

  it('flag() throws VoidFlagError for unknown key', () => {
    const vf = makeClient();
    // @ts-expect-error
    expect(() => vf.flag('doesNotExist')).toThrow(VoidFlagError);
  });

  it('isRolledOutFor() throws VoidFlagError for unknown key', () => {
    const vf = makeClient();
    // @ts-expect-error
    expect(() => vf.isRolledOutFor('doesNotExist', 'user')).toThrow(VoidFlagError);
  });
});

// ================================================================
// PROTOTYPE POLLUTION
// ================================================================

describe('prototype pollution guard', () => {
  it('hydrating __proto__ throws or does not pollute Object.prototype', () => {
    const vf = makeClient();
    try {
      // @ts-ignore
      vf.hydrate('__proto__', { value: 'hacked' });
    } catch (e) {
      expect(e).toBeInstanceOf(VoidFlagError);
    }
    // Ensure Object.prototype is clean regardless
    expect((Object.prototype as any).value).toBeUndefined();
  });
});

// ================================================================
// TYPE COERCION (runtime payload from server)
// ================================================================

describe('type coercion at runtime', () => {
  it('passes through mis-typed payload without crashing', () => {
    const vf = makeClient();
    // @ts-ignore — simulating bad payload from server
    expect(() => {
      vf.hydrate('retryCount', { value: '500' });
    }).toThrowError(VoidFlagError);
    // SDK doesn't validate types at runtime — it passes through
    expect(vf.get('retryCount')).toBe(3);
  });
});
