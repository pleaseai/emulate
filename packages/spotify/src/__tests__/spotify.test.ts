import { authMiddleware, createApiErrorHandler, createErrorHandler, Hono, Store, WebhookDispatcher } from '@emulators/core'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedFromConfig, spotifyPlugin } from '../index.js'

const base = 'http://localhost:4000'

function createTestApp() {
  const store = new Store()
  const webhooks = new WebhookDispatcher()
  // Spotify tokens are resolved from the store, so the core tokenMap stays empty.
  const tokenMap = new Map()

  const app = new Hono()
  app.onError(createApiErrorHandler())
  app.use('*', createErrorHandler())
  app.use('*', authMiddleware(tokenMap))
  spotifyPlugin.register(app as any, store, webhooks, base, tokenMap)

  seedFromConfig(store, base, {
    clients: [{ client_id: 'test-client', client_secret: 'test-secret', name: 'Test App' }],
    artists: [
      {
        name: 'Daft Punk',
        genres: ['electronic'],
        popularity: 88,
        followers: 9_000_000,
        albums: [
          {
            name: 'Discovery',
            release_date: '2001-03-12',
            tracks: [{ name: 'One More Time' }, { name: 'Digital Love' }],
          },
        ],
      },
    ],
  })

  return { app }
}

let app: ReturnType<typeof createTestApp>['app']

beforeEach(() => {
  ({ app } = createTestApp())
})

async function fetchToken(): Promise<string> {
  const res = await app.request(`${base}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'test-secret',
    }),
  })
  expect(res.status).toBe(200)
  const json = (await res.json()) as { access_token: string, token_type: string }
  expect(json.token_type).toBe('Bearer')
  return json.access_token
}

describe('spotify emulator', () => {
  it('issues a client credentials token', async () => {
    const token = await fetchToken()
    expect(token.startsWith('BQ')).toBe(true)
  })

  it('rejects invalid client credentials', async () => {
    const res = await app.request(`${base}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: 'wrong',
      }),
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client')
  })

  it('rejects unsupported grant types', async () => {
    const res = await app.request(`${base}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_grant_type')
  })

  it('requires auth on catalog endpoints', async () => {
    const res = await app.request(`${base}/v1/search?q=daft&type=artist`)
    expect(res.status).toBe(401)
  })

  it('searches seeded artists, albums, and tracks', async () => {
    const token = await fetchToken()
    const res = await app.request(`${base}/v1/search?q=one%20more%20time&type=track`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { tracks: { items: Array<{ name: string, artists: Array<{ name: string }> }> } }
    expect(json.tracks.items).toHaveLength(1)
    expect(json.tracks.items[0].name).toBe('One More Time')
    expect(json.tracks.items[0].artists[0].name).toBe('Daft Punk')
  })

  it('fetches an artist and its albums', async () => {
    const token = await fetchToken()
    const auth = { headers: { authorization: `Bearer ${token}` } }
    const search = await app.request(`${base}/v1/search?q=daft&type=artist`, auth)
    const { artists } = (await search.json()) as { artists: { items: Array<{ id: string, name: string }> } }
    expect(artists.items).toHaveLength(1)

    const artistRes = await app.request(`${base}/v1/artists/${artists.items[0].id}`, auth)
    expect(artistRes.status).toBe(200)
    expect(((await artistRes.json()) as { name: string }).name).toBe('Daft Punk')

    const albumsRes = await app.request(`${base}/v1/artists/${artists.items[0].id}/albums`, auth)
    expect(albumsRes.status).toBe(200)
    const albums = (await albumsRes.json()) as { items: Array<{ name: string, total_tracks: number }> }
    expect(albums.items[0].name).toBe('Discovery')
    expect(albums.items[0].total_tracks).toBe(2)
  })
})
