---
title: HTTPS with portless
description: Give emulators trusted HTTPS URLs like https://kakao.emulate.localhost using portless as a local reverse proxy.
sidebar:
  order: 5
---

[portless](https://github.com/vercel-labs/portless) gives local servers
trusted HTTPS URLs (`https://<name>.localhost`) with an auto-generated,
auto-trusted CA — no port numbers in URLs and no browser warnings. That
matters for emulators when the client requires HTTPS (secure cookies,
OAuth libraries that reject `http://` redirect URIs, mobile webviews).

## Setup

```bash
npm install -g portless

# Start the HTTPS proxy once (generates and trusts the local CA)
portless proxy start
```

## Point an alias at an emulator

Start a service and register its port as an alias:

```bash
npx @pleaseai/emulate --service kakao   # listens on http://localhost:4000

portless alias kakao.emulate 4000       # → https://kakao.emulate.localhost
```

Requests to `https://kakao.emulate.localhost` are now proxied to the
emulator, HTTP/2 and TLS included.

## Tell the emulator its public URL

Emulators embed their base URL in the responses they generate — OAuth
authorize redirects, issued URLs, webhook payloads. Behind a proxy the
default `http://localhost:4000` would leak through, so override it.

For a single service, use `--base-url`:

```bash
npx @pleaseai/emulate --service kakao --base-url https://kakao.emulate.localhost
```

For multiple services, set `baseUrl` per service in the seed config
(`--base-url` only works with a single `--service`):

```yaml
kakao:
  baseUrl: https://kakao.emulate.localhost
  # ...apps, users
supabase:
  baseUrl: https://supabase.emulate.localhost
  # ...tables
```

```bash
portless alias kakao.emulate 4000
portless alias supabase.emulate 4004
npx @pleaseai/emulate --seed emulate.config.yaml
```

The seed `baseUrl` takes priority over the computed default; the
`--base-url` flag beats both. The same override works programmatically:

```ts
const emulator = await createEmulator({
  service: 'kakao',
  port: 4000,
  baseUrl: 'https://kakao.emulate.localhost',
})
```

:::note
The upstream vercel-labs/emulate CLI has a `--portless` flag that
auto-registers one alias per service. This fork does not implement it —
register aliases with the `portless` CLI as shown above.
:::

## Cleanup

```bash
portless alias --remove kakao.emulate
portless clean   # remove all portless state, CA trust, and hosts entries
```
