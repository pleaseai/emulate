import type { AppEnv, Hono, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from '@emulators/core'
import { generateLocalId } from './helpers.js'
import { fcmRoutes } from './routes/fcm.js'
import { identityRoutes } from './routes/identity.js'
import { internalRoutes } from './routes/internal.js'
import { tokenRoutes } from './routes/token.js'
import { getFirebaseStore } from './store.js'

export * from './entities.js'
export {
  createIdToken,
  decodeIdToken,
  generateLocalId,
  generateRefreshToken,
  generateUuid,
  type IdTokenPayload,
} from './helpers.js'
export { type FirebaseStore, getFirebaseStore } from './store.js'

const DEFAULT_PROJECT_ID = 'demo-project'
const DEFAULT_API_KEY = 'demo-api-key'

export interface FirebaseSeedConfig {
  port?: number
  projects?: Array<{
    project_id: string
    api_key: string
  }>
  users?: Array<{
    email: string
    password: string
    display_name?: string
    local_id?: string
  }>
}

export function seedFromConfig(
  store: Store,
  _baseUrl: string,
  config: FirebaseSeedConfig,
  _webhooks?: WebhookDispatcher,
): void {
  const fs = getFirebaseStore(store)

  const projects = config.projects ?? []
  for (const p of projects) {
    // Config wins over default seed: update the api_key if the project already exists.
    const existing = fs.projects.findOneBy('project_id', p.project_id)
    if (existing) {
      if (existing.api_key !== p.api_key) {
        fs.projects.update(existing.id, { api_key: p.api_key })
      }
      continue
    }
    fs.projects.insert({ project_id: p.project_id, api_key: p.api_key })
  }

  // Users attach to the first seeded project (or the default one).
  const projectId = projects[0]?.project_id ?? DEFAULT_PROJECT_ID

  for (const u of config.users ?? []) {
    if (fs.users.findOneBy('email', u.email)) {
      continue
    }
    const now = new Date().toISOString()
    fs.users.insert({
      local_id: u.local_id && u.local_id.length > 0 ? u.local_id : generateLocalId(),
      project_id: projectId,
      email: u.email,
      password: u.password,
      display_name: u.display_name ?? null,
      email_verified: false,
      provider: 'password',
      valid_since: now,
      last_login_at: now,
      last_refresh_at: now,
    })
  }
}

export const firebasePlugin: ServicePlugin = {
  name: 'firebase',
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap }
    identityRoutes(ctx)
    tokenRoutes(ctx)
    fcmRoutes(ctx)
    internalRoutes(ctx)
  },
  seed(store: Store, _baseUrl: string): void {
    const fs = getFirebaseStore(store)
    if (!fs.projects.findOneBy('project_id', DEFAULT_PROJECT_ID)) {
      fs.projects.insert({ project_id: DEFAULT_PROJECT_ID, api_key: DEFAULT_API_KEY })
    }
  },
}

export default firebasePlugin
