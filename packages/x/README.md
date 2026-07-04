# @pleaseai/emulate-x

X (Twitter) API v2 emulator for local development and CI.

Covers OAuth 2.0 authorization code with PKCE (authorize page, consent, token, revoke) for confidential and public clients, tweets (create, delete, lookup, user timelines), and users (me, by id, by username). An OpenAPI subset is served at `/2/openapi.json`.

Ported from the [UsefulSoftwareCo/emulate](https://github.com/UsefulSoftwareCo/emulate) fork.

## Install

```bash
npm install @pleaseai/emulate-x
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
npx @pleaseai/emulate --service x
```

A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Auth

Run the PKCE flow against `/2/oauth2/authorize` + `/2/oauth2/token`, then call the API with the issued token:

```bash
curl http://localhost:4000/2/users/me \
  -H "Authorization: Bearer <access_token>"
```

## Seed Config

```yaml
x:
  users:
    - username: developer
      name: Developer
      verified: true
  oauth_clients:
    - client_id: x_client_id_example
      client_secret: x_client_secret_example
      client_type: confidential
      redirect_uris:
        - http://localhost:3000/api/auth/callback/x
  tweets:
    - text: Hello from the emulator!
      author: developer
```
