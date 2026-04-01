import { FlagDefinition } from './FlagMap.js';
import { InferFlagValue } from './InferFlagValue.js';

export interface Snapshot<F extends FlagDefinition> {
  readonly value: InferFlagValue<F>;
  readonly fallback: InferFlagValue<F>;
  readonly enabled: boolean;
  readonly rollout: number;
}
