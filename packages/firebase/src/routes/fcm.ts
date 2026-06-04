import type { RouteContext } from "@emulators/core";
import { getFirebaseStore } from "../store.js";
import { generateUuid, googleError } from "../helpers.js";
import type { FirebaseStore } from "../store.js";

export function fcmRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const fs = (): FirebaseStore => getFirebaseStore(store);

  app.post("/v1/projects/:projectId/messages:send", async (c) => {
    const projectId = c.req.param("projectId");

    // Real FCM uses OAuth2 bearer tokens; the emulator only checks presence.
    const auth = c.req.header("Authorization");
    if (!auth || !/^Bearer\s+\S+/i.test(auth)) {
      return c.json(
        {
          error: {
            code: 401,
            message: "Request is missing required authentication credential.",
            status: "UNAUTHENTICATED",
          },
        },
        401,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const message = body?.message;
    if (!message || typeof message !== "object") {
      return googleError(c, "Invalid JSON payload received. Missing 'message' field.");
    }

    const hasToken = typeof message.token === "string" && message.token.length > 0;
    const hasTopic = typeof message.topic === "string" && message.topic.length > 0;
    const hasCondition = typeof message.condition === "string" && message.condition.length > 0;
    if (!hasToken && !hasTopic && !hasCondition) {
      return googleError(
        c,
        "Invalid message: one of 'token', 'topic' or 'condition' is required.",
      );
    }

    const messageId = generateUuid().replace(/-/g, "");
    const name = `projects/${projectId}/messages/${messageId}`;

    if (body.validate_only === true) {
      return c.json({ name });
    }

    const s = fs();
    s.messages.insert({
      message_id: messageId,
      project_id: projectId,
      token: hasToken ? message.token : null,
      topic: hasTopic ? message.topic : null,
      condition: hasCondition ? message.condition : null,
      notification: (message.notification as Record<string, unknown>) ?? null,
      data: (message.data as Record<string, unknown>) ?? null,
      android: (message.android as Record<string, unknown>) ?? null,
      apns: (message.apns as Record<string, unknown>) ?? null,
      webpush: (message.webpush as Record<string, unknown>) ?? null,
    });

    return c.json({ name });
  });
}
