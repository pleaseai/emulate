# emulate

[![CI](https://github.com/pleaseai/emulate/actions/workflows/ci.yml/badge.svg)](https://github.com/pleaseai/emulate/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/pleaseai/emulate/graph/badge.svg)](https://codecov.io/github/pleaseai/emulate)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_emulate&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pleaseai_emulate)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_emulate&metric=coverage)](https://sonarcloud.io/summary/new_code?id=pleaseai_emulate)

Local drop-in replacement services for CI and no-network sandboxes.
Fully stateful, production-fidelity API emulation for Korean services
(Kakao, Naver, Toss Payments) and BaaS platforms (Firebase, Supabase).

Built on the architecture of [vercel-labs/emulate](https://github.com/vercel-labs/emulate),
using [`@emulators/core`](https://www.npmjs.com/package/@emulators/core).

## Supported services

| Service | Default port | Emulated surface |
| --- | --- | --- |
| `kakao` | 4000 | OAuth 2.0 (kauth), user API, KakaoTalk self-memo send (kapi) |
| `naver` | 4001 | Naver Login OAuth (issue/refresh/delete), profile API (`/v1/nid/me`) |
| `tosspayments` | 4002 | Payment confirm/lookup/cancel, order lookup, checkout simulation, webhooks |
| `firebase` | 4003 | Auth (Identity Toolkit REST), Secure Token, FCM v1 |
| `supabase` | 4004 | GoTrue Auth (signup/token/user), PostgREST table CRUD + filters |
| `asana` | 4005 | Workspaces, teams, projects, sections, tasks, tags, stories, webhooks (REST API v1.0) |
| `linear` | 4006 | Linear GraphQL API (read-only): issues, projects, teams, users, orgs, labels, workflow states, Relay pagination |

## Getting started

Tool versions are pinned with [mise](https://mise.jdx.dev) — `mise install`
provisions bun and node. (Without mise, any recent bun works.)

```bash
mise install
bun install
bun run build

# Start every service (ports assigned sequentially from 4000)
bun packages/emulate/dist/index.js

# Start specific services only
bun packages/emulate/dist/index.js --service kakao,tosspayments

# Generate a seed config file
bun packages/emulate/dist/index.js init
```

When an `emulate.config.yaml` (or `--seed <file>`) is present, the emulators
start pre-seeded with app keys, users, and table data. Only the services
present in the config are started.

## Usage examples

### Kakao OAuth flow

```bash
# 1. Authorization code (in CI, ?user_id= auto-approves without the login page)
curl -i "http://localhost:4000/oauth/authorize?client_id=kakao_rest_api_key_example\
&redirect_uri=http://localhost:3000/api/auth/callback/kakao&response_type=code&user_id=1001"

# 2. Exchange the code for tokens
curl -X POST http://localhost:4000/oauth/token \
  -d "grant_type=authorization_code&client_id=kakao_rest_api_key_example&code=<code>"

# 3. Fetch the user profile
curl http://localhost:4000/v2/user/me -H "Authorization: Bearer <access_token>"
```

### Toss Payments confirmation

```bash
# Create a payment (replaces the payment-widget step of the real service)
curl -X POST http://localhost:4002/internal/payments \
  -H "content-type: application/json" \
  -d '{"orderId":"order-1","orderName":"Test order","amount":11000}'

# Confirm it
curl -X POST http://localhost:4002/v1/payments/confirm \
  -H "Authorization: Basic $(echo -n 'test_sk_example:' | base64)" \
  -H "content-type: application/json" \
  -d '{"paymentKey":"<paymentKey>","orderId":"order-1","amount":11000}'
```

### Programmatic use in tests

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

To point an SDK at an emulator, only the base URL needs to change.
For example: `FIREBASE_AUTH_EMULATOR_HOST=localhost:4003`, or a Supabase client
created with `createClient("http://localhost:4004", anonKey)`.

## Package layout

```
packages/
  emulate/          # @pleaseai/emulate — CLI + programmatic API
  kakao/            # @pleaseai/emulate-kakao
  naver/            # @pleaseai/emulate-naver
  toss-payments/    # @pleaseai/emulate-toss-payments
  firebase/         # @pleaseai/emulate-firebase
  supabase/         # @pleaseai/emulate-supabase
  asana/            # @pleaseai/emulate-asana
  linear/           # @pleaseai/emulate-linear
docs/
  EMULATOR-CONVENTIONS.md   # guide for adding new emulators
```

Runtime/package manager is [bun](https://bun.sh); task orchestration is Turborepo;
linting is [@pleaseai/eslint-config](https://github.com/pleaseai/code-style).

```bash
bun run test        # all tests (bun:test)
bun run type-check  # all type checks
bun run lint        # eslint (use lint:fix to auto-fix)
bun run build       # all builds (tsup)

mise run ci         # lint + type-check + test + build
```

## Adding a new service

Follow [docs/EMULATOR-CONVENTIONS.md](docs/EMULATOR-CONVENTIONS.md) to create a
`packages/<service>/` package, then register it in `packages/emulate/src/registry.ts`.

## Intentional simplifications

- Tokens/JWTs are unsigned (validated via store lookup) — public-key verification
  against the emulator is not possible
- Supabase RLS is not emulated (anon and service_role get identical access)
- Rate limiting is core's default only (5,000 requests/hour)

## License

Apache-2.0
