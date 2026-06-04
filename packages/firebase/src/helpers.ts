import { randomUUID } from "crypto";
import type { Context, ContentfulStatusCode } from "@emulators/core";
import type { Store } from "@emulators/core";
import { getFirebaseStore } from "./store.js";
import type { FirebaseUser } from "./entities.js";

export function generateUuid(): string {
  return randomUUID();
}

/** Firebase local IDs are 28-char alphanumeric strings. */
export function generateLocalId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 28; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateRefreshToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

function base64url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64url");
}

export interface IdTokenPayload {
  iss: string;
  aud: string;
  auth_time: number;
  user_id: string;
  sub: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  firebase: {
    identities: Record<string, unknown>;
    sign_in_provider: "password" | "anonymous";
  };
}

/**
 * Builds an unsigned-but-JWT-shaped token. The signature segment is a fixed
 * literal — the emulator does not perform real signature verification, it
 * validates tokens against the stored `firebase.tokens` collection instead.
 */
export function createIdToken(user: FirebaseUser): { token: string; iat: number; exp: number } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const provider = user.provider;
  const identities: Record<string, unknown> = {};
  if (user.email) {
    identities.email = [user.email];
  }
  const payload: IdTokenPayload = {
    iss: `https://securetoken.google.com/${user.project_id}`,
    aud: user.project_id,
    auth_time: iat,
    user_id: user.local_id,
    sub: user.local_id,
    iat,
    exp,
    firebase: {
      identities,
      sign_in_provider: provider,
    },
  };
  if (user.email) {
    payload.email = user.email;
    payload.email_verified = user.email_verified;
  }
  const header = { alg: "none", kid: "emulator", typ: "JWT" };
  const token = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}.${base64url(
    "emulator-signature",
  )}`;
  return { token, iat, exp };
}

export function decodeIdToken(token: string): IdTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as IdTokenPayload;
  } catch {
    return null;
  }
}

/** Google API-key validation error (INVALID_ARGUMENT shape). */
export function apiKeyError(c: Context) {
  return c.json(
    {
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
      },
    },
    400 as ContentfulStatusCode,
  );
}

/** Identity Toolkit error shape: { error: { code, message, errors:[...] } }. */
export function identityError(c: Context, message: string, code = 400) {
  return c.json(
    {
      error: {
        code,
        message,
        errors: [{ message, domain: "global", reason: "invalid" }],
      },
    },
    code as ContentfulStatusCode,
  );
}

/** INVALID_ARGUMENT style error for FCM and generic Google endpoints. */
export function googleError(c: Context, message: string, status = "INVALID_ARGUMENT", code = 400) {
  return c.json(
    {
      error: {
        code,
        message,
        status,
      },
    },
    code as ContentfulStatusCode,
  );
}

/**
 * Validates `?key=` against a seeded project. Returns the project_id on success,
 * or null when the key is missing/unknown (caller should emit `apiKeyError`).
 */
export function resolveProjectByApiKey(store: Store, key: string | undefined): string | null {
  if (!key) return null;
  const fs = getFirebaseStore(store);
  const project = fs.projects.findOneBy("api_key", key);
  return project ? project.project_id : null;
}
