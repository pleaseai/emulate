---
title: Spotify
description: "Emulated Spotify Web API for local development and testing."
sidebar:
  label: Spotify
  order: 11
---

:::note
Default port **4010** · Package [`@pleaseai/emulate-spotify`](https://www.npmjs.com/package/@pleaseai/emulate-spotify)
:::

Models the canonical OAuth 2.0 client credentials provider: an app-only token
(no user) minted from a `client_id`/`client_secret`, reaching the public catalog.

Included now:

- `POST /api/token` (client credentials; form body or HTTP Basic)
- `GET /v1/search` with `q` and `type=artist,album,track`
- `GET /v1/artists/:id`, `/v1/artists/:id/albums`, `/v1/albums/:id`, `/v1/tracks/:id`
- OpenAPI subset at `/openapi.json`

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service spotify

# Or from the published package
npx @pleaseai/emulate --service spotify
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port.

## Auth

```bash
curl -X POST http://localhost:4000/api/token \
  -d grant_type=client_credentials \
  -d client_id=spotify_client_id_example \
  -d client_secret=spotify_client_secret_example
```

## Catalog Example

```bash
curl "http://localhost:4000/v1/search?q=daft&type=artist" \
  -H "Authorization: Bearer <access_token>"
```

## Seed Config

Add a `spotify:` section to `emulate.config.yaml` (or pass `--seed <file>`):

```yaml
spotify:
  clients:
    - client_id: spotify_client_id_example
      client_secret: spotify_client_secret_example
      name: Demo App
  artists:
    - name: Daft Punk
      genres: [electronic]
      albums:
        - name: Discovery
          release_date: 2001-03-12
          tracks:
            - name: One More Time
```
