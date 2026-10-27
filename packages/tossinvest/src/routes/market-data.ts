import type { RouteContext, Store } from '@emulators/core'
import type { TossStock } from '../entities.js'
import type { Ctx } from '../helpers.js'
import { evaluateConditionalOrders } from '../conditional.js'
import { boolQuery, fail, fmt, intQuery, invalid, MSG_INVALID_FIELD, noise, ok, stockNotFound, SYMBOL_RE } from '../helpers.js'
import {
  candlePage,
  countryOf,
  currencyOf,
  formatPrice,
  priceLimits,
  roundToTick,
  stockCandleSpec,
  tickSize,
} from '../market.js'
import { getTossinvestStore } from '../store.js'
import { kstIso, parseDateTime } from '../time.js'
import { matchRestingOrders } from '../trading.js'

export function resolveStock(c: Ctx, store: Store, raw: string | undefined, field = 'symbol'): TossStock | Response {
  if (raw === undefined || raw === '') {
    return invalid(c, { field }, MSG_INVALID_FIELD)
  }
  if (!SYMBOL_RE.test(raw)) {
    return invalid(c, { field, pattern: '^[A-Za-z0-9.\\-]+$' }, MSG_INVALID_FIELD)
  }
  return getTossinvestStore(store).stocks.findOneBy('symbol', raw.toUpperCase()) ?? stockNotFound(c)
}

export function parseSymbols(c: Ctx, pattern: RegExp): string[] | Response {
  const raw = c.req.query('symbols') ?? ''
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (symbols.length < 1 || symbols.length > 200) {
    return invalid(c, { field: 'symbols', constraint: { min: 1, max: 200 } })
  }
  if (!symbols.every(s => pattern.test(s))) {
    return invalid(c, { field: 'symbols', pattern: pattern.source }, MSG_INVALID_FIELD)
  }
  return symbols
}

export function marketDataRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  app.get('/api/v1/prices', (c) => {
    const symbols = parseSymbols(c, SYMBOL_RE)
    if (symbols instanceof Response) {
      return symbols
    }
    const stocks = symbols.map(s => ts.stocks.findOneBy('symbol', s.toUpperCase()))
    if (stocks.includes(undefined)) {
      return stockNotFound(c)
    }
    const timestamp = kstIso(Date.now(), true)
    return ok(
      c,
      (stocks as TossStock[]).map(s => ({
        symbol: s.symbol,
        timestamp,
        lastPrice: formatPrice(s, s.price),
        currency: currencyOf(s.market),
      })),
    )
  })

  app.get('/api/v1/orderbook', (c) => {
    const stock = resolveStock(c, store, c.req.query('symbol'))
    if (stock instanceof Response) {
      return stock
    }
    const asks: Array<{ price: string, volume: string }> = []
    const bids: Array<{ price: string, volume: string }> = []
    const us = countryOf(stock.market) === 'US'
    let bid = stock.price
    let ask = stock.price + tickSize(stock, stock.price)
    for (let i = 0; i < 5; i++) {
      const vol = (side: string) => Math.round((us ? 100 : 1000) + noise(`${stock.symbol}:ob:${side}:${i}`) * (us ? 900 : 9000))
      asks.push({ price: formatPrice(stock, roundToTick(stock, ask)), volume: String(vol('a')) })
      bids.push({ price: formatPrice(stock, roundToTick(stock, bid)), volume: String(vol('b')) })
      ask += tickSize(stock, ask)
      bid -= tickSize(stock, bid)
    }
    return ok(c, { timestamp: kstIso(Date.now(), true), currency: currencyOf(stock.market), asks, bids })
  })

  app.get('/api/v1/trades', (c) => {
    const stock = resolveStock(c, store, c.req.query('symbol'))
    if (stock instanceof Response) {
      return stock
    }
    const count = intQuery(c, 'count', 50, 1, 50)
    if (count instanceof Response) {
      return count
    }
    const now = Date.now()
    const second = Math.floor(now / 1000)
    const us = countryOf(stock.market) === 'US'
    const trades = Array.from({ length: count }, (_, i) => {
      const t = second - i
      const step = Math.floor(noise(`${stock.symbol}:tr:${t}`) * 3) - 1
      const price = roundToTick(stock, stock.price + step * tickSize(stock, stock.price))
      return {
        price: formatPrice(stock, i === 0 ? stock.price : price),
        volume: String(1 + Math.floor(noise(`${stock.symbol}:tv:${t}`) * (us ? 50 : 500))),
        timestamp: kstIso(t * 1000 + Math.floor(noise(`${stock.symbol}:tm:${t}`) * 1000), true),
        currency: currencyOf(stock.market),
      }
    })
    return ok(c, trades)
  })

  app.get('/api/v1/price-limits', (c) => {
    const stock = resolveStock(c, store, c.req.query('symbol'))
    if (stock instanceof Response) {
      return stock
    }
    const { upper, lower } = priceLimits(store, stock)
    return ok(c, {
      timestamp: kstIso(Date.now(), true),
      upperLimitPrice: upper === null ? null : fmt(upper, 0),
      lowerLimitPrice: lower === null ? null : fmt(lower, 0),
      currency: currencyOf(stock.market),
    })
  })

  app.get('/api/v1/candles', (c) => {
    const interval = c.req.query('interval')
    if (interval !== '1m' && interval !== '1d') {
      return invalid(c, { field: 'interval', allowedValues: ['1m', '1d'] }, '지원하지 않는 캔들 주기입니다.')
    }
    const count = intQuery(c, 'count', 100, 1, 200)
    if (count instanceof Response) {
      return count
    }
    const adjusted = boolQuery(c, 'adjusted')
    if (adjusted instanceof Response) {
      return adjusted
    }
    const beforeRaw = c.req.query('before')
    const before = beforeRaw ? parseDateTime(beforeRaw) : undefined
    if (beforeRaw && before === undefined) {
      return invalid(c, { field: 'before', format: 'date-time' })
    }
    const stock = resolveStock(c, store, c.req.query('symbol'))
    if (stock instanceof Response) {
      return stock
    }
    const { bars, nextBefore } = candlePage(stockCandleSpec(store, stock), interval, count, before)
    const currency = currencyOf(stock.market)
    return ok(c, {
      candles: bars.map(b => ({
        timestamp: b.timestamp,
        openPrice: formatPrice(stock, b.open),
        highPrice: formatPrice(stock, b.high),
        lowPrice: formatPrice(stock, b.low),
        closePrice: formatPrice(stock, b.close),
        volume: String(b.volume),
        currency,
      })),
      nextBefore,
    })
  })

  app.post('/_emulator/prices', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { symbol?: unknown, price?: unknown } | null
    const symbol = typeof body?.symbol === 'string' ? body.symbol.toUpperCase() : ''
    const price = body?.price
    const stock = ts.stocks.findOneBy('symbol', symbol)
    if (!stock) {
      return fail(c, 404, 'stock-not-found', '종목을 찾을 수 없습니다.')
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return invalid(c, { field: 'price' })
    }
    const updated = ts.stocks.update(stock.id, { price })!
    matchRestingOrders(store, updated)
    evaluateConditionalOrders(store, updated)
    return ok(c, { symbol: updated.symbol, lastPrice: formatPrice(updated, updated.price) })
  })
}
