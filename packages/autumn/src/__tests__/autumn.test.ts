import { createServer, serve } from '@emulators/core'
import { Autumn } from 'autumn-js'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { autumnPlugin, seedFromConfig } from '../index.js'

// The real autumn-js SDK (zod-validated responses) against the emulator.

const PORT = 41876
const BASE = `http://localhost:${PORT}`

let httpServer: ReturnType<typeof serve>
let autumn: Autumn

beforeAll(() => {
  const { app, store } = createServer(autumnPlugin, {
    port: PORT,
    baseUrl: BASE,
    fallbackUser: { login: 'am_emulate_admin', id: 1, scopes: [] },
  })
  seedFromConfig(store, BASE, {
    plans: [
      { id: 'pro', name: 'Pro', items: [{ feature_id: 'executions', included: 1000 }] },
      { id: 'starter', name: 'Starter', items: [{ feature_id: 'executions', included: 2 }] },
      {
        id: 'premium',
        name: 'Premium',
        price: { amount: 50, interval: 'month' },
        items: [{ feature_id: 'executions', included: 100000 }],
      },
    ],
    customers: [
      { id: 'org_paid', subscriptions: [{ plan_id: 'pro', status: 'active' }] },
      { id: 'org_capped', subscriptions: [{ plan_id: 'starter', status: 'active' }] },
    ],
  })
  httpServer = serve({ fetch: app.fetch, port: PORT })
  autumn = new Autumn({ secretKey: 'am_test_emulate', serverURL: BASE })
})

afterAll(async () => {
  await new Promise<void>(resolve => httpServer.close(() => resolve()))
})

describe('autumn emulator with the real autumn-js SDK', () => {
  it('get_or_create creates a fresh customer with no subscriptions', async () => {
    const customer = await autumn.customers.getOrCreate({ customerId: 'org_fresh' })
    expect(customer.id).toBe('org_fresh')
    expect(customer.subscriptions ?? []).toHaveLength(0)
  })

  it('get_or_create returns the seeded paid subscription', async () => {
    const customer = await autumn.customers.getOrCreate({ customerId: 'org_paid' })
    expect(customer.subscriptions?.map(s => s.planId ?? (s as { plan_id?: string }).plan_id)).toContain('pro')
  })

  it('tracks usage events', async () => {
    await autumn.track({ customerId: 'org_fresh', featureId: 'executions', value: 1 })
  })

  it('check allows a feature with remaining balance', async () => {
    const check = await autumn.check({ customerId: 'org_paid', featureId: 'executions' })
    expect(check.allowed).toBe(true)
    expect(check.customerId).toBe('org_paid')
    expect(check.balance?.remaining).toBe(1000)
    expect(check.balance?.unlimited).toBe(false)
  })

  it('check denies an exhausted feature with no overage', async () => {
    // starter includes 2 executions; burn them both through balances.track.
    await autumn.track({ customerId: 'org_capped', featureId: 'executions', value: 2 })
    const check = await autumn.check({ customerId: 'org_capped', featureId: 'executions' })
    expect(check.allowed).toBe(false)
    expect(check.balance?.remaining).toBe(0)
    expect(check.balance?.usage).toBe(2)
    expect(check.balance?.overageAllowed).toBe(false)
  })

  it('check allows a feature the customer\'s plan does not carry', async () => {
    const check = await autumn.check({ customerId: 'org_paid', featureId: 'not-a-feature' })
    expect(check.allowed).toBe(true)
    expect(check.balance).toBeNull()
  })

  it('lists customers and events over the raw RPC surface', async () => {
    const auth = { 'authorization': 'Bearer am_test_emulate', 'content-type': 'application/json' }

    const customers = await fetch(`${BASE}/v1/customers.list`, { method: 'POST', headers: auth, body: '{}' })
    expect(customers.status).toBe(200)
    const list = (await customers.json()) as { list: Array<{ id: string }>, total: number }
    expect(list.total).toBeGreaterThan(0)

    const events = await fetch(`${BASE}/v1/events.list`, { method: 'POST', headers: auth, body: '{}' })
    expect(events.status).toBe(200)

    const features = await fetch(`${BASE}/v1/features.list`, { method: 'POST', headers: auth, body: '{}' })
    expect(features.status).toBe(200)
  })

  it('updates a customer and rejects unknown ids', async () => {
    const auth = { 'authorization': 'Bearer am_test_emulate', 'content-type': 'application/json' }
    const updated = await fetch(`${BASE}/v1/customers.update`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ customer_id: 'org_paid', name: 'Paid Org', email: 'paid@example.com' }),
    })
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { name: string }).name).toBe('Paid Org')

    const missing = await fetch(`${BASE}/v1/customers.update`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ customer_id: 'org_never_seen' }),
    })
    expect(missing.status).toBe(404)
  })

  it('opens a customer portal link', async () => {
    const res = await fetch(`${BASE}/v1/billing.open_customer_portal`, {
      method: 'POST',
      headers: { 'authorization': 'Bearer am_test_emulate', 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: 'org_paid' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { url: string }).url).toContain('/checkout/portal/org_paid')
  })

  it('renders checkout pages and settles a single session', async () => {
    const auth = { 'authorization': 'Bearer am_test_emulate', 'content-type': 'application/json' }
    const attach = await fetch(`${BASE}/v1/billing.attach`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ customer_id: 'org_fresh', plan_id: 'premium', success_url: `${BASE}/done` }),
    })
    expect(attach.status).toBe(200)
    const { payment_url } = (await attach.json()) as { payment_url: string }
    expect(payment_url).toContain('/checkout/cs_emulate_')
    const sessionId = payment_url.split('/').pop()!

    const page = await fetch(payment_url)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Premium')

    const missingPage = await fetch(`${BASE}/checkout/cs_emulate_does_not_exist`)
    expect(missingPage.status).toBe(404)

    const complete = await fetch(`${BASE}/checkout/${sessionId}/complete`, { method: 'POST', redirect: 'manual' })
    expect(complete.status).toBe(302)

    const settle = await fetch(`${BASE}/checkout/${sessionId}/settle`, { method: 'POST' })
    expect(settle.status).toBe(200)

    const settledPage = await fetch(payment_url)
    expect(await settledPage.text()).toContain('Subscription active')

    const customer = await autumn.customers.getOrCreate({ customerId: 'org_fresh' })
    expect(customer.subscriptions?.some(s => (s.planId ?? (s as { plan_id?: string }).plan_id) === 'premium')).toBe(true)
  })

  // Regression for the autumn-js 0.9.0 emulator regression: autumn-js 1.2.8's
  // `useCustomer` hook drives its backend route, which always calls
  // `customers.getOrCreate` with `expand: ["balances.feature"]` (see
  // node_modules/autumn-js dist/backend/index.js routeConfigs). Its
  // `customerToFeatures` helper then throws
  // "[customerToFeatures] please expand `balances.feature` or `flags.feature`
  // ..." unless every entry in `balances` (and `flags`) carries a nested
  // `feature` object. The emulator must return that shape on every
  // customers.get_or_create response, not just when a client-supplied
  // `expand` happens to ask for it.
  it('get_or_create expands balances.feature for autumn-js\'s customerToFeatures', async () => {
    const customer = await autumn.customers.getOrCreate({
      customerId: 'org_paid',
      expand: ['balances.feature'],
    })

    const balances = Object.values(customer.balances ?? {})
    expect(balances.length).toBeGreaterThan(0)
    for (const balance of balances) {
      expect(balance.feature, `balance ${balance.featureId} is missing an expanded feature`).toBeTruthy()
      expect(balance.feature?.id).toBe(balance.featureId)
    }

    // Mirrors autumn-js's own customerToFeatures check (not part of its public
    // export surface, so replicated here): it throws unless the first
    // balance/flag entry has a `.feature`.
    const customerStates = [...Object.values(customer.balances ?? {}), ...Object.values(customer.flags ?? {})]
    expect(customerStates[0]?.feature, 'customerToFeatures would throw on this response').toBeTruthy()
  })
})
