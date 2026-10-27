import { assertEmulatorDefinition, createCustomRuntime, isEmulatorDefinition } from '@emulators/core'
import { afterAll, describe, expect, it } from 'bun:test'
import { SERVICE_NAMES, SERVICE_REGISTRY } from '../registry.js'

const BASE_URL = 'http://localhost:4100'
const REDIRECT = 'http://localhost:3000/api/auth/callback/kakao'

type CustomRuntime = Awaited<ReturnType<typeof createCustomRuntime>>
const runtimes: CustomRuntime[] = []

afterAll(async () => {
  await Promise.all(runtimes.map(r => r.close().catch(() => {})))
})

async function loadDefinition(service: string) {
  return (await import(`../emulators/${service}.js`)).default
}

async function startKakao(): Promise<CustomRuntime> {
  const runtime = await createCustomRuntime(await loadDefinition('kakao'), {
    baseUrl: BASE_URL,
    seed: SERVICE_REGISTRY.kakao.initConfig.kakao as Record<string, unknown>,
  })
  runtimes.push(runtime)
  return runtime
}

function authorize(runtime: CustomRuntime, clientId: string) {
  return runtime.request(
    `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&user_id=1001`,
    { redirect: 'manual' },
  )
}

describe('service custom emulators', () => {
  it.each(SERVICE_NAMES)('%s default-exports a valid definition', async (service) => {
    const definition = await loadDefinition(service)
    expect(isEmulatorDefinition(definition)).toBe(true)
    expect(() => assertEmulatorDefinition(definition)).not.toThrow()
    expect(definition.name).toBe(service)
  })

  it('serves a seeded kakao OAuth authorize and rejects an unknown client_id', async () => {
    const runtime = await startKakao()

    const ok = await authorize(runtime, 'kakao_rest_api_key_example')
    expect(ok.status).toBe(302)
    expect(new URL(ok.headers.get('location')!).searchParams.get('code')).toBeTruthy()

    const unknown = await authorize(runtime, 'unknown_client')
    expect(unknown.status).toBeGreaterThanOrEqual(400)
  })

  it('reset restores the seed state', async () => {
    const runtime = await createCustomRuntime(await loadDefinition('asana'), {
      baseUrl: BASE_URL,
      seed: SERVICE_REGISTRY.asana.initConfig.asana as Record<string, unknown>,
    })
    runtimes.push(runtime)
    const headers = { 'Authorization': 'Bearer test_token_admin', 'content-type': 'application/json' }
    const listTags = async () => ((await (await runtime.request('/api/1.0/tags', { headers })).json()) as { data: unknown[] }).data
    const workspaces = (await (await runtime.request('/api/1.0/workspaces', { headers })).json()) as { data: Array<{ gid: string }> }

    const before = (await listTags()).length
    const created = await runtime.request('/api/1.0/tags', {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: { name: 'Temp', workspace: workspaces.data[0].gid } }),
    })
    expect(created.status).toBe(201)
    expect((await listTags()).length).toBe(before + 1)

    await runtime.reset()
    expect((await listTags()).length).toBe(before)
  })

  it('validateSeed rejects non-object seeds', async () => {
    const definition = await loadDefinition('kakao')
    expect(() => definition.validateSeed('nope')).toThrow('expected an object')
    expect(() => definition.validateSeed(null)).toThrow('expected an object')
    expect(() => definition.validateSeed([])).toThrow('expected an object')
    expect(definition.validateSeed({ apps: [] })).toEqual({ apps: [] })
  })
})
