import type { RouteContext } from '@emulators/core'
import type { TossStock } from '../entities.js'
import { boolQuery, enumQuery, fail, fmt, intQuery, ok } from '../helpers.js'
import {
  closeTradingDaysAgo,
  countryOf,
  currencyOf,
  dailyVolume,
  DURATION_DAYS,
  formatPrice,
  latestTradingDay,
  previousClose,
} from '../market.js'
import { getTossinvestStore } from '../store.js'
import { kstIso, prevBusinessDay } from '../time.js'
import { activeWarnings } from './stock-info.js'

const TYPES = [
  'MARKET_TRADING_AMOUNT',
  'MARKET_TRADING_VOLUME',
  'TOP_GAINERS',
  'TOP_LOSERS',
  'TOSS_SECURITIES_TRADING_AMOUNT',
  'TOSS_SECURITIES_TRADING_VOLUME',
] as const
const COUNTRIES = ['KR', 'US'] as const
const DURATIONS = ['realtime', '1d', '1w', '1mo', '3mo', '6mo', '1y'] as const
const TOSS_SHARE = 0.02

export function volumeOver(stock: TossStock, days: number): number {
  let d = latestTradingDay(countryOf(stock.market))
  let total = 0
  for (let i = 0; i < days; i++) {
    total += dailyVolume(stock, d)
    d = prevBusinessDay(d)
  }
  return total
}

export function changeOver(stock: TossStock, days: number): { base: number, rate: number | null } {
  const base = days <= 1 ? previousClose(stock) : closeTradingDaysAgo(stock, days)
  return { base, rate: base === 0 ? null : (stock.price - base) / base }
}

export function rankingRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  app.get('/api/v1/rankings', (c) => {
    const type = enumQuery(c, 'type', TYPES)
    if (type instanceof Response) {
      return type
    }
    const country = enumQuery(c, 'marketCountry', COUNTRIES)
    if (country instanceof Response) {
      return country
    }
    const duration = enumQuery(c, 'duration', DURATIONS)
    if (duration instanceof Response) {
      return duration
    }
    if ((type === 'TOP_GAINERS' || type === 'TOP_LOSERS') && duration === 'realtime') {
      return fail(c, 400, 'unsupported-ranking-duration', '지원하지 않는 랭킹 기간입니다.', {
        field: 'duration',
        allowedValues: DURATIONS.filter(d => d !== 'realtime'),
      })
    }
    const excludeCaution = boolQuery(c, 'excludeInvestmentCaution')
    if (excludeCaution instanceof Response) {
      return excludeCaution
    }
    const count = intQuery(c, 'count', 100, 1, 100)
    if (count instanceof Response) {
      return count
    }

    const days = duration === 'realtime' ? 1 : DURATION_DAYS[duration]
    const periodChange = type === 'TOP_GAINERS' || type === 'TOP_LOSERS'
    const scale = type.startsWith('TOSS_SECURITIES') ? TOSS_SHARE : 1
    const rows = ts.stocks
      .all()
      .filter(s => s.status === 'ACTIVE' && countryOf(s.market) === country)
      .filter(s => !excludeCaution || activeWarnings(s).length === 0)
      .map((s) => {
        const { base, rate } = changeOver(s, periodChange ? days : 1)
        const volume = Math.round(volumeOver(s, days) * scale)
        return { s, base, rate: rate ?? 0, rawRate: rate, volume, amount: volume * s.price }
      })
    const key = (r: (typeof rows)[number]): number => {
      if (type === 'TOP_GAINERS') {
        return r.rate
      }
      if (type === 'TOP_LOSERS') {
        return -r.rate
      }
      return type.endsWith('VOLUME') ? r.volume : r.amount
    }
    rows.sort((a, b) => key(b) - key(a))
    const rankings = rows.slice(0, count).map((r, i) => ({
      rank: i + 1,
      symbol: r.s.symbol,
      currency: currencyOf(r.s.market),
      price: {
        lastPrice: formatPrice(r.s, r.s.price),
        basePrice: formatPrice(r.s, r.base),
        changeRate: r.rawRate === null ? null : fmt(r.rawRate, 4),
      },
      tradingVolume: String(r.volume),
      tradingAmount: fmt(r.amount, currencyOf(r.s.market) === 'KRW' ? 0 : 2),
    }))
    return ok(c, { rankedAt: rankings.length ? kstIso(Date.now()) : null, rankings })
  })
}
