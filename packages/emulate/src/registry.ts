import type { ServicePlugin, Store, AppKeyResolver, AuthFallback, WebhookDispatcher } from "@emulators/core";

export interface LoadedService {
  plugin: ServicePlugin;
  seedFromConfig?(store: Store, baseUrl: string, config: unknown, webhooks?: WebhookDispatcher): void;
  createAppKeyResolver?(store: Store): AppKeyResolver;
}

export interface ServiceEntry {
  label: string;
  endpoints: string;
  load(): Promise<LoadedService>;
  defaultFallback(svcSeedConfig?: Record<string, unknown>): AuthFallback;
  initConfig: Record<string, unknown>;
}

const SERVICE_NAME_LIST = ["kakao", "naver", "tosspayments", "firebase", "supabase"] as const;
export type ServiceName = (typeof SERVICE_NAME_LIST)[number];
export const SERVICE_NAMES: readonly ServiceName[] = SERVICE_NAME_LIST;

export const SERVICE_REGISTRY: Record<ServiceName, ServiceEntry> = {
  kakao: {
    label: "Kakao API emulator (kauth + kapi)",
    endpoints: "OAuth 2.0 authorize/token, user me, access token info, logout, unlink, KakaoTalk memo send",
    async load() {
      const mod = await import("@pleaseai/emulate-kakao");
      return { plugin: mod.kakaoPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstNickname = (cfg?.users as Array<{ nickname?: string }> | undefined)?.[0]?.nickname ?? "admin";
      return { login: firstNickname, id: 1, scopes: [] };
    },
    initConfig: {
      kakao: {
        apps: [
          {
            client_id: "kakao_rest_api_key_example",
            client_secret: "kakao_client_secret_example",
            redirect_uris: ["http://localhost:3000/api/auth/callback/kakao"],
          },
        ],
        users: [
          {
            user_id: 1001,
            nickname: "홍길동",
            email: "hong@example.com",
            profile_image_url: "https://k.kakaocdn.net/dn/profile.jpg",
          },
        ],
      },
    },
  },

  naver: {
    label: "Naver API emulator (nid + openapi)",
    endpoints: "OAuth 2.0 authorize/token (issue, refresh, delete), user profile (/v1/nid/me)",
    async load() {
      const mod = await import("@pleaseai/emulate-naver");
      return { plugin: mod.naverPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstName = (cfg?.users as Array<{ name?: string }> | undefined)?.[0]?.name ?? "admin";
      return { login: firstName, id: 1, scopes: [] };
    },
    initConfig: {
      naver: {
        apps: [
          {
            client_id: "naver_client_id_example",
            client_secret: "naver_client_secret_example",
            callback_urls: ["http://localhost:3000/api/auth/callback/naver"],
          },
        ],
        users: [
          {
            name: "홍길동",
            nickname: "gildong",
            email: "hong@example.com",
            gender: "M",
            birthyear: "1990",
            mobile: "010-1234-5678",
          },
        ],
      },
    },
  },

  tosspayments: {
    label: "Toss Payments API emulator",
    endpoints: "payments confirm/lookup/cancel, orders lookup, checkout page, webhooks",
    async load() {
      const mod = await import("@pleaseai/emulate-toss-payments");
      return { plugin: mod.tossPaymentsPlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback() {
      return { login: "merchant", id: 1, scopes: [] };
    },
    initConfig: {
      tosspayments: {
        merchants: [
          {
            client_key: "test_ck_example",
            secret_key: "test_sk_example",
          },
        ],
      },
    },
  },

  firebase: {
    label: "Firebase emulator (Auth + FCM)",
    endpoints: "Identity Toolkit signUp/signIn/lookup/update/delete, secure token refresh, FCM messages:send",
    async load() {
      const mod = await import("@pleaseai/emulate-firebase");
      return { plugin: mod.firebasePlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? "admin@example.com";
      return { login: firstEmail, id: 1, scopes: [] };
    },
    initConfig: {
      firebase: {
        projects: [
          {
            project_id: "demo-project",
            api_key: "firebase_api_key_example",
          },
        ],
        users: [
          {
            email: "hong@example.com",
            password: "password123",
            display_name: "홍길동",
          },
        ],
      },
    },
  },

  supabase: {
    label: "Supabase emulator (GoTrue Auth + PostgREST)",
    endpoints: "auth signup/token/user/logout, rest table CRUD with filters",
    async load() {
      const mod = await import("@pleaseai/emulate-supabase");
      return { plugin: mod.supabasePlugin, seedFromConfig: mod.seedFromConfig };
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? "admin@example.com";
      return { login: firstEmail, id: 1, scopes: [] };
    },
    initConfig: {
      supabase: {
        anon_key: "supabase_anon_key_example",
        service_role_key: "supabase_service_role_key_example",
        users: [
          {
            email: "hong@example.com",
            password: "password123",
          },
        ],
        tables: {
          todos: [
            { id: 1, title: "장보기", completed: false },
            { id: 2, title: "청소하기", completed: true },
          ],
        },
      },
    },
  },
};
