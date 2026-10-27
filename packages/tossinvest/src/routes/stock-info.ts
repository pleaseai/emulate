import type { RouteContext } from '@emulators/core'
import type { TossStock } from '../entities.js'
import type { Ctx } from '../helpers.js'
import { boolQuery, fail, fmt, intQuery, invalid, noise, ok, SYMBOL_RE } from '../helpers.js'
import { countryOf, currencyOf, dailyClose, dailyVolume } from '../market.js'
import { getTossinvestStore } from '../store.js'
import {
  businessDayOnOrBefore,
  dateToDayIdx,
  dayIdxToDate,
  isoWithOffset,
  kstDayIdx,
  kstIso,
  kstToday,
  localMidnightMs,
  nextBusinessDay,
  prevBusinessDay,
} from '../time.js'
import { parseSymbols, resolveStock } from './market-data.js'

const MARKETS = ['KOSPI', 'KOSDAQ', 'NYSE', 'NASDAQ', 'AMEX', 'KR_ETC', 'US_ETC'] as const
const STATUSES = ['SCHEDULED', 'ACTIVE', 'DELISTED'] as const
const SECURITY_TYPES = [
  'STOCK',
  'FOREIGN_STOCK',
  'DEPOSITARY_RECEIPT',
  'INFRASTRUCTURE_FUND',
  'REIT',
  'ETF',
  'FOREIGN_ETF',
  'ETN',
  'STOCK_WARRANTS',
] as const

export function stockInfoView(s: TossStock): Record<string, unknown> {
  const kr = countryOf(s.market) === 'KR'
  return {
    symbol: s.symbol,
    name: s.name,
    englishName: s.english_name,
    isinCode: s.isin_code,
    market: s.market,
    securityType: s.security_type,
    isCommonShare: s.is_common_share,
    status: s.status,
    currency: currencyOf(s.market),
    listDate: s.list_date,
    delistDate: s.delist_date,
    sharesOutstanding: s.shares_outstanding,
    leverageFactor: s.leverage_factor,
    koreanMarketDetail: kr
      ? {
          liquidationTrading: s.warnings.some(w => w.warningType === 'LIQUIDATION_TRADING'),
          nxtSupported: s.nxt_supported,
          krxTradingSuspended: false,
          nxtTradingSuspended: s.nxt_supported ? false : null,
        }
      : null,
  }
}

export function activeWarnings(s: TossStock, today = kstToday()): TossStock['warnings'] {
  return s.warnings
    .filter(w => (w.startDate === null || w.startDate <= today) && (w.endDate === null || today <= w.endDate))
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
}

function at(dayIdx: number, h: number, m: number, s = 0): string {
  return isoWithOffset(localMidnightMs(dayIdx, 540) + ((h * 60 + m) * 60 + s) * 1000, 540)
}

type TrendBuilder = (stock: TossStock, dayIdx: number, today: number) => Record<string, unknown>

function volumeTriple(buy: number, sell: number) {
  return {
    buyVolume: String(buy),
    sellVolume: String(sell),
    netBuyVolume: String(buy - sell),
  }
}

const BREAKDOWN_KEYS = [
  'financialInvestment',
  'insurance',
  'trust',
  'privateEquityFund',
  'bank',
  'otherFinancialInstitution',
  'pensionFund',
] as const
const BREAKDOWN_WEIGHTS = [0.55, 0.03, 0.07, 0.1, 0.01, 0.01, 0.23]

const investorTrading: TrendBuilder = (stock, d, today) => {
  const base = dailyVolume(stock, d)
  const n = (k: string) => noise(`${stock.symbol}:inv:${k}:${d}`)
  const share = (k: string, w: number) => Math.round(base * w * (0.85 + 0.3 * n(k)))
  const breakdown = Object.fromEntries(
    BREAKDOWN_KEYS.map((k, i) => [k, volumeTriple(share(`${k}b`, 0.12 * BREAKDOWN_WEIGHTS[i]), share(`${k}s`, 0.12 * BREAKDOWN_WEIGHTS[i]))]),
  ) as Record<string, { buyVolume: string, sellVolume: string }>
  const instBuy = BREAKDOWN_KEYS.reduce((s, k) => s + Number(breakdown[k].buyVolume), 0)
  const instSell = BREAKDOWN_KEYS.reduce((s, k) => s + Number(breakdown[k].sellVolume), 0)
  const provisional = d === today
  const shares = Number(stock.shares_outstanding) || 1
  const holding = Math.round(shares * (0.45 + 0.1 * noise(`${stock.symbol}:fh:${d}`)))
  const cfdBuy = Math.round(shares * 0.0002 * (0.5 + n('cfdb')))
  const cfdSell = Math.round(shares * 0.0001 * (0.5 + n('cfds')))
  return {
    date: dayIdxToDate(d),
    updatedAt: provisional ? kstIso(Date.now()) : at(nextBusinessDay(d), 9, 12, 43),
    individual: provisional ? null : volumeTriple(share('ib', 0.45), share('is', 0.45)),
    foreigner: volumeTriple(share('fb', 0.25), share('fs', 0.25)),
    institution: { ...volumeTriple(instBuy, instSell), breakdown: provisional ? null : breakdown },
    otherCorporation: provisional ? null : volumeTriple(share('ob', 0.03), share('os', 0.03)),
    foreignerHolding: provisional
      ? null
      : { holdingQuantity: String(holding), limitQuantity: String(shares), holdingRate: fmt(holding / shares, 4) },
    cfd: provisional
      ? null
      : {
          buyBalanceQuantity: String(cfdBuy),
          buyBalanceRate: fmt(cfdBuy / shares, 4),
          sellBalanceQuantity: String(cfdSell),
          sellBalanceRate: fmt(cfdSell / shares, 4),
        },
  }
}

const programTrades: TrendBuilder = (stock, d) => {
  const base = dailyVolume(stock, d)
  const v = (k: string, w: number) => Math.round(base * w * (0.7 + 0.6 * noise(`${stock.symbol}:pgm:${k}:${d}`)))
  return {
    date: dayIdxToDate(d),
    arbitrage: volumeTriple(v('ab', 0.008), v('as', 0.008)),
    nonArbitrage: volumeTriple(v('nb', 0.07), v('ns', 0.07)),
  }
}

const shortSelling: TrendBuilder = (stock, d) => {
  const base = dailyVolume(stock, d)
  const volume = Math.round(base * (0.01 + 0.04 * noise(`${stock.symbol}:ss:${d}`)))
  const close = dailyClose(stock, d)
  return {
    date: dayIdxToDate(d),
    updatedAt: at(d, 17, 25, 43),
    shortSellingVolume: String(volume),
    shortSellingAmount: fmt(volume * close, 0),
    shortSellingVolumeRate: fmt(volume / base, 5),
    shortSellingAmountRate: fmt(volume / base, 4),
  }
}

function creditDetail(stock: TossStock, d: number, kind: string, scale: number) {
  const n = (k: string) => noise(`${stock.symbol}:cr:${kind}:${k}:${d}`)
  const shares = Number(stock.shares_outstanding) || 1
  const fresh = Math.round(dailyVolume(stock, d) * 0.01 * scale * (0.5 + n('n')))
  const balance = Math.round(shares * 0.0004 * scale * (0.8 + 0.4 * n('b')))
  return {
    newQuantity: String(fresh),
    returnQuantity: String(Math.round(fresh * (0.7 + 0.6 * n('r')))),
    balanceQuantity: String(balance),
    balanceRate: fmt(balance / shares, 4),
    tradingRate: fmt(fresh / dailyVolume(stock, d), 4),
  }
}

const creditTrades: TrendBuilder = (stock, d) => ({
  date: dayIdxToDate(d),
  updatedAt: at(nextBusinessDay(d), 2, 35),
  marginLoan: creditDetail(stock, d, 'margin', 1),
  stockLoan: creditDetail(stock, d, 'stock', 0.02),
})

const securitiesLending: TrendBuilder = (stock, d) => {
  const n = (k: string) => noise(`${stock.symbol}:sl:${k}:${d}`)
  const shares = Number(stock.shares_outstanding) || 1
  const balance = Math.round(shares * 0.0025 * (0.9 + 0.2 * n('b')))
  const exec = Math.round(dailyVolume(stock, d) * 0.012 * (0.6 + 0.8 * n('e')))
  return {
    date: dayIdxToDate(d),
    updatedAt: at(d, 19, 3, 21),
    executionQuantity: String(exec),
    repaymentQuantity: String(Math.round(exec * (0.7 + 0.6 * n('r')))),
    balanceQuantity: String(balance),
    balanceAmount: fmt(balance * dailyClose(stock, d), 0),
  }
}

const HISTORY_DAYS = 365

export function stockInfoRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  app.get('/api/v1/stocks', (c) => {
    const symbols = parseSymbols(c, SYMBOL_RE)
    if (symbols instanceof Response) {
      return symbols
    }
    // Unknown symbols are omitted (the endpoint documents no 404).
    const found = symbols
      .map(s => ts.stocks.findOneBy('symbol', s.toUpperCase()))
      .filter((s): s is TossStock => s !== undefined)
    return ok(c, found.map(stockInfoView))
  })

  app.get('/api/v1/stocks/all', (c) => {
    const market = c.req.query('market')
    if (!market || !(MARKETS as readonly string[]).includes(market)) {
      return invalid(
        c,
        { field: 'market', allowedValues: [...MARKETS] },
        `유효하지 않은 market 입니다. ${MARKETS.join(', ')} 만 허용됩니다.`,
      )
    }
    const status = c.req.query('status') || 'ACTIVE'
    if (!(STATUSES as readonly string[]).includes(status)) {
      return invalid(c, { field: 'status', allowedValues: [...STATUSES] })
    }
    const securityType = c.req.query('securityType')
    if (securityType && !(SECURITY_TYPES as readonly string[]).includes(securityType)) {
      return invalid(c, { field: 'securityType', allowedValues: [...SECURITY_TYPES] })
    }
    const commonShare = boolQuery(c, 'commonShare')
    if (commonShare instanceof Response) {
      return commonShare
    }
    const listed = ts.stocks
      .all()
      .filter(s => s.market === market && s.status === status)
      .filter(s => !securityType || s.security_type === securityType)
      .filter(s => commonShare === undefined || s.is_common_share === commonShare)
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map(s => ({
        symbol: s.symbol,
        name: s.name,
        securityType: s.security_type,
        isCommonShare: s.is_common_share,
        isinCode: s.isin_code,
      }))
    return ok(c, listed)
  })

  app.get('/api/v1/stocks/:symbol/warnings', (c) => {
    const stock = resolveStock(c, store, c.req.param('symbol'))
    if (stock instanceof Response) {
      return stock
    }
    return ok(c, activeWarnings(stock))
  })

  const trend = (path: string, build: TrendBuilder, lagDays: number) => {
    app.get(`/api/v1/stocks/:symbol/${path}`, (c: Ctx) => {
      const stock = resolveStock(c, store, c.req.param('symbol'))
      if (stock instanceof Response) {
        return stock
      }
      if (countryOf(stock.market) !== 'KR') {
        return fail(c, 400, 'unsupported-market', '지원하지 않는 시장의 종목입니다.', {
          field: 'symbol',
          allowedConditions: { marketCountry: ['KR'] },
        })
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
      let latest = businessDayOnOrBefore(today)
      for (let i = 0; i < lagDays; i++) {
        latest = prevBusinessDay(latest)
      }
      const earliest = latest - HISTORY_DAYS
      let d = until === undefined ? latest : Math.min(latest, businessDayOnOrBefore(until))
      const records: Record<string, unknown>[] = []
      while (records.length < count && d >= earliest) {
        records.push(build(stock, d, today))
        d = prevBusinessDay(d)
      }
      return ok(c, { nextUntil: d >= earliest ? dayIdxToDate(d) : null, records })
    })
  }
  trend('investor-trading', investorTrading, 0)
  trend('program-trades', programTrades, 0)
  trend('short-selling', shortSelling, 1)
  trend('credit-trades', creditTrades, 1)
  trend('securities-lending', securitiesLending, 1)
}
