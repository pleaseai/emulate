# @pleaseai/emulate-spotify

Spotify Web API emulator for local development and CI.

Models the canonical OAuth 2.0 client credentials flow: an app-only token minted from a `client_id`/`client_secret` at the accounts token endpoint, reaching the public catalog (search, artists, albums, tracks). An OpenAPI subset is served at `/openapi.json`.

Ported from the [UsefulSoftwareCo/emulate](https://github.com/UsefulSoftwareCo/emulate) fork.

## Install

```bash
npm install @pleaseai/emulate-spotify
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
npx @pleaseai/emulate --service spotify
```

A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Auth

```bash
# Mint an app-only token (client credentials)
curl -X POST http://localhost:4000/api/token \
  -d grant_type=client_credentials \
  -d client_id=spotify_client_id_example \
  -d client_secret=spotify_client_secret_example

# Use it against the catalog
curl "http://localhost:4000/v1/search?q=daft&type=artist" \
  -H "Authorization: Bearer <access_token>"
```

## Seed Config

```yaml
spotify:
  clients:
    - client_id: spotify_client_id_example
      client_secret: spotify_client_secret_example
      name: Demo App
  artists:
    - name: Daft Punk
      genres: [electronic]
      popularity: 88
      followers: 9000000
      albums:
        - name: Discovery
          release_date: 2001-03-12
          tracks:
            - name: One More Time
            - name: Digital Love
```
