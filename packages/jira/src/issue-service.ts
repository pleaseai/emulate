import type { Store } from '@emulators/core'
import type { AdfNode, JiraChangelog, JiraChangelogItem, JiraComment, JiraIssue, JiraUser } from './entities.js'
import type { Actor } from './issue-fields.js'
import type { JiraStore } from './store.js'
import { adfToText } from './adf.js'
import { fieldError, JiraError } from './context.js'
import { readBody, refOf, setField, validateParent } from './issue-fields.js'
import { issueTransitions } from './issue-format.js'

import { applyLinks, applyUpdateOps } from './issue-ops.js'
import {
  findProject,
} from './lookup.js'
import { touchIssue } from './services.js'
import { insertFrom } from './store.js'

export type { Actor } from './issue-fields.js'
export { readBody } from './issue-fields.js'
export { createLink, findLinkType } from './issue-ops.js'

export interface CreateIssueResult {
  issue: JiraIssue
  comments: JiraComment[]
}

export function createIssue(
  actor: Actor,
  body: { fields?: Record<string, unknown>, update?: Record<string, unknown> },
): CreateIssueResult {
  const js = actor.js
  const fields = body?.fields ?? {}
  const projectRef = refOf(fields.project)
  const project = projectRef ? findProject(js, projectRef.key ?? projectRef.id) : undefined
  if (!project) {
    throw fieldError('project', 'Specify a valid project ID or key')
  }
  if (fields.issuetype === undefined) {
    throw fieldError('issuetype', 'Specify an issue type')
  }
  if (fields.summary === undefined && !hasSetOp(body.update, 'summary')) {
    throw fieldError('summary', 'You must specify a summary of the issue.')
  }

  const initial = js.statuses.get(project.status_ids[0])
  if (!initial) {
    throw new JiraError(400, ['The project has no workflow statuses.'])
  }
  const now = new Date().toISOString()
  const draft: JiraIssue = {
    id: 0,
    created_at: now,
    updated_at: now,
    key: '',
    number: 0,
    project_id: project.id,
    issue_type_id: 0,
    summary: '',
    description: null,
    environment: null,
    status_id: initial.id,
    status_changed_at: now,
    priority_id: js.priorities.findOneBy('name', 'Medium')?.id ?? null,
    resolution_id: null,
    resolution_date: null,
    assignee_id: null,
    reporter_id: actor.user.account_id,
    creator_id: actor.user.account_id,
    parent_id: null,
    labels: [],
    component_ids: [],
    fix_version_ids: [],
    due_date: null,
    custom_fields: {},
    watcher_ids: [actor.user.account_id],
    sprint_id: null,
    closed_sprint_ids: [],
  }

  const ordered = ['issuetype', ...Object.keys(fields).filter(key => key !== 'issuetype' && key !== 'project')]
  for (const field of ordered) {
    setField(actor, draft, field, fields[field], 'create')
  }
  const effects = applyUpdateOps(actor, draft, body.update ?? {}, 'create')
  validateParent(js, draft, draft.parent_id)
  if (initial.category === 'done' && !draft.resolution_id) {
    draft.resolution_id = js.resolutions.all()[0]?.id ?? null
    draft.resolution_date = draft.resolution_id ? now : null
  }

  const comments = effects.comments.map(raw => readBody(actor, 'comment', raw)!)
  const number = project.issue_sequence + 1
  js.projects.update(project.id, { issue_sequence: number })
  const { id: _id, created_at: _c, updated_at: _u, ...data } = draft
  const issue = insertFrom(js.issues, 10000, { ...data, key: `${project.key}-${number}`, number })
  applyLinks(js, issue, effects.links)
  return { issue, comments: comments.map(body => addComment(actor, issue, body)) }
}

function hasSetOp(update: Record<string, unknown> | undefined, field: string): boolean {
  const ops = update?.[field]
  return Array.isArray(ops) && ops.some(op => op && typeof op === 'object' && 'set' in op)
}

export function addComment(actor: Actor, issue: JiraIssue, body: AdfNode): JiraComment {
  const comment = insertFrom(actor.js.comments, 10000, {
    issue_id: issue.id,
    author_id: actor.user.account_id,
    update_author_id: actor.user.account_id,
    body,
  })
  touchIssue(actor.js, issue.id)
  return comment
}

export interface EditIssueResult {
  issue: JiraIssue
  items: JiraChangelogItem[]
  changelog: JiraChangelog | null
  comments: JiraComment[]
}

/** Edits an issue from `fields` and `update`, then records a changelog entry for what changed. */
export function editIssue(
  actor: Actor,
  issue: JiraIssue,
  body: { fields?: Record<string, unknown>, update?: Record<string, unknown> },
  extra?: (draft: JiraIssue) => void,
): EditIssueResult {
  const draft: JiraIssue = structuredClone(issue)
  for (const [field, value] of Object.entries(body?.fields ?? {})) {
    setField(actor, draft, field, value, 'edit')
  }
  const effects = applyUpdateOps(actor, draft, body?.update ?? {}, 'edit')
  extra?.(draft)
  if (draft.parent_id !== issue.parent_id || draft.issue_type_id !== issue.issue_type_id) {
    validateParent(actor.js, draft, draft.parent_id)
  }
  const comments = effects.comments.map(raw => readBody(actor, 'comment', raw)!)

  const items = diffIssues(actor.js, issue, draft)
  let updated = issue
  let changelog: JiraChangelog | null = null
  if (items.length > 0) {
    const { id: _id, created_at: _c, updated_at: _u, ...data } = draft
    updated = actor.js.issues.update(issue.id, data)!
    changelog = insertFrom(actor.js.changelogs, 10000, { issue_id: issue.id, author_id: actor.user.account_id, items })
  }
  applyLinks(actor.js, updated, effects.links)
  const added = comments.map(commentBody => addComment(actor, updated, commentBody))
  return { issue: actor.js.issues.get(issue.id)!, items, changelog, comments: added }
}

export function transitionIssue(
  actor: Actor,
  issue: JiraIssue,
  body: { transition?: { id?: string | number }, fields?: Record<string, unknown>, update?: Record<string, unknown> },
): EditIssueResult {
  const transitionId = String(body?.transition?.id ?? '')
  const transition = issueTransitions(actor, issue).find(entry => entry.id === transitionId)
  if (!transition) {
    throw new JiraError(400, [`Transition id '${transitionId}' is not valid for this issue.`])
  }
  const target = transition.status
  const fields = { ...(body.fields ?? {}) }
  const explicitResolution = 'resolution' in fields
  return editIssue(actor, issue, { fields, update: body.update }, (draft) => {
    draft.status_id = target.id
    draft.status_changed_at = new Date().toISOString()
    if (target.category === 'done') {
      if (!draft.resolution_id && !explicitResolution) {
        draft.resolution_id
          = actor.js.resolutions.findOneBy('name', 'Done')?.id ?? actor.js.resolutions.all()[0]?.id ?? null
      }
      draft.resolution_date ??= new Date().toISOString()
    }
    else {
      draft.resolution_id = null
      draft.resolution_date = null
    }
  })
}

/** A field recorded in the changelog when an edit changes it. */
interface TrackedField {
  field: string
  fieldId: string
  fieldtype?: 'jira' | 'custom'
  /** Raw value reported as `from` and `to`. */
  id?: (issue: JiraIssue) => string | null
  /** Display value reported as `fromString` and `toString`. */
  text: (issue: JiraIssue) => string | null
  /** Decides whether the field changed. Defaults to comparing `id` and `text`. */
  compare?: (issue: JiraIssue) => string
}

function trackedFields(js: JiraStore): TrackedField[] {
  const str = (value: number | null) => (value === null ? null : String(value))
  const named
    = (get: (id: number) => { name: string } | undefined) =>
      (id: number | null): string | null =>
        id === null ? null : (get(id)?.name ?? null)
  const names = (ids: number[], get: (id: number) => { name: string } | undefined) =>
    ids
      .map(id => get(id)?.name)
      .filter(Boolean)
      .join(' ') || null
  const user = (id: string | null) => (id ? (js.users.findOneBy('account_id', id)?.display_name ?? id) : null)
  const adf = (key: 'description' | 'environment'): TrackedField => ({
    field: key,
    fieldId: key,
    text: issue => (issue[key] ? adfToText(issue[key]) : null),
    compare: issue => JSON.stringify(issue[key]),
  })
  const issueType = named(id => js.issueTypes.get(id))
  const status = named(id => js.statuses.get(id))
  const priority = named(id => js.priorities.get(id))
  const resolution = named(id => js.resolutions.get(id))
  const sprint = named(id => js.sprints.get(id))
  const sprintField = js.customFields.all().find(field => field.type === 'sprint')

  const system: TrackedField[] = [
    { field: 'summary', fieldId: 'summary', text: issue => issue.summary },
    adf('description'),
    adf('environment'),
    {
      field: 'issuetype',
      fieldId: 'issuetype',
      id: i => str(i.issue_type_id),
      text: i => issueType(i.issue_type_id),
    },
    { field: 'status', fieldId: 'status', id: i => str(i.status_id), text: i => status(i.status_id) },
    { field: 'priority', fieldId: 'priority', id: i => str(i.priority_id), text: i => priority(i.priority_id) },
    {
      field: 'resolution',
      fieldId: 'resolution',
      id: i => str(i.resolution_id),
      text: i => resolution(i.resolution_id),
    },
    { field: 'assignee', fieldId: 'assignee', id: i => i.assignee_id, text: i => user(i.assignee_id) },
    { field: 'reporter', fieldId: 'reporter', id: i => i.reporter_id, text: i => user(i.reporter_id) },
    { field: 'duedate', fieldId: 'duedate', id: i => i.due_date, text: i => i.due_date },
    { field: 'labels', fieldId: 'labels', text: i => i.labels.join(' ') || null },
    {
      field: 'IssueParentAssociation',
      fieldId: 'parent',
      id: i => str(i.parent_id),
      text: i => (i.parent_id ? (js.issues.get(i.parent_id)?.key ?? null) : null),
    },
    {
      field: 'Component',
      fieldId: 'components',
      id: i => i.component_ids.join(',') || null,
      text: i => names(i.component_ids, id => js.components.get(id)),
    },
    {
      field: 'Fix Version',
      fieldId: 'fixVersions',
      id: i => i.fix_version_ids.join(',') || null,
      text: i => names(i.fix_version_ids, id => js.versions.get(id)),
    },
    {
      field: sprintField?.name ?? 'Sprint',
      fieldId: sprintField?.field_id ?? 'customfield_10020',
      fieldtype: 'custom',
      id: i => str(i.sprint_id),
      text: i => sprint(i.sprint_id),
    },
  ]

  const custom = js.customFields
    .all()
    .filter(field => field.type !== 'sprint')
    .map((field): TrackedField => {
      const value = (issue: JiraIssue) => issue.custom_fields[field.field_id] ?? null
      return {
        field: field.name,
        fieldId: field.field_id,
        fieldtype: 'custom',
        text: (issue) => {
          const current = value(issue)
          if (current === null) {
            return null
          }
          if (field.type === 'user') {
            return user(String(current))
          }
          return Array.isArray(current) ? current.join(' ') : String(current)
        },
        compare: issue => JSON.stringify(value(issue)),
      }
    })

  return [...system, ...custom]
}

/** Builds Jira style changelog items for every tracked field that differs between two issue states. */
export function diffIssues(js: JiraStore, before: JiraIssue, after: JiraIssue): JiraChangelogItem[] {
  const items: JiraChangelogItem[] = []
  for (const tracked of trackedFields(js)) {
    const compare
      = tracked.compare ?? ((issue: JiraIssue) => JSON.stringify([tracked.id?.(issue), tracked.text(issue)]))
    if (compare(before) === compare(after)) {
      continue
    }
    items.push({
      field: tracked.field,
      fieldtype: tracked.fieldtype ?? 'jira',
      fieldId: tracked.fieldId,
      from: tracked.id?.(before) ?? null,
      fromString: tracked.text(before),
      to: tracked.id?.(after) ?? null,
      toString: tracked.text(after),
    })
  }
  return items
}

/** Actor used when seeding data outside of a request. */
export function systemActor(store: Store, js: JiraStore, baseUrl: string, user: JiraUser): Actor {
  return { store, js, baseUrl, siteUrl: baseUrl, version: '3', user }
}
