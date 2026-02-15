// import type { FlagMap } from '@voidflag/schema';

// /* --------------------------------------------
//    Infer Flag Value
// -------------------------------------------- */

// export type InferFlagValue<F> = F extends { type: 'BOOLEAN' }
//   ? boolean
//   : F extends { type: 'STRING' }
//     ? string
//     : F extends { type: 'NUMBER' }
//       ? number
//       : never;

// /* --------------------------------------------
//    Runtime Flag Type
// -------------------------------------------- */

// export type RuntimeFlag<F> = F & {
//   key: string;
//   value: InferFlagValue<F>;
//   enabled: boolean;
//   exists: boolean;
//   rollout: number;
// };

// /* --------------------------------------------
//    Callable Flag Object (SAFE)
// -------------------------------------------- */

// export type FlagAccessor<F> = RuntimeFlag<F> & {
//   (): InferFlagValue<F>;
// };

// /* --------------------------------------------
//    Store Shape
// -------------------------------------------- */

// type FlagState<T extends FlagMap> = {
//   [K in keyof T]: RuntimeFlag<T[K]>;
// };

// /* --------------------------------------------
//    Client Flags Shape
// -------------------------------------------- */

// export type ClientFlags<T extends FlagMap> = {
//   [K in keyof T]: FlagAccessor<T[K]>;
// };

// /* --------------------------------------------
//    Client Creator
// -------------------------------------------- */

// export function createClient<T extends FlagMap>(opts: {
//   schema: T;
//   initial?: Partial<{ [K in keyof T]: InferFlagValue<T[K]> }>;
// }) {
//   const store = {} as FlagState<T>;
//   const accessors = {} as Partial<ClientFlags<T>>;

//   let isDisposed = false;

//   /* -----------------------------
//      Initialize Store From Schema
//   ----------------------------- */

//   for (const name in opts.schema) {
//     const def = opts.schema[name];
//     const key = name as keyof T;

//     const flag = {
//       ...def,
//       key: name,
//       value: opts.initial?.[key] ?? def.default,
//       enabled: false,
//       exists: false,
//       rollout: 100,
//     };

//     store[key] = flag as RuntimeFlag<T[typeof key]>;
//   }

//   /* -----------------------------
//      INTERNAL: Build Accessor Once
//   ----------------------------- */

//   function buildAccessor<K extends keyof T>(key: K): FlagAccessor<T[K]> {
//     const evaluate = () => {
//       if (isDisposed) {
//         throw new Error('Client has been disposed');
//       }
//       const currentFlag = store[key];
//       return currentFlag.enabled ? currentFlag.value : currentFlag.default;
//     };

//     return new Proxy(evaluate as any, {
//       get(_target, prop) {
//         if (isDisposed) return undefined;
//         const currentFlag = store[key];
//         if (prop in currentFlag) {
//           return currentFlag[prop as keyof typeof currentFlag];
//         }
//         return undefined;
//       },
//       apply(_target, _thisArg, _args) {
//         return evaluate();
//       },
//       has(_target, prop) {
//         return !isDisposed && prop in store[key];
//       },
//       ownKeys(_target) {
//         return isDisposed ? [] : Reflect.ownKeys(store[key]);
//       },
//       getOwnPropertyDescriptor(_target, prop) {
//         return isDisposed
//           ? undefined
//           : Object.getOwnPropertyDescriptor(store[key], prop);
//       },
//     }) as FlagAccessor<T[K]>;
//   }

//   /* -----------------------------
//      Hydrate From Server
//   ----------------------------- */

//   function hydrate(
//     payload: Partial<{
//       [K in keyof T]: {
//         value: InferFlagValue<T[K]>;
//         enabled?: boolean;
//         rollout?: number;
//       };
//     }>,
//   ) {
//     if (isDisposed) {
//       throw new Error('Client has been disposed');
//     }

//     for (const key in payload) {
//       const typedKey = key as keyof T;
//       const data = payload[typedKey];
//       if (!data) continue;

//       const flag = store[typedKey];
//       if (!flag) continue;

//       flag.value = data.value as typeof flag.value;
//       flag.enabled = data.enabled ?? false;
//       flag.rollout = data.rollout ?? 100;
//       flag.exists = true;
//     }
//   }

//   /* -----------------------------
//      Clear Accessor Cache
//   ----------------------------- */

//   function clearCache() {
//     // Remove all cached accessors to free memory
//     for (const key in accessors) {
//       delete accessors[key];
//     }
//   }

//   /* -----------------------------
//      Dispose Client
//   ----------------------------- */

//   function dispose() {
//     if (isDisposed) return;

//     isDisposed = true;

//     // Clear all cached accessors
//     clearCache();

//     // Clear store
//     for (const key in store) {
//       delete store[key];
//     }
//   }

//   /* -----------------------------
//      Proxy Flags Access
//   ----------------------------- */

//   const flags = new Proxy(
//     {},
//     {
//       get(_target, prop: string | symbol) {
//         if (isDisposed || typeof prop !== 'string') return undefined;

//         const key = prop as keyof T;
//         if (!(key in store)) return undefined;

//         // Return cached accessor if exists
//         if (accessors[key]) return accessors[key];

//         // Build once, cache forever (until cleared)
//         const accessor = buildAccessor(key);
//         accessors[key] = accessor;

//         return accessor;
//       },

//       set() {
//         return false;
//       },

//       ownKeys() {
//         return isDisposed ? [] : Object.keys(store);
//       },

//       has(_target, prop) {
//         return !isDisposed && typeof prop === 'string' && prop in store;
//       },

//       getOwnPropertyDescriptor(_target, prop) {
//         if (isDisposed || typeof prop !== 'string' || !(prop in store)) {
//           return undefined;
//         }
//         return {
//           enumerable: true,
//           configurable: true,
//         };
//       },
//     },
//   ) as ClientFlags<T>;

//   /* -----------------------------
//      Return SDK Core
//   ----------------------------- */

//   return {
//     flags,
//     hydrate,

//     /**
//      * Clear cached accessor objects to free memory.
//      * Useful for long-running apps that access flags dynamically.
//      */
//     clearCache,

//     /**
//      * Dispose of the client and free all resources.
//      * Client cannot be used after disposal.
//      */
//     dispose,
//   };
// }
import type { FlagMap } from '@voidflag/schema';

export type InferFlagValue<F> = F extends { type: 'BOOLEAN' }
  ? boolean
  : F extends { type: 'STRING' }
    ? string
    : F extends { type: 'NUMBER' }
      ? number
      : never;

export type RuntimeFlag<F> = F & {
  key: string;
  value: InferFlagValue<F>;
  enabled: boolean;
  exists: boolean;
  rollout: number;
};

export type FlagAccessor<F> = RuntimeFlag<F> & {
  (): InferFlagValue<F>;
};

type FlagState<T extends FlagMap> = {
  [K in keyof T]: RuntimeFlag<T[K]>;
};

export type ClientFlags<T extends FlagMap> = {
  [K in keyof T]: FlagAccessor<T[K]>;
};

export function createClient<T extends FlagMap>(opts: {
  schema: T;
  initial?: Partial<{ [K in keyof T]: InferFlagValue<T[K]> }>;
}) {
  const store = {} as FlagState<T>;
  const flags = {} as ClientFlags<T>;
  let isDisposed = false;

  for (const name in opts.schema) {
    const def = opts.schema[name];
    const key = name as keyof T;

    store[key] = {
      ...def,
      key: name,
      value: opts.initial?.[key] ?? def.default,
      enabled: false,
      exists: false,
      rollout: 100,
    } as RuntimeFlag<T[typeof key]>;

    const flag = store[key];

    const accessor = (() => {
      if (isDisposed) throw new Error('Client has been disposed');
      return flag.enabled ? flag.value : flag.default;
    }) as FlagAccessor<T[typeof key]>;

    Object.defineProperties(accessor, {
      key: { get: () => flag.key, enumerable: true },
      type: { get: () => flag.type, enumerable: true },
      default: { get: () => flag.default, enumerable: true },
      value: { get: () => flag.value, enumerable: true },
      enabled: { get: () => flag.enabled, enumerable: true },
      exists: { get: () => flag.exists, enumerable: true },
      rollout: { get: () => flag.rollout, enumerable: true },
    });

    flags[key] = accessor;
  }

  function hydrate(
    payload: Partial<{
      [K in keyof T]: {
        value: InferFlagValue<T[K]>;
        enabled?: boolean;
        rollout?: number;
      };
    }>,
  ) {
    if (isDisposed) throw new Error('Client has been disposed');

    for (const key in payload) {
      const typedKey = key as keyof T;
      const data = payload[typedKey];
      if (!data || !store[typedKey]) continue;

      const flag = store[typedKey];
      flag.value = data.value as typeof flag.value;
      flag.enabled = data.enabled ?? false;
      flag.rollout = data.rollout ?? 100;
      flag.exists = true;
    }
  }

  function dispose() {
    if (isDisposed) return;
    isDisposed = true;
    for (const key in store) delete store[key];
  }

  return { flags, hydrate, dispose };
}
