import type { RouteContext, Store } from '@emulators/core'
import type {
  ConditionalLeg,
  ConditionalType,
  OrderType,
  TossAccount,
  TossConditionalOrder,
  TossStock,
} from '../entities.js'
import type { Ctx } from '../helpers.js'
import type { Body } from './order.js'
import {
  conditionalView,
  directionFor,
  evaluateConditionalOrders,
  groupStatus,
  isOpenGroup,
  refreshConditionalOrders,
} from '../conditional.js'
import { decodeCursor, encodeCursor, fail, intQuery, invalid, MSG_INVALID_FIELD, ok, requireAccount, stockNotFound } from '../helpers.js'
import { countryOf, formatPrice } from '../market.js'
import { getTossinvestStore, newConditionalOrderId } from '../store.js'
import { dateToDayIdx, kstDayIdx, kstIso } from '../time.js'
import { checkOrderValue, checkPrice, readJson } from './order.js'

const TYPES: readonly ConditionalType[] = ['SINGLE', 'OCO', 'OTO']
const ID_RE = /^[\w-]{1,64}$/
const DECIMAL_RE = /^\d+(?:\.\d+)?$/

interface ParsedConditional {
  type: ConditionalType
  quantity: string
  orderType: OrderType
  expireDate: string
  first: ConditionalLeg
  second: ConditionalLeg | null
}

function parseLeg(c: Ctx, stock: TossStock, raw: unknown, name: 'first' | 'second', orderType: OrderType): ConditionalLeg | Response {
  if (raw === null || typeof raw !== 'object') {
    return invalid(c, { field: name }, MSG_INVALID_FIELD)
  }
  const leg = raw as Record<string, unknown>
  if (leg.orderSide !== 'BUY' && leg.orderSide !== 'SELL') {
    return invalid(c, { field: `${name}.orderSide` }, '매매 유형이 올바르지 않습니다. (BUY 또는 SELL)')
  }
  const trigger = typeof leg.triggerPrice === 'string' ? leg.triggerPrice : String(leg.triggerPrice ?? '')
  if (!DECIMAL_RE.test(trigger) || Number(trigger) <= 0) {
    return invalid(c, { field: `${name}.triggerPrice`, format: 'decimal' }, '감시 가격이 유효한 숫자가 아닙니다.')
  }
  let orderPrice: string | null = null
  if (orderType === 'LIMIT') {
    if (leg.orderPrice === undefined || leg.orderPrice === null) {
      return invalid(c, { field: `${name}.orderPrice` }, MSG_INVALID_FIELD)
    }
    const checked = checkPrice(c, stock, String(leg.orderPrice), `${name}.orderPrice`)
    if (checked instanceof Response) {
      return checked
    }
    orderPrice = formatPrice(stock, checked)
  }
  else if (leg.orderPrice !== undefined && leg.orderPrice !== null) {
    return invalid(c, { field: `${name}.orderPrice` }, MSG_INVALID_FIELD)
  }
  return {
    type: 'STOP',
    status: 'WATCHING',
    orderSide: leg.orderSide,
    triggerPrice: formatPrice(stock, Number(trigger)),
    orderPrice,
    triggeredOrderId: null,
    direction: directionFor(Number(trigger), stock.price),
  }
}

function parseConditional(c: Ctx, store: Store, stock: TossStock, body: Body): ParsedConditional | Response {
  const type = body.type as ConditionalType
  if (!TYPES.includes(type)) {
    return invalid(c, { field: 'type', allowedValues: [...TYPES] })
  }
  const quantity = typeof body.quantity === 'string' ? body.quantity : String(body.quantity ?? '')
  const kr = countryOf(stock.market) === 'KR'
  if (!DECIMAL_RE.test(quantity) || Number(quantity) <= 0 || (kr && !Number.isInteger(Number(quantity)))) {
    return invalid(c, { field: 'quantity', format: 'decimal', constraint: { min: 1, integerOnly: kr } })
  }
  const orderType = body.orderType as OrderType
  if (orderType !== 'LIMIT' && orderType !== 'MARKET') {
    return invalid(c, { field: 'orderType', allowedValues: ['LIMIT', 'MARKET'] })
  }
  if (type !== 'SINGLE' && orderType !== 'LIMIT') {
    return invalid(c, { field: 'orderType', allowedConditions: { type: 'SINGLE' } })
  }
  const expireDate = typeof body.expireDate === 'string' ? body.expireDate : ''
  const expireDay = dateToDayIdx(expireDate)
  const today = kstDayIdx(Date.now())
  if (expireDay === undefined || expireDay < today || expireDay > today + 365) {
    return invalid(c, { field: 'expireDate', format: 'date' }, MSG_INVALID_FIELD)
  }
  const first = parseLeg(c, stock, body.first, 'first', orderType)
  if (first instanceof Response) {
    return first
  }
  let second: ConditionalLeg | null = null
  if (type === 'SINGLE') {
    if (body.second !== undefined && body.second !== null) {
      return invalid(c, { field: 'second' }, MSG_INVALID_FIELD)
    }
  }
  else {
    const parsed = parseLeg(c, stock, body.second, 'second', orderType)
    if (parsed instanceof Response) {
      return parsed
    }
    second = parsed
  }
  if (type === 'OCO') {
    if (first.orderSide !== 'SELL' || second!.orderSide !== 'SELL') {
      return invalid(c, { field: 'first.orderSide,second.orderSide', allowedValues: ['SELL'] })
    }
    if (!(Number(first.triggerPrice) > stock.price && stock.price > Number(second!.triggerPrice))) {
      return invalid(c, { field: 'first.triggerPrice,second.triggerPrice' })
    }
  }
  if (type === 'OTO') {
    if (first.orderSide !== 'BUY' || second!.orderSide !== 'SELL') {
      return invalid(c, { field: 'first.orderSide,second.orderSide' })
    }
    second!.status = 'HOLDING'
  }
  const notional = Number(quantity) * Math.max(...[first, second].filter(l => l !== null).map(l => Number(l!.orderPrice ?? l!.triggerPrice)))
  const valueError = checkOrderValue(c, store, stock, notional, body.confirmHighValueOrder === true)
  if (valueError) {
    return valueError
  }
  return { type, quantity, orderType, expireDate, first, second }
}

export function conditionalOrderRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  const notFound = (c: Ctx) => fail(c, 404, 'conditional-order-not-found', '조건주문을 찾을 수 없습니다.')
  const lookup = (c: Ctx, account: TossAccount): TossConditionalOrder | Response => {
    const id = c.req.param('conditionalOrderId')
    if (!ID_RE.test(id)) {
      return invalid(c, { field: 'conditionalOrderId', pattern: '^[A-Za-z0-9_-]+$' }, MSG_INVALID_FIELD)
    }
    refreshConditionalOrders(store)
    const co = ts.conditionalOrders.findOneBy('conditional_order_id', id)
    return co && !co.replaced && co.account_seq === account.account_seq ? co : notFound(c)
  }
  const insert = (account: TossAccount, stock: TossStock, p: ParsedConditional, clientOrderId: string | null) => {
    const co = ts.conditionalOrders.insert({
      conditional_order_id: newConditionalOrderId(),
      account_seq: account.account_seq,
      client_order_id: clientOrderId,
      symbol: stock.symbol,
      market: countryOf(stock.market),
      type: p.type,
      quantity: p.quantity,
      order_type: p.orderType,
      expire_date: p.expireDate,
      first: p.first,
      second: p.second,
      created_kst: kstIso(Date.now()),
      replaced: false,
    })
    evaluateConditionalOrders(store, stock)
    return co
  }

  app.post('/api/v1/conditional-orders', async (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const body = await readJson(c)
    if (body instanceof Response) {
      return body
    }
    if (typeof body.symbol !== 'string' || !body.symbol) {
      return invalid(c, { field: 'symbol' }, MSG_INVALID_FIELD)
    }
    const stock = ts.stocks.findOneBy('symbol', body.symbol.toUpperCase())
    if (!stock) {
      return stockNotFound(c)
    }
    const clientOrderId = typeof body.clientOrderId === 'string' ? body.clientOrderId : null
    if (clientOrderId !== null && !/^[\w-]{1,36}$/.test(clientOrderId)) {
      return invalid(c, { field: 'clientOrderId', maxLength: 36, pattern: '^[a-zA-Z0-9\\-_]+$' })
    }
    if (clientOrderId !== null) {
      const prior = ts.conditionalOrders
        .findBy('account_seq', account.account_seq)
        .find(co => co.client_order_id === clientOrderId && !co.replaced)
      if (prior) {
        return ok(c, { conditionalOrderId: prior.conditional_order_id, clientOrderId })
      }
    }
    const parsed = parseConditional(c, store, stock, body)
    if (parsed instanceof Response) {
      return parsed
    }
    const co = insert(account, stock, parsed, clientOrderId)
    return ok(c, { conditionalOrderId: co.conditional_order_id, clientOrderId })
  })

  app.get('/api/v1/conditional-orders', (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const status = c.req.query('status')
    if (status !== 'OPEN' && status !== 'CLOSED') {
      return invalid(
        c,
        { field: 'status', allowedValues: ['OPEN', 'CLOSED'] },
        '유효하지 않은 주문 상태 필터입니다. OPEN 또는 CLOSED 만 허용됩니다.',
      )
    }
    const symbol = c.req.query('symbol')?.toUpperCase()
    const limit = intQuery(c, 'limit', 20, 1, 100)
    if (limit instanceof Response) {
      return limit
    }
    const cursorRaw = c.req.query('cursor')
    const after = cursorRaw ? decodeCursor(cursorRaw) : undefined
    if (cursorRaw && after === undefined) {
      return invalid(c, { field: 'cursor' })
    }
    refreshConditionalOrders(store)
    const page = ts.conditionalOrders
      .findBy('account_seq', account.account_seq)
      .filter(co => !co.replaced && (status === 'OPEN') === isOpenGroup(co))
      .filter(co => !symbol || co.symbol === symbol)
      .filter(co => after === undefined || co.id < after)
      .sort((a, b) => b.id - a.id)
    const items = page.slice(0, limit)
    const hasNext = page.length > limit
    return ok(c, {
      conditionalOrders: items.map(conditionalView),
      nextCursor: hasNext ? encodeCursor(items[items.length - 1].id) : null,
      hasNext,
    })
  })

  app.get('/api/v1/conditional-orders/:conditionalOrderId', (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const co = lookup(c, account)
    return co instanceof Response ? co : ok(c, conditionalView(co))
  })

  app.delete('/api/v1/conditional-orders/:conditionalOrderId', (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const co = lookup(c, account)
    if (co instanceof Response) {
      return co
    }
    const cancel = (leg: ConditionalLeg | null) =>
      leg && ['WATCHING', 'HOLDING', 'PAUSED'].includes(leg.status) ? { ...leg, status: 'CANCELED' as const } : leg
    ts.conditionalOrders.update(co.id, { first: cancel(co.first)!, second: cancel(co.second) })
    return c.body(null, 204)
  })

  app.post('/api/v1/conditional-orders/:conditionalOrderId/modify', async (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const body = await readJson(c)
    if (body instanceof Response) {
      return body
    }
    const co = lookup(c, account)
    if (co instanceof Response) {
      return co
    }
    const status = groupStatus(co)
    if (status !== 'WATCHING' && status !== 'PAUSED') {
      return fail(c, 422, 'modify-restricted', '해당 주문은 정정할 수 없습니다.')
    }
    const stock = ts.stocks.findOneBy('symbol', co.symbol)!
    const parsed = parseConditional(c, store, stock, body)
    if (parsed instanceof Response) {
      return parsed
    }
    ts.conditionalOrders.update(co.id, { replaced: true })
    const next = insert(account, stock, parsed, co.client_order_id)
    return ok(c, { conditionalOrderId: next.conditional_order_id })
  })
}
