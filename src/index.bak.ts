// import { FlagDefinition, FlagMap } from '@voidflag/schema';

// export class VoidFlagError extends Error {
//   constructor(message: string) {
//     super(message);
//     this.name = 'VoidFlagError';
//   }
// }

// /* --------------------------------------------
//    Type Helpers
// -------------------------------------------- */

// type InferFlagValue<F extends FlagDefinition> = F extends { type: 'BOOLEAN' }
//   ? boolean
//   : F extends { type: 'STRING' }
//     ? string
//     : F extends { type: 'NUMBER' }
//       ? number
//       : F extends { type: 'KILLSWITCH' }
//         ? boolean
//         : never;

// /* --------------------------------------------
//    Runtime Flag Shape
// -------------------------------------------- */

// export type RuntimeFlag<F extends FlagDefinition> = {
//   type: F['type'];

//   value: InferFlagValue<F>;
//   fallback: InferFlagValue<F>;

//   enabled: boolean;

//   rollout?: number;
// };

// /* --------------------------------------------
//    Node Shapes (Compile-time Correct)
// -------------------------------------------- */

// type KillSwitchNode = {
//   enabled: boolean;
// };

// type BooleanNode = {
//   value: boolean;
//   fallback: boolean;
//   enabled: boolean;
// };

// type VariantNode<T> = {
//   value: T;
//   fallback: T;
//   enabled: boolean;
//   rollout: number;
// };

// type NodeFor<F extends FlagDefinition> = F extends { type: 'KILLSWITCH' }
//   ? KillSwitchNode
//   : F extends { type: 'BOOLEAN' }
//     ? BooleanNode
//     : VariantNode<InferFlagValue<F>>;

// /* --------------------------------------------
//    Accessor Shape

//    A stable object reference whose properties
//    are live getters delegating to the store.
//    The type mirrors NodeFor<F> exactly so
//    callers get the same narrowed shape.
// -------------------------------------------- */

// export type Accessor<F extends FlagDefinition> = Readonly<NodeFor<F>>;
// export type Snapshot<F extends FlagDefinition> = Readonly<NodeFor<F>>;
// /* --------------------------------------------
//    VoidClient
// -------------------------------------------- */

// export class VoidClient<S extends FlagMap> {
//   private store: {
//     [K in keyof S]: RuntimeFlag<S[K]>;
//   };

//   // One stable accessor object per flag key, created lazily on first call.
//   private accessorCache: Partial<{
//     [K in keyof S]: Accessor<S[K]>;
//   }> = {};

//   constructor(schema: S) {
//     this.store = {} as {
//       [K in keyof S]: RuntimeFlag<S[K]>;
//     };

//     for (const key in schema) {
//       const def = schema[key];

//       this.store[key] = {
//         type: def.type,
//         value: def.default as InferFlagValue<typeof def>,
//         fallback: def.default as InferFlagValue<typeof def>,
//         enabled: true,
//       };
//     }
//   }

//   /* --------------------------------------------
//      Typed Flag Access (No rollout on BOOLEAN)
//   -------------------------------------------- */

//   private _get<K extends keyof S>(key: K): NodeFor<S[K]> {
//     const f = this.store[key];

//     if (f.type === 'KILLSWITCH') {
//       return { enabled: f.enabled } as NodeFor<S[K]>;
//     }

//     if (f.type === 'BOOLEAN') {
//       return {
//         value: f.enabled ? f.value : f.fallback,
//         fallback: f.fallback,
//         enabled: f.enabled,
//       } as NodeFor<S[K]>;
//     }

//     return {
//       value: f.enabled ? f.value : f.fallback,
//       fallback: f.fallback,
//       enabled: f.enabled,
//       rollout: f.rollout ?? 100,
//     } as NodeFor<S[K]>;
//   }

//   enabled<K extends keyof S>(keys: K[]): boolean {
//     return keys.every((k) => this.store[k].enabled);
//   }

//   get<K extends keyof S>(key: K): InferFlagValue<S[K]> {
//     const f = this.store[key];

//     if (!f) {
//       throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
//     }

//     // killswitch = enabled itself
//     if (f.type === 'KILLSWITCH') {
//       return f.enabled as InferFlagValue<S[K]>;
//     }

//     return (f.enabled ? f.value : f.fallback) as InferFlagValue<S[K]>;
//   }

//   // accessor()

//   //    Returns a stable object whose getters read
//   //    live from the store on every property access.
//   //    Subsequent calls with the same key return the
//   //    exact same object reference — no new allocation.

//   //    Usage:
//   //      const flag = client.accessor('dark-mode');
//   //      flag.enabled  // always current
//   //      flag.value    // always current
//   /**
//    * Returns a stable live reference to the flag.
//    * The same object is returned on every call — reads are always current.
//    * For a one-time snapshot, use snapshot() instead.
//    */
//   flag<K extends keyof S>(key: K): Accessor<S[K]> {
//     if (this.accessorCache[key] !== undefined) {
//       return this.accessorCache[key]!;
//     }

//     const node = {} as NodeFor<S[K]>;

//     // ✅ Capture runtime object ONCE
//     const runtime = this.store[key];
//     if (!runtime) {
//       throw new VoidFlagError(`Flag "${String(key)}" does not exist`);
//     }
//     const flagType = runtime.type;

//     Object.defineProperty(node, 'enabled', {
//       get(): boolean {
//         return runtime.enabled;
//       },
//       enumerable: true,
//     });

//     if (flagType !== 'KILLSWITCH') {
//       Object.defineProperty(node, 'value', {
//         get() {
//           return runtime.enabled ? runtime.value : runtime.fallback;
//         },
//         enumerable: true,
//       });

//       Object.defineProperty(node, 'fallback', {
//         get() {
//           return runtime.fallback;
//         },
//         enumerable: true,
//       });
//     }

//     if (flagType !== 'KILLSWITCH' && flagType !== 'BOOLEAN') {
//       Object.defineProperty(node, 'rollout', {
//         get() {
//           return runtime.rollout ?? 100;
//         },
//         enumerable: true,
//       });
//     }

//     Object.freeze(node);

//     this.accessorCache[key] = node as Accessor<S[K]>;
//     return node as Accessor<S[K]>;
//   }

//   private hydrate<K extends keyof S>(key: K, data: Partial<RuntimeFlag<S[K]>>) {
//     Object.assign(this.store[key], data);
//   }

//   snapshot<K extends keyof S>(key: K): Snapshot<S[K]> {
//     return Object.freeze({ ...this._get(key) });
//   }
//   debug(): Record<keyof S, Snapshot<S[keyof S]>> {
//     return Object.fromEntries(
//       Object.keys(this.store).map((k) => [k, this.snapshot(k as keyof S)]),
//     ) as Record<keyof S, Snapshot<S[keyof S]>>;
//   }
//   private clearCache(key?: keyof S) {
//     if (key) delete this.accessorCache[key];
//     else this.accessorCache = {};
//   }

//   dispose() {
//     this.clearCache();
//     this.store = {} as {
//       [K in keyof S]: RuntimeFlag<S[K]>;
//     };
//   }
// }
