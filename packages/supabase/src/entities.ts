import type { Entity } from "@emulators/core";

/** A Supabase auth user (GoTrue). External id is the `user_id` uuid. */
export interface SupabaseUser extends Entity {
  user_id: string; // uuid exposed as user.id
  email: string;
  password: string; // plaintext (emulator only)
  email_confirmed_at: string;
  confirmed_at: string;
  last_sign_in_at: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
  user_created_at: string;
  user_updated_at: string;
}

/** An active auth session. Tokens are unsigned JWT-shaped strings. */
export interface SupabaseSession extends Entity {
  session_id: string; // uuid
  user_id: string; // SupabaseUser.user_id
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  revoked: boolean;
}

/**
 * A single PostgREST table row. The user-defined row data (including its own
 * `id` column) lives inside `data`. Stored in one collection keyed by `table`.
 */
export interface SupabaseRow extends Entity {
  table: string;
  data: Record<string, unknown>;
}

/** A password recovery request (email sending is faked; recorded for inspection). */
export interface SupabaseRecovery extends Entity {
  email: string;
}
