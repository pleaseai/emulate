import { Buffer } from 'node:buffer'
import { createServer, Store, WebhookDispatcher } from '@emulators/core'
import { beforeEach, describe, expect, it } from 'bun:test'
import { getTossStore, seedFromConfig, tossPaymentsPlugin } from '../index.js'

const BASE = 'http://localhost:4000'
const SECRET = 'test_sk_default'
const CLIENT = 'test_ck_default'

function authHeader(secret = SECRET): string {
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`
}

function makeApp() {
  const { app, store } = createServer(tossPaymentsPlugin, { port: 4000 })
  tossPaymentsPlugin.seed?.(store, BASE)
  return { app, store }
}

async function createInternalPayment(
  app: { fetch: (r: Request) => Promise<Response> },
  body: { orderId: string, orderName: string, amount: number, method?: string },
) {
  const res = await app.fetch(
    new Request(`${BASE}/internal/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return res
}

async function confirm(
  app: { fetch: (r: Request) => Promise<Response> },
  body: { paymentKey: string, orderId: string, amount: number },
  secret = SECRET,
) {
  return app.fetch(
    new Request(`${BASE}/v1/payments/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': authHeader(secret) },
      body: JSON.stringify(body),
    }),
  )
}

describe('tosspayments auth', () => {
  let app: { fetch: (r: Request) => Promise<Response> }
  beforeEach(() => {
    app = makeApp().app
  })

  it('rejects wrong secret key with 401 UNAUTHORIZED_KEY', async () => {
    const res = await app.fetch(
      new Request(`${BASE}/v1/payments/some-key`, {
        headers: { Authorization: authHeader('test_sk_wrong') },
      }),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('UNAUTHORIZED_KEY')
    expect(body.message).toBe('인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다.')
  })

  it('rejects missing Authorization header with 401', async () => {
    const res = await app.fetch(new Request(`${BASE}/v1/payments/some-key`))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('UNAUTHORIZED_KEY')
  })
})

describe('tosspayments confirm', () => {
  let app: { fetch: (r: Request) => Promise<Response> }
  beforeEach(() => {
    app = makeApp().app
  })

  it('creates internal payment then confirms to DONE with correct fields', async () => {
    const createRes = await createInternalPayment(app, {
      orderId: 'order-1',
      orderName: '테스트 주문',
      amount: 11000,
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.status).toBe('IN_PROGRESS')
    expect(created.method).toBe('카드')
    expect(created.card).not.toBeNull()
    expect(created.card.amount).toBe(11000)

    const res = await confirm(app, {
      paymentKey: created.paymentKey,
      orderId: 'order-1',
      amount: 11000,
    })
    expect(res.status).toBe(200)
    const p = await res.json()

    expect(p.mId).toBe('tosspayments')
    expect(p.version).toBe('2022-11-16')
    expect(p.status).toBe('DONE')
    expect(p.orderId).toBe('order-1')
    expect(p.orderName).toBe('테스트 주문')
    expect(p.totalAmount).toBe(11000)
    expect(p.balanceAmount).toBe(11000)
    expect(p.currency).toBe('KRW')
    expect(p.country).toBe('KR')
    expect(p.approvedAt).not.toBeNull()
    expect(p.lastTransactionKey).toBeTruthy()
    expect(p.cancels).toBeNull()
    expect(p.receipt.url).toBe(`${BASE}/receipts/${p.paymentKey}`)
    expect(p.checkout.url).toBe(`${BASE}/checkout/${p.paymentKey}`)

    // suppliedAmount = round(11000 / 1.1) = 10000, vat = 1000
    expect(p.suppliedAmount).toBe(10000)
    expect(p.vat).toBe(1000)
    expect(p.requestedAt).toContain('+09:00')
    expect(p.approvedAt).toContain('+09:00')
  })

  it('fails confirm on amount mismatch (INVALID_PAYMENT_AMOUNT)', async () => {
    const created = await (await createInternalPayment(app, { orderId: 'o2', orderName: 'n', amount: 5000 })).json()
    const res = await confirm(app, { paymentKey: created.paymentKey, orderId: 'o2', amount: 4000 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_PAYMENT_AMOUNT')
    expect(body.message).toBe('결제 금액이 일치하지 않습니다.')
  })

  it('fails confirm on orderId mismatch (INVALID_REQUEST)', async () => {
    const created = await (await createInternalPayment(app, { orderId: 'o3', orderName: 'n', amount: 5000 })).json()
    const res = await confirm(app, { paymentKey: created.paymentKey, orderId: 'wrong', amount: 5000 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 404 NOT_FOUND_PAYMENT for unknown paymentKey', async () => {
    const res = await confirm(app, { paymentKey: 'does-not-exist', orderId: 'x', amount: 1000 })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('NOT_FOUND_PAYMENT')
  })

  it('rejects duplicate confirm with 400 ALREADY_PROCESSED_PAYMENT', async () => {
    const created = await (await createInternalPayment(app, { orderId: 'o4', orderName: 'n', amount: 3000 })).json()
    const first = await confirm(app, { paymentKey: created.paymentKey, orderId: 'o4', amount: 3000 })
    expect(first.status).toBe(200)
    const second = await confirm(app, { paymentKey: created.paymentKey, orderId: 'o4', amount: 3000 })
    expect(second.status).toBe(400)
    const body = await second.json()
    expect(body.code).toBe('ALREADY_PROCESSED_PAYMENT')
  })
})

describe('tosspayments lookup', () => {
  let app: { fetch: (r: Request) => Promise<Response> }
  beforeEach(() => {
    app = makeApp().app
  })

  it('looks up by paymentKey and orderId', async () => {
    const created = await (await createInternalPayment(app, { orderId: 'lookup-1', orderName: 'n', amount: 2000 })).json()

    const byKey = await app.fetch(
      new Request(`${BASE}/v1/payments/${created.paymentKey}`, { headers: { Authorization: authHeader() } }),
    )
    expect(byKey.status).toBe(200)
    expect((await byKey.json()).paymentKey).toBe(created.paymentKey)

    const byOrder = await app.fetch(
      new Request(`${BASE}/v1/payments/orders/lookup-1`, { headers: { Authorization: authHeader() } }),
    )
    expect(byOrder.status).toBe(200)
    expect((await byOrder.json()).orderId).toBe('lookup-1')
  })

  it('returns 404 NOT_FOUND_PAYMENT for unknown lookups', async () => {
    const byKey = await app.fetch(
      new Request(`${BASE}/v1/payments/nope`, { headers: { Authorization: authHeader() } }),
    )
    expect(byKey.status).toBe(404)
    expect((await byKey.json()).code).toBe('NOT_FOUND_PAYMENT')

    const byOrder = await app.fetch(
      new Request(`${BASE}/v1/payments/orders/nope`, { headers: { Authorization: authHeader() } }),
    )
    expect(byOrder.status).toBe(404)
    expect((await byOrder.json()).code).toBe('NOT_FOUND_PAYMENT')
  })
})

describe('tosspayments cancel', () => {
  let app: { fetch: (r: Request) => Promise<Response> }
  beforeEach(() => {
    app = makeApp().app
  })

  async function makeDonePayment(orderId: string, amount: number) {
    const created = await (await createInternalPayment(app, { orderId, orderName: 'n', amount })).json()
    await confirm(app, { paymentKey: created.paymentKey, orderId, amount })
    return created.paymentKey as string
  }

  async function cancel(paymentKey: string, body: { cancelReason: string, cancelAmount?: number }) {
    return app.fetch(
      new Request(`${BASE}/v1/payments/${paymentKey}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Authorization': authHeader() },
        body: JSON.stringify(body),
      }),
    )
  }

  it('full cancel sets status CANCELED and balance 0', async () => {
    const key = await makeDonePayment('c1', 10000)
    const res = await cancel(key, { cancelReason: '고객 변심' })
    expect(res.status).toBe(200)
    const p = await res.json()
    expect(p.status).toBe('CANCELED')
    expect(p.balanceAmount).toBe(0)
    expect(p.cancels).toHaveLength(1)
    expect(p.cancels[0].cancelAmount).toBe(10000)
    expect(p.cancels[0].cancelStatus).toBe('DONE')
    expect(p.cancels[0].refundableAmount).toBe(0)
  })

  it('partial cancel sets PARTIAL_CANCELED and decrements balance', async () => {
    const key = await makeDonePayment('c2', 10000)
    const res = await cancel(key, { cancelReason: '부분 환불', cancelAmount: 3000 })
    expect(res.status).toBe(200)
    const p = await res.json()
    expect(p.status).toBe('PARTIAL_CANCELED')
    expect(p.balanceAmount).toBe(7000)
    expect(p.cancels[0].cancelAmount).toBe(3000)
    expect(p.cancels[0].refundableAmount).toBe(7000)

    // A second partial cancel that drains the balance flips to CANCELED.
    const res2 = await cancel(key, { cancelReason: '잔액 취소', cancelAmount: 7000 })
    const p2 = await res2.json()
    expect(p2.status).toBe('CANCELED')
    expect(p2.balanceAmount).toBe(0)
    expect(p2.cancels).toHaveLength(2)
  })

  it('rejects over-balance cancel amount with 400 INVALID_REFUND_AMOUNT', async () => {
    const key = await makeDonePayment('c3', 5000)
    const res = await cancel(key, { cancelReason: '초과', cancelAmount: 6000 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_REFUND_AMOUNT')
  })

  it('rejects cancel of non-cancelable (IN_PROGRESS) payment', async () => {
    const created = await (await createInternalPayment(app, { orderId: 'c4', orderName: 'n', amount: 5000 })).json()
    const res = await cancel(created.paymentKey, { cancelReason: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('NOT_CANCELABLE_PAYMENT')
  })
})

describe('tosspayments checkout flow', () => {
  let app: { fetch: (r: Request) => Promise<Response> }
  beforeEach(() => {
    app = makeApp().app
  })

  it('renders checkout page, approves, and redirects to successUrl', async () => {
    const successUrl = 'http://localhost:3000/success'
    const failUrl = 'http://localhost:3000/fail'
    const checkoutUrl
      = `${BASE}/checkout?clientKey=${CLIENT}&orderId=co-1&orderName=${encodeURIComponent('주문')}`
        + `&amount=15000&successUrl=${encodeURIComponent(successUrl)}&failUrl=${encodeURIComponent(failUrl)}`

    const pageRes = await app.fetch(new Request(checkoutUrl))
    expect(pageRes.status).toBe(200)
    const html = await pageRes.text()
    expect(html).toContain('/checkout/approve?paymentKey=')
    expect(html).toContain(failUrl)

    // Extract the paymentKey from the approve link.
    const match = /\/checkout\/approve\?paymentKey=([^"&]+)/.exec(html)
    expect(match).not.toBeNull()
    const paymentKey = decodeURIComponent(match![1])

    const approveRes = await app.fetch(
      new Request(`${BASE}/checkout/approve?paymentKey=${encodeURIComponent(paymentKey)}&successUrl=${encodeURIComponent(successUrl)}`, {
        redirect: 'manual',
      }),
    )
    expect(approveRes.status).toBe(302)
    const location = approveRes.headers.get('location')!
    expect(location.startsWith(successUrl)).toBe(true)
    const locUrl = new URL(location)
    expect(locUrl.searchParams.get('paymentKey')).toBe(paymentKey)
    expect(locUrl.searchParams.get('orderId')).toBe('co-1')
    expect(locUrl.searchParams.get('amount')).toBe('15000')
  })

  it('rejects checkout with invalid clientKey', async () => {
    const res = await app.fetch(
      new Request(
        `${BASE}/checkout?clientKey=bad&orderId=x&orderName=n&amount=100&successUrl=${encodeURIComponent('http://s')}&failUrl=${encodeURIComponent('http://f')}`,
      ),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_CLIENT_KEY')
  })
})

describe('tosspayments seedFromConfig', () => {
  it('seeds merchants and registers webhooks from registry initConfig shape', async () => {
    const store = new Store()
    const webhooks = new WebhookDispatcher()
    const config = {
      merchants: [{ client_key: 'test_ck_example', secret_key: 'test_sk_example' }],
      webhooks: [{ url: 'http://localhost:3000/api/webhooks/toss', events: ['PAYMENT_STATUS_CHANGED'] }],
    }

    seedFromConfig(store, BASE, config, webhooks)

    const ts = getTossStore(store)
    expect(ts.merchants.findOneBy('secret_key', 'test_sk_example')).toBeTruthy()

    const subs = webhooks.getSubscriptions('tosspayments')
    expect(subs).toHaveLength(1)
    expect(subs[0].url).toBe('http://localhost:3000/api/webhooks/toss')
    expect(subs[0].events).toEqual(['PAYMENT_STATUS_CHANGED'])
    expect(subs[0].active).toBe(true)

    // Re-running should not duplicate the merchant.
    seedFromConfig(store, BASE, { merchants: config.merchants }, webhooks)
    expect(ts.merchants.findBy('client_key', 'test_ck_example')).toHaveLength(1)
  })

  it('dispatches PAYMENT_STATUS_CHANGED webhook on confirm', async () => {
    const received: Array<{ eventType: string, data: { status: string } }> = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString()
      if (target.includes('/hook')) {
        received.push(JSON.parse(init!.body as string))
        return new Response('ok', { status: 200 })
      }
      return realFetch(url as string, init)
    }) as typeof fetch

    try {
      const srv = createServer(tossPaymentsPlugin, { port: 4000 })
      tossPaymentsPlugin.seed?.(srv.store, BASE)
      srv.webhooks.register({
        url: 'http://localhost:9999/hook',
        events: ['PAYMENT_STATUS_CHANGED'],
        active: true,
        owner: 'tosspayments',
      })

      const created = await (
        await srv.app.fetch(
          new Request(`${BASE}/internal/payments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId: 'wh-1', orderName: 'n', amount: 1000 }),
          }),
        )
      ).json()

      await srv.app.fetch(
        new Request(`${BASE}/v1/payments/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Authorization': authHeader() },
          body: JSON.stringify({ paymentKey: created.paymentKey, orderId: 'wh-1', amount: 1000 }),
        }),
      )

      expect(received.length).toBe(1)
      expect(received[0].eventType).toBe('PAYMENT_STATUS_CHANGED')
      expect(received[0].data.status).toBe('DONE')
    }
    finally {
      globalThis.fetch = realFetch
    }
  })
})
