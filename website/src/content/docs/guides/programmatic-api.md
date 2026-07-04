---
title: Programmatic API
description: Use @pleaseai/emulate as a library — createEmulator, reset, and close for test suites.
sidebar:
  order: 3
---

Besides the CLI, `@pleaseai/emulate` exports a programmatic API for embedding
emulators directly in a test suite.

## createEmulator

```ts
import { createEmulator } from '@pleaseai/emulate'

const emulator = await createEmulator({
  service: 'supabase',
  port: 4004,
  seed: {
    supabase: {
      anon_key: 'test-anon-key',
      tables: { todos: [{ id: 1, title: 'Buy groceries', completed: false }] },
    },
  },
})

// emulator.url → "http://localhost:4004"
// ... run your tests

emulator.reset() // restore seeded state
await emulator.close() // shut down the HTTP server
```

### Options

| Option | Type | Description |
| --- | --- | --- |
| `service` | `ServiceName` | Which emulator to start (`'kakao'`, `'supabase'`, …) — one per instance |
| `port` | `number` | Port to listen on (default `4000`) |
| `seed` | `SeedConfig` | Same shape as `emulate.config.yaml` — a per-service section plus optional `tokens` |
| `baseUrl` | `string` | Override the advertised base URL (useful behind a proxy) |

### Instance methods

| Member | Description |
| --- | --- |
| `url` | Base URL the emulator is reachable at |
| `reset()` | Clears the in-memory store and re-applies the seed — call between tests |
| `close()` | Stops the HTTP server; resolves when the port is released |

## Test-runner setup (bun:test / Vitest / Jest)

Start the emulator once per file (or in a global setup), reset between tests:

```ts
import { afterAll, beforeAll, beforeEach } from 'bun:test'
import { createEmulator, type Emulator } from '@pleaseai/emulate'

let emulator: Emulator

beforeAll(async () => {
  emulator = await createEmulator({ service: 'kakao', port: 4000 })
})

beforeEach(() => emulator.reset())

afterAll(() => emulator.close())
```

`reset()` is synchronous and cheap (in-memory only), so per-test resets add
no meaningful overhead.

## Testing routes without a port

Service plugins can also be exercised entirely in-process through
`app.fetch`, with no port bound at all — this is how the emulators' own test
suites run:

```ts
import { createServer } from '@emulators/core'
import { kakaoPlugin } from '@pleaseai/emulate-kakao'

const { app, store } = createServer(kakaoPlugin, { port: 4000 })
kakaoPlugin.seed?.(store, 'http://localhost:4000')

const res = await app.fetch(new Request('http://localhost:4000/v2/user/me'))
```
