import process from 'node:process'
import { afterEach, describe, expect, it } from 'bun:test'
import { resolveBaseUrl } from '../base-url.js'
import { portlessBaseUrl } from '../portless.js'

const savedEnv = { EMULATE_BASE_URL: process.env.EMULATE_BASE_URL, PORTLESS_URL: process.env.PORTLESS_URL }

afterEach(() => {
  delete process.env.EMULATE_BASE_URL
  delete process.env.PORTLESS_URL
  if (savedEnv.EMULATE_BASE_URL !== undefined) {
    process.env.EMULATE_BASE_URL = savedEnv.EMULATE_BASE_URL
  }
  if (savedEnv.PORTLESS_URL !== undefined) {
    process.env.PORTLESS_URL = savedEnv.PORTLESS_URL
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

describe('portlessBaseUrl', () => {
  it('builds the service.emulate.localhost HTTPS URL', () => {
    expect(portlessBaseUrl('kakao')).toBe('https://kakao.emulate.localhost')
  })
})
