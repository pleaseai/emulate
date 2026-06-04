import type { RouteContext, Context } from "@emulators/core";
import { getFirebaseStore } from "../store.js";
import { createIdToken, generateRefreshToken } from "../helpers.js";
import type { FirebaseStore } from "../store.js";

const TOKEN_PREFIXES = ["/v1/token", "/securetoken.googleapis.com/v1/token"];

export function tokenRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const fs = (): FirebaseStore => getFirebaseStore(store);

  for (const path of TOKEN_PREFIXES) {
    app.post(path, async (c) => handleRefresh(c, fs));
  }
}

async function handleRefresh(c: Context, fs: () => FirebaseStore) {
  const body = await parseTokenBody(c);
  const grantType = body.grant_type;
  const refreshToken = body.refresh_token;

  if (grantType !== "refresh_token" || !refreshToken) {
    return invalidRefresh(c);
  }

  const s = fs();
  const stored = s.tokens.findOneBy("refresh_token", refreshToken);
  if (!stored) return invalidRefresh(c);

  const user = s.users.findOneBy("local_id", stored.local_id);
  if (!user) return invalidRefresh(c);

  // Rotate the id token; keep the refresh token stable (Firebase reuses it).
  const { token, exp } = createIdToken(user);
  const newRefresh = generateRefreshToken();
  s.tokens.update(stored.id, {
    id_token: token,
    refresh_token: newRefresh,
    expires_at: exp,
  });
  s.users.update(user.id, { last_refresh_at: new Date().toISOString() });

  return c.json({
    access_token: token,
    expires_in: "3600",
    token_type: "Bearer",
    refresh_token: newRefresh,
    id_token: token,
    user_id: user.local_id,
    project_id: user.project_id,
  });
}

function invalidRefresh(c: Context) {
  return c.json(
    {
      error: {
        code: 400,
        message: "INVALID_REFRESH_TOKEN",
      },
    },
    400,
  );
}

async function parseTokenBody(c: Context): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await c.req.json().catch(() => ({}));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json ?? {})) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  // Default: treat as form-encoded (Firebase SDK sends urlencoded).
  const text = await c.req.text().catch(() => "");
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}
