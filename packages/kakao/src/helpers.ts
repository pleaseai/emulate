import { randomBytes } from "crypto";
import type { Context, ContentfulStatusCode } from "@emulators/core";

export function randomToken(prefix = ""): string {
  return prefix + randomBytes(24).toString("hex");
}

/** kauth.kakao.com /oauth/token 에러 형식 */
export function oauthError(
  c: Context,
  status: number,
  error: string,
  description: string,
  errorCode: string,
) {
  return c.json(
    { error, error_description: description, error_code: errorCode },
    status as ContentfulStatusCode,
  );
}

/** kapi.kakao.com 에러 형식 ({msg, code}) */
export function kapiError(c: Context, status: number, msg: string, code: number) {
  return c.json({ msg, code }, status as ContentfulStatusCode);
}

/** form-urlencoded 또는 JSON 본문을 평탄한 객체로 파싱 */
export async function parseKakaoBody(c: Context): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  const result: Record<string, string> = {};

  if (contentType.includes("application/json")) {
    try {
      const body = await c.req.json();
      if (body && typeof body === "object") {
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          result[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
      }
    } catch {
      // ignore
    }
    return result;
  }

  // application/x-www-form-urlencoded (and multipart fallthrough via parseBody)
  if (contentType.includes("multipart/form-data")) {
    try {
      const parsed = await c.req.parseBody();
      for (const [k, v] of Object.entries(parsed)) {
        result[k] = typeof v === "string" ? v : String(v);
      }
    } catch {
      // ignore
    }
    return result;
  }

  try {
    const text = await c.req.text();
    const params = new URLSearchParams(text);
    for (const [k, v] of params.entries()) result[k] = v;
  } catch {
    // ignore
  }
  return result;
}

/** Authorization: Bearer <token> 헤더에서 토큰 추출 */
export function extractBearer(c: Context): string | null {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
