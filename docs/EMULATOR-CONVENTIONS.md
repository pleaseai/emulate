# 에뮬레이터 패키지 컨벤션

모든 서비스 에뮬레이터는 [vercel-labs/emulate](https://github.com/vercel-labs/emulate)의
`@emulators/*` 패턴을 따른다. `@emulators/core@0.6.0`을 npm 의존성으로 사용한다.

## 패키지 레이아웃

```
packages/<service>/
  package.json          # @pleaseai/emulate-<service>, bun export 조건 포함 (이미 생성됨)
  tsconfig.json         # ../../tsconfig.base.json extends (이미 생성됨)
  tsup.config.ts        # 이미 생성됨
  src/
    entities.ts         # Entity를 확장하는 타입 정의
    store.ts            # getXxxStore(store) — 네임스페이스드 컬렉션
    helpers.ts          # 서비스별 에러/응답 헬퍼
    index.ts            # plugin + seedFromConfig export
    routes/*.ts         # RouteContext를 받는 라우트 등록 함수
    __tests__/*.test.ts # bun:test 테스트
```

## 핵심 패턴

### entities.ts

모든 엔티티는 core `Entity`(`id: number`, `created_at`, `updated_at` — insert 시 자동 부여)를 확장한다.
서비스 외부 노출 ID는 별도 필드(`uuid` 등)로 둔다.

```ts
import type { Entity } from "@emulators/core";

export interface KakaoUser extends Entity {
  user_id: number; // 카카오 회원번호 (외부 노출 id)
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

- 컬렉션 이름은 `<service>.<plural>`로 네임스페이스.
- 두 번째 인자는 인덱스 필드 — `findBy`/`findOneBy`로 조회할 필드만 지정.
- 같은 컬렉션을 다른 인덱스로 재요청하면 throw되므로 인덱스는 store.ts에서만 정의.

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

- 실서비스 응답 JSON 필드명/형식을 그대로 재현한다 (snake_case/camelCase 등 실서비스 기준).
- 에러 응답도 실서비스 형식을 따른다 (각 서비스 helpers.ts에 헬퍼로 구현).

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
    // 기본 시드 (시드 설정 없이 띄워도 동작하는 최소 데이터)
  },
};

export function seedFromConfig(store: Store, baseUrl: string, config: KakaoSeedConfig, webhooks?: WebhookDispatcher): void {
  // emulate.config.yaml의 서비스 섹션을 받아 시드. 중복 시드 방지(findOneBy 후 skip).
}

export default kakaoPlugin;
```

`seedFromConfig`의 config 형태는 CLI 레지스트리(`packages/emulate/src/registry.ts`)의
해당 서비스 `initConfig`와 일치해야 한다.

## 인증

- core의 `authMiddleware`가 전역 등록되어 있으나 **Authorization 헤더가 없으면 그냥 통과**한다.
  서비스별 인증(Bearer 토큰 검증, Basic auth, apikey 헤더 등)은 라우트/헬퍼에서 직접 구현한다.
- OAuth 액세스 토큰은 서비스 store의 컬렉션(`<service>.tokens` 등)에 저장하고 라우트에서 조회한다.
- `constantTimeSecretEqual`, `normalizeUri`, `matchesRedirectUri`, `parseCookies`, `bodyStr`이
  core에서 제공된다 (OAuth 구현용).

## OAuth 로그인 페이지

`renderCardPage`(core export)로 사용자 선택 로그인 페이지를 렌더링할 수 있다.
authorize 엔드포인트는 시드된 사용자 목록을 보여주고, 선택 시 code를 발급해 redirect_uri로 302.
`?user=<id>` 쿼리로 즉시 승인하는 자동화 경로도 함께 제공한다 (테스트/CI용).

## 웹훅

`webhooks.dispatch(event, undefined, payload, "<service>")`로 발송.
구독은 `webhooks.register({ url, events, active: true, owner: "<service>" })`.
시드 설정에 `webhooks: [{ url, events }]`를 받을 수 있으면 seedFromConfig에서 등록.

## 테스트 (bun:test)

포트 바인딩 없이 `app.fetch`로 직접 Request를 보낸다:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { createServer } from "@emulators/core";
import { kakaoPlugin } from "../index.js";

function makeApp() {
  const { app, store } = createServer(kakaoPlugin, { port: 4000 });
  kakaoPlugin.seed?.(store, "http://localhost:4000");
  return { app, store };
}

it("issues token for authorization code", async () => {
  const { app } = makeApp();
  const res = await app.fetch(
    new Request("http://localhost:4000/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id }),
    }),
  );
  expect(res.status).toBe(200);
});
```

- 해피 패스 + 주요 에러 경로(잘못된 code/token/key, 필수 필드 누락, 404)를 모두 커버.
- 외부 네트워크 접근 금지 — 모든 것은 인메모리.

## 스타일

- ESM, `.js` 확장자 import (`./store.js`).
- 파일당 하나의 라우트 그룹. 응답 포맷 함수(`formatXxx`)는 라우트 파일 하단에.
- 주석은 비자명한 동작(실서비스와 의도적으로 다른 부분)에만.
