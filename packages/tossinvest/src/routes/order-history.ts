import type { RouteContext } from '@emulators/core'
import { decodeCursor, encodeCursor, fail, intQuery, invalid, ok, requireAccount } from '../helpers.js'
import { getTossinvestStore } from '../store.js'
import { dateToDayIdx, kstDayIdx } from '../time.js'
import { findOrder, OPEN_STATUSES, orderView } from '../trading.js'
import { resolveStock } from './market-data.js'

export function orderHistoryRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  app.get('/api/v1/orders', (c) => {
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
    let symbol: string | undefined
    const symbolRaw = c.req.query('symbol')
    if (symbolRaw) {
      const stock = resolveStock(c, store, symbolRaw)
      if (stock instanceof Response) {
        return stock
      }
      symbol = stock.symbol
    }
    const range: Array<number | undefined> = []
    for (const field of ['from', 'to'] as const) {
      const raw = c.req.query(field)
      const day = raw ? dateToDayIdx(raw) : undefined
      if (raw && day === undefined) {
        return invalid(c, { field, format: 'date' })
      }
      range.push(day)
    }
    const [from, to] = range

    const matching = ts.orders
      .findBy('account_seq', account.account_seq)
      .filter(o => (status === 'OPEN') === OPEN_STATUSES.has(o.status))
      .filter(o => !symbol || o.symbol === symbol)
      .filter((o) => {
        const day = kstDayIdx(o.ordered_ms)
        return (from === undefined || day >= from) && (to === undefined || day <= to)
      })
      .sort((a, b) => b.id - a.id)

    if (status === 'OPEN') {
      return ok(c, { orders: matching.map(orderView), nextCursor: null, hasNext: false })
    }
    const limit = intQuery(c, 'limit', 20, 1, 100)
    if (limit instanceof Response) {
      return limit
    }
    const cursorRaw = c.req.query('cursor')
    const after = cursorRaw ? decodeCursor(cursorRaw) : undefined
    if (cursorRaw && after === undefined) {
      return invalid(c, { field: 'cursor' })
    }
    const page = matching.filter(o => after === undefined || o.id < after)
    const items = page.slice(0, limit)
    const hasNext = page.length > limit
    return ok(c, {
      orders: items.map(orderView),
      nextCursor: hasNext ? encodeCursor(items[items.length - 1].id) : null,
      hasNext,
    })
  })

  app.get('/api/v1/orders/:orderId', (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const order = findOrder(store, account.account_seq, c.req.param('orderId'))
    return order ? ok(c, orderView(order)) : fail(c, 404, 'order-not-found', '주문을 찾을 수 없습니다.')
  })
}
