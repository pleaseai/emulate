import type { RouteContext } from "@emulators/core";
import { getFirebaseStore } from "../store.js";
import type { FirebaseStore } from "../store.js";

export function internalRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const fs = (): FirebaseStore => getFirebaseStore(store);

  app.get("/internal/messages", (c) => {
    const messages = fs()
      .messages.all()
      .map((m) => ({
        messageId: m.message_id,
        name: `projects/${m.project_id}/messages/${m.message_id}`,
        projectId: m.project_id,
        token: m.token,
        topic: m.topic,
        condition: m.condition,
        notification: m.notification,
        data: m.data,
        android: m.android,
        apns: m.apns,
        webpush: m.webpush,
        createdAt: m.created_at,
      }));
    return c.json({ messages });
  });

  app.get("/internal/oob_codes", (c) => {
    const oobCodes = fs()
      .oobCodes.all()
      .map((o) => ({
        email: o.email,
        requestType: o.request_type,
        oobCode: o.oob_code,
        localId: o.local_id,
        createdAt: o.created_at,
      }));
    return c.json({ oobCodes });
  });
}
