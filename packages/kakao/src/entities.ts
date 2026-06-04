import type { Entity } from "@emulators/core";

export interface KakaoApp extends Entity {
  client_id: string; // REST API 키
  client_secret: string | null;
  redirect_uris: string[];
  // unlink된(연결 해제된) 사용자의 카카오 회원번호 목록
  unlinked_user_ids: number[];
}

export interface KakaoUser extends Entity {
  user_id: number; // 카카오 회원번호 (외부 노출 id)
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
  expires_at: number; // access_token 만료 epoch ms
  refresh_expires_at: number; // refresh_token 만료 epoch ms
  active: boolean;
}

export interface KakaoMemo extends Entity {
  user_id: number;
  template_object: unknown;
}
