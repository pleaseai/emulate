import type { ContentfulStatusCode, Context } from '@emulators/core'
import { randomBytes } from 'node:crypto'

export function randomToken(prefix = ''): string {
  return prefix + randomBytes(24).toString('hex')
}

/** kauth.kakao.com /oauth/token error format */
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
  )
}

/** kapi.kakao.com error format ({msg, code}) */
export function kapiError(c: Context, status: number, msg: string, code: number) {
  return c.json({ msg, code }, status as ContentfulStatusCode)
}

/** Parse a form-urlencoded or JSON body into a flat object */
export async function parseKakaoBody(c: Context): Promise<Record<string, string>> {
  const contentType = c.req.header('content-type') ?? ''
  const result: Record<string, string> = {}

  if (contentType.includes('application/json')) {
    try {
      const body = await c.req.json()
      if (body && typeof body === 'object') {
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          result[k] = typeof v === 'string' ? v : JSON.stringify(v)
        }
      }
    }
    catch {
      // ignore
    }
    return result
  }

  // application/x-www-form-urlencoded (and multipart fallthrough via parseBody)
  if (contentType.includes('multipart/form-data')) {
    try {
      const parsed = await c.req.parseBody()
      for (const [k, v] of Object.entries(parsed)) {
        result[k] = typeof v === 'string' ? v : String(v)
      }
    }
    catch {
      // ignore
    }
    return result
  }

  try {
    const text = await c.req.text()
    const params = new URLSearchParams(text)
    for (const [k, v] of params.entries()) {
      result[k] = v
    }
  }
  catch {
    // ignore
  }
  return result
}

/** Extract the token from the Authorization: Bearer <token> header */
export function extractBearer(c: Context): string | null {
  const header = c.req.header('Authorization') ?? c.req.header('authorization')
  if (!header) {
    return null
  }
  const match = header.match(/^Bearer\s+(\S.*)$/i)
  return match ? match[1].trim() : null
}
