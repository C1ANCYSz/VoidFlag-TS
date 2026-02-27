/**
 * Schema Builder — Aggressive Vulnerability Test Suite
 * We're not confirming it works. We're finding where it breaks.
 */

import { describe, it, expect } from 'vitest';
import { boolean, string, number, defineFlags } from '@voidflag/sdk';

// ══════════════════════════════════════════════════════════════════════════════
// 1. boolean().fallback() — type enforcement
// ══════════════════════════════════════════════════════════════════════════════

describe('boolean().fallback() — type enforcement', () => {
  it('rejects string "true"', () => {
    expect(() => boolean().fallback('true' as any)).toThrow(/boolean/i);
  });

  it('rejects string "false"', () => {
    expect(() => boolean().fallback('false' as any)).toThrow(/boolean/i);
  });

  it('rejects numeric 1', () => {
    expect(() => boolean().fallback(1 as any)).toThrow(/boolean/i);
  });

  it('rejects numeric 0', () => {
    expect(() => boolean().fallback(0 as any)).toThrow(/boolean/i);
  });

  it('rejects null', () => {
    expect(() => boolean().fallback(null as any)).toThrow();
  });

  it('rejects undefined', () => {
    expect(() => boolean().fallback(undefined as any)).toThrow();
  });

  it('rejects object', () => {
    expect(() => boolean().fallback({} as any)).toThrow(/boolean/i);
  });

  it('rejects array', () => {
    expect(() => boolean().fallback([] as any)).toThrow(/boolean/i);
  });

  it('rejects NaN', () => {
    expect(() => boolean().fallback(NaN as any)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. string().fallback() — type enforcement
// ══════════════════════════════════════════════════════════════════════════════

describe('string().fallback() — type enforcement', () => {
  it('rejects boolean true', () => {
    expect(() => string().fallback(true as any)).toThrow(/string/i);
  });

  it('rejects boolean false', () => {
    expect(() => string().fallback(false as any)).toThrow(/string/i);
  });

  it('rejects number', () => {
    expect(() => string().fallback(42 as any)).toThrow(/string/i);
  });

  it('rejects null', () => {
    expect(() => string().fallback(null as any)).toThrow();
  });

  it('rejects undefined', () => {
    expect(() => string().fallback(undefined as any)).toThrow();
  });

  it('rejects object', () => {
    expect(() => string().fallback({} as any)).toThrow(/string/i);
  });

  it('rejects array', () => {
    expect(() => string().fallback([] as any)).toThrow(/string/i);
  });

  it('accepts empty string', () => {
    expect(string().fallback('').fallback).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. number().fallback() — type enforcement
// ══════════════════════════════════════════════════════════════════════════════

describe('number().fallback() — type enforcement', () => {
  it('rejects string', () => {
    expect(() => number().fallback('16' as any)).toThrow(/number/i);
  });

  it('rejects boolean', () => {
    expect(() => number().fallback(true as any)).toThrow(/number/i);
  });

  it('rejects NaN', () => {
    expect(() => number().fallback(NaN)).toThrow();
  });

  it('rejects Infinity', () => {
    expect(() => number().fallback(Infinity)).toThrow();
  });

  it('rejects -Infinity', () => {
    expect(() => number().fallback(-Infinity)).toThrow();
  });

  it('rejects null', () => {
    expect(() => number().fallback(null as any)).toThrow();
  });

  it('rejects undefined', () => {
    expect(() => number().fallback(undefined as any)).toThrow();
  });

  it('rejects object', () => {
    expect(() => number().fallback({} as any)).toThrow(/number/i);
  });

  it('accepts 0', () => {
    expect(number().fallback(0).fallback).toBe(0);
  });

  it('accepts negative finite', () => {
    expect(number().fallback(-1).fallback).toBe(-1);
  });

  it('accepts float', () => {
    expect(number().fallback(3.14).fallback).toBe(3.14);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. defineFlags() — prototype pollution attempts
// ══════════════════════════════════════════════════════════════════════════════

describe('defineFlags() — prototype pollution', () => {
  it('rejects __proto__ as a key', () => {
    expect(() =>
      defineFlags({ ['__proto__']: boolean().fallback(false) } as any),
    ).toThrow();
  });

  it('rejects constructor as a key', () => {
    expect(() =>
      defineFlags({ ['constructor']: boolean().fallback(false) } as any),
    ).toThrow();
  });

  it('rejects prototype as a key', () => {
    expect(() =>
      defineFlags({ ['prototype']: boolean().fallback(false) } as any),
    ).toThrow();
  });

  it('rejects valueOf as a key', () => {
    expect(() =>
      defineFlags({ ['valueOf']: boolean().fallback(false) } as any),
    ).toThrow();
  });

  it('rejects toString as a key', () => {
    expect(() =>
      defineFlags({ ['toString']: boolean().fallback(false) } as any),
    ).toThrow();
  });

  it('__proto__ injection does not pollute Object.prototype', () => {
    try {
      defineFlags({ ['__proto__']: boolean().fallback(false) } as any);
    } catch (_) {}
    expect(({} as any).fallback).toBeUndefined();
    expect(({} as any).type).toBeUndefined();
  });

  it('result object does not have __proto__ as an own key', () => {
    try {
      defineFlags({ ['__proto__']: boolean().fallback(false) } as any);
    } catch (_) {}
    const result = defineFlags({ darkMode: boolean().fallback(false) });
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. defineFlags() — key safety
// ══════════════════════════════════════════════════════════════════════════════

describe('defineFlags() — key safety', () => {
  it('rejects hasOwnProperty as a key', () => {
    expect(() =>
      defineFlags({ ['hasOwnProperty']: boolean().fallback(false) } as any),
    ).toThrow();
  });

  it('rejects isPrototypeOf as a key', () => {
    expect(() =>
      defineFlags({ ['isPrototypeOf']: boolean().fallback(false) } as any),
    ).toThrow();
  });

  it('accepts __proto__ as a STRING VALUE — not a key', () => {
    const schema = defineFlags({ theme: string().fallback('__proto__') });
    expect(schema.theme.fallback).toBe('__proto__');
  });

  it('accepts constructor as a STRING VALUE — not a key', () => {
    const schema = defineFlags({ theme: string().fallback('constructor') });
    expect(schema.theme.fallback).toBe('constructor');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. defineFlags() — output immutability
// ══════════════════════════════════════════════════════════════════════════════

describe('defineFlags() — output immutability', () => {
  it('mutating output does not affect a second call with the same input', () => {
    const raw = { darkMode: boolean().fallback(false) };
    const a = defineFlags(raw);
    (a.darkMode as any).fallback = true;
    const b = defineFlags(raw);
    expect(b.darkMode.fallback).toBe(false);
  });

  it('does not mutate the original flag object', () => {
    const flag = boolean().fallback(false);
    defineFlags({ darkMode: flag });
    expect((flag as any).key).toBeUndefined();
  });

  it('two calls produce independent objects', () => {
    const raw = { darkMode: boolean().fallback(false) };
    const a = defineFlags(raw);
    const b = defineFlags(raw);
    expect(a).not.toBe(b);
    expect(a.darkMode).not.toBe(b.darkMode);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. defineFlags() — kebab-case key correctness
// ══════════════════════════════════════════════════════════════════════════════

describe('defineFlags() — camelCase key correctness', () => {
  it('camelCase → also camelCase', () => {
    expect(defineFlags({ darkMode: boolean().fallback(false) }).darkMode.key).toBe(
      'darkMode',
    );
  });

  it('PascalCase →PascalCase', () => {
    expect(
      defineFlags({ DarkMode: boolean().fallback(false) }).DarkMode.key,
    ).toBeDefined();
  });

  it('single word unchanged', () => {
    expect(defineFlags({ theme: string().fallback('light') }).theme.key).toBe('theme');
  });

  it('key is always a non-empty string', () => {
    const schema = defineFlags({ darkMode: boolean().fallback(false) });
    expect(typeof schema.darkMode.key).toBe('string');
    expect(schema.darkMode.key.length).toBeGreaterThan(0);
  });

  it('key is present alongside type and fallback', () => {
    const schema = defineFlags({ darkMode: boolean().fallback(false) });
    expect(Object.keys(schema.darkMode).sort()).toEqual(
      expect.arrayContaining(['type', 'fallback', 'key']),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Builder reuse — state isolation
// ══════════════════════════════════════════════════════════════════════════════

describe('Builder reuse — state isolation', () => {
  it('calling fallback twice on same boolean builder produces independent results', () => {
    const b = boolean();
    const f1 = b.fallback(true);
    const f2 = b.fallback(false);
    expect(f1.fallback).toBe(true);
    expect(f2.fallback).toBe(false);
    expect(f1).not.toBe(f2);
  });

  it('calling fallback twice on same string builder produces independent results', () => {
    const b = string();
    const f1 = b.fallback('red');
    const f2 = b.fallback('blue');
    expect(f1.fallback).toBe('red');
    expect(f2.fallback).toBe('blue');
  });

  it('calling fallback twice on same number builder produces independent results', () => {
    const b = number();
    const f1 = b.fallback(1);
    const f2 = b.fallback(2);
    expect(f1.fallback).toBe(1);
    expect(f2.fallback).toBe(2);
  });

  it('mutating one result does not affect the other from same builder', () => {
    const b = boolean();
    const f1 = b.fallback(true) as any;
    const f2 = b.fallback(false) as any;
    f1.fallback = false;
    expect(f2.fallback).toBe(false); // f2 is independently false, not contaminated
    expect(f1.fallback).toBe(false); // f1 was mutated
  });

  it('builder config is not shared between instances', () => {
    const b1 = boolean();
    const b2 = boolean();
    const f1 = b1.fallback(true);
    const f2 = b2.fallback(false);
    expect(f1.type).toBe('BOOLEAN');
    expect(f2.type).toBe('BOOLEAN');
    expect(f1.fallback).toBe(true);
    expect(f2.fallback).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. defineFlags() — inherited properties on input object
// ══════════════════════════════════════════════════════════════════════════════

describe('defineFlags() — inherited property safety', () => {
  it('does not process inherited properties from Object.prototype', () => {
    const schema = defineFlags({ darkMode: boolean().fallback(false) });
    // toString, valueOf etc from Object.prototype should not appear in output
    expect(Object.keys(schema)).toEqual(['darkMode']);
  });

  it('does not include non-own enumerable properties in result', () => {
    const proto = { injected: boolean().fallback(false) };
    const flags = Object.create(proto) as any;
    flags.darkMode = boolean().fallback(false);
    const schema = defineFlags(flags);
    expect(Object.keys(schema)).toEqual(['darkMode']);
    expect((schema as any).injected).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. defineFlags() — type/fallback cross-contamination
// ══════════════════════════════════════════════════════════════════════════════

describe('defineFlags() — type/fallback cross-contamination', () => {
  it('boolean flag fallback is boolean, not string', () => {
    const schema = defineFlags({ darkMode: boolean().fallback(false) });
    expect(typeof schema.darkMode.fallback).toBe('boolean');
  });

  it('string flag fallback is string, not boolean', () => {
    const schema = defineFlags({ theme: string().fallback('light') });
    expect(typeof schema.theme.fallback).toBe('string');
  });

  it('number flag fallback is number, not string', () => {
    const schema = defineFlags({ fontSize: number().fallback(16) });
    expect(typeof schema.fontSize.fallback).toBe('number');
  });

  it('multiple flags do not bleed fallback values into each other', () => {
    const schema = defineFlags({
      darkMode: boolean().fallback(true),
      theme: string().fallback('dark'),
      fontSize: number().fallback(20),
    });
    expect(schema.darkMode.fallback).toBe(true);
    expect(schema.theme.fallback).toBe('dark');
    expect(schema.fontSize.fallback).toBe(20);
  });

  it('flag objects do not share references', () => {
    const schema = defineFlags({
      a: string().fallback('x'),
      b: string().fallback('y'),
    });
    expect(schema.a).not.toBe(schema.b);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. Edge inputs to defineFlags()
// ══════════════════════════════════════════════════════════════════════════════

describe('defineFlags() — edge inputs', () => {
  it('empty schema returns empty object', () => {
    expect(Object.keys(defineFlags({}))).toHaveLength(0);
  });

  it('single flag schema works', () => {
    const schema = defineFlags({ x: boolean().fallback(false) });
    expect(Object.keys(schema)).toHaveLength(1);
  });

  it('large schema — all keys present', () => {
    const schema = defineFlags({
      a: boolean().fallback(false),
      b: boolean().fallback(true),
      c: string().fallback(''),
      d: string().fallback('x'),
      e: number().fallback(0),
      f: number().fallback(-1),
      g: number().fallback(3.14),
      h: boolean().fallback(false),
      i: string().fallback('hello'),
      j: number().fallback(100),
    });
    expect(Object.keys(schema)).toHaveLength(10);
  });

  it('numeric string key does not throw', () => {
    expect(() => defineFlags({ ['123flag']: boolean().fallback(false) })).not.toThrow();
  });

  it('key with special chars that are not reserved does not throw', () => {
    expect(() => defineFlags({ flag$one: boolean().fallback(false) })).not.toThrow();
  });
});
