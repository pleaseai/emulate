import type { ServiceName } from './registry.js'
import process from 'node:process'

export interface ResolveBaseUrlOptions {
  service: ServiceName
  port: number
  baseUrl?: string
  seedBaseUrl?: string
}

function normalize(url: string, service: ServiceName): string {
  return url.replaceAll('{service}', service).replace(/\/$/, '')
}

/**
 * Fallback chain (matches upstream vercel-labs/emulate):
 * 1. Per-service baseUrl from seed config
 * 2. Explicit baseUrl (CLI flag or programmatic option)
 * 3. EMULATE_BASE_URL env var
 * 4. PORTLESS_URL env var (set by the portless CLI wrapper)
 * 5. http://localhost:<port>
 * All sources support {service} interpolation.
 */
export function resolveBaseUrl(options: ResolveBaseUrlOptions): string {
  if (options.seedBaseUrl) {
    return normalize(options.seedBaseUrl, options.service)
  }
  if (options.baseUrl) {
    return normalize(options.baseUrl, options.service)
  }
  if (process.env.EMULATE_BASE_URL) {
    return normalize(process.env.EMULATE_BASE_URL, options.service)
  }
  if (process.env.PORTLESS_URL) {
    return normalize(process.env.PORTLESS_URL, options.service)
  }
  return `http://localhost:${options.port}`
}
