import { FlagDefinition } from './FlagMap.js';
import { InferFlagValue } from './InferFlagValue.js';

export interface RuntimeFlag<F extends FlagDefinition> {
  type: F['type'];
  value: InferFlagValue<F>;
  fallback: InferFlagValue<F>;
  enabled: boolean;
  rollout: number;
}
