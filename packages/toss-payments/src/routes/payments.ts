import type { RouteContext } from '@emulators/core'
import type { TossCancel } from '../entities.js'
import {
  authenticate,
  buildCard,
  formatPayment,
  generateTransactionKey,
  kstNow,
  tossError,
  unauthorized,
} from '../helpers.js'
import { getTossStore } from '../store.js'

/** Core Toss Payments v1 API: confirm, lookup, cancel. */
export function paymentRoutes(ctx: RouteContext): void {
  const { app, store, webhooks, baseUrl } = ctx
  const ts = () => getTossStore(store)

  async function dispatchStatusChanged(payment: Record<string, unknown>): Promise<void> {
    await webhooks.dispatch(
      'PAYMENT_STATUS_CHANGED',
      undefined,
      {
        eventType: 'PAYMENT_STATUS_CHANGED',
        createdAt: kstNow(),
        data: payment,
      },
      'tosspayments',
    )
  }

  // POST /v1/payments/confirm — approve a READY/IN_PROGRESS payment to DONE.
  app.post('/v1/payments/confirm', async (c) => {
    if (!authenticate(c, store)) {
      return unauthorized(c)
    }

    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    }
    catch {
      return tossError(c, 400, 'INVALID_REQUEST', '잘못된 요청 본문입니다.')
    }

    const paymentKey = body.paymentKey as string | undefined
    const orderId = body.orderId as string | undefined
    const amount = body.amount as number | undefined

    if (!paymentKey || !orderId || amount == null) {
      return tossError(c, 400, 'INVALID_REQUEST', 'paymentKey, orderId, amount가 필요합니다.')
    }

    const payment = ts().payments.findOneBy('payment_key', paymentKey)
    if (!payment) {
      return tossError(c, 404, 'NOT_FOUND_PAYMENT', '존재하지 않는 결제 입니다.')
    }

    if (payment.status === 'DONE' || payment.status === 'CANCELED' || payment.status === 'PARTIAL_CANCELED') {
      return tossError(c, 400, 'ALREADY_PROCESSED_PAYMENT', '이미 처리된 결제 입니다.')
    }

    if (payment.order_id !== orderId) {
      return tossError(c, 400, 'INVALID_REQUEST', '주문 정보가 일치하지 않습니다.')
    }

    if (payment.total_amount !== amount) {
      return tossError(c, 400, 'INVALID_PAYMENT_AMOUNT', '결제 금액이 일치하지 않습니다.')
    }

    const transactionKey = generateTransactionKey()
    const updated = ts().payments.update(payment.id, {
      status: 'DONE',
      approved_at: kstNow(),
      last_transaction_key: transactionKey,
      balance_amount: payment.total_amount,
      card: payment.method === '카드' ? buildCard(payment.total_amount) : payment.card,
    })!

    const formatted = formatPayment(updated, baseUrl)
    await dispatchStatusChanged(formatted)
    return c.json(formatted, 200)
  })

  // GET /v1/payments/{paymentKey}
  app.get('/v1/payments/:paymentKey', (c) => {
    if (!authenticate(c, store)) {
      return unauthorized(c)
    }

    const paymentKey = c.req.param('paymentKey')
    const payment = ts().payments.findOneBy('payment_key', paymentKey)
    if (!payment) {
      return tossError(c, 404, 'NOT_FOUND_PAYMENT', '존재하지 않는 결제 입니다.')
    }
    return c.json(formatPayment(payment, baseUrl), 200)
  })

  // GET /v1/payments/orders/{orderId}
  app.get('/v1/payments/orders/:orderId', (c) => {
    if (!authenticate(c, store)) {
      return unauthorized(c)
    }

    const orderId = c.req.param('orderId')
    const payment = ts().payments.findOneBy('order_id', orderId)
    if (!payment) {
      return tossError(c, 404, 'NOT_FOUND_PAYMENT', '존재하지 않는 결제 입니다.')
    }
    return c.json(formatPayment(payment, baseUrl), 200)
  })

  // POST /v1/payments/{paymentKey}/cancel
  app.post('/v1/payments/:paymentKey/cancel', async (c) => {
    if (!authenticate(c, store)) {
      return unauthorized(c)
    }

    const paymentKey = c.req.param('paymentKey')
    const payment = ts().payments.findOneBy('payment_key', paymentKey)
    if (!payment) {
      return tossError(c, 404, 'NOT_FOUND_PAYMENT', '존재하지 않는 결제 입니다.')
    }

    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    }
    catch {
      return tossError(c, 400, 'INVALID_REQUEST', '잘못된 요청 본문입니다.')
    }

    const cancelReason = body.cancelReason as string | undefined
    if (!cancelReason) {
      return tossError(c, 400, 'INVALID_REQUEST', '취소 사유(cancelReason)가 필요합니다.')
    }

    if (payment.status !== 'DONE' && payment.status !== 'PARTIAL_CANCELED') {
      return tossError(c, 400, 'NOT_CANCELABLE_PAYMENT', '취소할 수 없는 결제 입니다.')
    }

    const cancelAmountRaw = body.cancelAmount as number | undefined
    const cancelAmount = cancelAmountRaw ?? payment.balance_amount

    if (!Number.isFinite(cancelAmount) || cancelAmount <= 0 || cancelAmount > payment.balance_amount) {
      return tossError(c, 400, 'INVALID_REFUND_AMOUNT', '취소 금액이 취소 가능 금액을 초과했습니다.')
    }

    const newBalance = payment.balance_amount - cancelAmount
    const newStatus = newBalance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
    const transactionKey = generateTransactionKey()

    const cancel: TossCancel = {
      transactionKey,
      cancelReason,
      canceledAt: kstNow(),
      cancelAmount,
      refundableAmount: newBalance,
      cancelStatus: 'DONE',
    }

    const cancels = [...(payment.cancels ?? []), cancel]
    const updated = ts().payments.update(payment.id, {
      status: newStatus,
      balance_amount: newBalance,
      last_transaction_key: transactionKey,
      cancels,
    })!

    const formatted = formatPayment(updated, baseUrl)
    await dispatchStatusChanged(formatted)
    return c.json(formatted, 200)
  })
}
