import type { AppEnv, Context, Hono, Store } from '@emulators/core'
import type { TossAccount } from './entities.js'
import { Buffer } from 'node:buffer'
import { checkToken, getTossinvestStore, newRequestId } from './store.js'

export type Ctx = Context<AppEnv>

const REQUEST_IDS = new WeakMap<Request, string>()
const CLIENT_IDS = new WeakMap<Request, string>()

export const MSG_INVALID = '요청이 올바르지 않습니다.'
export const MSG_INVALID_FIELD = '요청 필드가 올바르지 않습니다.'

export function registerMiddleware(app: Hono<AppEnv>, store: Store): void {
  app.use('*', async (c, next) => {
    const id = newRequestId()
    REQUEST_IDS.set(c.req.raw, id)
    c.header('X-Request-Id', id)
    await next()
  })
  app.use('*', async (c, next) => {
    if (!c.req.path.startsWith('/api/')) {
      return next()
    }
    const m = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
    if (!m) {
      return unauthorized(c, 'invalid-token', '유효하지 않은 토큰입니다.', false)
    }
    const { state, clientId } = checkToken(store, m[1])
    if (state === 'invalid') {
      return unauthorized(c, 'invalid-token', '유효하지 않은 토큰입니다.')
    }
    if (state === 'expired') {
      return unauthorized(c, 'expired-token', '토큰이 만료되었습니다.')
    }
    if (state === 'revoked') {
      return unauthorized(
        c,
        'token-revoked',
        '새로 발급된 토큰으로 대체되어 더 이상 유효하지 않은 토큰입니다. 최신 토큰으로 다시 시도해 주세요.',
      )
    }
    CLIENT_IDS.set(c.req.raw, clientId!)
    await next()
  })
}

export function requestIdOf(c: Ctx): string {
  let id = REQUEST_IDS.get(c.req.raw)
  if (!id) {
    id = newRequestId()
    REQUEST_IDS.set(c.req.raw, id)
    c.header('X-Request-Id', id)
  }
  return id
}

export function clientIdOf(c: Ctx): string {
  return CLIENT_IDS.get(c.req.raw) ?? ''
}

export function ok(c: Ctx, result: unknown): Response {
  return c.json({ result })
}

export function fail(c: Ctx, status: number, code: string, message: string, data?: Record<string, unknown>): Response {
  return c.json({ error: { requestId: requestIdOf(c), code, message, ...(data ? { data } : {}) } }, status)
}

export function invalid(c: Ctx, data?: Record<string, unknown>, message = MSG_INVALID): Response {
  return fail(c, 400, 'invalid-request', message, data)
}

// The WWW-Authenticate challenge omits error_description because our messages
// are non-ASCII (as the spec prescribes). No credentials → bare challenge.
function unauthorized(c: Ctx, code: string, message: string, withError = true): Response {
  c.header('WWW-Authenticate', withError ? 'Bearer realm="openapi", error="invalid_token"' : 'Bearer realm="openapi"')
  return fail(c, 401, code, message)
}

export const stockNotFound = (c: Ctx): Response => fail(c, 404, 'stock-not-found', '종목을 찾을 수 없습니다.')

/**
 * Resolves the `X-Tossinvest-Account` header to an account visible to the
 * caller's client. The spec documents `account-not-found` as 400 on some
 * endpoints and 404 on others, so the status is chosen per route.
 */
export function requireAccount(c: Ctx, store: Store, notFoundStatus: 400 | 404 = 404): TossAccount | Response {
  const raw = c.req.header('X-Tossinvest-Account')
  if (raw === undefined || raw.trim() === '') {
    return fail(c, 400, 'account-header-required', 'x-tossinvest-account 헤더가 필요합니다.')
  }
  if (!/^\d+$/.test(raw.trim())) {
    return invalid(c, { field: 'X-Tossinvest-Account', format: 'int64' })
  }
  const account = getTossinvestStore(store).accounts.findOneBy('account_seq', Number(raw.trim()))
  const clientId = clientIdOf(c)
  if (!account || (account.client_id !== null && account.client_id !== clientId)) {
    return fail(c, notFoundStatus, 'account-not-found', '계좌를 찾을 수 없습니다.')
  }
  return account
}

export function intQuery(c: Ctx, name: string, def: number, min: number, max: number): number | Response {
  const raw = c.req.query(name)
  if (raw === undefined || raw === '') {
    return def
  }
  const n = Number(raw)
  if (!/^-?\d+$/.test(raw) || n < min || n > max) {
    return invalid(c, { field: name, constraint: { min, max } })
  }
  return n
}

export function boolQuery(c: Ctx, name: string): boolean | undefined | Response {
  const raw = c.req.query(name)
  if (raw === undefined || raw === '') {
    return undefined
  }
  if (raw !== 'true' && raw !== 'false') {
    return invalid(c, { field: name, allowedValues: ['true', 'false'] })
  }
  return raw === 'true'
}

export function enumQuery<T extends string>(
  c: Ctx,
  name: string,
  allowed: readonly T[],
  message = MSG_INVALID,
): T | Response {
  const raw = c.req.query(name)
  if (raw === undefined || raw === '') {
    return invalid(c, { field: name }, MSG_INVALID_FIELD)
  }
  if (!allowed.includes(raw as T)) {
    return invalid(c, { field: name, allowedValues: [...allowed] }, message)
  }
  return raw as T
}

export const SYMBOL_RE = /^[A-Z0-9.\-]+$/i

export function fmt(n: number, dp: number): string {
  const s = (Math.round(n * 10 ** dp) / 10 ** dp).toFixed(dp)
  const trimmed = dp > 0 ? s.replace(/\.?0+$/, '') : s
  return trimmed === '-0' ? '0' : trimmed
}

export function round(n: number, dp: number): number {
  return Math.round(n * 10 ** dp) / 10 ** dp
}

export function floorIgnoringFloatError(n: number): number {
  return Math.floor(round(n, 6))
}

export function noise(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 15
  h = Math.imul(h, 0x2C1B3C6D)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

export function encodeCursor(id: number): string {
  return Buffer.from(`c:${id}`).toString('base64url')
}

export function decodeCursor(cursor: string): number | undefined {
  const m = /^c:(\d+)$/.exec(Buffer.from(cursor, 'base64url').toString())
  return m ? Number(m[1]) : undefined
}
