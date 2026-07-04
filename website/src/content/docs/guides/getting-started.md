---
title: Getting Started
description: Install and run the emulate CLI — local drop-in replacements for Kakao, Naver, Toss Payments, Firebase, Supabase, and more.
sidebar:
  order: 1
---

Local drop-in replacement for Kakao, Naver, Toss Payments, Firebase, Supabase,
Asana, Linear, Autumn, GitLab, PostHog, Spotify, WorkOS, and X APIs. Built for
CI and no-network sandboxes. Fully stateful, production-fidelity API
emulation. Not mocks.

## Quick start

```bash
npx @pleaseai/emulate
```

All services start with sensible defaults — no config file needed:

| Service | Port | Emulated surface |
| --- | --- | --- |
| [Kakao](/services/kakao/) | 4000 | OAuth 2.0 (kauth), user API, KakaoTalk self-memo send (kapi) |
| [Naver](/services/naver/) | 4001 | Naver Login OAuth (issue/refresh/delete), profile API (`/v1/nid/me`) |
| [Toss Payments](/services/tosspayments/) | 4002 | Payment confirm/lookup/cancel, order lookup, checkout simulation, webhooks |
| [Firebase](/services/firebase/) | 4003 | Auth (Identity Toolkit REST), Secure Token, FCM v1 |
| [Supabase](/services/supabase/) | 4004 | GoTrue Auth (signup/token/user), PostgREST table CRUD + filters |
| [Asana](/services/asana/) | 4005 | Workspaces, teams, projects, sections, tasks, tags, stories, webhooks |
| [Linear](/services/linear/) | 4006 | Linear GraphQL API (read-only) with Relay pagination |
| [Autumn](/services/autumn/) | 4007 | Billing: customers, balances, plans, attach, hosted checkout |
| [GitLab](/services/gitlab/) | 4008 | GitLab GraphQL endpoint with real-schema introspection |
| [PostHog](/services/posthog/) | 4009 | Event capture, read API, OAuth 2.0 with dynamic client registration |
| [Spotify](/services/spotify/) | 4010 | OAuth client credentials, catalog search, artists, albums, tracks |
| [WorkOS](/services/workos/) | 4011 | User Management, organizations, OAuth/OIDC, Vault KV |
| [X](/services/x/) | 4012 | X API v2: OAuth 2.0 PKCE, tweets, users, timelines |

## CLI

```bash
# Start all services (zero-config)
npx @pleaseai/emulate

# Start specific services
npx @pleaseai/emulate --service kakao,tosspayments

# Custom base port
npx @pleaseai/emulate --port 3000

# Use a seed config file
npx @pleaseai/emulate --seed emulate.config.yaml

# Generate a starter config
npx @pleaseai/emulate init

# Generate config for a specific service
npx @pleaseai/emulate init --service kakao

# List available services
npx @pleaseai/emulate list
```

## Options

| Flag | Default | Description |
| --- | --- | --- |
| `-p, --port <port>` | `4000` | Base port (auto-increments per service) |
| `-s, --service <services>` | all | Comma-separated services to enable |
| `--seed <file>` | auto-detect | Path to seed config (YAML or JSON) |
| `--base-url <url>` | — | Override base URL (single service only) |

When a single service is started with `--service`, it runs on the base port.
When multiple services run together, ports are assigned sequentially from the
base port in registry order.

## Running from source

Tool versions are pinned with [mise](https://mise.jdx.dev) — `mise install`
provisions bun and node. (Without mise, any recent bun works.)

```bash
mise install
bun install
bun run build

# Start every service
bun packages/emulate/dist/index.js

# Start specific services only
bun packages/emulate/dist/index.js --service kakao,tosspayments
```

## Pointing your app at the emulator

To use an emulator, only the base URL your SDK talks to needs to change:

- Firebase: `FIREBASE_AUTH_EMULATOR_HOST=localhost:4003`
- Supabase: `createClient("http://localhost:4004", anonKey)`
- Everything else: set the service base URL to `http://localhost:<port>`

## Next steps

- [Configuration](/guides/configuration/) — seed apps, users, and table data from YAML
- [Programmatic API](/guides/programmatic-api/) — embed emulators in your test suite
- [Authentication](/guides/authentication/) — how tokens and OAuth flows work
