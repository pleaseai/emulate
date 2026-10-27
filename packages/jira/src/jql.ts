import type { JiraIssue, JiraUser } from './entities.js'
import type { EvalContext, FieldHandler, Resolved, Scalar } from './jql-fields.js'
import type { JqlNode, JqlQuery, Operand, OrderBy } from './jql-parser.js'
import type { JiraStore } from './store.js'
import { callFunction, DAY, parseDateLiteral } from './jql-dates.js'
import { eqi, MATCHES_EMPTY, resolveFieldHandler, sortHandler } from './jql-fields.js'
import { JqlError, parseJql } from './jql-parser.js'

export { JqlError, parseJql } from './jql-parser.js'
export type { JqlNode, JqlQuery, Operand, OrderBy } from './jql-parser.js'

function resolveOperand(handler: FieldHandler, operand: Operand, ctx: EvalContext): Resolved {
  if (operand.kind === 'empty') {
    return { empty: true }
  }
  if (operand.kind === 'fn') {
    return { empty: false, values: callFunction(operand, ctx) }
  }
  if (handler.kind === 'date') {
    const parsed = parseDateLiteral(operand.value, ctx)
    return { empty: false, values: [parsed.time], dayPrecision: parsed.dayPrecision }
  }
  if (handler.kind === 'text') {
    return { empty: false, values: [operand.value] }
  }
  if (handler.kind === 'number') {
    const number = Number(operand.value)
    if (!Number.isFinite(number)) {
      throw new JqlError(`The value '${operand.value}' is not a valid number for '${handler.name}'.`)
    }
    return { empty: false, values: [number] }
  }
  const values = handler.resolve ? handler.resolve(operand.value, ctx) : [operand.value]
  return values === MATCHES_EMPTY ? { empty: true } : { empty: false, values }
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function textMatches(haystack: string, query: string): boolean {
  const trimmed = query.trim()
  const phrase = /^"(.*)"$/.exec(trimmed)
  if (phrase) {
    return haystack.toLowerCase().includes(phrase[1].toLowerCase())
  }
  const words = wordsOf(haystack)
  const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((term) => {
    const prefix = term.replace(/[*?]+$/, '').replace(/[^\p{L}\p{N}]/gu, '')
    if (!prefix) {
      return true
    }
    return words.some(word => word.startsWith(prefix))
  })
}

function compileClause(node: Extract<JqlNode, { type: 'clause' }>, ctx: EvalContext): (issue: JiraIssue) => boolean {
  const handler = resolveFieldHandler(ctx.js, node.field)
  const op = node.op.toLowerCase()

  if (op === 'is' || op === 'is not') {
    return issue => (handler.get(issue, ctx).length === 0) === (op === 'is')
  }

  if (op === '~' || op === '!~') {
    if (handler.kind !== 'text') {
      throw new JqlError(`The operator '${node.op}' is not supported by the '${node.field}' field.`)
    }
    const operand = node.operands[0]
    if (operand.kind !== 'value') {
      throw new JqlError(`The operator '${node.op}' requires a text value.`)
    }
    return (issue) => {
      const text = handler.get(issue, ctx)[0]
      const matches = text !== undefined && textMatches(String(text), operand.value)
      return op === '~' ? matches : text !== undefined && !matches
    }
  }

  const operands = node.listFn ? [node.listFn] : node.operands
  const resolved = operands.map(operand => resolveOperand(handler, operand, ctx))
  const wantsEmpty = resolved.some(entry => entry.empty)
  const values = resolved.flatMap(entry => (entry.empty ? [] : entry.values))
  const dayPrecision = resolved.some(entry => !entry.empty && entry.dayPrecision)

  const eq = (a: Scalar, b: Scalar) =>
    handler.kind === 'date' && dayPrecision
      ? Math.floor(Number(a) / DAY) === Math.floor(Number(b) / DAY)
      : typeof a === 'string' && typeof b === 'string'
        ? eqi(a, b)
        : a === b

  const matchesAny = (issue: JiraIssue) => {
    const current = handler.get(issue, ctx)
    if (current.length === 0) {
      return wantsEmpty
    }
    return current.some(value => values.some(candidate => eq(value, candidate)))
  }

  if (op === '=' || op === 'in') {
    return matchesAny
  }
  if (op === '!=' || op === 'not in') {
    // Like Jira, negative operators never match issues where the field is empty.
    return issue => handler.get(issue, ctx).length > 0 && !matchesAny(issue)
  }

  if (!['date', 'number', 'priority', 'key'].includes(handler.kind)) {
    throw new JqlError(`The operator '${node.op}' is not supported by the '${node.field}' field.`)
  }
  if (values.length !== 1) {
    throw new JqlError(`The operator '${node.op}' requires a single value.`)
  }
  const target = values[0]
  const cmp = (value: Scalar): number => {
    if (handler.kind === 'priority') {
      return Number(target) - Number(value)
    }
    if (handler.kind === 'key') {
      const issue = ctx.js.issues.get(Number(value))
      const other = ctx.js.issues.get(Number(target))
      if (!issue || !other || issue.project_id !== other.project_id) {
        return Number.NaN
      }
      return issue.number - other.number
    }
    if (handler.kind === 'date' && dayPrecision && (op === '<=' || op === '>')) {
      return Number(value) - (Number(target) + DAY - 1)
    }
    return Number(value) - Number(target)
  }
  const test: Record<string, (n: number) => boolean> = {
    '>': n => n > 0,
    '>=': n => n >= 0,
    '<': n => n < 0,
    '<=': n => n <= 0,
  }
  return issue => handler.get(issue, ctx).some(value => test[op](cmp(value)))
}

function compile(node: JqlNode, ctx: EvalContext): (issue: JiraIssue) => boolean {
  switch (node.type) {
    case 'and': {
      const left = compile(node.left, ctx)
      const right = compile(node.right, ctx)
      return issue => left(issue) && right(issue)
    }
    case 'or': {
      const left = compile(node.left, ctx)
      const right = compile(node.right, ctx)
      return issue => left(issue) || right(issue)
    }
    case 'not': {
      const inner = compile(node.expr, ctx)
      return issue => !inner(issue)
    }
    case 'clause':
      return compileClause(node, ctx)
  }
}

function sortValue(handler: FieldHandler, issue: JiraIssue, ctx: EvalContext): Scalar | null {
  if (handler.sort) {
    return handler.sort(issue, ctx)
  }
  const value = handler.get(issue, ctx)[0]
  if (value === undefined) {
    return null
  }
  return typeof value === 'string' ? value.toLowerCase() : value
}

function sortIssues(issues: JiraIssue[], orderBy: OrderBy[], ctx: EvalContext): JiraIssue[] {
  const order = orderBy.length > 0 ? orderBy : [{ field: 'created', direction: 'DESC' as const }]
  const handlers = order.map(entry => sortHandler(ctx.js, entry.field))
  const keyed = issues.map(issue => ({ issue, keys: handlers.map(handler => sortValue(handler, issue, ctx)) }))
  keyed.sort((a, b) => {
    for (let i = 0; i < order.length; i++) {
      const av = a.keys[i]
      const bv = b.keys[i]
      if (av === bv) {
        continue
      }
      if (av === null) {
        return 1
      }
      if (bv === null) {
        return -1
      }
      const diff = av < bv ? -1 : 1
      return order[i].direction === 'DESC' ? -diff : diff
    }
    return order[0].direction === 'DESC' ? b.issue.id - a.issue.id : a.issue.id - b.issue.id
  })
  return keyed.map(entry => entry.issue)
}

export function compileJql(
  js: JiraStore,
  jql: string,
  user: JiraUser,
  now = new Date(),
): (issue: JiraIssue) => boolean {
  const query = parseJql(jql)
  const ctx: EvalContext = { js, user, now }
  for (const entry of query.orderBy) {
    sortHandler(js, entry.field)
  }
  return query.where ? compile(query.where, ctx) : () => true
}

export function searchIssues(js: JiraStore, jql: string, user: JiraUser, now = new Date()): JiraIssue[] {
  const query = parseJql(jql)
  return runQuery(js, query, user, now)
}

export function runQuery(js: JiraStore, query: JqlQuery, user: JiraUser, now = new Date()): JiraIssue[] {
  const ctx: EvalContext = { js, user, now }
  const predicate = query.where ? compile(query.where, ctx) : () => true
  return sortIssues(js.issues.all().filter(predicate), query.orderBy, ctx)
}
