import { FlagDefinition } from './FlagMap.js';
import { BooleanPatch, NumberPatch, StringPatch } from './Patch.js';

export type PatchFor<F extends FlagDefinition> = F extends { type: 'BOOLEAN' }
  ? BooleanPatch
  : F extends { type: 'STRING' }
    ? StringPatch
    : F extends { type: 'NUMBER' }
      ? NumberPatch
      : never;
