import { createServer } from '@emulators/core'
import { describe, expect, it } from 'bun:test'
import { getNaverStore, naverPlugin, seedFromConfig } from '../index.js'

const BASE = 'http://localhost:4000'
const CLIENT_ID = 'naver_client_id'
const CLIENT_SECRET = 'naver_client_secret'
const REDIRECT = 'http://localhost:3000/api/auth/callback/naver'
const USER_ID = 'naver_user_001'

function makeApp() {
  const { app, store } = createServer(naverPlugin, { port: 4000 })
  naverPlugin.seed?.(store, BASE)
  return { app, store }
}

/** Drives authorize?user= then exchanges the code for tokens. */
async function login(app: { fetch: (r: Request) => Promise<Response> }, state = 'xyz123') {
  const authRes = await app.fetch(
    new Request(
      `${BASE}/oauth2.0/authorize?response_type=code&client_id=${CLIENT_ID}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&user=${USER_ID}`,
    ),
  )
  expect(authRes.status).toBe(302)
  const location = authRes.headers.get('location')!
  const url = new URL(location)
  const code = url.searchParams.get('code')!

  const tokenRes = await app.fetch(
    new Request(`${BASE}/oauth2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        state,
      }),
    }),
  )
  const tokenBody = await tokenRes.json()
  return { code, tokenBody, tokenRes }
}

describe('authorize', () => {
  it('requires state', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(
        `${BASE}/oauth2.0/authorize?response_type=code&client_id=${CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(REDIRECT)}`,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('auto-approves ?user= and redirects with code + state round-trip', async () => {
    const { app } = makeApp()
    const state = 'round-trip-state'
    const res = await app.fetch(
      new Request(
        `${BASE}/oauth2.0/authorize?response_type=code&client_id=${CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&user=${USER_ID}`,
      ),
    )
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location')!)
    expect(url.searchParams.get('code')).toBeTruthy()
    expect(url.searchParams.get('state')).toBe(state)
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT)
  })

  it('renders login page without ?user', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(
        `${BASE}/oauth2.0/authorize?response_type=code&client_id=${CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s`,
      ),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(USER_ID)
  })

  it('redirects error for invalid client_id', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(
        `${BASE}/oauth2.0/authorize?response_type=code&client_id=bogus`
        + `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=s`,
      ),
    )
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location')!)
    expect(url.searchParams.get('error')).toBe('invalid_request')
    expect(url.searchParams.get('state')).toBe('s')
  })
})

describe('token', () => {
  it('issues tokens for authorization_code with expires_in as a string', async () => {
    const { app } = makeApp()
    const { tokenRes, tokenBody } = await login(app)
    expect(tokenRes.status).toBe(200)
    expect(tokenBody.access_token).toBeTruthy()
    expect(tokenBody.refresh_token).toBeTruthy()
    expect(tokenBody.token_type).toBe('bearer')
    expect(tokenBody.expires_in).toBe('3600')
    expect(typeof tokenBody.expires_in).toBe('string')
  })

  it('returns HTTP 200 with error field for invalid code', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(`${BASE}/oauth2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: 'nonexistent',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })

  it('rejects reused (single-use) code', async () => {
    const { app } = makeApp()
    const { code } = await login(app)
    const res = await app.fetch(
      new Request(`${BASE}/oauth2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
        }),
      }),
    )
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })

  it('supports GET query params for token endpoint', async () => {
    const { app } = makeApp()
    const authRes = await app.fetch(
      new Request(
        `${BASE}/oauth2.0/authorize?response_type=code&client_id=${CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=g&user=${USER_ID}`,
      ),
    )
    const code = new URL(authRes.headers.get('location')!).searchParams.get('code')!
    const res = await app.fetch(
      new Request(
        `${BASE}/oauth2.0/token?grant_type=authorization_code&client_id=${CLIENT_ID}`
        + `&client_secret=${CLIENT_SECRET}&code=${code}&state=g`,
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBeTruthy()
  })

  it('refreshes the access token', async () => {
    const { app } = makeApp()
    const { tokenBody } = await login(app)
    const res = await app.fetch(
      new Request(`${BASE}/oauth2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: tokenBody.refresh_token,
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBeTruthy()
    expect(body.access_token).not.toBe(tokenBody.access_token)
  })

  it('delete grant invalidates the token', async () => {
    const { app } = makeApp()
    const { tokenBody } = await login(app)

    const delRes = await app.fetch(
      new Request(`${BASE}/oauth2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'delete',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          access_token: tokenBody.access_token,
          service_provider: 'NAVER',
        }),
      }),
    )
    expect(delRes.status).toBe(200)
    const delBody = await delRes.json()
    expect(delBody.result).toBe('success')
    expect(delBody.access_token).toBe(tokenBody.access_token)

    // Token no longer works.
    const meRes = await app.fetch(
      new Request(`${BASE}/v1/nid/me`, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      }),
    )
    expect(meRes.status).toBe(401)
    expect((await meRes.json()).resultcode).toBe('024')
  })

  it('returns unauthorized_client for an unknown grant_type', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(`${BASE}/oauth2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toBe('unauthorized_client')
  })
})

describe('/v1/nid/me', () => {
  it('returns the success profile format', async () => {
    const { app } = makeApp()
    const { tokenBody } = await login(app)
    const res = await app.fetch(
      new Request(`${BASE}/v1/nid/me`, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resultcode).toBe('00')
    expect(body.message).toBe('success')
    expect(body.response.id).toBe(USER_ID)
    expect(body.response.name).toBe('홍길동')
    expect(body.response.email).toBe('hong@example.com')
    expect(body.response.gender).toBe('M')
  })

  it('returns 401 resultcode 024 for an invalid token', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(`${BASE}/v1/nid/me`, {
        headers: { Authorization: 'Bearer not-a-real-token' },
      }),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.resultcode).toBe('024')
    expect(body.message).toContain('Authentication failed')
  })
})

describe('/v1/nid/verify', () => {
  it('verifies a valid token', async () => {
    const { app } = makeApp()
    const { tokenBody } = await login(app)
    const res = await app.fetch(
      new Request(`${BASE}/v1/nid/verify`, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resultcode).toBe('00')
    expect(body.response.token).toBe(tokenBody.access_token)
  })

  it('rejects an invalid token with 401', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(`${BASE}/v1/nid/verify`, {
        headers: { Authorization: 'Bearer bogus' },
      }),
    )
    expect(res.status).toBe(401)
    expect((await res.json()).resultcode).toBe('024')
  })
})

describe('seedFromConfig', () => {
  it('seeds apps and users from the registry initConfig shape', async () => {
    const { store } = createServer(naverPlugin, { port: 4000 })
    seedFromConfig(store, BASE, {
      apps: [
        {
          client_id: 'naver_client_id_example',
          client_secret: 'naver_client_secret_example',
          callback_urls: ['http://localhost:3000/api/auth/callback/naver'],
        },
      ],
      users: [
        {
          name: '홍길동',
          nickname: 'gildong',
          email: 'hong@example.com',
          gender: 'M',
          birthyear: '1990',
          mobile: '010-1234-5678',
        },
      ],
    })

    const ns = getNaverStore(store)
    const app = ns.apps.findOneBy('client_id', 'naver_client_id_example')
    expect(app).toBeTruthy()
    expect(app!.client_secret).toBe('naver_client_secret_example')

    const user = ns.users.findOneBy('email', 'hong@example.com')
    expect(user).toBeTruthy()
    expect(user!.name).toBe('홍길동')
    expect(user!.naver_id).toBeTruthy()
  })

  it('skips duplicate apps on re-seed', async () => {
    const { store } = createServer(naverPlugin, { port: 4000 })
    const cfg = { apps: [{ client_id: 'dup', client_secret: 's' }] }
    seedFromConfig(store, BASE, cfg)
    seedFromConfig(store, BASE, cfg)
    const ns = getNaverStore(store)
    expect(ns.apps.findBy('client_id', 'dup').length).toBe(1)
  })
})
