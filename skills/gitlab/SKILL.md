---
name: gitlab
description: Emulated GitLab GraphQL API for local development and testing. Use when the user needs to test GitLab GraphQL clients locally, run schema introspection, or validate codegen against the real GitLab schema without hitting gitlab.com.
allowed-tools: Bash(bun:*), Bash(npx @pleaseai/emulate:*), Bash(curl:*)
---

# GitLab GraphQL API Emulator

Serves `POST /api/graphql` backed by the real GitLab schema SDL.

Included now:

- `POST /api/graphql`
- Full GraphQL schema introspection against the real GitLab SDL
- Query validation against the schema

Query resolvers and seed data are follow-up work — today the emulator is
enough for clients that build against the schema (codegen, IDE tooling,
connection smoke tests).

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service gitlab

# Or from the published package
npx @pleaseai/emulate --service gitlab
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port.

## Query Example

```bash
curl http://localhost:4000/api/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { queryType { name } } }"}'
```

## Seed Config

The GitLab emulator takes no seed data yet:

```yaml
gitlab: {}
```
