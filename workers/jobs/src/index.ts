import { WorkerEntrypoint } from 'cloudflare:workers'
import puppeteer from '@cloudflare/puppeteer'
import { all, first, jobMessageSchema, log, nowIso, type JobMessage, type Platform } from '@openapps/core'
import { googlePlayAppUrl, parseGooglePlayHtml, persistStoreApp, scraperFor, type StoreApp } from '@openapps/scrapers'
import { StoreRateLimiter } from './rate-limiter.js'
import type { Env } from './env.js'

export { StoreRateLimiter }

function task(message: JobMessage, status: string, error?: string) {
  return { id: message.taskId, status, error }
}

async function setSync(env: Env, appId: number, status: string, step: string | null, error: string | null = null) {
  const now = nowIso()
  await env.DB.prepare(`INSERT INTO sync_statuses
    (app_id,status,current_step,progress_done,progress_total,error_message,created_at,updated_at)
    VALUES (?,?,?,?,1,?,?,?) ON CONFLICT(app_id) DO UPDATE SET status=excluded.status,
      current_step=excluded.current_step, progress_done=excluded.progress_done,
      progress_total=1, error_message=excluded.error_message,
      started_at=CASE WHEN excluded.status='running' THEN excluded.updated_at ELSE started_at END,
      completed_at=CASE WHEN excluded.status IN ('completed','failed') THEN excluded.updated_at ELSE NULL END,
      updated_at=excluded.updated_at`)
    .bind(appId, status, step, status === 'completed' ? 1 : 0, error, now, now).run()
}

async function limit(env: Env, platform: Platform, kind: string) {
  const stub = env.STORE_RATE_LIMITER.get(env.STORE_RATE_LIMITER.idFromName(`${platform}:${kind}`))
  return stub.acquire(platform === 'ios' ? 20 : 10, 60)
}

async function lookupWithBrowserFallback(env: Env, platform: Platform, externalId: string, country = 'us', locale = 'en-US'): Promise<StoreApp> {
  try {
    return await scraperFor(platform).lookup(externalId, country, locale)
  } catch (nativeError) {
    if (platform !== 'android') throw nativeError
    log('warn', 'scraper.browser_fallback', { platform, externalId, nativeError: nativeError instanceof Error ? nativeError.message : String(nativeError) })
    const browser = await puppeteer.launch(env.BROWSER)
    try {
      const page = await browser.newPage()
      await page.goto(googlePlayAppUrl(externalId, country, locale), { waitUntil: 'networkidle0', timeout: 30_000 })
      return parseGooglePlayHtml(externalId, await page.content(), locale)
    } finally {
      await browser.close()
    }
  }
}

async function syncApp(env: Env, message: Extract<JobMessage, { kind: 'app.sync' }>) {
  const app = await first<{ external_id: string }>(env.DB, 'SELECT external_id FROM apps WHERE id=?', message.appId)
  if (!app) throw new Error(`App ${message.appId} no longer exists`)
  const quota = await limit(env, message.platform, 'app')
  if (!quota.allowed) throw new Error(`RATE_LIMIT:${quota.retryAfterMs}`)
  await setSync(env, message.appId, 'running', 'store-metadata')
  const store = await lookupWithBrowserFallback(env, message.platform, app.external_id, 'us', 'en-US')
  await persistStoreApp(env.DB, store, { country: 'us', locale: 'en-US', discoveredFrom: message.source })
  await setSync(env, message.appId, 'completed', null)
}

async function syncChart(env: Env, message: Extract<JobMessage, { kind: 'chart.sync' }>) {
  const quota = await limit(env, message.platform, 'chart')
  if (!quota.allowed) throw new Error(`RATE_LIMIT:${quota.retryAfterMs}`)
  const category = message.categoryExternalId
    ? await first<{ id: number }>(env.DB, 'SELECT id FROM store_categories WHERE platform=? AND external_id=?', message.platform, message.categoryExternalId)
    : await first<{ id: number }>(env.DB, 'SELECT id FROM store_categories WHERE platform=? AND external_id IS NULL', message.platform)
  if (!category) throw new Error(`Missing ${message.platform} root category`)
  const entries = await scraperFor(message.platform).chart(message.collection, message.countryCode, 100, message.categoryExternalId)
  const now = nowIso()
  await env.DB.prepare(`INSERT INTO trending_charts (platform,collection,category_id,country_code,snapshot_date,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(platform,collection,country_code,category_id,snapshot_date) DO UPDATE SET updated_at=excluded.updated_at`)
    .bind(message.platform, message.collection, category.id, message.countryCode, message.snapshotDate, now, now).run()
  const chart = await first<{ id: number }>(env.DB, `SELECT id FROM trending_charts WHERE platform=? AND collection=? AND country_code=? AND category_id=? AND snapshot_date=?`, message.platform, message.collection, message.countryCode, category.id, message.snapshotDate)
  if (!chart) throw new Error('Chart persistence failed')
  await env.DB.prepare('DELETE FROM trending_chart_entries WHERE trending_chart_id=?').bind(chart.id).run()
  for (const entry of entries) {
    const store = await lookupWithBrowserFallback(env, message.platform, entry.external_id, message.countryCode)
    const appId = await persistStoreApp(env.DB, store, { country: message.countryCode, discoveredFrom: 'chart' })
    await env.DB.prepare(`INSERT INTO trending_chart_entries (trending_chart_id,rank,app_id,price,currency) VALUES (?,?,?,?,?)`)
      .bind(chart.id, entry.rank, appId, entry.price, entry.currency).run()
  }
}

async function reconcile(env: Env, message: Extract<JobMessage, { kind: 'sync.reconcile' }>) {
  const status = await first<{ id: number; app_id: number; status: string }>(env.DB, 'SELECT id,app_id,status FROM sync_statuses WHERE id=?', message.syncStatusId)
  if (!status || status.status === 'completed') return
  const app = await first<{ platform: Platform }>(env.DB, 'SELECT platform FROM apps WHERE id=?', status.app_id)
  if (!app) return
  const next: JobMessage = { v: 1, kind: 'app.sync', platform: app.platform, appId: status.app_id, source: 'reconcile', taskId: crypto.randomUUID() }
  await (app.platform === 'ios' ? env.SYNC_TRACKED_IOS : env.SYNC_TRACKED_ANDROID).send(next, { contentType: 'json' })
}

async function archiveFailure(env: Env, body: unknown, error: unknown) {
  const key = `dlq/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.json`
  await env.ARTIFACTS.put(key, JSON.stringify({ failed_at: nowIso(), body, error: error instanceof Error ? error.stack ?? error.message : String(error) }), { httpMetadata: { contentType: 'application/json' } })
}

async function handleBatch(batch: MessageBatch<unknown>, env: Env) {
  for (const item of batch.messages) {
    const parsed = jobMessageSchema.safeParse(item.body)
    if (!parsed.success) { await archiveFailure(env, item.body, parsed.error); item.ack(); continue }
    try {
      if (parsed.data.kind === 'app.sync') await syncApp(env, parsed.data)
      else if (parsed.data.kind === 'chart.sync') await syncChart(env, parsed.data)
      else if (parsed.data.kind === 'sync.reconcile') await reconcile(env, parsed.data)
      else await archiveFailure(env, parsed.data.original, parsed.data.error)
      log('info', 'queue.completed', task(parsed.data, 'completed'))
      item.ack()
    } catch (error) {
      log('error', 'queue.failed', task(parsed.data, 'failed', error instanceof Error ? error.message : String(error)))
      if (parsed.data.kind === 'app.sync') await setSync(env, parsed.data.appId, 'failed', null, error instanceof Error ? error.message : String(error))
      const retryMs = error instanceof Error && error.message.startsWith('RATE_LIMIT:') ? Number(error.message.slice(11)) : 2 ** Math.min(item.attempts, 8) * 1000
      item.retry({ delaySeconds: Math.max(1, Math.ceil(retryMs / 1000)) })
    }
  }
}

async function dispatchTracked(env: Env) {
  const apps = await all<{ id: number; platform: Platform }>(env.DB, 'SELECT DISTINCT a.id,a.platform FROM apps a JOIN user_apps ua ON ua.app_id=a.id WHERE a.is_available=1')
  const ios: JobMessage[] = [], android: JobMessage[] = []
  for (const app of apps) (app.platform === 'ios' ? ios : android).push({ v: 1, kind: 'app.sync', platform: app.platform, appId: app.id, source: 'scheduled', taskId: crypto.randomUUID() })
  if (ios.length) await env.SYNC_TRACKED_IOS.sendBatch(ios.map((body) => ({ body, contentType: 'json' as const })))
  if (android.length) await env.SYNC_TRACKED_ANDROID.sendBatch(android.map((body) => ({ body, contentType: 'json' as const })))
}

async function dispatchReconcile(env: Env) {
  const stale = await all<{ id: number }>(env.DB, `SELECT id FROM sync_statuses WHERE status IN ('pending','running','failed') AND updated_at < datetime('now','-15 minutes') LIMIT 100`)
  if (stale.length) await env.RECONCILE.sendBatch(stale.map(({ id }) => ({ body: { v: 1, kind: 'sync.reconcile', syncStatusId: id, taskId: crypto.randomUUID() }, contentType: 'json' as const })))
}

async function dispatchCharts(env: Env) {
  const countries = await all<{ code: string; is_active_ios: number; is_active_android: number }>(env.DB, 'SELECT code,is_active_ios,is_active_android FROM countries WHERE is_active_ios=1 OR is_active_android=1 ORDER BY priority DESC LIMIT 30')
  const date = nowIso().slice(0, 10)
  const collections = ['top_free', 'top_paid', 'top_grossing'] as const
  const ios: JobMessage[] = [], android: JobMessage[] = []
  for (const country of countries) for (const collection of collections) {
    if (country.is_active_ios) ios.push({ v: 1, kind: 'chart.sync', platform: 'ios', countryCode: country.code, collection, categoryExternalId: null, snapshotDate: date, taskId: crypto.randomUUID() })
    if (country.is_active_android) android.push({ v: 1, kind: 'chart.sync', platform: 'android', countryCode: country.code, collection, categoryExternalId: null, snapshotDate: date, taskId: crypto.randomUUID() })
  }
  for (let i = 0; i < ios.length; i += 100) await env.CHARTS_IOS.sendBatch(ios.slice(i, i + 100).map((body) => ({ body, contentType: 'json' as const })))
  for (let i = 0; i < android.length; i += 100) await env.CHARTS_ANDROID.sendBatch(android.slice(i, i + 100).map((body) => ({ body, contentType: 'json' as const })))
}

async function cleanup(env: Env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sync_tasks WHERE updated_at < datetime('now','-30 days')"),
    env.DB.prepare("DELETE FROM personal_access_tokens WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"),
  ])
  let cursor: string | undefined
  do {
    const listing = await env.ARTIFACTS.list({ prefix: 'temporary/', ...(cursor ? { cursor } : {}), limit: 1000 })
    const old = listing.objects.filter((object) => object.uploaded.getTime() < Date.now() - 30 * 86_400_000)
    if (old.length) await env.ARTIFACTS.delete(old.map((object) => object.key))
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
}

export default class JobsWorker extends WorkerEntrypoint<Env> {
  override async fetch(): Promise<Response> { return new Response('Not found', { status: 404 }) }
  override async queue(batch: MessageBatch<unknown>): Promise<void> { await handleBatch(batch, this.env) }
  override async scheduled(controller: ScheduledController): Promise<void> {
    if (controller.cron === '*/20 * * * *') await dispatchTracked(this.env)
    else if (controller.cron === '*/15 * * * *') await dispatchReconcile(this.env)
    else if (controller.cron === '30 0 * * *') await dispatchCharts(this.env)
    else if (controller.cron === '0 4 * * *') await cleanup(this.env)
  }
}
