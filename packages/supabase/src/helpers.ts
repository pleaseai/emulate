import { randomUUID } from "crypto";
import type { Context, ContentfulStatusCode, Store } from "@emulators/core";
import type { SupabaseUser, SupabaseSession } from "./entities.js";
import { getKeys, getSupabaseStore } from "./store.js";

export function generateUuid(): string {
  return randomUUID();
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Build an unsigned, JWT-shaped access token: base64url(header).base64url(payload).<sig>
 * The signature segment is a static placeholder — this emulator does not verify
 * signatures; the token string itself is looked up in the sessions collection.
 */
export function buildAccessToken(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  // Unsigned: deterministic-but-unique placeholder signature.
  const sig = base64url(randomUUID()).replace(/=+$/, "");
  return `${header}.${body}.${sig}`;
}

export function generateRefreshToken(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Verify that the request carries a valid `apikey` header (or an `Authorization:
 * Bearer <key>` that equals the anon or service_role key). Returns a 401 Response
 * when missing/unknown, otherwise null.
 */
export function requireApiKey(c: Context, store: Store): Response | null {
  const keys = getKeys(store);
  const known = new Set([keys.anon_key, keys.service_role_key].filter(Boolean));

  let provided = c.req.header("apikey");
  if (!provided) {
    const auth = c.req.header("Authorization") ?? c.req.header("authorization");
    if (auth) {
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (known.has(token)) provided = token;
    }
  }

  if (!provided || !known.has(provided)) {
    return c.json(
      {
        message: "No API key found in request",
        hint: "No 'apikey' request header or url param was found.",
      },
      401,
    );
  }
  return null;
}

/** GoTrue-style auth error (current format with error_code). */
export function authError(c: Context, status: number, errorCode: string, msg: string): Response {
  return c.json({ code: status, error_code: errorCode, msg }, status as ContentfulStatusCode);
}

/** PostgREST-style error. */
export function pgError(
  c: Context,
  status: number,
  body: { code: string; details: unknown; hint: unknown; message: string },
): Response {
  return c.json(body, status as ContentfulStatusCode);
}

export function formatUser(u: SupabaseUser): Record<string, unknown> {
  return {
    id: u.user_id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    phone: "",
    confirmed_at: u.confirmed_at,
    last_sign_in_at: u.last_sign_in_at,
    app_metadata: u.app_metadata,
    user_metadata: u.user_metadata,
    identities: [],
    created_at: u.user_created_at,
    updated_at: u.user_updated_at,
  };
}

const ACCESS_TOKEN_TTL = 3600; // seconds

/**
 * Create a fresh session for a user: new access_token (JWT-shaped) + refresh_token,
 * persisted to the sessions collection. Returns the GoTrue session response body.
 */
export function createSession(store: Store, user: SupabaseUser): Record<string, unknown> {
  const ss = getSupabaseStore(store);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + ACCESS_TOKEN_TTL;
  const sessionId = generateUuid();

  const accessToken = buildAccessToken({
    sub: user.user_id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    exp: expiresAt,
    iat: nowSec,
    session_id: sessionId,
  });
  const refreshToken = generateRefreshToken();

  ss.sessions.insert({
    session_id: sessionId,
    user_id: user.user_id,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    revoked: false,
  });

  // Mark sign-in.
  ss.users.update(user.id, { last_sign_in_at: new Date().toISOString() });

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: formatUser({ ...user, last_sign_in_at: new Date().toISOString() }),
  };
}

/** Resolve the bearer access_token to a live (non-revoked) session, or undefined. */
export function sessionFromBearer(store: Store, c: Context): SupabaseSession | undefined {
  const auth = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!auth) return undefined;
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return undefined;
  const ss = getSupabaseStore(store);
  const session = ss.sessions.findOneBy("access_token", token);
  if (!session || session.revoked) return undefined;
  return session;
}
