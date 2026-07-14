#!/usr/bin/env bun
import type { ServicePlugin, Store, WebhookDispatcher } from '@emulators/core'
/**
 * Single-process launcher that runs THIS repo's emulators and the upstream
 * vercel-labs `@emulators/*` emulators together — one command, one process.
 *
 * Both sides now target the same `@emulators/core` (0.9.x), which is hoisted to
 * a single physical module. That lets this one process host every service:
 *   - this repo's services go through `@pleaseai/emulate`'s `createEmulator`
 *   - vercel-labs services are mounted directly on the shared core via
 *     `createServer` + `serve`.
 *
 * Every service gets a STABLE, distinct port from its own registry index (never
 * from its position in the selection), and the two projects live in separate
 * ranges so selecting a subset never renumbers anything and the ranges can't
 * overlap:
 *   - this repo:   base 4000  (kakao 4000, naver 4001, … x 4012)
 *   - vercel-labs: base 4100  (vercel 4100, github 4101, … mongoatlas 4111)
 *
 *   bun run emulate:all                            # every service, both ranges
 *   bun run emulate:all -- --service kakao,github,stripe
 *   bun run emulate:all -- --port 5000             # this-repo base (vercel → 5100)
 *   bun run emulate:all -- --port 5000 --vercel-port 6000
 *   bun run emulate:all -- --config ./emulate.config.yaml
 *
 * With an emulate.config.{yaml,yml,json} present (auto-detected), only the
 * services keyed in it start, and their `<service>:` sections seed them.
 */
import type { Emulator, SeedConfig, ServiceName } from '@pleaseai/emulate'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { createServer, serve } from '@emulators/core'
import { createEmulator, SERVICE_NAMES } from '@pleaseai/emulate'
import pc from 'picocolors'
import { parse as parseYaml } from 'yaml'

/** vercel-labs services, each a standalone `@emulators/*` package on the shared core. */
const VERCEL_CATALOG: Record<string, { pkg: string, label: string }> = {
  vercel: { pkg: '@emulators/vercel', label: 'Vercel REST API' },
  github: { pkg: '@emulators/github', label: 'GitHub REST API' },
  google: { pkg: '@emulators/google', label: 'Google OAuth/OIDC + Gmail/Calendar/Drive' },
  slack: { pkg: '@emulators/slack', label: 'Slack Web API' },
  apple: { pkg: '@emulators/apple', label: 'Apple Sign In / OAuth' },
  microsoft: { pkg: '@emulators/microsoft', label: 'Microsoft Entra ID OAuth/OIDC' },
  okta: { pkg: '@emulators/okta', label: 'Okta OAuth/OIDC + management API' },
  aws: { pkg: '@emulators/aws', label: 'AWS S3 / SQS / IAM / STS' },
  resend: { pkg: '@emulators/resend', label: 'Resend email API' },
  stripe: { pkg: '@emulators/stripe', label: 'Stripe payments' },
  clerk: { pkg: '@emulators/clerk', label: 'Clerk auth / user management' },
  mongoatlas: { pkg: '@emulators/mongoatlas', label: 'MongoDB Atlas Admin + Data API' },
}

// Canonical order = the stable per-service port index within each range.
const PLEASE_ORDER: readonly string[] = [...SERVICE_NAMES]
const VERCEL_ORDER: readonly string[] = Object.keys(VERCEL_CATALOG)
const PLEASE_SET = new Set<string>(PLEASE_ORDER)
const VERCEL_SET = new Set<string>(VERCEL_ORDER)

interface Running {
  name: string
  origin: 'this-repo' | 'vercel-labs'
  port: number
  url: string
  close: () => Promise<void>
}

interface Args {
  port?: number
  vercelPort?: number
  service?: string
  config?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  // A present-but-non-numeric port flag is a user error, not something to
  // silently drop back to the default — fail loudly.
  const intFlag = (flag: string, raw: string | undefined): number => {
    const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
    if (Number.isNaN(value)) {
      console.error(`${flag} requires a numeric value (got: ${raw ?? '<missing>'})`)
      process.exit(1)
    }
    return value
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') {
      args.port = intFlag('--port', argv[++i])
    }
    else if (arg === '--vercel-port') {
      args.vercelPort = intFlag('--vercel-port', argv[++i])
    }
    else if (arg === '--service') {
      // A missing or empty --service value must not silently fall through to
      // "start everything" — reject the malformed invocation. A value made only
      // of separators (e.g. ",") is caught later in resolveServices once it
      // resolves to an empty name list.
      const value = argv[++i]
      if (!value) {
        console.error('--service requires a comma-separated list of service names')
        process.exit(1)
      }
      args.service = value
    }
    else if (arg === '--config') {
      args.config = argv[++i]
    }
  }
  return args
}

/** Base port fallback: --port > EMULATE_PORT > PORT > 4000. */
function basePortFrom(args: Args): number {
  if (args.port !== undefined && !Number.isNaN(args.port)) {
    return args.port
  }
  for (const raw of [process.env.EMULATE_PORT, process.env.PORT]) {
    const port = raw ? Number.parseInt(raw, 10) : Number.NaN
    if (!Number.isNaN(port)) {
      return port
    }
  }
  return 4000
}

/** vercel-labs base port: --vercel-port > EMULATE_VERCEL_PORT > pleaseBase + 100. */
function vercelBaseFrom(args: Args, pleaseBase: number): number {
  if (args.vercelPort !== undefined && !Number.isNaN(args.vercelPort)) {
    return args.vercelPort
  }
  const env = process.env.EMULATE_VERCEL_PORT ? Number.parseInt(process.env.EMULATE_VERCEL_PORT, 10) : Number.NaN
  return Number.isNaN(env) ? pleaseBase + 100 : env
}

/** Stable port for a service: its base plus its fixed index in the canonical list. */
function portFor(name: string, pleaseBase: number, vercelBase: number): number {
  return PLEASE_SET.has(name)
    ? pleaseBase + PLEASE_ORDER.indexOf(name)
    : vercelBase + VERCEL_ORDER.indexOf(name)
}

function loadConfig(explicit?: string): { config: SeedConfig, source: string } | null {
  const candidates = explicit
    ? [explicit]
    : ['emulate.config.yaml', 'emulate.config.yml', 'emulate.config.json']
  for (const file of candidates) {
    if (!existsSync(file)) {
      if (explicit) {
        console.error(`Config file not found: ${file}`)
        process.exit(1)
      }
      continue
    }
    const content = readFileSync(file, 'utf-8')
    try {
      const config = file.endsWith('.json') ? JSON.parse(content) : parseYaml(content)
      return { config, source: file }
    }
    catch (err) {
      console.error(`Failed to parse ${file}: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  }
  return null
}

function resolveServices(args: Args, config: SeedConfig | null): string[] {
  if (args.service) {
    // Dedupe: two identical names would map to the same port and crash on bind.
    const names = [...new Set(args.service.split(',').map(s => s.trim()).filter(Boolean))]
    if (names.length === 0) {
      console.error('--service did not list any service names (check for stray commas)')
      process.exit(1)
    }
    return names
  }
  if (config) {
    const inferred = Object.keys(config).filter(k => PLEASE_SET.has(k) || VERCEL_SET.has(k))
    if (inferred.length > 0) {
      return inferred
    }
    // Config present but no key matched a service — make the fallback visible.
    console.warn(pc.yellow('  ⚠ No known service keys in config — starting all services.'))
  }
  return [...SERVICE_NAMES, ...Object.keys(VERCEL_CATALOG)]
}

/** Mirrors @pleaseai/emulate's token handling so vercel services share the convention. */
function buildTokens(seed?: SeedConfig): Record<string, { login: string, id: number, scopes?: string[] }> {
  const tokens: Record<string, { login: string, id: number, scopes?: string[] }> = {}
  if (seed?.tokens) {
    let id = 100
    for (const [token, user] of Object.entries(seed.tokens)) {
      tokens[token] = { login: user.login, id: id++, scopes: user.scopes }
    }
  }
  else {
    tokens.test_token_admin = { login: 'admin', id: 2, scopes: [] }
  }
  return tokens
}

async function startVercel(name: string, port: number, config: SeedConfig | null): Promise<Running> {
  const { pkg } = VERCEL_CATALOG[name]
  const mod = await import(pkg) as {
    default: ServicePlugin
    seedFromConfig?: (store: Store, baseUrl: string, svcConfig: unknown, webhooks?: WebhookDispatcher) => void
  }
  const plugin = mod.default
  if (!plugin) {
    throw new Error(`${pkg} has no default export (expected a ServicePlugin)`)
  }
  const baseUrl = `http://localhost:${port}`
  const { app, store, webhooks } = createServer(plugin, { port, baseUrl, tokens: buildTokens(config ?? undefined) })

  plugin.seed?.(store, baseUrl)
  const svcConfig = config?.[name]
  if (svcConfig && mod.seedFromConfig) {
    // Thread the dispatcher through — some services (e.g. stripe) register
    // webhook subscriptions from config only when it is provided.
    mod.seedFromConfig(store, baseUrl, svcConfig, webhooks)
  }

  const server = serve({ fetch: app.fetch, port })
  // serve() binds the port asynchronously — an occupied port surfaces on the
  // server's 'error' event, not as a throw. Wait for readiness so that failure
  // rejects startVercel and reaches main()'s try/catch (which closes the
  // services already started) instead of crashing the whole launcher.
  await new Promise<void>((resolve, reject) => {
    function onListening(): void {
      server.off('error', onError)
      resolve()
    }
    function onError(err: Error): void {
      server.off('listening', onListening)
      reject(err)
    }
    server.once('listening', onListening)
    server.once('error', onError)
  })
  return {
    name,
    origin: 'vercel-labs',
    port,
    url: baseUrl,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
        else {
          resolve()
        }
      })
    }),
  }
}

async function startPlease(name: string, port: number, config: SeedConfig | null): Promise<Running> {
  const emulator: Emulator = await createEmulator({ service: name as ServiceName, port, seed: config ?? undefined })
  return { name, origin: 'this-repo', port, url: emulator.url, close: () => emulator.close() }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const pleaseBase = basePortFrom(args)
  const vercelBase = vercelBaseFrom(args, pleaseBase)
  const loaded = loadConfig(args.config)
  const config = loaded?.config ?? null

  const services = resolveServices(args, config)
  for (const name of services) {
    if (!PLEASE_SET.has(name) && !VERCEL_SET.has(name)) {
      console.error(`Unknown service: ${name}`)
      console.error(`  this repo:   ${PLEASE_ORDER.join(', ')}`)
      console.error(`  vercel-labs: ${VERCEL_ORDER.join(', ')}`)
      process.exit(1)
    }
  }

  const usesPlease = services.some(n => PLEASE_SET.has(n))
  const usesVercel = services.some(n => VERCEL_SET.has(n))

  // A base port of 0 (Bun would bind a random port, so the printed localhost:0
  // URLs and seeded endpoints are wrong) or one so high the range spills past
  // 65535 is unusable. Reject it for whichever range is in use — this covers
  // both --port/--vercel-port and the EMULATE_*_PORT env fallbacks.
  const MAX_PORT = 65535
  for (const [flag, base, span, inUse] of [
    ['--port', pleaseBase, PLEASE_ORDER.length, usesPlease],
    ['--vercel-port', vercelBase, VERCEL_ORDER.length, usesVercel],
  ] as const) {
    if (inUse && (base < 1 || base + span - 1 > MAX_PORT)) {
      console.error(`${flag} base ${base} is out of range — it must be ≥ 1 and leave room for ${span} consecutive ports at or below ${MAX_PORT}.`)
      process.exit(1)
    }
  }

  // Guard the two ranges against overlap, but only when both are actually in use.
  if (usesPlease && usesVercel
    && pleaseBase < vercelBase + VERCEL_ORDER.length
    && vercelBase < pleaseBase + PLEASE_ORDER.length) {
    console.error(`Port ranges overlap: this-repo [${pleaseBase}..${pleaseBase + PLEASE_ORDER.length - 1}] vs vercel-labs base ${vercelBase}.`)
    console.error('Raise --vercel-port (or lower --port) so the ranges are disjoint.')
    process.exit(1)
  }

  const running: Running[] = []
  const shutdown = async (code = 0): Promise<void> => {
    console.log()
    console.log(pc.dim('  Shutting down...'))
    const results = await Promise.allSettled(running.map(r => r.close()))
    for (let i = 0; i < results.length; i++) {
      const res = results[i]
      if (res.status === 'rejected') {
        console.error(pc.dim(`  Failed to close ${running[i].name}: ${res.reason instanceof Error ? res.reason.message : res.reason}`))
      }
    }
    process.exit(code)
  }
  process.on('SIGINT', () => void shutdown(0))
  process.on('SIGTERM', () => void shutdown(0))

  let starting = ''
  try {
    for (const name of services) {
      starting = name
      const port = portFor(name, pleaseBase, vercelBase)
      running.push(PLEASE_SET.has(name) ? await startPlease(name, port, config) : await startVercel(name, port, config))
    }
  }
  catch (err) {
    console.error(`\n  Failed to start ${starting}: ${err instanceof Error ? err.stack ?? err.message : err}`)
    await shutdown(1)
    return
  }

  console.log()
  console.log(`  ${pc.bold('emulate:all')}${pc.dim(' — this repo + vercel-labs in one process')}`)
  console.log()
  if (loaded) {
    console.log(pc.dim(`  seed config: ${loaded.source}`))
    console.log()
  }
  for (const r of [...running].sort((a, b) => a.port - b.port)) {
    const tag = r.origin === 'this-repo' ? pc.cyan('[this-repo]  ') : pc.magenta('[vercel-labs]')
    const label = r.origin === 'vercel-labs' ? pc.dim(VERCEL_CATALOG[r.name].label) : ''
    console.log(`  ${pc.green('●')} ${tag} ${pc.bold(r.name.padEnd(12))} ${r.url}  ${label}`)
  }
  console.log()
  console.log(pc.dim('  Press Ctrl+C to stop'))
}

void main()
