import type { RouteContext } from '@emulators/core'
import { Buffer } from 'node:buffer'
import { bodyStr, constantTimeSecretEqual } from '@emulators/core'
import { getTossinvestStore, issueToken, randomId, TOKEN_TTL_SECONDS } from '../store.js'

export function appsRoutes({ app, store, baseUrl }: RouteContext): void {
  const ts = getTossinvestStore(store)
  app.get('/_emulator/apps', c =>
    c.json({
      apps: ts.clients.all().map(cl => ({ client_id: cl.client_id, client_secret: cl.client_secret, name: cl.name })),
      token_url: `${baseUrl}/oauth2/token`,
    }))
  app.post('/_emulator/apps', async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
    const client_id = bodyStr(body.client_id) || `tsck_${randomId(12)}`
    const client
      = ts.clients.findOneBy('client_id', client_id)
        ?? ts.clients.insert({
          client_id,
          client_secret: bodyStr(body.client_secret) || `s_${randomId(24)}`,
          name: bodyStr(body.name) || 'App',
        })
    return c.json({
      client_id: client.client_id,
      client_secret: client.client_secret,
      token_url: `${baseUrl}/oauth2/token`,
      grant_type: 'client_credentials',
    })
  })
}

// POST /oauth2/token — OAuth 2.0 client credentials. Unlike every other
// endpoint it answers in the plain OAuth2 shape ({access_token,...} and
// {error, error_description}), not the {result}/{error:{...}} envelope.
export function tokenRoutes({ app, store }: RouteContext): void {
  const ts = getTossinvestStore(store)

  app.post('/oauth2/token', async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
    const oauthError = (status: number, error: string, description: string) => c.json({ error, error_description: description }, status)
    let clientId = bodyStr(body.client_id)
    let clientSecret = bodyStr(body.client_secret)

    const auth = c.req.header('Authorization')
    if (auth && /^Basic\b/i.test(auth)) {
      const m = /^Basic\s+([A-Z0-9+/=]+)\s*$/i.exec(auth)
      const decoded = m ? Buffer.from(m[1], 'base64').toString() : ''
      const sep = decoded.indexOf(':')
      if (sep < 0) {
        return oauthError(
          400,
          'invalid_request',
          'Malformed client authentication: check Authorization header or client_id/client_secret/code_verifier parameters',
        )
      }
      clientId = decoded.slice(0, sep)
      clientSecret = decoded.slice(sep + 1)
    }

    const grantType = bodyStr(body.grant_type)
    if (!grantType) {
      return oauthError(400, 'invalid_request', 'OAuth 2.0 Parameter: grant_type')
    }
    if (grantType !== 'client_credentials') {
      return oauthError(400, 'unsupported_grant_type', 'OAuth 2.0 Parameter: grant_type')
    }
    if (!clientId) {
      return oauthError(400, 'invalid_request', 'OAuth 2.0 Parameter: client_id')
    }
    if (!clientSecret) {
      return oauthError(400, 'invalid_request', 'OAuth 2.0 Parameter: client_secret')
    }

    const client = ts.clients.findOneBy('client_id', clientId)
    if (!client || !constantTimeSecretEqual(clientSecret, client.client_secret)) {
      c.header('WWW-Authenticate', 'Basic realm="openapi"')
      return oauthError(401, 'invalid_client', 'Client authentication failed.')
    }

    c.header('Cache-Control', 'no-store')
    return c.json({ access_token: issueToken(store, client.client_id), token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS })
  })
}
