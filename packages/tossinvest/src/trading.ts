import type { Store } from '@emulators/core'
import type {
  OrderSide,
  OrderType,
  TimeInForce,
  TossAccount,
  TossOrder,
  TossStock,
} from './entities.js'
import { floorIgnoringFloatError, fmt, round } from './helpers.js'
import { countryOf, currencyOf, formatPrice } from './market.js'
import { getTossinvestStore, newOrderId } from './store.js'
import { addBusinessDays, dayIdxToDate, kstDayIdx, kstIso } from './time.js'

export const KR_SELL_TAX_RATE = 0.0015

export const OPEN_STATUSES = new Set(['PENDING', 'PARTIAL_FILLED', 'PENDING_CANCEL', 'PENDING_REPLACE'])

export function commissionRate(account: TossAccount, stock: TossStock): number {
  return Number(countryOf(stock.market) === 'KR' ? account.commission_kr : account.commission_us)
}

const moneyDp = (stock: TossStock): number => (currencyOf(stock.market) === 'KRW' ? 0 : 2)
export const qtyDp = (stock: TossStock): number => (countryOf(stock.market) === 'KR' ? 0 : 6)

export function cashOf(account: TossAccount, stock: TossStock): number {
  return currencyOf(stock.market) === 'KRW' ? account.cash_krw : account.cash_usd
}

export function availableCash(store: Store, account: TossAccount, currency: 'KRW' | 'USD'): number {
  const ts = getTossinvestStore(store)
  const reserved = ts.orders
    .findBy('account_seq', account.account_seq)
    .filter(o => o.currency === currency && o.side === 'BUY' && OPEN_STATUSES.has(o.status))
    .reduce((sum, o) => sum + o.reserved, 0)
  const cash = currency === 'KRW' ? account.cash_krw : account.cash_usd
  return round(Math.max(0, cash - reserved), currency === 'KRW' ? 0 : 2)
}

export function holdingQuantity(store: Store, accountSeq: number, symbol: string): number {
  const h = getTossinvestStore(store).holdings.findBy('account_seq', accountSeq).find(x => x.symbol === symbol)
  return h?.quantity ?? 0
}

export function sellableQuantity(store: Store, accountSeq: number, stock: TossStock): number {
  const pending = getTossinvestStore(store)
    .orders
    .findBy('account_seq', accountSeq)
    .filter(o => o.symbol === stock.symbol && o.side === 'SELL' && OPEN_STATUSES.has(o.status))
    .reduce((sum, o) => sum + Number(o.quantity), 0)
  return round(Math.max(0, holdingQuantity(store, accountSeq, stock.symbol) - pending), qtyDp(stock))
}

export interface PlaceRequest {
  side: OrderSide
  orderType: OrderType
  timeInForce: TimeInForce
  quantity: number | null
  orderAmount: number | null
  price: number | null
  clientOrderId: string | null
  requestKey: string | null
}

export type PlaceError = 'insufficient-buying-power' | 'insufficient-sellable-quantity' | 'invalid-quantity'

function isMarketable(side: OrderSide, limit: number, price: number): boolean {
  return side === 'BUY' ? limit >= price : limit <= price
}

export function buyCost(account: TossAccount, stock: TossStock, qty: number, price: number): number {
  return round(qty * price * (1 + commissionRate(account, stock)), moneyDp(stock))
}

export function placeOrder(
  store: Store,
  account: TossAccount,
  stock: TossStock,
  req: PlaceRequest,
  extra: { replaces?: TossOrder } = {},
): { order: TossOrder } | { error: PlaceError } {
  const ts = getTossinvestStore(store)
  const currency = currencyOf(stock.market)
  const refPrice = req.orderType === 'LIMIT' && req.price !== null ? req.price : stock.price
  const qty = req.quantity ?? round((req.orderAmount ?? 0) / stock.price, 6)

  if (qty <= 0) {
    return { error: 'invalid-quantity' }
  }

  const freed = extra.replaces?.reserved ?? 0
  if (req.side === 'BUY') {
    const cost = req.orderAmount !== null
      ? round(req.orderAmount * (1 + commissionRate(account, stock)), 2)
      : buyCost(account, stock, qty, refPrice)
    if (cost > availableCash(store, account, currency) + freed) {
      return { error: 'insufficient-buying-power' }
    }
  }
  else {
    const freedQty = extra.replaces ? Number(extra.replaces.quantity) : 0
    if (qty > sellableQuantity(store, account.account_seq, stock) + freedQty + 1e-9) {
      return { error: 'insufficient-sellable-quantity' }
    }
  }

  const now = Date.now()
  const immediate = req.orderType === 'MARKET' || isMarketable(req.side, refPrice, stock.price)
  const order = ts.orders.insert({
    order_id: newOrderId(),
    cancel_order_id: null,
    account_seq: account.account_seq,
    client_order_id: req.clientOrderId,
    request_key: req.requestKey,
    symbol: stock.symbol,
    side: req.side,
    order_type: req.orderType,
    time_in_force: req.timeInForce,
    status: 'PENDING',
    price: req.orderType === 'LIMIT' && req.price !== null ? formatPrice(stock, req.price) : null,
    quantity: fmt(qty, qtyDp(stock)),
    order_amount: req.orderAmount !== null ? fmt(req.orderAmount, 2) : null,
    currency,
    ordered_at: kstIso(now),
    ordered_ms: now,
    canceled_at: null,
    filled_quantity: '0',
    average_filled_price: null,
    filled_amount: null,
    commission: null,
    tax: null,
    filled_at: null,
    settlement_date: null,
    reserved: req.side === 'BUY' && !immediate ? buyCost(account, stock, qty, refPrice) : 0,
  })
  if (immediate) {
    fillOrder(store, order, stock, stock.price)
  }
  return { order: ts.orders.get(order.id)! }
}

export function fillOrder(store: Store, order: TossOrder, stock: TossStock, price: number): void {
  const ts = getTossinvestStore(store)
  const account = ts.accounts.findOneBy('account_seq', order.account_seq)
  if (!account) {
    return
  }
  const dp = moneyDp(stock)
  const qty = Number(order.quantity)
  const gross = round(qty * price, dp)
  const rate = commissionRate(account, stock)
  const commission = dp === 0 ? floorIgnoringFloatError(gross * rate) : round(gross * rate, 2)
  const tax = order.side === 'SELL' && countryOf(stock.market) === 'KR' ? floorIgnoringFloatError(gross * KR_SELL_TAX_RATE) : 0
  const cashDelta = order.side === 'BUY' ? -(gross + commission) : gross - commission - tax
  ts.accounts.update(
    account.id,
    currencyOf(stock.market) === 'KRW'
      ? { cash_krw: round(account.cash_krw + cashDelta, dp) }
      : { cash_usd: round(account.cash_usd + cashDelta, dp) },
  )

  const holding = ts.holdings.findBy('account_seq', order.account_seq).find(h => h.symbol === order.symbol)
  if (order.side === 'BUY') {
    if (holding) {
      const total = holding.quantity + qty
      ts.holdings.update(holding.id, {
        quantity: round(total, 6),
        average_price: round((holding.quantity * holding.average_price + qty * price) / total, 4),
      })
    }
    else {
      ts.holdings.insert({ account_seq: order.account_seq, symbol: order.symbol, quantity: qty, average_price: price })
    }
  }
  else if (holding) {
    const left = round(holding.quantity - qty, 6)
    if (left <= 0) {
      ts.holdings.delete(holding.id)
    }
    else {
      ts.holdings.update(holding.id, { quantity: left })
    }
  }

  const now = Date.now()
  const settleDays = countryOf(stock.market) === 'KR' ? 2 : 1
  ts.executions.insert({
    order_id: order.order_id,
    account_seq: order.account_seq,
    symbol: order.symbol,
    side: order.side,
    quantity: qty,
    price,
    amount: gross,
    commission,
    tax,
    executed_at: kstIso(now),
  })
  ts.orders.update(order.id, {
    status: 'FILLED',
    reserved: 0,
    filled_quantity: order.quantity,
    average_filled_price: formatPrice(stock, price),
    filled_amount: fmt(gross, dp),
    commission: fmt(commission, dp),
    tax: fmt(tax, dp),
    filled_at: kstIso(now),
    settlement_date: dayIdxToDate(addBusinessDays(kstDayIdx(now), settleDays)),
  })
}

export function matchRestingOrders(store: Store, stock: TossStock): void {
  const ts = getTossinvestStore(store)
  for (const order of ts.orders.all()) {
    if (order.symbol !== stock.symbol || !OPEN_STATUSES.has(order.status) || order.price === null) {
      continue
    }
    if (isMarketable(order.side, Number(order.price), stock.price)) {
      fillOrder(store, order, stock, Number(order.price))
    }
  }
}

export function orderView(o: TossOrder): Record<string, unknown> {
  return {
    orderId: o.order_id,
    symbol: o.symbol,
    side: o.side,
    orderType: o.order_type,
    timeInForce: o.time_in_force,
    status: o.status,
    price: o.price,
    quantity: o.quantity,
    orderAmount: o.order_amount,
    currency: o.currency,
    orderedAt: o.ordered_at,
    canceledAt: o.canceled_at,
    execution: {
      filledQuantity: o.filled_quantity,
      averageFilledPrice: o.average_filled_price,
      filledAmount: o.filled_amount,
      commission: o.commission,
      tax: o.tax,
      filledAt: o.filled_at,
      settlementDate: o.settlement_date,
    },
  }
}

export function findOrder(store: Store, accountSeq: number, orderId: string): TossOrder | undefined {
  const ts = getTossinvestStore(store)
  const order = ts.orders.findOneBy('order_id', orderId) ?? ts.orders.findOneBy('cancel_order_id', orderId)
  return order && order.account_seq === accountSeq ? order : undefined
}
