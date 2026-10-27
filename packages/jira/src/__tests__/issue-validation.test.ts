import type { JiraTestApp } from './helpers.js'
import { beforeEach, describe, expect, it } from 'bun:test'
import { DEFAULT_DEV_EMAIL, getJiraStore } from '../index.js'
import { api, createJiraTestApp } from './helpers.js'

async function createIssue(t: JiraTestApp, fields: Record<string, unknown>) {
  return api(t.app, '/rest/api/3/issue', {
    method: 'POST',
    body: { fields: { project: { key: 'EMU' }, issuetype: { name: 'Task' }, ...fields } },
  })
}

describe('Jira issue validation', () => {
  let t: JiraTestApp
  let devId: string

  beforeEach(() => {
    t = createJiraTestApp()
    devId = getJiraStore(t.store).users.findOneBy('email', DEFAULT_DEV_EMAIL)!.account_id
  })

  describe('field validation', () => {
    it('rejects impossible calendar dates for duedate and custom date fields', async () => {
      expect((await createIssue(t, { summary: 'x', duedate: '2024-02-31' })).status).toBe(400)
      expect((await createIssue(t, { summary: 'x', customfield_10015: '2026-02-30' })).status).toBe(400)
      expect((await createIssue(t, { summary: 'x', duedate: '2024-02-29' })).status).toBe(201)
    })

    it('rejects non-string labels instead of coercing them', async () => {
      const res = await createIssue(t, { summary: 'x', labels: ['ok', 1] })
      expect(res.status).toBe(400)
      expect(res.json.errors.labels).toBeTruthy()
    })

    it('rejects malformed user references but unassigns on null', async () => {
      for (const assignee of [{}, false, { accountId: 7 }]) {
        const res = await api(t.app, '/rest/api/3/issue/EMU-1', { method: 'PUT', body: { fields: { assignee } } })
        expect(res.status).toBe(400)
      }
      expect((await api(t.app, '/rest/api/3/issue/EMU-1')).json.fields.assignee.accountId).toBe(devId)
      const cleared = await api(t.app, '/rest/api/3/issue/EMU-1', { method: 'PUT', body: { fields: { assignee: null } } })
      expect(cleared.status).toBe(204)
      expect((await api(t.app, '/rest/api/3/issue/EMU-1')).json.fields.assignee).toBeNull()
    })

    it('rejects update entries that combine several operations', async () => {
      const res = await api(t.app, '/rest/api/3/issue/EMU-1', {
        method: 'PUT',
        body: { update: { labels: [{ add: 'one', remove: 'emulate' }] } },
      })
      expect(res.status).toBe(400)
      expect((await api(t.app, '/rest/api/3/issue/EMU-1')).json.fields.labels).toEqual(['emulate'])
    })

    it('resolves scalar component values by name', async () => {
      await api(t.app, '/rest/api/3/component', { method: 'POST', body: { project: 'EMU', name: 'API' } })
      const res = await createIssue(t, { summary: 'x', components: ['API'] })
      expect(res.status).toBe(201)
      expect((await api(t.app, `/rest/api/3/issue/${res.json.key}`)).json.fields.components[0].name).toBe('API')
    })

    it('rejects bulk creates without an issueUpdates array', async () => {
      for (const body of [{}, { issueUpdates: 'nope' }]) {
        const res = await api(t.app, '/rest/api/3/issue/bulk', { method: 'POST', body })
        expect(res.status).toBe(400)
      }
    })

    it('does not render unsafe link schemes as anchors', async () => {
      const description = {
        type: 'doc',
        version: 1,
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'java\tscript:alert(1)' } }] },
            { type: 'text', text: 'good', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          ],
        }],
      }
      const created = await createIssue(t, { summary: 'links', description })
      const html = (await api(t.app, `/rest/api/3/issue/${created.json.key}?expand=renderedFields`)).json.renderedFields.description
      expect(html).not.toContain('script:')
      expect(html).toContain('<a href="https://example.com">good</a>')
    })
  })

  describe('review regressions', () => {
    it('rejects null update operations with 400', async () => {
      const res = await api(t.app, '/rest/api/3/issue/EMU-1', { method: 'PUT', body: { update: { labels: [null] } } })
      expect(res.status).toBe(400)
    })

    it('leaves resolution date empty when a done transition clears the resolution', async () => {
      const done = (await api(t.app, '/rest/api/3/issue/EMU-1/transitions')).json.transitions.find(
        (tr: any) => tr.name === 'Done',
      )
      const move = await api(t.app, '/rest/api/3/issue/EMU-1/transitions', {
        method: 'POST',
        body: { transition: { id: done.id }, fields: { resolution: null } },
      })
      expect(move.status).toBe(204)
      const issue = (await api(t.app, '/rest/api/3/issue/EMU-1')).json
      expect(issue.fields.resolution).toBeNull()
      expect(issue.fields.resolutiondate).toBeNull()
    })

    it('rejects empty comments supplied through update operations', async () => {
      for (const comment of [{ add: {} }, { add: { body: null } }]) {
        const edit = await api(t.app, '/rest/api/3/issue/EMU-1', { method: 'PUT', body: { update: { comment: [comment] } } })
        expect(edit.status).toBe(400)
        const bad = await api(t.app, '/rest/api/3/issue', {
          method: 'POST',
          body: {
            fields: { project: { key: 'EMU' }, issuetype: { name: 'Task' }, summary: 'x' },
            update: { comment: [comment] },
          },
        })
        expect(bad.status).toBe(400)
      }
      const issue = (await api(t.app, '/rest/api/3/issue/EMU-1')).json
      expect(issue.fields.comment.comments.every((c: any) => c.body)).toBe(true)
    })

    it('keeps an explicit null resolution set through update operations on a done transition', async () => {
      const done = (await api(t.app, '/rest/api/3/issue/EMU-1/transitions')).json.transitions.find(
        (tr: any) => tr.name === 'Done',
      )
      const move = await api(t.app, '/rest/api/3/issue/EMU-1/transitions', {
        method: 'POST',
        body: { transition: { id: done.id }, update: { resolution: [{ set: null }] } },
      })
      expect(move.status).toBe(204)
      const issue = (await api(t.app, '/rest/api/3/issue/EMU-1')).json
      expect(issue.fields.resolution).toBeNull()
      expect(issue.fields.resolutiondate).toBeNull()
    })

    it('rejects issue type changes that invalidate existing children', async () => {
      const task = (await createIssue(t, { summary: 'Parent task' })).json
      const sub = await createIssue(t, { summary: 'Child', issuetype: { name: 'Subtask' }, parent: { key: task.key } })
      expect(sub.status).toBe(201)
      const res = await api(t.app, `/rest/api/3/issue/${task.key}`, {
        method: 'PUT',
        body: { fields: { issuetype: { name: 'Epic' } } },
      })
      expect(res.status).toBe(400)
      expect(res.json.errors.issuetype).toBeTruthy()
      const after = (await api(t.app, `/rest/api/3/issue/${task.key}`)).json
      expect(after.fields.issuetype.name).toBe('Task')
    })

    it('rejects malformed nested ADF on write', async () => {
      const bad = { type: 'doc', version: 1, content: [null] }
      const res = await createIssue(t, { summary: 'Bad ADF', description: bad })
      expect(res.status).toBe(400)
      const edit = await api(t.app, '/rest/api/3/issue/EMU-1', { method: 'PUT', body: { fields: { description: bad } } })
      expect(edit.status).toBe(400)
      const typeless = await createIssue(t, { summary: 'Bad ADF', description: { type: 'doc', version: 1, content: [{ text: 'x' }] } })
      expect(typeless.status).toBe(400)
      expect((await api(t.app, '/rest/api/2/issue/EMU-1')).status).toBe(200)
    })

    it('rejects non-object JSON bodies with 400 but keeps string watcher bodies', async () => {
      for (const raw of ['null', '5', '[]', '"x"']) {
        const res = await api(t.app, '/rest/api/3/search/jql', { method: 'POST', body: raw })
        expect(res.status).toBe(400)
      }
      const watch = await api(t.app, '/rest/api/3/issue/EMU-1/watchers', { method: 'POST', body: JSON.stringify(devId) })
      expect(watch.status).toBe(204)
    })
  })
})
