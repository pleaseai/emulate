import type { AppEnv, Hono, Store } from '@emulators/core'
import { createServer } from '@emulators/core'
import { beforeEach, describe, expect, it } from 'bun:test'
import { getKakaoStore, kakaoPlugin, seedFromConfig } from '../index.js'

const BASE = 'http://localhost:4000'
const CLIENT_ID = 'kakao_rest_api_key'
const REDIRECT_URI = 'http://localhost:3000/api/auth/callback/kakao'
const SEED_USER_ID = 1234567890

function makeApp(): { app: Hono<AppEnv>, store: Store } {
  const { app, store } = createServer(kakaoPlugin, { port: 4000 })
  kakaoPlugin.seed?.(store, BASE)
  return { app, store }
}

function form(data: Record<string, string>): Request {
  return new Request(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data),
  })
}

/** authorize → authorization code issuance (immediate approval path) */
async function getCode(
  app: Hono<AppEnv>,
  opts: { state?: string, redirectUri?: string, clientId?: string } = {},
): Promise<{ code: string, state: string | null, res: Response }> {
  const url = new URL(`${BASE}/oauth/authorize`)
  url.searchParams.set('client_id', opts.clientId ?? CLIENT_ID)
  url.searchParams.set('redirect_uri', opts.redirectUri ?? REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('user_id', String(SEED_USER_ID))
  if (opts.state) {
    url.searchParams.set('state', opts.state)
  }

  const res = await app.fetch(new Request(url.toString(), { redirect: 'manual' }))
  const location = res.headers.get('location')
  if (!location) {
    return { code: '', state: null, res }
  }
  const loc = new URL(location)
  return { code: loc.searchParams.get('code') ?? '', state: loc.searchParams.get('state'), res }
}

async function getAccessToken(app: Hono<AppEnv>): Promise<{ access: string, refresh: string }> {
  const { code } = await getCode(app)
  const res = await app.fetch(
    form({ grant_type: 'authorization_code', code, client_id: CLIENT_ID, redirect_uri: REDIRECT_URI }),
  )
  const body = (await res.json()) as { access_token: string, refresh_token: string }
  return { access: body.access_token, refresh: body.refresh_token }
}

describe('kakao authorize', () => {
  let app: Hono<AppEnv>
  beforeEach(() => {
    app = makeApp().app
  })

  it('issues an authorization code and redirects with state round-trip', async () => {
    const { code, state, res } = await getCode(app, { state: 'xyz-123' })
    expect(res.status).toBe(302)
    expect(code.length).toBeGreaterThan(0)
    expect(state).toBe('xyz-123')
    const location = res.headers.get('location')!
    expect(location.startsWith(REDIRECT_URI)).toBe(true)
  })

  it('renders a login page listing seeded users when no user_id given', async () => {
    const url = new URL(`${BASE}/oauth/authorize`)
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('response_type', 'code')
    const res = await app.fetch(new Request(url.toString()))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('테스트 사용자')
  })

  it('rejects an unknown client_id with KOE101', async () => {
    const url = new URL(`${BASE}/oauth/authorize`)
    url.searchParams.set('client_id', 'nope')
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    const res = await app.fetch(new Request(url.toString()))
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('KOE101')
  })

  it('rejects an unregistered redirect_uri with KOE006', async () => {
    const url = new URL(`${BASE}/oauth/authorize`)
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('redirect_uri', 'http://evil.example.com/callback')
    const res = await app.fetch(new Request(url.toString()))
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('KOE006')
  })
})

describe('kakao token', () => {
  let app: Hono<AppEnv>
  beforeEach(() => {
    app = makeApp().app
  })

  it('exchanges an authorization code for tokens', async () => {
    const { code } = await getCode(app)
    const res = await app.fetch(
      form({ grant_type: 'authorization_code', code, client_id: CLIENT_ID, redirect_uri: REDIRECT_URI }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.token_type).toBe('bearer')
    expect(typeof body.access_token).toBe('string')
    expect(body.expires_in).toBe(21599)
    expect(typeof body.refresh_token).toBe('string')
    expect(body.refresh_token_expires_in).toBe(5183999)
    expect(typeof body.scope).toBe('string')
  })

  it('rejects reuse of an already-consumed code with KOE320', async () => {
    const { code } = await getCode(app)
    await app.fetch(
      form({ grant_type: 'authorization_code', code, client_id: CLIENT_ID, redirect_uri: REDIRECT_URI }),
    )
    const res = await app.fetch(
      form({ grant_type: 'authorization_code', code, client_id: CLIENT_ID, redirect_uri: REDIRECT_URI }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid_grant')
    expect(body.error_code).toBe('KOE320')
  })

  it('rejects an invalid code with KOE320', async () => {
    const res = await app.fetch(
      form({ grant_type: 'authorization_code', code: 'bogus', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error_code).toBe('KOE320')
  })

  it('refreshes an access token via refresh_token grant', async () => {
    const { refresh } = await getAccessToken(app)
    const res = await app.fetch(
      form({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CLIENT_ID }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.token_type).toBe('bearer')
    expect(typeof body.access_token).toBe('string')
    // Simplification: the refresh_token is always kept
    expect(body.refresh_token).toBe(refresh)
  })
})

describe('kakao user api', () => {
  let app: Hono<AppEnv>
  beforeEach(() => {
    app = makeApp().app
  })

  function authed(path: string, token: string, method = 'GET'): Request {
    return new Request(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  it('returns the user profile from /v2/user/me', async () => {
    const { access } = await getAccessToken(app)
    const res = await app.fetch(authed('/v2/user/me', access))
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.id).toBe(SEED_USER_ID)
    expect(typeof body.connected_at).toBe('string')
    expect(body.properties.nickname).toBe('테스트 사용자')
    expect(body.kakao_account.profile.nickname).toBe('테스트 사용자')
    expect(body.kakao_account.profile.is_default_image).toBe(false)
    expect(body.kakao_account.has_email).toBe(true)
    expect(body.kakao_account.email).toBe('testuser@kakao.com')
    expect(body.kakao_account.is_email_verified).toBe(true)
  })

  it('rejects /v2/user/me with an invalid token (401, code -401)', async () => {
    const res = await app.fetch(authed('/v2/user/me', 'invalid-token'))
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.msg).toBe('this access token does not exist')
    expect(body.code).toBe(-401)
  })

  it('returns access_token_info', async () => {
    const { access } = await getAccessToken(app)
    const res = await app.fetch(authed('/v1/user/access_token_info', access))
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.id).toBe(SEED_USER_ID)
    expect(typeof body.expires_in).toBe('number')
    expect(typeof body.app_id).toBe('number')
  })

  it('logout invalidates only the used access token', async () => {
    const { access } = await getAccessToken(app)
    const logoutRes = await app.fetch(authed('/v1/user/logout', access, 'POST'))
    expect(logoutRes.status).toBe(200)
    expect(((await logoutRes.json()) as any).id).toBe(SEED_USER_ID)

    const meRes = await app.fetch(authed('/v2/user/me', access))
    expect(meRes.status).toBe(401)
  })

  it('unlink invalidates all tokens for the user and disconnects the app', async () => {
    const { app: freshApp, store } = makeApp()
    const t1 = await getAccessToken(freshApp)
    const t2 = await getAccessToken(freshApp)

    const res = await freshApp.fetch(authed('/v1/user/unlink', t1.access, 'POST'))
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).id).toBe(SEED_USER_ID)

    // Both tokens invalid
    expect((await freshApp.fetch(authed('/v2/user/me', t1.access))).status).toBe(401)
    expect((await freshApp.fetch(authed('/v2/user/me', t2.access))).status).toBe(401)

    const ks = getKakaoStore(store)
    const appRec = ks.apps.findOneBy('client_id', CLIENT_ID)!
    expect(appRec.unlinked_user_ids).toContain(SEED_USER_ID)
  })
})

describe('kakao talk memo', () => {
  let app: Hono<AppEnv>
  beforeEach(() => {
    app = makeApp().app
  })

  it('sends a default memo and surfaces it in the internal inbox', async () => {
    const { access } = await getAccessToken(app)
    const template = { object_type: 'text', text: 'hello', link: { web_url: 'https://example.com' } }
    const res = await app.fetch(
      new Request(`${BASE}/v2/api/talk/memo/default/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ template_object: JSON.stringify(template) }),
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).result_code).toBe(0)

    const inbox = await app.fetch(new Request(`${BASE}/internal/talk/memos`))
    const data = (await inbox.json()) as any
    expect(data.memos.length).toBe(1)
    expect(data.memos[0].user_id).toBe(SEED_USER_ID)
    expect(data.memos[0].template_object).toEqual(template)
  })

  it('rejects a missing template_object with code -2', async () => {
    const { access } = await getAccessToken(app)
    const res = await app.fetch(
      new Request(`${BASE}/v2/api/talk/memo/default/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({}),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe(-2)
  })
})

describe('kakao seedFromConfig', () => {
  it('seeds apps and users from registry initConfig shape', () => {
    const { store } = createServer(kakaoPlugin, { port: 4000 })
    // registry initConfig shape
    seedFromConfig(store, BASE, {
      apps: [
        {
          client_id: 'kakao_rest_api_key_example',
          client_secret: 'example_secret',
          redirect_uris: ['http://localhost:3000/api/auth/callback/kakao'],
        },
      ],
      users: [
        { user_id: 1001, nickname: '홍길동', email: 'hong@example.com' },
        { nickname: '김철수' },
      ],
    })

    const ks = getKakaoStore(store)
    const appRec = ks.apps.findOneBy('client_id', 'kakao_rest_api_key_example')
    expect(appRec).toBeDefined()
    expect(appRec!.client_secret).toBe('example_secret')

    const hong = ks.users.findOneBy('user_id', 1001)
    expect(hong).toBeDefined()
    expect(hong!.nickname).toBe('홍길동')
    expect(hong!.email).toBe('hong@example.com')

    // user_id auto-assignment
    const kim = ks.users.all().find(u => u.nickname === '김철수')
    expect(kim).toBeDefined()
    expect(kim!.user_id).toBeGreaterThan(1001)
    expect(kim!.email).toBeNull()
  })

  it('is idempotent (skips existing client_id / user_id)', () => {
    const { store } = createServer(kakaoPlugin, { port: 4000 })
    const cfg = {
      apps: [{ client_id: 'dup_app' }],
      users: [{ user_id: 2002, nickname: '중복' }],
    }
    seedFromConfig(store, BASE, cfg)
    seedFromConfig(store, BASE, cfg)
    const ks = getKakaoStore(store)
    expect(ks.apps.findBy('client_id', 'dup_app').length).toBe(1)
    expect(ks.users.findBy('user_id', 2002).length).toBe(1)
  })
})
