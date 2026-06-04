import type { RouteContext } from "@emulators/core";
import { getSupabaseStore } from "../store.js";
import type { SupabaseUser } from "../entities.js";
import {
  authError,
  createSession,
  formatUser,
  generateUuid,
  requireApiKey,
  sessionFromBearer,
} from "../helpers.js";

function newUser(email: string, password: string, metadata: Record<string, unknown> = {}): Omit<
  SupabaseUser,
  "id" | "created_at" | "updated_at"
> {
  const now = new Date().toISOString();
  return {
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
  };
}

export function authRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ss = () => getSupabaseStore(store);

  // POST /auth/v1/signup
  app.post("/auth/v1/signup", async (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      data?: Record<string, unknown>;
    };
    const email = body.email;
    const password = body.password ?? "";
    if (!email) {
      return authError(c, 400, "validation_failed", "Unable to validate email address: invalid format");
    }

    const existing = ss().users.findOneBy("email", email);
    if (existing) {
      return authError(c, 422, "user_already_exists", "User already registered");
    }

    const created = ss().users.insert(newUser(email, password, body.data ?? {}));
    // Auto-confirm: return a session immediately.
    return c.json(createSession(store, created), 200);
  });

  // POST /auth/v1/token?grant_type=password|refresh_token
  app.post("/auth/v1/token", async (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const grantType = c.req.query("grant_type");
    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      refresh_token?: string;
    };

    if (grantType === "password") {
      const user = body.email ? ss().users.findOneBy("email", body.email) : undefined;
      if (!user || user.password !== body.password) {
        return authError(c, 400, "invalid_credentials", "Invalid login credentials");
      }
      return c.json(createSession(store, user), 200);
    }

    if (grantType === "refresh_token") {
      const token = body.refresh_token;
      const session = token ? ss().sessions.findOneBy("refresh_token", token) : undefined;
      if (!session || session.revoked) {
        return authError(c, 400, "invalid_grant", "Invalid Refresh Token: Already Used");
      }
      const user = ss().users.findOneBy("user_id", session.user_id);
      if (!user) {
        return authError(c, 400, "invalid_grant", "Invalid Refresh Token: User Not Found");
      }
      // Rotation: revoke the old session and issue a brand-new one.
      ss().sessions.update(session.id, { revoked: true });
      return c.json(createSession(store, user), 200);
    }

    return authError(c, 400, "unsupported_grant_type", `Unsupported grant_type: ${grantType ?? ""}`);
  });

  // GET /auth/v1/user
  app.get("/auth/v1/user", (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const session = sessionFromBearer(store, c);
    if (!session) {
      return authError(c, 401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    }
    const user = ss().users.findOneBy("user_id", session.user_id);
    if (!user) {
      return authError(c, 401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    }
    return c.json(formatUser(user), 200);
  });

  // PUT /auth/v1/user
  app.put("/auth/v1/user", async (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const session = sessionFromBearer(store, c);
    if (!session) {
      return authError(c, 401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    }
    const user = ss().users.findOneBy("user_id", session.user_id);
    if (!user) {
      return authError(c, 401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      data?: Record<string, unknown>;
    };

    const patch: Partial<SupabaseUser> = { user_updated_at: new Date().toISOString() };
    if (typeof body.email === "string") patch.email = body.email;
    if (typeof body.password === "string") patch.password = body.password;
    if (body.data && typeof body.data === "object") {
      patch.user_metadata = { ...user.user_metadata, ...body.data };
    }

    const updated = ss().users.update(user.id, patch);
    return c.json(formatUser(updated ?? user), 200);
  });

  // POST /auth/v1/logout
  app.post("/auth/v1/logout", (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const session = sessionFromBearer(store, c);
    if (session) {
      ss().sessions.update(session.id, { revoked: true });
    }
    return c.body(null, 204);
  });

  // POST /auth/v1/recover
  app.post("/auth/v1/recover", async (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (body.email) {
      ss().recoveries.insert({ email: body.email });
    }
    // Always 200 regardless of whether the user exists (no user enumeration).
    return c.json({}, 200);
  });
}
