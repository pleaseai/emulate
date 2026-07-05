import { beforeEach, describe, expect, it, mock } from 'bun:test'

interface SpawnCall {
  cmd: string
  args: string[]
}

const spawnCalls: SpawnCall[] = []
let spawnResults: Array<{ status: number }> = []

mock.module('node:child_process', () => ({
  spawnSync: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    return spawnResults.shift() ?? { status: 0 }
  },
  execSync: () => '',
}))

const { buildAliases, portlessBaseUrl, registerAliases, removeAliases } = await import('../portless.js')

beforeEach(() => {
  spawnCalls.length = 0
  spawnResults = []
})

describe('buildAliases', () => {
  it('assigns sequential ports from the base port', () => {
    expect(buildAliases(['kakao', 'naver'], 4000)).toEqual([
      { name: 'kakao.emulate', port: 4000 },
      { name: 'naver.emulate', port: 4001 },
    ])
  })
})

describe('registerAliases', () => {
  it('registers each alias with --force', () => {
    registerAliases([{ name: 'kakao.emulate', port: 4000 }])
    expect(spawnCalls).toEqual([{ cmd: 'portless', args: ['alias', 'kakao.emulate', '4000', '--force'] }])
  })

  it('rolls back already-registered aliases when one fails', () => {
    spawnResults = [{ status: 0 }, { status: 1 }]
    expect(() =>
      registerAliases([
        { name: 'kakao.emulate', port: 4000 },
        { name: 'naver.emulate', port: 4001 },
      ]),
    ).toThrow('Failed to register portless alias: naver.emulate -> 4001')
    expect(spawnCalls.map(c => c.args)).toEqual([
      ['alias', 'kakao.emulate', '4000', '--force'],
      ['alias', 'naver.emulate', '4001', '--force'],
      ['alias', '--remove', 'kakao.emulate'],
    ])
  })
})

describe('removeAliases', () => {
  it('removes every alias even when one fails', () => {
    spawnResults = [{ status: 1 }, { status: 0 }]
    removeAliases([
      { name: 'kakao.emulate', port: 4000 },
      { name: 'naver.emulate', port: 4001 },
    ])
    expect(spawnCalls.map(c => c.args)).toEqual([
      ['alias', '--remove', 'kakao.emulate'],
      ['alias', '--remove', 'naver.emulate'],
    ])
  })
})

describe('portlessBaseUrl', () => {
  it('builds the service.emulate.localhost HTTPS URL', () => {
    expect(portlessBaseUrl('kakao')).toBe('https://kakao.emulate.localhost')
  })
})
