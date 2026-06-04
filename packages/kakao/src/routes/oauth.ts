import type { RouteContext, Context } from "@emulators/core";
import {
  renderCardPage,
  renderErrorPage,
  renderUserButton,
  matchesRedirectUri,
  constantTimeSecretEqual,
} from "@emulators/core";
import { getKakaoStore, type KakaoStore } from "../store.js";
import { randomToken, oauthError, parseKakaoBody } from "../helpers.js";

const CODE_TTL_MS = 10 * 60 * 1000; // authorization code 10 minutes
const ACCESS_TOKEN_TTL_S = 21599; // about 6 hours
const REFRESH_TOKEN_TTL_S = 5183999; // about 60 days
const DEFAULT_SCOPE = "profile_nickname profile_image account_email";

export function oauthRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = (): KakaoStore => getKakaoStore(store);

  // GET /oauth/authorize — login page or immediate authorization code issuance
  app.get("/oauth/authorize", (c) => {
    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const responseType = c.req.query("response_type");
    const state = c.req.query("state") ?? null;
    const scope = c.req.query("scope") ?? DEFAULT_SCOPE;

    if (!clientId) {
      return c.html(
        renderErrorPage("KOE101", "App disabled or not found for the given client_id.", "kakao"),
        401,
      );
    }
    const appRec = ks().apps.findOneBy("client_id", clientId);
    if (!appRec) {
      // KOE101: nonexistent client_id
      return c.html(
        renderErrorPage(
          "KOE101",
          `App disabled or not found for the given client_id (${clientId}).`,
          "kakao",
        ),
        401,
      );
    }

    if (!redirectUri || !matchesRedirectUri(redirectUri, appRec.redirect_uris)) {
      // KOE006: unregistered redirect_uri
      return c.html(
        renderErrorPage(
          "KOE006",
          `Invalid redirect_uri. The redirect_uri (${redirectUri ?? ""}) is not registered.`,
          "kakao",
        ),
        401,
      );
    }

    if (responseType && responseType !== "code") {
      return c.html(
        renderErrorPage("KOE002", `Unsupported response_type (${responseType}).`, "kakao"),
        400,
      );
    }

    // If ?user_id=<kakao member number> is present, approve immediately
    const userIdParam = c.req.query("user_id");
    if (userIdParam) {
      const userId = Number(userIdParam);
      const user = ks().users.findOneBy("user_id", userId);
      if (!user) {
        return c.html(
          renderErrorPage("Login failed", `Unknown user_id (${userIdParam}).`, "kakao"),
          400,
        );
      }
      const code = issueCode(ks(), clientId, userId, redirectUri, scope, state);
      const url = new URL(redirectUri);
      url.searchParams.set("code", code);
      if (state) url.searchParams.set("state", state);
      return c.redirect(url.toString(), 302);
    }

    // Render the login page: seeded user list as buttons
    const users = ks().users.all();
    const buttons = users
      .map((u) => {
        const selfUrl = new URL(c.req.url);
        selfUrl.searchParams.set("user_id", String(u.user_id));
        return renderUserButton({
          letter: (u.nickname || "?").charAt(0).toUpperCase(),
          login: u.nickname,
          email: u.email ?? undefined,
          formAction: selfUrl.pathname + selfUrl.search,
          hiddenFields: {},
        });
      })
      .join("\n");

    const body =
      users.length > 0
        ? buttons
        : `<p class="empty">No seeded Kakao users. Add users via seed config.</p>`;

    return c.html(
      renderCardPage("카카오계정으로 로그인", "Choose an account to continue", body, "kakao"),
    );
  });

  // The login page buttons also work via POST (renderUserButton uses method=post)
  app.post("/oauth/authorize", (c) => {
    const url = new URL(c.req.url);
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const scope = url.searchParams.get("scope") ?? DEFAULT_SCOPE;
    const userIdParam = url.searchParams.get("user_id");

    if (!clientId || !redirectUri || !userIdParam) {
      return c.html(renderErrorPage("Login failed", "Missing required parameters.", "kakao"), 400);
    }
    const appRec = ks().apps.findOneBy("client_id", clientId);
    if (!appRec || !matchesRedirectUri(redirectUri, appRec.redirect_uris)) {
      return c.html(renderErrorPage("KOE006", "Invalid request.", "kakao"), 401);
    }
    const userId = Number(userIdParam);
    const user = ks().users.findOneBy("user_id", userId);
    if (!user) {
      return c.html(
        renderErrorPage("Login failed", `Unknown user_id (${userIdParam}).`, "kakao"),
        400,
      );
    }

    const code = issueCode(ks(), clientId, userId, redirectUri, scope, state);
    const out = new URL(redirectUri);
    out.searchParams.set("code", code);
    if (state) out.searchParams.set("state", state);
    return c.redirect(out.toString(), 302);
  });

  // POST /oauth/token — token issuance/refresh
  app.post("/oauth/token", async (c) => {
    const body = await parseKakaoBody(c);
    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      return handleAuthorizationCode(c, body, ks());
    }
    if (grantType === "refresh_token") {
      return handleRefreshToken(c, body, ks());
    }
    return oauthError(
      c,
      400,
      "unsupported_grant_type",
      `Unsupported grant_type (${grantType ?? "none"}).`,
      "KOE304",
    );
  });
}

function issueCode(
  ks: KakaoStore,
  clientId: string,
  userId: number,
  redirectUri: string,
  scope: string,
  state: string | null,
): string {
  const code = randomToken();
  ks.authCodes.insert({
    code,
    client_id: clientId,
    user_id: userId,
    redirect_uri: redirectUri,
    scope,
    state,
    expires_at: Date.now() + CODE_TTL_MS,
    used: false,
  });
  return code;
}

function handleAuthorizationCode(c: Context, body: Record<string, string>, ks: KakaoStore) {
  const { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri } = body;

  if (!code) {
    return oauthError(c, 400, "invalid_request", "Missing required parameter: code.", "KOE320");
  }
  if (!clientId) {
    return oauthError(c, 400, "invalid_request", "Missing required parameter: client_id.", "KOE101");
  }

  const codeRec = ks.authCodes.findOneBy("code", code);
  if (!codeRec) {
    return oauthError(c, 400, "invalid_grant", "authorization code not found.", "KOE320");
  }
  if (codeRec.used) {
    return oauthError(c, 400, "invalid_grant", "authorization code already used.", "KOE320");
  }
  if (Date.now() > codeRec.expires_at) {
    return oauthError(c, 400, "invalid_grant", "authorization code expired.", "KOE320");
  }
  if (codeRec.client_id !== clientId) {
    return oauthError(c, 401, "invalid_client", "client_id does not match.", "KOE303");
  }
  if (redirectUri && redirectUri !== codeRec.redirect_uri) {
    return oauthError(c, 400, "invalid_grant", "redirect_uri mismatch.", "KOE320");
  }

  const appRec = ks.apps.findOneBy("client_id", clientId);
  if (!appRec) {
    return oauthError(c, 401, "invalid_client", "App not found for the given client_id.", "KOE101");
  }
  // client_secret verification (when a secret is configured on the app)
  if (appRec.client_secret) {
    if (!clientSecret || !constantTimeSecretEqual(clientSecret, appRec.client_secret)) {
      return oauthError(c, 401, "invalid_client", "client_secret does not match.", "KOE010");
    }
  }

  ks.authCodes.update(codeRec.id, { used: true });

  const now = Date.now();
  const accessToken = randomToken();
  const refreshToken = randomToken();
  ks.tokens.insert({
    access_token: accessToken,
    refresh_token: refreshToken,
    client_id: clientId,
    user_id: codeRec.user_id,
    scope: codeRec.scope,
    expires_at: now + ACCESS_TOKEN_TTL_S * 1000,
    refresh_expires_at: now + REFRESH_TOKEN_TTL_S * 1000,
    active: true,
  });

  return c.json({
    token_type: "bearer",
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    refresh_token_expires_in: REFRESH_TOKEN_TTL_S,
    scope: codeRec.scope,
  });
}

function handleRefreshToken(c: Context, body: Record<string, string>, ks: KakaoStore) {
  const { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret } = body;

  if (!refreshToken) {
    return oauthError(
      c,
      400,
      "invalid_request",
      "Missing required parameter: refresh_token.",
      "KOE320",
    );
  }
  if (!clientId) {
    return oauthError(c, 400, "invalid_request", "Missing required parameter: client_id.", "KOE101");
  }

  const tokenRec = ks.tokens.findOneBy("refresh_token", refreshToken);
  if (!tokenRec || !tokenRec.active) {
    return oauthError(c, 400, "invalid_grant", "refresh token not found.", "KOE320");
  }
  if (Date.now() > tokenRec.refresh_expires_at) {
    return oauthError(c, 400, "invalid_grant", "refresh token expired.", "KOE320");
  }
  if (tokenRec.client_id !== clientId) {
    return oauthError(c, 401, "invalid_client", "client_id does not match.", "KOE303");
  }

  const appRec = ks.apps.findOneBy("client_id", clientId);
  if (!appRec) {
    return oauthError(c, 401, "invalid_client", "App not found for the given client_id.", "KOE101");
  }
  if (appRec.client_secret) {
    if (!clientSecret || !constantTimeSecretEqual(clientSecret, appRec.client_secret)) {
      return oauthError(c, 401, "invalid_client", "client_secret does not match.", "KOE010");
    }
  }

  const now = Date.now();
  const newAccessToken = randomToken();
  // Simplification: the refresh_token is always kept
  ks.tokens.update(tokenRec.id, {
    access_token: newAccessToken,
    expires_at: now + ACCESS_TOKEN_TTL_S * 1000,
    active: true,
  });

  return c.json({
    token_type: "bearer",
    access_token: newAccessToken,
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: tokenRec.refresh_token,
    refresh_token_expires_in: Math.max(0, Math.floor((tokenRec.refresh_expires_at - now) / 1000)),
    scope: tokenRec.scope,
  });
}
