import type { RouteContext } from '@emulators/core'
import { fmt, invalid, ok, requireAccount } from '../helpers.js'
import { availableCash, qtyDp, sellableQuantity } from '../trading.js'
import { resolveStock } from './market-data.js'

export function orderInfoRoutes({ app, store }: RouteContext): void {
  app.get('/api/v1/buying-power', (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const currency = c.req.query('currency')
    if (currency !== 'KRW' && currency !== 'USD') {
      return invalid(c, { field: 'currency', allowedValues: ['KRW', 'USD'] }, '지원하지 않는 통화입니다.')
    }
    return ok(c, { currency, cashBuyingPower: fmt(availableCash(store, account, currency), currency === 'KRW' ? 0 : 2) })
  })

  // The spec lists account-not-found under 400 for these two endpoints.
  app.get('/api/v1/sellable-quantity', (c) => {
    const account = requireAccount(c, store, 400)
    if (account instanceof Response) {
      return account
    }
    const stock = resolveStock(c, store, c.req.query('symbol'))
    if (stock instanceof Response) {
      return stock
    }
    return ok(c, { sellableQuantity: fmt(sellableQuantity(store, account.account_seq, stock), qtyDp(stock)) })
  })

  app.get('/api/v1/commissions', (c) => {
    const account = requireAccount(c, store, 400)
    if (account instanceof Response) {
      return account
    }
    return ok(c, [
      { marketCountry: 'KR', commissionRate: account.commission_kr, startDate: account.commission_kr_start_date, endDate: null },
      { marketCountry: 'US', commissionRate: account.commission_us, startDate: null, endDate: null },
    ])
  })
}
