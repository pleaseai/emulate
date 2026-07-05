---
title: Architecture
description: How the emulate monorepo is structured — the core plugin system, in-memory store, and shared middleware.
sidebar:
  order: 1
---

```
packages/
  emulate/          # @pleaseai/emulate — CLI (commander) + programmatic API
  kakao/            # @pleaseai/emulate-kakao — kauth OAuth + kapi user/talk
  naver/            # @pleaseai/emulate-naver — Naver Login OAuth + profile
  toss-payments/    # @pleaseai/emulate-toss-payments — payments + webhooks
  firebase/         # @pleaseai/emulate-firebase — Auth, Secure Token, FCM v1
  supabase/         # @pleaseai/emulate-supabase — GoTrue + PostgREST
  asana/            # @pleaseai/emulate-asana — REST API v1.0
  linear/           # @pleaseai/emulate-linear — GraphQL (read-only)
  autumn/           # @pleaseai/emulate-autumn — billing
  gitlab/           # @pleaseai/emulate-gitlab — GraphQL with introspection
  posthog/          # @pleaseai/emulate-posthog — capture + read API + OAuth
  spotify/          # @pleaseai/emulate-spotify — token + catalog
  workos/           # @pleaseai/emulate-workos — User Management + Vault
  x/                # @pleaseai/emulate-x — X API v2
docs/
  EMULATOR-CONVENTIONS.md   # guide for adding new emulators
website/            # this documentation site (Astro Starlight)
```

Every service emulator follows the `@emulators/*` patterns from
[vercel-labs/emulate](https://github.com/vercel-labs/emulate) and depends on
[`@emulators/core`](https://www.npmjs.com/package/@emulators/core) from npm.
The runtime and package manager is [bun](https://bun.sh); task orchestration
is Turborepo; builds are tsup.

## Core

`@emulators/core` provides a generic `Store` with typed `Collection<T>`
instances supporting CRUD, indexing, filtering, and pagination. Each service
plugin registers its routes with the shared internal app (Hono-style
handlers) and uses the store for state.

## Plugin system

Each service is a `ServicePlugin` that:

1. Defines its entity types and store collections (`entities.ts`, `store.ts`)
2. Registers HTTP routes with the shared internal app (`routes/*.ts`)
3. Provides a `seed()` for minimal defaults and a `seedFromConfig()` that
   consumes its section of `emulate.config.yaml`
4. Uses shared middleware for auth, error handling, and webhooks

The CLI's registry (`packages/emulate/src/registry.ts`) lazily loads each
plugin, so starting one service does not import the other twelve. Multiple
services run simultaneously, each on its own port (auto-incremented from the
base port).

## In-memory state

All state is held in memory with no database. This makes the emulators fast,
easy to reset, and ideal for CI pipelines. State is populated from the seed
config on startup and mutated by API calls during a test run; `reset()`
restores the seeded snapshot.

## Webhooks

Core ships a `WebhookDispatcher`. Services dispatch events with
`webhooks.dispatch(event, undefined, payload, "<service>")`, and seed configs
can register subscriptions declaratively (`webhooks: [{ url, events }]`).

## Fidelity rules

- Response JSON field names and formats match the real service exactly
  (snake_case/camelCase per service).
- Error responses follow each real service's error format.
- Intentional divergences (unsigned JWTs, no Supabase RLS) are documented in
  [Authentication](/guides/authentication/).
