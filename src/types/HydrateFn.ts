import { FlagMap } from './FlagMap.js';
import { Patch } from './Patch.js';

export type HydrateFn<S extends FlagMap> = <K extends keyof S>(
  key: K,
  patch: Patch,
) => void;
