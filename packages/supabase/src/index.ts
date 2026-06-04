import type { Hono } from "@emulators/core";
import type { ServicePlugin, Store, WebhookDispatcher, TokenMap, AppEnv, RouteContext } from "@emulators/core";
import { getSupabaseStore, getKeys, setKeys } from "./store.js";
import { generateUuid } from "./helpers.js";
import { authRoutes } from "./routes/auth.js";
import { restRoutes } from "./routes/rest.js";
import { internalRoutes } from "./routes/internal.js";

export { getSupabaseStore, getKeys, setKeys, type SupabaseStore, type SupabaseKeys } from "./store.js";
export * from "./entities.js";

export interface SupabaseSeedConfig {
  port?: number;
  anon_key?: string;
  service_role_key?: string;
  users?: Array<{
    email: string;
    password?: string;
    data?: Record<string, unknown>;
  }>;
  tables?: Record<string, Array<Record<string, unknown>>>;
}

const DEFAULT_ANON_KEY = "supabase-anon-key";
const DEFAULT_SERVICE_ROLE_KEY = "supabase-service-role-key";

function seedUser(
  store: Store,
  email: string,
  password: string,
  metadata: Record<string, unknown>,
): void {
  const ss = getSupabaseStore(store);
  if (ss.users.findOneBy("email", email)) return;
  const now = new Date().toISOString();
  ss.users.insert({
    user_id: generateUuid(),
    email,
    password,
    email_confirmed_at: now,
    confirmed_at: now,
    last_sign_in_at: now,
    user_metadata: metadata,
    app_metadata: { provider: "email", providers: ["email"] },
    user_created_at: now,
    user_updated_at: now,
  });
}

function seedTables(store: Store, tables: Record<string, Array<Record<string, unknown>>>): void {
  const ss = getSupabaseStore(store);
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      ss.rows.insert({ table, data: { ...row } });
    }
  }
}

export function seedFromConfig(
  store: Store,
  _baseUrl: string,
  config: SupabaseSeedConfig,
  _webhooks?: WebhookDispatcher,
): void {
  // Override keys from config if provided, otherwise keep whatever seed() set.
  const current = getKeys(store);
  setKeys(store, {
    anon_key: config.anon_key ?? current.anon_key ?? DEFAULT_ANON_KEY,
    service_role_key: config.service_role_key ?? current.service_role_key ?? DEFAULT_SERVICE_ROLE_KEY,
  });

  if (config.users) {
    for (const u of config.users) {
      seedUser(store, u.email, u.password ?? "", u.data ?? {});
    }
  }

  if (config.tables) {
    seedTables(store, config.tables);
  }
}

export const supabasePlugin: ServicePlugin = {
  name: "supabase",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    authRoutes(ctx);
    restRoutes(ctx);
    internalRoutes(ctx);
  },
  seed(store: Store, _baseUrl: string): void {
    // Seed default API keys only if none have been set yet.
    if (!store.getData("supabase.keys")) {
      setKeys(store, { anon_key: DEFAULT_ANON_KEY, service_role_key: DEFAULT_SERVICE_ROLE_KEY });
    }
  },
};

export default supabasePlugin;
