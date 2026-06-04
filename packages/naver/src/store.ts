import { Store, type Collection } from "@emulators/core";
import type { NaverApp, NaverUser, NaverAuthCode, NaverToken } from "./entities.js";

export interface NaverStore {
  apps: Collection<NaverApp>;
  users: Collection<NaverUser>;
  authCodes: Collection<NaverAuthCode>;
  tokens: Collection<NaverToken>;
}

export function getNaverStore(store: Store): NaverStore {
  return {
    apps: store.collection<NaverApp>("naver.apps", ["client_id"]),
    users: store.collection<NaverUser>("naver.users", ["naver_id", "email"]),
    authCodes: store.collection<NaverAuthCode>("naver.auth_codes", ["code"]),
    tokens: store.collection<NaverToken>("naver.tokens", ["access_token", "refresh_token"]),
  };
}
