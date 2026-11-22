import type { AsanaStore } from './store.js'

export type CustomFieldValueResult
  = | { ok: true, values: Map<string, string | null> }
    | { ok: false, message: string }

/**
 * Validates a task write's `custom_fields` map (`{ "<field gid>": "<text>" }`) against the fields the
 * task may carry. Asana rejects a field that is not on one of the task's projects with 400.
 */
export function parseCustomFieldValues(
  as: AsanaStore,
  input: unknown,
  allowedFieldGids: Iterable<string>,
): CustomFieldValueResult {
  const values = new Map<string, string | null>()
  if (input === undefined || input === null) {
    return { ok: true, values }
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'custom_fields: Value must be an object' }
  }

  const allowed = new Set(allowedFieldGids)
  for (const [gid, value] of Object.entries(input as Record<string, unknown>)) {
    if (!as.customFields.findOneBy('gid', gid) || !allowed.has(gid)) {
      return { ok: false, message: `custom_fields: Custom field with ID ${gid} is not on given object` }
    }
    if (value !== null && typeof value !== 'string') {
      return { ok: false, message: `custom_fields: Text custom field ${gid} requires a string value` }
    }
    values.set(gid, value)
  }
  return { ok: true, values }
}

/** Fields attached to any of the given projects. */
export function projectCustomFieldGids(as: AsanaStore, projectGids: Iterable<string>): Set<string> {
  const gids = new Set<string>()
  for (const projectGid of projectGids) {
    for (const setting of as.customFieldSettings.findBy('project_gid', projectGid)) {
      gids.add(setting.custom_field_gid)
    }
  }
  return gids
}

export function applyCustomFieldValues(as: AsanaStore, taskGid: string, values: Map<string, string | null>): void {
  for (const [fieldGid, textValue] of values) {
    const existing = as.taskCustomFieldValues.findBy('task_gid', taskGid).find(v => v.custom_field_gid === fieldGid)
    if (existing) {
      as.taskCustomFieldValues.update(existing.id, { text_value: textValue })
    }
    else {
      as.taskCustomFieldValues.insert({ task_gid: taskGid, custom_field_gid: fieldGid, text_value: textValue })
    }
  }
}
