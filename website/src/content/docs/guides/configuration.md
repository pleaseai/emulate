---
title: Configuration
description: Seed the emulators with app keys, users, and table data from an emulate.config.yaml file.
sidebar:
  order: 2
---

Emulators start with sensible built-in defaults, but most real test setups
want deterministic fixtures: known app keys, known users, known table rows.
That is what the seed config is for.

## The seed config file

When an `emulate.config.yaml` is present in the working directory (or a file
is passed via `--seed <file>`), the emulators start pre-seeded with the data
it contains. **Only the services present in the config are started.**

```bash
# Generate a starter config with example data for every service
npx @pleaseai/emulate init

# Only include specific services
npx @pleaseai/emulate init --service kakao,supabase

# Start from an explicit file (YAML or JSON)
npx @pleaseai/emulate --seed my-fixtures.yaml
```

## Structure

The file has one top-level section per service, plus an optional shared
`tokens` section:

```yaml
# Map specific bearer tokens to specific users (shared across services)
tokens:
  test-token:
    login: dev@example.com

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

supabase:
  anon_key: test-anon-key
  tables:
    todos:
      - { id: 1, title: Buy groceries, completed: false }
```

Each service page documents its own seed section shape — see the
**Seed Config** heading on any page under [Services](/services/kakao/).

## Seeding rules

- Seeding is **idempotent**: entries already present (matched by their natural
  key) are skipped, so restarting with the same config never duplicates data.
- Config values win over the plugin's built-in defaults.
- Some services accept a `webhooks: [{ url, events }]` list in their section;
  those subscriptions are registered at startup.

## Tokens

The top-level `tokens` map assigns fixed bearer tokens to users:

```yaml
tokens:
  test-token:
    login: dev@example.com   # matches a seeded user's email, id, or name
    scopes: []               # optional
```

Services that use bearer auth resolve `Authorization: Bearer <token>` through
this map. Without it, a default `test_token_admin` token is available, and
most services fall back to the first seeded user for unmatched tokens — see
[Authentication](/guides/authentication/).

## Environment variables

The base port can also be set via `EMULATE_PORT` or `PORT`.
