import type { RouteContext, Context } from "@emulators/core";
import { getKakaoStore, type KakaoStore } from "../store.js";
import { kapiError, parseKakaoBody, extractBearer } from "../helpers.js";
import type { KakaoToken, KakaoUser } from "../entities.js";

/** Look up the active token + user by access_token. null if invalid. */
function resolveAuth(
  c: Context,
  ks: KakaoStore,
): { token: KakaoToken; user: KakaoUser } | null {
  const accessToken = extractBearer(c);
  if (!accessToken) return null;
  const token = ks.tokens.findOneBy("access_token", accessToken);
  if (!token || !token.active) return null;
  if (Date.now() > token.expires_at) return null;
  const user = ks.users.findOneBy("user_id", token.user_id);
  if (!user) return null;
  return { token, user };
}

export function userRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = (): KakaoStore => getKakaoStore(store);

  const me = (c: Context) => {
    const auth = resolveAuth(c, ks());
    if (!auth) return kapiError(c, 401, "this access token does not exist", -401);
    return c.json(formatUserMe(auth.user));
  };
  app.get("/v2/user/me", me);
  app.post("/v2/user/me", me);

  app.get("/v1/user/access_token_info", (c) => {
    const auth = resolveAuth(c, ks());
    if (!auth) return kapiError(c, 401, "this access token does not exist", -401);
    const expiresIn = Math.max(0, Math.floor((auth.token.expires_at - Date.now()) / 1000));
    // Reproduce app_id as a stable numeric value derived from client_id
    return c.json({
      id: auth.user.user_id,
      expires_in: expiresIn,
      app_id: appIdFromClientId(auth.token.client_id),
    });
  });

  app.post("/v1/user/logout", (c) => {
    const auth = resolveAuth(c, ks());
    if (!auth) return kapiError(c, 401, "this access token does not exist", -401);
    // Invalidate only this access_token
    ks().tokens.update(auth.token.id, { active: false });
    return c.json({ id: auth.user.user_id });
  });

  app.post("/v1/user/unlink", (c) => {
    const auth = resolveAuth(c, ks());
    if (!auth) return kapiError(c, 401, "this access token does not exist", -401);
    const userId = auth.user.user_id;
    // Invalidate all tokens for this user
    for (const t of ks().tokens.all()) {
      if (t.user_id === userId) ks().tokens.update(t.id, { active: false });
    }
    // Record the app disconnection
    const appRec = ks().apps.findOneBy("client_id", auth.token.client_id);
    if (appRec && !appRec.unlinked_user_ids.includes(userId)) {
      ks().apps.update(appRec.id, {
        unlinked_user_ids: [...appRec.unlinked_user_ids, userId],
      });
    }
    return c.json({ id: userId });
  });

  // POST /v2/api/talk/memo/default/send — send a message to myself
  app.post("/v2/api/talk/memo/default/send", async (c) => {
    const auth = resolveAuth(c, ks());
    if (!auth) return kapiError(c, 401, "this access token does not exist", -401);

    const body = await parseKakaoBody(c);
    const raw = body.template_object;
    if (raw === undefined || raw === null || raw === "") {
      return kapiError(c, 400, "template_object is required", -2);
    }
    let template: unknown;
    try {
      template = JSON.parse(raw);
    } catch {
      return kapiError(c, 400, "failed to parse template_object as JSON", -2);
    }

    ks().memos.insert({ user_id: auth.user.user_id, template_object: template });
    return c.json({ result_code: 0 });
  });

  // GET /internal/talk/memos — inbox for inspection
  app.get("/internal/talk/memos", (c) => {
    const memos = ks()
      .memos.all()
      .map((m) => ({
        id: m.id,
        user_id: m.user_id,
        template_object: m.template_object,
        created_at: m.created_at,
      }));
    return c.json({ memos });
  });
}

function appIdFromClientId(clientId: string): number {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = (hash * 31 + clientId.charCodeAt(i)) % 1_000_000_000;
  }
  return hash;
}

function formatUserMe(user: KakaoUser) {
  const profileImage = user.profile_image_url ?? null;
  const properties: Record<string, string> = { nickname: user.nickname };
  if (profileImage) {
    properties.profile_image = profileImage;
    properties.thumbnail_image = profileImage;
  }

  const profile: Record<string, unknown> = {
    nickname: user.nickname,
    thumbnail_image_url: profileImage ?? "",
    profile_image_url: profileImage ?? "",
    is_default_image: profileImage ? false : true,
  };

  const kakaoAccount: Record<string, unknown> = {
    profile_nickname_needs_agreement: false,
    profile_image_needs_agreement: false,
    profile,
  };

  if (user.email) {
    kakaoAccount.has_email = true;
    kakaoAccount.email_needs_agreement = false;
    kakaoAccount.is_email_valid = true;
    kakaoAccount.is_email_verified = true;
    kakaoAccount.email = user.email;
  } else {
    kakaoAccount.has_email = false;
  }

  return {
    id: user.user_id,
    connected_at: user.connected_at,
    properties,
    kakao_account: kakaoAccount,
  };
}
