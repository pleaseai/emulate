---
name: x
description: Emulated X (Twitter) API v2 for local development and testing. Use when the user needs to test X API integrations locally, run the OAuth 2.0 PKCE flow, or create and read tweets and users without hitting api.x.com.
allowed-tools: Bash(bun:*), Bash(npx @pleaseai/emulate:*), Bash(curl:*)
---

# X (Twitter) API v2 Emulator

Included now:

- OAuth 2.0 authorization code with PKCE: `/2/oauth2/authorize` (hosted consent
  page), `/2/oauth2/token`, `/2/oauth2/revoke` — confidential and public clients
- Tweets: create, delete, lookup, user timelines (`/2/tweets`, `/2/users/:id/tweets`)
- Users: `/2/users/me`, `/2/users/:id`, `/2/users/by/username/:username`
- OpenAPI subset at `/2/openapi.json`

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service x

# Or from the published package
npx @pleaseai/emulate --service x
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port.

## Auth

Run the PKCE flow against `/2/oauth2/authorize` + `/2/oauth2/token`, then call
the API with the issued token:

```bash
curl http://localhost:4000/2/users/me \
  -H "Authorization: Bearer <access_token>"
```

## Tweet Example

```bash
curl -X POST http://localhost:4000/2/tweets \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from the emulator!"}'
```

## Seed Config

Add an `x:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
x:
  users:
    - username: developer
      name: Developer
      verified: true
  oauth_clients:
    - client_id: x_client_id_example
      client_secret: x_client_secret_example
      client_type: confidential
      redirect_uris:
        - http://localhost:3000/api/auth/callback/x
  tweets:
    - text: Hello from the emulator!
      author: developer
```
