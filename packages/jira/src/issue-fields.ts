import type { Store } from '@emulators/core'
import type { AdfNode, JiraIssue, JiraUser } from './entities.js'
import type { Fmt } from './formatters.js'
import type { JiraStore } from './store.js'
import { isAdfDoc, textToAdf } from './adf.js'
import { fieldError, isIsoDate } from './context.js'
import { customOptionId } from './formatters.js'
import {
  findComponent,
  findIssue,
  findIssueType,
  findPriority,
  findResolution,
  findUser,
  findVersion,
} from './lookup.js'

export interface Actor extends Fmt {
  store: Store
  user: JiraUser
}

function NOT_SETTABLE(field: string) {
  return fieldError(field, `Field '${field}' cannot be set. It is not on the appropriate screen, or unknown.`)
}

type RefValue = { id?: string | number, key?: string, name?: string, accountId?: string, value?: string } | null

export function readBody(actor: Pick<Actor, 'version'>, field: string, value: unknown): AdfNode | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (actor.version === '2') {
    if (typeof value === 'string') {
      return textToAdf(value)
    }
    if (isAdfDoc(value)) {
      return value
    }
    throw fieldError(field, `The value for ${field} must be a string.`)
  }
  if (!isAdfDoc(value)) {
    throw fieldError(field, 'Operation value must be an Atlassian Document (see the Atlassian Document Format)')
  }
  return value
}

export function refOf(value: unknown): RefValue {
  if (value === null) {
    return null
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return { id: value, name: String(value) }
  }
  if (typeof value === 'object') {
    return value as RefValue
  }
  return {}
}

function resolveUserRef(js: JiraStore, field: string, value: unknown): string | null {
  if (value === null || (typeof value === 'object' && 'accountId' in value && value.accountId === null)) {
    return null
  }
  const ref = refOf(value) ?? {}
  const key = ref.accountId ?? (ref.id !== undefined ? String(ref.id) : undefined) ?? ref.name
  if (typeof key !== 'string' || !key) {
    throw fieldError(field, `Specify a valid value for ${field}`)
  }
  if (key === '-1') {
    return null
  }
  const user = findUser(js, key)
  if (!user) {
    throw fieldError(field, `Specify a valid value for ${field}`)
  }
  return user.account_id
}

export function validateParent(js: JiraStore, draft: JiraIssue, parentId: number | null): void {
  const type = js.issueTypes.get(draft.issue_type_id)
  if (parentId === null) {
    if (type?.subtask) {
      throw fieldError('parent', 'Subtasks must have a parent issue.')
    }
    return
  }
  const parent = js.issues.get(parentId)
  if (!parent) {
    throw fieldError('parent', 'Could not find the parent issue.')
  }
  if (parent.id === draft.id) {
    throw fieldError('parent', 'An issue cannot be its own parent.')
  }
  const parentType = js.issueTypes.get(parent.issue_type_id)
  if (!type || !parentType || parentType.hierarchy_level !== type.hierarchy_level + 1) {
    throw fieldError('parent', 'Given parent work item does not belong to appropriate hierarchy.')
  }
  if (type.subtask && parent.project_id !== draft.project_id) {
    throw fieldError('parent', 'Subtasks must be in the same project as their parent.')
  }
}

export function setField(actor: Actor, draft: JiraIssue, field: string, value: unknown, mode: 'create' | 'edit'): void {
  const js = actor.js
  switch (field) {
    case 'project':
    case 'issuetype':
      if (mode === 'edit' && field === 'project') {
        throw NOT_SETTABLE(field)
      }
      if (field === 'issuetype') {
        const ref = refOf(value)
        const type = ref ? findIssueType(js, ref.id ?? ref.name) : undefined
        const project = js.projects.get(draft.project_id)
        if (!type || !project?.issue_type_ids.includes(type.id)) {
          throw fieldError('issuetype', 'Specify a valid issue type')
        }
        draft.issue_type_id = type.id
      }
      return
    case 'summary': {
      const summary = typeof value === 'string' ? value.trim() : ''
      if (!summary) {
        throw fieldError('summary', 'You must specify a summary of the issue.')
      }
      if (summary.length > 255) {
        throw fieldError('summary', 'Summary must be less than 255 characters.')
      }
      draft.summary = summary
      return
    }
    case 'description':
    case 'environment':
      draft[field] = readBody(actor, field, value)
      return
    case 'priority': {
      const ref = refOf(value)
      if (ref === null) {
        draft.priority_id = null
        return
      }
      const priority = findPriority(js, ref.id ?? ref.name)
      if (!priority) {
        throw fieldError('priority', `Specify a valid value for priority`)
      }
      draft.priority_id = priority.id
      return
    }
    case 'assignee':
    case 'reporter':
      draft[field === 'assignee' ? 'assignee_id' : 'reporter_id'] = resolveUserRef(js, field, value)
      return
    case 'labels': {
      const labels = Array.isArray(value) ? value : value == null ? [] : null
      if (!labels) {
        throw fieldError('labels', 'The labels field must be an array of strings.')
      }
      if (!labels.every(label => typeof label === 'string')) {
        throw fieldError('labels', 'The labels field must be an array of strings.')
      }
      draft.labels = labels.map(label => validateLabel(label))
      return
    }
    case 'duedate':
      if (value !== null && value !== '' && !isIsoDate(value)) {
        throw fieldError('duedate', `Error parsing date string: ${String(value)}`)
      }
      draft.due_date = value ? String(value) : null
      return
    case 'parent': {
      const ref = refOf(value)
      const parent = ref ? findIssue(js, ref.key ?? ref.id) : null
      if (ref && !parent) {
        throw fieldError('parent', 'Could not find the parent issue.')
      }
      draft.parent_id = parent?.id ?? null
      return
    }
    case 'components':
    case 'fixVersions': {
      if (!Array.isArray(value)) {
        throw fieldError(field, `Field ${field} must be an array.`)
      }
      draft[field === 'components' ? 'component_ids' : 'fix_version_ids'] = value.map(entry =>
        resolveProjectItem(actor, draft, field, entry),
      )
      return
    }
    case 'resolution': {
      const ref = refOf(value)
      if (ref === null) {
        draft.resolution_id = null
        draft.resolution_date = null
        return
      }
      const resolution = findResolution(js, ref.id ?? ref.name)
      if (!resolution) {
        throw fieldError('resolution', 'Specify a valid value for resolution')
      }
      if (!draft.resolution_id) {
        draft.resolution_date = new Date().toISOString()
      }
      draft.resolution_id = resolution.id
      return
    }
    case 'status':
      throw NOT_SETTABLE('status')
    default:
      setCustomField(actor, draft, field, value)
  }
}

export function validateLabel(label: string): string {
  if (/\s/.test(label)) {
    throw fieldError('labels', `The label '${label}' contains spaces which is invalid.`)
  }
  if (label.length > 255) {
    throw fieldError('labels', 'The label must not exceed 255 characters.')
  }
  return label
}

export function resolveProjectItem(actor: Actor, draft: JiraIssue, field: string, entry: unknown): number {
  const ref = refOf(entry) ?? {}
  const find = field === 'components' ? findComponent : findVersion
  const item = find(actor.js, draft.project_id, { id: ref.id, name: ref.name })
  if (!item) {
    const label = field === 'components' ? 'Component' : 'Version'
    throw fieldError(field, `${label} name '${ref.name ?? ref.id}' is not valid`)
  }
  return item.id
}

function archiveClosedSprint(actor: Actor, draft: JiraIssue): void {
  const current = draft.sprint_id ? actor.js.sprints.get(draft.sprint_id) : undefined
  if (current?.state === 'closed') {
    draft.closed_sprint_ids = [...new Set([...draft.closed_sprint_ids, current.id])]
  }
}

function setCustomField(actor: Actor, draft: JiraIssue, field: string, value: unknown): void {
  const def = actor.js.customFields.findOneBy('field_id', field)
  if (!def) {
    throw NOT_SETTABLE(field)
  }
  if (value === null || value === undefined) {
    if (def.type === 'sprint') {
      archiveClosedSprint(actor, draft)
      draft.sprint_id = null
    }
    else {
      draft.custom_fields = { ...draft.custom_fields, [field]: null }
    }
    return
  }
  const invalid = () =>
    fieldError(field, `Operation value must be a ${def.type === 'number' ? 'number' : 'valid value'}`)
  let stored: unknown = value
  switch (def.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw invalid()
      }
      break
    case 'string':
      if (typeof value !== 'string') {
        throw invalid()
      }
      break
    case 'date':
      if (!isIsoDate(value)) {
        throw invalid()
      }
      break
    case 'datetime':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw invalid()
      }
      break
    case 'array':
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
        throw invalid()
      }
      stored = value
      break
    case 'option': {
      const ref = (value ?? {}) as { id?: unknown, value?: unknown }
      const named = typeof value === 'string' ? value : typeof ref.value === 'string' ? ref.value : undefined
      const option = ref.id === undefined || typeof value === 'string'
        ? named
        : [...def.options, ...(named !== undefined ? [named] : [])].find(
            candidate => String(customOptionId(def, candidate)) === String(ref.id),
          )
      if (!option || (named !== undefined && option !== named) || (def.options.length > 0 && !def.options.includes(option))) {
        throw invalid()
      }
      stored = option
      break
    }
    case 'user':
      stored = resolveUserRef(actor.js, field, value)
      break
    case 'sprint': {
      const sprintId = typeof value === 'number' ? value : Number((value as { id?: number }).id ?? value)
      const sprint = actor.js.sprints.get(sprintId)
      if (!sprint) {
        throw fieldError(field, `Sprint with id ${String(value)} does not exist.`)
      }
      if (sprint.state === 'closed') {
        throw fieldError(field, 'Issue can be assigned only to active or future sprints.')
      }
      archiveClosedSprint(actor, draft)
      draft.sprint_id = sprint.id
      return
    }
  }
  draft.custom_fields = { ...draft.custom_fields, [field]: stored }
}
