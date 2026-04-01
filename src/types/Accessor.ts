import { FlagDefinition } from './FlagMap.js';
import { InferFlagValue } from './InferFlagValue.js';

export interface Accessor<F extends FlagDefinition> extends Omit<
  Function,
  keyof Function
> {
  /**
   * Returns the resolved flag value.
   *
   * - If the flag is **enabled**, returns the current runtime value.
   * - If the flag is **disabled**, returns the fallback value.
   *
   * @throws If the SDK instance has been disposed.
   *
   * @example
   * ```ts
   * const color = vf.flags.bannerColor(); // "red" or fallback
   * ```
   */
  (): InferFlagValue<F>;

  /**
   * Whether the flag is currently enabled.
   *
   * @throws If the SDK instance has been disposed.
   *
   * @example
   * ```ts
   * if (vf.flags.darkMode.enabled) { ... }
   * ```
   */
  readonly enabled: boolean;
  /**
   * The current runtime value of the flag.
   *
   * This reflects the latest value received from the server.
   * If no override has been provided yet, this equals the fallback.
   *
   * @throws If the SDK instance has been disposed.
   *
   * @example
   * ```ts
   * console.log(vf.flags.bannerColor.value); // "red"
   * ```
   */
  readonly value: InferFlagValue<F>;
  /**
   * The fallback value defined in the schema.
   *
   * This is the value used when the flag is disabled or
   * before any remote configuration has been received.
   *
   * @throws If the SDK instance has been disposed.
   *
   * @example
   * ```ts
   * console.log(vf.flags.bannerColor.fallback); // "blue"
   * ```
   */
  readonly fallback: InferFlagValue<F>;
  readonly isRolledOutFor: (userId: string) => boolean;
}
