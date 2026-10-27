import type { JiraIssue } from './entities.js'
import type { Actor } from './issue-fields.js'
import type { JiraStore } from './store.js'
import { fieldError } from './context.js'
import { resolveProjectItem, setField, validateLabel } from './issue-fields.js'
import {
  findIssue,
} from './lookup.js'

import { touchIssue } from './services.js'
import { insertFrom } from './store.js'

export interface PendingLink {
  typeId: number
  otherId: number
  /** True for `outwardIssue`, which makes the edited issue the source ("this issue blocks the other"). */
  issueIsSource: boolean
}

export interface UpdateSideEffects {
  comments: unknown[]
  links: PendingLink[]
}

/** Applies `update` operations (`set`, `add`, `remove`, `edit`). Comment and link additions are returned for the caller. */
export function applyUpdateOps(
  actor: Actor,
  draft: JiraIssue,
  update: Record<string, unknown>,
  mode: 'create' | 'edit',
): UpdateSideEffects {
  const effects: UpdateSideEffects = { comments: [], links: [] }
  for (const [field, opsValue] of Object.entries(update ?? {})) {
    if (!Array.isArray(opsValue)) {
      throw fieldError(field, 'Field operations must be an array.')
    }
    for (const op of opsValue as Array<Record<string, unknown>>) {
      const [verb, value] = Object.entries(op)[0] ?? []
      if (field === 'comment') {
        if (verb !== 'add') {
          throw fieldError('comment', 'Only add is supported for comments.')
        }
        effects.comments.push((value as { body?: unknown })?.body)
        continue
      }
      if (field === 'issuelinks') {
        if (verb !== 'add') {
          throw fieldError('issuelinks', 'Only add is supported for issue links.')
        }
        effects.links.push(resolvePendingLink(actor.js, value as LinkInput))
        continue
      }
      if (verb === 'set' || verb === 'edit') {
        setField(actor, draft, field, value, mode)
      }
      else if (verb === 'add' || verb === 'remove') {
        applyListOp(actor, draft, field, verb, value)
      }
      else {
        throw fieldError(field, `Unsupported operation '${verb}' for field ${field}.`)
      }
    }
  }
  return effects
}

interface LinkInput {
  type?: { id?: string | number, name?: string }
  inwardIssue?: { id?: string | number, key?: string }
  outwardIssue?: { id?: string | number, key?: string }
}

function resolvePendingLink(js: JiraStore, input: LinkInput): PendingLink {
  const type = findLinkType(js, input?.type)
  if (!type) {
    throw fieldError('issuelinks', 'No issue link type with name or id specified found.')
  }
  const otherRef = input.outwardIssue ?? input.inwardIssue
  const other = otherRef ? findIssue(js, otherRef.key ?? otherRef.id) : undefined
  if (!other) {
    throw fieldError('issuelinks', 'The linked issue does not exist.')
  }
  return { typeId: type.id, otherId: other.id, issueIsSource: Boolean(input.outwardIssue) }
}

export function findLinkType(js: JiraStore, ref: { id?: string | number, name?: string } | undefined) {
  if (!ref) {
    return undefined
  }
  if (ref.id !== undefined) {
    return js.issueLinkTypes.get(Number(ref.id))
  }
  return js.issueLinkTypes.all().find(type => type.name.toLowerCase() === String(ref.name ?? '').toLowerCase())
}

export function createLink(js: JiraStore, typeId: number, inwardId: number, outwardId: number) {
  const existing = js.issueLinks
    .findBy('inward_issue_id', inwardId)
    .find(link => link.outward_issue_id === outwardId && link.type_id === typeId)
  if (existing) {
    return existing
  }
  const link = insertFrom(js.issueLinks, 10000, {
    type_id: typeId,
    inward_issue_id: inwardId,
    outward_issue_id: outwardId,
  })
  touchIssue(js, inwardId)
  touchIssue(js, outwardId)
  return link
}

export function applyLinks(js: JiraStore, issue: JiraIssue, links: PendingLink[]): void {
  for (const link of links) {
    if (link.issueIsSource) {
      createLink(js, link.typeId, link.otherId, issue.id)
    }
    else {
      createLink(js, link.typeId, issue.id, link.otherId)
    }
  }
}

export function applyListOp(actor: Actor, draft: JiraIssue, field: string, verb: 'add' | 'remove', value: unknown): void {
  if (field === 'labels') {
    const label = validateLabel(String(value))
    draft.labels
      = verb === 'add'
        ? draft.labels.includes(label)
          ? draft.labels
          : [...draft.labels, label]
        : draft.labels.filter(existing => existing !== label)
    return
  }
  if (field === 'components' || field === 'fixVersions') {
    const key = field === 'components' ? 'component_ids' : 'fix_version_ids'
    const id = resolveProjectItem(actor, draft, field, value)
    draft[key] = verb === 'add' ? [...new Set([...draft[key], id])] : draft[key].filter(existing => existing !== id)
    return
  }
  const def = actor.js.customFields.findOneBy('field_id', field)
  if (def?.type === 'array') {
    const current = (draft.custom_fields[field] as string[] | null) ?? []
    const item = String(value)
    const next = verb === 'add' ? [...new Set([...current, item])] : current.filter(existing => existing !== item)
    draft.custom_fields = { ...draft.custom_fields, [field]: next }
    return
  }
  throw fieldError(field, `Field '${field}' does not support the ${verb} operation.`)
}
