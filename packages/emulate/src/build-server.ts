import type { AppKeyResolver, AuthFallback } from '@emulators/core'
import type { LoadedService, ServiceName } from './registry.js'
import { createServer } from '@emulators/core'
import { SERVICE_REGISTRY } from './registry.js'

type TokenMap = Record<string, { login: string, id: number, scopes?: string[] }>
export type TokenSeed = Record<string, { login: string, scopes?: string[] }>

export function buildTokens(tokenSeed?: TokenSeed): TokenMap {
  if (!tokenSeed) {
    return { test_token_admin: { login: 'admin', id: 2, scopes: [] } }
  }
  const tokens: TokenMap = {}
  let tokenId = 100
  for (const [token, user] of Object.entries(tokenSeed)) {
    tokens[token] = { login: user.login, id: tokenId++, scopes: user.scopes }
  }
  return tokens
}

export interface BuildServerOptions {
  service: ServiceName
  loaded: LoadedService
  port: number
  baseUrl: string
  tokens?: TokenSeed
  svcSeedConfig?: Record<string, unknown>
}

export function buildServiceServer(options: BuildServerOptions) {
  const { service, loaded, port, baseUrl, svcSeedConfig } = options

  let cachedResolver: AppKeyResolver | undefined
  const appKeyResolver: AppKeyResolver | undefined = loaded.createAppKeyResolver
    ? appId => cachedResolver!(appId)
    : undefined

  const fallbackUser: AuthFallback = SERVICE_REGISTRY[service].defaultFallback(svcSeedConfig)

  const { app, store, webhooks } = createServer(loaded.plugin, {
    port,
    baseUrl,
    tokens: buildTokens(options.tokens),
    appKeyResolver,
    fallbackUser,
  })
  cachedResolver = loaded.createAppKeyResolver?.(store)

  const seed = () => {
    loaded.plugin.seed?.(store, baseUrl)
    if (svcSeedConfig && loaded.seedFromConfig) {
      loaded.seedFromConfig(store, baseUrl, svcSeedConfig, webhooks)
    }
  }
  seed()

  return { app, store, webhooks, seed }
}
