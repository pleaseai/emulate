import type { JiraTestApp } from './helpers.js'
import { beforeEach, describe, expect, it } from 'bun:test'
import { getJiraStore, seedFromConfig } from '../index.js'
import { api, basicAuth, createJiraTestApp, jiraTestBaseUrl } from './helpers.js'

describe('seedFromConfig', () => {
  let t: JiraTestApp

  beforeEach(() => {
    t = createJiraTestApp()
    seedFromConfig(t.store, jiraTestBaseUrl, {
      site: { name: 'acme' },
      users: [
        { email: 'alice@example.com', display_name: 'Alice', admin: true, api_token: 'alice_token' },
        { email: 'bob@example.com', display_name: 'Bob' },
      ],
      statuses: [{ name: 'In Review', category: 'indeterminate' }],
      custom_fields: [{ id: 'customfield_10050', name: 'Team', type: 'option', options: ['Red', 'Blue'] }],
      projects: [
        {
          key: 'WEB',
          name: 'Website',
          lead: 'alice@example.com',
          statuses: ['To Do', 'In Progress', 'In Review', 'Done'],
          components: ['Frontend'],
          versions: [{ name: '2.0', released: false }],
        },
      ],
      sprints: [{ project: 'WEB', name: 'WEB Sprint 1', state: 'active' }],
      issues: [
        {
          project: 'WEB',
          summary: 'Build landing page',
          type: 'Story',
          description: 'Hero and pricing',
          status: 'In Review',
          priority: 'High',
          assignee: 'bob@example.com',
          reporter: 'alice@example.com',
          labels: ['marketing'],
          components: ['Frontend'],
          fix_versions: ['2.0'],
          sprint: 'WEB Sprint 1',
          custom_fields: { customfield_10050: 'Red' },
          comments: [{ body: 'Looks great', author: 'alice@example.com' }],
        },
        { project: 'WEB', summary: 'Fix footer', type: 'Bug', status: 'Done', parent: undefined },
        { project: 'WEB', summary: 'Footer subtask', type: 'Subtask', parent: 'Fix footer' },
      ],
      links: [{ type: 'Relates', inward: 'Build landing page', outward: 'Fix footer' }],
      webhooks: [
        { name: 'Seeded', url: 'https://example.test/hook', events: ['jira:issue_created'], jql: 'project = WEB' },
      ],
      oauth_apps: [
        { client_id: 'acme_app', client_secret: 'acme_secret', name: 'Acme', redirect_uris: ['http://localhost/cb'] },
      ],
    })
  })

  it('creates users with API tokens that can authenticate', async () => {
    const res = await api(t.app, '/rest/api/3/myself', { auth: basicAuth('alice@example.com', 'alice_token') })
    expect(res.status).toBe(200)
    expect(res.json.displayName).toBe('Alice')
  })

  it('creates projects with custom workflows, components, versions, and a board', async () => {
    const project = await api(t.app, '/rest/api/3/project/WEB')
    expect(project.json.lead.emailAddress).toBe('alice@example.com')
    expect(project.json.components.map((c: any) => c.name)).toEqual(['Frontend'])
    expect(project.json.versions.map((v: any) => v.name)).toEqual(['2.0'])
    const statuses = await api(t.app, '/rest/api/3/project/WEB/statuses')
    expect(statuses.json[0].statuses.map((s: any) => s.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Done'])
    const boards = await api(t.app, '/rest/agile/1.0/board?projectKeyOrId=WEB')
    expect(boards.json.values[0].name).toBe('WEB board')
  })

  it('creates issues with every seeded relation', async () => {
    const issue = (await api(t.app, '/rest/api/3/issue/WEB-1')).json
    expect(issue.fields.summary).toBe('Build landing page')
    expect(issue.fields.issuetype.name).toBe('Story')
    expect(issue.fields.status.name).toBe('In Review')
    expect(issue.fields.priority.name).toBe('High')
    expect(issue.fields.assignee.emailAddress).toBe('bob@example.com')
    expect(issue.fields.reporter.emailAddress).toBe('alice@example.com')
    expect(issue.fields.description.content[0].content[0].text).toBe('Hero and pricing')
    expect(issue.fields.components[0].name).toBe('Frontend')
    expect(issue.fields.fixVersions[0].name).toBe('2.0')
    expect(issue.fields.customfield_10020[0].name).toBe('WEB Sprint 1')
    expect(issue.fields.customfield_10050.value).toBe('Red')
    expect(issue.fields.comment.comments[0].author.emailAddress).toBe('alice@example.com')
    expect(issue.fields.issuelinks[0].inwardIssue.key).toBe('WEB-2')

    const done = (await api(t.app, '/rest/api/3/issue/WEB-2')).json
    expect(done.fields.status.name).toBe('Done')
    expect(done.fields.resolution.name).toBe('Done')
    expect(done.fields.subtasks[0].key).toBe('WEB-3')
  })

  it('is idempotent', async () => {
    seedFromConfig(t.store, jiraTestBaseUrl, {
      projects: [{ key: 'WEB', name: 'Website' }],
      issues: [{ project: 'WEB', summary: 'Build landing page' }],
    })
    const js = getJiraStore(t.store)
    expect(js.projects.all().filter(p => p.key === 'WEB')).toHaveLength(1)
    expect(js.issues.all().filter(i => i.summary === 'Build landing page')).toHaveLength(1)
  })

  it('seeds webhooks, OAuth apps, and site name', async () => {
    const js = getJiraStore(t.store)
    expect(js.webhooks.all()[0]).toMatchObject({ name: 'Seeded', jql_filter: 'project = WEB', kind: 'admin' })
    expect(js.oauthApps.findOneBy('client_id', 'acme_app')?.name).toBe('Acme')
    expect(js.sites.all()[0].name).toBe('acme')
  })

  it('seeds issues into closed sprints as sprint history', async () => {
    seedFromConfig(t.store, jiraTestBaseUrl, {
      sprints: [{ project: 'WEB', name: 'WEB Sprint 0', state: 'closed' }],
      issues: [{ project: 'WEB', summary: 'Old work', status: 'Done', sprint: 'WEB Sprint 0' }],
    })
    const search = await api(t.app, '/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql: 'sprint = "WEB Sprint 0"', fields: ['customfield_10020'] },
    })
    expect(search.json.issues).toHaveLength(1)
    expect(search.json.issues[0].fields.customfield_10020[0].state).toBe('closed')
  })

  it('lets config toggle strict scopes', () => {
    seedFromConfig(t.store, jiraTestBaseUrl, { strict_scopes: true })
    expect(t.store.getData('jira.strict_scopes')).toBe(true)
  })
})

describe('inspector and browse pages', () => {
  let t: JiraTestApp

  beforeEach(() => {
    t = createJiraTestApp()
  })

  it('renders the inspector with issue, project, and auth tabs', async () => {
    const res = await t.app.request(`${jiraTestBaseUrl}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Jira Inspector')
    expect(html).toContain('EMU-1')
    expect(html).toContain('Ship Jira emulator')

    for (const tab of ['projects', 'boards', 'users', 'webhooks', 'auth']) {
      const page = await t.app.request(`${jiraTestBaseUrl}/?tab=${tab}`)
      expect(page.status).toBe(200)
    }
    const auth = await (await t.app.request(`${jiraTestBaseUrl}/?tab=auth`)).text()
    expect(auth).toContain('admin@jira.local')
    expect(auth).toContain('jira_example_client_id')
    expect(auth).not.toContain('jira_test_token')
    expect(auth).not.toContain('example_client_secret')
  })

  it('escapes user content in the inspector', async () => {
    await api(t.app, '/rest/api/3/issue/EMU-1', {
      method: 'PUT',
      body: { fields: { summary: '<script>alert(1)</script>' } },
    })
    const html = await (await t.app.request(`${jiraTestBaseUrl}/`)).text()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders an issue page at /browse/:key', async () => {
    const res = await t.app.request(`${jiraTestBaseUrl}/browse/EMU-1`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Ship Jira emulator')
    expect(html).toContain('To Do')
    expect((await t.app.request(`${jiraTestBaseUrl}/browse/EMU-404`)).status).toBe(404)
  })

  it('escapes the issue summary in the browse page title exactly once', async () => {
    await api(t.app, '/rest/api/3/issue/EMU-1', { method: 'PUT', body: { fields: { summary: '<img src=x onerror=alert(1)>' } } })
    const html = await (await t.app.request(`${jiraTestBaseUrl}/browse/EMU-1`)).text()
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('EMU-1: &lt;img src=x onerror=alert(1)&gt;')
  })

  it('applies configured values to an already seeded project', () => {
    const t2 = createJiraTestApp()
    seedFromConfig(t2.store, jiraTestBaseUrl, {
      projects: [{ key: 'EMU', name: 'Renamed', statuses: ['To Do', 'In Review', 'Done'] }],
    })
    const js = getJiraStore(t2.store)
    const project = js.projects.findOneBy('key', 'EMU')!
    expect(project.name).toBe('Renamed')
    const names = project.status_ids.map(id => js.statuses.get(id)!.name)
    expect(names).toEqual(['To Do', 'In Review', 'Done'])
    expect(project.lead_account_id).not.toBeNull()
  })

  it('removes the default board when an existing project sets board: false', () => {
    const t2 = createJiraTestApp()
    seedFromConfig(t2.store, jiraTestBaseUrl, { projects: [{ key: 'EMU', name: 'Emulate', board: false }] })
    const js = getJiraStore(t2.store)
    expect(js.boards.findBy('project_id', js.projects.findOneBy('key', 'EMU')!.id)).toEqual([])
    expect(js.sprints.all()).toEqual([])
    expect(js.issues.all()[0].sprint_id).toBeNull()
    seedFromConfig(t2.store, jiraTestBaseUrl, { projects: [{ key: 'EMU', name: 'Emulate', board: true }] })
    expect(js.boards.all()).toHaveLength(1)
  })

  it('resolves seeded sprint names within the issue project', () => {
    const t2 = createJiraTestApp()
    seedFromConfig(t2.store, jiraTestBaseUrl, {
      projects: [{ key: 'WEB', name: 'Website' }],
      sprints: [
        { project: 'EMU', name: 'Sprint 1', state: 'active' },
        { project: 'WEB', name: 'Sprint 1', state: 'active' },
      ],
      issues: [{ project: 'WEB', summary: 'Web work', sprint: 'Sprint 1' }],
    })
    const js = getJiraStore(t2.store)
    const issue = js.issues.all().find(i => i.summary === 'Web work')!
    const sprint = js.sprints.get(issue.sprint_id!)!
    expect(js.boards.get(sprint.board_id)!.project_id).toBe(issue.project_id)
  })

  it('ignores non-numeric custom field ids when generating ids', () => {
    const t2 = createJiraTestApp()
    seedFromConfig(t2.store, jiraTestBaseUrl, {
      custom_fields: [
        { id: 'team', name: 'TeamX', type: 'string' },
        { name: 'Auto1', type: 'string' },
        { name: 'Auto2', type: 'string' },
      ],
    })
    const ids = getJiraStore(t2.store).customFields.all().map(f => f.field_id)
    expect(ids.some(id => id.includes('NaN'))).toBe(false)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('seedFromConfig default users', () => {
  it('applies configured account ids and time zones to default users and migrates references', async () => {
    const t = createJiraTestApp()
    const js = getJiraStore(t.store)
    const before = js.users.findOneBy('email', 'admin@jira.local')!.account_id
    seedFromConfig(t.store, jiraTestBaseUrl, {
      users: [{ email: 'admin@jira.local', account_id: 'custom-admin', time_zone: 'Asia/Seoul' }],
    })
    const admin = js.users.findOneBy('email', 'admin@jira.local')!
    expect(admin.account_id).toBe('custom-admin')
    expect(admin.time_zone).toBe('Asia/Seoul')
    expect(js.users.findOneBy('account_id', before)).toBeUndefined()
    expect(js.apiTokens.findOneBy('token', 'jira_test_token')!.account_id).toBe('custom-admin')
    const issue = js.issues.all()[0]
    expect(issue.reporter_id).toBe('custom-admin')
    expect(issue.creator_id).toBe('custom-admin')
    expect(issue.watcher_ids).toContain('custom-admin')
    expect(js.comments.all()[0].author_id).toBe('custom-admin')
    expect(js.projects.findOneBy('key', 'EMU')!.lead_account_id).toBe('custom-admin')
    const res = await api(t.app, '/rest/api/3/myself')
    expect(res.json.accountId).toBe('custom-admin')
  })

  it('migrates only user-valued changelog items and applies empty display names', () => {
    const t = createJiraTestApp()
    const js = getJiraStore(t.store)
    const before = js.users.findOneBy('email', 'admin@jira.local')!.account_id
    const item = (fieldId: string) => ({
      field: fieldId,
      fieldtype: 'jira' as const,
      fieldId,
      from: before,
      fromString: null,
      to: null,
      toString: null,
    })
    const entry = js.changelogs.insert({ issue_id: js.issues.all()[0].id, author_id: before, items: [item('assignee'), item('summary')] })
    seedFromConfig(t.store, jiraTestBaseUrl, {
      users: [{ email: 'admin@jira.local', account_id: 'custom-admin', display_name: '' }],
    })
    const [assignee, summary] = js.changelogs.get(entry.id)!.items
    expect(assignee.from).toBe('custom-admin')
    expect(summary.from).toBe(before)
    expect(js.users.findOneBy('email', 'admin@jira.local')!.display_name).toBe('')
  })
})
