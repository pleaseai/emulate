import type { RouteContext } from '@emulators/core'
import {
  applyPagination,
  asanaData,
  asanaError,
  formatCustomField,
  formatCustomFieldSetting,
  generateGid,
  parseAsanaBody,
  parsePagination,
} from '../helpers.js'
import { getAsanaStore } from '../store.js'

export function customFieldRoutes({ app, store, baseUrl }: RouteContext): void {
  const as = () => getAsanaStore(store)

  app.post('/api/1.0/custom_fields', async (c) => {
    const body = await parseAsanaBody(c)
    if (!body.workspace) {
      return asanaError(c, 400, 'workspace: Missing input')
    }
    if (!body.name) {
      return asanaError(c, 400, 'name: Missing input')
    }
    const subtype = body.resource_subtype ?? body.type
    if (!subtype) {
      return asanaError(c, 400, 'resource_subtype: Missing input')
    }
    if (subtype !== 'text') {
      return asanaError(c, 400, `resource_subtype: The emulator supports only text custom fields, got ${String(subtype)}`)
    }

    const workspaceGid = body.workspace as string
    if (!as().workspaces.findOneBy('gid', workspaceGid)) {
      return asanaError(c, 404, 'workspace: Not Found')
    }

    const field = as().customFields.insert({
      gid: generateGid(),
      resource_type: 'custom_field',
      resource_subtype: 'text',
      name: body.name as string,
      description: (body.description as string | undefined) ?? '',
      workspace_gid: workspaceGid,
    })
    return c.json(asanaData(formatCustomField(field, as())), 201)
  })

  app.get('/api/1.0/workspaces/:workspace_gid/custom_fields', (c) => {
    const workspaceGid = c.req.param('workspace_gid')
    if (!as().workspaces.findOneBy('gid', workspaceGid)) {
      return asanaError(c, 404, 'workspace: Not Found')
    }

    const pagination = parsePagination(c)
    const fields = as().customFields.findBy('workspace_gid', workspaceGid).map(f => formatCustomField(f, as()))
    const result = applyPagination(fields, pagination, `/api/1.0/workspaces/${workspaceGid}/custom_fields`, baseUrl)
    return c.json(result)
  })

  app.post('/api/1.0/projects/:project_gid/addCustomFieldSetting', async (c) => {
    const projectGid = c.req.param('project_gid')
    const project = as().projects.findOneBy('gid', projectGid)
    if (!project) {
      return asanaError(c, 404, 'project: Not Found')
    }

    const body = await parseAsanaBody(c)
    const fieldGid = body.custom_field as string | undefined
    if (!fieldGid) {
      return asanaError(c, 400, 'custom_field: Missing input')
    }
    const field = as().customFields.findOneBy('gid', fieldGid)
    if (!field) {
      return asanaError(c, 404, 'custom_field: Not Found')
    }
    if (field.workspace_gid !== project.workspace_gid) {
      return asanaError(c, 400, 'custom_field: Custom field is not in the project\'s workspace')
    }
    if (as().customFieldSettings.findBy('project_gid', projectGid).some(s => s.custom_field_gid === fieldGid)) {
      return asanaError(c, 400, `custom_field: Custom field with ID ${fieldGid} is already on the project`)
    }

    const setting = as().customFieldSettings.insert({
      gid: generateGid(),
      resource_type: 'custom_field_setting',
      project_gid: projectGid,
      custom_field_gid: fieldGid,
      is_important: (body.is_important as boolean | undefined) ?? false,
    })
    return c.json(asanaData(formatCustomFieldSetting(setting, as())))
  })

  app.get('/api/1.0/projects/:project_gid/custom_field_settings', (c) => {
    const projectGid = c.req.param('project_gid')
    if (!as().projects.findOneBy('gid', projectGid)) {
      return asanaError(c, 404, 'project: Not Found')
    }

    const pagination = parsePagination(c)
    const settings = as().customFieldSettings.findBy('project_gid', projectGid).map(s => formatCustomFieldSetting(s, as()))
    const result = applyPagination(settings, pagination, `/api/1.0/projects/${projectGid}/custom_field_settings`, baseUrl)
    return c.json(result)
  })
}
