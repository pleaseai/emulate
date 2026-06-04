import type { Context, RouteContext } from '@emulators/core'
import type { FirebaseUser } from '../entities.js'
import type { FirebaseStore } from '../store.js'
import {
  apiKeyError,
  createIdToken,
  decodeIdToken,
  generateLocalId,
  generateRefreshToken,
  generateUuid,
  identityError,
  resolveProjectByApiKey,
} from '../helpers.js'
import { getFirebaseStore } from '../store.js'

const IDENTITY_PREFIXES = ['/v1', '/identitytoolkit.googleapis.com/v1']

export function identityRoutes(ctx: RouteContext): void {
  const { app, store } = ctx
  const fs = (): FirebaseStore => getFirebaseStore(store)

  // accounts:<action> shares one router per prefix because the underlying
  // router parses ":action" as a path param ( ":signUp", ":lookup", ... ).
  for (const prefix of IDENTITY_PREFIXES) {
    app.post(`${prefix}/accounts:action`, async (c) => {
      const action = c.req.param('action') // e.g. ":signUp"
      switch (action) {
        case ':signUp':
          return handleSignUp(c, store, fs)
        case ':signInWithPassword':
          return handleSignIn(c, store, fs)
        case ':lookup':
          return handleLookup(c, store, fs)
        case ':update':
          return handleUpdate(c, store, fs)
        case ':delete':
          return handleDelete(c, store, fs)
        case ':sendOobCode':
          return handleSendOobCode(c, store, fs)
        default:
          return identityError(c, 'OPERATION_NOT_ALLOWED')
      }
    })
  }
}

function issueTokens(
  fs: FirebaseStore,
  user: FirebaseUser,
): { idToken: string, refreshToken: string, expiresIn: string } {
  const { token, exp } = createIdToken(user)
  const refreshToken = generateRefreshToken()
  fs.tokens.insert({
    id_token: token,
    refresh_token: refreshToken,
    local_id: user.local_id,
    project_id: user.project_id,
    expires_at: exp,
  })
  return { idToken: token, refreshToken, expiresIn: '3600' }
}

async function handleSignUp(c: Context, store: import('@emulators/core').Store, fs: () => FirebaseStore) {
  const projectId = resolveProjectByApiKey(store, c.req.query('key'))
  if (!projectId) {
    return apiKeyError(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email : undefined
  const password = typeof body.password === 'string' ? body.password : undefined

  const s = fs()

  if (email && password) {
    if (password.length < 6) {
      return identityError(c, 'WEAK_PASSWORD : Password should be at least 6 characters')
    }
    if (s.users.findOneBy('email', email)) {
      return identityError(c, 'EMAIL_EXISTS')
    }
    const now = new Date().toISOString()
    const user = s.users.insert({
      local_id: typeof body.localId === 'string' && body.localId ? body.localId : generateLocalId(),
      project_id: projectId,
      email,
      password,
      display_name: typeof body.displayName === 'string' ? body.displayName : null,
      email_verified: false,
      provider: 'password',
      valid_since: now,
      last_login_at: now,
      last_refresh_at: now,
    })
    const { idToken, refreshToken, expiresIn } = issueTokens(s, user)
    return c.json({
      kind: 'identitytoolkit#SignupNewUserResponse',
      idToken,
      email,
      refreshToken,
      expiresIn,
      localId: user.local_id,
    })
  }

  // Anonymous sign-up.
  const now = new Date().toISOString()
  const user = s.users.insert({
    local_id: generateLocalId(),
    project_id: projectId,
    email: null,
    password: null,
    display_name: null,
    email_verified: false,
    provider: 'anonymous',
    valid_since: now,
    last_login_at: now,
    last_refresh_at: now,
  })
  const { idToken, refreshToken, expiresIn } = issueTokens(s, user)
  return c.json({
    kind: 'identitytoolkit#SignupNewUserResponse',
    idToken,
    refreshToken,
    expiresIn,
    localId: user.local_id,
  })
}

async function handleSignIn(c: Context, store: import('@emulators/core').Store, fs: () => FirebaseStore) {
  const projectId = resolveProjectByApiKey(store, c.req.query('key'))
  if (!projectId) {
    return apiKeyError(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email : undefined
  const password = typeof body.password === 'string' ? body.password : undefined

  const s = fs()
  const user = email ? s.users.findOneBy('email', email) : undefined
  if (!user) {
    return identityError(c, 'EMAIL_NOT_FOUND')
  }
  if (user.password !== password) {
    return identityError(c, 'INVALID_PASSWORD')
  }

  s.users.update(user.id, { last_login_at: new Date().toISOString() })
  const fresh = s.users.get(user.id)!
  const { idToken, refreshToken, expiresIn } = issueTokens(s, fresh)

  const response: Record<string, unknown> = {
    kind: 'identitytoolkit#VerifyPasswordResponse',
    idToken,
    email: fresh.email,
    refreshToken,
    expiresIn,
    localId: fresh.local_id,
    registered: true,
  }
  if (fresh.display_name) {
    response.displayName = fresh.display_name
  }
  return c.json(response)
}

async function handleLookup(c: Context, store: import('@emulators/core').Store, fs: () => FirebaseStore) {
  const projectId = resolveProjectByApiKey(store, c.req.query('key'))
  if (!projectId) {
    return apiKeyError(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const idToken = typeof body.idToken === 'string' ? body.idToken : undefined
  const s = fs()
  const user = resolveUserByToken(s, idToken)
  if (!user) {
    return identityError(c, 'INVALID_ID_TOKEN')
  }

  const providerUserInfo: Array<Record<string, unknown>> = []
  if (user.email) {
    providerUserInfo.push({
      providerId: 'password',
      federatedId: user.email,
      email: user.email,
      rawId: user.email,
      displayName: user.display_name ?? undefined,
    })
  }

  const userInfo: Record<string, unknown> = {
    localId: user.local_id,
    emailVerified: user.email_verified,
    providerUserInfo,
    validSince: msToSeconds(user.valid_since),
    lastLoginAt: String(new Date(user.last_login_at).getTime()),
    createdAt: String(new Date(user.created_at).getTime()),
    lastRefreshAt: user.last_refresh_at,
  }
  if (user.email) {
    userInfo.email = user.email
  }
  if (user.display_name) {
    userInfo.displayName = user.display_name
  }
  if (user.password) {
    userInfo.passwordHash = `emulator:${user.password}`
  }

  return c.json({
    kind: 'identitytoolkit#GetAccountInfoResponse',
    users: [userInfo],
  })
}

async function handleUpdate(c: Context, store: import('@emulators/core').Store, fs: () => FirebaseStore) {
  const projectId = resolveProjectByApiKey(store, c.req.query('key'))
  if (!projectId) {
    return apiKeyError(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const idToken = typeof body.idToken === 'string' ? body.idToken : undefined
  const s = fs()
  const user = resolveUserByToken(s, idToken)
  if (!user) {
    return identityError(c, 'INVALID_ID_TOKEN')
  }

  const patch: Partial<FirebaseUser> = {}
  if (typeof body.displayName === 'string') {
    patch.display_name = body.displayName
  }
  if (typeof body.password === 'string') {
    patch.password = body.password
  }

  const deleteAttribute: string[] = Array.isArray(body.deleteAttribute) ? body.deleteAttribute : []
  if (deleteAttribute.includes('DISPLAY_NAME')) {
    patch.display_name = null
  }

  s.users.update(user.id, patch)
  const fresh = s.users.get(user.id)!

  // Reissue an id token reflecting the updated profile.
  const { idToken: newToken, refreshToken, expiresIn } = issueTokens(s, fresh)

  const response: Record<string, unknown> = {
    kind: 'identitytoolkit#SetAccountInfoResponse',
    localId: fresh.local_id,
    idToken: newToken,
    refreshToken,
    expiresIn,
    emailVerified: fresh.email_verified,
  }
  if (fresh.email) {
    response.email = fresh.email
  }
  if (fresh.display_name) {
    response.displayName = fresh.display_name
  }
  if (fresh.password) {
    response.passwordHash = `emulator:${fresh.password}`
  }
  response.providerUserInfo = fresh.email
    ? [{ providerId: 'password', federatedId: fresh.email, email: fresh.email, rawId: fresh.email }]
    : []
  return c.json(response)
}

async function handleDelete(c: Context, store: import('@emulators/core').Store, fs: () => FirebaseStore) {
  const projectId = resolveProjectByApiKey(store, c.req.query('key'))
  if (!projectId) {
    return apiKeyError(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const idToken = typeof body.idToken === 'string' ? body.idToken : undefined
  const s = fs()
  const user = resolveUserByToken(s, idToken)
  if (!user) {
    return identityError(c, 'INVALID_ID_TOKEN')
  }

  // Remove the account and any tokens that belonged to it.
  for (const t of s.tokens.all()) {
    if (t.local_id === user.local_id) {
      s.tokens.delete(t.id)
    }
  }
  s.users.delete(user.id)

  return c.json({ kind: 'identitytoolkit#DeleteAccountResponse' })
}

async function handleSendOobCode(c: Context, store: import('@emulators/core').Store, fs: () => FirebaseStore) {
  const projectId = resolveProjectByApiKey(store, c.req.query('key'))
  if (!projectId) {
    return apiKeyError(c)
  }

  const body = await c.req.json().catch(() => ({}))
  const requestType = typeof body.requestType === 'string' ? body.requestType : undefined
  if (requestType !== 'PASSWORD_RESET' && requestType !== 'VERIFY_EMAIL') {
    return identityError(c, 'INVALID_REQUEST_TYPE')
  }

  const s = fs()
  let email = typeof body.email === 'string' ? body.email : undefined
  let user: FirebaseUser | undefined

  if (typeof body.idToken === 'string') {
    user = resolveUserByToken(s, body.idToken) ?? undefined
    if (user?.email) {
      email = user.email
    }
  }
  if (email && !user) {
    user = s.users.findOneBy('email', email)
  }

  if (!email) {
    return identityError(c, 'MISSING_EMAIL')
  }
  if (requestType === 'PASSWORD_RESET' && !user) {
    return identityError(c, 'EMAIL_NOT_FOUND')
  }

  const oobCode = generateUuid().replace(/-/g, '')
  s.oobCodes.insert({
    oob_code: oobCode,
    request_type: requestType,
    email,
    local_id: user ? user.local_id : null,
  })

  return c.json({
    kind: 'identitytoolkit#GetOobConfirmationCodeResponse',
    email,
  })
}

function resolveUserByToken(s: FirebaseStore, idToken: string | undefined): FirebaseUser | null {
  if (!idToken) {
    return null
  }
  const stored = s.tokens.findOneBy('id_token', idToken)
  if (!stored) {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  if (stored.expires_at <= now) {
    return null
  }
  // Sanity-check the embedded payload, but trust the stored record.
  const payload = decodeIdToken(idToken)
  if (!payload) {
    return null
  }
  return s.users.findOneBy('local_id', stored.local_id) ?? null
}

function msToSeconds(iso: string): string {
  return String(Math.floor(new Date(iso).getTime() / 1000))
}
