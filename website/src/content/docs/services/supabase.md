---
title: Supabase
description: "Emulated Supabase (GoTrue Auth + PostgREST) for local development and testing."
sidebar:
  label: Supabase
  order: 5
---

:::note
Default port **4004** · Package [`@pleaseai/emulate-supabase`](https://www.npmjs.com/package/@pleaseai/emulate-supabase)
:::

A stateful emulator for Supabase's GoTrue auth and PostgREST data API.

Included now:

- GoTrue auth: signup, password/refresh-token grants, get/update user, logout,
  password recovery
- PostgREST: table CRUD (`GET`/`POST`/`PATCH`/`DELETE`) with filters, ordering,
  pagination, and column selection

RLS is not emulated — `anon_key` and `service_role_key` get identical access.

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service supabase

# Or from the published package
npx @pleaseai/emulate --service supabase
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port (supabase's slot is `4004`).

Point a Supabase client at the emulator with
`createClient("http://localhost:4000", anonKey)`.

## Auth

Pass the project key as either an `apikey` header or `Authorization: Bearer
<key>`. The key must match the configured `anon_key` or `service_role_key`.
User-scoped routes (`GET/PUT /auth/v1/user`, logout) take the user's
`access_token` as the bearer token.

## Flow

```bash
# 1. Sign up (returns a session immediately — auto-confirmed)
curl -X POST http://localhost:4000/auth/v1/signup \
  -H "apikey: supabase_anon_key_example" \
  -H "Content-Type: application/json" \
  -d '{"email":"hong@example.com","password":"password123","data":{"name":"홍길동"}}'
# → {"access_token":"...","refresh_token":"...","token_type":"bearer","expires_in":3600,"user":{...}}

# 2. Log in (grant_type=password)
curl -X POST "http://localhost:4000/auth/v1/token?grant_type=password" \
  -H "apikey: supabase_anon_key_example" \
  -H "Content-Type: application/json" \
  -d '{"email":"hong@example.com","password":"password123"}'

# 3. Get the current user
curl http://localhost:4000/auth/v1/user \
  -H "apikey: supabase_anon_key_example" \
  -H "Authorization: Bearer <access_token>"
```

## PostgREST

Filters use `column=op.value`; multiple params are AND-ed. Operators: `eq`,
`neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`. Reserved params:
`select`, `order`, `limit`, `offset`.

```bash
# Insert a row (Prefer: return=representation echoes the inserted row)
curl -X POST http://localhost:4000/rest/v1/todos \
  -H "apikey: supabase_anon_key_example" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"title":"장보기","completed":false}'

# Query with filter, order, limit, and column selection
curl "http://localhost:4000/rest/v1/todos?completed=is.false&order=id.asc&limit=10&select=id,title" \
  -H "apikey: supabase_anon_key_example"

# Update rows matching a filter
curl -X PATCH "http://localhost:4000/rest/v1/todos?id=eq.1" \
  -H "apikey: supabase_service_role_key_example" \
  -H "Content-Type: application/json" \
  -d '{"completed":true}'
```

## Seed Config

Add a `supabase:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
supabase:
  anon_key: supabase_anon_key_example
  service_role_key: supabase_service_role_key_example
  users:
    - email: hong@example.com
      password: password123
  tables:
    todos:
      - {id: 1, title: 장보기, completed: false}
      - {id: 2, title: 청소하기, completed: true}
```
