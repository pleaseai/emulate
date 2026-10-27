import type { Store } from '@emulators/core'
import type { ConditionalLeg, LegStatus, TossConditionalOrder, TossStock } from './entities.js'
import { getTossinvestStore, newOrderId } from './store.js'
import { kstIso, kstToday } from './time.js'
import { OPEN_STATUSES, placeOrder } from './trading.js'

export type GroupStatus = 'WATCHING' | 'PAUSED' | 'ORDERING' | 'ORDERED' | 'COMPLETED' | 'EXPIRED'

export function groupStatus(co: TossConditionalOrder): GroupStatus {
  const legs = [co.first, co.second].filter((l): l is ConditionalLeg => l !== null)
  const has = (s: LegStatus) => legs.some(l => l.status === s)
  if (has('ORDERED')) {
    return 'ORDERED'
  }
  if (has('ORDERING')) {
    return 'ORDERING'
  }
  if (has('WATCHING') || has('HOLDING')) {
    return 'WATCHING'
  }
  if (has('PAUSED')) {
    return 'PAUSED'
  }
  return has('EXPIRED') ? 'EXPIRED' : 'COMPLETED'
}

export function isOpenGroup(co: TossConditionalOrder): boolean {
  return ['WATCHING', 'PAUSED', 'ORDERING', 'ORDERED'].includes(groupStatus(co))
}

export function legView(l: ConditionalLeg): Record<string, unknown> {
  return {
    type: l.type,
    status: l.status,
    orderSide: l.orderSide,
    triggerPrice: l.triggerPrice,
    targetProfitRate: null,
    orderPrice: l.orderPrice,
    triggeredOrderId: l.triggeredOrderId,
  }
}

export function conditionalView(co: TossConditionalOrder): Record<string, unknown> {
  return {
    conditionalOrderId: co.conditional_order_id,
    type: co.type,
    status: groupStatus(co),
    symbol: co.symbol,
    market: co.market,
    quantity: co.quantity,
    orderType: co.order_type,
    expireDate: co.expire_date,
    first: legView(co.first),
    second: co.second ? legView(co.second) : null,
    createdAt: co.created_kst,
  }
}

function reached(leg: ConditionalLeg, price: number): boolean {
  return leg.direction === 'UP' ? price >= Number(leg.triggerPrice) : price <= Number(leg.triggerPrice)
}

export const directionFor = (trigger: number, price: number): 'UP' | 'DOWN' => (trigger >= price ? 'UP' : 'DOWN')

function fire(store: Store, co: TossConditionalOrder, leg: ConditionalLeg, stock: TossStock): void {
  const ts = getTossinvestStore(store)
  const account = ts.accounts.findOneBy('account_seq', co.account_seq)
  if (!account) {
    leg.status = 'COMPLETED'
    return
  }
  const res = placeOrder(store, account, stock, {
    side: leg.orderSide,
    orderType: co.order_type,
    timeInForce: 'DAY',
    quantity: Number(co.quantity),
    orderAmount: null,
    price: leg.orderPrice === null ? null : Number(leg.orderPrice),
    clientOrderId: null,
    requestKey: null,
  })
  if ('order' in res) {
    leg.triggeredOrderId = res.order.order_id
    leg.status = 'ORDERED'
    return
  }
  const now = Date.now()
  const rejected = ts.orders.insert({
    order_id: newOrderId(),
    cancel_order_id: null,
    account_seq: co.account_seq,
    client_order_id: null,
    request_key: null,
    symbol: stock.symbol,
    side: leg.orderSide,
    order_type: co.order_type,
    time_in_force: 'DAY',
    status: 'REJECTED',
    price: leg.orderPrice,
    quantity: co.quantity,
    order_amount: null,
    currency: co.market === 'KR' ? 'KRW' : 'USD',
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
    reserved: 0,
  })
  leg.triggeredOrderId = rejected.order_id
  leg.status = 'ORDERED'
}

function syncLegs(store: Store, co: TossConditionalOrder, first: ConditionalLeg, second: ConditionalLeg | null, stock: TossStock): void {
  const ts = getTossinvestStore(store)
  for (const leg of [first, second]) {
    if (leg?.status !== 'ORDERED' || !leg.triggeredOrderId) {
      continue
    }
    const order = ts.orders.findOneBy('order_id', leg.triggeredOrderId)
    if (!order || OPEN_STATUSES.has(order.status)) {
      continue
    }
    leg.status = 'COMPLETED'
    if (co.type === 'OTO' && leg === first && second?.status === 'HOLDING') {
      if (order.status === 'FILLED') {
        second.status = 'WATCHING'
        second.direction = directionFor(Number(second.triggerPrice), stock.price)
      }
      else {
        second.status = 'CANCELED'
      }
    }
  }
}

export function evaluateConditionalOrders(store: Store, stock: TossStock): void {
  const ts = getTossinvestStore(store)
  const today = kstToday()
  for (const co of ts.conditionalOrders.all()) {
    if (co.symbol !== stock.symbol || co.replaced || !isOpenGroup(co)) {
      continue
    }
    const first = { ...co.first }
    const second = co.second ? { ...co.second } : null
    syncLegs(store, co, first, second, stock)

    if (co.expire_date < today) {
      for (const leg of [first, second]) {
        if (leg && ['WATCHING', 'HOLDING', 'PAUSED'].includes(leg.status)) {
          leg.status = 'EXPIRED'
        }
      }
    }
    else {
      for (let pass = 0; pass < 2; pass++) {
        const leg = [first, second].find(l => l?.status === 'WATCHING' && reached(l, stock.price))
        if (!leg) {
          break
        }
        fire(store, co, leg, stock)
        if (co.type === 'OCO') {
          const sibling = leg === first ? second : first
          if (sibling?.status === 'WATCHING') {
            sibling.status = 'CANCELED'
          }
        }
        syncLegs(store, co, first, second, stock)
      }
    }
    ts.conditionalOrders.update(co.id, { first, second })
  }
}

export function refreshConditionalOrders(store: Store): void {
  const ts = getTossinvestStore(store)
  const symbols = new Set(ts.conditionalOrders.all().filter(co => !co.replaced && isOpenGroup(co)).map(co => co.symbol))
  for (const symbol of symbols) {
    const stock = ts.stocks.findOneBy('symbol', symbol)
    if (stock) {
      evaluateConditionalOrders(store, stock)
    }
  }
}
