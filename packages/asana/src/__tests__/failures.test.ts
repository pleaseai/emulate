import type { AsanaSeedConfig } from '../index.js'
import { authMiddleware, Hono, Store, WebhookDispatcher } from '@emulators/core'
import { describe, expect, it } from 'bun:test'
import { asanaPlugin, clearFailures, failNext, getAsanaStore, seedFromConfig } from '../index.js'

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
    projects: [{ name: 'Alpha', workspace: 'WS' }],
    ...extra,
  })
  const projectGid = getAsanaStore(store).projects.all()[0].gid
  return { app, store, projectGid }
}

function request(app: Hono, method: string, path: string) {
  return app.request(`${api}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify({ data: { name: 'T' } }),
  })
}

describe('Asana - Failure rules', () => {
  it('fails the next request with 429, Retry-After and Asana\'s error shape, then recovers', async () => {
    const { app, store } = createApp()
    failNext(store)

    const limited = await request(app, 'GET', '/users/me')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('1')
    expect(await limited.json()).toEqual({ errors: [{ message: expect.any(String) }] })

    expect((await request(app, 'GET', '/users/me')).status).toBe(200)
  })

  it('matches method and path patterns and counts down times', async () => {
    const { app, store, projectGid } = createApp()
    failNext(store, { method: 'post', path: '/projects/:project_gid/*', times: 2, headers: { 'Retry-After': '7' } })

    expect((await request(app, 'GET', `/projects/${projectGid}/tasks`)).status).toBe(200)
    expect((await request(app, 'POST', '/tasks')).status).toBe(201)

    const first = await request(app, 'POST', `/projects/${projectGid}/sections`)
    expect(first.status).toBe(429)
    expect(first.headers.get('Retry-After')).toBe('7')
    expect((await request(app, 'POST', `/projects/${projectGid}/sections`)).status).toBe(429)
    expect((await request(app, 'POST', `/projects/${projectGid}/sections`)).status).toBe(201)
  })

  it('returns other statuses with a custom message and no Retry-After', async () => {
    const { app, store } = createApp()
    failNext(store, { path: '/api/1.0/users/me', status: 503, message: 'Asana is down' })

    const res = await request(app, 'GET', '/users/me')
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBeNull()
    expect(await res.json()).toEqual({ errors: [{ message: 'Asana is down' }] })
  })

  it('loads rules from seed config and clears them at runtime', async () => {
    const { app, store } = createApp({ failures: [{ path: '/workspaces', status: 403, times: 5 }] })
    expect((await request(app, 'GET', '/workspaces')).status).toBe(403)

    clearFailures(store)
    expect((await request(app, 'GET', '/workspaces')).status).toBe(200)
  })

  it('rejects a status outside 400-599 and a non-positive times', () => {
    const { store } = createApp()
    expect(() => failNext(store, { status: 200 })).toThrow(RangeError)
    expect(() => failNext(store, { times: 0 })).toThrow(RangeError)
  })
})
