# emulate

CI와 네트워크 차단 샌드박스를 위한 로컬 drop-in replacement 서비스.
한국 서비스(Kakao, Naver, Toss Payments)와 BaaS(Firebase, Supabase)의 API를
완전히 stateful하게, 실서비스 응답 형식 그대로 에뮬레이션합니다.

[vercel-labs/emulate](https://github.com/vercel-labs/emulate)의 아키텍처를 기반으로
[`@emulators/core`](https://www.npmjs.com/package/@emulators/core)를 사용해 구현했습니다.

## 지원 서비스

| 서비스 | 기본 포트 | 에뮬레이션 범위 |
| --- | --- | --- |
| `kakao` | 4000 | OAuth 2.0 (kauth), 사용자 API, 카카오톡 나에게 보내기 (kapi) |
| `naver` | 4001 | 네이버 아이디로 로그인 (OAuth 발급/갱신/삭제), 프로필 API (`/v1/nid/me`) |
| `tosspayments` | 4002 | 결제 승인/조회/취소, 주문 조회, 결제창 시뮬레이션, 웹훅 |
| `firebase` | 4003 | Auth (Identity Toolkit REST), Secure Token, FCM v1 |
| `supabase` | 4004 | GoTrue Auth (signup/token/user), PostgREST 테이블 CRUD + 필터 |

## 시작하기

```bash
bun install
bun run build

# 모든 서비스 실행 (포트 4000부터 순차 할당)
bun packages/emulate/dist/index.js

# 특정 서비스만
bun packages/emulate/dist/index.js --service kakao,tosspayments

# 시드 설정 파일 생성
bun packages/emulate/dist/index.js init
```

`emulate.config.yaml`(또는 `--seed <file>`)이 있으면 앱 키·사용자·테이블 데이터가
시드된 상태로 시작합니다. 설정에 포함된 서비스만 자동으로 선택됩니다.

## 사용 예시

### Kakao OAuth 플로우

```bash
# 1. 인가 코드 (CI에서는 ?user_id=로 로그인 페이지 없이 자동 승인)
curl -i "http://localhost:4000/oauth/authorize?client_id=kakao_rest_api_key_example\
&redirect_uri=http://localhost:3000/api/auth/callback/kakao&response_type=code&user_id=1001"

# 2. 토큰 발급
curl -X POST http://localhost:4000/oauth/token \
  -d "grant_type=authorization_code&client_id=kakao_rest_api_key_example&code=<code>"

# 3. 사용자 정보
curl http://localhost:4000/v2/user/me -H "Authorization: Bearer <access_token>"
```

### Toss Payments 결제 승인

```bash
# 결제 생성 (실서비스의 결제위젯 단계 대체)
curl -X POST http://localhost:4002/internal/payments \
  -H "content-type: application/json" \
  -d '{"orderId":"order-1","orderName":"테스트 주문","amount":11000}'

# 승인
curl -X POST http://localhost:4002/v1/payments/confirm \
  -H "Authorization: Basic $(echo -n 'test_sk_example:' | base64)" \
  -H "content-type: application/json" \
  -d '{"paymentKey":"<paymentKey>","orderId":"order-1","amount":11000}'
```

### 테스트에서 프로그래매틱 사용

```ts
import { createEmulator } from "@pleaseai/emulate";

const emulator = await createEmulator({
  service: "supabase",
  port: 4004,
  seed: {
    supabase: {
      anon_key: "test-anon-key",
      tables: { todos: [{ id: 1, title: "장보기", completed: false }] },
    },
  },
});

// ... 테스트 실행. emulator.reset()으로 시드 상태 복원, emulator.close()로 종료
```

각 SDK가 에뮬레이터를 바라보게 하려면 base URL만 바꾸면 됩니다.
예: `FIREBASE_AUTH_EMULATOR_HOST=localhost:4003`,
Supabase 클라이언트 `createClient("http://localhost:4004", anonKey)`.

## 패키지 구조

```
packages/
  emulate/          # @pleaseai/emulate — CLI + 프로그래매틱 API
  kakao/            # @pleaseai/emulate-kakao
  naver/            # @pleaseai/emulate-naver
  toss-payments/    # @pleaseai/emulate-toss-payments
  firebase/         # @pleaseai/emulate-firebase
  supabase/         # @pleaseai/emulate-supabase
docs/
  EMULATOR-CONVENTIONS.md   # 새 에뮬레이터 추가 가이드
```

런타임/패키지 매니저는 [bun](https://bun.sh), 태스크 오케스트레이션은 Turborepo.

```bash
bun run test        # 전체 테스트 (bun:test)
bun run type-check  # 전체 타입체크
bun run build       # 전체 빌드 (tsup)
```

## 새 서비스 추가

[docs/EMULATOR-CONVENTIONS.md](docs/EMULATOR-CONVENTIONS.md)를 참고해
`packages/<service>/` 패키지를 만들고 `packages/emulate/src/registry.ts`에 등록하면 됩니다.

## 의도적 단순화

- 토큰/JWT는 서명 없는 형태(검증은 store 조회) — 실서비스 공개키 검증 불가
- Supabase RLS 미적용 (anon/service_role 동일 권한)
- 요율 제한은 core 기본값(시간당 5,000회)만 적용

## License

Apache-2.0
