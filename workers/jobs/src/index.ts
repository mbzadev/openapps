import { WorkerEntrypoint } from 'cloudflare:workers'
import puppeteer from '@cloudflare/puppeteer'
import { all, chartTaskId, first, jobMessageSchema, log, nowIso, type JobMessage, type Platform } from '@openapps/core'
import { createDatabase, syncTasks } from '@openapps/db'
import { appleLegacyChartUrl, detectLocaleChanges, googlePlayAppUrl, parseAppleLegacyChart, parseGooglePlayHtml, persistStoreApp, scraperFor, type ChartApp, type StoreApp } from '@openapps/scrapers'
import { StoreRateLimiter } from './rate-limiter.js'
import { CreativeSourceLimiter } from './creative-source-limiter.js'
import { archiveCreativeMedia } from './creatives/media.js'
import { dispatchCreativeCollections, runCreativeDiscovery } from './creatives/runner.js'
import type { Env } from './env.js'

export { StoreRateLimiter, CreativeSourceLimiter }

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
  if (message.source !== 'scheduled') {
    await setSync(env, message.appId, 'completed', null)
    return
  }
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
  // Reconciliation only guarantees that the primary storefront becomes
  // usable again. Ignore legacy children produced by older deployments so a
  // stalled status cannot fan back out across every country.
  if (message.source === 'reconcile') return
  const app = await first<{ external_id: string }>(env.DB, 'SELECT external_id FROM apps WHERE id=?', message.appId)
  if (!app) throw new Error(`App ${message.appId} no longer exists`)
  const quota = await limit(env, message.platform, 'storefront')
  if (!quota.allowed) throw new Error(`RATE_LIMIT:${quota.retryAfterMs}`)
  const store = await lookupWithBrowserFallback(env, message.platform, app.external_id, message.countryCode, message.locale)
  await persistStoreApp(env.DB, store, { country: message.countryCode, locale: message.locale, discoveredFrom: message.source })
}

async function persistChartApp(env: Env, platform: Platform, countryCode: string, entry: ChartApp): Promise<number> {
  const now = nowIso()
  let publisherId: number | null = null
  if (entry.publisher_name) {
    await env.DB.prepare(`INSERT INTO publishers (platform,external_id,name,created_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(platform,external_id) DO UPDATE SET
      name=excluded.name,updated_at=excluded.updated_at`)
      .bind(platform, entry.publisher_name, entry.publisher_name, now, now).run()
    publisherId = (await first<{ id: number }>(env.DB,
      'SELECT id FROM publishers WHERE platform=? AND external_id=?', platform, entry.publisher_name))?.id ?? null
  }
  const categoryId = entry.category_id
    ? (await first<{ id: number }>(env.DB, 'SELECT id FROM store_categories WHERE platform=? AND external_id=?', platform, entry.category_id))?.id ?? null
    : entry.category
      ? (await first<{ id: number }>(env.DB, 'SELECT id FROM store_categories WHERE platform=? AND name=? COLLATE NOCASE ORDER BY priority DESC,id LIMIT 1', platform, entry.category))?.id ?? null
      : null
  await env.DB.prepare(`INSERT INTO apps
    (platform,external_id,publisher_id,category_id,display_name,icon_url,origin_country_code,is_free,
     discovered_from,discovered_at,is_available,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'chart',?,1,?,?)
    ON CONFLICT(platform,external_id) DO UPDATE SET
      publisher_id=COALESCE(apps.publisher_id,excluded.publisher_id),
      category_id=COALESCE(apps.category_id,excluded.category_id),
      display_name=excluded.display_name,
      icon_url=COALESCE(excluded.icon_url,apps.icon_url),
      is_free=excluded.is_free,is_available=1,updated_at=excluded.updated_at`)
    .bind(platform, entry.external_id, publisherId, categoryId, entry.name, entry.icon_url,
      countryCode, entry.is_free ? 1 : 0, now, now, now).run()
  const app = await first<{ id: number }>(env.DB,
    'SELECT id FROM apps WHERE platform=? AND external_id=?', platform, entry.external_id)
  if (!app) throw new Error(`Could not persist chart app ${entry.external_id}`)
  return app.id
}

async function chartWithBrowserFallback(env: Env, message: Extract<JobMessage, { kind: 'chart.sync' }>): Promise<ChartApp[]> {
  try {
    const entries = await scraperFor(message.platform).chart(message.collection, message.countryCode, 100, message.categoryExternalId)
    if (!entries.length) throw new Error('Native chart feed returned an empty response')
    return entries
  } catch (nativeError) {
    // Apple serves category charts (and Top Grossing) from its legacy RSS
    // endpoint. That endpoint regularly rejects Workers egress with a 403,
    // while it remains accessible from Cloudflare Browser Rendering.
    if (message.platform !== 'ios') throw nativeError
    log('warn', 'chart.browser_fallback', {
      platform: message.platform,
      collection: message.collection,
      countryCode: message.countryCode,
      nativeError: nativeError instanceof Error ? nativeError.message : String(nativeError),
    })
    const browser = await puppeteer.launch(env.BROWSER)
    try {
      const page = await browser.newPage()
      await page.setContent('<!doctype html><html><head></head><body></body></html>')
      const callbackName = `openappsChart_${crypto.randomUUID().replaceAll('-', '')}`
      const url = `${appleLegacyChartUrl(message.collection, message.countryCode, 100, message.categoryExternalId)}&callback=${callbackName}`
      // Direct navigation to Apple's JSON response can stall Chromium as a
      // download. Loading the same official feed as JSONP executes normally
      // in Browser Rendering and gives us an explicit timeout/error path.
      const payload = await page.evaluate((src, callback) => new Promise((resolve, reject) => {
        const scope = globalThis as unknown as Record<string, unknown>
        const browserDocument = (globalThis as unknown as {
          document: {
            createElement(tag: string): { src: string; onerror: () => void }
            head: { appendChild(node: unknown): void }
          }
        }).document
        const timer = setTimeout(() => reject(new Error('Apple chart JSONP timed out')), 15_000)
        scope[callback] = (data: unknown) => {
          clearTimeout(timer)
          resolve(data)
        }
        const script = browserDocument.createElement('script')
        script.src = src
        script.onerror = () => {
          clearTimeout(timer)
          reject(new Error('Apple chart JSONP failed to load'))
        }
        browserDocument.head.appendChild(script)
      }), url, callbackName)
      return parseAppleLegacyChart(payload as never)
    } finally {
      await browser.close()
    }
  }
}

async function syncChart(env: Env, message: Extract<JobMessage, { kind: 'chart.sync' }>) {
  const activeColumn = message.platform === 'ios' ? 'is_active_ios' : 'is_active_android'
  const activeCountry = await first<{ code: string }>(env.DB,
    `SELECT code FROM countries WHERE code=? AND ${activeColumn}=1`, message.countryCode)
  if (!activeCountry) {
    log('info', 'chart.inactive_country', {
      platform: message.platform,
      countryCode: message.countryCode,
      collection: message.collection,
    })
    return
  }
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
  const entries = await chartWithBrowserFallback(env, message)
  if (!entries.length) {
    log('warn', 'chart.empty', { platform: message.platform, collection: message.collection, countryCode: message.countryCode, snapshotDate: message.snapshotDate })
    throw new Error(`EMPTY_CHART:${message.platform}:${message.collection}:${message.countryCode}`)
  }
  const now = nowIso()
  const persistedEntries: Array<{ rank: number; appId: number; price: number; currency: string | null }> = []
  for (const entry of entries) {
    const appId = await persistChartApp(env, message.platform, message.countryCode, entry)
    persistedEntries.push({ rank: entry.rank, appId, price: entry.price, currency: entry.currency })
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
  return key
}

async function startTaskAttempt(env: Env, taskId: string, source: string | null) {
  const task = await env.DB.prepare('SELECT attempt_count FROM sync_tasks WHERE task_id=?').bind(taskId).first<{ attempt_count: number }>()
  if (!task) return
  const now = nowIso()
  await env.DB.prepare(`INSERT OR IGNORE INTO payload_task_attempts
    (task_id,attempt,status,source,started_at,created_at,updated_at) VALUES (?,?, 'running', ?,?,?,?)`)
    .bind(taskId, task.attempt_count, source, now, now, now).run()
}

async function claimTask(env: Env, message: JobMessage): Promise<boolean> {
  const now = nowIso()
  const inserted = await createDatabase(env.DB).insert(syncTasks).values({
    taskId: message.taskId, kind: message.kind, payload: message,
    status: 'running', attemptCount: 1, createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: syncTasks.taskId }).run()
  if ((inserted.meta.changes ?? 0) > 0) {
    const source = 'source' in message && typeof message.source === 'string' ? message.source : 'platform' in message ? message.platform : null
    await startTaskAttempt(env, message.taskId, source)
    return true
  }

  // Queue delivery is at-least-once. A completed or concurrently-running task
  // is acknowledged without repeating its side effects. A failed delivery can
  // be reclaimed by the retry carrying the same stable task id.
  const reclaimed = await env.DB.prepare(`UPDATE sync_tasks SET status='running',
      attempt_count=attempt_count+1, failure_reason=NULL, error_message=NULL,
      available_at=NULL, updated_at=?
    WHERE task_id=? AND status!='completed'
      AND (status!='running' OR datetime(updated_at) < datetime('now','-10 minutes'))`)
    .bind(now, message.taskId).run()
  const claimed = (reclaimed.meta.changes ?? 0) > 0
  if (claimed) {
    const source = 'source' in message && typeof message.source === 'string' ? message.source : 'platform' in message ? message.platform : null
    await startTaskAttempt(env, message.taskId, source)
  }
  return claimed
}

async function completeTask(env: Env, taskId: string) {
  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare("UPDATE sync_tasks SET status='completed',available_at=NULL,updated_at=? WHERE task_id=?").bind(now, taskId),
    env.DB.prepare(`UPDATE payload_task_attempts SET status='completed',completed_at=?,
      duration_ms=MAX(0,CAST((julianday(?) - julianday(started_at))*86400000 AS INTEGER)),updated_at=?
      WHERE task_id=? AND status='running'`).bind(now, now, now, taskId),
  ])
}

async function retryTask(env: Env, taskId: string, error: unknown, delaySeconds: number) {
  const message = error instanceof Error ? error.message : String(error)
  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare(`UPDATE sync_tasks SET status='pending',failure_reason='queue_retry',
      error_message=?,available_at=datetime('now', ?),updated_at=? WHERE task_id=?`)
      .bind(message, `+${delaySeconds} seconds`, now, taskId),
    env.DB.prepare(`UPDATE payload_task_attempts SET status='retrying',completed_at=?,error_message=?,
      duration_ms=MAX(0,CAST((julianday(?) - julianday(started_at))*86400000 AS INTEGER)),updated_at=?
      WHERE task_id=? AND status='running'`).bind(now, message, now, now, taskId),
  ])
}

export async function handleBatch(batch: MessageBatch<unknown>, env: Env) {
  if (batch.queue.includes('dead-letter')) {
    for (const item of batch.messages) {
      const errorMessage = `Dead-lettered after ${item.attempts} attempts`
      const rawR2Key = await archiveFailure(env, item.body, errorMessage)
      const parsed = jobMessageSchema.safeParse(item.body)
      if (parsed.success) {
        const failedAt = nowIso()
        const source = 'source' in parsed.data && typeof parsed.data.source === 'string' ? parsed.data.source : 'platform' in parsed.data ? parsed.data.platform : null
        await env.DB.batch([
          env.DB.prepare("UPDATE sync_tasks SET status='dead-letter',failure_reason='dead_letter',error_message=?,updated_at=? WHERE task_id=?")
            .bind(errorMessage, failedAt, parsed.data.taskId),
          env.DB.prepare(`INSERT INTO payload_dead_letters
            (task_id,kind,source,status,attempt_count,error_message,payload,raw_r2_key,failed_at,created_at,updated_at)
            VALUES (?,?,?,'open',?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET status='open',attempt_count=excluded.attempt_count,
              error_message=excluded.error_message,payload=excluded.payload,raw_r2_key=excluded.raw_r2_key,failed_at=excluded.failed_at,updated_at=excluded.updated_at`)
            .bind(parsed.data.taskId, parsed.data.kind, source, item.attempts, errorMessage, JSON.stringify(parsed.data), rawR2Key, failedAt, failedAt, failedAt),
          env.DB.prepare(`UPDATE payload_task_attempts SET status='failed',completed_at=?,error_code='dead_letter',error_message=?,raw_r2_key=?,updated_at=?
            WHERE task_id=? AND status IN ('running','retrying')`).bind(failedAt, errorMessage, rawR2Key, failedAt, parsed.data.taskId),
        ])
        if (parsed.data.kind === 'app.sync' || parsed.data.kind === 'app.storefront') {
          await failSync(env, parsed.data.appId, errorMessage)
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
      else if (parsed.data.kind === 'creative.discover') await runCreativeDiscovery(env, parsed.data)
      else if (parsed.data.kind === 'creative.media') {
        const archived = await archiveCreativeMedia(env, parsed.data)
        log('info', 'creative.media.archived', { adId: parsed.data.adId, variantId: parsed.data.variantId,
          assetId: archived.assetId, bytes: archived.byteSize, sha256: archived.sha256 })
      }
      else await archiveFailure(env, parsed.data.original, parsed.data.error)
      await completeTask(env, parsed.data.taskId)
      if (parsed.data.kind === 'app.storefront') await recomputeStorefrontProgress(env, parsed.data)
      log('info', 'queue.completed', task(parsed.data, 'completed'))
      item.ack()
    } catch (error) {
      log('error', 'queue.failed', task(parsed.data, 'failed', error instanceof Error ? error.message : String(error)))
      const creativeRetrySeconds = [900, 3600, 21_600, 86_400][Math.min(Math.max(item.attempts - 1, 0), 3)]!
      const retryMs = error instanceof Error && error.message.startsWith('RATE_LIMIT:') ? Number(error.message.slice(11))
        : parsed.data.kind === 'creative.discover' || parsed.data.kind === 'creative.media' ? creativeRetrySeconds * 1000
          : 2 ** Math.min(item.attempts, 8) * 1000
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
  const stale = await all<{ id: number }>(env.DB, `SELECT id FROM sync_statuses WHERE status IN ('pending','running','failed') AND datetime(updated_at) < datetime('now','-15 minutes') LIMIT 100`)
  const slot = Math.floor(Date.now() / (15 * 60_000))
  if (stale.length) await env.RECONCILE.sendBatch(stale.map(({ id }) => ({ body: { v: 1, kind: 'sync.reconcile', syncStatusId: id, taskId: `reconcile:${id}:${slot}` }, contentType: 'json' as const })))
}

async function dispatchCharts(env: Env) {
  const countries = await all<{ code: string; is_active_ios: number; is_active_android: number }>(env.DB, 'SELECT code,is_active_ios,is_active_android FROM countries WHERE is_active_ios=1 OR is_active_android=1 ORDER BY priority DESC LIMIT 30')
  const date = nowIso().slice(0, 10)
  const collections = ['top_free', 'top_paid', 'top_grossing'] as const
  const ios: JobMessage[] = [], android: JobMessage[] = []
  for (const country of countries) for (const collection of collections) {
    if (country.is_active_ios) ios.push({ v: 1, kind: 'chart.sync', platform: 'ios', countryCode: country.code, collection, categoryExternalId: null, snapshotDate: date, taskId: chartTaskId('ios', country.code, collection, null, date) })
    if (country.is_active_android) android.push({ v: 1, kind: 'chart.sync', platform: 'android', countryCode: country.code, collection, categoryExternalId: null, snapshotDate: date, taskId: chartTaskId('android', country.code, collection, null, date) })
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
  try {
    const pageCount = await first<{ page_count: number }>(env.DB, 'PRAGMA page_count')
    const pageSize = await first<{ page_size: number }>(env.DB, 'PRAGMA page_size')
    const bytes = Number(pageCount?.page_count ?? 0) * Number(pageSize?.page_size ?? 0)
    if (bytes >= 7 * 1024 * 1024 * 1024) log('error', 'd1.capacity.alert', { bytes, thresholdBytes: 7 * 1024 * 1024 * 1024, action: 'prepare-ad-shard' })
  } catch (error) {
    log('warn', 'd1.capacity.check_failed', { error: error instanceof Error ? error.message : String(error) })
  }
}

export default class JobsWorker extends WorkerEntrypoint<Env> {
  override async fetch(): Promise<Response> { return new Response('Not found', { status: 404 }) }
  override async queue(batch: MessageBatch<unknown>): Promise<void> { await handleBatch(batch, this.env) }
  override async scheduled(controller: ScheduledController): Promise<void> {
    if (controller.cron === '*/20 * * * *') await dispatchTracked(this.env)
    else if (controller.cron === '*/15 * * * *') await dispatchReconcile(this.env)
    else if (controller.cron === '10 * * * *') await dispatchCreativeCollections(this.env)
    else if (controller.cron === '30 0 * * *') await dispatchCharts(this.env)
    else if (controller.cron === '0 4 * * *') await cleanup(this.env)
  }
}
