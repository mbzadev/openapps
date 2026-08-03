/// <reference path="../../workers/web/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createExecutionContext, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { issueToken, nowIso } from '../../packages/core/src/index.js'
import oauth from '../../workers/web/src/oauth.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }

beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS))

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function pkceChallenge(verifier: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

describe('OAuth 2.1 MCP authorization', () => {
  it('binds a short-lived transaction to the user and persists the granted consent', async () => {
    const now = nowIso()
    const user = await testEnv.DB.prepare(`INSERT INTO users
      (name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?) RETURNING id`)
      .bind('OAuth User', 'oauth@example.test', 'unused-in-this-test', now, now).first<{ id: number }>()
    const session = await issueToken(testEnv.DB, user!.id, 'auth-token', ['*'], null)
    const authHeaders = { Authorization: `Bearer ${session.plainTextToken}` }
    const call = (path: string, init: RequestInit = {}) => oauth.fetch(
      new Request(`https://apps.mbza.dev${path}`, init),
      testEnv,
      createExecutionContext(),
    )

    const registration = await call('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Inspector <unsafe>', redirect_uris: ['http://127.0.0.1:6274/callback'] }),
    })
    expect(registration.status).toBe(201)
    const client = await registration.json<{ client_id: string }>()

    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
    const challenge = await pkceChallenge(verifier)
    const authorize = new URL('https://apps.mbza.dev/oauth/authorize')
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:6274/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'openapps:read openapps:write',
      state: 'opaque-client-state',
    }).toString()
    const consentPage = await call(`${authorize.pathname}${authorize.search}`, { headers: authHeaders })
    expect(consentPage.status).toBe(200)
    const html = await consentPage.text()
    expect(html).toContain('Inspector &lt;unsafe&gt;')
    expect(html).not.toContain(`value="${challenge}"`)
    const transactionId = html.match(/name="transaction_id" value="([^"]+)"/)?.[1]
    expect(transactionId).toBeTruthy()

    const transaction = JSON.parse((await testEnv.OAUTH_KV.get(`transaction:${transactionId}`))!) as Record<string, unknown>
    expect(transaction).toMatchObject({
      userId: user!.id,
      clientId: client.client_id,
      redirectUri: 'http://127.0.0.1:6274/callback',
      challenge,
      scope: ['openapps:read', 'openapps:write'],
      state: 'opaque-client-state',
    })

    const approval = await call('/oauth/authorize', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        transaction_id: transactionId!,
        decision: 'allow',
        client_id: 'attacker-controlled',
        redirect_uri: 'https://attacker.example/callback',
        scope: 'openapps:read',
      }),
      redirect: 'manual',
    })
    expect(approval.status).toBe(302)
    const callback = new URL(approval.headers.get('Location')!)
    expect(callback.origin + callback.pathname).toBe('http://127.0.0.1:6274/callback')
    expect(callback.searchParams.get('state')).toBe('opaque-client-state')
    const code = callback.searchParams.get('code')
    expect(code).toBeTruthy()
    expect(await testEnv.OAUTH_KV.get(`transaction:${transactionId}`)).toBeNull()
    expect(JSON.parse((await testEnv.OAUTH_KV.get(`consent:${user!.id}:${client.client_id}`))!)).toMatchObject({
      userId: user!.id,
      clientId: client.client_id,
      scope: ['openapps:read', 'openapps:write'],
    })

    const token = await call('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:6274/callback',
        code_verifier: verifier,
      }),
    })
    expect(token.status).toBe(200)
    const payload = await token.json<{ access_token: string; scope: string }>()
    expect(payload.scope).toBe('openapps:read openapps:write')
    expect(payload.access_token).toBeTruthy()
    expect((await testEnv.DB.prepare('SELECT name,abilities FROM personal_access_tokens WHERE user_id=? ORDER BY id DESC LIMIT 1').bind(user!.id).first())).toEqual({
      name: `oauth:${client.client_id}`,
      abilities: '["openapps:read","openapps:write"]',
    })

    const replay = await call('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, client_id: client.client_id, redirect_uri: 'http://127.0.0.1:6274/callback', code_verifier: verifier }),
    })
    expect(replay.status).toBe(400)
    expect(await replay.json()).toEqual({ error: 'invalid_grant' })
  })

  it('rejects unsupported scopes before creating an authorization transaction', async () => {
    const now = nowIso()
    const user = await testEnv.DB.prepare(`INSERT INTO users
      (name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?) RETURNING id`)
      .bind('Scoped User', 'oauth-scopes@example.test', 'unused', now, now).first<{ id: number }>()
    const session = await issueToken(testEnv.DB, user!.id, 'auth-token', ['*'], null)
    const clientId = crypto.randomUUID()
    await testEnv.OAUTH_KV.put(`client:${clientId}`, JSON.stringify({
      client_id: clientId,
      client_name: 'Scope Client',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }))
    const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://client.example/callback', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'openapps:admin' })
    const response = await oauth.fetch(new Request(`https://apps.mbza.dev/oauth/authorize?${query}`, { headers: { Authorization: `Bearer ${session.plainTextToken}` } }), testEnv, createExecutionContext())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_scope' })
  })
})
