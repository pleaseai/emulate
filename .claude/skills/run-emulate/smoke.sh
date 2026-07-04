#!/usr/bin/env bash
# Smoke driver for the emulate CLI: builds, launches all service emulators
# seeded with `emulate init` data, exercises one real flow per service over
# HTTP, checks the programmatic createEmulator() API, then shuts down.
#
# Usage:  .claude/skills/run-emulate/smoke.sh [BASE_PORT]
# Exit 0 = all checks passed. Server log: $WORKDIR/server.log (path printed).
set -u

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BASE_PORT=${1:-4300}
KAKAO=$BASE_PORT NAVER=$((BASE_PORT+1)) TOSS=$((BASE_PORT+2))
FIREBASE=$((BASE_PORT+3)) SUPABASE=$((BASE_PORT+4)) ASANA=$((BASE_PORT+5)) LINEAR=$((BASE_PORT+6))
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/emulate-smoke.XXXXXX")
PASS=0 FAIL=0
CLI="$ROOT/packages/emulate/dist/index.js"

check() { # check <name> <expected-substring> <actual>
  if [[ "$3" == *"$2"* ]]; then
    echo "  ok   $1"; PASS=$((PASS+1))
  else
    echo "  FAIL $1 — expected substring '$2', got: ${3:0:200}"; FAIL=$((FAIL+1))
  fi
}

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null
  # Keep the workdir (seed + server.log) only when something failed, for debugging.
  [[ $FAIL == 0 && -d "$WORKDIR" ]] && rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "== build"
(cd "$ROOT" && bun run build >/dev/null) || { echo "build failed"; exit 1; }

echo "== seed + start (ports $BASE_PORT-$LINEAR, workdir $WORKDIR)"
(cd "$WORKDIR" && bun "$CLI" init >/dev/null) || { echo "emulate init failed"; exit 1; }
# exec so $! is the bun process itself, not a wrapper subshell — otherwise
# cleanup kills the subshell and leaks the server, which keeps the port and
# stale state (e.g. EMAIL_EXISTS on the firebase check) for the next run.
(cd "$WORKDIR" && exec bun "$CLI" start --port "$BASE_PORT" --seed emulate.config.yaml > server.log 2>&1) &
SERVER_PID=$!

for i in $(seq 1 30); do
  curl -s -m1 -o /dev/null "http://localhost:$LINEAR/" && break
  sleep 0.5
  [[ $i == 30 ]] && { echo "server did not come up"; cat "$WORKDIR/server.log"; exit 1; }
done

echo "== kakao oauth (authorize -> token -> /v2/user/me)"
LOC=$(curl -s -m3 -o /dev/null -w '%{redirect_url}' "http://localhost:$KAKAO/oauth/authorize?client_id=kakao_rest_api_key_example&redirect_uri=http://localhost:3000/api/auth/callback/kakao&response_type=code&user_id=1001")
CODE=${LOC##*code=}
TOK=$(curl -s -m3 -X POST "http://localhost:$KAKAO/oauth/token" \
  -d "grant_type=authorization_code&client_id=kakao_rest_api_key_example&client_secret=kakao_client_secret_example&redirect_uri=http://localhost:3000/api/auth/callback/kakao&code=$CODE")
check "kakao token" '"access_token"' "$TOK"
AT=$(echo "$TOK" | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
ME=$(curl -s -m3 "http://localhost:$KAKAO/v2/user/me" -H "Authorization: Bearer $AT")
check "kakao /v2/user/me" '"email":"hong@example.com"' "$ME"

echo "== naver oauth (authorize -> token -> /v1/nid/me)"
NLOC=$(curl -s -m3 -o /dev/null -w '%{redirect_url}' "http://localhost:$NAVER/oauth2.0/authorize?client_id=naver_client_id_example&redirect_uri=http://localhost:3000/api/auth/callback/naver&response_type=code&state=smoke&user=naver_user_001")
NCODE=$(echo "$NLOC" | sed -E 's/.*[?&]code=([^&]+).*/\1/')
NTOK=$(curl -s -m3 "http://localhost:$NAVER/oauth2.0/token?grant_type=authorization_code&client_id=naver_client_id_example&client_secret=naver_client_secret_example&code=$NCODE&state=smoke")
check "naver token" '"access_token"' "$NTOK"
NAT=$(echo "$NTOK" | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
NME=$(curl -s -m3 "http://localhost:$NAVER/v1/nid/me" -H "Authorization: Bearer $NAT")
check "naver /v1/nid/me" '"email":"hong@example.com"' "$NME"

echo "== tosspayments (create -> confirm)"
P=$(curl -s -m3 -X POST "http://localhost:$TOSS/internal/payments" -H 'content-type: application/json' \
  -d '{"orderId":"smoke-order","orderName":"Smoke order","amount":11000}')
PK=$(echo "$P" | sed -E 's/.*"paymentKey":"([^"]+)".*/\1/')
CONF=$(curl -s -m3 -X POST "http://localhost:$TOSS/v1/payments/confirm" \
  -H "Authorization: Basic $(printf 'test_sk_example:' | base64)" -H 'content-type: application/json' \
  -d "{\"paymentKey\":\"$PK\",\"orderId\":\"smoke-order\",\"amount\":11000}")
check "toss confirm" '"status":"DONE"' "$CONF"

echo "== firebase (accounts:signUp)"
FB=$(curl -s -m3 -X POST "http://localhost:$FIREBASE/v1/accounts:signUp?key=firebase_api_key_example" \
  -H 'content-type: application/json' -d '{"email":"smoke@example.com","password":"secret12","returnSecureToken":true}')
check "firebase signUp" '"idToken"' "$FB"

echo "== supabase (PostgREST select)"
SB=$(curl -s -m3 "http://localhost:$SUPABASE/rest/v1/todos?select=*" -H "apikey: supabase_anon_key_example")
check "supabase todos" '"title"' "$SB"

echo "== asana (workspaces)"
AS=$(curl -s -m3 "http://localhost:$ASANA/api/1.0/workspaces" -H 'Authorization: Bearer test_token_admin')
check "asana workspaces" '"resource_type":"workspace"' "$AS"

echo "== linear (GraphQL teams)"
LN=$(curl -s -m3 -X POST "http://localhost:$LINEAR/graphql" -H 'content-type: application/json' \
  -H 'Authorization: lin_api_test' -d '{"query":"{ teams { nodes { key name } } }"}')
check "linear teams" '"key":"ENG"' "$LN"

echo "== programmatic createEmulator()"
cat > "$WORKDIR/prog.ts" <<EOF
import { createEmulator } from '$ROOT/packages/emulate/src/api.ts'
const e = await createEmulator({
  service: 'supabase',
  port: $((BASE_PORT + 100)),
  seed: { supabase: { anon_key: 'k', tables: { todos: [{ id: 1, title: 'prog', completed: false }] } } },
})
const r = await fetch(\`\${e.url}/rest/v1/todos?select=*\`, { headers: { apikey: 'k' } })
console.log(JSON.stringify(await r.json()))
await e.close()
EOF
PROG=$(bun "$WORKDIR/prog.ts" 2>&1)
check "createEmulator supabase" '"title":"prog"' "$PROG"

echo
if [[ $FAIL == 0 ]]; then
  echo "passed: $PASS  failed: 0"
else
  echo "passed: $PASS  failed: $FAIL  (workdir kept for debugging: $WORKDIR/server.log)"
fi
[[ $FAIL == 0 ]]
