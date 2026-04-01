import { BooleanFlag, FlagDefinition, NumberFlag, StringFlag } from './FlagMap.js';

export type InferFlagValue<F extends FlagDefinition> = F extends BooleanFlag
  ? boolean
  : F extends StringFlag
    ? string
    : F extends NumberFlag
      ? number
      : never;
