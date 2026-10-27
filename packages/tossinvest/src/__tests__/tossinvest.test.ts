import { authMiddleware, createApiErrorHandler, createErrorHandler, Hono, Store, WebhookDispatcher } from '@emulators/core'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedFromConfig, tossinvestPlugin } from '../index.js'

const base = 'http://localhost:4000'

function createTestApp() {
  const store = new Store()
  const webhooks = new WebhookDispatcher()
  const tokenMap = new Map()

  const app = new Hono()
  app.onError(createApiErrorHandler())
  app.use('*', createErrorHandler())
  app.use('*', authMiddleware(tokenMap))
  tossinvestPlugin.register(app as any, store, webhooks, base, tokenMap)

  seedFromConfig(store, base, {
    clients: [{ client_id: 'test-client', client_secret: 'test-secret', name: 'Test App' }],
    stocks: [
      { symbol: '005930', name: '삼성전자', market: 'KOSPI', price: 72000, shares_outstanding: '5919637922' },
      { symbol: 'AAPL', name: '애플', market: 'NASDAQ', price: 185.7 },
    ],
    sectors: [
      { sector_id: '10', name: 'IT 하드웨어' },
      { sector_id: '100', name: '반도체', parent_sector_id: '10', stocks: ['005930'] },
    ],
    accounts: [
      {
        account_seq: 1,
        account_no: '12345678901',
        cash: { krw: 10_000_000, usd: 1_000 },
        holdings: [{ symbol: '005930', quantity: 10, average_price: 65000 }],
      },
    ],
  })

  return { app, store }
}

let app: ReturnType<typeof createTestApp>['app']

beforeEach(() => {
  ({ app } = createTestApp())
})

function tokenRequest(fields: Record<string, string>) {
  return app.request(`${base}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
}

async function fetchToken(): Promise<string> {
  const res = await tokenRequest({ grant_type: 'client_credentials', client_id: 'test-client', client_secret: 'test-secret' })
  expect(res.status).toBe(200)
  const json = (await res.json()) as { access_token: string, token_type: string, expires_in: number }
  expect(json.token_type).toBe('Bearer')
  expect(json.expires_in).toBe(86400)
  return json.access_token
}

interface ApiError { error: { requestId: string, code: string, message: string, data?: Record<string, unknown> } }

async function api(token: string, path: string, init: { method?: string, body?: unknown, account?: number | null } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  if (init.account !== null) {
    headers['x-tossinvest-account'] = String(init.account ?? 1)
  }
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  const res = await app.request(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  return { res, json: (text ? JSON.parse(text) : null) as any }
}

const order = (token: string, body: Record<string, unknown>) => api(token, '/api/v1/orders', { method: 'POST', body })

describe('tossinvest emulator: auth', () => {
  it('issues a client credentials token', async () => {
    const token = await fetchToken()
    expect(token.split('.')).toHaveLength(3)
  })

  it('reports a missing parameter (empty counts as missing)', async () => {
    const res = await tokenRequest({ grant_type: 'client_credentials', client_id: 'test-client', client_secret: '' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_request', error_description: 'OAuth 2.0 Parameter: client_secret' })
  })

  it('rejects unsupported grant types', async () => {
    const res = await tokenRequest({ grant_type: 'authorization_code', client_id: 'test-client', client_secret: 'test-secret' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_grant_type')
  })

  it('rejects a wrong secret with a Basic challenge', async () => {
    const res = await tokenRequest({ grant_type: 'client_credentials', client_id: 'test-client', client_secret: 'wrong' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="openapi"')
    expect(await res.json()).toEqual({ error: 'invalid_client', error_description: 'Client authentication failed.' })
  })

  it('accepts HTTP Basic client authentication', async () => {
    const res = await app.request(`${base}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'authorization': `Basic ${btoa('test-client:test-secret')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    })
    expect(res.status).toBe(200)
  })

  it('revokes the previous token when a new one is issued', async () => {
    const first = await fetchToken()
    const second = await fetchToken()
    const stale = await api(first, '/api/v1/accounts')
    expect(stale.res.status).toBe(401)
    expect((stale.json as ApiError).error.code).toBe('token-revoked')
    expect((await api(second, '/api/v1/accounts')).res.status).toBe(200)
  })

  it('returns 401 without a token and with an unknown token', async () => {
    const none = await app.request(`${base}/api/v1/prices?symbols=005930`)
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toContain('Bearer realm="openapi"')
    const bad = await api('not-a-token', '/api/v1/prices?symbols=005930')
    expect(bad.res.status).toBe(401)
    expect((bad.json as ApiError).error.code).toBe('invalid-token')
    expect(bad.res.headers.get('www-authenticate')).toBe('Bearer realm="openapi", error="invalid_token"')
  })

  it('rejects prototype property names as bearer tokens', async () => {
    for (const token of ['__proto__', 'constructor', 'toString']) {
      const res = await api(token, '/api/v1/prices?symbols=005930')
      expect(res.res.status).toBe(401)
      expect((res.json as ApiError).error.code).toBe('invalid-token')
    }
  })
})

describe('tossinvest emulator: envelope and market data', () => {
  it('wraps success in {result} and echoes X-Request-Id into errors', async () => {
    const token = await fetchToken()
    const okRes = await api(token, '/api/v1/prices?symbols=005930')
    expect(okRes.res.headers.get('x-request-id')).toBeTruthy()
    expect(okRes.json.result[0]).toMatchObject({ symbol: '005930', lastPrice: '72000', currency: 'KRW' })
    const err = await api(token, '/api/v1/prices?symbols=999999')
    expect(err.res.status).toBe(404)
    expect((err.json as ApiError).error.code).toBe('stock-not-found')
    expect((err.json as ApiError).error.requestId).toBe(err.res.headers.get('x-request-id')!)
  })

  it('requires the account header on account-scoped endpoints', async () => {
    const token = await fetchToken()
    const { res, json } = await api(token, '/api/v1/holdings', { account: null })
    expect(res.status).toBe(400)
    expect((json as ApiError).error.code).toBe('account-header-required')
    const unknown = await api(token, '/api/v1/buying-power?currency=KRW', { account: 99 })
    expect(unknown.res.status).toBe(404)
    expect((unknown.json as ApiError).error.code).toBe('account-not-found')
  })

  it('serves deterministic candles that page with nextBefore', async () => {
    const token = await fetchToken()
    const first = await api(token, '/api/v1/candles?symbol=005930&interval=1d&count=3')
    expect(first.res.status).toBe(200)
    const { candles, nextBefore } = first.json.result
    expect(candles).toHaveLength(3)
    expect(candles[0].closePrice).toBe('72000')
    expect(candles[0].timestamp > candles[1].timestamp).toBe(true)
    const again = await api(token, '/api/v1/candles?symbol=005930&interval=1d&count=3')
    expect(again.json.result).toEqual(first.json.result)
    const next = await api(token, `/api/v1/candles?symbol=005930&interval=1d&count=1&before=${encodeURIComponent(nextBefore)}`)
    expect(next.json.result.candles[0].timestamp).toBe(nextBefore)
    const badInterval = await api(token, '/api/v1/candles?symbol=005930&interval=5m')
    expect(badInterval.res.status).toBe(400)
    expect((badInterval.json as ApiError).error.data).toEqual({ field: 'interval', allowedValues: ['1m', '1d'] })
  })

  it('looks up stock info and rejects unknown symbols', async () => {
    const token = await fetchToken()
    const { json } = await api(token, '/api/v1/stocks?symbols=005930,AAPL')
    expect(json.result.map((s: { symbol: string }) => s.symbol)).toEqual(['005930', 'AAPL'])
    expect(json.result[0].koreanMarketDetail).toMatchObject({ nxtSupported: true })
    expect(json.result[1].koreanMarketDetail).toBeNull()
    const all = await api(token, '/api/v1/stocks/all?market=NASDAQ')
    expect(all.json.result).toEqual([{ symbol: 'AAPL', name: '애플', securityType: 'STOCK', isCommonShare: true, isinCode: expect.any(String) }])
    const warn = await api(token, '/api/v1/stocks/ZZZZ/warnings')
    expect(warn.res.status).toBe(404)
    const us = await api(token, '/api/v1/stocks/AAPL/investor-trading')
    expect((us.json as ApiError).error.code).toBe('unsupported-market')
  })

  it('serves sectors, sector detail and member stocks', async () => {
    const token = await fetchToken()
    const list = await api(token, '/api/v1/sectors')
    expect(list.json.result.sectors).toEqual([
      { sectorId: '10', name: 'IT 하드웨어', depth: 0, parentSectorId: null },
      { sectorId: '100', name: '반도체', depth: 1, parentSectorId: '10' },
    ])
    const detail = await api(token, '/api/v1/sectors/10?marketCountry=KR')
    expect(detail.json.result.performance.changeRates).toHaveLength(6)
    const stocks = await api(token, '/api/v1/sectors/10/stocks?marketCountry=KR')
    expect(stocks.json.result.stocks.map((s: { symbol: string }) => s.symbol)).toEqual(['005930'])
    const missing = await api(token, '/api/v1/sectors/999?marketCountry=KR')
    expect((missing.json as ApiError).error.code).toBe('sector-not-found')
  })

  it('serves sector members when seeded parents form a cycle', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, { sectors: [{ sector_id: '10', name: 'IT 하드웨어', parent_sector_id: '100' }] })
    const token = await fetchToken()
    const stocks = await api(token, '/api/v1/sectors/10/stocks?marketCountry=KR')
    expect(stocks.res.status).toBe(200)
    expect(stocks.json.result.stocks.map((s: { symbol: string }) => s.symbol)).toEqual(['005930'])
    const rankings = await api(token, '/api/v1/sectors/rankings?type=TOP_GAINERS&marketCountry=KR&duration=1d')
    expect(rankings.res.status).toBe(200)
  })
})

describe('tossinvest emulator: trading', () => {
  it('fills a market buy and updates holdings and buying power', async () => {
    const token = await fetchToken()
    const placed = await order(token, { symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: '10' })
    expect(placed.res.status).toBe(200)
    const detail = await api(token, `/api/v1/orders/${placed.json.result.orderId}`)
    expect(detail.json.result).toMatchObject({ status: 'FILLED', price: null, execution: { filledQuantity: '10', averageFilledPrice: '72000', filledAmount: '720000', commission: '108' } })
    const holdings = await api(token, '/api/v1/holdings?symbol=005930')
    expect(holdings.json.result.items[0]).toMatchObject({ quantity: '20', averagePurchasePrice: '68500' })
    const bp = await api(token, '/api/v1/buying-power?currency=KRW')
    expect(bp.json.result).toEqual({ currency: 'KRW', cashBuyingPower: String(10_000_000 - 720_000 - 108) })
  })

  it('rests a non-marketable limit order, then modifies and cancels it', async () => {
    const token = await fetchToken()
    const placed = await order(token, { symbol: '005930', side: 'BUY', orderType: 'LIMIT', quantity: '10', price: '70000' })
    const orderId = placed.json.result.orderId as string
    expect((await api(token, `/api/v1/orders/${orderId}`)).json.result.status).toBe('PENDING')
    const bp = await api(token, '/api/v1/buying-power?currency=KRW')
    expect(bp.json.result.cashBuyingPower).toBe(String(10_000_000 - 700_105))

    const modified = await api(token, `/api/v1/orders/${orderId}/modify`, { method: 'POST', body: { orderType: 'LIMIT', quantity: '5', price: '71000' } })
    expect(modified.res.status).toBe(200)
    const newId = modified.json.result.orderId as string
    expect(newId).not.toBe(orderId)
    expect((await api(token, `/api/v1/orders/${orderId}`)).json.result.status).toBe('REPLACED')

    const canceled = await api(token, `/api/v1/orders/${newId}/cancel`, { method: 'POST', body: {} })
    expect(canceled.res.status).toBe(200)
    const after = await api(token, `/api/v1/orders/${newId}`)
    expect(after.json.result.status).toBe('CANCELED')
    expect(after.json.result.canceledAt).toMatch(/\+09:00$/)
    expect((await api(token, '/api/v1/buying-power?currency=KRW')).json.result.cashBuyingPower).toBe('10000000')
  })

  it('rejects cancelling a filled order and unknown orders', async () => {
    const token = await fetchToken()
    const placed = await order(token, { symbol: '005930', side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '73000' })
    const id = placed.json.result.orderId
    const res = await api(token, `/api/v1/orders/${id}/cancel`, { method: 'POST', body: {} })
    expect(res.res.status).toBe(409)
    expect((res.json as ApiError).error.code).toBe('already-filled')
    const missing = await api(token, '/api/v1/orders/does-not-exist/cancel', { method: 'POST', body: {} })
    expect(missing.res.status).toBe(404)
    expect((missing.json as ApiError).error.code).toBe('order-not-found')
  })

  it('rejects orders beyond buying power or sellable quantity', async () => {
    const token = await fetchToken()
    const tooBig = await order(token, { symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: '500' })
    expect(tooBig.res.status).toBe(422)
    expect((tooBig.json as ApiError).error.code).toBe('insufficient-buying-power')
    const oversell = await order(token, { symbol: '005930', side: 'SELL', orderType: 'MARKET', quantity: '11' })
    expect(oversell.res.status).toBe(422)
    expect((oversell.json as ApiError).error.code).toBe('insufficient-sellable-quantity')
    const badTick = await order(token, { symbol: '005930', side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '70050' })
    expect(badTick.res.status).toBe(400)
    expect((badTick.json as ApiError).error.data).toEqual({ field: 'price', tickSize: '100', nearestPrices: ['70000', '70100'] })
  })

  it('pages closed orders with a cursor', async () => {
    const token = await fetchToken()
    for (let i = 0; i < 3; i++) {
      await order(token, { symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: '1' })
    }
    const page1 = await api(token, '/api/v1/orders?status=CLOSED&limit=2')
    expect(page1.json.result.orders).toHaveLength(2)
    expect(page1.json.result.hasNext).toBe(true)
    const page2 = await api(token, `/api/v1/orders?status=CLOSED&limit=2&cursor=${page1.json.result.nextCursor}`)
    expect(page2.json.result).toMatchObject({ hasNext: false, nextCursor: null })
    expect(page2.json.result.orders).toHaveLength(1)
    const open = await api(token, '/api/v1/orders?status=OPEN')
    expect(open.json.result).toEqual({ orders: [], nextCursor: null, hasNext: false })
    const bad = await api(token, '/api/v1/orders?status=ALL')
    expect((bad.json as ApiError).error.code).toBe('invalid-request')
  })

  it('runs a conditional order through create, modify, trigger and cancel', async () => {
    const token = await fetchToken()
    const expireDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const created = await api(token, '/api/v1/conditional-orders', {
      method: 'POST',
      body: { symbol: '005930', type: 'SINGLE', quantity: '5', orderType: 'LIMIT', expireDate, first: { orderSide: 'SELL', triggerPrice: '75000', orderPrice: '75000' } },
    })
    expect(created.res.status).toBe(200)
    const id = created.json.result.conditionalOrderId as string
    const listed = await api(token, '/api/v1/conditional-orders?status=OPEN')
    expect(listed.json.result.conditionalOrders[0]).toMatchObject({ conditionalOrderId: id, status: 'WATCHING', market: 'KR', second: null })

    const modified = await api(token, `/api/v1/conditional-orders/${id}/modify`, {
      method: 'POST',
      body: { type: 'SINGLE', quantity: '5', orderType: 'MARKET', expireDate, first: { orderSide: 'SELL', triggerPrice: '76000' } },
    })
    const newId = modified.json.result.conditionalOrderId as string
    expect(newId).not.toBe(id)
    expect((await api(token, `/api/v1/conditional-orders/${id}`)).res.status).toBe(404)

    await app.request(`${base}/_emulator/prices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: '005930', price: 76000 }) })
    const fired = await api(token, `/api/v1/conditional-orders/${newId}`)
    expect(fired.json.result.status).toBe('COMPLETED')
    expect(fired.json.result.first.status).toBe('COMPLETED')
    const triggered = await api(token, `/api/v1/orders/${fired.json.result.first.triggeredOrderId}`)
    expect(triggered.json.result).toMatchObject({ side: 'SELL', status: 'FILLED', quantity: '5' })

    const another = await api(token, '/api/v1/conditional-orders', {
      method: 'POST',
      body: { symbol: '005930', type: 'SINGLE', quantity: '1', orderType: 'MARKET', expireDate, first: { orderSide: 'BUY', triggerPrice: '60000' } },
    })
    const delId = another.json.result.conditionalOrderId as string
    const del = await app.request(`${base}/api/v1/conditional-orders/${delId}`, {
      method: 'DELETE',
      headers: { 'authorization': `Bearer ${token}`, 'x-tossinvest-account': '1' },
    })
    expect(del.status).toBe(204)
    const closed = await api(token, '/api/v1/conditional-orders?status=CLOSED')
    expect(closed.json.result.conditionalOrders.find((co: { conditionalOrderId: string }) => co.conditionalOrderId === delId).first.status).toBe('CANCELED')
  })

  it('pages 1m indicator candles via nextBefore without gaps', async () => {
    const token = await fetchToken()
    const symbol = 'KOSPI'
    const first = await api(token, `/api/v1/market-indicators/${symbol}/candles?interval=1m&count=3`)
    expect(first.res.status).toBe(200)
    const { candles, nextBefore } = first.json.result
    const second = await api(token, `/api/v1/market-indicators/${symbol}/candles?interval=1m&count=3&before=${encodeURIComponent(nextBefore)}`)
    expect(second.res.status).toBe(200)
    const lastFirst = Date.parse(candles[candles.length - 1].timestamp)
    expect(Date.parse(second.json.result.candles[0].timestamp)).toBe(lastFirst - 60_000)
  })

  it('rejects amount orders that round down to zero shares', async () => {
    const token = await fetchToken()
    const tiny = await order(token, { symbol: 'AAPL', side: 'BUY', orderType: 'MARKET', orderAmount: '0.000001' })
    expect(tiny.res.status).toBe(400)
  })

  it('seeds demo data via plugin.seed', async () => {
    const store = new Store()
    const seededApp = new Hono()
    tossinvestPlugin.register(seededApp as any, store, new WebhookDispatcher(), base, new Map())
    tossinvestPlugin.seed?.(store, base)
    const tokenRes = await seededApp.request(`${base}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'tsck_example_client_id', client_secret: 'tsck_example_client_secret' }),
    })
    const { access_token } = (await tokenRes.json()) as { access_token: string }
    const res = await seededApp.request(`${base}/api/v1/accounts`, { headers: { authorization: `Bearer ${access_token}` } })
    expect(((await res.json()) as { result: unknown[] }).result).toEqual([{ accountNo: '12345678901', accountSeq: 1, accountType: 'BROKERAGE' }])
  })
})
