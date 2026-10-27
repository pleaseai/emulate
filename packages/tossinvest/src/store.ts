import type { Collection, Store } from '@emulators/core'
import type {
  TossAccount,
  TossClient,
  TossConditionalOrder,
  TossExecution,
  TossHolding,
  TossOrder,
  TossSector,
  TossStock,
} from './entities.js'
import { Buffer } from 'node:buffer'

export interface TossinvestStore {
  clients: Collection<TossClient>
  stocks: Collection<TossStock>
  sectors: Collection<TossSector>
  accounts: Collection<TossAccount>
  holdings: Collection<TossHolding>
  orders: Collection<TossOrder>
  executions: Collection<TossExecution>
  conditionalOrders: Collection<TossConditionalOrder>
}

export function getTossinvestStore(store: Store): TossinvestStore {
  return {
    clients: store.collection<TossClient>('tossinvest.clients', ['client_id']),
    stocks: store.collection<TossStock>('tossinvest.stocks', ['symbol']),
    sectors: store.collection<TossSector>('tossinvest.sectors', ['sector_id']),
    accounts: store.collection<TossAccount>('tossinvest.accounts', ['account_seq']),
    holdings: store.collection<TossHolding>('tossinvest.holdings', ['account_seq']),
    orders: store.collection<TossOrder>('tossinvest.orders', ['order_id', 'cancel_order_id', 'account_seq']),
    executions: store.collection<TossExecution>('tossinvest.executions', ['order_id']),
    conditionalOrders: store.collection<TossConditionalOrder>('tossinvest.conditional_orders', [
      'conditional_order_id',
      'account_seq',
    ]),
  }
}

export function randomId(bytes: number): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return Buffer.from(b).toString('base64url')
}

export const newOrderId = (): string => randomId(48)
export const newConditionalOrderId = (): string => randomId(16)

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function newRequestId(now = Date.now()): string {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time
    t = Math.floor(t / 32)
  }
  const r = new Uint8Array(16)
  crypto.getRandomValues(r)
  return time + Array.from(r, x => CROCKFORD[x % 32]).join('')
}

export interface IssuedToken {
  clientId: string
  issuedAt: number
  expiresAt: number
  revoked: boolean
}
export type TokenState = 'valid' | 'invalid' | 'expired' | 'revoked'

const TOKEN_KEY = 'tossinvest.tokens'
export const TOKEN_TTL_SECONDS = 86_400
const REVOKED_KEEP = 20

function makeJwtShapedToken(clientId: string, now: number): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = enc({ kid: 'emulate', alg: 'RS256', typ: 'JWT' })
  const payload = enc({
    sub: clientId,
    jti: randomId(12),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
  })
  return `${header}.${payload}.${randomId(32)}`
}

export function issueToken(store: Store, clientId: string, now = Date.now()): string {
  const tokens = store.getData<Record<string, IssuedToken>>(TOKEN_KEY) ?? {}
  const revoked: string[] = []
  for (const [tok, rec] of Object.entries(tokens)) {
    if (rec.clientId !== clientId) {
      continue
    }
    rec.revoked = true
    revoked.push(tok)
  }
  revoked
    .sort((a, b) => tokens[b].issuedAt - tokens[a].issuedAt)
    .slice(REVOKED_KEEP)
    .forEach((tok) => {
      delete tokens[tok]
    })
  const token = makeJwtShapedToken(clientId, now)
  tokens[token] = { clientId, issuedAt: now, expiresAt: now + TOKEN_TTL_SECONDS * 1000, revoked: false }
  store.setData(TOKEN_KEY, tokens)
  return token
}

export function checkToken(store: Store, token: string, now = Date.now()): { state: TokenState, clientId?: string } {
  const tokens = store.getData<Record<string, IssuedToken>>(TOKEN_KEY) ?? {}
  const rec = Object.hasOwn(tokens, token) ? tokens[token] : undefined
  if (!rec) {
    return { state: 'invalid' }
  }
  if (rec.revoked) {
    return { state: 'revoked', clientId: rec.clientId }
  }
  if (rec.expiresAt <= now) {
    return { state: 'expired', clientId: rec.clientId }
  }
  return { state: 'valid', clientId: rec.clientId }
}
