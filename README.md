# voidflag

The official TypeScript SDK for [VoidFlag](https://voidflag.vercel.app/), a schema-first feature flag and remote config platform with end-to-end type safety.

## Installation

```bash
npm install voidflag
# or
pnpm add voidflag
```

> **Node < 22**: EventSource is not built in. Install the polyfill:
>
> ```bash
> npm install eventsource
> ```

---

## Quick Start

The SDK is generated for you by the CLI (`vf generate`), which produces a typed client from your `schema.vf` file. You typically won't construct `VoidClient` manually, but if you need to, here's the shape:

```ts
import { VoidClient } from 'voidflag';

const client = new VoidClient({
  envKey: 'your-env-key',
  schema: {
    darkMode: { type: 'BOOLEAN', fallback: false },
    theme: { type: 'STRING', fallback: 'light' },
    maxItems: { type: 'NUMBER', fallback: 10 },
  },
});

// Access flags
client.flags.darkMode.value; // boolean
client.flags.theme.value; // string
client.flags.maxItems.value; // number
client.flags.darkMode.enabled; // boolean
```

---

## Local Development

In local dev, use `dev: true` instead of an `envKey`. The SDK will connect to the local dev server started by `vf dev`:

```ts
const client = new VoidClient({
  dev: true,
  schema: { ... },
});
```

If the dev server isn't running, the SDK falls back to schema defaults and retries silently in the background.

---

## Flag Access

Flags are accessed via `client.flags.<name>`, O(1) property lookups backed by an accessor cache.

```ts
const flag = client.flags.darkMode;

flag.value; // The current value, or fallback if the flag is disabled
flag.enabled; // Whether the flag is active
```

### Rollout / Gradual Releases

Check whether a specific user is included in a percentage rollout:

```ts
if (client.flags.darkMode.isRolledOutFor(userId)) {
  // user is in the rollout bucket
}
```

Rollout buckets are determined by a stable djb2 hash of `flagName:userId`, the same user always lands in the same bucket, with no server-side calls required.

---

## Snapshots

Get a point-in-time snapshot of a flag's full state:

```ts
const snap = client.snapshot('darkMode');
// { value, fallback, enabled, rollout }
```

Get snapshots of all flags at once (useful for debugging):

```ts
const all = client.debugSnapshots();
```

---

## Overriding State (Testing)

Use `applyState` to override flag values locally, useful in tests or Storybook:

```ts
client.applyState({
  darkMode: { value: true, enabled: true },
  maxItems: { value: 50 },
});
```

`applyState` is type-safe: you can only set fields that match the flag's declared type.

---

## Lifecycle Callbacks

```ts
const client = new VoidClient({
  envKey: 'your-env-key',
  schema: { ... },

  onConnect:    () => console.log('connected'),
  onDisconnect: () => console.log('connection lost'),
  onError:      (err, attempt) => console.error(`error on attempt ${attempt}`, err),
  onFallback:   () => console.warn('SSE failed, switched to polling'),
});
```

---

## Transport

The backend determines the transport based on your plan:

| Plan | Transport                                    |
| ---- | -------------------------------------------- |
| Free | HTTP Polling (10s interval)                  |
| Paid | Server-Sent Events (real-time) (coming soon) |

If SSE fails repeatedly, the SDK automatically falls back to polling with exponential backoff (full-jitter, capped at 30s). A background probe will attempt to restore SSE when connectivity recovers.

---

## Disposing

Call `dispose()` when you're done with the client to stop all transports and timers:

```ts
client.dispose();
```

Accessing flags after disposal throws a `VoidFlagError`.

---

## Utility

Check if multiple flags are all enabled:

```ts
const { flags } = client;
if (client.allEnabled(flags.darkMode, flags.newDashboard)) {
  // both flags are on
}
```

---

## Error Handling

All errors thrown by the SDK are instances of `VoidFlagError`. Import it if you need to catch specifically:

```ts
import { VoidFlagError } from 'voidflag';

try {
  client.snapshot('nonExistentFlag');
} catch (err) {
  if (err instanceof VoidFlagError) { ... }
}
```

---

## License

MIT
