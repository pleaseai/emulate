import type { Entity } from "@emulators/core";

export interface FirebaseProject extends Entity {
  project_id: string;
  api_key: string;
}

export interface FirebaseUser extends Entity {
  local_id: string;
  project_id: string;
  email: string | null;
  password: string | null;
  display_name: string | null;
  email_verified: boolean;
  provider: "password" | "anonymous";
  valid_since: string;
  last_login_at: string;
  last_refresh_at: string;
}

export interface FirebaseToken extends Entity {
  id_token: string;
  refresh_token: string;
  local_id: string;
  project_id: string;
  /** Unix seconds expiry of the id token. */
  expires_at: number;
}

export interface FirebaseMessage extends Entity {
  message_id: string;
  project_id: string;
  token: string | null;
  topic: string | null;
  condition: string | null;
  notification: Record<string, unknown> | null;
  data: Record<string, unknown> | null;
  android: Record<string, unknown> | null;
  apns: Record<string, unknown> | null;
  webpush: Record<string, unknown> | null;
}

export interface FirebaseOobCode extends Entity {
  oob_code: string;
  request_type: "PASSWORD_RESET" | "VERIFY_EMAIL" | string;
  email: string;
  local_id: string | null;
}
