import kebabCase from 'kebab-case';
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
    return {
      ...this.config,
      fallback: value,
    } as T;
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
  const result = {} as {
    [K in keyof T]: T[K] & { key: string };
  };

  for (const name in flags) {
    result[name] = {
      ...flags[name],
      key: kebabCase(name),
    };
  }
  return result;
}
