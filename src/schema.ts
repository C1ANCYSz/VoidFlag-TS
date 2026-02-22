import kebabCase from 'kebab-case';
import { VoidFlagError } from './VoidFlagError.js';
/* --------------------------------------------
   Flag Types (Schema Only)
-------------------------------------------- */

export interface BooleanFlag {
  type: 'BOOLEAN';
  fallback: boolean;
}

export interface StringFlag {
  type: 'STRING';
  fallback: string;
}

export interface NumberFlag {
  type: 'NUMBER';
  fallback: number;
}

export type FlagDefinition = BooleanFlag | StringFlag | NumberFlag;

export type FlagMap = Record<string, FlagDefinition>;

/* --------------------------------------------
   Fluent Builder Base
-------------------------------------------- */

class FlagBuilder<T extends FlagDefinition> {
  constructor(protected config: Omit<T, 'fallback'>) {}

  fallback(value: T['fallback']): T {
    if (value === null || value === undefined) {
      throw new VoidFlagError(`fallback value must not be null or undefined`);
    }
    return { ...this.config, fallback: value } as T;
  }
  // rules(segments: string[]): this {
  //   this.config = {
  //     ...this.config,
  //     rules: { segments },
  //   };
  //   return this;
  // }
}

/* --------------------------------------------
   Builders
-------------------------------------------- */

class BooleanBuilder extends FlagBuilder<BooleanFlag> {
  constructor() {
    super({ type: 'BOOLEAN' });
  }
}

class StringBuilder extends FlagBuilder<StringFlag> {
  constructor() {
    super({ type: 'STRING' });
  }
}

class NumberBuilder extends FlagBuilder<NumberFlag> {
  constructor() {
    super({ type: 'NUMBER' });
  }
}

/* --------------------------------------------
   Public API (Zod-like)
-------------------------------------------- */

export function boolean() {
  return new BooleanBuilder();
}

export function string() {
  return new StringBuilder();
}

export function number() {
  return new NumberBuilder();
}

/* --------------------------------------------
   defineFlags (adds kebab-case runtime key)
-------------------------------------------- */

export function defineFlags<T extends FlagMap>(flags: T) {
  const result = {} as { [K in keyof T]: T[K] & { key: string } };

  for (const dangerous of ['__proto__', 'prototype', 'constructor']) {
    if (Object.prototype.hasOwnProperty.call(flags, dangerous)) {
      throw new VoidFlagError(`Invalid flag key "${dangerous}"`);
    }
  }

  for (const name in flags) {
    if (!Object.prototype.hasOwnProperty.call(flags, name)) continue;
    assertSafeKey(name); // throws VoidFlagError for valueOf etc.
    result[name] = { ...flags[name], key: kebabCase(name) };
  }

  return result;
}

const RESERVED_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'valueOf',
  'toString',
]);

function assertSafeKey(key: string) {
  if (RESERVED_KEYS.has(key)) {
    throw new VoidFlagError(`Invalid flag key "${key}"`);
  }
}
