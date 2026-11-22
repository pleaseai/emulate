import type { AsanaSeedConfig } from '../index.js'
import { authMiddleware, Hono, Store, WebhookDispatcher } from '@emulators/core'
import { beforeEach, describe, expect, it } from 'bun:test'
import { asanaPlugin, getAsanaStore, seedFromConfig } from '../index.js'

const base = 'http://localhost:4000'
const api = `${base}/api/1.0`
const headers = { 'Authorization': 'Bearer test-token', 'Content-Type': 'application/json' }

function createApp(extra: AsanaSeedConfig = {}) {
  const store = new Store()
  const app = new Hono()
  app.use('*', authMiddleware(new Map([['test-token', { login: 'dev@example.com', id: 1, scopes: [] }]])))
  asanaPlugin.register(app as any, store, new WebhookDispatcher(), base)
  seedFromConfig(store, base, {
    workspaces: [{ name: 'WS' }],
    users: [{ name: 'Developer', email: 'dev@example.com' }],
    projects: [{ name: 'Alpha', workspace: 'WS' }, { name: 'Beta', workspace: 'WS' }],
    ...extra,
  })
  const as = getAsanaStore(store)
  const project = (name: string) => as.projects.all().find(p => p.name === name)!.gid
  return { app, store, workspaceGid: as.workspaces.all()[0].gid, project }
}

async function call(app: Hono, method: string, path: string, data?: unknown) {
  const res = await app.request(`${api}${path}`, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify({ data }),
  })
  return { status: res.status, body: await res.json() as any }
}

describe('Asana - Custom fields', () => {
  let ctx: ReturnType<typeof createApp>
  let fieldGid: string

  beforeEach(async () => {
    ctx = createApp()
    const created = await call(ctx.app, 'POST', '/custom_fields', { workspace: ctx.workspaceGid, name: 'External ID', resource_subtype: 'text' })
    expect(created.status).toBe(201)
    fieldGid = created.body.data.gid
  })

  it('creates a text field and lists it in the workspace with paging', async () => {
    await call(ctx.app, 'POST', '/custom_fields', { workspace: ctx.workspaceGid, name: 'Second', resource_subtype: 'text' })

    const page = await call(ctx.app, 'GET', `/workspaces/${ctx.workspaceGid}/custom_fields?limit=1`)
    expect(page.status).toBe(200)
    expect(page.body.data).toEqual([expect.objectContaining({ gid: fieldGid, resource_type: 'custom_field', name: 'External ID', resource_subtype: 'text' })])
    expect(page.body.next_page.offset).toBe('1')
  })

  it('rejects a field subtype other than text', async () => {
    const res = await call(ctx.app, 'POST', '/custom_fields', { workspace: ctx.workspaceGid, name: 'Points', resource_subtype: 'number' })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].message).toContain('text')
  })

  it('attaches a field to a project and lists the setting', async () => {
    const added = await call(ctx.app, 'POST', `/projects/${ctx.project('Alpha')}/addCustomFieldSetting`, { custom_field: fieldGid })
    expect(added.status).toBe(200)

    const list = await call(ctx.app, 'GET', `/projects/${ctx.project('Alpha')}/custom_field_settings`)
    expect(list.body.data).toEqual([expect.objectContaining({
      gid: added.body.data.gid,
      custom_field: expect.objectContaining({ gid: fieldGid, name: 'External ID', resource_subtype: 'text' }),
    })])
    expect(list.body.next_page).toBeNull()
  })

  it('stores text values on task create and update and returns them on the task', async () => {
    await call(ctx.app, 'POST', `/projects/${ctx.project('Alpha')}/addCustomFieldSetting`, { custom_field: fieldGid })

    const created = await call(ctx.app, 'POST', '/tasks', { name: 'T', projects: [ctx.project('Alpha')], custom_fields: { [fieldGid]: 'ext-1' } })
    expect(created.status).toBe(201)
    expect(created.body.data.custom_fields).toEqual([expect.objectContaining({ gid: fieldGid, name: 'External ID', resource_subtype: 'text', text_value: 'ext-1' })])

    const taskGid = created.body.data.gid
    const updated = await call(ctx.app, 'PUT', `/tasks/${taskGid}`, { custom_fields: { [fieldGid]: 'ext-2' } })
    expect(updated.status).toBe(200)
    const fetched = await call(ctx.app, 'GET', `/tasks/${taskGid}`)
    expect(fetched.body.data.custom_fields[0].text_value).toBe('ext-2')

    await call(ctx.app, 'PUT', `/tasks/${taskGid}`, { custom_fields: { [fieldGid]: null } })
    const cleared = await call(ctx.app, 'GET', `/tasks/${taskGid}`)
    expect(cleared.body.data.custom_fields[0]).toEqual(expect.objectContaining({ text_value: null, display_value: null }))
  })

  it('returns 400 and creates nothing when the field is not on the task\'s projects', async () => {
    await call(ctx.app, 'POST', `/projects/${ctx.project('Alpha')}/addCustomFieldSetting`, { custom_field: fieldGid })

    const res = await call(ctx.app, 'POST', '/tasks', { name: 'T', projects: [ctx.project('Beta')], custom_fields: { [fieldGid]: 'x' } })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].message).toContain(fieldGid)
    const tasks = await call(ctx.app, 'GET', `/tasks?project=${ctx.project('Beta')}`)
    expect(tasks.body.data).toEqual([])
  })

  it('returns 400 on update when the field is not on the task\'s projects', async () => {
    const created = await call(ctx.app, 'POST', '/tasks', { name: 'T', projects: [ctx.project('Beta')] })
    const res = await call(ctx.app, 'PUT', `/tasks/${created.body.data.gid}`, { name: 'renamed', custom_fields: { [fieldGid]: 'x' } })
    expect(res.status).toBe(400)
    const fetched = await call(ctx.app, 'GET', `/tasks/${created.body.data.gid}`)
    expect(fetched.body.data.name).toBe('T')
  })

  it('keeps a value readable but rejects writes after the task leaves the field\'s project', async () => {
    await call(ctx.app, 'POST', `/projects/${ctx.project('Alpha')}/addCustomFieldSetting`, { custom_field: fieldGid })
    const created = await call(ctx.app, 'POST', '/tasks', { name: 'T', projects: [ctx.project('Alpha')], custom_fields: { [fieldGid]: 'ext-1' } })
    const taskGid = created.body.data.gid
    await call(ctx.app, 'POST', `/tasks/${taskGid}/removeProject`, { project: ctx.project('Alpha') })

    const res = await call(ctx.app, 'PUT', `/tasks/${taskGid}`, { custom_fields: { [fieldGid]: 'ext-2' } })
    expect(res.status).toBe(400)
    const fetched = await call(ctx.app, 'GET', `/tasks/${taskGid}`)
    expect(fetched.body.data.custom_fields[0].text_value).toBe('ext-1')
  })
})

describe('Asana - Custom fields seed config', () => {
  it('declares fields and project settings by name', async () => {
    const { app, project } = createApp({
      custom_fields: [{ name: 'External ID', workspace: 'WS' }],
      custom_field_settings: [{ project: 'Alpha', custom_field: 'External ID' }],
    })

    const settings = await call(app, 'GET', `/projects/${project('Alpha')}/custom_field_settings`)
    expect(settings.body.data).toHaveLength(1)
    const fieldGid = settings.body.data[0].custom_field.gid

    const created = await call(app, 'POST', '/tasks', { name: 'T', projects: [project('Alpha')], custom_fields: { [fieldGid]: 'ext-1' } })
    expect(created.status).toBe(201)
    expect(created.body.data.custom_fields[0]).toEqual(expect.objectContaining({ name: 'External ID', text_value: 'ext-1' }))
  })
})
