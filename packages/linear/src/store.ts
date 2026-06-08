import type { Collection, Store } from '@emulators/core'
import type {
  LinearApiKey,
  LinearIssue,
  LinearLabel,
  LinearOrganization,
  LinearProject,
  LinearTeam,
  LinearUser,
  LinearWorkflowState,
} from './entities.js'

export interface LinearStore {
  apiKeys: Collection<LinearApiKey>
  organizations: Collection<LinearOrganization>
  users: Collection<LinearUser>
  teams: Collection<LinearTeam>
  workflowStates: Collection<LinearWorkflowState>
  labels: Collection<LinearLabel>
  projects: Collection<LinearProject>
  issues: Collection<LinearIssue>
}

export function getLinearStore(store: Store): LinearStore {
  return {
    apiKeys: store.collection<LinearApiKey>('linear.api_keys', ['key']),
    organizations: store.collection<LinearOrganization>('linear.organizations', ['linear_id', 'url_key']),
    users: store.collection<LinearUser>('linear.users', ['linear_id', 'email', 'organization_id']),
    teams: store.collection<LinearTeam>('linear.teams', ['linear_id', 'key', 'organization_id']),
    workflowStates: store.collection<LinearWorkflowState>('linear.workflow_states', ['linear_id', 'team_id']),
    labels: store.collection<LinearLabel>('linear.labels', ['linear_id', 'team_id']),
    projects: store.collection<LinearProject>('linear.projects', ['linear_id', 'slug_id', 'team_id', 'lead_id']),
    issues: store.collection<LinearIssue>('linear.issues', ['linear_id', 'identifier', 'team_id', 'project_id', 'state_id', 'assignee_id', 'creator_id']),
  }
}
