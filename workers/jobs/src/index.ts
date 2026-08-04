import { WorkerEntrypoint } from 'cloudflare:workers'
import puppeteer from '@cloudflare/puppeteer'
import { all, first, jobMessageSchema, log, nowIso, type JobMessage, type Platform } from '@openapps/core'
import { createDatabase, syncTasks } from '@openapps/db'
import { detectLocaleChanges, googlePlayAppUrl, parseGooglePlayHtml, persistStoreApp, scraperFor, type StoreApp } from '@openapps/scrapers'
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

async function failSync(env: Env, appId: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  await env.DB.prepare(`UPDATE sync_statuses SET status='failed',current_step=NULL,
    error_message=?,completed_at=?,updated_at=? WHERE app_id=?`)
    .bind(message, nowIso(), nowIso(), appId).run()
}

async function scheduleSyncRetry(env: Env, appId: number, error: unknown, delaySeconds: number) {
  const message = error instanceof Error ? error.message : String(error)
  const now = nowIso()
  await env.DB.prepare(`UPDATE sync_statuses SET status='running',error_message=?,
    next_retry_at=datetime('now', ?),completed_at=NULL,updated_at=? WHERE app_id=?`)
    .bind(message, `+${delaySeconds} seconds`, now, appId).run()
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

function syncQueue(env: Env, platform: Platform, source: 'scheduled' | 'on-demand' | 'reconcile') {
  if (source === 'on-demand') return platform === 'ios' ? env.SYNC_ON_DEMAND_IOS : env.SYNC_ON_DEMAND_ANDROID
  return platform === 'ios' ? env.SYNC_TRACKED_IOS : env.SYNC_TRACKED_ANDROID
}

async function storefrontTargets(env: Env, platform: Platform) {
  const languageColumn = platform === 'ios' ? 'ios_languages' : 'android_languages'
  const activeColumn = platform === 'ios' ? 'is_active_ios' : 'is_active_android'
  const rows = await all<{ code: string; languages: string }>(env.DB,
    `SELECT code,${languageColumn} AS languages FROM countries WHERE ${activeColumn}=1 AND code!='zz' ORDER BY priority DESC,name`)
  const targets = new Map<string, { countryCode: string; locale: string }>()
  const parsed = rows.map((row) => ({ countryCode: row.code, locales: JSON.parse(row.languages) as string[] }))
  // Every active country receives a metric/listing refresh using its primary
  // locale, then every additional locale is assigned once to its highest
  // priority compatible country.
  for (const row of parsed) {
    const locale = row.locales[0] ?? 'en-US'
    targets.set(`${row.countryCode}:${locale}`, { countryCode: row.countryCode, locale })
  }
  const coveredLocales = new Set<string>()
  for (const row of parsed) for (const locale of row.locales) {
    if (coveredLocales.has(locale)) continue
    coveredLocales.add(locale)
    targets.set(`${row.countryCode}:${locale}`, { countryCode: row.countryCode, locale })
  }
  return [...targets.values()]
}

async function sendStorefronts(env: Env, messages: Array<Extract<JobMessage, { kind: 'app.storefront' }>>) {
  if (!messages.length) return
  const queue = syncQueue(env, messages[0]!.platform, messages[0]!.source)
  for (let offset = 0; offset < messages.length; offset += 100) {
    await queue.sendBatch(messages.slice(offset, offset + 100).map((body) => ({ body, contentType: 'json' as const })))
  }
}

function storefrontTaskPrefix(taskId: string) {
  return `${taskId}:storefront:`
}

async function recomputeStorefrontProgress(env: Env, message: Extract<JobMessage, { kind: 'app.storefront' }>) {
  const marker = ':storefront:'
  const markerIndex = message.taskId.lastIndexOf(marker)
  if (markerIndex < 0) throw new Error(`Invalid storefront task id: ${message.taskId}`)
  const prefix = message.taskId.slice(0, markerIndex + marker.length)
  const now = nowIso()
  await env.DB.prepare(`WITH completed(done) AS (
      SELECT 1+COUNT(*) FROM sync_tasks
      WHERE status='completed' AND substr(task_id,1,?)=?
    ) UPDATE sync_statuses SET
      progress_done=MIN(progress_total,(SELECT done FROM completed)),
      status=CASE WHEN (SELECT done FROM completed)>=progress_total THEN 'completed' ELSE 'running' END,
      current_step=CASE WHEN (SELECT done FROM completed)>=progress_total THEN NULL ELSE 'storefronts' END,
      completed_at=CASE WHEN (SELECT done FROM completed)>=progress_total THEN ? ELSE NULL END,
      error_message=NULL,updated_at=? WHERE app_id=?`)
    .bind(prefix.length, prefix, now, now, message.appId).run()
  const status = await first<{ status: string }>(env.DB, 'SELECT status FROM sync_statuses WHERE app_id=?', message.appId)
  if (status?.status === 'completed') {
    const version = await first<{ id: number }>(env.DB, 'SELECT id FROM app_versions WHERE app_id=? ORDER BY id DESC LIMIT 1', message.appId)
    await detectLocaleChanges(env.DB, message.appId, version?.id ?? null)
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
  const targets = (await storefrontTargets(env, message.platform)).filter((target) => target.countryCode !== 'us' || target.locale !== 'en-US')
  const children: Array<Extract<JobMessage, { kind: 'app.storefront' }>> = targets.map((target) => ({
    v: 1,
    kind: 'app.storefront',
    platform: message.platform,
    appId: message.appId,
    countryCode: target.countryCode,
    locale: target.locale,
    source: message.source,
    taskId: `${message.taskId}:storefront:${target.countryCode}:${target.locale}`,
  }))
  const prefix = storefrontTaskPrefix(message.taskId)
  const completedRows = await all<{ task_id: string }>(env.DB,
    "SELECT task_id FROM sync_tasks WHERE status='completed' AND substr(task_id,1,?)=?",
    prefix.length, prefix)
  const completed = new Set(completedRows.map((row) => row.task_id))
  const pendingChildren = children.filter((child) => !completed.has(child.taskId))
  const total = children.length + 1
  const done = Math.min(total, completed.size + 1)
  const now = nowIso()
  await env.DB.prepare(`UPDATE sync_statuses SET status=?,current_step=?,progress_done=?,progress_total=?,job_id=?,
    error_message=NULL,completed_at=?,updated_at=? WHERE app_id=?`)
    .bind(done < total ? 'running' : 'completed', done < total ? 'storefronts' : null, done, total, message.taskId,
      done < total ? null : now, now, message.appId).run()
  if (done >= total) {
    const version = await first<{ id: number }>(env.DB, 'SELECT id FROM app_versions WHERE app_id=? ORDER BY id DESC LIMIT 1', message.appId)
    await detectLocaleChanges(env.DB, message.appId, version?.id ?? null)
  }
  await sendStorefronts(env, pendingChildren)
}

async function syncStorefront(env: Env, message: Extract<JobMessage, { kind: 'app.storefront' }>) {
  const app = await first<{ external_id: string }>(env.DB, 'SELECT external_id FROM apps WHERE id=?', message.appId)
  if (!app) throw new Error(`App ${message.appId} no longer exists`)
  const quota = await limit(env, message.platform, 'storefront')
  if (!quota.allowed) throw new Error(`RATE_LIMIT:${quota.retryAfterMs}`)
  const store = await lookupWithBrowserFallback(env, message.platform, app.external_id, message.countryCode, message.locale)
  await persistStoreApp(env.DB, store, { country: message.countryCode, locale: message.locale, discoveredFrom: message.source })
}

async function syncChart(env: Env, message: Extract<JobMessage, { kind: 'chart.sync' }>) {
  const quota = await limit(env, message.platform, 'chart')
  if (!quota.allowed) throw new Error(`RATE_LIMIT:${quota.retryAfterMs}`)
  const category = message.categoryExternalId
    ? await first<{ id: number }>(env.DB, 'SELECT id FROM store_categories WHERE platform=? AND external_id=?', message.platform, message.categoryExternalId)
    : await first<{ id: number }>(env.DB, 'SELECT id FROM store_categories WHERE platform=? AND external_id IS NULL', message.platform)
  if (!category) throw new Error(`Missing ${message.platform} root category`)
  const existing = await first<{ id: number }>(env.DB, `SELECT id FROM trending_charts
    WHERE platform=? AND collection=? AND country_code=? AND category_id=? AND snapshot_date=?`,
  message.platform, message.collection, message.countryCode, category.id, message.snapshotDate)
  if (existing) return
  const entries = await scraperFor(message.platform).chart(message.collection, message.countryCode, 100, message.categoryExternalId)
  if (!entries.length) {
    log('warn', 'chart.empty', { platform: message.platform, collection: message.collection, countryCode: message.countryCode, snapshotDate: message.snapshotDate })
    return
  }
  const now = nowIso()
  const persistedEntries: Array<{ rank: number; appId: number; price: number; currency: string | null }> = []
  const stores: StoreApp[] = []
  // Store lookups dominate chart duration. Keep concurrency bounded so a
  // 100-entry chart completes well inside the Queue consumer deadline without
  // flooding Apple or Google.
  for (let offset = 0; offset < entries.length; offset += 10) {
    stores.push(...await Promise.all(entries.slice(offset, offset + 10).map((entry) =>
      lookupWithBrowserFallback(env, message.platform, entry.external_id, message.countryCode))))
  }
  for (const [index, entry] of entries.entries()) {
    const store = stores[index]!
    const appId = await persistStoreApp(env.DB, store, { country: message.countryCode, discoveredFrom: 'chart' })
    persistedEntries.push({ rank: entry.rank, appId, price: store.price, currency: store.currency })
  }
  const chartId = `(SELECT id FROM trending_charts WHERE platform=? AND collection=? AND country_code=? AND category_id=? AND snapshot_date=?)`
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO trending_charts (platform,collection,category_id,country_code,snapshot_date,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).bind(message.platform, message.collection, category.id, message.countryCode, message.snapshotDate, now, now),
    ...persistedEntries.map((entry) => env.DB.prepare(`INSERT INTO trending_chart_entries
      (trending_chart_id,rank,app_id,price,currency) VALUES (${chartId},?,?,?,?)`)
      .bind(message.platform, message.collection, message.countryCode, category.id, message.snapshotDate, entry.rank, entry.appId, entry.price, entry.currency)),
  ])
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

async function claimTask(env: Env, message: JobMessage): Promise<boolean> {
  const now = nowIso()
  const inserted = await createDatabase(env.DB).insert(syncTasks).values({
    taskId: message.taskId, kind: message.kind, payload: message,
    status: 'running', attemptCount: 1, createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: syncTasks.taskId }).run()
  if ((inserted.meta.changes ?? 0) > 0) return true

  // Queue delivery is at-least-once. A completed or concurrently-running task
  // is acknowledged without repeating its side effects. A failed delivery can
  // be reclaimed by the retry carrying the same stable task id.
  const reclaimed = await env.DB.prepare(`UPDATE sync_tasks SET status='running',
      attempt_count=attempt_count+1, failure_reason=NULL, error_message=NULL,
      available_at=NULL, updated_at=?
    WHERE task_id=? AND status!='completed'
      AND (status!='running' OR datetime(updated_at) < datetime('now','-10 minutes'))`)
    .bind(now, message.taskId).run()
  return (reclaimed.meta.changes ?? 0) > 0
}

async function completeTask(env: Env, taskId: string) {
  await env.DB.prepare("UPDATE sync_tasks SET status='completed',available_at=NULL,updated_at=? WHERE task_id=?")
    .bind(nowIso(), taskId).run()
}

async function retryTask(env: Env, taskId: string, error: unknown, delaySeconds: number) {
  const message = error instanceof Error ? error.message : String(error)
  await env.DB.prepare(`UPDATE sync_tasks SET status='pending',failure_reason='queue_retry',
      error_message=?,available_at=datetime('now', ?),updated_at=? WHERE task_id=?`)
    .bind(message, `+${delaySeconds} seconds`, nowIso(), taskId).run()
}

export async function handleBatch(batch: MessageBatch<unknown>, env: Env) {
  if (batch.queue.includes('dead-letter')) {
    for (const item of batch.messages) {
      await archiveFailure(env, item.body, `Dead-lettered after ${item.attempts} attempts`)
      const parsed = jobMessageSchema.safeParse(item.body)
      if (parsed.success) {
        await env.DB.prepare("UPDATE sync_tasks SET status='failed',failure_reason='dead_letter',error_message=?,updated_at=? WHERE task_id=?")
          .bind(`Dead-lettered after ${item.attempts} attempts`, nowIso(), parsed.data.taskId).run()
        if (parsed.data.kind === 'app.sync' || parsed.data.kind === 'app.storefront') {
          await failSync(env, parsed.data.appId, `Dead-lettered after ${item.attempts} attempts`)
        }
      }
      item.ack()
    }
    return
  }

  for (const item of batch.messages) {
    const parsed = jobMessageSchema.safeParse(item.body)
    if (!parsed.success) { await archiveFailure(env, item.body, parsed.error); item.ack(); continue }
    try {
      if (!(await claimTask(env, parsed.data))) {
        if (parsed.data.kind === 'app.storefront') await recomputeStorefrontProgress(env, parsed.data)
        log('info', 'queue.duplicate', task(parsed.data, 'acknowledged'))
        item.ack()
        continue
      }
      if (parsed.data.kind === 'app.sync') await syncApp(env, parsed.data)
      else if (parsed.data.kind === 'app.storefront') await syncStorefront(env, parsed.data)
      else if (parsed.data.kind === 'chart.sync') await syncChart(env, parsed.data)
      else if (parsed.data.kind === 'sync.reconcile') await reconcile(env, parsed.data)
      else await archiveFailure(env, parsed.data.original, parsed.data.error)
      await completeTask(env, parsed.data.taskId)
      if (parsed.data.kind === 'app.storefront') await recomputeStorefrontProgress(env, parsed.data)
      log('info', 'queue.completed', task(parsed.data, 'completed'))
      item.ack()
    } catch (error) {
      log('error', 'queue.failed', task(parsed.data, 'failed', error instanceof Error ? error.message : String(error)))
      const retryMs = error instanceof Error && error.message.startsWith('RATE_LIMIT:') ? Number(error.message.slice(11)) : 2 ** Math.min(item.attempts, 8) * 1000
      const delaySeconds = Math.max(1, Math.ceil(retryMs / 1000))
      if (parsed.data.kind === 'app.sync' || parsed.data.kind === 'app.storefront') await scheduleSyncRetry(env, parsed.data.appId, error, delaySeconds)
      await retryTask(env, parsed.data.taskId, error, delaySeconds)
      item.retry({ delaySeconds })
    }
  }
}

async function dispatchTracked(env: Env) {
  const apps = await all<{ id: number; platform: Platform }>(env.DB, 'SELECT DISTINCT a.id,a.platform FROM apps a JOIN user_apps ua ON ua.app_id=a.id WHERE a.is_available=1')
  const ios: JobMessage[] = [], android: JobMessage[] = []
  const slot = Math.floor(Date.now() / (20 * 60_000))
  for (const app of apps) (app.platform === 'ios' ? ios : android).push({ v: 1, kind: 'app.sync', platform: app.platform, appId: app.id, source: 'scheduled', taskId: `app:${app.id}:${slot}` })
  if (ios.length) await env.SYNC_TRACKED_IOS.sendBatch(ios.map((body) => ({ body, contentType: 'json' as const })))
  if (android.length) await env.SYNC_TRACKED_ANDROID.sendBatch(android.map((body) => ({ body, contentType: 'json' as const })))
}

async function dispatchReconcile(env: Env) {
  const stale = await all<{ id: number }>(env.DB, `SELECT id FROM sync_statuses WHERE status IN ('pending','running','failed') AND updated_at < datetime('now','-15 minutes') LIMIT 100`)
  const slot = Math.floor(Date.now() / (15 * 60_000))
  if (stale.length) await env.RECONCILE.sendBatch(stale.map(({ id }) => ({ body: { v: 1, kind: 'sync.reconcile', syncStatusId: id, taskId: `reconcile:${id}:${slot}` }, contentType: 'json' as const })))
}

async function dispatchCharts(env: Env) {
  const countries = await all<{ code: string; is_active_ios: number; is_active_android: number }>(env.DB, 'SELECT code,is_active_ios,is_active_android FROM countries WHERE is_active_ios=1 OR is_active_android=1 ORDER BY priority DESC LIMIT 30')
  const date = nowIso().slice(0, 10)
  const collections = ['top_free', 'top_paid', 'top_grossing'] as const
  const ios: JobMessage[] = [], android: JobMessage[] = []
  for (const country of countries) for (const collection of collections) {
    if (country.is_active_ios) ios.push({ v: 1, kind: 'chart.sync', platform: 'ios', countryCode: country.code, collection, categoryExternalId: null, snapshotDate: date, taskId: `chart:ios:${country.code}:${collection}:${date}` })
    if (country.is_active_android) android.push({ v: 1, kind: 'chart.sync', platform: 'android', countryCode: country.code, collection, categoryExternalId: null, snapshotDate: date, taskId: `chart:android:${country.code}:${collection}:${date}` })
  }
  for (let i = 0; i < ios.length; i += 100) await env.CHARTS_IOS.sendBatch(ios.slice(i, i + 100).map((body) => ({ body, contentType: 'json' as const })))
  for (let i = 0; i < android.length; i += 100) await env.CHARTS_ANDROID.sendBatch(android.slice(i, i + 100).map((body) => ({ body, contentType: 'json' as const })))
}

async function cleanup(env: Env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sync_tasks WHERE updated_at < datetime('now','-30 days')"),
    env.DB.prepare("DELETE FROM personal_access_tokens WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"),
  ])
  for (const prefix of ['temporary/', 'dlq/']) {
    let cursor: string | undefined
    do {
      const listing = await env.ARTIFACTS.list({ prefix, ...(cursor ? { cursor } : {}), limit: 1000 })
      const old = listing.objects.filter((object) => object.uploaded.getTime() < Date.now() - 30 * 86_400_000)
      if (old.length) await env.ARTIFACTS.delete(old.map((object) => object.key))
      cursor = listing.truncated ? listing.cursor : undefined
    } while (cursor)
  }
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
