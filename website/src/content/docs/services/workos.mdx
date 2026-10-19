---
title: WorkOS
description: "Emulated WorkOS API for local development and testing."
sidebar:
  label: WorkOS
  order: 12
---

:::note
Default port **4011** · Package [`@pleaseai/emulate-workos`](https://www.npmjs.com/package/@pleaseai/emulate-workos)
:::

Included now:

- User Management: authenticate, users, organization memberships, invitations, user API keys
- Organizations and organization domains
- API key validation (`/api_keys/validations`)
- OAuth 2.0 / OIDC: hosted authorize pages, dynamic client registration,
  token exchange (RFC 8693 id-jag), JWKS, discovery metadata
- Vault KV (`/vault/v1/kv`)
- Admin portal link generation

JWTs are signed with a real key (via `jose`) and verify against `/oauth2/jwks`.

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service workos

# Or from the published package
npx @pleaseai/emulate --service workos
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port.

## Auth

Any `sk_`-prefixed bearer token is accepted as the API key.

```ts
import { WorkOS } from '@workos-inc/node'

const workos = new WorkOS('sk_test_emulate', { apiHostname: 'localhost', port: 4000, https: false })
```

```bash
curl http://localhost:4000/user_management/organization_memberships \
  -H "Authorization: Bearer sk_test_emulate"
```

## Seed Config

Add a `workos:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
workos:
  users:
    - email: dev@example.com
      first_name: Dev
      last_name: Eloper
  organizations:
    - name: Demo Org
      members:
        - dev@example.com
  oauth:
    default_access_token_ttl_seconds: 3600
```
