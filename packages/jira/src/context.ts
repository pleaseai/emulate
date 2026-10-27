import type { AppEnv, Context, Store } from '@emulators/core'
import type { JiraUser } from './entities.js'
import type { JiraStore } from './store.js'
import { Buffer } from 'node:buffer'
import { getJiraStore } from './store.js'

export const GATEWAY_HEADER = 'x-emulate-jira-cloud-id'

export const API_V = '/rest/api/:v{[23]}'

export const READ = ['read:jira-work']
export const WRITE = ['write:jira-work']
export const MANAGE = ['manage:jira-project', 'manage:jira-configuration']

export class JiraError extends Error {
  constructor(
    public status: number,
    public errorMessages: string[] = [],
    public errors: Record<string, string> = {},
  ) {
    super(errorMessages[0] ?? Object.values(errors)[0] ?? 'Jira error')
    this.name = 'JiraError'
  }
}

export function issueNotFound() {
  return new JiraError(404, ['Issue does not exist or you do not have permission to see it.'])
}

export const fieldError = (field: string, message: string) => new JiraError(400, [], { [field]: message })

export interface JiraRequest {
  c: Context<AppEnv>
  store: Store
  js: JiraStore
  version: '2' | '3'
  siteUrl: string
  baseUrl: string
  user: JiraUser
  scopes: string[] | null
  clientId: string | null
}

export interface PublicJiraRequest extends Omit<JiraRequest, 'user' | 'scopes'> {
  user: JiraUser | null
  scopes: string[] | null
}

export interface HandlerOptions {
  auth?: boolean
  scopes?: string[]
}

type JiraHandler = (r: JiraRequest) => Response | Promise<Response>
type PublicJiraHandler = (r: PublicJiraRequest) => Response | Promise<Response>
type RouteHandler = (c: Context<AppEnv>) => Promise<Response>

export function jiraErrorResponse(c: Context<AppEnv>, err: JiraError): Response {
  return c.json({ errorMessages: err.errorMessages, errors: err.errors }, err.status)
}

export function makeHandler(store: Store, baseUrl: string) {
  function handle(fn: PublicJiraHandler, opts: HandlerOptions & { auth: false }): RouteHandler
  function handle(fn: JiraHandler, opts?: HandlerOptions): RouteHandler
  function handle(fn: JiraHandler | PublicJiraHandler, opts: HandlerOptions = {}) {
    return async (c: Context<AppEnv>): Promise<Response> => {
      try {
        const js = getJiraStore(store)
        const version = c.req.param('v') === '2' ? '2' : '3'
        const gatewayCloudId = c.req.header(GATEWAY_HEADER)
        const siteUrl = gatewayCloudId ? `${baseUrl}/ex/jira/${gatewayCloudId}` : baseUrl
        let user: JiraUser | undefined
        let scopes: string[] | null = null
        let clientId: string | null = null
        const auth = authenticate(c, js)
        if (auth) {
          user = auth.user
          scopes = auth.scopes
          clientId = auth.clientId
        }
        else if (opts.auth !== false) {
          throw new JiraError(401, ['Client must be authenticated to access this resource.'])
        }
        if (opts.scopes && scopes && store.getData<boolean>('jira.strict_scopes')) {
          if (!opts.scopes.some(scope => scopes!.includes(scope))) {
            throw new JiraError(401, [
              `Unauthorized; scope does not match. Required one of: ${opts.scopes.join(', ')}`,
            ])
          }
        }
        const request = { c, store, js, version, siteUrl, baseUrl, scopes, clientId } as const
        if (opts.auth === false) {
          return await (fn as PublicJiraHandler)({ ...request, user: user ?? null })
        }
        return await (fn as JiraHandler)({ ...request, user: user! })
      }
      catch (err) {
        if (err instanceof JiraError) {
          return jiraErrorResponse(c, err)
        }
        throw err
      }
    }
  }
  return handle
}

interface AuthResult {
  user: JiraUser
  scopes: string[] | null
  clientId: string | null
}

export function authenticate(c: Context<AppEnv>, js: JiraStore): AuthResult | undefined {
  const header = c.req.header('Authorization')
  if (!header) {
    return undefined
  }
  const unauthorized = () => new JiraError(401, ['Client must be authenticated to access this resource.'])

  const basic = /^Basic\s+(\S+)\s*$/i.exec(header)
  if (basic) {
    const decoded = Buffer.from(basic[1].trim(), 'base64').toString('utf-8')
    const sep = decoded.indexOf(':')
    if (sep < 0) {
      throw unauthorized()
    }
    const email = decoded.slice(0, sep).toLowerCase()
    const secret = decoded.slice(sep + 1)
    const user = js.users.all().find(u => u.email.toLowerCase() === email)
    if (!user || !user.active) {
      throw unauthorized()
    }
    const valid = js.apiTokens.findBy('account_id', user.account_id).some(t => t.token === secret)
    if (!valid) {
      throw unauthorized()
    }
    return { user, scopes: null, clientId: null }
  }

  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (bearer) {
    const value = bearer[1].trim()
    const apiToken = js.apiTokens.findOneBy('token', value)
    if (apiToken) {
      const user = js.users.findOneBy('account_id', apiToken.account_id)
      if (user?.active) {
        return { user, scopes: null, clientId: null }
      }
      throw unauthorized()
    }
    const oauth = js.oauthTokens.findOneBy('token', value)
    if (!oauth || oauth.type !== 'access' || oauth.revoked) {
      throw unauthorized()
    }
    if (oauth.expires_at && new Date(oauth.expires_at).getTime() <= Date.now()) {
      throw unauthorized()
    }
    const user = js.users.findOneBy('account_id', oauth.account_id)
    if (!user?.active) {
      throw unauthorized()
    }
    return { user, scopes: oauth.scopes, clientId: oauth.client_id }
  }

  throw unauthorized()
}

export async function readJson(c: Context<AppEnv>): Promise<any> {
  const body = await readJsonValue(c)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new JiraError(400, ['Request body must be a JSON object.'])
  }
  return body
}

export async function readJsonValue(c: Context<AppEnv>): Promise<any> {
  const text = await c.req.text()
  if (!text.trim()) {
    return {}
  }
  try {
    return JSON.parse(text)
  }
  catch (err) {
    const detail = err instanceof Error ? err.message : 'Invalid JSON'
    throw new JiraError(400, [`Unexpected character in request body: ${detail}`])
  }
}

export function isCalendarDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isIsoDate(value: unknown): value is string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  return !!match && isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
}

export function intParam(
  value: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
  name = 'parameter',
): number {
  if (value === undefined || value === '') {
    return fallback
  }
  if (!/^\d+$/.test(value)) {
    throw new JiraError(400, [`Invalid value '${value}' for ${name}; expected a non-negative integer.`])
  }
  return Math.min(Number(value), max)
}

export interface PageParams {
  startAt: number
  maxResults: number
}

export function pageParams(c: Context<AppEnv>, defaultMax: number, cap?: number): PageParams {
  return {
    startAt: intParam(c.req.query('startAt'), 0, undefined, 'startAt'),
    maxResults: intParam(c.req.query('maxResults'), defaultMax, cap, 'maxResults'),
  }
}

export function listParam(c: Context<AppEnv>, name: string): string[] {
  return (c.req.queries(name) ?? [])
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
}
