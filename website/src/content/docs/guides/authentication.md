---
title: Authentication
description: How tokens, OAuth flows, and the user-picker login page work across the emulators.
sidebar:
  order: 4
---

Each emulator reproduces the real service's authentication scheme — Bearer
tokens, Basic auth, `apikey` headers, or a full OAuth 2.0 flow — validated
against in-memory state rather than cryptographic signatures.

## Tokens

The top-level `tokens` section of the seed config maps fixed bearer tokens to
users:

```yaml
tokens:
  test-token:
    login: dev@example.com # matches a seeded user's email, id, or name
```

Without a `tokens` section, a default `test_token_admin` token is seeded.
Services with bearer-guarded REST APIs (Asana, for example) resolve unmatched
tokens to the first seeded user by default, so `me`-style endpoints work out
of the box:

```bash
curl http://localhost:4005/api/1.0/users/me \
  -H "Authorization: Bearer any-token"
```

## OAuth 2.0 flows

Kakao, Naver, PostHog, Spotify, WorkOS, and X implement real OAuth flows.
Access tokens issued by `/oauth/token`-style endpoints are stored in the
service's store and validated by lookup on subsequent API calls.

### The login page

Authorize endpoints render a user-picker page listing the seeded users.
Selecting a user issues an authorization code and redirects to the
`redirect_uri` — exactly like the real consent screen.

### Instant approval for CI

Every authorize endpoint also accepts a user id query parameter
(`?user_id=<id>` or `?user=<id>` depending on the service) that skips the
login page and auto-approves:

```bash
curl -i "http://localhost:4000/oauth/authorize?client_id=kakao_rest_api_key_example\
&redirect_uri=http://localhost:3000/api/auth/callback/kakao&response_type=code&user_id=1001"
# → 302 Location: .../callback?code=<code>
```

## Service-specific schemes

| Service | Scheme |
| --- | --- |
| Kakao | OAuth token exchange with `client_id` (+ `client_secret` if configured); `kapi` calls use `Authorization: Bearer` |
| Naver | OAuth issue/refresh/delete grants; profile API uses `Authorization: Bearer` |
| Toss Payments | `Authorization: Basic base64("<secret_key>:")` |
| Firebase | API key query param (`?key=`) for Identity Toolkit; OAuth 2.0 Bearer for FCM v1 |
| Supabase | `apikey` header (anon or service_role) + `Authorization: Bearer` for GoTrue sessions |
| Asana / Linear / GitLab / PostHog | `Authorization: Bearer <token>` |
| Spotify | Client credentials grant → Bearer token |
| WorkOS | API key Bearer auth + OAuth/OIDC user flows |
| X | OAuth 2.0 PKCE → Bearer token |

See each [service page](/services/kakao/) for the exact endpoints and
example curl flows.

## Intentional simplifications

- Tokens and JWTs are **unsigned** — they are validated via store lookup, so
  public-key verification against the emulator is not possible.
- Supabase RLS is not emulated: anon and service_role get identical access.
- Rate limiting is core's default only (5,000 requests/hour).
