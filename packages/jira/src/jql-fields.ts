import type { JiraIssue, JiraStatusCategory, JiraUser } from './entities.js'
import type { JiraStore } from './store.js'
import { adfToText } from './adf.js'
import { findField, SYSTEM_FIELDS } from './fields.js'
import { JqlError } from './jql-parser.js'
import { findIssue, findUser } from './lookup.js'

export type Scalar = string | number
export type Resolved = { empty: true } | { empty: false, values: Scalar[], dayPrecision?: boolean }

export interface EvalContext {
  js: JiraStore
  user: JiraUser
  now: Date
}

export type FieldKind = 'ref' | 'text' | 'date' | 'number' | 'priority' | 'key'

/** Returned by `resolve` for literals such as `Unresolved` that mean "the field is empty". */
export const MATCHES_EMPTY = Symbol('matches empty')

export interface FieldHandler {
  name: string
  kind: FieldKind
  /** Current values of the field for an issue. Empty array means the field is empty. */
  get: (issue: JiraIssue, ctx: EvalContext) => Scalar[]
  /** Maps a literal from the query to comparable values. Throws for unknown values. */
  resolve?: (value: string, ctx: EvalContext) => Scalar[] | typeof MATCHES_EMPTY
  /** ORDER BY key. Defaults to the first value from `get`, lowercased. */
  sort?: (issue: JiraIssue, ctx: EvalContext) => Scalar | null
}

export const eqi = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const lower = (value: string | undefined | null) => value?.toLowerCase() ?? null

function notFoundValue(value: string, field: string): JqlError {
  return new JqlError(`The value '${value}' does not exist for the field '${field}'.`)
}

function refResolver<T extends { id: number }>(
  field: string,
  items: (ctx: EvalContext) => T[],
  names: (item: T) => string[],
) {
  return (value: string, ctx: EvalContext): Scalar[] => {
    const matches = items(ctx).filter(
      item => String(item.id) === value || names(item).some(name => eqi(name, value)),
    )
    if (matches.length === 0) {
      throw notFoundValue(value, field)
    }
    return matches.map(item => item.id)
  }
}

function userResolver(field: string) {
  return (value: string, ctx: EvalContext): Scalar[] => {
    const user = findUser(ctx.js, value)
    if (!user) {
      throw notFoundValue(value, field)
    }
    return [user.account_id]
  }
}

function resolveIssue(value: string, ctx: EvalContext): Scalar[] {
  const issue = findIssue(ctx.js, value)
  if (!issue) {
    throw new JqlError(`An issue with key '${value}' does not exist for field 'key'.`)
  }
  return [issue.id]
}

function dateOf(value: string | null | undefined): Scalar[] {
  if (!value) {
    return []
  }
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
  return Number.isNaN(time) ? [] : [time]
}

type TextPart = 'summary' | 'description' | 'environment' | 'comment'

function issueText(issue: JiraIssue, ctx: EvalContext, parts: TextPart[]): string {
  const chunks: string[] = []
  if (parts.includes('summary')) {
    chunks.push(issue.summary)
  }
  if (parts.includes('description')) {
    chunks.push(adfToText(issue.description))
  }
  if (parts.includes('environment')) {
    chunks.push(adfToText(issue.environment))
  }
  if (parts.includes('comment')) {
    for (const comment of ctx.js.comments.findBy('issue_id', issue.id)) {
      chunks.push(adfToText(comment.body))
    }
  }
  return chunks.join('\n')
}

const CATEGORY_ALIASES: Record<JiraStatusCategory, string[]> = {
  new: ['new', 'To Do', '2'],
  indeterminate: ['indeterminate', 'In Progress', '4'],
  done: ['done', 'Done', '3'],
}

function textField(name: string, parts: TextPart[]): FieldHandler {
  return {
    name,
    kind: 'text',
    get: (issue, ctx) => {
      const value = issueText(issue, ctx, parts)
      return value ? [value] : []
    },
  }
}

function userField(name: string, key: 'assignee_id' | 'reporter_id' | 'creator_id'): FieldHandler {
  return {
    name,
    kind: 'ref',
    get: issue => (issue[key] ? [issue[key]!] : []),
    resolve: userResolver(name),
    sort: (issue, ctx) => lower(issue[key] ? ctx.js.users.findOneBy('account_id', issue[key]!)?.display_name : null),
  }
}

function dateField(name: string, value: (issue: JiraIssue) => string | null): FieldHandler {
  return { name, kind: 'date', get: issue => dateOf(value(issue)) }
}

const sprintField: FieldHandler = {
  name: 'sprint',
  kind: 'ref',
  get: issue => [...issue.closed_sprint_ids, ...(issue.sprint_id ? [issue.sprint_id] : [])],
  resolve: refResolver(
    'sprint',
    ctx => ctx.js.sprints.all(),
    s => [s.name],
  ),
}

/**
 * JQL behavior for each searchable system field, keyed by the field id in `SYSTEM_FIELDS`. Clause names
 * (`type` for `issuetype`, `due` for `duedate`, ...) come from `SYSTEM_FIELDS`, plus the extra `aliases` below.
 */
const SYSTEM_JQL: Record<string, FieldHandler & { aliases?: string[] }> = {
  project: {
    name: 'project',
    kind: 'ref',
    get: issue => [issue.project_id],
    resolve: refResolver(
      'project',
      ctx => ctx.js.projects.all(),
      p => [p.key, p.name],
    ),
    sort: (issue, ctx) => ctx.js.projects.get(issue.project_id)?.key ?? null,
  },
  issuekey: {
    name: 'key',
    kind: 'key',
    get: issue => [issue.id],
    resolve: resolveIssue,
    sort: (issue, ctx) =>
      `${ctx.js.projects.get(issue.project_id)?.key ?? ''}-${String(issue.number).padStart(10, '0')}`,
  },
  summary: { ...textField('summary', ['summary']), sort: issue => issue.summary.toLowerCase() },
  description: textField('description', ['description']),
  environment: textField('environment', ['environment']),
  comment: textField('comment', ['comment']),
  text: { ...textField('text', ['summary', 'description', 'environment', 'comment']), aliases: ['text'] },
  status: {
    name: 'status',
    kind: 'ref',
    get: issue => [issue.status_id],
    resolve: refResolver(
      'status',
      ctx => ctx.js.statuses.all(),
      s => [s.name],
    ),
    sort: (issue, ctx) => lower(ctx.js.statuses.get(issue.status_id)?.name),
  },
  statusCategory: {
    name: 'statusCategory',
    kind: 'ref',
    get: (issue, ctx) => {
      const category = ctx.js.statuses.get(issue.status_id)?.category
      return category ? [category] : []
    },
    resolve: (value) => {
      const match = (Object.keys(CATEGORY_ALIASES) as JiraStatusCategory[]).find(key =>
        CATEGORY_ALIASES[key].some(alias => eqi(alias, value)),
      )
      if (!match) {
        throw notFoundValue(value, 'statusCategory')
      }
      return [match]
    },
  },
  assignee: userField('assignee', 'assignee_id'),
  reporter: userField('reporter', 'reporter_id'),
  creator: userField('creator', 'creator_id'),
  watches: { name: 'watcher', kind: 'ref', get: issue => [...issue.watcher_ids], resolve: userResolver('watcher') },
  priority: {
    name: 'priority',
    kind: 'priority',
    get: issue => (issue.priority_id ? [issue.priority_id] : []),
    resolve: refResolver(
      'priority',
      ctx => ctx.js.priorities.all(),
      p => [p.name],
    ),
    // Priorities are only seeded, in order from Highest to Lowest, so a lower id is more urgent.
    sort: issue => (issue.priority_id ? -issue.priority_id : null),
  },
  issuetype: {
    name: 'issuetype',
    kind: 'ref',
    get: issue => [issue.issue_type_id],
    resolve: refResolver(
      'issuetype',
      ctx => ctx.js.issueTypes.all(),
      t => [t.name],
    ),
    sort: (issue, ctx) => lower(ctx.js.issueTypes.get(issue.issue_type_id)?.name),
  },
  labels: {
    name: 'labels',
    kind: 'ref',
    get: issue => [...issue.labels],
    resolve: value => [value],
    aliases: ['label'],
  },
  resolution: {
    name: 'resolution',
    kind: 'ref',
    get: issue => (issue.resolution_id ? [issue.resolution_id] : []),
    resolve: (value, ctx) =>
      eqi(value, 'unresolved')
        ? MATCHES_EMPTY
        : refResolver(
            'resolution',
            c => c.js.resolutions.all(),
            r => [r.name],
          )(value, ctx),
  },
  parent: {
    name: 'parent',
    kind: 'ref',
    get: issue => (issue.parent_id ? [issue.parent_id] : []),
    resolve: resolveIssue,
  },
  created: dateField('created', issue => issue.created_at),
  updated: dateField('updated', issue => issue.updated_at),
  duedate: dateField('duedate', issue => issue.due_date),
  resolutiondate: dateField('resolutiondate', issue => issue.resolution_date),
  statuscategorychangedate: dateField('statusCategoryChangedDate', issue => issue.status_changed_at),
  components: {
    name: 'component',
    kind: 'ref',
    get: issue => [...issue.component_ids],
    resolve: refResolver(
      'component',
      ctx => ctx.js.components.all(),
      c => [c.name],
    ),
  },
  fixVersions: {
    name: 'fixVersion',
    kind: 'ref',
    get: issue => [...issue.fix_version_ids],
    resolve: refResolver(
      'fixVersion',
      ctx => ctx.js.versions.all(),
      v => [v.name],
    ),
  },
  sprint: { ...sprintField, aliases: ['sprint'] },
}

/** Clause name (lowercased) to handler, built once from `SYSTEM_FIELDS` clause names and `SYSTEM_JQL` aliases. */
const SYSTEM_CLAUSES = new Map<string, FieldHandler>()
for (const field of SYSTEM_FIELDS) {
  const handler = SYSTEM_JQL[field.id]
  if (!handler) {
    continue
  }
  for (const clause of [field.id, ...field.clauseNames]) {
    SYSTEM_CLAUSES.set(clause.toLowerCase(), handler)
  }
}
for (const handler of Object.values(SYSTEM_JQL)) {
  for (const alias of handler.aliases ?? []) {
    SYSTEM_CLAUSES.set(alias.toLowerCase(), handler)
  }
}

/** ORDER BY Rank is accepted and falls back to creation order, as the emulator has no rank field. */
const rankSort: FieldHandler = {
  name: 'rank',
  kind: 'number',
  get: () => [],
  sort: issue => issue.id,
}

export function resolveFieldHandler(js: JiraStore, name: string): FieldHandler {
  const system = SYSTEM_CLAUSES.get(name.toLowerCase())
  if (system) {
    return system
  }
  const def = findField(js, name)
  const custom = def?.custom ? js.customFields.findOneBy('field_id', def.id) : undefined
  if (!custom) {
    throw new JqlError(`Field '${name}' does not exist or you do not have permission to view it.`)
  }
  if (custom.type === 'sprint') {
    return sprintField
  }
  const raw = (issue: JiraIssue): Scalar[] => {
    const value = issue.custom_fields[custom.field_id]
    if (value === null || value === undefined) {
      return []
    }
    return Array.isArray(value) ? value.map(String) : [typeof value === 'number' ? value : String(value)]
  }
  switch (custom.type) {
    case 'number':
      return { name: custom.name, kind: 'number', get: raw, resolve: value => [Number(value)] }
    case 'date':
    case 'datetime':
      return dateField(custom.name, issue => issue.custom_fields[custom.field_id] as string | null)
    case 'string':
      return { name: custom.name, kind: 'text', get: raw }
    case 'user':
      return { name: custom.name, kind: 'ref', get: raw, resolve: userResolver(custom.name) }
    default:
      return { name: custom.name, kind: 'ref', get: raw, resolve: value => [value] }
  }
}

export function sortHandler(js: JiraStore, name: string): FieldHandler {
  return name.toLowerCase() === 'rank' ? rankSort : resolveFieldHandler(js, name)
}
