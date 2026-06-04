import { randomBytes } from "crypto";
import type { Context } from "@emulators/core";
import type { NaverUser } from "./entities.js";

export function generateToken(prefix: string): string {
  // Naver tokens are opaque strings; prefix only aids debugging.
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

export function generateCode(): string {
  return randomBytes(12).toString("hex");
}

/**
 * Parse params from query string and (for POST) form body / JSON.
 * Naver's token endpoint accepts both GET query params and POST form data.
 */
export async function parseNaverParams(c: Context): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  const url = new URL(c.req.url);
  for (const [key, value] of url.searchParams.entries()) {
    result[key] = value;
  }

  if (c.req.method === "POST") {
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await c.req.text();
      const params = new URLSearchParams(text);
      for (const [key, value] of params.entries()) {
        result[key] = value;
      }
    } else if (contentType.includes("application/json")) {
      try {
        const body = await c.req.json();
        if (body && typeof body === "object" && !Array.isArray(body)) {
          for (const [key, value] of Object.entries(body)) {
            result[key] = String(value);
          }
        }
      } catch {
        // ignore malformed JSON body
      }
    }
  }

  return result;
}

/** Extracts a Bearer token from the Authorization header. */
export function extractBearerToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Builds the `response` object for the profile API, omitting optional fields
 * that were not provided in the seed (mirrors Naver's behaviour).
 */
export function formatProfileResponse(user: NaverUser): Record<string, string> {
  const response: Record<string, string> = { id: user.naver_id };
  if (user.nickname !== undefined) response.nickname = user.nickname;
  if (user.name !== undefined) response.name = user.name;
  if (user.email !== undefined) response.email = user.email;
  if (user.gender !== undefined) response.gender = user.gender;
  if (user.age !== undefined) response.age = user.age;
  if (user.birthday !== undefined) response.birthday = user.birthday;
  if (user.profile_image !== undefined) response.profile_image = user.profile_image;
  if (user.birthyear !== undefined) response.birthyear = user.birthyear;
  if (user.mobile !== undefined) response.mobile = user.mobile;
  return response;
}

/** Naver's "authentication failed" error for the openapi profile endpoints. */
export function authFailed(c: Context) {
  return c.json(
    {
      resultcode: "024",
      message: "Authentication failed (인증에 실패했습니다.)",
    },
    401,
  );
}
