import type { ServiceName } from './registry.js'

export interface ResolveBaseUrlOptions {
  service: ServiceName
  port: number
  baseUrl?: string
  seedBaseUrl?: string
}

export function resolveBaseUrl(options: ResolveBaseUrlOptions): string {
  if (options.baseUrl) {
    return options.baseUrl.replace(/\/$/, '')
  }
  if (options.seedBaseUrl) {
    return options.seedBaseUrl.replace(/\/$/, '')
  }
  return `http://localhost:${options.port}`
}
