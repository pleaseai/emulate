import type { AppEnv, Context, RouteContext } from '@emulators/core'
import {
  constantTimeSecretEqual,
  escapeAttr,
  matchesRedirectUri,
  renderCardPage,
  renderErrorPage,
  renderUserButton,
} from '@emulators/core'
import { generateCode, generateToken, parseNaverParams } from '../helpers.js'
import { getNaverStore } from '../store.js'

const CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export function oauthRoutes(ctx: RouteContext): void {
  const { app, store } = ctx
  const ns = () => getNaverStore(store)

  // GET /oauth2.0/authorize — Naver login
  app.get('/oauth2.0/authorize', (c) => {
    const responseType = c.req.query('response_type')
    const clientId = c.req.query('client_id')
    const redirectUri = c.req.query('redirect_uri')
    const state = c.req.query('state')
    const selectedUser = c.req.query('user')

    // state is required by Naver.
    if (!state) {
      return c.html(
        renderErrorPage(
          'Invalid request',
          'Missing required parameter: state',
          'naver',
        ),
        400,
      )
    }

    if (responseType !== 'code') {
      return redirectError(c, redirectUri, 'invalid_request', 'response_type must be \'code\'', state)
    }

    if (!clientId) {
      return redirectError(c, redirectUri, 'invalid_request', 'Missing required parameter: client_id', state)
    }

    const appRecord = ns().apps.findOneBy('client_id', clientId)
    if (!appRecord) {
      return redirectError(c, redirectUri, 'invalid_request', 'Invalid client_id', state)
    }

    if (!redirectUri || !matchesRedirectUri(redirectUri, appRecord.callback_urls)) {
      // redirect_uri mismatch cannot be safely redirected back to.
      return c.html(
        renderErrorPage('Invalid request', 'redirect_uri mismatch', 'naver'),
        400,
      )
    }

    // Automation/CI path: ?user=<naver_id> issues a code immediately.
    if (selectedUser) {
      const user = ns().users.findOneBy('naver_id', selectedUser)
      if (!user) {
        return redirectError(c, redirectUri, 'invalid_request', 'Unknown user', state)
      }
      const code = issueCode(ns, clientId, user.naver_id, redirectUri, state)
      return c.redirect(buildRedirect(redirectUri, { code, state }), 302)
    }

    // Render the seeded user selection login page.
    const users = ns().users.all()
    const buttons = users
      .map(u =>
        renderUserButton({
          letter: (u.name || u.nickname || u.naver_id).charAt(0),
          login: u.naver_id,
          name: u.name,
          email: u.email,
          formAction: '/oauth2.0/authorize',
          hiddenFields: {
            response_type: 'code',
            client_id: clientId,
            redirect_uri: redirectUri,
            state,
            user: u.naver_id,
          },
        }),
      )
      .join('\n')

    const body = users.length
      ? `<form method="get" action="/oauth2.0/authorize">${buttons}</form>`
      : `<p>No seeded users available.</p>`

    return c.html(
      renderCardPage(
        '네이버 아이디로 로그인',
        `client_id: ${escapeAttr(clientId)}`,
        body,
        'naver',
      ),
    )
  })

  // GET|POST /oauth2.0/token — token issue / refresh / delete
  const tokenHandler = async (c: Context<AppEnv>) => {
    const params = await parseNaverParams(c)
    const grantType = params.grant_type

    if (grantType === 'authorization_code') {
      return handleAuthorizationCode(c, ns, params)
    }
    if (grantType === 'refresh_token') {
      return handleRefreshToken(c, ns, params)
    }
    if (grantType === 'delete') {
      return handleDelete(c, ns, params)
    }

    // Naver returns HTTP 200 with an error body; an unknown grant_type is
    // reported as unauthorized_client.
    return c.json(
      {
        error: 'unauthorized_client',
        error_description: 'Invalid or missing grant_type',
      },
      200,
    )
  }

  app.get('/oauth2.0/token', tokenHandler)
  app.post('/oauth2.0/token', tokenHandler)
}

type NsGetter = () => ReturnType<typeof getNaverStore>

function issueCode(
  ns: NsGetter,
  clientId: string,
  naverId: string,
  redirectUri: string,
  state: string,
): string {
  const code = generateCode()
  ns().authCodes.insert({
    code,
    client_id: clientId,
    naver_id: naverId,
    redirect_uri: redirectUri,
    state,
    expires_at: Date.now() + CODE_TTL_MS,
    used: false,
  })
  return code
}

function handleAuthorizationCode(
  c: Context<AppEnv>,
  ns: NsGetter,
  params: Record<string, string>,
) {
  const { client_id, client_secret, code } = params

  if (!client_id || !code) {
    return tokenError(c, 'invalid_request', 'Missing required parameter')
  }

  const appRecord = ns().apps.findOneBy('client_id', client_id)
  if (!appRecord || (client_secret !== undefined && !constantTimeSecretEqual(client_secret, appRecord.client_secret))) {
    return tokenError(c, 'invalid_request', 'Invalid client credentials')
  }

  const authCode = ns().authCodes.findOneBy('code', code)
  if (!authCode || authCode.used || authCode.client_id !== client_id || authCode.expires_at < Date.now()) {
    return tokenError(c, 'invalid_request', 'Invalid or expired code')
  }

  // Single use.
  ns().authCodes.update(authCode.id, { used: true })

  const accessToken = generateToken('AAAA')
  const refreshToken = generateToken('RRRR')
  ns().tokens.insert({
    access_token: accessToken,
    refresh_token: refreshToken,
    client_id,
    naver_id: authCode.naver_id,
    expires_at: Date.now() + TOKEN_TTL_MS,
    revoked: false,
  })

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: '3600', // Naver returns expires_in as a string.
  })
}

function handleRefreshToken(
  c: Context<AppEnv>,
  ns: NsGetter,
  params: Record<string, string>,
) {
  const { client_id, client_secret, refresh_token } = params

  if (!client_id || !refresh_token) {
    return tokenError(c, 'invalid_request', 'Missing required parameter')
  }

  const appRecord = ns().apps.findOneBy('client_id', client_id)
  if (!appRecord || (client_secret !== undefined && !constantTimeSecretEqual(client_secret, appRecord.client_secret))) {
    return tokenError(c, 'invalid_request', 'Invalid client credentials')
  }

  const tokenRecord = ns().tokens.findOneBy('refresh_token', refresh_token)
  if (!tokenRecord || tokenRecord.revoked || tokenRecord.client_id !== client_id) {
    return tokenError(c, 'invalid_request', 'Invalid refresh_token')
  }

  const accessToken = generateToken('AAAA')
  ns().tokens.update(tokenRecord.id, {
    access_token: accessToken,
    expires_at: Date.now() + TOKEN_TTL_MS,
  })

  return c.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: '3600',
  })
}

function handleDelete(
  c: Context<AppEnv>,
  ns: NsGetter,
  params: Record<string, string>,
) {
  const { client_id, client_secret, access_token, service_provider } = params

  if (!client_id || !access_token || service_provider !== 'NAVER') {
    return tokenError(c, 'invalid_request', 'Missing required parameter')
  }

  const appRecord = ns().apps.findOneBy('client_id', client_id)
  if (!appRecord || (client_secret !== undefined && !constantTimeSecretEqual(client_secret, appRecord.client_secret))) {
    return tokenError(c, 'invalid_request', 'Invalid client credentials')
  }

  const tokenRecord = ns().tokens.findOneBy('access_token', access_token)
  if (!tokenRecord || tokenRecord.revoked || tokenRecord.client_id !== client_id) {
    return tokenError(c, 'invalid_request', 'Invalid access_token')
  }

  ns().tokens.update(tokenRecord.id, { revoked: true })

  return c.json({
    access_token,
    result: 'success',
  })
}

function tokenError(c: Context<AppEnv>, error: string, description: string) {
  // Naver returns OAuth errors with HTTP 200.
  return c.json({ error, error_description: description }, 200)
}

function buildRedirect(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function redirectError(
  c: Context<AppEnv>,
  redirectUri: string | undefined,
  error: string,
  description: string,
  state: string,
) {
  if (!redirectUri) {
    return c.html(renderErrorPage('Invalid request', description, 'naver'), 400)
  }
  return c.redirect(
    buildRedirect(redirectUri, { error, error_description: description, state }),
    302,
  )
}
