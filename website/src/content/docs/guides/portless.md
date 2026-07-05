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

## The --portless flag

Start emulate with portless integration and every service registers itself
as a portless alias automatically:

```bash
npx @pleaseai/emulate --portless
```

Each service gets a named HTTPS URL:

```
kakao      https://kakao.emulate.localhost
naver      https://naver.emulate.localhost
supabase   https://supabase.emulate.localhost
```

If portless is not installed, emulate prompts to install it
(`npm i -g portless`); the proxy must already be running
(`portless proxy start`). The flag overwrites any existing aliases matching
`<service>.emulate`, and aliases are removed automatically when emulate
shuts down.

The emulators also advertise these HTTPS URLs as their base URL, so OAuth
redirects, issued URLs, and webhook payloads use
`https://<service>.emulate.localhost` instead of `http://localhost:<port>`.

## Custom base URLs without --portless

For any other reverse proxy, use `--base-url` or the `EMULATE_BASE_URL`
env var — both support `{service}` interpolation for multi-service runs:

```bash
npx @pleaseai/emulate --base-url "https://{service}.myproxy.test"
```

Per-service overrides in the seed config take the highest priority:

```yaml
kakao:
  baseUrl: https://kakao.emulate.localhost
  # ...apps, users
```

The full base URL priority is: seed `baseUrl` → `--base-url` flag →
`EMULATE_BASE_URL` → `PORTLESS_URL` (set by the portless CLI wrapper) →
`http://localhost:<port>`. The same override works programmatically:

```ts
const emulator = await createEmulator({
  service: 'kakao',
  port: 4000,
  baseUrl: 'https://kakao.emulate.localhost',
})
```

## Manual aliases

You can also register aliases yourself instead of using `--portless`:

```bash
npx @pleaseai/emulate --service kakao --base-url https://kakao.emulate.localhost
portless alias kakao.emulate 4000       # → https://kakao.emulate.localhost
```

## Cleanup

```bash
portless alias --remove kakao.emulate
portless clean   # remove all portless state, CA trust, and hosts entries
```
