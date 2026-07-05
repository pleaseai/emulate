import process from 'node:process'

export interface BaseUrlOptions {
  baseUrl?: string
  portless?: boolean
}

/** Base port fallback: --port flag > EMULATE_PORT > PORT > 4000. */
export function defaultBasePort(): number {
  for (const raw of [process.env.EMULATE_PORT, process.env.PORT]) {
    if (raw) {
      const port = Number.parseInt(raw, 10)
      if (!Number.isNaN(port)) {
        return port
      }
    }
  }
  return 4000
}

/** Returns an error message when the base URL flags are inconsistent, else null. */
export function validateBaseUrlOptions(options: BaseUrlOptions, serviceCount: number): string | null {
  if (options.portless && options.baseUrl) {
    return '--portless and --base-url are mutually exclusive.'
  }
  if (options.baseUrl && serviceCount > 1 && !options.baseUrl.includes('{service}')) {
    return '--base-url with multiple services requires a {service} placeholder, e.g. https://{service}.myproxy.test'
  }
  return null
}
