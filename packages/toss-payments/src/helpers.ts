import type { ContentfulStatusCode, Context, Store } from '@emulators/core'
import type { TossMerchant, TossPayment } from './entities.js'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { getTossStore } from './store.js'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** ISO 8601 string with the +09:00 (KST) offset that the real Toss API returns. */
export function kstNow(): string {
  return kstFrom(new Date())
}

export function kstFrom(date: Date): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS)
  return shifted.toISOString().replace('Z', '+09:00')
}

export function generatePaymentKey(): string {
  // Real Toss paymentKeys are ~20 alphanumeric chars; we just need uniqueness.
  return randomUUID().replace(/-/g, '')
}

export function generateTransactionKey(): string {
  return randomUUID().replace(/-/g, '').toUpperCase()
}

export function tossError(c: Context, status: number, code: string, message: string) {
  return c.json({ code, message }, status as ContentfulStatusCode)
}

/**
 * Authenticates a request using `Authorization: Basic base64(<secret_key>:)`.
 * Returns the matching merchant, or null on failure.
 */
export function authenticate(c: Context, store: Store): TossMerchant | null {
  const header = c.req.header('Authorization')
  if (!header) {
    return null
  }

  const match = /^Basic\s+(\S.*)$/i.exec(header.trim())
  if (!match) {
    return null
  }

  let decoded: string
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8')
  }
  catch {
    return null
  }

  // Format is "<secret_key>:" (password empty). Strip the trailing colon.
  const secretKey = decoded.replace(/:$/, '')
  if (!secretKey) {
    return null
  }

  const ts = getTossStore(store)
  return ts.merchants.findOneBy('secret_key', secretKey) ?? null
}

/** 401 response used across every authenticated endpoint. */
export function unauthorized(c: Context) {
  return tossError(c, 401, 'UNAUTHORIZED_KEY', '인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다.')
}

/** Renders an internal payment entity into the public Toss v1 Payment shape. */
export function formatPayment(payment: TossPayment, baseUrl: string): Record<string, unknown> {
  const total = payment.total_amount
  const suppliedAmount = Math.round(total / 1.1)
  const vat = total - suppliedAmount

  return {
    mId: 'tosspayments',
    version: '2022-11-16',
    paymentKey: payment.payment_key,
    status: payment.status,
    lastTransactionKey: payment.last_transaction_key,
    orderId: payment.order_id,
    orderName: payment.order_name,
    requestedAt: payment.requested_at,
    approvedAt: payment.approved_at,
    useEscrow: payment.use_escrow,
    cultureExpense: payment.culture_expense,
    card: payment.card,
    type: 'NORMAL',
    country: 'KR',
    currency: 'KRW',
    method: payment.method,
    totalAmount: total,
    balanceAmount: payment.balance_amount,
    suppliedAmount,
    vat,
    taxFreeAmount: 0,
    cancels: payment.cancels,
    receipt: { url: `${baseUrl}/receipts/${payment.payment_key}` },
    checkout: { url: `${baseUrl}/checkout/${payment.payment_key}` },
  }
}

/** Builds the simulated card object returned for card payments. */
export function buildCard(totalAmount: number) {
  return {
    issuerCode: '61',
    acquirerCode: '31',
    number: '12345678****789*',
    installmentPlanMonths: 0,
    isInterestFree: false,
    approveNo: '00000000',
    cardType: '신용',
    ownerType: '개인',
    acquireStatus: 'READY',
    amount: totalAmount,
  }
}
