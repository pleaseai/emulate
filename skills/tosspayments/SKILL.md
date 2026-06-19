---
name: tosspayments
description: Emulated Toss Payments API for local development and testing. Use when the user needs to test a Toss Payments integration locally, confirm/look up/cancel a payment, simulate the checkout flow, exercise payment webhooks, or avoid hitting the real Toss Payments API.
allowed-tools: Bash(bun:*), Bash(npx @pleaseai/emulate:*), Bash(curl:*)
---

# Toss Payments API Emulator

A stateful emulator for the Toss Payments REST API.

Included now:

- Payment confirm / lookup (by paymentKey or orderId) / cancel (incl. partial)
- Checkout page simulation (`/checkout` → `/checkout/approve`)
- An `/internal/payments` helper to create a payment without the widget
- `PAYMENT_STATUS_CHANGED` webhooks on confirm and cancel

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service tosspayments

# Or from the published package
npx @pleaseai/emulate --service tosspayments
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port (tosspayments' slot is `4002`).

## Auth

Payment API routes use HTTP Basic auth with the secret key as the username and
an empty password — `Authorization: Basic base64("<secret_key>:")` (note the
trailing colon). The checkout pages and `/internal/payments` helper need no auth.

```bash
# Build the header value for test_sk_example
echo -n 'test_sk_example:' | base64   # → dGVzdF9za19leGFtcGxlOg==
```

## Flow

```bash
# 1. Create a payment (replaces the payment-widget step)
curl -X POST http://localhost:4000/internal/payments \
  -H "Content-Type: application/json" \
  -d '{"orderId":"order-1","orderName":"Test order","amount":11000}'
# → {"paymentKey":"<paymentKey>", ...}

# 2. Confirm it
curl -X POST http://localhost:4000/v1/payments/confirm \
  -H "Authorization: Basic $(echo -n 'test_sk_example:' | base64)" \
  -H "Content-Type: application/json" \
  -d '{"paymentKey":"<paymentKey>","orderId":"order-1","amount":11000}'

# 3. Look it up (by paymentKey or by orderId)
curl http://localhost:4000/v1/payments/<paymentKey> \
  -H "Authorization: Basic $(echo -n 'test_sk_example:' | base64)"
curl http://localhost:4000/v1/payments/orders/order-1 \
  -H "Authorization: Basic $(echo -n 'test_sk_example:' | base64)"

# 4. Cancel it (omit cancelAmount for a full cancel)
curl -X POST http://localhost:4000/v1/payments/<paymentKey>/cancel \
  -H "Authorization: Basic $(echo -n 'test_sk_example:' | base64)" \
  -H "Content-Type: application/json" \
  -d '{"cancelReason":"User requested","cancelAmount":11000}'
```

Confirm and cancel dispatch a `PAYMENT_STATUS_CHANGED` webhook to any configured
webhook URLs.

## Seed Config

Add a `tosspayments:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
tosspayments:
  merchants:
    - client_key: test_ck_example
      secret_key: test_sk_example
```
