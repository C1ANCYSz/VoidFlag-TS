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

  fallback(value: boolean): BooleanFlag {
    if (typeof value !== 'boolean') {
      throw new VoidFlagError(
        `BOOLEAN flag fallback must be a boolean, got ${typeof value}`,
      );
    }
    return { ...this.config, fallback: value };
  }
}

class StringBuilder extends FlagBuilder<StringFlag> {
  constructor() {
    super({ type: 'STRING' });
  }

  fallback(value: string): StringFlag {
    if (typeof value !== 'string') {
      throw new VoidFlagError(
        `STRING flag fallback must be a string, got ${typeof value}`,
      );
    }
    return { ...this.config, fallback: value };
  }
}

class NumberBuilder extends FlagBuilder<NumberFlag> {
  constructor() {
    super({ type: 'NUMBER' });
  }

  fallback(value: number): NumberFlag {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new VoidFlagError(
        `NUMBER flag fallback must be a finite number, got ${typeof value}`,
      );
    }
    return { ...this.config, fallback: value };
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
    result[name] = { ...flags[name], key: name };
  }

  return result;
}

const RESERVED_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'valueOf',
  'toString',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
]);

function assertSafeKey(key: string) {
  if (RESERVED_KEYS.has(key)) {
    throw new VoidFlagError(`Invalid flag key "${key}"`);
  }
}
