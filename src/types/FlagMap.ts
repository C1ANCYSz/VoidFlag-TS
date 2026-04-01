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

export interface FlagMap {
  [key: string]: FlagDefinition;
}
