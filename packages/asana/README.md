# @pleaseai/emulate-asana

Asana REST API (v1.0) emulator for local development and CI.

A stateful, in-memory implementation of the Asana API surface — no network and
no real Asana account required. It covers users, workspaces, teams, projects,
sections, tasks, tags, stories, and webhooks, including subtasks, dependencies,
followers, project/section membership, and offset-based pagination.

OAuth 2.0 and an inspector UI are follow-up work.

## Install

```bash
npm install @pleaseai/emulate-asana
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
# Through the emulate CLI (asana listens on its default port 4005)
bun packages/emulate/dist/index.js --service asana

# Start every service
bun packages/emulate/dist/index.js
```

A single service starts on the base port (default `4000`); when started with
`--service asana` it runs on port `4005`. Use `-p <port>` to change it.

## Auth

All `/api/1.0/*` routes are guarded by bearer-token auth. Send any token via the
`Authorization` header — by default an unmatched token resolves to the first
seeded user, so `me` keywords (`assignee=me`, `GET /users/me`) work out of the box:

```bash
curl http://localhost:4005/api/1.0/users/me \
  -H "Authorization: Bearer test-token"
```

To map specific tokens to specific users, set them under the top-level `tokens`
key in your config:

```yaml
tokens:
  test-token:
    login: dev@example.com   # matches a seeded user's email, gid, or name
    scopes: []
```

## Request & response shape

The emulator follows Asana's envelope conventions:

- Write bodies are wrapped in `data`: `{"data": {"name": "My Task"}}` (a bare
  object is also accepted).
- Successful responses are wrapped in `data`; list responses include a
  `next_page` cursor (`{ offset, path, uri }` or `null`).
- Errors return `{"errors": [{"message": "..."}]}` with the matching HTTP status.
- Lists accept `limit` (1–100, default 20) and `offset` for pagination.

```bash
# Create a task
curl -X POST http://localhost:4005/api/1.0/tasks \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"Write the README","projects":["<project_gid>"],"assignee":"me"}}'

# List tasks in a project
curl "http://localhost:4005/api/1.0/tasks?project=<project_gid>&limit=50" \
  -H "Authorization: Bearer test-token"
```

## Emulated endpoints

| Resource | Endpoints |
| --- | --- |
| Users | `GET /users`, `GET /users/:gid` (incl. `me`) |
| Workspaces | `GET /workspaces`, `GET/PUT /workspaces/:gid` |
| Teams | `POST /teams`, `GET /teams/:gid`, `GET /workspaces/:gid/teams`, `GET /teams/:gid/users`, `GET /teams/:gid/projects`, `POST /teams/:gid/addUser`, `POST /teams/:gid/removeUser` |
| Projects | `GET/POST /projects`, `GET/PUT/DELETE /projects/:gid`, `GET /projects/:gid/tasks`, `GET /projects/:gid/sections`, `GET /projects/:gid/task_counts` |
| Sections | `POST /projects/:gid/sections`, `GET/PUT/DELETE /sections/:gid`, `GET /sections/:gid/tasks`, `POST /sections/:gid/addTask` |
| Tasks | `GET/POST /tasks`, `GET/PUT/DELETE /tasks/:gid`, subtasks, stories, tags, projects, dependencies/dependents, `addProject`/`removeProject`, `addTag`/`removeTag`, `addDependencies`/`removeDependencies`, `addFollowers`/`removeFollowers`, `setParent` |
| Tags | `GET/POST /tags`, `GET/PUT/DELETE /tags/:gid`, `GET /tags/:gid/tasks`, `GET/POST /workspaces/:gid/tags` |
| Stories | `GET/PUT/DELETE /stories/:gid` (comments created via `POST /tasks/:gid/stories`) |
| Webhooks | `GET/POST /webhooks`, `GET/PUT/DELETE /webhooks/:gid` |

## Seed config

Seed data lets the emulator start pre-populated. References between entities are
resolved by name (e.g. a project's `team` points at a team's `name`); a
workspace defaults to the first one when omitted.

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
      default_view: board
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

Without any seed config, the plugin seeds a single `My Workspace` so the
emulator is usable immediately.

## Programmatic use

```ts
import { authMiddleware, Hono, Store, WebhookDispatcher } from '@emulators/core'
import { asanaPlugin, seedFromConfig } from '@pleaseai/emulate-asana'

const store = new Store()
const webhooks = new WebhookDispatcher()
const baseUrl = 'http://localhost:4005'

const app = new Hono()
app.use('*', authMiddleware(/* tokenMap */))
asanaPlugin.register(app, store, webhooks, baseUrl)
asanaPlugin.seed?.(store, baseUrl)

seedFromConfig(store, baseUrl, {
  workspaces: [{ name: 'My Workspace', is_organization: true }],
  users: [{ name: 'Developer', email: 'dev@example.com' }],
})
```

`getAsanaStore(store)` exposes the typed collections (`users`, `workspaces`,
`tasks`, …) for direct inspection in tests.

## License

Apache-2.0
