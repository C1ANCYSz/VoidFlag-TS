export type BooleanPatch = { value?: boolean; enabled?: boolean; rollout?: number };
export type StringPatch = { value?: string; enabled?: boolean; rollout?: number };
export type NumberPatch = { value?: number; enabled?: boolean; rollout?: number };
export type Patch = BooleanPatch | StringPatch | NumberPatch;
