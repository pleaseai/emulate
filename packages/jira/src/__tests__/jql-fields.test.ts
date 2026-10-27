import type { JiraStore } from '../index.js'
import type { JiraTestApp } from './helpers.js'
import { beforeEach, describe, expect, it } from 'bun:test'
import { getJiraStore } from '../index.js'
import { JqlError, searchIssues } from '../jql.js'
import { adf, api, createJiraTestApp } from './helpers.js'

describe('JQL system field handlers', () => {
  let t: JiraTestApp
  let js: JiraStore

  const keys = (jql: string) => {
    const user = js.users.findOneBy('email', 'admin@jira.local')!
    return searchIssues(js, jql, user).map(issue => issue.key)
  }

  const create = async (fields: Record<string, unknown>) =>
    (
      await api(t.app, '/rest/api/3/issue', {
        method: 'POST',
        body: { fields: { project: { key: 'EMU' }, issuetype: { name: 'Task' }, ...fields } },
      })
    ).json.key as string

  beforeEach(() => {
    t = createJiraTestApp()
    js = getJiraStore(t.store)
  })

  it('searches time tracking, worklog, link, and subtask fields', async () => {
    const parent = await create({ summary: 'Parent' })
    const child = await create({ summary: 'Child', issuetype: { name: 'Subtask' }, parent: { key: parent } })
    await api(t.app, `/rest/api/3/issue/${parent}/worklog`, {
      method: 'POST',
      body: { timeSpentSeconds: 3600, comment: adf('Pairing session'), started: '2026-10-15T10:00:00.000+0000' },
    })
    await api(t.app, `/rest/api/3/issue/${child}/worklog`, { method: 'POST', body: { timeSpentSeconds: 1800 } })
    await api(t.app, '/rest/api/3/issueLink', {
      method: 'POST',
      body: { type: { name: 'Relates' }, inwardIssue: { key: 'EMU-1' }, outwardIssue: { key: parent } },
    })

    expect(keys('timespent = 3600')).toEqual([parent])
    expect(keys('aggregatetimespent = 5400')).toEqual([parent])
    expect(keys('timespent is EMPTY AND key = EMU-1')).toEqual(['EMU-1'])
    expect(keys('worklogComment ~ "pairing"')).toEqual([parent])
    expect(keys('worklogDate = "2026-10-15"')).toEqual([parent])
    expect(keys('issueLink = EMU-1')).toEqual([parent])
    expect(keys(`subtasks = ${child}`)).toEqual([parent])
    expect(keys('votes = 0 AND workratio = -1 AND key = EMU-1')).toEqual(['EMU-1'])
    expect(() => keys('lastViewed > -1d')).toThrow(JqlError)
  })

  it('reports lastViewed as not searchable', async () => {
    const res = await api(t.app, '/rest/api/3/field')
    expect(res.json.find((f: any) => f.id === 'lastViewed').searchable).toBe(false)
  })

  it('rejects unknown projects in version functions', async () => {
    await api(t.app, '/rest/api/3/version', { method: 'POST', body: { name: '1.0', project: 'EMU', released: true } })
    expect(() => keys('fixVersion in releasedVersions(NOPE)')).toThrow(/NOPE/)
    expect(() => keys('fixVersion in unreleasedVersions(NOPE)')).toThrow(JqlError)
    expect(() => keys('fixVersion in releasedVersions(EMU)')).not.toThrow()
  })

  it('applies day precision only to bare-date IN operands', async () => {
    const day = await create({ summary: 'Day' })
    const exact = await create({ summary: 'Exact' })
    const near = await create({ summary: 'Near' })
    const at = (key: string, iso: string) => js.issues.update(js.issues.findOneBy('key', key)!.id, { created_at: iso })
    at(day, '2026-10-15T10:00:00.000Z')
    at(exact, '2026-10-16T09:00:00.000Z')
    at(near, '2026-10-16T08:00:00.000Z')
    expect(keys('created in ("2026-10-15", "2026-10-16 09:00") ORDER BY key')).toEqual([day, exact])
  })

  it('matches pathological wildcard patterns in bounded time', async () => {
    const key = await create({ summary: 'a'.repeat(200) })
    const started = performance.now()
    expect(keys('summary ~ "a*a*a*a*a*a*a*a*a*a*a*a*b"')).toEqual([])
    expect(keys('summary ~ "a*a*a*a*a*a*a*a*a*a*a*a*a"')).toEqual([key])
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('looks up numeric names that are not entity ids', async () => {
    js.priorities.insert({ name: '42', description: '', color: '#000000' })
    const edit = await api(t.app, '/rest/api/3/issue/EMU-1', { method: 'PUT', body: { fields: { priority: { name: '42' } } } })
    expect(edit.status).toBe(204)
    expect((await api(t.app, '/rest/api/3/issue/EMU-1')).json.fields.priority.name).toBe('42')
  })
})
