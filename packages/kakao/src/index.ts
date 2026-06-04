import type {
  Hono,
  ServicePlugin,
  Store,
  WebhookDispatcher,
  TokenMap,
  AppEnv,
  RouteContext,
} from "@emulators/core";
import { getKakaoStore } from "./store.js";
import { oauthRoutes } from "./routes/oauth.js";
import { userRoutes } from "./routes/user.js";

export { getKakaoStore, type KakaoStore } from "./store.js";
export * from "./entities.js";

const DEFAULT_CLIENT_ID = "kakao_rest_api_key";
const DEFAULT_REDIRECT_URI = "http://localhost:3000/api/auth/callback/kakao";
const DEFAULT_USER_ID = 1234567890;

export interface KakaoSeedApp {
  client_id: string;
  client_secret?: string;
  redirect_uris?: string[];
}

export interface KakaoSeedUser {
  user_id?: number;
  nickname: string;
  email?: string;
  profile_image_url?: string;
}

export interface KakaoSeedConfig {
  port?: number;
  apps?: KakaoSeedApp[];
  users?: KakaoSeedUser[];
  webhooks?: Array<{ url: string; events: string[] }>;
}

/** 다음 카카오 회원번호 자동 부여 (기존 user_id 중 최대 + 1) */
function nextUserId(store: Store): number {
  const ks = getKakaoStore(store);
  const users = ks.users.all();
  if (users.length === 0) return 1001;
  return Math.max(...users.map((u) => u.user_id)) + 1;
}

export function seedFromConfig(
  store: Store,
  _baseUrl: string,
  config: KakaoSeedConfig,
  webhooks?: WebhookDispatcher,
): void {
  const ks = getKakaoStore(store);

  if (config.apps) {
    for (const a of config.apps) {
      if (ks.apps.findOneBy("client_id", a.client_id)) continue;
      ks.apps.insert({
        client_id: a.client_id,
        client_secret: a.client_secret ?? null,
        redirect_uris: a.redirect_uris ?? [DEFAULT_REDIRECT_URI],
        unlinked_user_ids: [],
      });
    }
  }

  if (config.users) {
    for (const u of config.users) {
      const userId = u.user_id ?? nextUserId(store);
      if (ks.users.findOneBy("user_id", userId)) continue;
      ks.users.insert({
        user_id: userId,
        nickname: u.nickname,
        email: u.email ?? null,
        profile_image_url: u.profile_image_url ?? null,
        connected_at: new Date().toISOString(),
      });
    }
  }

  if (webhooks && config.webhooks) {
    for (const w of config.webhooks) {
      webhooks.register({ url: w.url, events: w.events, active: true, owner: "kakao" });
    }
  }
}

export const kakaoPlugin: ServicePlugin = {
  name: "kakao",
  register(
    app: Hono<AppEnv>,
    store: Store,
    webhooks: WebhookDispatcher,
    baseUrl: string,
    tokenMap?: TokenMap,
  ): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    oauthRoutes(ctx);
    userRoutes(ctx);
  },
  seed(store: Store, _baseUrl: string): void {
    const ks = getKakaoStore(store);

    if (!ks.apps.findOneBy("client_id", DEFAULT_CLIENT_ID)) {
      ks.apps.insert({
        client_id: DEFAULT_CLIENT_ID,
        client_secret: null,
        redirect_uris: [DEFAULT_REDIRECT_URI],
        unlinked_user_ids: [],
      });
    }

    if (!ks.users.findOneBy("user_id", DEFAULT_USER_ID)) {
      ks.users.insert({
        user_id: DEFAULT_USER_ID,
        nickname: "테스트 사용자",
        email: "testuser@kakao.com",
        profile_image_url: "http://k.kakaocdn.net/dn/default_profile.png",
        connected_at: new Date().toISOString(),
      });
    }
  },
};

export default kakaoPlugin;
