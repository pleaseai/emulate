# @pleaseai/emulate-tossinvest

Toss Invest (토스증권) Open API emulator for local development and CI.

Covers all 41 operations of the Open API, including the OAuth 2.0 token endpoint: client credentials tokens, market data (prices, order book, trades, price limits, candles), stock info and KR investor trends, exchange rates and market calendars, rankings, market indicators, sectors, accounts and holdings, orders (create, modify, cancel, history), conditional orders (SINGLE / OCO / OTO), and buying power / sellable quantity / commissions.

Accounts, holdings, orders, and conditional orders are stateful: a market order (or a marketable limit order) fills immediately at the current price and updates cash and holdings; other limit orders rest as `PENDING` and reserve buying power. Market and reference data are generated deterministically from the seeded prices, so the same request returns the same data.

## Install

```bash
npm install @pleaseai/emulate-tossinvest
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
npx @pleaseai/emulate --service tossinvest
```

A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Auth

```bash
# Issue an access token (client credentials). Issuing a new token revokes the previous one.
curl -X POST http://localhost:4000/oauth2/token \
  -d grant_type=client_credentials \
  -d client_id=tsck_example_client_id \
  -d client_secret=tsck_example_client_secret

# Market data needs only the token
curl "http://localhost:4000/api/v1/prices?symbols=005930,AAPL" \
  -H "Authorization: Bearer <access_token>"

# Account-scoped endpoints also need X-Tossinvest-Account
curl -X POST http://localhost:4000/api/v1/orders \
  -H "Authorization: Bearer <access_token>" \
  -H "X-Tossinvest-Account: 1" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"005930","side":"BUY","orderType":"MARKET","quantity":"10"}'
```

Successful responses are wrapped in `{ "result": ... }`; errors use `{ "error": { "requestId", "code", "message", "data"? } }`. The exception is `POST /oauth2/token`, which returns the plain OAuth2 shape (`{ "access_token", "token_type", "expires_in" }`, or `{ "error", "error_description" }`). Every response carries `X-Request-Id`.

## Emulator controls

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/_emulator/apps` | List or create client credentials |
| `POST` | `/_emulator/prices` | Set a stock price (`{"symbol":"005930","price":71000}`); fills resting limit orders and fires conditional orders whose trigger is crossed |

## Seed Config

```yaml
tossinvest:
  usd_krw: 1375
  holidays:
    KR: [2026-05-05, 2026-10-09]
    US: [2026-07-03]
  clients:
    - client_id: tsck_example_client_id
      client_secret: tsck_example_client_secret
      name: Demo App
  stocks:
    - symbol: '005930'
      name: 삼성전자
      market: KOSPI
      price: 72000
    - symbol: AAPL
      name: 애플
      market: NASDAQ
      price: 185.7
  sectors:
    - sector_id: '100'
      name: 반도체
      stocks: ['005930']
  accounts:
    - account_seq: 1
      account_no: '12345678901'
      cash:
        krw: 10000000
        usd: 10000
      commission:
        kr: '0.00015'
        us: '0.001'
        kr_start_date: 2026-01-01
      holdings:
        - symbol: '005930'
          quantity: 100
          average_price: 65000
```

Units and formats:

- `usd_krw`: KRW per 1 USD. The exchange-rate series moves around this value.
- `stocks[].price` and `holdings[].average_price`: in the stock's trading currency (KRW for KR markets, USD for US markets). `price` drives order fills.
- `stocks[].symbol`: a 6-character KRX code (quote it in YAML so leading zeros survive) or a US ticker.
- `cash.krw` / `cash.usd`: cash balance in won and dollars.
- `holdings[].quantity`: number of shares.
- `accounts[].client_id` (optional): limits the account to one client; omit it to show the account to every client.
- `accounts[].commission.kr_start_date` (optional): the KR rate's `startDate` in `GET /api/v1/commissions` (`YYYY-MM-DD` or `null`). Defaults to `2026-01-01`.
- `holidays` (optional): market holidays per country as `YYYY-MM-DD` strings. A holiday is closed in the market calendars and is skipped by daily candles, previous closes and price limits, rankings, trend data, and settlement dates. A country you list replaces its built-in 2026 holiday set (`null` or `[]` leaves it with none); a country you leave out keeps it. Only `KR` and `US` are accepted.

## Not emulated

- Trading hours: orders are accepted at any time, and `DAY` orders do not expire.
- Time in force: `CLS` and `OPG` orders behave like `DAY` orders.
- Partial fills, rate limiting (`429`), and the WebSocket streaming API.
