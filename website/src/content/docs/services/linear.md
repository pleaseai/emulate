---
title: Linear
description: "Emulated Linear GraphQL API for local development and testing."
sidebar:
  label: Linear
  order: 7
---

:::note
Default port **4006** · Package [`@pleaseai/emulate-linear`](https://www.npmjs.com/package/@pleaseai/emulate-linear)
:::

Phase 1 provides a read only Linear GraphQL emulator.

Included now:

- `POST /graphql`
- GraphQL schema introspection
- PAT authentication with `Authorization: <api_key>`
- Query resolvers for `Issue`, `Project`, `Team`, `User`, `Organization`, `Label`, and `WorkflowState`
- Relay style pagination with `edges`, `nodes`, and `pageInfo`

Follow up work will add mutations, webhooks, OAuth 2.0, and an inspector UI.

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service linear

# Or from the published package
npx @pleaseai/emulate --service linear
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port in the order the services are selected —
when every service starts (the default), linear's is `4006`.

Default URL (linear alone):

```text
http://localhost:4000
```

## Auth

Use a seeded Linear API key as the raw `Authorization` header value.

```bash
curl http://localhost:4000/graphql \
  -H "Authorization: lin_api_test" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ viewer { id name email } }"}'
```

## Query Example

```bash
curl http://localhost:4000/graphql \
  -H "Authorization: lin_api_test" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ issues(first: 10) { nodes { id identifier title state { name } team { key } } pageInfo { hasNextPage endCursor } } }"}'
```

## Seed Config

Add a `linear:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
linear:
  api_keys: [lin_api_test]
  organizations:
    - id: org-1
      name: My Org
  teams:
    - id: team-1
      name: Engineering
      key: ENG
      organization: org-1
  workflow_states:
    - id: ws-1
      name: Todo
      type: unstarted
      team: team-1
  users:
    - id: user-1
      name: Developer
      email: dev@example.com
      organization: org-1
  issues:
    - id: issue-1
      title: First issue
      team: team-1
      state: ws-1
      assignee: user-1
```
