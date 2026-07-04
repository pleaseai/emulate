---
name: run-emulate
description: >-
  Build, run, smoke-test, and drive the emulate CLI — local HTTP emulators for
  Kakao, Naver, Toss Payments, Firebase, Supabase, Asana, and Linear. Use when
  asked to run/start the emulators, verify a change against the live servers,
  exercise an OAuth/payment flow with curl, or run the smoke driver.
---

# Run emulate

`@pleaseai/emulate` (packages/emulate) is a CLI that starts one HTTP server
per emulated service on sequential ports. It is driven with `curl` — there is
no GUI. The committed driver `.claude/skills/run-emulate/smoke.sh` builds,
launches everything seeded, exercises one real flow per service, and exits
non-zero on failure.

All paths below are relative to the repo root.

## Prerequisites

- bun (pinned via mise: `mise install`; any recent bun also works)
- No OS packages needed — servers are plain `Bun.serve`-style HTTP.

## Build

```bash
bun install
bun run build        # turbo run build → packages/emulate/dist/index.js (the CLI)
```

## Run (agent path) — the smoke driver

```bash
.claude/skills/run-emulate/smoke.sh          # ports 4300-4306
.claude/skills/run-emulate/smoke.sh 5300     # alternate base port
```

It builds, runs `emulate init` in a temp dir, starts all 7 services with that
seed, then verifies: Kakao OAuth (authorize → token → `/v2/user/me`), Toss
payment create → confirm (`"status":"DONE"`), Firebase `accounts:signUp`,
Supabase PostgREST select, Asana workspaces, Linear GraphQL teams, and the
programmatic `createEmulator()` API. Prints `passed: 8  failed: 0` and the
server-log path on success.

### Driving a running server manually

```bash
# start seeded in some scratch dir (foreground; Ctrl+C to stop)
bun packages/emulate/dist/index.js init          # writes emulate.config.yaml
bun packages/emulate/dist/index.js start --port 4300 --seed emulate.config.yaml

# example: full Kakao OAuth flow against port 4300
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "http://localhost:4300/oauth/authorize?client_id=kakao_rest_api_key_example&redirect_uri=http://localhost:3000/api/auth/callback/kakao&response_type=code&user_id=1001")
CODE=${LOC##*code=}
curl -s -X POST http://localhost:4300/oauth/token \
  -d "grant_type=authorization_code&client_id=kakao_rest_api_key_example&client_secret=kakao_client_secret_example&redirect_uri=http://localhost:3000/api/auth/callback/kakao&code=$CODE"
```

Seeded credentials from `emulate init` (see the generated yaml for all):
Kakao `kakao_rest_api_key_example`/`kakao_client_secret_example`, Toss secret
key `test_sk_example` (Basic auth, `key:` base64), Firebase API key
`firebase_api_key_example`, Supabase `supabase_anon_key_example`, Asana
bearer `test_token_admin` (top-level `tokens:` seed), Linear `lin_api_test`.

## Direct invocation (most PRs need only this)

Each service package is a library; `bun test` in it runs against in-process
servers. To poke internals without the CLI, import the source directly —
bun runs the TS as-is, but the script must live **inside the repo** (module
resolution; see Gotchas):

```bash
cat > prog.smoke.ts <<'EOF'   # at repo root — must be inside the repo
import { createEmulator } from './packages/emulate/src/api.ts'
const e = await createEmulator({ service: 'supabase', port: 4444,
  seed: { supabase: { anon_key: 'k', tables: { todos: [{ id: 1, title: 'x', completed: false }] } } } })
console.log(await (await fetch(`${e.url}/rest/v1/todos?select=*`, { headers: { apikey: 'k' } })).json())
await e.close()
EOF
bun prog.smoke.ts && rm prog.smoke.ts
```

## Test

```bash
bun run test                      # turbo run test — all packages
(cd packages/kakao && bun test)   # one package
```

## Gotchas

- **Unseeded server = 401 everywhere.** `emulate start` with no `--seed`
  boots fine but has zero app keys: Kakao authorize returns 401 KOE101 as an
  HTML error page. Always `emulate init` + `--seed emulate.config.yaml`.
- **Kakao token exchange requires `client_secret`** when the seeded app
  defines one (init's does) — omitting it gives `KOE010 client_secret does
  not match`, even though the README's minimal example skips it.
- **Linear auth uses the seeded `api_keys` value** (`lin_api_test`), sent as
  `Authorization: lin_api_test` or `Authorization: Bearer lin_api_test` —
  both verified. Wrong key → GraphQL `AUTHENTICATION_ERROR`, not HTTP 401.
- **Workspace imports only resolve inside the repo.** Root `node_modules/
  @pleaseai/` does not link the workspace packages; a script outside the repo
  cannot `import '@pleaseai/emulate'` (Cannot find module). Run scripts from
  within the repo and/or import `packages/emulate/src/api.ts` by path.
- **`GET /` returns 404 on every service** — that's the liveness signal the
  driver uses; don't read it as "server broken".
- In zsh, `echo ===` fails with `== not found` (zsh `=`-expansion) — quote
  separators when curling interactively from zsh.

## Troubleshooting

- `error: Cannot find module '@pleaseai/emulate'` → script is outside the
  repo; move it inside or import by relative path (Gotchas above).
- `{"error":"invalid_client"...KOE010}` → add
  `client_secret=kakao_client_secret_example` to the token POST.
- 401 + HTML titled `KOE101 | emulate` → server started without `--seed`.
- Port already in use → a previous run is still alive:
  `pkill -f 'emulate/dist/index.js'`, or pass a different base port.
