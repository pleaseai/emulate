import type { AppKeyResolver, AuthFallback, ServicePlugin, Store, WebhookDispatcher } from '@emulators/core'

export interface LoadedService {
  plugin: ServicePlugin
  seedFromConfig?: (store: Store, baseUrl: string, config: unknown, webhooks?: WebhookDispatcher) => void
  createAppKeyResolver?: (store: Store) => AppKeyResolver
}

// Each service types its seedFromConfig with its own config shape; the registry
// hands configs around as `unknown`, so widen the parameter type here.
function widenSeed(seed: (store: Store, baseUrl: string, config: never, webhooks?: WebhookDispatcher) => void): LoadedService['seedFromConfig'] {
  return seed as LoadedService['seedFromConfig']
}

export interface ServiceEntry {
  label: string
  endpoints: string
  load: () => Promise<LoadedService>
  defaultFallback: (svcSeedConfig?: Record<string, unknown>) => AuthFallback
  initConfig: Record<string, unknown>
}

const SERVICE_NAME_LIST = ['kakao', 'naver', 'tosspayments', 'firebase', 'supabase', 'asana', 'linear', 'autumn', 'gitlab', 'posthog', 'spotify', 'workos', 'x'] as const
export type ServiceName = (typeof SERVICE_NAME_LIST)[number]
export const SERVICE_NAMES: readonly ServiceName[] = SERVICE_NAME_LIST

export const SERVICE_REGISTRY: Record<ServiceName, ServiceEntry> = {
  kakao: {
    label: 'Kakao API emulator (kauth + kapi)',
    endpoints: 'OAuth 2.0 authorize/token, user me, access token info, logout, unlink, KakaoTalk memo send',
    async load() {
      const mod = await import('@pleaseai/emulate-kakao')
      return { plugin: mod.kakaoPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const firstNickname = (cfg?.users as Array<{ nickname?: string }> | undefined)?.[0]?.nickname ?? 'admin'
      return { login: firstNickname, id: 1, scopes: [] }
    },
    initConfig: {
      kakao: {
        apps: [
          {
            client_id: 'kakao_rest_api_key_example',
            client_secret: 'kakao_client_secret_example',
            redirect_uris: ['http://localhost:3000/api/auth/callback/kakao'],
          },
        ],
        users: [
          {
            user_id: 1001,
            nickname: '홍길동',
            email: 'hong@example.com',
            profile_image_url: 'https://k.kakaocdn.net/dn/profile.jpg',
          },
        ],
      },
    },
  },

  naver: {
    label: 'Naver API emulator (nid + openapi)',
    endpoints: 'OAuth 2.0 authorize/token (issue, refresh, delete), user profile (/v1/nid/me)',
    async load() {
      const mod = await import('@pleaseai/emulate-naver')
      return { plugin: mod.naverPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const firstName = (cfg?.users as Array<{ name?: string }> | undefined)?.[0]?.name ?? 'admin'
      return { login: firstName, id: 1, scopes: [] }
    },
    initConfig: {
      naver: {
        apps: [
          {
            client_id: 'naver_client_id_example',
            client_secret: 'naver_client_secret_example',
            callback_urls: ['http://localhost:3000/api/auth/callback/naver'],
          },
        ],
        users: [
          {
            name: '홍길동',
            nickname: 'gildong',
            email: 'hong@example.com',
            gender: 'M',
            birthyear: '1990',
            mobile: '010-1234-5678',
          },
        ],
      },
    },
  },

  tosspayments: {
    label: 'Toss Payments API emulator',
    endpoints: 'payments confirm/lookup/cancel, orders lookup, checkout page, webhooks',
    async load() {
      const mod = await import('@pleaseai/emulate-toss-payments')
      return { plugin: mod.tossPaymentsPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback() {
      return { login: 'merchant', id: 1, scopes: [] }
    },
    initConfig: {
      tosspayments: {
        merchants: [
          {
            client_key: 'test_ck_example',
            secret_key: 'test_sk_example',
          },
        ],
      },
    },
  },

  firebase: {
    label: 'Firebase emulator (Auth + FCM)',
    endpoints: 'Identity Toolkit signUp/signIn/lookup/update/delete, secure token refresh, FCM messages:send',
    async load() {
      const mod = await import('@pleaseai/emulate-firebase')
      return { plugin: mod.firebasePlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? 'admin@example.com'
      return { login: firstEmail, id: 1, scopes: [] }
    },
    initConfig: {
      firebase: {
        projects: [
          {
            project_id: 'demo-project',
            api_key: 'firebase_api_key_example',
          },
        ],
        users: [
          {
            email: 'hong@example.com',
            password: 'password123',
            display_name: '홍길동',
          },
        ],
      },
    },
  },

  supabase: {
    label: 'Supabase emulator (GoTrue Auth + PostgREST)',
    endpoints: 'auth signup/token/user/logout, rest table CRUD with filters',
    async load() {
      const mod = await import('@pleaseai/emulate-supabase')
      return { plugin: mod.supabasePlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? 'admin@example.com'
      return { login: firstEmail, id: 1, scopes: [] }
    },
    initConfig: {
      supabase: {
        anon_key: 'supabase_anon_key_example',
        service_role_key: 'supabase_service_role_key_example',
        users: [
          {
            email: 'hong@example.com',
            password: 'password123',
          },
        ],
        tables: {
          todos: [
            { id: 1, title: '장보기', completed: false },
            { id: 2, title: '청소하기', completed: true },
          ],
        },
      },
    },
  },

  asana: {
    label: 'Asana project management API emulator',
    endpoints: 'users, workspaces, projects, sections, tasks, tags, stories, teams, webhooks',
    async load() {
      const mod = await import('@pleaseai/emulate-asana')
      return { plugin: mod.asanaPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const users = cfg?.users as Array<{ email?: string, name?: string }> | undefined
      const firstUser = users?.[0]?.email ?? users?.[0]?.name ?? 'me'
      return { login: firstUser, id: 1, scopes: [] }
    },
    initConfig: {
      asana: {
        workspaces: [{ name: 'My Workspace', is_organization: true }],
        users: [{ name: 'Developer', email: 'dev@example.com' }],
        teams: [{ name: 'Engineering', workspace: 'My Workspace' }],
        projects: [{ name: 'My Project', workspace: 'My Workspace', team: 'Engineering', owner: 'Developer' }],
        tasks: [{ name: 'Example Task', project: 'My Project', assignee: 'Developer' }],
      },
    },
  },

  linear: {
    label: 'Linear GraphQL API emulator',
    endpoints:
      'GraphQL queries for issues, projects, teams, users, organizations, labels, workflow states with Relay-style pagination',
    async load() {
      const mod = await import('@pleaseai/emulate-linear')
      return { plugin: mod.linearPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback() {
      return { login: 'linear-admin', id: 1, scopes: ['read'] }
    },
    initConfig: {
      linear: {
        api_keys: ['lin_api_test'],
        organizations: [{ id: 'org-1', name: 'My Org' }],
        teams: [{ id: 'team-1', name: 'Engineering', key: 'ENG', organization: 'org-1' }],
        users: [{ id: 'user-1', name: 'Developer', email: 'dev@example.com', organization: 'org-1' }],
        workflow_states: [
          { id: 'ws-1', name: 'Todo', type: 'unstarted', team: 'team-1' },
          { id: 'ws-2', name: 'In Progress', type: 'started', team: 'team-1' },
        ],
        issues: [{ id: 'issue-1', title: 'First issue', team: 'team-1', state: 'ws-1', assignee: 'user-1' }],
      },
    },
  },

  autumn: {
    label: 'Autumn billing API emulator',
    endpoints: 'customers get_or_create/update, balances track/check, plans list, billing attach, checkout page',
    async load() {
      const mod = await import('@pleaseai/emulate-autumn')
      return { plugin: mod.autumnPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback() {
      return { login: 'am_emulate_admin', id: 1, scopes: [] }
    },
    initConfig: {
      autumn: {
        plans: [
          { id: 'free', name: 'Free', auto_enable: true, items: [{ feature_id: 'executions', included: 100 }] },
          { id: 'pro', name: 'Pro', price: { amount: 20, interval: 'month' }, items: [{ feature_id: 'executions', included: 10000 }] },
        ],
        customers: [{ id: 'org_demo', subscriptions: [{ plan_id: 'pro', status: 'active' }] }],
      },
    },
  },

  gitlab: {
    label: 'GitLab GraphQL API emulator',
    endpoints: 'GraphQL endpoint with introspection against the GitLab schema',
    async load() {
      const mod = await import('@pleaseai/emulate-gitlab')
      return { plugin: mod.gitlabPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback() {
      return { login: 'gitlab-admin', id: 1, scopes: ['api'] }
    },
    initConfig: {
      gitlab: {},
    },
  },

  posthog: {
    label: 'PostHog analytics API emulator',
    endpoints: 'event capture, users, projects, OAuth 2.0 authorize/token with scoped clients',
    async load() {
      const mod = await import('@pleaseai/emulate-posthog')
      return { plugin: mod.posthogPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? 'admin@example.com'
      return { login: firstEmail, id: 1, scopes: [] }
    },
    initConfig: {
      posthog: {
        users: [{ email: 'dev@example.com', name: 'Developer' }],
        projects: [{ name: 'Demo Project', api_token: 'phc_test_token' }],
      },
    },
  },

  spotify: {
    label: 'Spotify Web API emulator',
    endpoints: 'OAuth 2.0 client credentials token, search, artists, albums, tracks',
    async load() {
      const mod = await import('@pleaseai/emulate-spotify')
      return { plugin: mod.spotifyPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback() {
      return { login: 'spotify-app', id: 1, scopes: [] }
    },
    initConfig: {
      spotify: {
        clients: [{ client_id: 'spotify_client_id_example', client_secret: 'spotify_client_secret_example', name: 'Demo App' }],
        artists: [
          {
            name: 'Daft Punk',
            genres: ['electronic'],
            albums: [{ name: 'Discovery', release_date: '2001-03-12', tracks: [{ name: 'One More Time' }] }],
          },
        ],
      },
    },
  },

  workos: {
    label: 'WorkOS user management API emulator',
    endpoints: 'user management authenticate, organizations, memberships, invitations, API keys, OAuth/OIDC, vault',
    async load() {
      const mod = await import('@pleaseai/emulate-workos')
      return { plugin: mod.workosPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const firstEmail = (cfg?.users as Array<{ email?: string }> | undefined)?.[0]?.email ?? 'admin@example.com'
      return { login: firstEmail, id: 1, scopes: [] }
    },
    initConfig: {
      workos: {
        users: [{ email: 'dev@example.com', first_name: 'Dev', last_name: 'Eloper' }],
        organizations: [{ name: 'Demo Org', members: ['dev@example.com'] }],
      },
    },
  },

  x: {
    label: 'X (Twitter) API v2 emulator',
    endpoints: 'OAuth 2.0 PKCE authorize/token, tweets, users lookup, timelines',
    async load() {
      const mod = await import('@pleaseai/emulate-x')
      return { plugin: mod.xPlugin, seedFromConfig: widenSeed(mod.seedFromConfig) }
    },
    defaultFallback(cfg) {
      const firstUsername = (cfg?.users as Array<{ username?: string }> | undefined)?.[0]?.username ?? 'developer'
      return { login: firstUsername, id: 1, scopes: [] }
    },
    initConfig: {
      x: {
        users: [{ username: 'developer', name: 'Developer' }],
        oauth_clients: [
          {
            client_id: 'x_client_id_example',
            client_secret: 'x_client_secret_example',
            client_type: 'confidential',
            redirect_uris: ['http://localhost:3000/api/auth/callback/x'],
          },
        ],
        tweets: [{ text: 'Hello from the emulator!', author: 'developer' }],
      },
    },
  },
}
