import type { ContentfulStatusCode, Context, Next, Store } from '@emulators/core'
import { getAsanaStore } from './store.js'

const API_PREFIX = '/api/1.0'

export interface AsanaFailureRuleInput {
  /** HTTP method to match, case-insensitive. Omit to match any method. */
  method?: string
  /**
   * Path to match, with or without the `/api/1.0` prefix. `:name` matches one segment and a trailing
   * `*` matches the rest of the path. Omit to match every API path.
   */
  path?: string
  /** Response status. Defaults to 429. */
  status?: number
  /** How many matching requests fail before the rule is used up. Defaults to 1. */
  times?: number
  /** Extra response headers. A 429 without `Retry-After` gets `Retry-After: 1`. */
  headers?: Record<string, string>
  /** Error message in the `{ errors: [{ message }] }` body. Defaults to a message for the status. */
  message?: string
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Not Authorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'You have made too many requests recently. Please, be chill.',
  500: 'Server Error',
  503: 'Service Unavailable',
}

function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0]
  const absolute = withoutQuery.startsWith(API_PREFIX) ? withoutQuery : `${API_PREFIX}/${withoutQuery.replace(/^\/+/, '')}`
  return absolute.length > 1 ? absolute.replace(/\/+$/, '') : absolute
}

function pathMatches(pattern: string, path: string): boolean {
  const want = pattern.split('/')
  const got = normalizePath(path).split('/')
  for (let i = 0; i < want.length; i++) {
    if (want[i] === '*' && i === want.length - 1) {
      return got.length > i
    }
    if (i >= got.length) {
      return false
    }
    if (want[i].startsWith(':') ? got[i] === '' : want[i] !== got[i]) {
      return false
    }
  }
  return want.length === got.length
}

/**
 * Makes the next matching request(s) fail with an Asana-shaped error. Rules are checked in the order
 * they were added; the first one that matches fires and counts down.
 */
export function failNext(store: Store, rule: AsanaFailureRuleInput = {}): void {
  const status = rule.status ?? 429
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError(`failNext: status must be an integer from 400 to 599, got ${status}`)
  }
  const times = rule.times ?? 1
  if (!Number.isInteger(times) || times < 1) {
    throw new RangeError(`failNext: times must be a positive integer, got ${times}`)
  }

  const headers = { ...rule.headers }
  if (status === 429 && !Object.keys(headers).some(k => k.toLowerCase() === 'retry-after')) {
    headers['Retry-After'] = '1'
  }

  getAsanaStore(store).failureRules.insert({
    method: rule.method ? rule.method.toUpperCase() : null,
    path: rule.path ? normalizePath(rule.path) : null,
    status,
    remaining: times,
    headers,
    message: rule.message ?? null,
  })
}

/** Removes every pending failure rule. */
export function clearFailures(store: Store): void {
  getAsanaStore(store).failureRules.clear()
}

export function failureMiddleware(store: Store) {
  return async (c: Context, next: Next) => {
    const rules = getAsanaStore(store).failureRules
    const method = c.req.method.toUpperCase()
    const rule = rules.all().find(r =>
      (r.method === null || r.method === method) && (r.path === null || pathMatches(r.path, c.req.path)),
    )
    if (!rule) {
      return next()
    }

    if (rule.remaining <= 1) {
      rules.delete(rule.id)
    }
    else {
      rules.update(rule.id, { remaining: rule.remaining - 1 })
    }
    const message = rule.message ?? DEFAULT_MESSAGES[rule.status] ?? 'Request failed'
    return c.json({ errors: [{ message }] }, rule.status as ContentfulStatusCode, rule.headers)
  }
}
