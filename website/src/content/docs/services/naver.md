---
title: Naver
description: "Emulated Naver API (nid OAuth + openapi profile) for local development and testing."
sidebar:
  label: Naver
  order: 2
---

:::note
Default port **4001** · Package [`@pleaseai/emulate-naver`](https://www.npmjs.com/package/@pleaseai/emulate-naver)
:::

A stateful emulator for Naver Login (`nid`) OAuth 2.0 and the profile openapi.

Included now:

- OAuth 2.0 token endpoint: issue (`authorization_code`), `refresh_token`,
  and `delete` (token revocation) grants
- Profile API `GET /v1/nid/me` and token check `GET /v1/nid/verify`

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service naver

# Or from the published package
npx @pleaseai/emulate --service naver
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port (naver's slot is `4001`).

## Auth

- OAuth token operations authenticate with `client_id` (and `client_secret`
  if configured).
- Profile calls use `Authorization: Bearer <access_token>`.
- OAuth/token errors are returned with HTTP 200 and an
  `{"error":"...","error_description":"..."}` body (Naver convention).

## Flow

```bash
# 1. Authorization code — in CI, ?user= auto-approves without the login page
curl -i "http://localhost:4000/oauth2.0/authorize?response_type=code\
&client_id=naver_client_id_example&redirect_uri=http://localhost:3000/api/auth/callback/naver\
&state=abc123&user=<seeded_user_id>"
# → redirect with Location: .../callback?code=<code>&state=abc123

# 2. Exchange the code for tokens
curl -X POST http://localhost:4000/oauth2.0/token \
  -d "grant_type=authorization_code&client_id=naver_client_id_example\
&client_secret=naver_client_secret_example&code=<code>&state=abc123"
# → {"access_token":"...","refresh_token":"...","token_type":"bearer","expires_in":"3600"}

# 3. Fetch the user profile
curl http://localhost:4000/v1/nid/me -H "Authorization: Bearer <access_token>"

# 4. Revoke the token
curl -X POST http://localhost:4000/oauth2.0/token \
  -d "grant_type=delete&client_id=naver_client_id_example\
&access_token=<access_token>&service_provider=NAVER"
```

The token endpoint accepts both `GET` query params and `POST` form bodies.

## Seed Config

Add a `naver:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
naver:
  apps:
    - client_id: naver_client_id_example
      client_secret: naver_client_secret_example
      callback_urls: [http://localhost:3000/api/auth/callback/naver]
  users:
    - name: 홍길동
      nickname: gildong
      email: hong@example.com
      gender: M
      birthyear: '1990'
      mobile: 010-1234-5678
```
