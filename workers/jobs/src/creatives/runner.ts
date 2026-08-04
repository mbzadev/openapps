import { all, first, log, type AdSource, type JobMessage } from '@openapps/core'
import type { Env } from '../env.js'
import { creativeConnectors } from './connectors.js'
import { persistCollection, recordCollectionFailure, type CollectionTargetRow } from './persistence.js'

const sources: AdSource[] = ['meta', 'google', 'tiktok']

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
    await env.CREATIVE_DISCOVERY.sendBatch(sources.map((source) => ({ body: { ...message, source, taskId: `${message.taskId}:${source}` }, contentType: 'json' as const })))
    return { expanded: sources.length }
  }
  const target = await targetRow(env, message.targetId)
  if (!target) throw new Error(`Creative target ${message.targetId} no longer exists`)
  const source = message.source
  const limiter = env.CREATIVE_SOURCE_LIMITER.get(env.CREATIVE_SOURCE_LIMITER.idFromName(source))
  const quota = await limiter.acquire(source === 'meta' ? 5 : 2, 60)
  if (!quota.allowed) throw new Error(`RATE_LIMIT:${quota.retryAfterMs}`)
  await env.DB.prepare("UPDATE ad_collection_targets SET status='running',updated_at=datetime('now') WHERE id=?").bind(target.id).run()
  const started = Date.now()
  try {
    const result = await creativeConnectors[source](env, target)
    const persisted = await persistCollection(env, target, source, message.reason, result)
    await limiter.success()
    log('info', 'creative.collection.completed', { source, targetId: target.id, transport: result.transport, coverage: result.coverage,
      durationMs: Date.now() - started, results: persisted.resultCount, newAds: persisted.newAds, linkedApps: persisted.linkedApps, candidates: persisted.candidates })
    return persisted
  } catch (error) {
    const circuit = await limiter.failure()
    await recordCollectionFailure(env, target.id, source, message.reason, error)
    log('error', 'creative.collection.failed', { source, targetId: target.id, durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error), failures: circuit.failures, circuitOpenUntil: circuit.circuitOpenUntil })
    throw error
  }
}

export async function dispatchCreativeCollections(env: Env) {
  if (String(env.CREATIVES_ENABLED) !== 'true') return { inserted: 0, dispatched: 0 }
  const now = new Date().toISOString()
  const missing = await all<{ id: number; name: string; url: string | null }>(env.DB, `SELECT p.id,p.name,p.url FROM publishers p
    WHERE EXISTS (SELECT 1 FROM apps a WHERE a.publisher_id=p.id)
      AND NOT EXISTS (SELECT 1 FROM ad_collection_targets t WHERE t.publisher_id=p.id)
    ORDER BY p.id LIMIT 100`)
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
    ) ORDER BY tracked DESC,t.last_collected_at IS NOT NULL,t.last_collected_at LIMIT 100`)
  const slot = Math.floor(Date.now() / 3_600_000)
  if (due.length) await env.CREATIVE_DISCOVERY.sendBatch(due.map((target) => ({ body: {
    v: 1, kind: 'creative.discover', targetId: target.id, source: null,
    reason: target.last_collected_at ? target.tracked ? 'tracked' : 'viewed' : 'backfill', taskId: `creative:${target.id}:${slot}`,
  }, contentType: 'json' as const })))
  return { inserted: missing.length, dispatched: due.length }
}
