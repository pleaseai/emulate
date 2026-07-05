import process from 'node:process'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { resolveBaseUrl } from '../base-url.js'
import { defaultBasePort, validateBaseUrlOptions } from '../start-options.js'

const ENV_VARS = ['EMULATE_BASE_URL', 'PORTLESS_URL', 'EMULATE_PORT', 'PORT'] as const
const savedEnv = Object.fromEntries(ENV_VARS.map(name => [name, process.env[name]]))

// Clear before each test (not just after) so ambient shell/CI env vars
// cannot leak into the first test case.
beforeEach(() => {
  for (const name of ENV_VARS) {
    delete process.env[name]
  }
})

afterAll(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] !== undefined) {
      process.env[name] = savedEnv[name]
    }
  }
})

describe('resolveBaseUrl', () => {
  it('defaults to localhost with the port', () => {
    expect(resolveBaseUrl({ service: 'kakao', port: 4000 })).toBe('http://localhost:4000')
  })

  it('prefers seed baseUrl over everything else', () => {
    process.env.EMULATE_BASE_URL = 'https://env.test'
    expect(
      resolveBaseUrl({ service: 'kakao', port: 4000, baseUrl: 'https://flag.test', seedBaseUrl: 'https://seed.test/' }),
    ).toBe('https://seed.test')
  })

  it('uses the explicit baseUrl over env vars', () => {
    process.env.EMULATE_BASE_URL = 'https://env.test'
    expect(resolveBaseUrl({ service: 'kakao', port: 4000, baseUrl: 'https://flag.test' })).toBe('https://flag.test')
  })

  it('falls back to EMULATE_BASE_URL, then PORTLESS_URL', () => {
    process.env.PORTLESS_URL = 'https://{service}.emulate.localhost'
    expect(resolveBaseUrl({ service: 'naver', port: 4001 })).toBe('https://naver.emulate.localhost')

    process.env.EMULATE_BASE_URL = 'https://{service}.myproxy.test'
    expect(resolveBaseUrl({ service: 'naver', port: 4001 })).toBe('https://naver.myproxy.test')
  })

  it('interpolates {service} in explicit baseUrl', () => {
    expect(resolveBaseUrl({ service: 'supabase', port: 4004, baseUrl: 'https://{service}.proxy.test' })).toBe(
      'https://supabase.proxy.test',
    )
  })
})

describe('validateBaseUrlOptions', () => {
  it('rejects --portless together with --base-url', () => {
    expect(validateBaseUrlOptions({ portless: true, baseUrl: 'https://x.test' }, 1)).toContain('mutually exclusive')
  })

  it('requires {service} for multi-service --base-url', () => {
    expect(validateBaseUrlOptions({ baseUrl: 'https://x.test' }, 2)).toContain('{service} placeholder')
    expect(validateBaseUrlOptions({ baseUrl: 'https://{service}.x.test' }, 2)).toBeNull()
  })

  it('accepts a literal --base-url for a single service', () => {
    expect(validateBaseUrlOptions({ baseUrl: 'https://x.test' }, 1)).toBeNull()
  })
})

describe('defaultBasePort', () => {
  it('defaults to 4000 without env vars', () => {
    expect(defaultBasePort()).toBe(4000)
  })

  it('prefers EMULATE_PORT over PORT and ignores non-numeric values', () => {
    process.env.PORT = '5000'
    expect(defaultBasePort()).toBe(5000)

    process.env.EMULATE_PORT = '6000'
    expect(defaultBasePort()).toBe(6000)

    process.env.EMULATE_PORT = 'not-a-port'
    expect(defaultBasePort()).toBe(5000)
  })
})
