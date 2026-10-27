import type { RouteContext, ServicePlugin, Store } from '@emulators/core'
import type { MarketCountry, SecurityType, StockMarket, StockWarningRecord, TossAccount } from './entities.js'
import { DEMO_SEED } from './defaults.js'
import { registerMiddleware } from './helpers.js'
import { countryOf, setHolidays, setUsdKrwBase } from './market.js'
import { accountRoutes } from './routes/account.js'
import { appsRoutes, tokenRoutes } from './routes/auth.js'
import { conditionalOrderRoutes } from './routes/conditional-order.js'
import { marketDataRoutes } from './routes/market-data.js'
import { marketIndicatorRoutes } from './routes/market-indicators.js'
import { marketInfoRoutes } from './routes/market-info.js'
import { orderHistoryRoutes } from './routes/order-history.js'
import { orderInfoRoutes } from './routes/order-info.js'
import { orderRoutes } from './routes/order.js'
import { rankingRoutes } from './routes/ranking.js'
import { sectorRoutes } from './routes/sector.js'
import { stockInfoRoutes } from './routes/stock-info.js'
import { getTossinvestStore } from './store.js'

export * from './entities.js'
export { getTossinvestStore, type TossinvestStore } from './store.js'

export interface TossinvestSeedConfig {
  clients?: Array<{ client_id: string, client_secret: string, name?: string }>
  /** USD→KRW interbank rate the exchange-rate series moves around. */
  usd_krw?: number
  /** Market holidays (YYYY-MM-DD) per country; a listed country replaces the built-in 2026 set. */
  holidays?: Partial<Record<MarketCountry, string[]>>
  stocks?: Array<{
    symbol: string
    name: string
    market: StockMarket
    /** Current price in the trading currency; drives order fills. */
    price: number
    english_name?: string
    isin_code?: string
    security_type?: SecurityType
    is_common_share?: boolean
    status?: 'SCHEDULED' | 'ACTIVE' | 'DELISTED'
    list_date?: string
    shares_outstanding?: string
    leverage_factor?: string
    nxt_supported?: boolean
    warnings?: Array<Partial<StockWarningRecord> & { warningType: string }>
  }>
  sectors?: Array<{
    sector_id: string
    name: string
    parent_sector_id?: string
    summary?: string
    stocks?: string[]
    etfs?: string[]
  }>
  accounts?: Array<{
    account_seq: number
    account_no?: string
    account_type?: TossAccount['account_type']
    /** Restrict the account to one client; omitted = visible to every client. */
    client_id?: string
    cash?: { krw?: number, usd?: number }
    /** `kr_start_date` is the KR rate's `startDate` in GET /commissions (default 2026-01-01). */
    commission?: { kr?: string, us?: string, kr_start_date?: string | null }
    holdings?: Array<{ symbol: string, quantity: number, average_price: number }>
  }>
}

const DEFAULT_KR_COMMISSION_START = '2026-01-01'

function defaultIsin(symbol: string, market: StockMarket): string {
  if (countryOf(market) === 'KR') {
    return `KR7${symbol.padEnd(6, '0').slice(0, 6)}000`
  }
  return `US${symbol.padEnd(9, '0').slice(0, 9)}0`
}

export function seedFromConfig(store: Store, _baseUrl: string, config: TossinvestSeedConfig): void {
  const ts = getTossinvestStore(store)
  for (const cl of config.clients ?? []) {
    const existing = ts.clients.findOneBy('client_id', cl.client_id)
    const data = { client_id: cl.client_id, client_secret: cl.client_secret, name: cl.name ?? cl.client_id }
    if (existing) {
      ts.clients.update(existing.id, data)
    }
    else {
      ts.clients.insert(data)
    }
  }
  if (config.usd_krw !== undefined) {
    setUsdKrwBase(store, config.usd_krw)
  }
  if (config.holidays) {
    setHolidays(store, config.holidays)
  }
  for (const s of config.stocks ?? []) {
    const symbol = s.symbol.toUpperCase()
    const data = {
      symbol,
      name: s.name,
      english_name: s.english_name ?? s.name,
      isin_code: s.isin_code ?? defaultIsin(symbol, s.market),
      market: s.market,
      security_type: s.security_type ?? 'STOCK',
      is_common_share: s.is_common_share ?? true,
      status: s.status ?? 'ACTIVE',
      list_date: s.list_date ?? null,
      delist_date: null,
      shares_outstanding: s.shares_outstanding ?? '100000000',
      leverage_factor: s.leverage_factor ?? null,
      nxt_supported: s.nxt_supported ?? countryOf(s.market) === 'KR',
      price: s.price,
      warnings: (s.warnings ?? []).map(w => ({
        warningType: w.warningType,
        exchange: w.exchange ?? null,
        startDate: w.startDate ?? null,
        endDate: w.endDate ?? null,
      })),
    }
    const existing = ts.stocks.findOneBy('symbol', symbol)
    if (existing) {
      ts.stocks.update(existing.id, data)
    }
    else {
      ts.stocks.insert(data)
    }
  }
  for (const sec of config.sectors ?? []) {
    const data = {
      sector_id: sec.sector_id,
      name: sec.name,
      parent_sector_id: sec.parent_sector_id ?? null,
      summary: sec.summary ?? null,
      symbols: (sec.stocks ?? []).map(x => x.toUpperCase()),
      etfs: (sec.etfs ?? []).map(x => x.toUpperCase()),
    }
    const existing = ts.sectors.findOneBy('sector_id', sec.sector_id)
    if (existing) {
      ts.sectors.update(existing.id, data)
    }
    else {
      ts.sectors.insert(data)
    }
  }
  for (const a of config.accounts ?? []) {
    const existing = ts.accounts.findOneBy('account_seq', a.account_seq)
    // An explicit null start date survives reseeding; only a missing one takes the default.
    const krStart = a.commission?.kr_start_date !== undefined ? a.commission.kr_start_date : existing?.commission_kr_start_date
    const data = {
      account_seq: a.account_seq,
      account_no: a.account_no ?? existing?.account_no ?? String(10_000_000_000 + a.account_seq),
      account_type: a.account_type ?? existing?.account_type ?? 'BROKERAGE',
      client_id: a.client_id ?? existing?.client_id ?? null,
      cash_krw: a.cash?.krw ?? existing?.cash_krw ?? 0,
      cash_usd: a.cash?.usd ?? existing?.cash_usd ?? 0,
      commission_kr: a.commission?.kr ?? existing?.commission_kr ?? '0.00015',
      commission_us: a.commission?.us ?? existing?.commission_us ?? '0.001',
      commission_kr_start_date: krStart === undefined ? DEFAULT_KR_COMMISSION_START : krStart,
    }
    if (existing) {
      ts.accounts.update(existing.id, data)
    }
    else {
      ts.accounts.insert(data)
    }
    if (a.holdings) {
      for (const h of ts.holdings.findBy('account_seq', a.account_seq)) {
        ts.holdings.delete(h.id)
      }
      for (const h of a.holdings) {
        ts.holdings.insert({
          account_seq: a.account_seq,
          symbol: h.symbol.toUpperCase(),
          quantity: h.quantity,
          average_price: h.average_price,
        })
      }
    }
  }
}

export const tossinvestPlugin: ServicePlugin = {
  name: 'tossinvest',
  register(app, store, webhooks, baseUrl, tokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap }
    registerMiddleware(app, store)
    appsRoutes(ctx)
    tokenRoutes(ctx)
    marketDataRoutes(ctx)
    stockInfoRoutes(ctx)
    marketInfoRoutes(ctx)
    rankingRoutes(ctx)
    marketIndicatorRoutes(ctx)
    sectorRoutes(ctx)
    accountRoutes(ctx)
    orderRoutes(ctx)
    orderHistoryRoutes(ctx)
    conditionalOrderRoutes(ctx)
    orderInfoRoutes(ctx)
  },
  seed(store, baseUrl): void {
    seedFromConfig(store, baseUrl, DEMO_SEED)
  },
}

export default tossinvestPlugin
