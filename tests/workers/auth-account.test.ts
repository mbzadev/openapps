/// <reference path="../../workers/jobs/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createExecutionContext, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import api from '../../workers/web/src/api.js'
import { hashPassword, nowIso } from '../../packages/core/src/index.js'
import type { JobMessage } from '../../packages/core/src/messages.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }
beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS))

function client() {
  let token = ''
  const queued: JobMessage[] = []
  const queue = { send: async (body: JobMessage) => { queued.push(body) } }
  const bindings = {
    ...testEnv,
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    API_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SYNC_TRACKED_IOS: queue, SYNC_TRACKED_ANDROID: queue,
    SYNC_ON_DEMAND_IOS: queue, SYNC_ON_DEMAND_ANDROID: queue,
    CHARTS_IOS: queue, CHARTS_ANDROID: queue, RECONCILE: queue,
    APP_NAME: 'OpenApps by MBZA', APP_URL: 'https://apps.mbza.dev', ENVIRONMENT: 'test',
  }
  const call = async (path: string, init: RequestInit = {}, authenticated = true) => {
    const headers = new Headers(init.headers)
    if (authenticated && token) headers.set('Authorization', `Bearer ${token}`)
    if (init.body) headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json')
    return api.fetch(new Request(`https://apps.mbza.dev${path}`, { ...init, headers }), bindings as never, createExecutionContext())
  }
  const register = async (email: string, password = 'Password!234') => {
    const response = await call('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Test User', email, password, password_confirmation: password }) }, false)
    const payload = await response.json<{ token: string; user: { id: number } }>()
    token = payload.token
    return { response, payload }
  }
  return { call, register, queued, get token() { return token }, set token(value: string) { token = value } }
}

describe('legacy auth and account behavior', () => {
  it('validates registration and login, rotates auth-token, exposes /me and revokes logout', async () => {
    const c = client()
    const missing = await c.call('/auth/register', { method: 'POST', body: '{}' }, false)
    expect(missing.status).toBe(422)
    expect((await missing.json<{ errors: Record<string, string[]> }>()).errors).toMatchObject({ name: expect.any(Array), email: expect.any(Array), password: expect.any(Array) })
    expect((await c.call('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Jane', email: 'invalid', password: 'Password!234', password_confirmation: 'Password!234' }) }, false)).status).toBe(422)
    expect((await c.call('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Jane', email: 'auth@example.test', password: 'Password!234', password_confirmation: 'different' }) }, false)).status).toBe(422)

    const { response, payload } = await c.register('auth@example.test')
    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-openapps-session=.*HttpOnly; Secure; SameSite=Lax/)
    expect(payload.token).toHaveLength(64)
    expect(await testEnv.DB.prepare('SELECT email,password_hash FROM users WHERE id=?').bind(payload.user.id).first()).toMatchObject({
      email: 'auth@example.test', password_hash: expect.stringMatching(/^pbkdf2-sha256-v1\$600000\$/),
    })
    expect(await testEnv.DB.prepare('SELECT name FROM personal_access_tokens WHERE user_id=?').bind(payload.user.id).first()).toEqual({ name: 'auth-token' })
    expect((await c.call('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Duplicate', email: 'AUTH@example.test', password: 'Password!234', password_confirmation: 'Password!234' }) }, false)).status).toBe(422)
    expect((await c.call('/auth/login', { method: 'POST', body: '{}' }, false)).status).toBe(422)
    expect((await c.call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'missing@example.test', password: 'Password!234' }) }, false)).status).toBe(401)
    expect((await c.call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'auth@example.test', password: 'wrong-password' }) }, false)).status).toBe(401)

    const firstLogin = await c.call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'auth@example.test', password: 'Password!234' }) }, false)
    c.token = (await firstLogin.json<{ token: string }>()).token
    const firstToken = c.token
    const secondLogin = await c.call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'auth@example.test', password: 'Password!234' }) }, false)
    c.token = (await secondLogin.json<{ token: string }>()).token
    expect(c.token).not.toBe(firstToken)
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM personal_access_tokens WHERE user_id=? AND name='auth-token'").bind(payload.user.id).first()).toEqual({ count: 1 })
    const me = await c.call('/auth/me')
    expect(await me.json()).toMatchObject({ id: payload.user.id, name: 'Test User', email: 'auth@example.test', email_verified_at: null, created_at: expect.any(String) })
    expect((await c.call('/auth/me', {}, false)).status).toBe(401)
    expect((await c.call('/auth/logout', { method: 'POST' }, false)).status).toBe(401)
    const logout = await c.call('/auth/logout', { method: 'POST' })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await c.call('/auth/me')).status).toBe(401)
  }, 300_000)

  it('preserves profile verification rules and deletes an account only with its password', async () => {
    const c = client()
    const { payload } = await c.register('profile@example.test', 'current-pass')
    const verifiedAt = '2026-08-03T12:00:00.000Z'
    await testEnv.DB.prepare('UPDATE users SET email_verified_at=? WHERE id=?').bind(verifiedAt, payload.user.id).run()
    expect(await (await c.call('/account/profile')).json()).toMatchObject({ id: payload.user.id, email_verified_at: verifiedAt })

    const missing = await c.call('/account/profile', { method: 'PATCH', body: '{}' })
    expect(missing.status).toBe(422)
    expect((await missing.json<{ errors: Record<string, string[]> }>()).errors).toMatchObject({ name: expect.any(Array), email: expect.any(Array) })
    expect((await c.call('/account/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Name', email: 'invalid' }) })).status).toBe(422)

    const otherHash = await hashPassword('other-password')
    const now = nowIso()
    await testEnv.DB.prepare('INSERT INTO users (name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)').bind('Other', 'taken@example.test', otherHash, now, now).run()
    expect((await c.call('/account/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Name', email: 'taken@example.test' }) })).status).toBe(422)

    const sameEmail = await c.call('/account/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Updated', email: 'profile@example.test' }) })
    expect(await sameEmail.json()).toMatchObject({ name: 'Updated', email: 'profile@example.test', email_verified_at: verifiedAt })
    const changedEmail = await c.call('/account/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Updated', email: 'new-profile@example.test' }) })
    expect(await changedEmail.json()).toMatchObject({ email: 'new-profile@example.test', email_verified_at: null })
    expect((await c.call('/account/profile', { method: 'PATCH', body: JSON.stringify({ name: 'X', email: 'x@example.test' }) }, false)).status).toBe(401)
    expect((await c.call('/account/profile', { method: 'DELETE', body: '{}' })).status).toBe(422)
    expect((await c.call('/account/profile', { method: 'DELETE', body: JSON.stringify({ password: 'wrong-pass' }) })).status).toBe(422)
    expect((await c.call('/account/profile', { method: 'DELETE', body: JSON.stringify({ password: 'current-pass' }) }, false)).status).toBe(401)
    expect((await c.call('/account/profile', { method: 'DELETE', body: JSON.stringify({ password: 'current-pass' }) })).status).toBe(204)
    expect(await testEnv.DB.prepare('SELECT id FROM users WHERE id=?').bind(payload.user.id).first()).toBeNull()
  }, 300_000)

  it('validates current password and confirmation before updating the password hash', async () => {
    const c = client()
    await c.register('security@example.test', 'current-pass')
    expect((await c.call('/account/password', { method: 'PUT', body: '{}' })).status).toBe(422)
    expect((await c.call('/account/password', { method: 'PUT', body: JSON.stringify({ current_password: 'wrong-pass', password: 'new-password', password_confirmation: 'new-password' }) })).status).toBe(422)
    expect((await c.call('/account/password', { method: 'PUT', body: JSON.stringify({ current_password: 'current-pass', password: 'new-password', password_confirmation: 'different' }) })).status).toBe(422)
    expect((await c.call('/account/password', { method: 'PUT', body: JSON.stringify({ current_password: 'current-pass', password: 'new-password', password_confirmation: 'new-password' }) }, false)).status).toBe(401)
    expect((await c.call('/account/password', { method: 'PUT', body: JSON.stringify({ current_password: 'current-pass', password: 'new-password', password_confirmation: 'new-password' }) })).status).toBe(200)
    expect((await c.call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'security@example.test', password: 'current-pass' }) }, false)).status).toBe(401)
    expect((await c.call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'security@example.test', password: 'new-password' }) }, false)).status).toBe(200)
  }, 300_000)

  it('creates, lists and revokes opaque API tokens without exposing auth-token', async () => {
    const c = client()
    const { payload } = await c.register('tokens@example.test')
    expect(await (await c.call('/account/api-tokens')).json()).toEqual([])
    expect((await c.call('/account/api-tokens', { method: 'POST', body: '{}' })).status).toBe(422)
    expect((await c.call('/account/api-tokens', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(256) }) })).status).toBe(422)
    expect((await c.call('/account/api-tokens', { method: 'POST', body: JSON.stringify({ name: 'CLI' }) }, false)).status).toBe(401)
    const created = await c.call('/account/api-tokens', { method: 'POST', body: JSON.stringify({ name: 'CLI', abilities: ['openapps:read'] }) })
    expect(created.status).toBe(201)
    const token = await created.json<{ token: { id: number; name: string; abilities: string[] }; plain_text_token: string }>()
    expect(token).toMatchObject({ token: { name: 'CLI', abilities: ['openapps:read'] }, plain_text_token: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await (await c.call('/account/api-tokens')).json()).toEqual([expect.objectContaining({ id: token.token.id, name: 'CLI', abilities: ['openapps:read'] })])
    expect((await c.call('/account/api-tokens/999999', { method: 'DELETE' })).status).toBe(404)
    const authToken = await testEnv.DB.prepare("SELECT id FROM personal_access_tokens WHERE user_id=? AND name='auth-token'").bind(payload.user.id).first<{ id: number }>()
    expect((await c.call(`/account/api-tokens/${authToken!.id}`, { method: 'DELETE' })).status).toBe(404)

    const otherHash = await hashPassword('Password!234')
    const now = nowIso()
    const other = await testEnv.DB.prepare('INSERT INTO users (name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?) RETURNING id').bind('Other', 'token-other@example.test', otherHash, now, now).first<{ id: number }>()
    const otherToken = await testEnv.DB.prepare(`INSERT INTO personal_access_tokens (user_id,name,token_hash,abilities,created_at,updated_at)
      VALUES (?,'Other token','unique-other-hash','[]',?,?) RETURNING id`).bind(other!.id, now, now).first<{ id: number }>()
    expect((await c.call(`/account/api-tokens/${otherToken!.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await c.call(`/account/api-tokens/${token.token.id}`, { method: 'DELETE' }, false)).status).toBe(401)
    expect((await c.call(`/account/api-tokens/${token.token.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await (await c.call('/account/api-tokens')).json()).toEqual([])
  }, 300_000)

  it('scopes folder CRUD, ordering, uniqueness and deletion side effects to the caller', async () => {
    const c = client()
    const { payload } = await c.register('folders@example.test')
    expect((await c.call('/folders', {}, false)).status).toBe(401)
    expect((await c.call('/folders', { method: 'POST', body: JSON.stringify({ color: 'green' }) })).status).toBe(422)
    expect((await c.call('/folders', { method: 'POST', body: JSON.stringify({ name: 'Invalid', color: 'rainbow' }) })).status).toBe(422)
    const first = await c.call('/folders', { method: 'POST', body: JSON.stringify({ name: 'First', color: 'blue', sort_order: 5 }) })
    const firstFolder = await first.json<{ id: number }>()
    expect(first.status).toBe(201)
    const second = await c.call('/folders', { method: 'POST', body: JSON.stringify({ name: 'Second', color: 'red', sort_order: 10 }) })
    const secondFolder = await second.json<{ id: number }>()
    expect(await (await c.call('/folders')).json()).toEqual([
      expect.objectContaining({ id: secondFolder.id, sort_order: 10, apps_count: 0 }),
      expect.objectContaining({ id: firstFolder.id, sort_order: 5, apps_count: 0 }),
    ])
    expect((await c.call('/folders', { method: 'POST', body: JSON.stringify({ name: 'First', color: 'amber' }) })).status).toBe(422)
    expect(await (await c.call(`/folders/${firstFolder.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) })).json()).toMatchObject({ name: 'Renamed', color: 'blue' })
    expect(await (await c.call(`/folders/${firstFolder.id}`, { method: 'PATCH', body: JSON.stringify({ color: 'purple', sort_order: 42 }) })).json()).toMatchObject({ color: 'purple', sort_order: 42 })

    const now = nowIso()
    const other = await testEnv.DB.prepare('INSERT INTO users (name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?) RETURNING id').bind('Other', 'folder-other@example.test', 'unused', now, now).first<{ id: number }>()
    const otherFolder = await testEnv.DB.prepare("INSERT INTO folders (user_id,name,color,position,created_at,updated_at) VALUES (?,'Theirs','green',0,?,?) RETURNING id").bind(other!.id, now, now).first<{ id: number }>()
    expect((await c.call(`/folders/${otherFolder!.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }) })).status).toBe(404)
    expect((await c.call(`/folders/${otherFolder!.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await c.call('/folders', { method: 'POST', body: JSON.stringify({ name: 'Theirs', color: 'green' }) })).status).toBe(201)

    const app = await testEnv.DB.prepare(`INSERT INTO apps
      (platform,external_id,display_name,origin_country_code,discovered_from,discovered_at,created_at,updated_at)
      VALUES ('ios','folder.app','Folder App','us','test',?,?,?) RETURNING id`).bind(now, now, now).first<{ id: number }>()
    await testEnv.DB.prepare('INSERT INTO user_apps (user_id,app_id,folder_id,created_at) VALUES (?,?,?,?)').bind(payload.user.id, app!.id, firstFolder.id, now).run()
    expect((await c.call(`/folders/${firstFolder.id}`, { method: 'DELETE' }, false)).status).toBe(401)
    expect((await c.call(`/folders/${firstFolder.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await testEnv.DB.prepare('SELECT folder_id FROM user_apps WHERE user_id=? AND app_id=?').bind(payload.user.id, app!.id).first()).toEqual({ folder_id: null })
  }, 300_000)
})
