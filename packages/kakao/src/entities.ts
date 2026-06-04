import type { Entity } from "@emulators/core";

export interface KakaoApp extends Entity {
  client_id: string; // REST API key
  client_secret: string | null;
  redirect_uris: string[];
  // List of Kakao member numbers of unlinked (disconnected) users
  unlinked_user_ids: number[];
}

export interface KakaoUser extends Entity {
  user_id: number; // Kakao member number (externally exposed id)
  nickname: string;
  email: string | null;
  profile_image_url: string | null;
  connected_at: string;
}

export interface KakaoAuthCode extends Entity {
  code: string;
  client_id: string;
  user_id: number;
  redirect_uri: string;
  scope: string;
  state: string | null;
  expires_at: number; // epoch ms
  used: boolean;
}

export interface KakaoToken extends Entity {
  access_token: string;
  refresh_token: string;
  client_id: string;
  user_id: number;
  scope: string;
  expires_at: number; // access_token expiry epoch ms
  refresh_expires_at: number; // refresh_token expiry epoch ms
  active: boolean;
}

export interface KakaoMemo extends Entity {
  user_id: number;
  template_object: unknown;
}
