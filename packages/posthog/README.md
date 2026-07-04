# @pleaseai/emulate-posthog

PostHog analytics API emulator for local development and CI.

Covers event capture and the private read API (`/api/projects`, `/api/projects/:id/events`, `/api/users/@me`), plus a full OAuth 2.0 surface with dynamic client registration (`/oauth/register`), authorize/token endpoints, and RFC 8414 / OIDC discovery documents. An OpenAPI subset is served at `/openapi.json`.

Ported from the [UsefulSoftwareCo/emulate](https://github.com/UsefulSoftwareCo/emulate) fork.

## Install

```bash
npm install @pleaseai/emulate-posthog
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
npx @pleaseai/emulate --service posthog
```

A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Auth

Use a seeded project API token (or a personal API key) as a bearer token:

```bash
curl http://localhost:4000/api/projects \
  -H "Authorization: Bearer phc_test_token"
```

## Seed Config

```yaml
posthog:
  users:
    - email: dev@example.com
      name: Developer
  projects:
    - name: Demo Project
      api_token: phc_test_token
  events:
    - event: $pageview
      distinct_id: user-1
  oauth_clients:
    - client_id: posthog-client
      client_secret: posthog-secret
      redirect_uris:
        - http://localhost:3000/callback
```
