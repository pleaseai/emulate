---
title: Firebase
description: "Emulated Firebase Auth (Identity Toolkit + Secure Token) and FCM v1 for local development and testing."
sidebar:
  label: Firebase
  order: 4
---

:::note
Default port **4003** · Package [`@pleaseai/emulate-firebase`](https://www.npmjs.com/package/@pleaseai/emulate-firebase)
:::

A stateful emulator for Firebase Authentication and Cloud Messaging.

Included now:

- Identity Toolkit REST: `signUp`, `signInWithPassword`, `lookup`, `update`,
  `delete`, `sendOobCode`
- Secure Token: refresh ID tokens (`POST /v1/token`)
- FCM v1: `POST /v1/projects/<projectId>/messages:send`

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service firebase

# Or from the published package
npx @pleaseai/emulate --service firebase
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port (firebase's slot is `4003`).

Point a Firebase SDK at the emulator with
`FIREBASE_AUTH_EMULATOR_HOST=localhost:4000`.

## Auth

- Identity Toolkit and Secure Token take the API key as a query param:
  `?key=<api_key>`.
- FCM `messages:send` requires `Authorization: Bearer <token>` (presence only —
  the token is not cryptographically verified).

The `googleapis.com`-prefixed path variants are also accepted, e.g.
`/identitytoolkit.googleapis.com/v1/accounts:signUp` and
`/securetoken.googleapis.com/v1/token`.

## Flow

```bash
# 1. Sign up with email + password
curl -X POST "http://localhost:4000/v1/accounts:signUp?key=firebase_api_key_example" \
  -H "Content-Type: application/json" \
  -d '{"email":"hong@example.com","password":"password123","returnSecureToken":true}'
# → {"idToken":"...","refreshToken":"...","expiresIn":"3600","localId":"..."}

# 2. Sign in with email + password
curl -X POST "http://localhost:4000/v1/accounts:signInWithPassword?key=firebase_api_key_example" \
  -H "Content-Type: application/json" \
  -d '{"email":"hong@example.com","password":"password123","returnSecureToken":true}'

# 3. Refresh the ID token
curl -X POST "http://localhost:4000/v1/token?key=firebase_api_key_example" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"refresh_token","refresh_token":"<refreshToken>"}'

# 4. Send an FCM message
curl -X POST "http://localhost:4000/v1/projects/demo-project/messages:send" \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"message":{"token":"<device_token>","notification":{"title":"Hi","body":"World"}}}'
```

Inspect emulator state (no auth) at `GET /internal/messages` and
`GET /internal/oob_codes`.

## Seed Config

Add a `firebase:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
firebase:
  projects:
    - project_id: demo-project
      api_key: firebase_api_key_example
  users:
    - email: hong@example.com
      password: password123
      display_name: 홍길동
```
