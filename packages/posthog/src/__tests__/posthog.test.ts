import type { TokenMap } from '@emulators/core'
import { createHash } from 'node:crypto'
import { authMiddleware, Hono, serve, Store, WebhookDispatcher } from '@emulators/core'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { getPostHogStore, posthogPlugin } from '../index.js'

const PORT = 41875
const BASE = `http://localhost:${PORT}`

let httpServer: ReturnType<typeof serve>
let app: Hono
let store: Store

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

beforeAll(() => {
  store = new Store()
  const webhooks = new WebhookDispatcher()
  const tokenMap: TokenMap = new Map()
  tokenMap.set('phx_personal', { login: 'admin@example.com', id: 1, scopes: ['project:read'] })

  app = new Hono()
  app.use('*', authMiddleware(tokenMap))
  app.get('/client-id-metadata.json', c =>
    c.json({
      client_id: `${BASE}/client-id-metadata.json`,
      client_name: 'Executor Test Client',
      redirect_uris: [`${BASE}/callback`],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
    }))
  posthogPlugin.register(app as any, store, webhooks, BASE, tokenMap)
  posthogPlugin.seed?.(store, BASE)
  httpServer = serve({ fetch: app.fetch, port: PORT })
})

afterAll(async () => {
  await new Promise<void>(resolve => httpServer.close(() => resolve()))
})

describe('PostHog emulator OAuth discovery', () => {
  it('serves a PostHog-like bearer OpenAPI spec', async () => {
    const response = await fetch(`${BASE}/api/schema/`)
    expect(response.status).toBe(200)
    const spec = (await response.json()) as any
    expect(spec.info.title).toBe('PostHog API')
    expect(spec.components.securitySchemes.PersonalAPIKeyAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    expect(spec.paths['/api/projects/'].get.security).toEqual([{ PersonalAPIKeyAuth: ['project:read'] }])
    expect(spec.components.securitySchemes.DiscoveredOAuth2).toBeUndefined()
  })

  it('advertises CIMD through OAuth metadata', async () => {
    const protectedResource = (await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()) as any
    expect(protectedResource.resource).toBe(BASE)
    expect(protectedResource.authorization_servers).toEqual([BASE])

    const authServer = (await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()) as any
    expect(authServer.authorization_endpoint).toBe(`${BASE}/oauth/authorize/`)
    expect(authServer.token_endpoint).toBe(`${BASE}/oauth/token/`)
    expect(authServer.registration_endpoint).toBe(`${BASE}/oauth/register/`)
    expect(authServer.client_id_metadata_document_supported).toBe(true)
    expect(authServer.code_challenge_methods_supported).toContain('S256')
  })

  it('rejects non-HTTPS, non-loopback CIMD client IDs like PostHog', async () => {
    const params = new URLSearchParams({
      client_id: 'http://100.81.219.45:42384/api/oauth/client-id-metadata.json',
      redirect_uri: `${BASE}/callback`,
      response_type: 'code',
      scope: 'project:read',
      resource: BASE,
    })

    const response = await fetch(`${BASE}/oauth/authorize/?${params}`)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Invalid client_id parameter value.',
    })
  })

  it('serves the private API with a personal API key', async () => {
    const auth = { headers: { Authorization: 'Bearer phx_personal' } }

    // Trailing-slash canonical routes plus 307 redirects from the bare paths.
    const redirected = await fetch(`${BASE}/api/projects`, auth)
    expect(redirected.status).toBe(200)

    const projects = (await (await fetch(`${BASE}/api/projects/`, auth)).json()) as {
      results: Array<{ id: number, api_token: string }>
    }
    expect(projects.results[0].id).toBe(1)

    const me = (await (await fetch(`${BASE}/api/users/@me/`, auth)).json()) as { email: string, is_staff: boolean }
    expect(me.email).toBe('admin@example.com')
    expect(me.is_staff).toBe(true)

    const meRedirect = await fetch(`${BASE}/api/users/@me`, auth)
    expect(meRedirect.status).toBe(200)
  })

  it('captures and lists events per project', async () => {
    const auth = { Authorization: 'Bearer phx_personal' }

    const created = await fetch(`${BASE}/api/projects/1/events/`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: '$pageview', distinct_id: 'user-1', properties: { path: '/home' } }),
    })
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as { id: number, event: string }
    expect(createdBody.event).toBe('$pageview')

    const listed = await fetch(`${BASE}/api/projects/1/events/`, { headers: auth })
    expect(listed.status).toBe(200)
    const events = (await listed.json()) as { results: Array<{ event: string, distinct_id: string }> }
    expect(events.results.some(e => e.event === '$pageview' && e.distinct_id === 'user-1')).toBe(true)

    // Bare path redirects to the canonical trailing-slash route.
    const redirected = await fetch(`${BASE}/api/projects/1/events`, { headers: auth })
    expect(redirected.status).toBe(200)
  })

  it('validates event capture inputs', async () => {
    const auth = { Authorization: 'Bearer phx_personal' }

    const badProject = await fetch(`${BASE}/api/projects/not-a-number/events/`, { headers: auth })
    expect(badProject.status).toBe(400)

    const missingProject = await fetch(`${BASE}/api/projects/999/events/`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'x', distinct_id: 'y' }),
    })
    expect(missingProject.status).toBe(404)

    const missingFields = await fetch(`${BASE}/api/projects/1/events/`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: '' }),
    })
    expect(missingFields.status).toBe(400)

    const unauthenticated = await fetch(`${BASE}/api/projects/1/events/`)
    expect(unauthenticated.status).toBe(401)
  })

  it('completes authorization code flow with a loopback CIMD client and calls the API', async () => {
    const verifier = 'test-code-verifier'
    const params = new URLSearchParams({
      client_id: `${BASE}/client-id-metadata.json`,
      redirect_uri: `${BASE}/callback`,
      response_type: 'code',
      scope: 'project:read user:read',
      state: 'state-123',
      code_challenge_method: 'S256',
      code_challenge: pkceChallenge(verifier),
      resource: BASE,
    })

    const authorize = await fetch(`${BASE}/oauth/authorize/?${params}`)
    expect(authorize.status).toBe(200)
    await expect(authorize.text()).resolves.toContain('Executor Test Client')

    const user = getPostHogStore(store).users.all()[0]!
    const approval = await fetch(`${BASE}/oauth/authorize/approve`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        user_uuid: user.uuid,
        client_id: `${BASE}/client-id-metadata.json`,
        redirect_uri: `${BASE}/callback`,
        state: 'state-123',
        scope: 'project:read user:read',
        code_challenge_method: 'S256',
        code_challenge: pkceChallenge(verifier),
      }),
    })
    expect(approval.status).toBe(302)
    const location = new URL(approval.headers.get('location')!)
    expect(location.searchParams.get('state')).toBe('state-123')
    const code = location.searchParams.get('code')!
    expect(code).toMatch(/^code_/)

    const tokenResponse = await fetch(`${BASE}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: `${BASE}/client-id-metadata.json`,
        redirect_uri: `${BASE}/callback`,
        code_verifier: verifier,
      }),
    })
    expect(tokenResponse.status).toBe(200)
    const tokenBody = (await tokenResponse.json()) as any
    expect(tokenBody.access_token).toMatch(/^phx_/)

    const projects = await fetch(`${BASE}/api/projects/`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    })
    expect(projects.status).toBe(200)
    await expect(projects.json()).resolves.toMatchObject({
      results: [{ id: 1, name: 'Demo Project' }],
    })
  })
})
