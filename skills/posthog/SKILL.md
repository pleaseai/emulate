---
name: posthog
description: Emulated PostHog analytics API for local development and testing. Use when the user needs to test PostHog integrations locally, capture events, read projects/events via the private API, or exercise PostHog's OAuth 2.0 flow without hitting app.posthog.com.
allowed-tools: Bash(bun:*), Bash(npx @pleaseai/emulate:*), Bash(curl:*)
---

# PostHog Analytics API Emulator

Included now:

- Event capture and per-project event reads (`/api/projects/:id/events`)
- `/api/projects` and `/api/users/@me`
- OAuth 2.0: dynamic client registration (`/oauth/register`), authorize/token
- RFC 8414 and OIDC discovery documents
- OpenAPI subset at `/openapi.json`

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service posthog

# Or from the published package
npx @pleaseai/emulate --service posthog
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port.

## Auth

Use a seeded project API token (or a personal API key) as a bearer token.

```bash
curl http://localhost:4000/api/projects \
  -H "Authorization: Bearer phc_test_token"
```

## Read Example

```bash
curl "http://localhost:4000/api/projects/1/events" \
  -H "Authorization: Bearer phc_test_token"
```

## Seed Config

Add a `posthog:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
posthog:
  users:
    - email: dev@example.com
      name: Developer
  projects:
    - name: Demo Project
      api_token: phc_test_token
  events:
    - event: $pageview
      distinct_id: user-1
  oauth_clients:
    - client_id: posthog-client
      client_secret: posthog-secret
      redirect_uris:
        - http://localhost:3000/callback
```
