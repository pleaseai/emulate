import type { RouteContext, Store } from '@emulators/core'
import type { MarketCountry, TossSector, TossStock } from '../entities.js'
import type { Ctx } from '../helpers.js'
import { enumQuery, fail, fmt, invalid, MSG_INVALID_FIELD, ok } from '../helpers.js'
import { countryOf, currencyOf, dailyVolume, DURATION_DAYS, latestTradingDay, toKrw } from '../market.js'
import { getTossinvestStore } from '../store.js'
import { changeOver, volumeOver } from './ranking.js'

const COUNTRIES = ['KR', 'US'] as const
const DURATIONS = ['1d', '1w', '1mo', '3mo', '6mo', '1y'] as const
const SECTOR_ID_PATTERN = '^[A-Za-z0-9_-]{1,40}$'
const SECTOR_ID_RE = /^[\w-]{1,40}$/

function isEquity(s: TossStock): boolean {
  return s.security_type !== 'ETF' && s.security_type !== 'FOREIGN_ETF' && s.security_type !== 'ETN'
}

export function sectorDepth(store: Store, sector: TossSector): number {
  const sectors = getTossinvestStore(store).sectors
  let depth = 0
  let parent = sector.parent_sector_id
  while (parent !== null && depth < 10) {
    depth++
    parent = sectors.findOneBy('sector_id', parent)?.parent_sector_id ?? null
  }
  return depth
}

function sectorSymbolsDeep(store: Store, sector: TossSector): Set<string> {
  const sectors = getTossinvestStore(store).sectors.all()
  const out = new Set<string>(sector.symbols)
  const queue = [sector.sector_id]
  while (queue.length) {
    const id = queue.shift()!
    for (const child of sectors.filter(s => s.parent_sector_id === id)) {
      child.symbols.forEach(sym => out.add(sym))
      queue.push(child.sector_id)
    }
  }
  return out
}

function memberStocks(store: Store, symbols: Iterable<string>, country: MarketCountry): TossStock[] {
  const stocks = getTossinvestStore(store).stocks
  return [...symbols]
    .map(sym => stocks.findOneBy('symbol', sym))
    .filter((s): s is TossStock => !!s && s.status !== 'DELISTED' && isEquity(s) && countryOf(s.market) === country)
}

function marketCapKrw(store: Store, s: TossStock): number {
  return toKrw(store, (Number(s.shares_outstanding) || 0) * s.price, currencyOf(s.market))
}

function avgChange(stocks: TossStock[], days: number): number | null {
  return stocks.length ? stocks.reduce((sum, s) => sum + (changeOver(s, days).rate ?? 0), 0) / stocks.length : null
}

export function sectorRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  const sortedSectors = () =>
    ts.sectors
      .all()
      .map(s => ({ s, depth: sectorDepth(store, s) }))
      .sort((a, b) => a.depth - b.depth || Number(a.s.sector_id) - Number(b.s.sector_id) || a.s.sector_id.localeCompare(b.s.sector_id))

  app.get('/api/v1/sectors', c =>
    ok(c, {
      sectors: sortedSectors().map(({ s, depth }) => ({ sectorId: s.sector_id, name: s.name, depth, parentSectorId: s.parent_sector_id })),
    }))

  app.get('/api/v1/sectors/rankings', (c) => {
    const type = enumQuery(c, 'type', ['TOP_GAINERS', 'MARKET_TRADING_AMOUNT'] as const)
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
    const days = DURATION_DAYS[duration]
    const rows = sortedSectors()
      .filter(({ depth }) => depth <= 1)
      .map(({ s }) => {
        const members = memberStocks(store, sectorSymbolsDeep(store, s), country)
        const direct = memberStocks(store, s.symbols, country)
        const amount = members.reduce((sum, m) => sum + toKrw(store, volumeOver(m, days) * m.price, currencyOf(m.market)), 0)
        return {
          s,
          members,
          changeRate: avgChange(members, days) ?? 0,
          tradingAmount: members.length ? amount : null,
          marketCapitalization: direct.length ? direct.reduce((sum, m) => sum + marketCapKrw(store, m), 0) : null,
        }
      })
      .filter(r => r.members.length > 0)
    rows.sort((a, b) =>
      type === 'TOP_GAINERS' ? b.changeRate - a.changeRate : (b.tradingAmount ?? -1) - (a.tradingAmount ?? -1))
    return ok(c, {
      rankings: rows.slice(0, 100).map((r, i) => ({
        rank: i + 1,
        sectorId: r.s.sector_id,
        name: r.s.name,
        changeRate: fmt(r.changeRate, 4),
        tradingAmount: r.tradingAmount === null ? null : fmt(r.tradingAmount, 0),
        marketCapitalization: r.marketCapitalization === null ? null : fmt(r.marketCapitalization, 0),
        currency: 'KRW',
      })),
    })
  })

  const resolve = (c: Ctx): { sector: TossSector, country: MarketCountry } | Response => {
    const sectorId = c.req.param('sectorId')
    if (!SECTOR_ID_RE.test(sectorId)) {
      return invalid(c, { field: 'sectorId', rule: 'Pattern', pattern: SECTOR_ID_PATTERN }, MSG_INVALID_FIELD)
    }
    const country = enumQuery(c, 'marketCountry', COUNTRIES)
    if (country instanceof Response) {
      return country
    }
    const sector = ts.sectors.findOneBy('sector_id', sectorId)
    if (!sector) {
      return fail(c, 404, 'sector-not-found', '섹터를 찾을 수 없습니다.')
    }
    return { sector, country }
  }

  app.get('/api/v1/sectors/:sectorId', (c) => {
    const r = resolve(c)
    if (r instanceof Response) {
      return r
    }
    const members = memberStocks(store, sectorSymbolsDeep(store, r.sector), r.country)
    return ok(c, {
      sectorId: r.sector.sector_id,
      name: r.sector.name,
      depth: sectorDepth(store, r.sector),
      parentSectorId: r.sector.parent_sector_id,
      summary: r.sector.summary,
      performance: {
        changeRates: DURATIONS.map((duration) => {
          const rate = avgChange(members, DURATION_DAYS[duration])
          return { duration, changeRate: rate === null ? null : fmt(rate, 4) }
        }),
      },
    })
  })

  app.get('/api/v1/sectors/:sectorId/stocks', (c) => {
    const r = resolve(c)
    if (r instanceof Response) {
      return r
    }
    const latest = latestTradingDay(r.country)
    const stocks = memberStocks(store, sectorSymbolsDeep(store, r.sector), r.country)
      .filter(s => s.is_common_share)
      .map(s => ({ s, cap: marketCapKrw(store, s) }))
      .sort((a, b) => b.cap - a.cap)
      .map(({ s, cap }) => {
        const volume = dailyVolume(s, latest)
        return {
          symbol: s.symbol,
          name: s.name,
          volume: String(volume),
          tradingAmount: fmt(toKrw(store, volume * s.price, currencyOf(s.market)), 0),
          marketCapitalization: fmt(cap, 0),
          currency: 'KRW',
        }
      })
    return ok(c, { stocks })
  })

  app.get('/api/v1/sectors/:sectorId/etfs', (c) => {
    const r = resolve(c)
    if (r instanceof Response) {
      return r
    }
    const etfs = r.sector.etfs
      .map(sym => ts.stocks.findOneBy('symbol', sym))
      .filter((s): s is TossStock => !!s && s.status !== 'DELISTED' && countryOf(s.market) === r.country)
      .map(s => ({ symbol: s.symbol, name: s.name }))
    return ok(c, { etfs })
  })
}
