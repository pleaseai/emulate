# @pleaseai/emulate-jira

Stateful Jira Cloud REST API emulator for local development and CI.

Ported from the upstream [vercel-labs/emulate](https://github.com/vercel-labs/emulate) Jira emulator (PR #284).

## Install

```bash
npm install @pleaseai/emulate-jira
```

Usually you do not install this directly — run it through the `@pleaseai/emulate` CLI.

## Start

```bash
# Through the emulate CLI
npx @pleaseai/emulate --service jira

# From the monorepo (after `bun install && bun run build`)
bun packages/emulate/dist/index.js --service jira
```

Jira is the last service in the list, so it listens on port `4013` when all services run together. A single service starts on the base port (default `4000`); use `-p <port>` to change it.

## Supported Surface

- Jira platform REST API v3 and v2 under `/rest/api/3` and `/rest/api/2`. v3 bodies use Atlassian Document Format and v2 bodies use plain strings.
- Issues: create, bulk create, read with `fields` and `expand`, edit with `fields` and `update` operations, delete, assign, transitions, changelog, create and edit metadata.
- Comments, watchers, worklogs, and issue links.
- JQL search through `/search/jql` (with `nextPageToken`), `/search/approximate-count`, the legacy `/search`, and the issue picker. The JQL engine supports boolean logic, list and empty operators, text search, date math, `ORDER BY`, and common functions such as `currentUser()`, `openSprints()`, and `linkedIssues()`.
- Projects, components, versions, users, issue types, statuses, priorities, resolutions, fields, labels, and permissions.
- Jira Software Agile API under `/rest/agile/1.0` and `/rest/software/1.0`: boards, backlog, sprints and the sprint lifecycle, epics.
- Admin webhooks (`/rest/webhooks/1.0/webhook`) with JQL filters and `X-Hub-Signature` signing, plus dynamic webhooks for OAuth apps.
- Atlassian OAuth 2.0 (3LO): consent screen, authorization code and rotating refresh tokens, accessible resources, `/me`, and the `/ex/jira/{cloudId}` gateway path.
- Basic auth with `email:api_token`, and bearer API or OAuth tokens.
- Jira shaped errors: `{ "errorMessages": [], "errors": {} }`.
- Local inspector at `/` and issue pages at `/browse/{issueKey}`.

Default credentials: `admin@jira.local` / `jira_test_token`.

Conformance is checked against [jira.js](https://github.com/MrRefactoring/jira.js) with response schema validation enabled.

This is not a complete Jira clone. Attachments, filters, dashboards, workflow and permission scheme administration, groups, and Jira Service Management are not implemented.

## Auth

```bash
curl http://localhost:4000/rest/api/3/myself \
  -u admin@jira.local:jira_test_token
```

## Seed Config

```yaml
jira:
  site:
    name: acme
  users:
    - email: admin@example.com
      display_name: Admin User
      admin: true
      api_token: jira_test_token
  projects:
    - key: ENG
      name: Engineering
      lead: admin@example.com
      statuses: [To Do, In Progress, In Review, Done]
  issues:
    - project: ENG
      summary: Fix local checkout test
      type: Bug
      status: To Do
      priority: High
  oauth_apps:
    - client_id: jira_example_client_id
      client_secret: example_client_secret
      name: My Jira App
      redirect_uris:
        - http://localhost:3000/api/auth/callback/atlassian
```
