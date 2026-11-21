# emulate

[![CI](https://github.com/pleaseai/emulate/actions/workflows/ci.yml/badge.svg)](https://github.com/pleaseai/emulate/actions/workflows/ci.yml)
[![codecov](https://codecov.io/github/pleaseai/emulate/graph/badge.svg)](https://codecov.io/github/pleaseai/emulate)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_emulate&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pleaseai_emulate)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_emulate&metric=coverage)](https://sonarcloud.io/summary/new_code?id=pleaseai_emulate)
[![npm version](https://img.shields.io/npm/v/@pleaseai/emulate.svg)](https://www.npmjs.com/package/@pleaseai/emulate)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Local drop-in replacement services for CI and no-network sandboxes.
Fully stateful, production-fidelity API emulation for Korean services
(Kakao, Naver, Toss Payments) and BaaS platforms (Firebase, Supabase).

**Documentation: [emulate.pleaseai.dev](https://emulate.pleaseai.dev)**

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
| `autumn` | 4007 | Autumn billing: customers, balances track/check, plans, billing attach, hosted checkout (autumn-js compatible) |
| `gitlab` | 4008 | GitLab GraphQL endpoint with real-schema introspection |
| `posthog` | 4009 | Event capture, projects/events/users read API, OAuth 2.0 with dynamic client registration |
| `spotify` | 4010 | OAuth 2.0 client credentials token, catalog search, artists, albums, tracks |
| `workos` | 4011 | User Management, organizations, memberships, invitations, API keys, OAuth/OIDC, Vault KV (@workos-inc/node compatible) |
| `x` | 4012 | X API v2: OAuth 2.0 PKCE, tweets, users, timelines |
| `jira` | 4013 | Jira Cloud REST API v2/v3, JQL search, issues, transitions, comments, Agile boards and sprints, webhooks, OAuth 2.0 (3LO) (jira.js compatible) |
| `tossinvest` | 4014 | Toss Invest Open API: client credentials token, market data, sectors, accounts, holdings, orders, conditional orders |

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

# Serve over HTTPS via portless (requires `portless proxy start`)
bun packages/emulate/dist/index.js --portless
```

With `--portless`, each service registers a [portless](https://github.com/vercel-labs/portless)
alias and gets a trusted HTTPS URL like `https://kakao.emulate.localhost`.
For other proxies, `--base-url` / `EMULATE_BASE_URL` support `{service}`
interpolation (e.g. `--base-url "https://{service}.myproxy.test"`).

When an `emulate.config.yaml` (or `--seed <file>`) is present, the emulators
start pre-seeded with app keys, users, and table data. Only the services
present in the config are started.

## Running with the vercel-labs emulators (`emulate:all`)

`bun run emulate:all` starts this repo's services and the upstream
[vercel-labs/emulate](https://github.com/vercel-labs/emulate) `@emulators/*`
services together in one process. This repo's services keep the ports listed
above. The vercel-labs services use their own range from 4100:

| Service | Default port | Service | Default port |
| --- | --- | --- | --- |
| `vercel` | 4100 | `aws` | 4107 |
| `github` | 4101 | `resend` | 4108 |
| `google` | 4102 | `stripe` | 4109 |
| `slack` | 4103 | `clerk` | 4110 |
| `apple` | 4104 | `mongoatlas` | 4111 |
| `microsoft` | 4105 | `ai` | 4112 |
| `okta` | 4106 | `twilio` | 4113 |

`ai` is a deterministic OpenAI (Chat Completions, Responses) and Anthropic
Messages emulator: rules script the replies, so the same request returns the
same answer on every run. `twilio` emulates Twilio Messaging, Voice, Verify,
and Conversations.

```bash
bun run build
bun run emulate:all                                 # every service
bun run emulate:all -- --service kakao,ai,twilio    # a subset
bun run emulate:all -- --port 5000 --vercel-port 6000

# Point the OpenAI SDK at http://localhost:4112/v1 or the Anthropic SDK at http://localhost:4112
curl -X POST http://localhost:4112/v1/chat/completions \
  -H "Authorization: Bearer sk-test" -H "content-type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'

# Send an SMS with the default test account
curl -X POST http://localhost:4113/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json \
  -u AC00000000000000000000000000000000:twilio_test_auth_token \
  --data-urlencode "To=+15559876543" --data-urlencode "From=+15551234567" \
  --data-urlencode "Body=hello"
```

Each service's port comes from its fixed place in the catalog, so starting a
subset never renumbers anything. Without `--vercel-port` (or
`EMULATE_VERCEL_PORT`), the vercel-labs range starts 100 above `--port`. With
an `emulate.config.yaml` (or `--config <file>`), only the services keyed in it
start, and their sections seed them. If the config has no recognized service
keys, every service starts. An explicit `--service` list overrides the config.

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

### Toss Invest trading

```bash
# Issue an access token
curl -X POST http://localhost:4014/oauth2/token \
  -d grant_type=client_credentials \
  -d client_id=tsck_example_client_id \
  -d client_secret=tsck_example_client_secret

# Buy 10 shares at market; the order fills at the current price
curl -X POST http://localhost:4014/api/v1/orders \
  -H "Authorization: Bearer <access_token>" \
  -H "X-Tossinvest-Account: 1" \
  -H "content-type: application/json" \
  -d '{"symbol":"005930","side":"BUY","orderType":"MARKET","quantity":"10"}'

# Check holdings
curl http://localhost:4014/api/v1/holdings \
  -H "Authorization: Bearer <access_token>" \
  -H "X-Tossinvest-Account: 1"
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

## Use with upstream emulate

Every service is also a [custom emulator](https://emulate.dev/docs/custom-emulators)
for [vercel-labs/emulate](https://github.com/vercel-labs/emulate) 0.12+, so you
can run it next to upstream's GitHub, Stripe, and other built-ins from one
config file:

```yaml
services:
  kakao:
    emulator: '@pleaseai/emulate/emulators/kakao'
    port: 4100
  github:
    emulator: github
    port: 4102
```

See the [guide](https://emulate.pleaseai.dev/guides/emulate-dev/) and the
[sample config](./examples/emulate-dev/emulate.config.yaml).

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
  autumn/           # @pleaseai/emulate-autumn
  gitlab/           # @pleaseai/emulate-gitlab
  posthog/          # @pleaseai/emulate-posthog
  spotify/          # @pleaseai/emulate-spotify
  workos/           # @pleaseai/emulate-workos
  x/                # @pleaseai/emulate-x
  jira/             # @pleaseai/emulate-jira
  tossinvest/       # @pleaseai/emulate-tossinvest
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
