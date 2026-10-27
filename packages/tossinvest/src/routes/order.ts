import type { RouteContext, Store } from '@emulators/core'
import type { ConditionalLeg, OrderSide, OrderType, TimeInForce, TossOrder, TossStock } from '../entities.js'
import type { Ctx } from '../helpers.js'
import type { PlaceError } from '../trading.js'
import { fail, fmt, invalid, MSG_INVALID, MSG_INVALID_FIELD, ok, requireAccount, round } from '../helpers.js'
import { countryOf, currencyOf, priceLimits, tickSize, toKrw } from '../market.js'
import { getTossinvestStore, newOrderId } from '../store.js'
import { kstIso } from '../time.js'
import { findOrder, OPEN_STATUSES, placeOrder } from '../trading.js'

const DECIMAL_RE = /^\d+(?:\.\d+)?$/
const CLIENT_ORDER_ID_RE = /^[\w-]{1,36}$/
const HIGH_VALUE_KRW = 100_000_000
const MAX_ORDER_KRW = 3_000_000_000
export const IDEMPOTENCY_WINDOW_MS = 10 * 60_000

export type Body = Record<string, unknown>

export async function readJson(c: Ctx): Promise<Body | Response> {
  const body = await c.req.json().catch(() => undefined)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalid(c)
  }
  return body as Body
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)

export function placeError(c: Ctx, err: PlaceError): Response {
  if (err === 'invalid-quantity') {
    return invalid(c, { field: 'orderAmount' }, MSG_INVALID)
  }
  return err === 'insufficient-buying-power'
    ? fail(c, 422, 'insufficient-buying-power', '주문 가능 금액이 부족합니다.')
    : fail(c, 422, 'insufficient-sellable-quantity', '매도 가능 수량이 부족합니다.')
}

/**
 * Validates a limit price against the instrument's grid. KR prices must be
 * whole won on the KRX tick ladder; US prices are truncated to 2 (or 4, under
 * $1) decimals, as documented.
 */
export function checkPrice(c: Ctx, stock: TossStock, raw: string, field = 'price', strict = false): number | Response {
  const badPrice = () => invalid(c, { field, format: 'decimal', pattern: '^\\d+(\\.\\d+)?$' })
  if (!DECIMAL_RE.test(raw) || Number(raw) <= 0) {
    return badPrice()
  }
  const value = Number(raw)
  if (countryOf(stock.market) === 'US') {
    const dp = value < 1 ? 4 : 2
    const truncated = Math.trunc(round(value * 10 ** dp, 6)) / 10 ** dp
    if (truncated <= 0) {
      return badPrice()
    }
    if (strict && truncated !== round(value, 6)) {
      return invalid(c, { field, tickSize: String(10 ** -dp) }, '주문 가격이 호가 단위에 맞지 않습니다.')
    }
    return truncated
  }
  const tick = tickSize(stock, value)
  if (!Number.isInteger(value) || value % tick !== 0) {
    const lower = Math.floor(value / tick) * tick
    return invalid(
      c,
      { field, tickSize: String(tick), nearestPrices: [fmt(lower, 0), fmt(lower + tick, 0)] },
      '주문 가격이 호가 단위에 맞지 않습니다.',
    )
  }
  return value
}

export function checkOrderValue(c: Ctx, store: Store, stock: TossStock, notional: number, confirmed: boolean): Response | undefined {
  const krw = toKrw(store, notional, currencyOf(stock.market))
  if (krw >= MAX_ORDER_KRW) {
    return fail(c, 422, 'max-order-amount-exceeded', '최대 주문가능금액을 초과하였습니다.', {
      limits: { maxAmount: String(MAX_ORDER_KRW), currency: 'KRW' },
    })
  }
  if (krw >= HIGH_VALUE_KRW && !confirmed) {
    return fail(c, 400, 'confirm-high-value-required', '1억원 이상 주문은 확인이 필요합니다.', {
      field: 'confirmHighValueOrder',
      limits: { threshold: String(HIGH_VALUE_KRW), currency: 'KRW' },
    })
  }
  return undefined
}

/** KR daily price band (previous close ±30%); US stocks have no band. */
function checkPriceLimits(c: Ctx, stock: TossStock, price: number | null): Response | undefined {
  if (price === null) {
    return undefined
  }
  const { upper, lower } = priceLimits(stock)
  if ((upper !== null && price > upper) || (lower !== null && price < lower)) {
    return fail(c, 422, 'price-out-of-range', '주문 가격이 허용 범위를 벗어났습니다.')
  }
  return undefined
}

export function finalStateError(c: Ctx, order: TossOrder): Response | undefined {
  switch (order.status) {
    case 'FILLED':
      return fail(c, 409, 'already-filled', '이미 체결된 주문입니다.')
    case 'CANCELED':
      return fail(c, 409, 'already-canceled', '이미 취소된 주문입니다.')
    case 'REPLACED':
      return fail(c, 409, 'already-modified', '이미 정정된 주문입니다.')
    case 'REJECTED':
      return fail(c, 409, 'already-rejected', '거부된 주문은 정정/취소할 수 없습니다.')
    default:
      return OPEN_STATUSES.has(order.status) ? undefined : fail(c, 409, 'already-processing', '주문이 처리 중입니다. 잠시 후 다시 시도해 주세요.', { retryAfterSeconds: 1 })
  }
}

const orderNotFound = (c: Ctx): Response => fail(c, 404, 'order-not-found', '주문을 찾을 수 없습니다.')

export function orderRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  app.post('/api/v1/orders', async (c) => {
    const resolved = requireAccount(c, store)
    if (resolved instanceof Response) {
      return resolved
    }
    const body = await readJson(c)
    if (body instanceof Response) {
      return body
    }
    // Re-read after the await: an overlapping request may have changed the balance.
    const account = ts.accounts.findOneBy('account_seq', resolved.account_seq) ?? resolved

    const clientOrderId = str(body.clientOrderId) ?? null
    if (clientOrderId !== null && !CLIENT_ORDER_ID_RE.test(clientOrderId)) {
      return invalid(c, { field: 'clientOrderId', maxLength: 36, pattern: '^[a-zA-Z0-9\\-_]+$' })
    }
    const symbol = str(body.symbol)
    if (!symbol) {
      return invalid(c, { field: 'symbol' }, MSG_INVALID_FIELD)
    }
    // createOrder documents no 404, so an unknown symbol is a request error.
    const stock = ts.stocks.findOneBy('symbol', symbol.toUpperCase())
    if (!stock) {
      return invalid(c, { field: 'symbol' })
    }
    const side = body.side as OrderSide
    if (side !== 'BUY' && side !== 'SELL') {
      return invalid(c, { field: 'side', allowedValues: ['BUY', 'SELL'] }, '주문 방향이 올바르지 않습니다.')
    }
    const orderType = body.orderType as OrderType
    if (orderType !== 'LIMIT' && orderType !== 'MARKET') {
      return invalid(c, { field: 'orderType', allowedValues: ['LIMIT', 'MARKET'] }, '호가 유형이 올바르지 않습니다.')
    }
    const tif = (body.timeInForce ?? 'DAY') as TimeInForce
    if (!['DAY', 'CLS', 'OPG'].includes(tif)) {
      return invalid(c, { field: 'timeInForce', allowedValues: ['DAY', 'CLS', 'OPG'] }, '주문 유효 조건이 올바르지 않습니다.')
    }
    const country = countryOf(stock.market)
    if (tif === 'CLS' && (country !== 'US' || orderType !== 'LIMIT')) {
      return invalid(
        c,
        { field: 'timeInForce', allowedConditions: { marketCountry: 'US', orderType: 'LIMIT' } },
        '종가 주문(CLS)은 미국 주식 지정가 주문에만 사용할 수 있습니다.',
      )
    }
    if (tif === 'OPG' && country !== 'KR') {
      return invalid(c, { field: 'timeInForce', allowedConditions: { marketCountry: 'KR' } }, '주문 유효 조건이 올바르지 않습니다.')
    }

    const quantityRaw = str(body.quantity)
    const amountRaw = str(body.orderAmount)
    if ((quantityRaw === undefined) === (amountRaw === undefined)) {
      return invalid(c, { field: 'quantity,orderAmount' }, '주문 수량 또는 금액 중 하나를 지정해야 합니다.')
    }
    let quantity: number | null = null
    let orderAmount: number | null = null
    if (amountRaw !== undefined) {
      if (country !== 'US' || orderType !== 'MARKET') {
        return invalid(
          c,
          { field: 'orderAmount', allowedConditions: { marketCountry: 'US', orderType: 'MARKET' } },
          '금액 주문은 미국 주식 시장가 주문에만 사용할 수 있습니다.',
        )
      }
      if (!DECIMAL_RE.test(amountRaw) || Number(amountRaw) <= 0) {
        return invalid(c, { field: 'orderAmount', format: 'decimal', pattern: '^\\d+(\\.\\d+)?$', maxLength: 30 })
      }
      orderAmount = Number(amountRaw)
    }
    else {
      const q = quantityRaw!
      if (!DECIMAL_RE.test(q) || q.length > 30) {
        return invalid(c, { field: 'quantity', format: 'decimal', pattern: '^-?\\d+(\\.\\d+)?$', maxLength: 30 }, '주문 수량이 유효한 숫자가 아닙니다.')
      }
      if (q.includes('.') && Number(q) % 1 !== 0) {
        if (country !== 'US' || orderType !== 'MARKET' || side !== 'SELL') {
          return invalid(
            c,
            { field: 'quantity', allowedConditions: { marketCountry: 'US', orderType: 'MARKET', side: 'SELL' } },
            '소수점 수량 주문은 미국 주식 시장가 매도 주문에만 사용할 수 있습니다. 소수점 매수는 orderAmount(금액) 주문을 사용해 주세요.',
          )
        }
        if (q.split('.')[1].length > 6) {
          return invalid(c, { field: 'quantity', constraint: { maxScale: 6 } }, '소수점 수량은 소수점 6자리까지 지원합니다.')
        }
      }
      quantity = Number(q)
      if (quantity <= 0) {
        return invalid(c, { field: 'quantity', constraint: { min: 1 } }, '주문 수량이 유효하지 않습니다.')
      }
    }

    const priceRaw = str(body.price)
    let price: number | null = null
    if (orderType === 'LIMIT') {
      if (priceRaw === undefined) {
        return invalid(c, { field: 'price' }, '지정가 주문 시 가격을 지정해야 합니다.')
      }
      const checked = checkPrice(c, stock, priceRaw)
      if (checked instanceof Response) {
        return checked
      }
      price = checked
    }
    else if (priceRaw !== undefined) {
      return invalid(c, { field: 'price' }, MSG_INVALID)
    }

    const requestKey = JSON.stringify([stock.symbol, side, orderType, tif, quantity, orderAmount, price])
    if (clientOrderId !== null) {
      const prior = ts.orders
        .findBy('account_seq', account.account_seq)
        .find(o => o.client_order_id === clientOrderId && Date.now() - o.ordered_ms < IDEMPOTENCY_WINDOW_MS)
      if (prior) {
        return prior.request_key === requestKey
          ? ok(c, { orderId: prior.order_id, clientOrderId })
          : fail(c, 422, 'idempotency-key-conflict', '동일한 clientOrderId 로 다른 내용의 주문을 요청할 수 없습니다.')
      }
    }

    const limitError = checkPriceLimits(c, stock, price)
    if (limitError) {
      return limitError
    }
    const notional = orderAmount ?? (quantity ?? 0) * (price ?? stock.price)
    const valueError = checkOrderValue(c, store, stock, notional, body.confirmHighValueOrder === true)
    if (valueError) {
      return valueError
    }
    const opposite = ts.orders
      .findBy('account_seq', account.account_seq)
      .some(o => o.symbol === stock.symbol && o.side !== side && OPEN_STATUSES.has(o.status))
    if (opposite) {
      return fail(c, 409, 'opposite-pending-order-exists', '동일 종목에 반대 방향의 체결 대기 주문이 있습니다.')
    }

    const res = placeOrder(store, account, stock, { side, orderType, timeInForce: tif, quantity, orderAmount, price, clientOrderId, requestKey })
    if ('error' in res) {
      return placeError(c, res.error)
    }
    return ok(c, { orderId: res.order.order_id, clientOrderId })
  })

  app.post('/api/v1/orders/:orderId/modify', async (c) => {
    const resolved = requireAccount(c, store)
    if (resolved instanceof Response) {
      return resolved
    }
    const body = await readJson(c)
    if (body instanceof Response) {
      return body
    }
    // Re-read after the await: an overlapping request may have changed the balance.
    const account = ts.accounts.findOneBy('account_seq', resolved.account_seq) ?? resolved
    const order = findOrder(store, account.account_seq, c.req.param('orderId'))
    if (!order) {
      return orderNotFound(c)
    }
    const stateError = finalStateError(c, order)
    if (stateError) {
      return stateError
    }
    const stock = ts.stocks.findOneBy('symbol', order.symbol)!
    const orderType = body.orderType as OrderType
    if (orderType !== 'LIMIT' && orderType !== 'MARKET') {
      return invalid(c, { field: 'orderType', allowedValues: ['LIMIT', 'MARKET'] }, '호가 유형이 올바르지 않습니다.')
    }
    const quantityRaw = str(body.quantity)
    let quantity = Number(order.quantity)
    if (countryOf(stock.market) === 'US') {
      if (quantityRaw !== undefined) {
        return fail(c, 400, 'us-modify-quantity-not-supported', '미국 주식 주문 정정은 가격만 지원합니다.', { field: 'quantity' })
      }
    }
    else {
      if (quantityRaw === undefined || !/^\d+$/.test(quantityRaw) || Number(quantityRaw) < 1) {
        return invalid(c, { field: 'quantity', constraint: { min: 1, integerOnly: true } }, '주문 수량이 유효하지 않습니다.')
      }
      quantity = Number(quantityRaw)
    }
    const priceRaw = str(body.price)
    let price: number | null = null
    if (orderType === 'LIMIT') {
      if (priceRaw === undefined) {
        return invalid(c, { field: 'price' }, '지정가 주문에는 가격이 필요합니다.')
      }
      const checked = checkPrice(c, stock, priceRaw)
      if (checked instanceof Response) {
        return checked
      }
      price = checked
    }
    else if (priceRaw !== undefined) {
      return invalid(c)
    }
    const limitError = checkPriceLimits(c, stock, price)
    if (limitError) {
      return limitError
    }
    const valueError = checkOrderValue(c, store, stock, quantity * (price ?? stock.price), body.confirmHighValueOrder === true)
    if (valueError) {
      return valueError
    }

    const res = placeOrder(
      store,
      account,
      stock,
      {
        side: order.side,
        orderType,
        timeInForce: order.time_in_force,
        quantity,
        orderAmount: null,
        price,
        clientOrderId: null,
        requestKey: null,
      },
      { replaces: order },
    )
    if ('error' in res) {
      return placeError(c, res.error)
    }
    ts.orders.update(order.id, { status: 'REPLACED', reserved: 0 })
    // Conditional legs track the live replacement order, not the replaced one.
    for (const co of ts.conditionalOrders.all()) {
      const relink = (leg: ConditionalLeg | null) => (leg?.triggeredOrderId === order.order_id ? { ...leg, triggeredOrderId: res.order.order_id } : leg)
      const first = relink(co.first)!
      const second = relink(co.second)
      if (first !== co.first || second !== co.second) {
        ts.conditionalOrders.update(co.id, { first, second })
      }
    }
    return ok(c, { orderId: res.order.order_id })
  })

  app.post('/api/v1/orders/:orderId/cancel', async (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const order = findOrder(store, account.account_seq, c.req.param('orderId'))
    if (!order) {
      return orderNotFound(c)
    }
    const stateError = finalStateError(c, order)
    if (stateError) {
      return stateError
    }
    const cancelId = newOrderId()
    ts.orders.update(order.id, { status: 'CANCELED', canceled_at: kstIso(Date.now()), reserved: 0, cancel_order_id: cancelId })
    return ok(c, { orderId: cancelId })
  })
}
