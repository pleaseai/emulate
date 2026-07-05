import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

interface SpawnCall {
  cmd: string
  args: string[]
}

const spawnCalls: SpawnCall[] = []
let spawnResults: Array<{ status: number }> = []
let execCalls = 0
let execShouldThrow = false
let promptAnswer = ''

mock.module('node:child_process', () => ({
  spawnSync: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    return spawnResults.shift() ?? { status: 0 }
  },
  execSync: () => {
    execCalls++
    if (execShouldThrow) {
      throw new Error('install failed')
    }
    return ''
  },
}))

mock.module('node:readline', () => ({
  createInterface: () => ({
    question: (_q: string, cb: (answer: string) => void) => cb(promptAnswer),
    close: () => {},
  }),
}))

const { buildAliases, ensurePortless, portlessBaseUrl, registerAliases, removeAliases } = await import('../portless.js')

beforeEach(() => {
  spawnCalls.length = 0
  spawnResults = []
  execCalls = 0
  execShouldThrow = false
  promptAnswer = ''
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
    expect(() => {
      registerAliases([
        { name: 'kakao.emulate', port: 4000 },
        { name: 'naver.emulate', port: 4001 },
      ])
    }).toThrow('Failed to register portless alias: naver.emulate -> 4001')
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

describe('ensurePortless', () => {
  const savedIsTTY = process.stdin.isTTY
  const savedCI = process.env.CI

  function mockExit(): { calls: number[], restore: () => void } {
    const calls: number[] = []
    const original = process.exit
    process.exit = ((code: number) => {
      calls.push(code)
      throw new Error(`exit ${code}`)
    }) as typeof process.exit
    return {
      calls,
      restore: () => {
        process.exit = original
      },
    }
  }

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: savedIsTTY, configurable: true })
    if (savedCI === undefined) {
      delete process.env.CI
    }
    else {
      process.env.CI = savedCI
    }
  })

  it('resolves when portless and the proxy are available', async () => {
    spawnResults = [{ status: 0 }, { status: 0 }]
    await ensurePortless()
    expect(spawnCalls.map(c => c.args)).toEqual([['--version'], ['list']])
  })

  it('exits when the proxy is not running', async () => {
    spawnResults = [{ status: 0 }, { status: 1 }]
    const exit = mockExit()
    try {
      await expect(ensurePortless()).rejects.toThrow('exit 1')
      expect(exit.calls).toEqual([1])
    }
    finally {
      exit.restore()
    }
  })

  it('exits when portless is missing in a non-interactive session', async () => {
    process.env.CI = 'true'
    spawnResults = [{ status: 1 }]
    const exit = mockExit()
    try {
      await expect(ensurePortless()).rejects.toThrow('exit 1')
      expect(exit.calls).toEqual([1])
      expect(execCalls).toBe(0)
    }
    finally {
      exit.restore()
    }
  })

  it('installs portless when the interactive prompt is accepted', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    delete process.env.CI
    promptAnswer = 'y'
    // missing → (install) → found → proxy running
    spawnResults = [{ status: 1 }, { status: 0 }, { status: 0 }]
    await ensurePortless()
    expect(execCalls).toBe(1)
  })

  it('exits when the interactive prompt is declined', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    delete process.env.CI
    promptAnswer = 'n'
    spawnResults = [{ status: 1 }]
    const exit = mockExit()
    try {
      await expect(ensurePortless()).rejects.toThrow('exit 1')
      expect(execCalls).toBe(0)
    }
    finally {
      exit.restore()
    }
  })

  it('exits when the install fails', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    delete process.env.CI
    promptAnswer = ''
    execShouldThrow = true
    spawnResults = [{ status: 1 }]
    const exit = mockExit()
    try {
      await expect(ensurePortless()).rejects.toThrow('exit 1')
      expect(execCalls).toBe(1)
    }
    finally {
      exit.restore()
    }
  })
})

describe('portlessBaseUrl', () => {
  it('builds the service.emulate.localhost HTTPS URL', () => {
    expect(portlessBaseUrl('kakao')).toBe('https://kakao.emulate.localhost')
  })
})
