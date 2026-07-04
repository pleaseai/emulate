# @pleaseai/emulate-gitlab

GitLab GraphQL API emulator for local development and CI.

Serves `POST /api/graphql` backed by the real GitLab schema SDL, with full introspection support. Query resolvers are follow-up work — today the emulator validates queries against the schema and answers introspection, which is enough for clients that build against the schema (codegen, IDE tooling, connection smoke tests).

Ported from the [UsefulSoftwareCo/emulate](https://github.com/UsefulSoftwareCo/emulate) fork.

## Install

```bash
npm install @pleaseai/emulate-gitlab
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
npx @pleaseai/emulate --service gitlab
```

A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Usage

```bash
curl http://localhost:4000/api/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { queryType { name } } }"}'
```

## Seed Config

The GitLab emulator takes no seed data yet:

```yaml
gitlab: {}
```
