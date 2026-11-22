import type { AsanaStore } from './store.js'

export type CustomFieldValueResult
  = | { ok: true, values: Map<string, string | null> }
    | { ok: false, message: string }

export function parseCustomFieldValues(
  as: AsanaStore,
  input: unknown,
  allowedFieldGids: Iterable<string>,
  clearableFieldGids: Iterable<string> = [],
): CustomFieldValueResult {
  const values = new Map<string, string | null>()
  if (input === undefined || input === null) {
    return { ok: true, values }
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'custom_fields: Value must be an object' }
  }

  const allowed = new Set(allowedFieldGids)
  const clearable = new Set(clearableFieldGids)
  for (const [gid, value] of Object.entries(input as Record<string, unknown>)) {
    const writable = allowed.has(gid) || (value === null && clearable.has(gid))
    if (!as.customFields.findOneBy('gid', gid) || !writable) {
      return { ok: false, message: `custom_fields: Custom field with ID ${gid} is not on given object` }
    }
    if (value !== null && typeof value !== 'string') {
      return { ok: false, message: `custom_fields: Text custom field ${gid} requires a string value` }
    }
    values.set(gid, value)
  }
  return { ok: true, values }
}

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
    if (textValue === null) {
      if (existing) {
        as.taskCustomFieldValues.delete(existing.id)
      }
    }
    else if (existing) {
      as.taskCustomFieldValues.update(existing.id, { text_value: textValue })
    }
    else {
      as.taskCustomFieldValues.insert({ task_gid: taskGid, custom_field_gid: fieldGid, text_value: textValue })
    }
  }
}
