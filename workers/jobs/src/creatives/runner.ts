import { all, first, log, type AdSource, type JobMessage } from '@openapps/core'
import type { Env } from '../env.js'
import { creativeConnectorRegistry } from './plugins/index.js'
import { persistCollection, recordCollectionFailure, type CollectionTargetRow } from './persistence.js'

const sources: AdSource[] = ['meta', 'google', 'tiktok']

function enabledSources(env: Env) {
  const configured = String(env.CREATIVE_SOURCES ?? '').split(',').map((source) => source.trim()).filter(Boolean)
  return configured.length ? sources.filter((source) => configured.includes(source)) : sources
}

function backfillLimit(env: Env) {
  const configured = Number(env.CREATIVE_BACKFILL_LIMIT ?? 10)
  return Number.isFinite(configured) ? Math.max(0, Math.min(100, Math.trunc(configured))) : 10
}

async function targetRow(env: Env, targetId: number): Promise<CollectionTargetRow | null> {
  const row = await first<{ id: number; publisher_id: number | null; developer_domain: string | null; display_name: string }>(env.DB,
    'SELECT id,publisher_id,developer_domain,display_name FROM ad_collection_targets WHERE id=?', targetId)
  if (!row) return null
  const countries = (await all<{ code: string }>(env.DB, `SELECT code FROM countries WHERE is_active_ios=1 OR is_active_android=1
    ORDER BY priority DESC LIMIT 30`)).map((country) => country.code)
  return { id: row.id, publisherId: row.publisher_id, developerDomain: row.developer_domain, displayName: row.display_name, countries }
}

export async function runCreativeDiscovery(env: Env, message: Extract<JobMessage, { kind: 'creative.discover' }>) {
  if (String(env.CREATIVES_ENABLED) !== 'true') {
    log('info', 'creative.disabled', { targetId: message.targetId, reason: message.reason })
    return { disabled: true }
  }
  if (!message.source) {
    const activeSources = enabledSources(env)
    await env.CREATIVE_DISCOVERY.sendBatch(activeSources.map((source) => ({ body: { ...message, source, taskId: `${message.taskId}:${source}` }, contentType: 'json' as const })))
    return { expanded: activeSources.length }
  }
  if (!enabledSources(env).includes(message.source)) return { disabled: true, source: message.source }
  const configured = await first<{ enabled: number }>(env.DB, 'SELECT enabled FROM payload_connector_configs WHERE source=?', message.source)
  if (configured && !configured.enabled) return { disabled: true, source: message.source }
  const target = await targetRow(env, message.targetId)
  if (!target) throw new Error(`Creative target ${message.targetId} no longer exists`)
  const source = message.source
  const limiter = env.CREATIVE_SOURCE_LIMITER.get(env.CREATIVE_SOURCE_LIMITER.idFromName(source))
  const quota = await limiter.acquire(source === 'meta' ? 5 : 2, 60)
  if (!quota.allowed) throw new Error(`RATE_LIMIT:${quota.retryAfterMs}`)
  await env.DB.prepare("UPDATE ad_collection_targets SET status='running',updated_at=datetime('now') WHERE id=?").bind(target.id).run()
  const started = Date.now()
  try {
    const plugin = creativeConnectorRegistry[source]
    const result = await plugin.collect({ env }, target)
    const persisted = await persistCollection(env, target, source, message.reason, result)
    const health = await plugin.healthCheck({ env })
    await env.DB.prepare(`UPDATE payload_connector_configs SET health=?,last_health_code=?,last_success_at=datetime('now'),
      last_failure_at=NULL,updated_at=datetime('now') WHERE source=?`)
      .bind(health.status, health.code ?? null, source).run()
    try { await limiter.success() } catch (error) {
      log('warn', 'creative.limiter.success_failed', { source, targetId: target.id, error: error instanceof Error ? error.message : String(error) })
    }
    log('info', 'creative.collection.completed', { source, targetId: target.id, transport: result.transport, coverage: result.coverage,
      durationMs: Date.now() - started, results: persisted.resultCount, newAds: persisted.newAds, linkedApps: persisted.linkedApps, candidates: persisted.candidates })
    return persisted
  } catch (error) {
    const circuit = await limiter.failure().catch(() => ({ failures: 0, circuitOpenUntil: 0 }))
    await recordCollectionFailure(env, target.id, source, message.reason, error)
    await env.DB.prepare(`UPDATE payload_connector_configs SET health='failing',last_health_code=?,last_failure_at=datetime('now'),
      updated_at=datetime('now') WHERE source=?`).bind(error instanceof Error ? error.message.slice(0, 120) : 'unknown', source).run()
    log('error', 'creative.collection.failed', { source, targetId: target.id, durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error), failures: circuit.failures, circuitOpenUntil: circuit.circuitOpenUntil })
    throw error
  }
}

export async function dispatchCreativeCollections(env: Env) {
  if (String(env.CREATIVES_ENABLED) !== 'true') return { inserted: 0, dispatched: 0 }
  await env.DB.batch([
    env.DB.prepare(`UPDATE ad_collection_runs SET status='failed',error_message='Collection execution expired',
      completed_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND datetime(started_at)<datetime('now','-15 minutes')`),
    env.DB.prepare(`UPDATE sync_tasks SET status='failed',failure_reason='execution_expired',error_message='Collection execution expired',
      updated_at=datetime('now') WHERE kind='creative.discover' AND status='running' AND datetime(updated_at)<datetime('now','-15 minutes')`),
  ])
  const now = new Date().toISOString()
  const limit = backfillLimit(env)
  const missing = await all<{ id: number; name: string; url: string | null }>(env.DB, `SELECT p.id,p.name,p.url FROM publishers p
    WHERE EXISTS (SELECT 1 FROM apps a WHERE a.publisher_id=p.id)
      AND NOT EXISTS (SELECT 1 FROM ad_collection_targets t WHERE t.publisher_id=p.id)
    ORDER BY p.id LIMIT ?`, limit)
  for (const publisher of missing) {
    let developerDomain: string | null = null
    try {
      const host = publisher.url ? new URL(publisher.url).hostname.toLocaleLowerCase().replace(/^www\./, '') : ''
      if (host && !['apps.apple.com', 'play.google.com'].includes(host)) developerDomain = host
    } catch { /* Ignore non-URL publisher identifiers. */ }
    await env.DB.prepare(`INSERT OR IGNORE INTO ad_collection_targets
      (publisher_id,developer_domain,display_name,status,next_collect_at,created_at,updated_at) VALUES (?,?,?,'pending',?,?,?)`)
      .bind(publisher.id, developerDomain, publisher.name, now, now, now).run()
  }

  const due = await all<{ id: number; tracked: number; last_collected_at: string | null }>(env.DB, `SELECT t.id,t.last_collected_at,
    EXISTS(SELECT 1 FROM apps a LEFT JOIN user_apps ua ON ua.app_id=a.id LEFT JOIN app_competitors ac ON ac.competitor_app_id=a.id
      WHERE a.publisher_id=t.publisher_id AND (ua.app_id IS NOT NULL OR ac.competitor_app_id IS NOT NULL)) AS tracked
    FROM ad_collection_targets t WHERE t.status!='disabled' AND (
      t.last_collected_at IS NULL OR
      (tracked=1 AND datetime(t.last_collected_at)<datetime('now','-24 hours')) OR
      (t.next_collect_at IS NOT NULL AND datetime(t.next_collect_at)<=datetime('now'))
    ) ORDER BY tracked DESC,t.last_collected_at IS NOT NULL,t.last_collected_at LIMIT ?`, Math.max(limit, 1))
  const slot = Math.floor(Date.now() / 3_600_000)
  if (due.length) await env.CREATIVE_DISCOVERY.sendBatch(due.map((target) => ({ body: {
    v: 1, kind: 'creative.discover', targetId: target.id, source: null,
    reason: target.last_collected_at ? target.tracked ? 'tracked' : 'viewed' : 'backfill', taskId: `creative:${target.id}:${slot}`,
  }, contentType: 'json' as const })))
  return { inserted: missing.length, dispatched: due.length }
}
