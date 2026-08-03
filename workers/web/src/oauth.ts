import { Hono } from 'hono'
import { authenticateRequest, issueToken, sha256 } from '@openapps/core'
import type { Env, Variables } from './env.js'

type OAuthClient = { client_id: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method: 'none'; grant_types: string[]; response_types: string[] }
type AuthorizationCode = { userId: number; clientId: string; redirectUri: string; challenge: string; scope: string[] }

const oauth = new Hono<{ Bindings: Env; Variables: Variables }>()
const scopes = ['openapps:read', 'openapps:write']

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function challenge(verifier: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

function validRedirect(uri: string) {
  try {
    const url = new URL(uri)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  } catch { return false }
}

oauth.get('/.well-known/oauth-authorization-server', (c) => c.json({
  issuer: c.env.APP_URL,
  authorization_endpoint: `${c.env.APP_URL}/oauth/authorize`,
  token_endpoint: `${c.env.APP_URL}/oauth/token`,
  registration_endpoint: `${c.env.APP_URL}/oauth/register`,
  revocation_endpoint: `${c.env.APP_URL}/oauth/revoke`,
  response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: scopes,
}))
oauth.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json({
  resource: `${c.env.APP_URL}/mcp`, authorization_servers: [c.env.APP_URL],
  scopes_supported: scopes, bearer_methods_supported: ['header'], resource_name: c.env.APP_NAME,
}))
oauth.get('/.well-known/oauth-protected-resource', (c) => c.redirect('/.well-known/oauth-protected-resource/mcp', 308))

oauth.post('/oauth/register', async (c) => {
  const body = await c.req.json<{ client_name?: string; redirect_uris?: string[] }>().catch(() => ({})) as { client_name?: string; redirect_uris?: string[] }
  if (!body.redirect_uris?.length || body.redirect_uris.some((uri) => !validRedirect(uri))) return c.json({ error: 'invalid_redirect_uri' }, 400)
  const client: OAuthClient = { client_id: crypto.randomUUID(), client_name: body.client_name?.slice(0, 100) || 'MCP Client', redirect_uris: body.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }
  await c.env.OAUTH_KV.put(`client:${client.client_id}`, JSON.stringify(client))
  return c.json(client, 201)
})

oauth.get('/oauth/authorize', async (c) => {
  const auth = await authenticateRequest(c.env.DB, c.req.raw)
  if (!auth) {
    const returnTo = encodeURIComponent(c.req.url)
    return c.redirect(`/login?return_to=${returnTo}`, 302)
  }
  const query = c.req.query()
  const clientRaw = query.client_id ? await c.env.OAUTH_KV.get(`client:${query.client_id}`) : null
  const client = clientRaw ? JSON.parse(clientRaw) as OAuthClient : null
  if (!client || query.response_type !== 'code' || !query.redirect_uri || !client.redirect_uris.includes(query.redirect_uri) || !query.code_challenge || query.code_challenge_method !== 'S256') return c.json({ error: 'invalid_request' }, 400)
  const requested = (query.scope ?? 'openapps:read').split(' ').filter((scope) => scopes.includes(scope))
  const hidden = Object.entries(query).map(([key, value]) => `<input type="hidden" name="${key.replaceAll('"', '&quot;')}" value="${value.replaceAll('"', '&quot;')}">`).join('')
  return c.html(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Autoriser ${client.client_name}</title><style>body{font:16px system-ui;max-width:560px;margin:10vh auto;padding:24px;background:#0b1220;color:#fff}main{background:#111c30;padding:32px;border-radius:16px}button{padding:12px 18px;border:0;border-radius:9px;background:#10b981;color:#052e24;font-weight:700}</style><main><h1>OpenApps by MBZA</h1><p><strong>${client.client_name}</strong> demande l’accès à votre compte.</p><ul>${requested.map((scope) => `<li>${scope}</li>`).join('')}</ul><form method="post">${hidden}<button name="decision" value="allow">Autoriser</button> <button name="decision" value="deny" style="background:#94a3b8">Refuser</button></form></main></html>`)
})

oauth.post('/oauth/authorize', async (c) => {
  const auth = await authenticateRequest(c.env.DB, c.req.raw)
  if (!auth) return c.json({ error: 'access_denied' }, 401)
  const form = await c.req.parseBody()
  const clientId = String(form.client_id ?? ''), redirectUri = String(form.redirect_uri ?? '')
  const raw = await c.env.OAUTH_KV.get(`client:${clientId}`)
  const client = raw ? JSON.parse(raw) as OAuthClient : null
  if (!client || !client.redirect_uris.includes(redirectUri)) return c.json({ error: 'invalid_client' }, 400)
  const redirect = new URL(redirectUri)
  if (form.state) redirect.searchParams.set('state', String(form.state))
  if (form.decision !== 'allow') { redirect.searchParams.set('error', 'access_denied'); return c.redirect(redirect.toString()) }
  const requested = String(form.scope ?? 'openapps:read').split(' ').filter((scope) => scopes.includes(scope))
  const code = crypto.randomUUID()
  const data: AuthorizationCode = { userId: auth.user.id, clientId, redirectUri, challenge: String(form.code_challenge ?? ''), scope: requested.length ? requested : ['openapps:read'] }
  await c.env.OAUTH_KV.put(`code:${code}`, JSON.stringify(data), { expirationTtl: 600 })
  redirect.searchParams.set('code', code)
  return c.redirect(redirect.toString())
})

oauth.post('/oauth/token', async (c) => {
  const form = await c.req.parseBody()
  if (form.grant_type !== 'authorization_code') return c.json({ error: 'unsupported_grant_type' }, 400)
  const codeKey = `code:${String(form.code ?? '')}`
  const raw = await c.env.OAUTH_KV.get(codeKey)
  if (!raw) return c.json({ error: 'invalid_grant' }, 400)
  const data = JSON.parse(raw) as AuthorizationCode
  if (data.clientId !== String(form.client_id ?? '') || data.redirectUri !== String(form.redirect_uri ?? '') || await challenge(String(form.code_verifier ?? '')) !== data.challenge) return c.json({ error: 'invalid_grant' }, 400)
  await c.env.OAUTH_KV.delete(codeKey)
  const expiresIn = 3600
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
  const token = await issueToken(c.env.DB, data.userId, `oauth:${data.clientId}`, data.scope, expiresAt)
  return c.json({ access_token: token.plainTextToken, token_type: 'Bearer', expires_in: expiresIn, scope: data.scope.join(' ') }, 200, { 'Cache-Control': 'no-store', Pragma: 'no-cache' })
})

oauth.post('/oauth/revoke', async (c) => {
  const form = await c.req.parseBody()
  const hash = await sha256(String(form.token ?? ''))
  await c.env.DB.prepare('DELETE FROM personal_access_tokens WHERE token_hash=?').bind(hash).run()
  return c.body(null, 200)
})

export default oauth
