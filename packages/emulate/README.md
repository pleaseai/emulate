# @pleaseai/emulate

Local drop-in replacement services for CI and no-network sandboxes — the
`emulate` CLI and programmatic API that run every `@pleaseai/emulate-*`
service emulator.

**Documentation: [emulate.pleaseai.dev](https://emulate.pleaseai.dev)**

## Install

```bash
npm install --save-dev @pleaseai/emulate
```

Install 0.4.1 or later. 0.4.0 and 0.3.1 depend on service package versions
that were never published, so they fail to install.

## Start

```bash
# Start every service (ports assigned sequentially from 4000)
npx @pleaseai/emulate

# Start specific services only
npx @pleaseai/emulate --service kakao,tosspayments

# Generate a seed config file
npx @pleaseai/emulate init
```

When an `emulate.config.yaml` (or `--seed <file>`) is present, the emulators
start pre-seeded with app keys, users, and table data. `--service` chooses
which services start. Without it, the services named in the config start;
if the config names no recognized services, every service starts.

## Programmatic use in tests

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

// ... run your tests. emulator.reset() restores seeded state, emulator.close() shuts down.
```

See the [repository README](https://github.com/pleaseai/emulate#readme) for
the list of supported services and their default ports.
