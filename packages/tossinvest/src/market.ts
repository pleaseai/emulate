import type { Store } from '@emulators/core'
import type { Currency, MarketCountry, StockMarket, TossStock } from './entities.js'
import { fmt, noise } from './helpers.js'
import {
  businessDayOnOrBefore,
  DAY_MS,
  isoWithOffset,
  kstDayIdx,
  localMidnightMs,
  prevBusinessDay,
  usDayIdx,
  usOffsetMinutes,
} from './time.js'

const KR_MARKETS: readonly StockMarket[] = ['KOSPI', 'KOSDAQ', 'KR_ETC']

export function countryOf(market: StockMarket): MarketCountry {
  return KR_MARKETS.includes(market) ? 'KR' : 'US'
}

export function currencyOf(market: StockMarket): Currency {
  return countryOf(market) === 'KR' ? 'KRW' : 'USD'
}

export function priceDp(country: MarketCountry): number {
  return country === 'KR' ? 0 : 2
}

export function tickSize(stock: TossStock, price: number): number {
  if (countryOf(stock.market) === 'US') {
    return price < 1 ? 0.0001 : 0.01
  }
  if (stock.security_type === 'ETF' || stock.security_type === 'ETN') {
    return 5
  }
  if (price < 2000) {
    return 1
  }
  if (price < 5000) {
    return 5
  }
  if (price < 20000) {
    return 10
  }
  if (price < 50000) {
    return 50
  }
  if (price < 200000) {
    return 100
  }
  if (price < 500000) {
    return 500
  }
  return 1000
}

export function roundToTick(stock: TossStock, price: number): number {
  if (countryOf(stock.market) === 'US') {
    const dp = price < 1 ? 4 : 2
    return Math.round(price * 10 ** dp) / 10 ** dp
  }
  const tick = tickSize(stock, price)
  return Math.max(tick, Math.round(price / tick) * tick)
}

export function formatPrice(stock: TossStock, price: number): string {
  return fmt(price, countryOf(stock.market) === 'US' ? (price < 1 ? 4 : 2) : 0)
}

export function localDayIdx(country: MarketCountry, ms: number): number {
  return country === 'KR' ? kstDayIdx(ms) : usDayIdx(ms)
}

export function localOffset(country: MarketCountry, dayIdx: number): number {
  return country === 'KR' ? 540 : usOffsetMinutes(dayIdx)
}

export function dayBarTimestamp(country: MarketCountry, dayIdx: number): string {
  const off = localOffset(country, dayIdx)
  return isoWithOffset(localMidnightMs(dayIdx, off), off)
}

export function latestTradingDay(country: MarketCountry, now = Date.now()): number {
  return businessDayOnOrBefore(localDayIdx(country, now))
}

function dailyFactor(key: string, dayIdx: number): number {
  const phase = noise(`${key}:phase`) * Math.PI * 2
  return 1 + 0.06 * Math.sin(dayIdx / 11 + phase) + 0.04 * (noise(`${key}:d:${dayIdx}`) - 0.5)
}

function minuteFactor(key: string, minuteIdx: number): number {
  const phase = noise(`${key}:mphase`) * Math.PI * 2
  return 1 + 0.004 * Math.sin(minuteIdx / 17 + phase) + 0.003 * (noise(`${key}:m:${minuteIdx}`) - 0.5)
}

export function rawDailyClose(key: string, price: number, dayIdx: number, latest: number): number {
  return (price * dailyFactor(key, dayIdx)) / dailyFactor(key, latest)
}

export function rawMinuteClose(key: string, price: number, minuteIdx: number, latest: number): number {
  return (price * minuteFactor(key, minuteIdx)) / minuteFactor(key, latest)
}

export function dailyClose(stock: TossStock, dayIdx: number, now = Date.now()): number {
  const country = countryOf(stock.market)
  const latest = latestTradingDay(country, now)
  return roundToTick(stock, rawDailyClose(stock.symbol, stock.price, dayIdx, latest))
}

export function previousClose(stock: TossStock, now = Date.now()): number {
  const country = countryOf(stock.market)
  return dailyClose(stock, prevBusinessDay(latestTradingDay(country, now)), now)
}

export function closeTradingDaysAgo(stock: TossStock, n: number, now = Date.now()): number {
  let d = latestTradingDay(countryOf(stock.market), now)
  for (let i = 0; i < n; i++) {
    d = prevBusinessDay(d)
  }
  return dailyClose(stock, d, now)
}

export const DURATION_DAYS: Record<string, number> = { '1d': 1, '1w': 5, '1mo': 21, '3mo': 63, '6mo': 126, '1y': 250 }

export function dailyVolume(stock: TossStock, dayIdx: number): number {
  const shares = Number(stock.shares_outstanding) || 100_000_000
  const base = Math.max(1000, shares * (countryOf(stock.market) === 'KR' ? 0.003 : 0.004))
  return Math.round(base * (0.6 + 0.8 * noise(`${stock.symbol}:vol:${dayIdx}`)))
}

export interface CandleBar {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CandleSeriesSpec {
  key: string
  price: number
  round: (n: number) => number
  volume: (barIdx: number) => number
  dayTimestamp: (dayIdx: number) => string
  latestDay: number
  earliestDay: number
  dayOf: (ms: number) => number
}

const MINUTE_MS = 60_000
const MINUTE_HISTORY = 7 * 24 * 60

export function candlePage(
  spec: CandleSeriesSpec,
  interval: '1m' | '1d',
  count: number,
  beforeMs: number | undefined,
  now = Date.now(),
  minuteStampOf: (minuteIdx: number) => string = m => isoWithOffset(m * MINUTE_MS, 540),
): { bars: CandleBar[], nextBefore: string | null } {
  const bars: CandleBar[] = []
  if (interval === '1d') {
    let d = beforeMs === undefined ? spec.latestDay : Math.min(spec.latestDay, businessDayOnOrBefore(spec.dayOf(beforeMs)))
    while (bars.length < count && d >= spec.earliestDay) {
      const prev = prevBusinessDay(d)
      const close = spec.round(rawDailyClose(spec.key, spec.price, d, spec.latestDay))
      const open = spec.round(rawDailyClose(spec.key, spec.price, prev, spec.latestDay))
      const spread = 0.004 + 0.01 * noise(`${spec.key}:hl:${d}`)
      bars.push({
        timestamp: spec.dayTimestamp(d),
        open,
        high: spec.round(Math.max(open, close) * (1 + spread)),
        low: spec.round(Math.min(open, close) * (1 - spread)),
        close,
        volume: spec.volume(d),
      })
      d = prev
    }
    return { bars, nextBefore: d >= spec.earliestDay ? spec.dayTimestamp(d) : null }
  }
  // 1m bars are stamped with the bar's end minute; the newest is the current minute.
  const latestMinute = Math.floor(now / MINUTE_MS)
  const earliestMinute = latestMinute - MINUTE_HISTORY
  let m = beforeMs === undefined ? latestMinute : Math.min(latestMinute, Math.floor(beforeMs / MINUTE_MS))
  while (bars.length < count && m >= earliestMinute) {
    const close = spec.round(rawMinuteClose(spec.key, spec.price, m, latestMinute))
    const open = spec.round(rawMinuteClose(spec.key, spec.price, m - 1, latestMinute))
    const spread = 0.0005 + 0.001 * noise(`${spec.key}:mhl:${m}`)
    bars.push({
      timestamp: minuteStampOf(m),
      open,
      high: spec.round(Math.max(open, close) * (1 + spread)),
      low: spec.round(Math.min(open, close) * (1 - spread)),
      close,
      volume: Math.max(1, Math.round(spec.volume(m) / 390)),
    })
    m--
  }
  return { bars, nextBefore: m >= earliestMinute ? minuteStampOf(m) : null }
}

export function stockCandleSpec(stock: TossStock, now = Date.now()): CandleSeriesSpec {
  const country = countryOf(stock.market)
  const latestDay = latestTradingDay(country, now)
  const listed = stock.list_date ? Math.floor(Date.parse(`${stock.list_date}T00:00:00Z`) / DAY_MS) : latestDay - 3650
  return {
    key: stock.symbol,
    price: stock.price,
    round: n => roundToTick(stock, n),
    volume: d => dailyVolume(stock, d),
    dayTimestamp: d => dayBarTimestamp(country, d),
    latestDay,
    earliestDay: Math.max(listed, latestDay - 3650),
    dayOf: ms => localDayIdx(country, ms),
  }
}

export function priceLimits(stock: TossStock, now = Date.now()): { upper: number | null, lower: number | null } {
  if (countryOf(stock.market) === 'US') {
    return { upper: null, lower: null }
  }
  const base = previousClose(stock, now)
  const upperRaw = base * 1.3
  const lowerRaw = base * 0.7
  const upTick = tickSize(stock, upperRaw)
  const lowTick = tickSize(stock, lowerRaw)
  return { upper: Math.floor(upperRaw / upTick) * upTick, lower: Math.ceil(lowerRaw / lowTick) * lowTick }
}

export const MARKET_INDICATORS: Record<string, { base: number, asset: 'INDEX' | 'BOND', investorTrading: boolean }> = {
  KOSPI: { base: 2812.45, asset: 'INDEX', investorTrading: true },
  KOSDAQ: { base: 845.32, asset: 'INDEX', investorTrading: true },
  KR_BOND_2Y: { base: 2.98, asset: 'BOND', investorTrading: false },
  KR_BOND_3Y: { base: 3.02, asset: 'BOND', investorTrading: false },
  KR_BOND_5Y: { base: 3.11, asset: 'BOND', investorTrading: false },
  KR_BOND_10Y: { base: 3.25, asset: 'BOND', investorTrading: false },
  KR_BOND_20Y: { base: 3.31, asset: 'BOND', investorTrading: false },
  KR_BOND_30Y: { base: 3.28, asset: 'BOND', investorTrading: false },
}
export const MARKET_INDICATOR_SYMBOLS = Object.keys(MARKET_INDICATORS)

export function indicatorLevel(symbol: string, now = Date.now()): number {
  const base = MARKET_INDICATORS[symbol].base
  const minute = Math.floor(now / MINUTE_MS)
  return Math.round(rawMinuteClose(`IDX:${symbol}`, base, minute, Math.floor(minute / 1440) * 1440) * 100) / 100
}

export function indicatorCandleSpec(symbol: string, now = Date.now()): CandleSeriesSpec {
  const latestDay = latestTradingDay('KR', now)
  const isIndex = MARKET_INDICATORS[symbol].asset === 'INDEX'
  return {
    key: `IDX:${symbol}`,
    price: indicatorLevel(symbol, now),
    round: n => Math.round(n * 100) / 100,
    volume: d => (isIndex ? Math.round(450_000_000 * (0.7 + 0.6 * noise(`IDX:${symbol}:vol:${d}`))) : 0),
    // Indicator daily bars are stamped with the session open (bar start time).
    dayTimestamp: d => isoWithOffset(localMidnightMs(d, 540) + 9 * 3_600_000, 540),
    latestDay,
    earliestDay: latestDay - 3650,
    dayOf: ms => kstDayIdx(ms - 9 * 3_600_000),
  }
}

const FX_KEY = 'tossinvest.usdkrw'
export const DEFAULT_USD_KRW = 1375

export function setUsdKrwBase(store: Store, rate: number): void {
  store.setData(FX_KEY, rate)
}

export function usdKrwMid(store: Store, ms = Date.now()): number {
  const base = store.getData<number>(FX_KEY) ?? DEFAULT_USD_KRW
  const minute = Math.floor(ms / MINUTE_MS)
  const f = 1 + 0.002 * Math.sin(minute / 45) + 0.001 * (noise(`fx:${minute}`) - 0.5)
  return Math.round(base * f * 100) / 100
}

export function toKrw(store: Store, amount: number, currency: Currency): number {
  return currency === 'KRW' ? amount : amount * usdKrwMid(store)
}
