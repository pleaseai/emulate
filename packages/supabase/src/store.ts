import { Store, type Collection } from "@emulators/core";
import type { SupabaseUser, SupabaseSession, SupabaseRow, SupabaseRecovery } from "./entities.js";

export interface SupabaseKeys {
  anon_key: string;
  service_role_key: string;
}

export interface SupabaseStore {
  users: Collection<SupabaseUser>;
  sessions: Collection<SupabaseSession>;
  rows: Collection<SupabaseRow>;
  recoveries: Collection<SupabaseRecovery>;
}

export function getSupabaseStore(store: Store): SupabaseStore {
  return {
    users: store.collection<SupabaseUser>("supabase.users", ["user_id", "email"]),
    sessions: store.collection<SupabaseSession>("supabase.sessions", ["access_token", "refresh_token"]),
    rows: store.collection<SupabaseRow>("supabase.rows", ["table"]),
    recoveries: store.collection<SupabaseRecovery>("supabase.recoveries", []),
  };
}

export function getKeys(store: Store): SupabaseKeys {
  return store.getData<SupabaseKeys>("supabase.keys") ?? { anon_key: "", service_role_key: "" };
}

export function setKeys(store: Store, keys: SupabaseKeys): void {
  store.setData<SupabaseKeys>("supabase.keys", keys);
}
