import { FlagMap } from './FlagMap.js';
import { PatchFor } from './PatchFor.js';

export type HydrateFn<S extends FlagMap> = <K extends keyof S>(
  key: K,
  patch: PatchFor<S[K]>,
) => void;
