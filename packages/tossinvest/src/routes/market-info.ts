import type { RouteContext } from '@emulators/core'
import type { Holidays } from '../time.js'
import { fail, fmt, invalid, ok } from '../helpers.js'
import { holidaysOf, usdKrwMid } from '../market.js'
import {
  dateToDayIdx,
  dayIdxToDate,
  isBusinessDay,
  isoWithOffset,
  kstDayIdx,
  localMidnightMs,
  nextBusinessDay,
  parseDateTime,
  prevBusinessDay,
  usDayIdx,
  usIsDst,
} from '../time.js'

const CURRENCIES = ['KRW', 'USD']
const FX_SPREAD_BP = 40

function kstAt(dayIdx: number, h: number, m = 0): string {
  return isoWithOffset(localMidnightMs(dayIdx, 540) + (h * 60 + m) * 60_000, 540)
}

function krDay(dayIdx: number, holidays: Holidays): Record<string, unknown> {
  if (!isBusinessDay(dayIdx, holidays)) {
    return { date: dayIdxToDate(dayIdx), integrated: null }
  }
  return {
    date: dayIdxToDate(dayIdx),
    integrated: {
      preMarket: { startTime: kstAt(dayIdx, 8), singlePriceAuctionStartTime: kstAt(dayIdx, 8, 50), endTime: kstAt(dayIdx, 9) },
      regularMarket: { startTime: kstAt(dayIdx, 9), singlePriceAuctionStartTime: kstAt(dayIdx, 15, 20), endTime: kstAt(dayIdx, 15, 30) },
      afterMarket: { startTime: kstAt(dayIdx, 15, 30), singlePriceAuctionEndTime: kstAt(dayIdx, 15, 40), endTime: kstAt(dayIdx, 20) },
    },
  }
}

// US sessions expressed in KST on the US-local trading date. Standard time
// shifts the US sessions one hour later in KST; the Toss day market does not move.
function usDay(dayIdx: number, holidays: Holidays): Record<string, unknown> {
  const date = dayIdxToDate(dayIdx)
  if (!isBusinessDay(dayIdx, holidays)) {
    return { date, dayMarket: null, preMarket: null, regularMarket: null, afterMarket: null }
  }
  const s = usIsDst(dayIdx) ? 0 : 60
  return {
    date,
    dayMarket: { startTime: kstAt(dayIdx, 9), endTime: kstAt(dayIdx, 16, 50) },
    preMarket: { startTime: kstAt(dayIdx, 17, s), endTime: kstAt(dayIdx, 22, 30 + s) },
    regularMarket: { startTime: kstAt(dayIdx, 22, 30 + s), endTime: kstAt(dayIdx, 29, s) },
    afterMarket: { startTime: kstAt(dayIdx, 29, s), endTime: kstAt(dayIdx, 31, s) },
  }
}

const CALENDAR_RANGE_DAYS = 366

export function marketInfoRoutes({ app, store }: RouteContext): void {
  app.get('/api/v1/exchange-rate', (c) => {
    const base = c.req.query('baseCurrency')
    const quote = c.req.query('quoteCurrency')
    for (const [field, value] of [['baseCurrency', base], ['quoteCurrency', quote]] as const) {
      if (!value || !CURRENCIES.includes(value)) {
        return invalid(c, { field, allowedValues: CURRENCIES }, '지원하지 않는 통화입니다.')
      }
    }
    if (base === quote) {
      return invalid(c, { field: 'baseCurrency,quoteCurrency' }, '기준 통화와 상대 통화가 같을 수 없습니다.')
    }
    const now = Date.now()
    const raw = c.req.query('dateTime')
    const at = raw ? parseDateTime(raw) : now
    if (at === undefined) {
      return invalid(c, { field: 'dateTime', format: 'date-time' })
    }
    if (at > now) {
      return fail(c, 404, 'exchange-rate-not-found', '요청한 시점의 환율 정보가 없습니다.')
    }
    const from = Math.floor(at / 60_000) * 60_000
    const usdKrw = usdKrwMid(store, from)
    const prevUsdKrw = usdKrwMid(store, from - 60_000)
    const usdBase = base === 'USD'
    const mid = usdBase ? usdKrw : 1 / usdKrw
    const bp = usdBase ? FX_SPREAD_BP : -FX_SPREAD_BP
    const rate = mid * (1 + bp / 10_000)
    const dp = usdBase ? 2 : 8
    const change = usdBase ? usdKrw - prevUsdKrw : prevUsdKrw - usdKrw
    return ok(c, {
      baseCurrency: base,
      quoteCurrency: quote,
      rate: fmt(rate, dp),
      midRate: fmt(mid, dp),
      basisPoint: fmt(((Number(fmt(rate, dp)) - Number(fmt(mid, dp))) / Number(fmt(mid, dp))) * 10_000, 1),
      rateChangeType: change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'EQUAL',
      validFrom: isoWithOffset(from, 540),
      validUntil: isoWithOffset(from + 60_000, 540),
    })
  })

  app.get('/api/v1/market-calendar/KR', (c) => {
    const today = kstDayIdx(Date.now())
    const raw = c.req.query('date')
    const day = raw ? dateToDayIdx(raw) : today
    if (day === undefined || Math.abs(day - today) > CALENDAR_RANGE_DAYS) {
      return fail(c, 400, 'unsupported-date', '요청한 조회 일자를 지원하지 않습니다.', { field: 'date' })
    }
    const h = holidaysOf(store, 'KR')
    return ok(c, { today: krDay(day, h), previousBusinessDay: krDay(prevBusinessDay(day, h), h), nextBusinessDay: krDay(nextBusinessDay(day, h), h) })
  })

  // The US calendar documents no 400, so an unusable `date` falls back to today.
  app.get('/api/v1/market-calendar/US', (c) => {
    const today = usDayIdx(Date.now())
    const parsed = dateToDayIdx(c.req.query('date') ?? '')
    const day = parsed !== undefined && Math.abs(parsed - today) <= CALENDAR_RANGE_DAYS ? parsed : today
    const h = holidaysOf(store, 'US')
    return ok(c, { today: usDay(day, h), previousBusinessDay: usDay(prevBusinessDay(day, h), h), nextBusinessDay: usDay(nextBusinessDay(day, h), h) })
  })
}
