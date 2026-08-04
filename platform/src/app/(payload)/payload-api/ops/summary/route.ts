import { getCloudflareContext } from '@opennextjs/cloudflare'
import { requireOperator } from '@/lib/payload-auth'
import type { DeadLetter, OpsSummary, RecentRun, SourceHealth } from '@/components/OpsDashboard/types'

async function rows<T>(db: D1Database, query: string, ...bindings: unknown[]): Promise<T[]> {
  try {
    const result = await db.prepare(query).bind(...bindings).all<T>()
    return result.results
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', event: 'ops.query.unavailable', query: query.slice(0, 80), message: error instanceof Error ? error.message : String(error) }))
    return []
  }
}

async function count(db: D1Database, query: string, ...bindings: unknown[]): Promise<number> {
  return Number((await rows<{ count: number }>(db, query, ...bindings))[0]?.count ?? 0)
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireOperator(request)
  if (auth instanceof Response) return auth
  const { env } = await getCloudflareContext({ async: true })
  const db = env.DB
  const [queued, running, completed24h, failed24h, deadLetterCount, ads, assets, linked, candidates, sources, recentRuns, deadLetters] = await Promise.all([
    count(db, "SELECT COUNT(*) count FROM sync_tasks WHERE status IN ('pending','retrying')"),
    count(db, "SELECT COUNT(*) count FROM sync_tasks WHERE status='running'"),
    count(db, "SELECT COUNT(*) count FROM sync_tasks WHERE status='completed' AND datetime(updated_at)>=datetime('now','-24 hours')"),
    count(db, "SELECT COUNT(*) count FROM sync_tasks WHERE status IN ('failed','dead-letter') AND datetime(updated_at)>=datetime('now','-24 hours')"),
    count(db, "SELECT COUNT(*) count FROM payload_dead_letters WHERE status='open'"),
    count(db, 'SELECT COUNT(*) count FROM ads'),
    count(db, 'SELECT COUNT(*) count FROM ad_assets'),
    count(db, 'SELECT COUNT(*) count FROM ad_app_links WHERE app_id IS NOT NULL'),
    count(db, 'SELECT COUNT(*) count FROM ad_app_links WHERE app_id IS NULL'),
    rows<SourceHealth>(db, `SELECT source,label,enabled,transport,health,secret_status secretStatus,
      last_success_at lastSuccessAt,last_failure_at lastFailureAt FROM payload_connector_configs ORDER BY id`),
    rows<RecentRun>(db, `SELECT id,source,reason,status,result_count resultCount,error_message errorMessage,
      started_at startedAt,completed_at completedAt FROM ad_collection_runs ORDER BY id DESC LIMIT 50`),
    rows<DeadLetter>(db, `SELECT id,task_id taskId,kind,source,status,error_message errorMessage,failed_at failedAt
      FROM payload_dead_letters ORDER BY failed_at DESC LIMIT 50`),
  ])

  const defaults: SourceHealth[] = [
    { source: 'apple', label: 'Apple Store', enabled: true, health: 'unknown', transport: 'fetch', secretStatus: 'not-required', lastSuccessAt: null, lastFailureAt: null },
    { source: 'google-play', label: 'Google Play', enabled: true, health: 'unknown', transport: 'fetch', secretStatus: 'not-required', lastSuccessAt: null, lastFailureAt: null },
    { source: 'meta', label: 'Meta Ads', enabled: true, health: 'unknown', transport: 'api', secretStatus: 'missing', lastSuccessAt: null, lastFailureAt: null },
    { source: 'google', label: 'Google Ads', enabled: true, health: 'unknown', transport: 'browser-rendering', secretStatus: 'not-required', lastSuccessAt: null, lastFailureAt: null },
    { source: 'tiktok', label: 'TikTok Ads', enabled: true, health: 'unknown', transport: 'api', secretStatus: 'missing', lastSuccessAt: null, lastFailureAt: null },
  ]
  const summary: OpsSummary = {
    generatedAt: new Date().toISOString(),
    queues: { queued, running, completed24h, failed24h, deadLetters: deadLetterCount },
    creatives: { ads, assets, linked, candidates },
    sources: sources.length ? sources.map((source) => ({ ...source, enabled: Boolean(source.enabled) })) : defaults,
    recentRuns,
    deadLetters,
  }
  return Response.json(summary, { headers: { 'cache-control': 'private, no-store' } })
}
