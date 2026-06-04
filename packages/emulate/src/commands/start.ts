import type { Emulator, SeedConfig } from '../api.js'
import type { ServiceName } from '../registry.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import pc from 'picocolors'
import { parse as parseYaml } from 'yaml'
import { createEmulator } from '../api.js'
import { SERVICE_NAMES, SERVICE_REGISTRY } from '../registry.js'

export interface StartOptions {
  port: number
  service?: string
  seed?: string
  baseUrl?: string
}

interface LoadResult {
  config: SeedConfig
  source: string
}

function loadSeedConfig(seedPath?: string): LoadResult | null {
  if (seedPath) {
    const fullPath = resolve(seedPath)
    if (!existsSync(fullPath)) {
      console.error(`Seed file not found: ${fullPath}`)
      process.exit(1)
    }
    const content = readFileSync(fullPath, 'utf-8')
    try {
      const config = fullPath.endsWith('.json') ? JSON.parse(content) : parseYaml(content)
      return { config, source: seedPath }
    }
    catch (err) {
      console.error(`Failed to parse ${seedPath}: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  }

  const autoFiles = ['emulate.config.yaml', 'emulate.config.yml', 'emulate.config.json']

  for (const file of autoFiles) {
    const fullPath = resolve(file)
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8')
      try {
        const config = fullPath.endsWith('.json') ? JSON.parse(content) : parseYaml(content)
        return { config, source: file }
      }
      catch (err) {
        console.error(`Failed to parse ${file}: ${err instanceof Error ? err.message : err}`)
        process.exit(1)
      }
    }
  }

  return null
}

function inferServicesFromConfig(config: SeedConfig): ServiceName[] | null {
  const found = SERVICE_NAMES.filter(k => k in config)
  return found.length > 0 ? [...found] : null
}

export async function startCommand(options: StartOptions): Promise<void> {
  const { port: basePort } = options

  const loaded = loadSeedConfig(options.seed)
  const seedConfig = loaded?.config ?? null
  const configSource = loaded?.source ?? null

  let services: ServiceName[]
  if (options.service) {
    services = options.service.split(',').map(s => s.trim()) as ServiceName[]
  }
  else if (seedConfig) {
    services = inferServicesFromConfig(seedConfig) ?? [...SERVICE_NAMES]
  }
  else {
    services = [...SERVICE_NAMES]
  }

  for (const svc of services) {
    if (!SERVICE_NAMES.includes(svc)) {
      console.error(`Unknown service: ${svc}`)
      console.error(`Available services: ${SERVICE_NAMES.join(', ')}`)
      process.exit(1)
    }
  }

  if (options.baseUrl && services.length > 1) {
    console.error('--base-url can only be used with a single service (--service).')
    process.exit(1)
  }

  const emulators: Array<{ service: ServiceName, emulator: Emulator }> = []

  for (let i = 0; i < services.length; i++) {
    const service = services[i]
    const port = basePort + i
    const emulator = await createEmulator({
      service,
      port,
      seed: seedConfig ?? undefined,
      baseUrl: services.length === 1 ? options.baseUrl : undefined,
    })
    emulators.push({ service, emulator })
  }

  console.log()
  console.log(pc.bold('  emulate') + pc.dim(' — local service emulators'))
  console.log()
  if (configSource) {
    console.log(pc.dim(`  seed config: ${configSource}`))
    console.log()
  }
  for (const { service, emulator } of emulators) {
    const entry = SERVICE_REGISTRY[service]
    console.log(`  ${pc.green('●')} ${pc.bold(service.padEnd(14))} ${emulator.url}`)
    console.log(`    ${pc.dim(entry.endpoints)}`)
  }
  console.log()
  console.log(pc.dim('  Press Ctrl+C to stop'))

  const shutdown = async () => {
    console.log()
    console.log(pc.dim('  Shutting down...'))
    await Promise.all(emulators.map(({ emulator }) => emulator.close().catch(() => {})))
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
