import type { RouteContext } from "@emulators/core";
import { getNaverStore } from "../store.js";
import { extractBearerToken, formatProfileResponse, authFailed } from "../helpers.js";

export function profileRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ns = () => getNaverStore(store);

  // GET /v1/nid/me — user profile
  app.get("/v1/nid/me", (c) => {
    const token = extractBearerToken(c);
    if (!token) return authFailed(c);

    const tokenRecord = ns().tokens.findOneBy("access_token", token);
    if (!tokenRecord || tokenRecord.revoked || tokenRecord.expires_at < Date.now()) {
      return authFailed(c);
    }

    const user = ns().users.findOneBy("naver_id", tokenRecord.naver_id);
    if (!user) return authFailed(c);

    return c.json({
      resultcode: "00",
      message: "success",
      response: formatProfileResponse(user),
    });
  });

  // GET /v1/nid/verify — token verification
  app.get("/v1/nid/verify", (c) => {
    const token = extractBearerToken(c);
    if (!token) return authFailed(c);

    const tokenRecord = ns().tokens.findOneBy("access_token", token);
    if (!tokenRecord || tokenRecord.revoked || tokenRecord.expires_at < Date.now()) {
      return authFailed(c);
    }

    return c.json({
      resultcode: "00",
      message: "success",
      response: { token },
    });
  });
}
