import type { Store } from '@emulators/core'
import type { JiraUser } from './entities.js'
import { accountId } from './ids.js'
import { getJiraStore } from './store.js'

export function ensureUser(
  store: Store,
  input: {
    email: string
    display_name?: string
    account_id?: string
    admin?: boolean
    active?: boolean
    account_type?: 'atlassian' | 'app' | 'customer'
    time_zone?: string
  },
) {
  const js = getJiraStore(store)
  const existing = js.users.all().find(user => user.email.toLowerCase() === input.email.toLowerCase())
  if (existing) {
    return existing
  }
  return js.users.insert({
    account_id: input.account_id ?? accountId(),
    email: input.email,
    display_name: input.display_name ?? input.email.split('@')[0],
    active: input.active ?? true,
    account_type: input.account_type ?? 'atlassian',
    time_zone: input.time_zone ?? 'Etc/UTC',
    locale: 'en_US',
    admin: input.admin ?? false,
  })
}

export function ensureApiToken(store: Store, account: string, token: string, label = 'emulate') {
  const js = getJiraStore(store)
  const existing = js.apiTokens.findBy('token', token).find(t => t.account_id === account)
  return existing ?? js.apiTokens.insert({ token, account_id: account, label })
}

export interface UserSeedInput {
  email: string
  display_name?: string
  account_id?: string
  admin?: boolean
  active?: boolean
  time_zone?: string
}

export function updateUser(store: Store, user: JiraUser, input: UserSeedInput): JiraUser {
  const js = getJiraStore(store)
  const patch: Partial<JiraUser> = {}
  if (input.display_name !== undefined) {
    patch.display_name = input.display_name
  }
  if (input.admin !== undefined) {
    patch.admin = input.admin
  }
  if (input.active !== undefined) {
    patch.active = input.active
  }
  if (input.time_zone !== undefined) {
    patch.time_zone = input.time_zone
  }
  let current = user
  if (Object.keys(patch).length > 0) {
    current = js.users.update(user.id, patch)!
  }
  if (input.account_id && input.account_id !== current.account_id) {
    current = migrateAccountId(store, current, input.account_id)
  }
  return current
}

function migrateAccountId(store: Store, user: JiraUser, next: string): JiraUser {
  const js = getJiraStore(store)
  const prev = user.account_id
  if (js.users.findOneBy('account_id', next)) {
    return user
  }
  const swap = (value: string | null) => (value === prev ? next : value)
  for (const token of js.apiTokens.findBy('account_id', prev)) {
    js.apiTokens.update(token.id, { account_id: next })
  }
  for (const token of js.oauthTokens.findBy('account_id', prev)) {
    js.oauthTokens.update(token.id, { account_id: next })
  }
  const userFields = js.customFields.all().filter(field => field.type === 'user')
  const userFieldIds = new Set(['assignee', 'reporter', 'creator', ...userFields.map(field => field.field_id)])
  for (const issue of js.issues.all()) {
    const custom = { ...issue.custom_fields }
    for (const field of userFields) {
      if (custom[field.field_id] === prev) {
        custom[field.field_id] = next
      }
    }
    js.issues.update(issue.id, {
      assignee_id: swap(issue.assignee_id),
      reporter_id: swap(issue.reporter_id),
      creator_id: swap(issue.creator_id),
      watcher_ids: issue.watcher_ids.map(id => (id === prev ? next : id)),
      custom_fields: custom,
    })
  }
  for (const comment of js.comments.all()) {
    js.comments.update(comment.id, { author_id: swap(comment.author_id), update_author_id: swap(comment.update_author_id) })
  }
  for (const worklog of js.worklogs.all()) {
    js.worklogs.update(worklog.id, { author_id: swap(worklog.author_id), update_author_id: swap(worklog.update_author_id) })
  }
  for (const changelog of js.changelogs.all()) {
    js.changelogs.update(changelog.id, {
      author_id: swap(changelog.author_id),
      items: changelog.items.map(item =>
        userFieldIds.has(item.fieldId) ? { ...item, from: swap(item.from), to: swap(item.to) } : item,
      ),
    })
  }
  for (const project of js.projects.all()) {
    js.projects.update(project.id, { lead_account_id: swap(project.lead_account_id) })
  }
  for (const component of js.components.all()) {
    js.components.update(component.id, { lead_account_id: swap(component.lead_account_id) })
  }
  return js.users.update(user.id, { account_id: next })!
}
