import type { RouteContext, Store } from '@emulators/core'
import type { TossAccount, TossHolding, TossStock } from '../entities.js'
import { clientIdOf, fmt, ok, requireAccount } from '../helpers.js'
import { countryOf, currencyOf, formatPrice, previousClose, toKrw } from '../market.js'
import { getTossinvestStore } from '../store.js'
import { tradeCosts } from '../trading.js'
import { resolveStock } from './market-data.js'

interface HoldingCalc {
  currency: 'KRW' | 'USD'
  purchase: number
  amount: number
  afterCost: number
  daily: number
  item: Record<string, unknown>
}

const RATE_DP = 4

function holdingCalc(store: Store, account: TossAccount, h: TossHolding, stock: TossStock): HoldingCalc {
  const currency = currencyOf(stock.market)
  const dp = currency === 'KRW' ? 0 : 2
  const kr = countryOf(stock.market) === 'KR'
  const purchase = h.quantity * h.average_price
  const amount = h.quantity * stock.price
  const costs = tradeCosts(account, stock, amount, 'SELL')
  const commission = costs.commission
  const tax = kr ? costs.tax : null
  const afterCost = amount - commission - (tax ?? 0)
  const prev = previousClose(store, stock)
  const daily = h.quantity * (stock.price - prev)
  const rate = (x: number, base: number) => fmt(base === 0 ? 0 : x / base, RATE_DP)
  return {
    currency,
    purchase,
    amount,
    afterCost,
    daily,
    item: {
      symbol: stock.symbol,
      name: stock.name,
      marketCountry: countryOf(stock.market),
      currency,
      quantity: fmt(h.quantity, 6),
      lastPrice: formatPrice(stock, stock.price),
      averagePurchasePrice: fmt(h.average_price, kr ? 2 : 4),
      marketValue: { purchaseAmount: fmt(purchase, dp), amount: fmt(amount, dp), amountAfterCost: fmt(afterCost, dp) },
      profitLoss: {
        amount: fmt(amount - purchase, dp),
        amountAfterCost: fmt(afterCost - purchase, dp),
        rate: rate(amount - purchase, purchase),
        rateAfterCost: rate(afterCost - purchase, purchase),
      },
      dailyProfitLoss: { amount: fmt(daily, dp), rate: rate(stock.price - prev, prev) },
      cost: { commission: fmt(commission, dp), tax: tax === null ? null : fmt(tax, dp) },
    },
  }
}

export function accountRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  app.get('/api/v1/accounts', (c) => {
    const clientId = clientIdOf(c)
    const accounts = ts.accounts
      .all()
      .filter(a => a.account_type === 'BROKERAGE' && (a.client_id === null || a.client_id === clientId))
      .sort((a, b) => a.account_seq - b.account_seq)
      .map(a => ({ accountNo: a.account_no, accountSeq: a.account_seq, accountType: a.account_type }))
    return ok(c, accounts)
  })

  app.get('/api/v1/holdings', (c) => {
    const account = requireAccount(c, store)
    if (account instanceof Response) {
      return account
    }
    const symbolRaw = c.req.query('symbol')
    let filter: TossStock | undefined
    if (symbolRaw !== undefined) {
      const stock = resolveStock(c, store, symbolRaw)
      if (stock instanceof Response) {
        return stock
      }
      filter = stock
    }
    const calcs = ts.holdings
      .findBy('account_seq', account.account_seq)
      .filter(h => h.quantity > 0 && (!filter || h.symbol === filter.symbol))
      .map(h => ({ h, stock: ts.stocks.findOneBy('symbol', h.symbol) }))
      .filter((x): x is { h: TossHolding, stock: TossStock } => !!x.stock)
      .sort((a, b) => a.h.id - b.h.id)
      .map(({ h, stock }) => holdingCalc(store, account, h, stock))

    const hasUsd = calcs.some(x => x.currency === 'USD')
    const sum = (pick: (x: HoldingCalc) => number) => ({
      krw: fmt(calcs.filter(x => x.currency === 'KRW').reduce((s, x) => s + pick(x), 0), 0),
      usd: hasUsd ? fmt(calcs.filter(x => x.currency === 'USD').reduce((s, x) => s + pick(x), 0), 2) : null,
    })
    const krw = (pick: (x: HoldingCalc) => number) => calcs.reduce((s, x) => s + toKrw(store, pick(x), x.currency), 0)
    const purchaseKrw = krw(x => x.purchase)
    const rate = (num: number, den: number) => fmt(den === 0 ? 0 : num / den, RATE_DP)
    return ok(c, {
      totalPurchaseAmount: sum(x => x.purchase),
      marketValue: { amount: sum(x => x.amount), amountAfterCost: sum(x => x.afterCost) },
      profitLoss: {
        amount: sum(x => x.amount - x.purchase),
        amountAfterCost: sum(x => x.afterCost - x.purchase),
        rate: rate(krw(x => x.amount) - purchaseKrw, purchaseKrw),
        rateAfterCost: rate(krw(x => x.afterCost) - purchaseKrw, purchaseKrw),
      },
      dailyProfitLoss: {
        amount: sum(x => x.daily),
        rate: rate(krw(x => x.daily), krw(x => x.amount - x.daily)),
      },
      items: calcs.map(x => x.item),
    })
  })
}
