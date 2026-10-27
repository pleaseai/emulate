import type { JiraBoardType, JiraCustomFieldType, JiraStatusCategory } from './entities.js'

export interface JiraSeedConfig {
  port?: number
  baseUrl?: string
  site?: { name?: string, cloud_id?: string }
  users?: Array<{
    email: string
    display_name?: string
    account_id?: string
    admin?: boolean
    active?: boolean
    time_zone?: string
    /** API token accepted for Basic auth (`email:token`) and as a bearer token. */
    api_token?: string
  }>
  statuses?: Array<{ name: string, category?: JiraStatusCategory, description?: string }>
  issue_types?: Array<{ name: string, description?: string, subtask?: boolean, hierarchy_level?: number }>
  custom_fields?: Array<{ id?: string, name: string, type: JiraCustomFieldType, options?: string[] }>
  projects?: Array<{
    key: string
    name: string
    description?: string
    lead?: string
    type?: 'software' | 'business' | 'service_desk'
    statuses?: string[]
    issue_types?: string[]
    components?: string[]
    versions?: Array<string | { name: string, released?: boolean, release_date?: string, description?: string }>
    board?: boolean | { name?: string, type?: JiraBoardType }
  }>
  sprints?: Array<{
    /** Project key or ID; the sprint goes on that project's first scrum board. */
    project?: string
    /** Board name; takes precedence over `project`. */
    board?: string
    name: string
    state?: 'future' | 'active' | 'closed'
    goal?: string
    start_date?: string
    end_date?: string
  }>
  issues?: Array<{
    project: string
    summary: string
    type?: string
    description?: string
    status?: string
    priority?: string
    assignee?: string
    reporter?: string
    labels?: string[]
    /** Key or summary of the parent issue. */
    parent?: string
    due_date?: string
    components?: string[]
    fix_versions?: string[]
    sprint?: string
    custom_fields?: Record<string, unknown>
    comments?: Array<{ body: string, author?: string }>
  }>
  links?: Array<{ type: string, inward: string, outward: string }>
  oauth_apps?: Array<{
    client_id: string
    client_secret: string
    name: string
    redirect_uris: string[]
    scopes?: string[] | string
  }>
  webhooks?: Array<{
    name?: string
    url: string
    events?: string[]
    jql?: string
    secret?: string
    enabled?: boolean
    exclude_body?: boolean
  }>
  strict_scopes?: boolean
}
