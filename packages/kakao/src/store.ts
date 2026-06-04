import { Store, type Collection } from "@emulators/core";
import type { KakaoApp, KakaoUser, KakaoAuthCode, KakaoToken, KakaoMemo } from "./entities.js";

export interface KakaoStore {
  apps: Collection<KakaoApp>;
  users: Collection<KakaoUser>;
  authCodes: Collection<KakaoAuthCode>;
  tokens: Collection<KakaoToken>;
  memos: Collection<KakaoMemo>;
}

export function getKakaoStore(store: Store): KakaoStore {
  return {
    apps: store.collection<KakaoApp>("kakao.apps", ["client_id"]),
    users: store.collection<KakaoUser>("kakao.users", ["user_id", "email"]),
    authCodes: store.collection<KakaoAuthCode>("kakao.auth_codes", ["code"]),
    tokens: store.collection<KakaoToken>("kakao.tokens", ["access_token", "refresh_token"]),
    memos: store.collection<KakaoMemo>("kakao.memos", ["user_id"]),
  };
}
