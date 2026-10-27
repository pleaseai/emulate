import { authMiddleware, createApiErrorHandler, createErrorHandler, Hono, Store, WebhookDispatcher } from '@emulators/core'
import { beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import { seedFromConfig, tossinvestPlugin } from '../index.js'
import { parseDateTime } from '../time.js'

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

  it('form-urldecodes Basic client credentials', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, { clients: [{ client_id: 'enc-client', client_secret: 'p+ss%w:rd 1' }] })
    const basic = (secret: string) => app.request(`${base}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'authorization': `Basic ${btoa(`enc-client:${secret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    })
    expect((await basic('p%2Bss%25w%3Ard+1')).status).toBe(200)
    expect((await basic('p%2Bss%25w%3Ard%201')).status).toBe(200)
    expect((await basic('p+ss%w:rd 1')).status).toBe(400)
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

  it('rejects Basic client authentication combined with form credentials', async () => {
    const res = await app.request(`${base}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'authorization': `Basic ${btoa('test-client:test-secret')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'test-client', client_secret: 'test-secret' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_request')
  })

  it('keeps an expired token expired after a reissue, then prunes it', async () => {
    const start = Date.now()
    try {
      setSystemTime(new Date(start))
      const first = await fetchToken()
      setSystemTime(new Date(start + 86_401_000))
      await fetchToken()
      expect((await api(first, '/api/v1/accounts')).json.error.code).toBe('expired-token')
      setSystemTime(new Date(start + 2 * 86_400_000 + 1000))
      await fetchToken()
      expect((await api(first, '/api/v1/accounts')).json.error.code).toBe('invalid-token')
    }
    finally {
      setSystemTime()
    }
  })

  it('keeps reporting token-revoked for old tokens after many reissues', async () => {
    const start = Date.now()
    try {
      setSystemTime(new Date(start))
      const first = await fetchToken()
      for (let i = 1; i <= 21; i++) {
        setSystemTime(new Date(start + i * 60_000))
        await fetchToken()
      }
      const stale = await api(first, '/api/v1/accounts')
      expect(stale.res.status).toBe(401)
      expect((stale.json as ApiError).error.code).toBe('token-revoked')
    }
    finally {
      setSystemTime()
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

  it('orders sector ETFs by market cap with missing caps last', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, {
      stocks: [
        { symbol: '100001', name: 'ETF 소형', market: 'KOSPI', security_type: 'ETF', price: 10000, shares_outstanding: '1000' },
        { symbol: '100002', name: 'ETF 미상', market: 'KOSPI', security_type: 'ETF', price: 10000, shares_outstanding: '0' },
        { symbol: '100003', name: 'ETF 대형', market: 'KOSPI', security_type: 'ETF', price: 10000, shares_outstanding: '100000' },
      ],
      sectors: [{ sector_id: '100', name: '반도체', parent_sector_id: '10', stocks: ['005930'], etfs: ['100001', '100002', '100003'] }],
    })
    const token = await fetchToken()
    const etfs = await api(token, '/api/v1/sectors/100/etfs?marketCountry=KR')
    expect(etfs.json.result.etfs.map((e: { symbol: string }) => e.symbol)).toEqual(['100003', '100001', '100002'])
  })

  it('reports liquidationTrading only for an active designation', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, {
      stocks: [
        { symbol: '200001', name: '정리매매 종료', market: 'KOSDAQ', price: 1000, warnings: [{ warningType: 'LIQUIDATION_TRADING', startDate: '2020-01-01', endDate: '2020-01-10' }] },
        { symbol: '200002', name: '정리매매 중', market: 'KOSDAQ', price: 1000, warnings: [{ warningType: 'LIQUIDATION_TRADING' }] },
      ],
    })
    const token = await fetchToken()
    const { json } = await api(token, '/api/v1/stocks?symbols=200001,200002')
    expect(json.result.map((s: any) => s.koreanMarketDetail.liquidationTrading)).toEqual([false, true])
  })

  it('excludes only investment-caution designations from rankings', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, {
      stocks: [
        { symbol: '300001', name: 'VI 발동', market: 'KOSPI', price: 1000, warnings: [{ warningType: 'VI_STATIC' }] },
        { symbol: '300002', name: '단기과열', market: 'KOSPI', price: 1000, warnings: [{ warningType: 'OVERHEATED' }] },
        { symbol: '300003', name: '투자위험', market: 'KOSPI', price: 1000, warnings: [{ warningType: 'INVESTMENT_RISK' }] },
      ],
    })
    const token = await fetchToken()
    const { json } = await api(token, '/api/v1/rankings?type=MARKET_TRADING_AMOUNT&marketCountry=KR&duration=1d&excludeInvestmentCaution=true')
    expect(json.result.rankings.map((r: { symbol: string }) => r.symbol).sort()).toEqual(['005930', '300001'])
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

  it('rejects conditional KR order prices outside the daily price band on create and modify', async () => {
    const token = await fetchToken()
    const upper = Number((await api(token, '/api/v1/price-limits?symbol=005930')).json.result.upperLimitPrice)
    const expireDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const body = (orderPrice: number) => ({
      symbol: '005930',
      type: 'SINGLE',
      quantity: '1',
      orderType: 'LIMIT',
      expireDate,
      first: { orderSide: 'SELL', triggerPrice: '75000', orderPrice: String(orderPrice) },
    })

    const outside = await api(token, '/api/v1/conditional-orders', { method: 'POST', body: body(upper + 1000) })
    expect(outside.res.status).toBe(422)
    expect((outside.json as ApiError).error.code).toBe('price-out-of-range')

    const created = await api(token, '/api/v1/conditional-orders', { method: 'POST', body: body(75000) })
    expect(created.res.status).toBe(200)
    const modify = (orderPrice: number) => api(token, `/api/v1/conditional-orders/${created.json.result.conditionalOrderId}/modify`, {
      method: 'POST',
      body: body(orderPrice),
    })
    expect((await modify(upper + 1000)).json.error.code).toBe('price-out-of-range')
    expect((await modify(76000)).res.status).toBe(200)
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

  it('rejects KR limit prices outside the daily price band on create and modify', async () => {
    const token = await fetchToken()
    const limits = (await api(token, '/api/v1/price-limits?symbol=005930')).json.result
    const upper = Number(limits.upperLimitPrice)
    const lower = Number(limits.lowerLimitPrice)
    const limit = (price: number) => order(token, { symbol: '005930', side: 'BUY', orderType: 'LIMIT', quantity: '1', price: String(price) })

    const above = await limit(upper + 1000)
    expect(above.res.status).toBe(422)
    expect((above.json as ApiError).error.code).toBe('price-out-of-range')
    expect((await limit(lower - 1000)).json.error.code).toBe('price-out-of-range')

    const resting = await limit(lower)
    expect(resting.res.status).toBe(200)
    const modify = (price: number) => api(token, `/api/v1/orders/${resting.json.result.orderId}/modify`, {
      method: 'POST',
      body: { orderType: 'LIMIT', quantity: '1', price: String(price) },
    })
    expect((await modify(upper + 1000)).json.error.code).toBe('price-out-of-range')
    expect((await modify(lower + 1000)).res.status).toBe(200)
  })

  it('counts settlement days from the next business day for weekend fills', async () => {
    const settlementAt = async (iso: string, symbol: string) => {
      setSystemTime(new Date(iso))
      const token = await fetchToken()
      const placed = await order(token, { symbol, side: 'BUY', orderType: 'MARKET', quantity: '1' })
      const detail = await api(token, `/api/v1/orders/${placed.json.result.orderId}`)
      return detail.json.result.execution.settlementDate
    }
    try {
      expect(await settlementAt('2026-10-30T03:00:00Z', '005930')).toBe('2026-11-03') // Fri KST, T+2
      expect(await settlementAt('2026-10-31T03:00:00Z', '005930')).toBe('2026-11-04') // Sat KST → Mon, T+2
      expect(await settlementAt('2026-10-31T16:00:00Z', 'AAPL')).toBe('2026-11-03') // Sat New York → Mon, T+1
    }
    finally {
      setSystemTime()
    }
  })

  it('accepts a buy when cash exactly covers the fill cost', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, { accounts: [{ account_seq: 2, cash: { krw: 72_010 } }] })
    const token = await fetchToken()
    const placed = await api(token, '/api/v1/orders', { method: 'POST', account: 2, body: { symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: '1' } })
    expect(placed.res.status).toBe(200)
    expect((await api(token, '/api/v1/buying-power?currency=KRW', { account: 2 })).json.result.cashBuyingPower).toBe('0')
  })

  it('rejects modifying a CLS order into a market order', async () => {
    const token = await fetchToken()
    const placed = await order(token, { symbol: 'AAPL', side: 'BUY', orderType: 'LIMIT', timeInForce: 'CLS', quantity: '1', price: '180' })
    expect(placed.res.status).toBe(200)
    const modified = await api(token, `/api/v1/orders/${placed.json.result.orderId}/modify`, { method: 'POST', body: { orderType: 'MARKET' } })
    expect(modified.res.status).toBe(400)
    expect((modified.json as ApiError).error.data).toMatchObject({ field: 'timeInForce' })
    expect((await api(token, `/api/v1/orders/${placed.json.result.orderId}`)).json.result.status).toBe('PENDING')
  })

  it('serves sellable quantity and commissions, with account-not-found as 400', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, { accounts: [{ account_seq: 2, commission: { kr: '0.0001', kr_start_date: '2025-07-01' } }] })
    const token = await fetchToken()
    await order(token, { symbol: '005930', side: 'SELL', orderType: 'LIMIT', quantity: '3', price: '80000' })
    expect((await api(token, '/api/v1/sellable-quantity?symbol=005930')).json.result).toEqual({ sellableQuantity: '7' })
    expect((await api(token, '/api/v1/commissions')).json.result).toEqual([
      { marketCountry: 'KR', commissionRate: '0.00015', startDate: '2026-01-01', endDate: null },
      { marketCountry: 'US', commissionRate: '0.001', startDate: null, endDate: null },
    ])
    expect((await api(token, '/api/v1/commissions', { account: 2 })).json.result[0]).toMatchObject({ commissionRate: '0.0001', startDate: '2025-07-01' })
    for (const path of ['/api/v1/sellable-quantity?symbol=005930', '/api/v1/commissions']) {
      const missing = await api(token, path, { account: 99 })
      expect(missing.res.status).toBe(400)
      expect((missing.json as ApiError).error.code).toBe('account-not-found')
    }
  })

  it('replays the original conditional create after the order was modified', async () => {
    const token = await fetchToken()
    const expireDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const body = { symbol: '005930', clientOrderId: 'co-1', type: 'SINGLE', quantity: '1', orderType: 'MARKET', expireDate, first: { orderSide: 'BUY', triggerPrice: '60000' } }
    const created = await api(token, '/api/v1/conditional-orders', { method: 'POST', body })
    expect(created.res.status).toBe(200)
    const id = created.json.result.conditionalOrderId as string
    const modified = await api(token, `/api/v1/conditional-orders/${id}/modify`, {
      method: 'POST',
      body: { type: 'SINGLE', quantity: '2', orderType: 'MARKET', expireDate, first: { orderSide: 'BUY', triggerPrice: '61000' } },
    })
    expect(modified.res.status).toBe(200)
    const retry = await api(token, '/api/v1/conditional-orders', { method: 'POST', body })
    expect(retry.res.status).toBe(200)
    expect(retry.json.result).toEqual({ conditionalOrderId: id, clientOrderId: 'co-1' })
  })

  it('rejects conditional quantities finer than the stock supports', async () => {
    const token = await fetchToken()
    const expireDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const res = await api(token, '/api/v1/conditional-orders', {
      method: 'POST',
      body: { symbol: 'AAPL', type: 'SINGLE', quantity: '0.0000001', orderType: 'MARKET', expireDate, first: { orderSide: 'BUY', triggerPrice: '200' } },
    })
    expect(res.res.status).toBe(400)
    expect((res.json as ApiError).error).toMatchObject({ code: 'invalid-request', data: { field: 'quantity' } })
  })

  it('accepts conditional quantities whose extra decimals are trailing zeros', async () => {
    const token = await fetchToken()
    const expireDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const create = (symbol: string, quantity: string, triggerPrice: string) => api(token, '/api/v1/conditional-orders', {
      method: 'POST',
      body: { symbol, type: 'SINGLE', quantity, orderType: 'MARKET', expireDate, first: { orderSide: 'BUY', triggerPrice } },
    })
    expect((await create('005930', '1.0', '60000')).res.status).toBe(200)
    expect((await create('AAPL', '0.1000000', '150')).res.status).toBe(200)
  })

  it('keeps an explicitly null KR commission start date across reseeds', async () => {
    const test = createTestApp()
    app = test.app
    seedFromConfig(test.store, base, { accounts: [{ account_seq: 3, commission: { kr_start_date: null } }] })
    seedFromConfig(test.store, base, { accounts: [{ account_seq: 3, cash: { krw: 1000 } }] })
    const token = await fetchToken()
    expect((await api(token, '/api/v1/commissions', { account: 3 })).json.result[0].startDate).toBeNull()
  })

  it('replays a conditional create retried after the KST date rolled over', async () => {
    try {
      setSystemTime(new Date('2026-11-02T14:55:00Z')) // 23:55 KST
      const token = await fetchToken()
      const body = { symbol: '005930', clientOrderId: 'co-midnight', type: 'SINGLE', quantity: '1', orderType: 'MARKET', expireDate: '2026-11-02', first: { orderSide: 'BUY', triggerPrice: '60000' } }
      const created = await api(token, '/api/v1/conditional-orders', { method: 'POST', body })
      expect(created.res.status).toBe(200)
      setSystemTime(new Date('2026-11-02T15:02:00Z')) // 00:02 KST the next day
      const retry = await api(token, '/api/v1/conditional-orders', { method: 'POST', body })
      expect(retry.res.status).toBe(200)
      expect(retry.json.result.conditionalOrderId).toBe(created.json.result.conditionalOrderId)
    }
    finally {
      setSystemTime()
    }
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

describe('tossinvest emulator: time parsing', () => {
  it('reads offset-less date-times as KST and honors explicit offsets', () => {
    expect(parseDateTime('2026-10-27T10:00:00')).toBe(Date.parse('2026-10-27T01:00:00Z'))
    expect(parseDateTime('2026-10-27T10:00')).toBe(Date.parse('2026-10-27T01:00:00Z'))
    expect(parseDateTime('2026-10-27T10:00:00Z')).toBe(Date.parse('2026-10-27T10:00:00Z'))
    expect(parseDateTime('2026-10-27T10:00:00 09:00')).toBe(Date.parse('2026-10-27T01:00:00Z'))
    expect(parseDateTime('2026-10-27T10:00:00-05:00')).toBe(Date.parse('2026-10-27T15:00:00Z'))
  })
})

describe('tossinvest emulator: market calendar', () => {
  it('closes country-specific holidays and honors seeded overrides', async () => {
    try {
      setSystemTime(new Date('2026-06-01T03:00:00Z'))
      const test = createTestApp()
      app = test.app
      const token = await fetchToken()
      const childrensDay = await api(token, '/api/v1/market-calendar/KR?date=2026-05-05')
      expect(childrensDay.json.result.today).toEqual({ date: '2026-05-05', integrated: null })
      expect(childrensDay.json.result.nextBusinessDay.date).toBe('2026-05-06')
      const after = await api(token, '/api/v1/market-calendar/KR?date=2026-05-06')
      expect(after.json.result.previousBusinessDay.date).toBe('2026-05-04')
      const us = await api(token, '/api/v1/market-calendar/US?date=2026-07-03')
      expect(us.json.result.today).toEqual({ date: '2026-07-03', dayMarket: null, preMarket: null, regularMarket: null, afterMarket: null })
      expect(us.json.result.previousBusinessDay.date).toBe('2026-07-02')
      expect(us.json.result.nextBusinessDay.date).toBe('2026-07-06')

      seedFromConfig(test.store, base, { holidays: { KR: [] } })
      const open = await api(token, '/api/v1/market-calendar/KR?date=2026-05-05')
      expect(open.json.result.today.integrated).not.toBeNull()
      expect((await api(token, '/api/v1/market-calendar/US?date=2026-07-03')).json.result.today.regularMarket).toBeNull()
    }
    finally {
      setSystemTime()
    }
  })
})

describe('tossinvest emulator: holidays in market data', () => {
  it('skips a KR holiday in daily candles and the previous close', async () => {
    try {
      setSystemTime(new Date('2026-10-08T03:00:00Z')) // Thu 12:00 KST
      const token = await fetchToken()
      const thursdayLimits = (await api(token, '/api/v1/price-limits?symbol=005930')).json.result
      setSystemTime(new Date('2026-10-09T03:00:00Z')) // Hangul Day, 12:00 KST
      const holidayToken = await fetchToken()
      const candles = await api(holidayToken, '/api/v1/candles?symbol=005930&interval=1d&count=3')
      expect(candles.json.result.candles.map((b: { timestamp: string }) => b.timestamp.slice(0, 10))).toEqual(['2026-10-08', '2026-10-07', '2026-10-06'])
      expect(candles.json.result.candles[0].closePrice).toBe('72000')
      const holidayLimits = (await api(holidayToken, '/api/v1/price-limits?symbol=005930')).json.result
      expect([holidayLimits.upperLimitPrice, holidayLimits.lowerLimitPrice]).toEqual([thursdayLimits.upperLimitPrice, thursdayLimits.lowerLimitPrice])
    }
    finally {
      setSystemTime()
    }
  })

  it('rejects malformed seeded holiday dates', () => {
    const { store } = createTestApp()
    expect(() => seedFromConfig(store, base, { holidays: { KR: ['2026-2-16'] } })).toThrow(/KR.*"2026-2-16"/)
    expect(() => seedFromConfig(store, base, { holidays: { US: ['2026-02-30'] } })).toThrow(/US.*"2026-02-30"/)
  })
})
