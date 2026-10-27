import type { RouteContext } from '@emulators/core'
import { fail, fmt, intQuery, invalid, noise, ok } from '../helpers.js'
import { candlePage, indicatorCandleSpec, indicatorLevel, MARKET_INDICATOR_SYMBOLS, MARKET_INDICATORS } from '../market.js'
import {
  addBusinessDays,
  businessDayOnOrBefore,
  dateToDayIdx,
  dayIdxToDate,
  isoWithOffset,
  kstDayIdx,
  kstIso,
  localMidnightMs,
  parseDateTime,
  prevBusinessDay,
} from '../time.js'
import { parseSymbols } from './market-data.js'

const INVESTOR_SYMBOLS = ['KOSPI', 'KOSDAQ']
const INVESTOR_INTERVALS = ['1d', '1w', '1mo', '1y'] as const
type InvestorInterval = (typeof INVESTOR_INTERVALS)[number]
const BREAKDOWN_KEYS = [
  'financialInvestment',
  'insurance',
  'trust',
  'privateEquityFund',
  'bank',
  'otherFinancialInstitution',
  'pensionFund',
] as const
const BREAKDOWN_WEIGHTS = [0.43, 0.07, 0.13, 0.06, 0.03, 0.05, 0.23]

function unsupportedSymbol(c: Parameters<typeof fail>[0], field: string, allowed: string[]) {
  return fail(c, 400, 'unsupported-symbol', '지원하지 않는 심볼입니다.', { field, allowedValues: allowed })
}

function bucketDate(interval: InvestorInterval, dayIdx: number): number {
  if (interval === '1d') {
    return businessDayOnOrBefore(dayIdx)
  }
  const d = dayIdx
  const date = new Date(d * 86_400_000)
  if (interval === '1w') {
    return d - ((date.getUTCDay() + 6) % 7)
  }
  if (interval === '1mo') {
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86_400_000)
  }
  return Math.floor(Date.UTC(date.getUTCFullYear(), 0, 1) / 86_400_000)
}

function previousBucket(interval: InvestorInterval, bucket: number): number {
  if (interval === '1d') {
    return prevBusinessDay(bucket)
  }
  if (interval === '1w') {
    return bucket - 7
  }
  const date = new Date(bucket * 86_400_000)
  return interval === '1mo'
    ? Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1) / 86_400_000)
    : Math.floor(Date.UTC(date.getUTCFullYear() - 1, 0, 1) / 86_400_000)
}

const BUCKET_DAYS: Record<InvestorInterval, number> = { '1d': 1, '1w': 5, '1mo': 21, '1y': 250 }

function investorRecord(symbol: string, interval: InvestorInterval, bucket: number, today: number) {
  const n = (k: string) => noise(`${symbol}:mi:${interval}:${k}:${bucket}`)
  const scale = (symbol === 'KOSPI' ? 12e12 : 8e12) * BUCKET_DAYS[interval] * (0.8 + 0.4 * n('t'))
  const round = (x: number) => Math.round(x / 1e8) * 1e8
  const breakdownBuy = BREAKDOWN_WEIGHTS.map((w, i) => round(scale * 0.18 * w * (0.85 + 0.3 * n(`bb${i}`))))
  const breakdownSell = BREAKDOWN_WEIGHTS.map((w, i) => round(scale * 0.18 * w * (0.85 + 0.3 * n(`bs${i}`))))
  const instBuy = breakdownBuy.reduce((a, b) => a + b, 0)
  const instSell = breakdownSell.reduce((a, b) => a + b, 0)
  const foreignBuy = round(scale * 0.32 * (0.9 + 0.2 * n('fb')))
  const foreignSell = round(scale * 0.32 * (0.9 + 0.2 * n('fs')))
  const otherBuy = round(scale * 0.04 * (0.9 + 0.2 * n('ob')))
  const otherSell = round(scale * 0.04 * (0.9 + 0.2 * n('os')))
  const individualBuy = round(scale * 0.46 * (0.9 + 0.2 * n('ib')))
  const individualSell = individualBuy + instBuy + foreignBuy + otherBuy - (instSell + foreignSell + otherSell)
  const pair = (b: number, s: number) => ({ buyAmount: fmt(b, 0), sellAmount: fmt(s, 0) })
  const lastDay = Math.min(today, addBusinessDays(bucket, Math.max(0, BUCKET_DAYS[interval] - 1)))
  const updatedAt = lastDay >= today
    ? kstIso(Date.now())
    : isoWithOffset(localMidnightMs(lastDay, 540) + 18 * 3_600_000 + 10 * 60_000, 540)
  return {
    date: dayIdxToDate(bucket),
    updatedAt,
    individual: pair(individualBuy, individualSell),
    foreigner: pair(foreignBuy, foreignSell),
    institution: {
      ...pair(instBuy, instSell),
      breakdown: Object.fromEntries(BREAKDOWN_KEYS.map((k, i) => [k, pair(breakdownBuy[i], breakdownSell[i])])),
    },
    otherCorporation: pair(otherBuy, otherSell),
  }
}

export function marketIndicatorRoutes({ app }: RouteContext): void {
  app.get('/api/v1/market-indicators/prices', (c) => {
    const symbols = parseSymbols(c, /^\w+$/)
    if (symbols instanceof Response) {
      return symbols
    }
    if (!symbols.every(s => MARKET_INDICATOR_SYMBOLS.includes(s))) {
      return unsupportedSymbol(c, 'symbols', MARKET_INDICATOR_SYMBOLS)
    }
    const now = Date.now()
    return ok(c, symbols.map(symbol => ({ symbol, timestamp: kstIso(now), lastPrice: fmt(indicatorLevel(symbol, now), 2) })))
  })

  app.get('/api/v1/market-indicators/:symbol/candles', (c) => {
    const symbol = c.req.param('symbol')
    if (!MARKET_INDICATOR_SYMBOLS.includes(symbol)) {
      return unsupportedSymbol(c, 'symbol', MARKET_INDICATOR_SYMBOLS)
    }
    const interval = c.req.query('interval')
    if (interval !== '1m' && interval !== '1d') {
      return invalid(c, { field: 'interval', allowedValues: ['1m', '1d'] }, '지원하지 않는 캔들 주기입니다.')
    }
    if (interval === '1m' && MARKET_INDICATORS[symbol].asset === 'BOND') {
      return invalid(c, { field: 'interval', allowedValues: ['1d'] }, '지원하지 않는 캔들 주기입니다.')
    }
    const count = intQuery(c, 'count', 100, 1, 200)
    if (count instanceof Response) {
      return count
    }
    const beforeRaw = c.req.query('before')
    const before = beforeRaw ? parseDateTime(beforeRaw) : undefined
    if (beforeRaw && before === undefined) {
      return invalid(c, { field: 'before', format: 'date-time' })
    }
    // Indicator minute bars are stamped with the bar start time.
    const { bars, nextBefore } = candlePage(indicatorCandleSpec(symbol), interval, count, before !== undefined && interval === '1m' ? before + 60_000 : before, Date.now(), m =>
      isoWithOffset((m - 1) * 60_000, 540))
    return ok(c, {
      candles: bars.map(b => ({
        timestamp: b.timestamp,
        openPrice: fmt(b.open, 2),
        highPrice: fmt(b.high, 2),
        lowPrice: fmt(b.low, 2),
        closePrice: fmt(b.close, 2),
        volume: String(b.volume),
      })),
      nextBefore,
    })
  })

  app.get('/api/v1/market-indicators/:symbol/investor-trading', (c) => {
    const symbol = c.req.param('symbol')
    if (!INVESTOR_SYMBOLS.includes(symbol)) {
      return unsupportedSymbol(c, 'symbol', INVESTOR_SYMBOLS)
    }
    const interval = c.req.query('interval') as InvestorInterval | undefined
    if (!interval || !INVESTOR_INTERVALS.includes(interval)) {
      return invalid(c, { field: 'interval', allowedValues: [...INVESTOR_INTERVALS] })
    }
    const count = intQuery(c, 'count', 10, 1, 100)
    if (count instanceof Response) {
      return count
    }
    const untilRaw = c.req.query('until')
    const until = untilRaw ? dateToDayIdx(untilRaw) : undefined
    if (untilRaw && until === undefined) {
      return invalid(c, { field: 'until', format: 'date' })
    }
    const today = kstDayIdx(Date.now())
    const earliest = today - 3650
    let bucket = bucketDate(interval, Math.min(today, until ?? today))
    const records = []
    while (records.length < count && bucket >= earliest) {
      records.push(investorRecord(symbol, interval, bucket, today))
      bucket = previousBucket(interval, bucket)
    }
    return ok(c, { nextUntil: bucket >= earliest ? dayIdxToDate(bucket) : null, records })
  })
}
