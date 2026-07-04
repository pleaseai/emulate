# @pleaseai/emulate-autumn

[Autumn](https://useautumn.com) billing API emulator for local development and CI.

Implements the v1 RPC-style API autumn-js speaks (`/v1/<group>.<method>`): `customers.get_or_create`/`update`/`list`, `balances.track`/`check`, `plans.list`, `billing.attach`/`open_customer_portal`, plus a hosted checkout page that settles card-required trials and paid plans. Tested against the real `autumn-js` SDK.

Ported from the [UsefulSoftwareCo/emulate](https://github.com/UsefulSoftwareCo/emulate) fork.

## Install

```bash
npm install @pleaseai/emulate-autumn
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
npx @pleaseai/emulate --service autumn
```

A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Auth

Any `am_`-prefixed bearer token is accepted as the secret key:

```bash
curl -X POST http://localhost:4000/v1/customers.get_or_create \
  -H "Authorization: Bearer am_test_emulate" \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "org_demo"}'
```

Or point the SDK at the emulator:

```ts
import { Autumn } from 'autumn-js'

const autumn = new Autumn({ secretKey: 'am_test_emulate', serverURL: 'http://localhost:4000' })
```

## Seed Config

```yaml
autumn:
  plans:
    - id: free
      name: Free
      auto_enable: true
      items:
        - feature_id: executions
          included: 100
    - id: pro
      name: Pro
      price:
        amount: 20
        interval: month
      items:
        - feature_id: executions
          included: 10000
  customers:
    - id: org_demo
      subscriptions:
        - plan_id: pro
          status: active
```
