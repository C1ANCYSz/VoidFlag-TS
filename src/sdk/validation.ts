import { RESERVED_KEYS } from '@voidflag/shared';
import { FlagMap } from '../types/index.js';
import { VoidFlagError } from './VoidFlagError.js';

export function validateSchema(schema: FlagMap): void {
  for (const key of Object.keys(schema)) {
    if (RESERVED_KEYS.has(key)) {
      throw new VoidFlagError(
        `Invalid flag name "${key}" — reserved Object.prototype property`,
      );
    }
  }
}

export function assertSafeKey(key: string): void {
  if (RESERVED_KEYS.has(key)) {
    throw new VoidFlagError(`Invalid flag key "${key}"`);
  }
}

export function validateRollout(value: number, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new VoidFlagError(
      `applyState(): "${key}" rollout must be a number between 0 and 100`,
    );
  }
  return parseFloat(value.toFixed(2));
}
