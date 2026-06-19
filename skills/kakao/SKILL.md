---
name: kakao
description: Emulated Kakao API (kauth OAuth + kapi user/talk) for local development and testing. Use when the user needs to test Kakao Login locally, run the OAuth 2.0 flow, fetch a Kakao user profile, send a KakaoTalk self-memo, or avoid hitting the real Kakao API.
allowed-tools: Bash(bun:*), Bash(npx @pleaseai/emulate:*), Bash(curl:*)
---

# Kakao API Emulator

A stateful emulator for Kakao's `kauth` (OAuth 2.0) and `kapi` (user/talk) APIs.

Included now:

- OAuth 2.0 authorize + token (authorization_code and refresh_token grants)
- User API: `/v2/user/me`, access-token info, logout, unlink
- KakaoTalk self-memo send (`/v2/api/talk/memo/default/send`)

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service kakao

# Or from the published package
npx @pleaseai/emulate --service kakao
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port (kakao's slot is `4000`).

## Auth

- OAuth token exchange authenticates with `client_id` (and `client_secret` if
  the app is configured with one).
- `kapi` calls (user/talk) use `Authorization: Bearer <access_token>`.

## Flow

```bash
# 1. Authorization code — in CI, ?user_id= auto-approves without the login page
curl -i "http://localhost:4000/oauth/authorize?client_id=kakao_rest_api_key_example\
&redirect_uri=http://localhost:3000/api/auth/callback/kakao&response_type=code&user_id=1001"
# → redirect with Location: .../callback?code=<code>

# 2. Exchange the code for tokens
curl -X POST http://localhost:4000/oauth/token \
  -d "grant_type=authorization_code&client_id=kakao_rest_api_key_example&code=<code>\
&redirect_uri=http://localhost:3000/api/auth/callback/kakao"
# → {"token_type":"bearer","access_token":"...","refresh_token":"...","expires_in":21599}

# 3. Fetch the user profile
curl http://localhost:4000/v2/user/me -H "Authorization: Bearer <access_token>"

# 4. Send a KakaoTalk self-memo (template_object is a JSON-encoded string)
curl -X POST http://localhost:4000/v2/api/talk/memo/default/send \
  -H "Authorization: Bearer <access_token>" \
  -d 'template_object={"object_type":"text","text":"Hello from the emulator"}'
```

Inspect sent memos (no auth) at `GET /internal/talk/memos`.

## Seed Config

Add a `kakao:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
kakao:
  apps:
    - client_id: kakao_rest_api_key_example
      client_secret: kakao_client_secret_example
      redirect_uris: [http://localhost:3000/api/auth/callback/kakao]
  users:
    - user_id: 1001
      nickname: 홍길동
      email: hong@example.com
      profile_image_url: https://k.kakaocdn.net/dn/profile.jpg
```
