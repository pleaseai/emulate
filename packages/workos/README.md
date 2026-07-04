# @pleaseai/emulate-workos

WorkOS API emulator for local development and CI.

Covers User Management (authenticate, users, organization memberships, invitations, user API keys), Organizations, API key validation, Vault KV, the admin portal link, and a full OAuth 2.0 / OIDC surface: hosted authorize pages, dynamic client registration, token exchange (RFC 8693 id-jag), JWKS, and discovery metadata. JWTs are signed with a real key via `jose` and verify against `/oauth2/jwks`. Tested against the real `@workos-inc/node` SDK.

Ported from the [UsefulSoftwareCo/emulate](https://github.com/UsefulSoftwareCo/emulate) fork.

## Install

```bash
npm install @pleaseai/emulate-workos
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
npx @pleaseai/emulate --service workos
```

A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Auth

Any `sk_`-prefixed bearer token is accepted as the API key:

```ts
import { WorkOS } from '@workos-inc/node'

const workos = new WorkOS('sk_test_emulate', { apiHostname: 'localhost', port: 4000, https: false })
```

## Seed Config

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
