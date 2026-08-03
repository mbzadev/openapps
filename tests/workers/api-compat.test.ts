/// <reference path="../../workers/jobs/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createExecutionContext, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import api from '../../workers/web/src/api.js'
import type { JobMessage } from '../../packages/core/src/messages.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }
beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS))

describe('legacy /api/v1 behavior in workerd', () => {
  it('preserves account, folder, app, analytics, sync and competitor rules', async () => {
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
    let token = ''
    const call = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      if (init.body) headers.set('Content-Type', 'application/json')
      return api.fetch(new Request(`https://apps.mbza.dev${path}`, { ...init, headers }), bindings as never, createExecutionContext())
    }

    const registration = await call('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Legacy User', email: 'legacy@example.test', password: 'Password!234', password_confirmation: 'Password!234' }) })
    expect(registration.status).toBe(201)
    token = ((await registration.json()) as { token: string }).token

    const profile = await call('/account/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Updated only' }) })
    expect(profile.status).toBe(200)
    expect((await profile.json() as { name: string }).name).toBe('Updated only')

    const now = new Date().toISOString()
    const insertApp = async (id: string) => Number((await testEnv.DB.prepare(`INSERT INTO apps
      (platform,external_id,display_name,origin_country_code,discovered_from,discovered_at,created_at,updated_at)
      VALUES ('ios',?,?, 'us','test',?,?,?) RETURNING id`).bind(id, id, now, now, now).first<{ id: number }>())!.id)
    const parentId = await insertApp('com.example.parent')
    const rivalId = await insertApp('com.example.rival')
    await insertApp('com.example.untracked')

    expect((await call('/apps', { method: 'POST', body: JSON.stringify({ platform: 'ios', external_id: 'com.example.parent' }) })).status).toBe(201)
    expect((await call('/apps?folder_id=unassigned')).status).toBe(200)
    expect((await call('/apps/ios/com.example.untracked/folder', { method: 'PATCH', body: JSON.stringify({ folder_id: null }) })).status).toBe(404)
    expect((await call('/apps/ios/missing/ratings/summary')).status).toBe(404)
    expect((await call('/apps/ios/missing/ratings/history')).status).toBe(404)
    expect((await call('/apps/ios/missing/rankings')).status).toBe(404)
    expect((await call('/apps/ios/missing/keywords')).status).toBe(404)

    expect((await call('/apps/ios/com.example.parent/sync', { method: 'POST' })).status).toBe(202)
    expect((await call('/apps/ios/com.example.parent/sync', { method: 'POST' })).status).toBe(202)
    expect(queued).toHaveLength(1)

    const competitor = await call('/apps/ios/com.example.parent/competitors', { method: 'POST', body: JSON.stringify({ competitor_app_id: rivalId, relationship: 'indirect' }) })
    expect(competitor.status).toBe(201)
    expect(await competitor.json()).toMatchObject({ relationship: 'indirect', app: { id: rivalId, external_id: 'com.example.rival' } })
    expect((await testEnv.DB.prepare('SELECT count(*) AS count FROM user_apps WHERE app_id=?').bind(parentId).first<{ count: number }>())!.count).toBe(1)
    expect((await testEnv.DB.prepare('SELECT count(*) AS count FROM user_apps WHERE app_id=?').bind(rivalId).first<{ count: number }>())!.count).toBe(0)
  }, 20_000)
})
