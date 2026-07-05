# Emulator package conventions

Every service emulator follows the `@emulators/*` patterns from
[vercel-labs/emulate](https://github.com/vercel-labs/emulate) and uses
`@emulators/core@0.6.0` as an npm dependency.

## Package layout

```
packages/<service>/
  package.json          # @pleaseai/emulate-<service>, includes the bun export condition
  tsconfig.json         # extends ../../tsconfig.base.json
  tsup.config.ts
  src/
    entities.ts         # types extending core Entity
    store.ts            # getXxxStore(store) — namespaced collections
    helpers.ts          # service-specific error/response helpers
    index.ts            # exports plugin + seedFromConfig
    routes/*.ts         # route registration functions taking RouteContext
    __tests__/*.test.ts # bun:test tests
```

## Core patterns

### entities.ts

Every entity extends core `Entity` (`id: number`, `created_at`, `updated_at` —
assigned automatically on insert). Externally visible service IDs live in a
separate field (`uuid`, etc.).

```ts
import type { Entity } from "@emulators/core";

export interface KakaoUser extends Entity {
  user_id: number; // Kakao member number (the externally exposed id)
  nickname: string;
  email: string | null;
}
```

### store.ts

```ts
import { Store, type Collection } from "@emulators/core";

export interface KakaoStore {
  users: Collection<KakaoUser>;
  apps: Collection<KakaoApp>;
}

export function getKakaoStore(store: Store): KakaoStore {
  return {
    users: store.collection<KakaoUser>("kakao.users", ["user_id", "email"]),
    apps: store.collection<KakaoApp>("kakao.apps", ["client_id"]),
  };
}
```

- Collection names are namespaced as `<service>.<plural>`.
- The second argument lists index fields — only the fields queried via
  `findBy`/`findOneBy`.
- Re-requesting an existing collection with different indexes throws, so
  indexes are defined exclusively in store.ts.

### routes/*.ts

```ts
import type { RouteContext } from "@emulators/core";
import { getKakaoStore } from "../store.js";

export function userRoutes(ctx: RouteContext): void {
  const { app, store, webhooks, baseUrl } = ctx;
  const ks = () => getKakaoStore(store);

  app.get("/v2/user/me", (c) => {
    // c.req.param("id"), c.req.query("key"), await c.req.json(), c.req.header("Authorization")
    return c.json({ ... });
  });
}
```

- Reproduce the real service's response JSON field names and formats exactly
  (snake_case/camelCase per the real service).
- Error responses also follow the real service's format (implemented as
  helpers in each service's helpers.ts).

### index.ts

```ts
export const kakaoPlugin: ServicePlugin = {
  name: "kakao",
  register(app, store, webhooks, baseUrl, tokenMap) {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    oauthRoutes(ctx);
    userRoutes(ctx);
  },
  seed(store, baseUrl) {
    // Default seed (minimal data so the emulator works without a seed config)
  },
};

export function seedFromConfig(store: Store, baseUrl: string, config: KakaoSeedConfig, webhooks?: WebhookDispatcher): void {
  // Receives the service section of emulate.config.yaml. Must be idempotent
  // (findOneBy then skip), and config values win over plugin.seed() defaults.
}

export default kakaoPlugin;
```

The config shape accepted by `seedFromConfig` must match the service's
`initConfig` in the CLI registry (`packages/emulate/src/registry.ts`).

## Authentication

- Core's `authMiddleware` is registered globally but **passes through when no
  Authorization header is present**. Service-specific auth (Bearer token
  validation, Basic auth, apikey headers, etc.) is implemented directly in
  routes/helpers.
- OAuth access tokens are stored in a service store collection
  (`<service>.tokens`, etc.) and looked up in routes.
- Core provides `constantTimeSecretEqual`, `normalizeUri`,
  `matchesRedirectUri`, `parseCookies`, and `bodyStr` for OAuth implementations.

## OAuth login page

`renderCardPage` (a core export) renders a user-picker login page.
The authorize endpoint shows the seeded users and, on selection, issues a code
and 302s to the redirect_uri. Also provide an instant-approval path via a
`?user=<id>` query for automation (tests/CI).

## Webhooks

Dispatch with `webhooks.dispatch(event, undefined, payload, "<service>")`.
Subscribe with `webhooks.register({ url, events, active: true, owner: "<service>" })`.
If the seed config accepts `webhooks: [{ url, events }]`, register them in
seedFromConfig.

## Tests (bun:test)

Send Requests directly through `app.fetch` without binding a port:

```ts
import { createServer } from '@emulators/core'
import { describe, expect, it } from 'bun:test'
import { kakaoPlugin } from '../index.js'

function makeApp() {
  const { app, store } = createServer(kakaoPlugin, { port: 4000 })
  kakaoPlugin.seed?.(store, 'http://localhost:4000')
  return { app, store }
}

it('issues token for authorization code', async () => {
  const { app } = makeApp()
  const res = await app.fetch(
    new Request('http://localhost:4000/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id }),
    }),
  )
  expect(res.status).toBe(200)
})
```

- Cover the happy path plus the main error paths (bad code/token/key, missing
  required fields, 404s).
- No external network access — everything stays in memory.

## Style

- ESM with `.js` extension imports (`./store.js`).
- One route group per file. Response formatting functions (`formatXxx`) go at
  the bottom of the route file.
- Comment only non-obvious behavior (places that intentionally diverge from
  the real service).
