import { FlagDefinition } from '@voidflag/shared';
import { RuntimeFlag } from '../types/RuntimeFlag.js';
import { Accessor } from '../types/Accessor.js';
import { InferFlagValue } from '../types/InferFlagValue.js';

export function buildAccessor<F extends FlagDefinition>(
  assertNotDisposed: () => void,
  runtime: RuntimeFlag<F>,
  isRolledOutFor: (userId: string) => boolean,
): Accessor<F> {
  const accessor = Object.setPrototypeOf(function (): InferFlagValue<F> {
    assertNotDisposed();
    return runtime.enabled ? runtime.value : runtime.fallback;
  }, null) as Accessor<F>;

  Object.defineProperty(accessor, 'enabled', {
    get(): boolean {
      assertNotDisposed();
      return runtime.enabled;
    },
    enumerable: true,
  });

  Object.defineProperty(accessor, 'value', {
    get(): InferFlagValue<F> {
      assertNotDisposed();
      return runtime.value;
    },
    enumerable: true,
  });

  Object.defineProperty(accessor, 'fallback', {
    get(): InferFlagValue<F> {
      assertNotDisposed();
      return runtime.fallback;
    },
    enumerable: true,
  });

  Object.defineProperty(accessor, 'isRolledOutFor', {
    get(): (userId: string) => boolean {
      assertNotDisposed();
      return isRolledOutFor;
    },
    enumerable: true,
  });

  return Object.freeze(accessor);
}
