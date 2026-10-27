---
title: Use with upstream emulate
description: Run the @pleaseai emulators next to vercel-labs/emulate built-in services with `emulate start --config`.
sidebar:
  order: 6
---

[vercel-labs/emulate](https://github.com/vercel-labs/emulate) (the `emulate`
npm package) can run third-party
[custom emulators](https://emulate.dev/docs/custom-emulators#run-alongside-built-ins)
next to its built-in services (GitHub, Stripe, Slack, and so on). Every
service in `@pleaseai/emulate` is exposed as such a custom emulator at
`@pleaseai/emulate/emulators/<service>`, so one config file can start Kakao,
Toss Payments, Supabase, and the upstream services together.

## Install

```bash
npm i -D emulate @pleaseai/emulate
```

`emulate` (version 0.12 or newer) is an optional peer dependency of
`@pleaseai/emulate`. You install it yourself; the `@pleaseai/emulate` CLI and
programmatic API work without it.

## Configure

Upstream reads `services` from `emulate.config.yaml`. Point `emulator` at one
of our modules, or use a built-in name for an upstream service. The `seed`
for one of our instances is the same object you would put under that
service's key in our own [seed config](/guides/configuration/).

```yaml
services:
  kakao:
    emulator: '@pleaseai/emulate/emulators/kakao'
    port: 4100
    seed:
      apps:
        - client_id: kakao_rest_api_key_example
          client_secret: kakao_client_secret_example
          redirect_uris:
            - http://localhost:3000/api/auth/callback/kakao
      users:
        - user_id: 1001
          nickname: Gildong

  pleaseai-linear:
    emulator: '@pleaseai/emulate/emulators/linear'
    port: 4101
    seed:
      api_keys: [lin_api_test]

  github:
    emulator: github
    port: 4102
```

The full sample is
[`examples/emulate-dev/emulate.config.yaml`](https://github.com/pleaseai/emulate/blob/main/examples/emulate-dev/emulate.config.yaml).
Available modules: `kakao`, `naver`, `tosspayments`, `firebase`, `supabase`,
`asana`, `linear`, `autumn`, `gitlab`, `posthog`, `spotify`, `workos`, `x`.

**Naming rule for Linear.** Upstream does not let a custom instance reuse a
built-in name, and it ships its own `linear`. Key our Linear emulator
differently, for example `pleaseai-linear`. The module path stays
`@pleaseai/emulate/emulators/linear`.

## Run

Both packages declare a bin called `emulate`, and in a project that installs
both, `node_modules/.bin/emulate` is the `@pleaseai/emulate` CLI. Run the
upstream entry point directly:

```bash
node node_modules/emulate/dist/index.js start --config emulate.config.yaml
```

Wrap it in an npm script if you run it often. `npx emulate ...` and
`npx -p emulate emulate ...` do not help: npx prefers the project-local bin,
which is ours.

Upstream's own flags work unchanged, because upstream owns the process:

```bash
# Trusted HTTPS URLs, e.g. https://kakao.emulate.localhost
node node_modules/emulate/dist/index.js start --config emulate.config.yaml --portless

# Listen on all interfaces (containers, other machines)
node node_modules/emulate/dist/index.js start --config emulate.config.yaml --host 0.0.0.0

# Reload on config/fixture changes; each reload resets state to the seed
node node_modules/emulate/dist/index.js start --config emulate.config.yaml --watch
```

Our emulators advertise the base URL upstream computes, so `--base-url` and
`--portless` URLs appear in OAuth redirects and links. See
[HTTPS with portless](/guides/portless/) for the proxy setup.

## Limitations

- **State lives in our own store.** Our services keep state in their internal
  `Store`, not in the state object upstream manages. Upstream snapshots,
  persistence, and the inspector's State tab only reflect the seed. Reset
  (and `--watch` reloads) do work: upstream rebuilds each emulator from the
  seed, which restores a clean state.
- **You install `emulate` yourself.** It is an optional peer dependency, and
  version 0.12 or newer is required.
- **Bin name clash.** Use `node node_modules/emulate/dist/index.js` as shown
  above.
- **Single seed object.** A custom instance takes one service's seed (and an
  optional `tokens` map inside it), not our multi-service config file.
