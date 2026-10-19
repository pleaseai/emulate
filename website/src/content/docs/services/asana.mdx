---
title: Asana
description: "Emulated Asana REST API (v1.0) for local development and testing."
sidebar:
  label: Asana
  order: 6
---

:::note
Default port **4005** · Package [`@pleaseai/emulate-asana`](https://www.npmjs.com/package/@pleaseai/emulate-asana)
:::

A stateful, in-memory Asana REST API (v1.0) emulator.

Included now:

- Users, workspaces, teams, projects, sections, tasks, tags, stories, webhooks
- Subtasks, task dependencies/dependents, followers, project/section membership
- Bearer-token auth and offset-based pagination (`limit` 1–100, `offset`)

Follow-up work will add OAuth 2.0 and an inspector UI.

## Start

```bash
# From this repo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service asana

# Or from the published package
npx @pleaseai/emulate --service asana
```

A single service starts on the base port (default `4000`). Use `-p <port>` to
change it. When started alongside other services, ports are assigned
sequentially from the base port (asana's slot is `4005`).

Default URL (asana alone):

```text
http://localhost:4000
```

## Auth

All `/api/1.0/*` routes require a bearer token. Any token works — an unmatched
token resolves to the first seeded user, so `me` keywords work out of the box.

```bash
curl http://localhost:4000/api/1.0/users/me \
  -H "Authorization: Bearer test-token"
```

Map specific tokens to users via the top-level `tokens` key in the config:

```yaml
tokens:
  test-token:
    login: dev@example.com # matches a seeded user's email, gid, or name
    scopes: []
```

## Conventions

- Write bodies are wrapped in `data`: `{"data": {"name": "My Task"}}`.
- Successful responses are wrapped in `data`; lists add a `next_page` cursor.
- Errors return `{"errors": [{"message": "..."}]}`.

## Example

```bash
# Create a task (assigned to the authenticated user)
curl -X POST http://localhost:4000/api/1.0/tasks \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"Write the README","projects":["<project_gid>"],"assignee":"me"}}'

# List tasks in a project
curl "http://localhost:4000/api/1.0/tasks?project=<project_gid>&limit=50" \
  -H "Authorization: Bearer test-token"
```

## Seed Config

Add an `asana:` section to `emulate.config.yaml` (or pass `--seed <file>`).
Inter-entity references are resolved by name; the workspace defaults to the
first one when omitted.

```yaml
asana:
  workspaces:
    - name: My Workspace
      is_organization: true
  users:
    - name: Developer
      email: dev@example.com
  teams:
    - name: Engineering
      workspace: My Workspace
  projects:
    - name: My Project
      workspace: My Workspace
      team: Engineering
      owner: Developer
  sections:
    - name: To Do
      project: My Project
  tags:
    - name: urgent
      workspace: My Workspace
      color: red
  tasks:
    - name: Example Task
      project: My Project
      section: To Do
      assignee: Developer
      due_on: 2026-01-31
```
