---
title: Autumn
description: "Emulated Autumn billing API for local development and testing."
sidebar:
  label: Autumn
  order: 8
---

:::note
Default port **4007** · Package [`@pleaseai/emulate-autumn`](https://www.npmjs.com/package/@pleaseai/emulate-autumn)
:::

Implements the v1 RPC-style API autumn-js speaks (`/v1/<group>.<method>`).

Included now:

- `customers.get_or_create`, `customers.update`, `customers.list`
- `balances.track` and `balances.check`
- `plans.list` with per-customer eligibility (trials, upgrades, downgrades)
- `billing.attach` and `billing.open_customer_portal`
- A hosted checkout page that settles paid plans and card-required trials

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service autumn

# Or from the published package
npx @pleaseai/emulate --service autumn
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port.

## Auth

Any `am_`-prefixed bearer token is accepted as the secret key.

```bash
curl -X POST http://localhost:4000/v1/customers.get_or_create \
  -H "Authorization: Bearer am_test_emulate" \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "org_demo"}'
```

With the SDK:

```ts
import { Autumn } from 'autumn-js'

const autumn = new Autumn({ secretKey: 'am_test_emulate', serverURL: 'http://localhost:4000' })
```

## Check Example

```bash
curl -X POST http://localhost:4000/v1/balances.check \
  -H "Authorization: Bearer am_test_emulate" \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "org_demo", "feature_id": "executions"}'
```

## Seed Config

Add an `autumn:` section to `emulate.config.yaml` (or pass `--seed <file>`):

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
