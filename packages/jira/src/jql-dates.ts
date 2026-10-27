import type { EvalContext, Scalar } from './jql-fields.js'
import { eqi } from './jql-fields.js'
import { JqlError } from './jql-parser.js'

export const DAY = 24 * 3600 * 1000

const FUNCTION_UNITS: Record<'day' | 'week' | 'month' | 'year', string> = {
  day: 'd',
  week: 'w',
  month: 'M',
  year: 'y',
}

const CALENDAR_UNITS = new Set(['y', 'M', 'w', 'd'])

function addCalendarMonths(date: Date, months: number): void {
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
}

function shiftDate(base: Date, value: string, defaultUnit?: string, include: (unit: string) => boolean = () => true): Date | null {
  const trimmed = value.replace(/\s+/g, '')
  const match = /^([+-]?)((?:\d+[yMwdhm])+|\d+)$/.exec(trimmed)
  if (!match) {
    return null
  }
  const sign = match[1] === '-' ? -1 : 1
  const parts = /^\d+$/.test(match[2])
    ? defaultUnit
      ? [`${match[2]}${defaultUnit}`]
      : []
    : match[2].match(/\d+[yMwdhm]/g)
  if (!parts || parts.length === 0) {
    return null
  }
  const date = new Date(base)
  for (const part of parts) {
    const amount = sign * Number(part.slice(0, -1))
    const unit = part.slice(-1)
    if (!include(unit)) {
      continue
    }
    if (unit === 'y') {
      addCalendarMonths(date, amount * 12)
    }
    else if (unit === 'M') {
      addCalendarMonths(date, amount)
    }
    else if (unit === 'w') {
      date.setTime(date.getTime() + amount * 7 * DAY)
    }
    else if (unit === 'd') {
      date.setTime(date.getTime() + amount * DAY)
    }
    else if (unit === 'h') {
      date.setTime(date.getTime() + amount * 3600 * 1000)
    }
    else {
      date.setTime(date.getTime() + amount * 60 * 1000)
    }
  }
  return date
}

function applyOffset(base: Date, offset: string | undefined, defaultUnit: string, include?: (unit: string) => boolean): Date {
  if (!offset) {
    return base
  }
  const shifted = shiftDate(base, offset, defaultUnit, include)
  if (!shifted) {
    throw new JqlError(`Invalid date offset '${offset}'.`)
  }
  return shifted
}

function startOf(unit: 'day' | 'week' | 'month' | 'year', date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  if (unit === 'week') {
    d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  }
  if (unit === 'month') {
    d.setUTCDate(1)
  }
  if (unit === 'year') {
    d.setUTCMonth(0, 1)
  }
  return d
}

function endOf(unit: 'day' | 'week' | 'month' | 'year', date: Date): Date {
  const start = startOf(unit, date)
  const next = new Date(start)
  if (unit === 'day') {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  if (unit === 'week') {
    next.setUTCDate(next.getUTCDate() + 7)
  }
  if (unit === 'month') {
    next.setUTCMonth(next.getUTCMonth() + 1)
  }
  if (unit === 'year') {
    next.setUTCFullYear(next.getUTCFullYear() + 1)
  }
  return new Date(next.getTime() - 1)
}

export function callFunction(fn: { name: string, args: string[] }, ctx: EvalContext): Scalar[] {
  const name = fn.name.toLowerCase()
  const js = ctx.js
  const dateFn = /^(start|end)of(day|week|month|year)$/.exec(name)
  if (dateFn) {
    const unit = dateFn[2] as 'day' | 'week' | 'month' | 'year'
    const reference = applyOffset(ctx.now, fn.args[0], FUNCTION_UNITS[unit], u => CALENDAR_UNITS.has(u))
    const boundary = dateFn[1] === 'start' ? startOf(unit, reference) : endOf(unit, reference)
    return [applyOffset(boundary, fn.args[0], FUNCTION_UNITS[unit], u => !CALENDAR_UNITS.has(u)).getTime()]
  }
  switch (name) {
    case 'currentuser':
      return [ctx.user.account_id]
    case 'now':
      return [ctx.now.getTime()]
    case 'opensprints':
      return js.sprints
        .all()
        .filter(s => s.state !== 'closed')
        .map(s => s.id)
    case 'closedsprints':
      return js.sprints
        .all()
        .filter(s => s.state === 'closed')
        .map(s => s.id)
    case 'futuresprints':
      return js.sprints
        .all()
        .filter(s => s.state === 'future')
        .map(s => s.id)
    case 'standardissuetypes':
      return js.issueTypes
        .all()
        .filter(t => !t.subtask)
        .map(t => t.id)
    case 'subtaskissuetypes':
      return js.issueTypes
        .all()
        .filter(t => t.subtask)
        .map(t => t.id)
    case 'releasedversions':
    case 'unreleasedversions': {
      const released = name === 'releasedversions'
      const project = fn.args[0]
        ? js.projects.all().find(p => eqi(p.key, fn.args[0]) || String(p.id) === fn.args[0])
        : undefined
      return js.versions
        .all()
        .filter(v => v.released === released && (!project || v.project_id === project.id))
        .map(v => v.id)
    }
    case 'linkedissues': {
      const [ref, linkText] = fn.args
      if (!ref) {
        throw new JqlError('Function \'linkedIssues\' expects at least one argument.')
      }
      const issue = /^\d+$/.test(ref) ? js.issues.get(Number(ref)) : js.issues.all().find(i => eqi(i.key, ref))
      if (!issue) {
        throw new JqlError(`Issue '${ref}' could not be found in function 'linkedIssues'.`)
      }
      const results: number[] = []
      for (const link of js.issueLinks.findBy('inward_issue_id', issue.id)) {
        const type = js.issueLinkTypes.get(link.type_id)
        if (!linkText || (type && eqi(type.inward, linkText))) {
          results.push(link.outward_issue_id)
        }
      }
      for (const link of js.issueLinks.findBy('outward_issue_id', issue.id)) {
        const type = js.issueLinkTypes.get(link.type_id)
        if (!linkText || (type && eqi(type.outward, linkText))) {
          results.push(link.inward_issue_id)
        }
      }
      return results
    }
    default:
      throw new JqlError(`Unable to find JQL function '${fn.name}()'.`)
  }
}

export function parseDateLiteral(value: string, ctx: EvalContext): { time: number, dayPrecision: boolean } {
  const relative = shiftDate(ctx.now, value)
  if (relative) {
    return { time: relative.getTime(), dayPrecision: false }
  }
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(value.trim())
  if (!match) {
    throw new JqlError(
      `Date value '${value}' for field is invalid. Valid formats include: 'yyyy/MM/dd HH:mm', 'yyyy-MM-dd HH:mm', 'yyyy/MM/dd', 'yyyy-MM-dd', or a period format e.g. '-5d', '4w 2d'.`,
    )
  }
  const [, y, m, d, hh, mm] = match
  const time = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0))
  return { time, dayPrecision: hh === undefined }
}
