import type { EmulatorDefinition } from '@emulators/core'
import type { TokenSeed } from './build-server.js'
import type { LoadedService, ServiceName } from './registry.js'
import { defineEmulator } from '@emulators/core'
import { buildServiceServer } from './build-server.js'

type ServiceSeed = Record<string, unknown>

function isPlainObject(value: unknown): value is ServiceSeed {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function defineServiceEmulator(service: ServiceName, loaded: LoadedService): EmulatorDefinition<ServiceSeed> {
  return defineEmulator<ServiceSeed>({
    name: service,
    state: () => ({}),
    validateSeed(value) {
      if (!isPlainObject(value)) {
        throw new TypeError(`Invalid seed for "${service}": expected an object`)
      }
      return value
    },
    setup({ app, state, baseUrl }) {
      const tokens = state.tokens as TokenSeed | undefined
      const inner = buildServiceServer({ service, loaded, port: 0, baseUrl, tokens, svcSeedConfig: state })
      app.use(c => inner.app.fetch(c.req.raw))
    },
  })
}
