import type { AppEnv, Hono, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from '@emulators/core'
import type { AsanaFailureRuleInput } from './failures.js'
import { failNext, failureMiddleware } from './failures.js'
import { generateGid } from './helpers.js'
import { customFieldRoutes } from './routes/custom-fields.js'
import { projectRoutes } from './routes/projects.js'
import { sectionRoutes } from './routes/sections.js'
import { storyRoutes } from './routes/stories.js'
import { tagRoutes } from './routes/tags.js'
import { taskRoutes } from './routes/tasks.js'
import { teamRoutes } from './routes/teams.js'
import { userRoutes } from './routes/users.js'
import { webhookRoutes } from './routes/webhooks.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { getAsanaStore } from './store.js'

export * from './entities.js'
export { type AsanaFailureRuleInput, clearFailures, failNext } from './failures.js'
export { type AsanaStore, getAsanaStore } from './store.js'
export { Hono, Store, WebhookDispatcher } from '@emulators/core'

export interface AsanaSeedConfig {
  port?: number
  workspaces?: Array<{
    name: string
    is_organization?: boolean
  }>
  users?: Array<{
    name: string
    email?: string
  }>
  teams?: Array<{
    name: string
    workspace?: string
    visibility?: 'secret' | 'request_to_join' | 'public'
  }>
  projects?: Array<{
    name: string
    workspace?: string
    team?: string
    owner?: string
    color?: string
    default_view?: 'list' | 'board' | 'calendar' | 'timeline'
  }>
  sections?: Array<{
    name: string
    project?: string
  }>
  tasks?: Array<{
    name: string
    project?: string
    section?: string
    assignee?: string
    completed?: boolean
    due_on?: string
  }>
  tags?: Array<{
    name: string
    workspace?: string
    color?: string
  }>
  custom_fields?: Array<{
    name: string
    workspace?: string
    resource_subtype?: 'text'
    description?: string
  }>
  /** Attaches a custom field (by name) to a project (by name). */
  custom_field_settings?: Array<{
    project: string
    custom_field: string
    is_important?: boolean
  }>
  /** Failure rules applied to incoming requests; see `failNext`. */
  failures?: AsanaFailureRuleInput[]
}

export function seedFromConfig(store: Store, baseUrl: string, config: AsanaSeedConfig): void {
  const as = getAsanaStore(store)

  if (config.workspaces) {
    for (const ws of config.workspaces) {
      const existing = as.workspaces.all().find(w => w.name === ws.name)
      if (existing) {
        continue
      }
      as.workspaces.insert({
        gid: generateGid(),
        resource_type: 'workspace',
        name: ws.name,
        is_organization: ws.is_organization ?? false,
        email_domains: [],
      })
    }
  }

  const defaultWorkspace = as.workspaces.all()[0]
  const findWorkspaceGid = (name?: string): string | undefined =>
    name ? (as.workspaces.all().find(w => w.name === name)?.gid ?? defaultWorkspace?.gid) : defaultWorkspace?.gid

  if (config.users) {
    for (const u of config.users) {
      const email = u.email ?? `${u.name.toLowerCase().replace(/\s+/g, '.')}@example.com`
      const existing = as.users.findOneBy('email', email)
      if (existing) {
        continue
      }
      as.users.insert({
        gid: generateGid(),
        resource_type: 'user',
        name: u.name,
        email,
        photo: null,
      })
    }
  }

  if (config.teams) {
    for (const t of config.teams) {
      const existing = as.teams.all().find(team => team.name === t.name)
      if (existing) {
        continue
      }

      const wsGid = findWorkspaceGid(t.workspace)
      if (!wsGid) {
        continue
      }

      as.teams.insert({
        gid: generateGid(),
        resource_type: 'team',
        name: t.name,
        workspace_gid: wsGid,
        description: '',
        html_description: '',
        visibility: t.visibility ?? 'secret',
        permalink_url: '',
      })
    }
  }

  if (config.projects) {
    for (const p of config.projects) {
      const existing = as.projects.all().find(proj => proj.name === p.name)
      if (existing) {
        continue
      }

      const wsGid = findWorkspaceGid(p.workspace)
      if (!wsGid) {
        continue
      }

      const ownerGid = p.owner
        ? (as.users.all().find(u => u.name === p.owner)?.gid ?? null)
        : null
      const teamGid = p.team
        ? (as.teams.all().find(t => t.name === p.team)?.gid ?? null)
        : null

      as.projects.insert({
        gid: generateGid(),
        resource_type: 'project',
        name: p.name,
        workspace_gid: wsGid,
        owner_gid: ownerGid,
        team_gid: teamGid,
        archived: false,
        color: p.color ?? null,
        notes: '',
        html_notes: '',
        privacy_setting: 'public_to_workspace',
        default_view: p.default_view ?? 'list',
        completed: false,
        completed_at: null,
        permalink_url: '',
      })
    }
  }

  if (config.sections) {
    for (const s of config.sections) {
      const project = s.project ? as.projects.all().find(p => p.name === s.project) : null
      if (!project) {
        continue
      }

      const existing = as.sections.findBy('project_gid', project.gid).find(sec => sec.name === s.name)
      if (existing) {
        continue
      }

      as.sections.insert({
        gid: generateGid(),
        resource_type: 'section',
        name: s.name,
        project_gid: project.gid,
      })
    }
  }

  if (config.tags) {
    for (const t of config.tags) {
      const wsGid = findWorkspaceGid(t.workspace)
      if (!wsGid) {
        continue
      }

      const existing = as.tags.findBy('workspace_gid', wsGid).find(tag => tag.name === t.name)
      if (existing) {
        continue
      }

      as.tags.insert({
        gid: generateGid(),
        resource_type: 'tag',
        name: t.name,
        workspace_gid: wsGid,
        color: t.color ?? null,
        permalink_url: '',
      })
    }
  }

  if (config.custom_fields) {
    for (const f of config.custom_fields) {
      const wsGid = findWorkspaceGid(f.workspace)
      if (!wsGid || as.customFields.findBy('workspace_gid', wsGid).some(field => field.name === f.name)) {
        continue
      }
      as.customFields.insert({
        gid: generateGid(),
        resource_type: 'custom_field',
        resource_subtype: f.resource_subtype ?? 'text',
        name: f.name,
        description: f.description ?? '',
        workspace_gid: wsGid,
      })
    }
  }

  if (config.custom_field_settings) {
    for (const s of config.custom_field_settings) {
      const project = as.projects.all().find(p => p.name === s.project)
      const field = project && as.customFields.findBy('workspace_gid', project.workspace_gid).find(f => f.name === s.custom_field)
      if (!project || !field) {
        continue
      }
      if (as.customFieldSettings.findBy('project_gid', project.gid).some(cfs => cfs.custom_field_gid === field.gid)) {
        continue
      }
      as.customFieldSettings.insert({
        gid: generateGid(),
        resource_type: 'custom_field_setting',
        project_gid: project.gid,
        custom_field_gid: field.gid,
        is_important: s.is_important ?? false,
      })
    }
  }

  for (const rule of config.failures ?? []) {
    failNext(store, rule)
  }

  // Seed tasks
  if (config.tasks) {
    for (const t of config.tasks) {
      const project = t.project ? as.projects.all().find(p => p.name === t.project) : null
      const wsGid = project?.workspace_gid ?? defaultWorkspace?.gid
      if (!wsGid) {
        continue
      }

      const assigneeGid = t.assignee
        ? (as.users.all().find(u => u.name === t.assignee)?.gid ?? null)
        : null

      const taskGid = generateGid()
      as.tasks.insert({
        gid: taskGid,
        resource_type: 'task',
        resource_subtype: 'default_task',
        name: t.name,
        assignee_gid: assigneeGid,
        workspace_gid: wsGid,
        completed: t.completed ?? false,
        completed_at: null,
        due_on: t.due_on ?? null,
        due_at: null,
        start_on: null,
        notes: '',
        html_notes: '',
        liked: false,
        num_likes: 0,
        parent_gid: null,
        permalink_url: '',
        follower_gids: [],
      })

      if (project) {
        const sectionGid = t.section
          ? (as.sections.findBy('project_gid', project.gid).find(s => s.name === t.section)?.gid ?? null)
          : null
        as.taskProjects.insert({
          task_gid: taskGid,
          project_gid: project.gid,
          section_gid: sectionGid,
        })
      }
    }
  }
}

export const asanaPlugin: ServicePlugin = {
  name: 'asana',
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap }
    app.use('/api/1.0/*', failureMiddleware(store))
    userRoutes(ctx)
    workspaceRoutes(ctx)
    projectRoutes(ctx)
    sectionRoutes(ctx)
    taskRoutes(ctx)
    tagRoutes(ctx)
    storyRoutes(ctx)
    teamRoutes(ctx)
    webhookRoutes(ctx)
    customFieldRoutes(ctx)
  },
  seed(store: Store, _baseUrl: string): void {
    const as = getAsanaStore(store)
    // Seed a default workspace
    if (as.workspaces.all().length === 0) {
      as.workspaces.insert({
        gid: generateGid(),
        resource_type: 'workspace',
        name: 'My Workspace',
        is_organization: false,
        email_domains: [],
      })
    }
  },
}

export default asanaPlugin
