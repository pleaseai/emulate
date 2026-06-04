import type { Hono } from "@emulators/core";
import type { ServicePlugin, Store, WebhookDispatcher, TokenMap, AppEnv, RouteContext } from "@emulators/core";
import { getNaverStore } from "./store.js";
import { oauthRoutes } from "./routes/oauth.js";
import { profileRoutes } from "./routes/profile.js";

export { getNaverStore, type NaverStore } from "./store.js";
export * from "./entities.js";

let userSeq = 1;

function nextNaverId(): string {
  // Naver user identifiers are opaque strings.
  return `naver_user_${String(userSeq++).padStart(3, "0")}`;
}

export interface NaverSeedApp {
  client_id: string;
  client_secret?: string;
  callback_urls?: string[];
}

export interface NaverSeedUser {
  id?: string;
  name: string;
  nickname?: string;
  email?: string;
  gender?: string;
  birthyear?: string;
  birthday?: string;
  age?: string;
  mobile?: string;
  profile_image?: string;
}

export interface NaverSeedConfig {
  apps?: NaverSeedApp[];
  users?: NaverSeedUser[];
}

export interface NaverWebhookSeed {
  url: string;
  events: string[];
}

export function seedFromConfig(
  store: Store,
  _baseUrl: string,
  config: NaverSeedConfig,
  webhooks?: WebhookDispatcher,
): void {
  const ns = getNaverStore(store);

  if (config.apps) {
    for (const a of config.apps) {
      if (ns.apps.findOneBy("client_id", a.client_id)) continue;
      ns.apps.insert({
        client_id: a.client_id,
        client_secret: a.client_secret ?? "naver_client_secret",
        callback_urls: a.callback_urls ?? ["http://localhost:3000/api/auth/callback/naver"],
      });
    }
  }

  if (config.users) {
    for (const u of config.users) {
      const naverId = u.id ?? nextNaverId();
      if (ns.users.findOneBy("naver_id", naverId)) continue;
      ns.users.insert({
        naver_id: naverId,
        name: u.name,
        nickname: u.nickname,
        email: u.email,
        gender: u.gender,
        birthyear: u.birthyear,
        birthday: u.birthday,
        age: u.age,
        mobile: u.mobile,
        profile_image: u.profile_image,
      });
    }
  }

  void webhooks; // Naver login provider has no webhooks; accepted for signature parity.
}

export const naverPlugin: ServicePlugin = {
  name: "naver",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    oauthRoutes(ctx);
    profileRoutes(ctx);
  },
  seed(store: Store, _baseUrl: string): void {
    const ns = getNaverStore(store);

    if (!ns.apps.findOneBy("client_id", "naver_client_id")) {
      ns.apps.insert({
        client_id: "naver_client_id",
        client_secret: "naver_client_secret",
        callback_urls: ["http://localhost:3000/api/auth/callback/naver"],
      });
    }

    if (!ns.users.findOneBy("naver_id", "naver_user_001")) {
      ns.users.insert({
        naver_id: "naver_user_001",
        name: "홍길동",
        nickname: "gildong",
        email: "hong@example.com",
        gender: "M",
        birthyear: "1990",
        birthday: "01-15",
        age: "30-39",
        mobile: "010-1234-5678",
      });
    }
  },
};

export default naverPlugin;
