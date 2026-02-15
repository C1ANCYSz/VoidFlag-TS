// import { FlagMap } from '@voidflag/schema';

// /* --------------------------------------------
//    Infer Value Type From Flag Type
// -------------------------------------------- */

// type InferFlagValue<F> = F extends { type: 'BOOLEAN' }
//   ? boolean
//   : F extends { type: 'STRING' }
//     ? string
//     : F extends { type: 'NUMBER' }
//       ? number
//       : never;

// /* --------------------------------------------
//    Infer Client Flags Shape
// -------------------------------------------- */

// type InferFlags<T extends FlagMap> = {
//   [K in keyof T]: {
//     readonly key: T[K]['key'];
//     readonly type: T[K]['type'];

//     readonly value: InferFlagValue<T[K]>;
//     readonly defaultValue: InferFlagValue<T[K]>;

//     readonly enabled: boolean;
//     readonly rollout?: number;
//   };
// };

// /* --------------------------------------------
//    Client Creator
// -------------------------------------------- */

// export function createClient<T extends FlagMap>(opts: { schema: T }) {
//   const raw = Object.fromEntries(
//     Object.entries(opts.schema).map(([name, def]) => [
//       name,
//       {
//         key: def.key,
//         type: def.type,
//         value: def.defaultValue,
//         defaultValue: def.defaultValue,
//         enabled: def.enabled ?? false,
//         rollout: 'rollout' in def ? def.rollout : undefined,
//       },
//     ]),
//   ) as InferFlags<T>;

//   // ✅ deep freeze
//   const flags = Object.freeze(
//     Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Object.freeze(v)])),
//   ) as InferFlags<T>;

//   function getFlag<K extends keyof T>(key: K): InferFlags<T>[K] {
//     return flags[key];
//   }

//   return {
//     flags,
//     getFlag,
//   };
// }
