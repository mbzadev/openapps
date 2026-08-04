/// <reference path="../../workers/jobs/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createExecutionContext, createMessageBatch, getQueueResult, type D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { handleBatch } from '../../workers/jobs/src/index.js'
import type { JobMessage } from '../../packages/core/src/messages.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }

beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS))
afterEach(() => vi.unstubAllGlobals())

describe('at-least-once Queue delivery', () => {
  it('deduplicates repeated task ids before side effects', async () => {
    const message: JobMessage = { v: 1, kind: 'dead-letter', original: { source: 'test' }, error: 'expected', failedAt: new Date().toISOString(), taskId: 'duplicate-task' }
    const batch = createMessageBatch('openapps-reconcile', [
      { id: 'delivery-1', timestamp: new Date(), body: message, attempts: 1 },
      { id: 'delivery-2', timestamp: new Date(), body: message, attempts: 1 },
    ])
    const ctx = createExecutionContext()

    await handleBatch(batch, testEnv)
    const result = await getQueueResult(batch, ctx)
    expect(result.explicitAcks).toHaveLength(2)
    expect((await testEnv.DB.prepare("SELECT status,attempt_count FROM sync_tasks WHERE task_id='duplicate-task'").first())).toEqual({ status: 'completed', attempt_count: 1 })
    expect((await testEnv.ARTIFACTS.list({ prefix: 'dlq/' })).objects).toHaveLength(1)
  })

  it('reclaims retries and archives the final DLQ delivery', async () => {
    const message: JobMessage = { v: 1, kind: 'app.sync', platform: 'ios', appId: 999_999, source: 'scheduled', taskId: 'retry-task' }
    for (const attempts of [1, 2]) {
      const batch = createMessageBatch('openapps-sync-tracked-ios', [{ id: `retry-${attempts}`, timestamp: new Date(), body: message, attempts }])
      const ctx = createExecutionContext()
      await handleBatch(batch, testEnv)
      const result = await getQueueResult(batch, ctx)
      expect(result.retryMessages).toHaveLength(1)
    }
    expect((await testEnv.DB.prepare("SELECT status,attempt_count FROM sync_tasks WHERE task_id='retry-task'").first())).toEqual({ status: 'pending', attempt_count: 2 })

    const dlq = createMessageBatch('openapps-dead-letter', [{ id: 'dead', timestamp: new Date(), body: message, attempts: 6 }])
    const ctx = createExecutionContext()
    await handleBatch(dlq, testEnv)
    expect((await getQueueResult(dlq, ctx)).explicitAcks).toEqual(['dead'])
    expect((await testEnv.DB.prepare("SELECT status,failure_reason FROM sync_tasks WHERE task_id='retry-task'").first())).toEqual({ status: 'failed', failure_reason: 'dead_letter' })
    expect((await testEnv.ARTIFACTS.list({ prefix: 'dlq/' })).objects.length).toBeGreaterThanOrEqual(1)
  })

  it('retries an empty chart response instead of recording false success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ feed: { entry: [] } }), { headers: { 'content-type': 'application/json' } })))
    const message: JobMessage = { v: 1, kind: 'chart.sync', platform: 'ios', countryCode: 'us', collection: 'top_free', categoryExternalId: null, snapshotDate: '2026-08-04', taskId: 'empty-chart-task' }
    const batch = createMessageBatch('openapps-charts-ios', [{ id: 'empty-chart', timestamp: new Date(), body: message, attempts: 1 }])
    const ctx = createExecutionContext()
    await handleBatch(batch, testEnv)
    expect((await getQueueResult(batch, ctx)).retryMessages).toHaveLength(1)
    expect(await testEnv.DB.prepare("SELECT id FROM trending_charts WHERE platform='ios' AND collection='top_free' AND country_code='us' AND snapshot_date='2026-08-04'").first()).toBeNull()
    expect(await testEnv.DB.prepare("SELECT status FROM sync_tasks WHERE task_id='empty-chart-task'").first()).toEqual({ status: 'pending' })
  })

  it('does not refetch a chart snapshot that already exists for the tuple and date', async () => {
    const category = await testEnv.DB.prepare("SELECT id FROM store_categories WHERE platform='ios' AND external_id IS NULL").first<{ id: number }>()
    const now = new Date().toISOString()
    await testEnv.DB.prepare(`INSERT INTO trending_charts
      (platform,collection,category_id,country_code,snapshot_date,created_at,updated_at)
      VALUES ('ios','top_paid',?,'us','2026-08-04',?,?)`).bind(category!.id, now, now).run()
    const fetchMock = vi.fn(async () => { throw new Error('should not fetch') })
    vi.stubGlobal('fetch', fetchMock)
    const message: JobMessage = { v: 1, kind: 'chart.sync', platform: 'ios', countryCode: 'us', collection: 'top_paid', categoryExternalId: null, snapshotDate: '2026-08-04', taskId: 'existing-chart-task' }
    const batch = createMessageBatch('openapps-charts-ios', [{ id: 'existing-chart', timestamp: new Date(), body: message, attempts: 1 }])
    const ctx = createExecutionContext()
    await handleBatch(batch, testEnv)
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(['existing-chart'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM trending_charts WHERE platform='ios' AND collection='top_paid' AND country_code='us' AND snapshot_date='2026-08-04'").first()).toEqual({ count: 1 })
  })

  it('completes an on-demand sync after the primary storefront without a global fanout', async () => {
    const now = new Date().toISOString()
    const app = await testEnv.DB.prepare(`INSERT INTO apps
      (platform,external_id,display_name,origin_country_code,discovered_from,discovered_at,created_at,updated_at)
      VALUES ('ios','456','Fast App','us','test',?,?,?) RETURNING id`).bind(now, now, now).first<{ id: number }>()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      resultCount: 1,
      results: [{ trackId: 456, trackName: 'Fast App', artistName: 'MBZA', artistId: 9, primaryGenreName: 'Utilities', primaryGenreId: 6002, price: 0, currency: 'USD', version: '1.0', description: 'Ready' }],
    }))))
    const dispatched: JobMessage[] = []
    const producer = { send: async (body: JobMessage) => { dispatched.push(body) }, sendBatch: async (batch: Array<{ body: JobMessage }>) => { dispatched.push(...batch.map(({ body }) => body)) } }
    const bindings = { ...testEnv, SYNC_TRACKED_IOS: producer, SYNC_TRACKED_ANDROID: producer, SYNC_ON_DEMAND_IOS: producer, SYNC_ON_DEMAND_ANDROID: producer, CHARTS_IOS: producer, CHARTS_ANDROID: producer, RECONCILE: producer }
    const message: JobMessage = { v: 1, kind: 'app.sync', platform: 'ios', appId: app!.id, source: 'on-demand', taskId: 'fast-on-demand' }
    const batch = createMessageBatch('openapps-sync-on-demand-ios', [{ id: 'fast-on-demand-delivery', timestamp: new Date(), body: message, attempts: 1 }])
    const ctx = createExecutionContext()

    await handleBatch(batch, bindings as never)

    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(['fast-on-demand-delivery'])
    expect(dispatched).toHaveLength(0)
    expect(await testEnv.DB.prepare('SELECT status,progress_done,progress_total FROM sync_statuses WHERE app_id=?').bind(app!.id).first()).toEqual({ status: 'completed', progress_done: 1, progress_total: 1 })
  })

  it('reconciles a stalled sync without dispatching a global storefront fanout', async () => {
    const now = new Date().toISOString()
    const app = await testEnv.DB.prepare(`INSERT INTO apps
      (platform,external_id,display_name,origin_country_code,discovered_from,discovered_at,created_at,updated_at)
      VALUES ('ios','789','Recovered App','us','test',?,?,?) RETURNING id`).bind(now, now, now).first<{ id: number }>()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      resultCount: 1,
      results: [{ trackId: 789, trackName: 'Recovered App', artistName: 'MBZA', artistId: 9, primaryGenreName: 'Utilities', primaryGenreId: 6002, price: 0, currency: 'USD', version: '1.0', description: 'Recovered' }],
    }))))
    const dispatched: JobMessage[] = []
    const producer = { send: async (body: JobMessage) => { dispatched.push(body) }, sendBatch: async (batch: Array<{ body: JobMessage }>) => { dispatched.push(...batch.map(({ body }) => body)) } }
    const bindings = { ...testEnv, SYNC_TRACKED_IOS: producer, SYNC_TRACKED_ANDROID: producer, SYNC_ON_DEMAND_IOS: producer, SYNC_ON_DEMAND_ANDROID: producer, CHARTS_IOS: producer, CHARTS_ANDROID: producer, RECONCILE: producer }
    const message: JobMessage = { v: 1, kind: 'app.sync', platform: 'ios', appId: app!.id, source: 'reconcile', taskId: 'reconcile-primary-only' }
    const batch = createMessageBatch('openapps-sync-tracked-ios', [{ id: 'reconcile-primary-delivery', timestamp: new Date(), body: message, attempts: 1 }])
    const ctx = createExecutionContext()

    await handleBatch(batch, bindings as never)

    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(['reconcile-primary-delivery'])
    expect(dispatched).toHaveLength(0)
    expect(await testEnv.DB.prepare('SELECT status,progress_done,progress_total FROM sync_statuses WHERE app_id=?').bind(app!.id).first()).toEqual({ status: 'completed', progress_done: 1, progress_total: 1 })
  })

  it('fans a scheduled app sync out into idempotent country/locale storefront messages', async () => {
    const now = new Date().toISOString()
    const app = await testEnv.DB.prepare(`INSERT INTO apps
      (platform,external_id,display_name,origin_country_code,discovered_from,discovered_at,created_at,updated_at)
      VALUES ('ios','123','Fanout App','us','test',?,?,?) RETURNING id`).bind(now, now, now).first<{ id: number }>()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      resultCount: 1,
      results: [{ trackId: 123, trackName: 'Fanout App', artistName: 'MBZA', artistId: 9, primaryGenreName: 'Utilities', primaryGenreId: 6002, averageUserRating: 4.5, userRatingCount: 10, price: 0, currency: 'USD', version: '1.0', description: 'Fanout fixture' }],
    }), { headers: { 'content-type': 'application/json' } })))
    const dispatched: JobMessage[] = []
    const producer = {
      send: async (body: JobMessage) => { dispatched.push(body) },
      sendBatch: async (batch: Array<{ body: JobMessage }>) => { dispatched.push(...batch.map(({ body }) => body)) },
    }
    const bindings = {
      ...testEnv,
      SYNC_TRACKED_IOS: producer, SYNC_TRACKED_ANDROID: producer,
      SYNC_ON_DEMAND_IOS: producer, SYNC_ON_DEMAND_ANDROID: producer,
      CHARTS_IOS: producer, CHARTS_ANDROID: producer, RECONCILE: producer,
    }
    const message: JobMessage = { v: 1, kind: 'app.sync', platform: 'ios', appId: app!.id, source: 'scheduled', taskId: 'fanout-root' }
    const batch = createMessageBatch('openapps-sync-tracked-ios', [{ id: 'fanout-root-delivery', timestamp: new Date(), body: message, attempts: 1 }])
    const ctx = createExecutionContext()
    await handleBatch(batch, bindings as never)
    expect((await getQueueResult(batch, ctx)).explicitAcks).toEqual(['fanout-root-delivery'])
    expect(dispatched.length).toBeGreaterThan(100)
    expect(dispatched.every((child) => child.kind === 'app.storefront')).toBe(true)
    expect(new Set(dispatched.map((child) => child.taskId)).size).toBe(dispatched.length)
    const status = await testEnv.DB.prepare('SELECT status,current_step,progress_done,progress_total,job_id FROM sync_statuses WHERE app_id=?').bind(app!.id).first<{ status: string; current_step: string; progress_done: number; progress_total: number; job_id: string }>()
    expect(status).toMatchObject({ status: 'running', current_step: 'storefronts', progress_done: 1, progress_total: dispatched.length + 1, job_id: 'fanout-root' })

    await testEnv.DB.prepare("UPDATE sync_statuses SET progress_done=1,progress_total=2,status='running' WHERE app_id=?").bind(app!.id).run()
    const child = dispatched[0]! as Extract<JobMessage, { kind: 'app.storefront' }>
    const childBatch = createMessageBatch('openapps-sync-on-demand-ios', [{ id: 'fanout-child-delivery', timestamp: new Date(), body: child, attempts: 1 }])
    const childCtx = createExecutionContext()
    await handleBatch(childBatch, bindings as never)
    expect((await getQueueResult(childBatch, childCtx)).explicitAcks).toEqual(['fanout-child-delivery'])
    expect(await testEnv.DB.prepare('SELECT status,current_step,progress_done,progress_total FROM sync_statuses WHERE app_id=?').bind(app!.id).first()).toEqual({ status: 'completed', current_step: null, progress_done: 2, progress_total: 2 })

    const duplicateChild = createMessageBatch('openapps-sync-on-demand-ios', [{ id: 'fanout-child-duplicate', timestamp: new Date(), body: child, attempts: 2 }])
    const duplicateCtx = createExecutionContext()
    await handleBatch(duplicateChild, bindings as never)
    expect((await getQueueResult(duplicateChild, duplicateCtx)).explicitAcks).toEqual(['fanout-child-duplicate'])
    expect(await testEnv.DB.prepare('SELECT progress_done FROM sync_statuses WHERE app_id=?').bind(app!.id).first()).toEqual({ progress_done: 2 })

    // A root delivery can fail after sending only some batches. Reclaiming it
    // must preserve completed child progress and omit those child messages.
    const firstDispatchCount = dispatched.length
    await testEnv.DB.prepare("UPDATE sync_tasks SET status='pending' WHERE task_id='fanout-root'").run()
    const retryBatch = createMessageBatch('openapps-sync-on-demand-ios', [{ id: 'fanout-root-retry', timestamp: new Date(), body: message, attempts: 2 }])
    const retryCtx = createExecutionContext()
    await handleBatch(retryBatch, bindings as never)
    expect((await getQueueResult(retryBatch, retryCtx)).explicitAcks).toEqual(['fanout-root-retry'])
    expect(dispatched).toHaveLength(firstDispatchCount * 2 - 1)
    expect(await testEnv.DB.prepare('SELECT status,progress_done,progress_total FROM sync_statuses WHERE app_id=?').bind(app!.id).first()).toEqual({ status: 'running', progress_done: 2, progress_total: firstDispatchCount + 1 })
  })
})
