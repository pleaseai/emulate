import type { Entity } from '@emulators/core'

export type Currency = 'KRW' | 'USD'
export type MarketCountry = 'KR' | 'US'
export type StockMarket = 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' | 'AMEX' | 'KR_ETC' | 'US_ETC'
export type SecurityType
  = | 'STOCK'
    | 'FOREIGN_STOCK'
    | 'DEPOSITARY_RECEIPT'
    | 'INFRASTRUCTURE_FUND'
    | 'REIT'
    | 'ETF'
    | 'FOREIGN_ETF'
    | 'ETN'
    | 'STOCK_WARRANTS'
export type ListingStatus = 'SCHEDULED' | 'ACTIVE' | 'DELISTED'
export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'LIMIT' | 'MARKET'
export type TimeInForce = 'DAY' | 'CLS' | 'OPG'
export type OrderStatus
  = | 'PENDING'
    | 'PENDING_CANCEL'
    | 'PENDING_REPLACE'
    | 'PARTIAL_FILLED'
    | 'FILLED'
    | 'CANCELED'
    | 'REJECTED'
    | 'CANCEL_REJECTED'
    | 'REPLACE_REJECTED'
    | 'REPLACED'
export type ConditionalType = 'SINGLE' | 'OCO' | 'OTO'
export type LegStatus = 'WATCHING' | 'HOLDING' | 'PAUSED' | 'ORDERING' | 'ORDERED' | 'COMPLETED' | 'EXPIRED' | 'CANCELED'

export interface TossClient extends Entity {
  client_id: string
  client_secret: string
  name: string
}

export interface StockWarningRecord {
  warningType: string
  exchange: string | null
  startDate: string | null
  endDate: string | null
}

export interface TossStock extends Entity {
  symbol: string
  name: string
  english_name: string
  isin_code: string
  market: StockMarket
  security_type: SecurityType
  is_common_share: boolean
  status: ListingStatus
  list_date: string | null
  delist_date: string | null
  shares_outstanding: string
  leverage_factor: string | null
  nxt_supported: boolean
  price: number
  warnings: StockWarningRecord[]
}

export interface TossSector extends Entity {
  sector_id: string
  name: string
  parent_sector_id: string | null
  summary: string | null
  symbols: string[]
  etfs: string[]
}

export interface TossAccount extends Entity {
  account_seq: number
  account_no: string
  account_type: 'BROKERAGE' | 'OVERSEAS_DERIVATIVES' | 'PENSION_SAVINGS' | 'RESHORING_INVESTMENT'
  client_id: string | null
  cash_krw: number
  cash_usd: number
  commission_kr: string
  commission_us: string
}

export interface TossHolding extends Entity {
  account_seq: number
  symbol: string
  quantity: number
  average_price: number
}

export interface TossOrder extends Entity {
  order_id: string
  cancel_order_id: string | null
  account_seq: number
  client_order_id: string | null
  request_key: string | null
  symbol: string
  side: OrderSide
  order_type: OrderType
  time_in_force: TimeInForce
  status: OrderStatus
  price: string | null
  quantity: string
  order_amount: string | null
  currency: Currency
  ordered_at: string
  ordered_ms: number
  canceled_at: string | null
  filled_quantity: string
  average_filled_price: string | null
  filled_amount: string | null
  commission: string | null
  tax: string | null
  filled_at: string | null
  settlement_date: string | null
  reserved: number
}

export interface TossExecution extends Entity {
  order_id: string
  account_seq: number
  symbol: string
  side: OrderSide
  quantity: number
  price: number
  amount: number
  commission: number
  tax: number
  executed_at: string
}

export interface ConditionalLeg {
  type: 'STOP'
  status: LegStatus
  orderSide: OrderSide
  triggerPrice: string
  orderPrice: string | null
  triggeredOrderId: string | null
  direction: 'UP' | 'DOWN'
}

export interface TossConditionalOrder extends Entity {
  conditional_order_id: string
  account_seq: number
  client_order_id: string | null
  request_key: string | null
  created_ms: number
  symbol: string
  market: MarketCountry
  type: ConditionalType
  quantity: string
  order_type: OrderType
  expire_date: string
  first: ConditionalLeg
  second: ConditionalLeg | null
  created_kst: string
  replaced: boolean
}
