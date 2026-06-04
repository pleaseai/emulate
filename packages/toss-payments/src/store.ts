import type { Collection, Store } from '@emulators/core'
import type { TossMerchant, TossPayment } from './entities.js'

export interface TossStore {
  merchants: Collection<TossMerchant>
  payments: Collection<TossPayment>
}

export function getTossStore(store: Store): TossStore {
  return {
    merchants: store.collection<TossMerchant>('tosspayments.merchants', ['client_key', 'secret_key']),
    payments: store.collection<TossPayment>('tosspayments.payments', ['payment_key', 'order_id']),
  }
}
