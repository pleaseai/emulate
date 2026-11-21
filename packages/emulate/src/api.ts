import type { ServiceName } from './registry.js'
import { serve } from '@emulators/core'
import { resolveBaseUrl } from './base-url.js'
import { buildServiceServer } from './build-server.js'
import { SERVICE_REGISTRY } from './registry.js'

export type { ServiceName } from './registry.js'
export { SERVICE_NAMES } from './registry.js'

export interface SeedConfig {
  tokens?: Record<string, { login: string, scopes?: string[] }>
  [service: string]: unknown
}

export interface EmulatorOptions {
  service: ServiceName
  port?: number
  seed?: SeedConfig
  baseUrl?: string
}

export interface Emulator {
  url: string
  reset: () => void
  close: () => Promise<void>
}

export async function createEmulator(options: EmulatorOptions): Promise<Emulator> {
  const { service, port = 4000, seed: seedConfig } = options

  const entry = SERVICE_REGISTRY[service]
  if (!entry) {
    throw new Error(`Unknown service: ${service}`)
  }

  const loaded = await entry.load()

  const svcSeedConfig = seedConfig?.[service] as Record<string, unknown> | undefined
  const seedBaseUrl
    = typeof svcSeedConfig?.baseUrl === 'string' && svcSeedConfig.baseUrl.length > 0 ? svcSeedConfig.baseUrl : undefined
  const baseUrl = resolveBaseUrl({ service, port, baseUrl: options.baseUrl, seedBaseUrl })

  const { app, store, seed } = buildServiceServer({
    service,
    loaded,
    port,
    baseUrl,
    tokens: seedConfig?.tokens,
    svcSeedConfig,
  })

  const httpServer = serve({ fetch: app.fetch, port })

  return {
    url: baseUrl,
    reset() {
      store.reset()
      seed()
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            reject(err)
          }
          else {
            resolve()
          }
        })
      })
    },
  }
}
