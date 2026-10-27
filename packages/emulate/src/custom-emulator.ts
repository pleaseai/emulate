import type { EmulatorDefinition } from '@emulators/core'
import type { TokenSeed } from './build-server.js'
import type { LoadedService, ServiceName } from './registry.js'
import { defineEmulator } from '@emulators/core'
import { buildServiceServer } from './build-server.js'

type ServiceSeed = Record<string, unknown>

function isPlainObject(value: unknown): value is ServiceSeed {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertTokenSeed(service: ServiceName, value: unknown): asserts value is TokenSeed | undefined {
  if (value === undefined) {
    return
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`Invalid seed for "${service}": tokens must be an object keyed by token`)
  }
  for (const [token, user] of Object.entries(value)) {
    const valid = isPlainObject(user)
      && typeof user.login === 'string'
      && (user.scopes === undefined || (Array.isArray(user.scopes) && user.scopes.every(scope => typeof scope === 'string')))
    if (!valid) {
      throw new TypeError(`Invalid seed for "${service}": tokens.${token} must be { login: string, scopes?: string[] }`)
    }
  }
}

export function defineServiceEmulator(service: ServiceName, loaded: LoadedService): EmulatorDefinition<ServiceSeed> {
  return defineEmulator<ServiceSeed>({
    name: service,
    state: () => ({}),
    validateSeed(value) {
      if (!isPlainObject(value)) {
        throw new TypeError(`Invalid seed for "${service}": expected an object`)
      }
      assertTokenSeed(service, value.tokens)
      return value
    },
    setup({ app, state, baseUrl, webhooks }) {
      const tokens = state.tokens
      assertTokenSeed(service, tokens)
      const inner = buildServiceServer({ service, loaded, port: 0, baseUrl, tokens, svcSeedConfig: state, webhooks })
      const forward = (c: { req: { raw: Request } }) => inner.app.fetch(c.req.raw)
      const seen = new Set<string>()
      for (const { method, path } of inner.app.routeTable) {
        const key = `${method} ${path}`
        if (seen.has(key) || path === '/_emulate' || path.startsWith('/_emulate/')) {
          continue
        }
        seen.add(key)
        app.on(method, path, forward)
      }
      app.notFound(forward)
    },
  })
}
