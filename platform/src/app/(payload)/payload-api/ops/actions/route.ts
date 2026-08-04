import { getCloudflareContext } from '@opennextjs/cloudflare'
import { jobMessageSchema, type JobMessage } from '@openapps/core'
import { requireOperator } from '@/lib/payload-auth'

type ActionBody = { action?: string; id?: number }

function queueFor(env: CloudflareEnv, message: JobMessage): Queue<JobMessage> | null {
  if (message.kind === 'creative.discover') return env.CREATIVE_DISCOVERY
  if (message.kind === 'creative.media') return env.CREATIVE_MEDIA
  if (message.kind === 'sync.reconcile') return env.RECONCILE
  if (message.kind === 'chart.sync') return message.platform === 'ios' ? env.CHARTS_IOS : env.CHARTS_ANDROID
  if (message.kind === 'app.sync' || message.kind === 'app.storefront') return message.platform === 'ios' ? env.SYNC_ON_DEMAND_IOS : env.SYNC_ON_DEMAND_ANDROID
  return null
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireOperator(request)
  if (auth instanceof Response) return auth
  const body = await request.json().catch(() => ({})) as ActionBody
  const { env } = await getCloudflareContext({ async: true })

  if (body.action === 'dispatch-creatives') {
    const result = await env.DB.prepare(`SELECT id FROM ad_collection_targets WHERE status!='disabled' AND (
      last_collected_at IS NULL OR next_collect_at IS NULL OR datetime(next_collect_at)<=datetime('now')) ORDER BY last_collected_at IS NOT NULL,last_collected_at LIMIT 25`).all<{ id: number }>()
    const slot = Math.floor(Date.now() / 3_600_000)
    const messages: JobMessage[] = result.results.map(({ id }) => ({
      v: 1, kind: 'creative.discover', targetId: id, source: null, reason: 'backfill', taskId: `creative:operator:${id}:${slot}`,
    }))
    if (messages.length) await env.CREATIVE_DISCOVERY.sendBatch(messages.map((message) => ({ body: message, contentType: 'json' as const })))
    await auth.payload.create({ collection: 'audit-logs', data: { actor: auth.user.id, action: 'ops.dispatch-creatives', entityType: 'queue', metadata: { count: messages.length } } })
    return Response.json({ dispatched: messages.length })
  }

  if (body.action === 'retry-dead-letter' && Number.isInteger(body.id)) {
    const row = await env.DB.prepare("SELECT id,task_id,payload FROM payload_dead_letters WHERE id=? AND status='open'").bind(body.id).first<{ id: number; task_id: string; payload: string }>()
    if (!row) return Response.json({ message: 'Dead letter introuvable.' }, { status: 404 })
    const parsed = jobMessageSchema.safeParse(JSON.parse(row.payload))
    if (!parsed.success) return Response.json({ message: 'Payload de tâche invalide.' }, { status: 422 })
    const queue = queueFor(env, parsed.data)
    if (!queue) return Response.json({ message: 'Aucune Queue compatible.' }, { status: 422 })
    await queue.send(parsed.data, { contentType: 'json' })
    await env.DB.prepare("UPDATE payload_dead_letters SET status='requeued',resolved_at=datetime('now'),resolved_by_id=?,updated_at=datetime('now') WHERE id=?")
      .bind(auth.user.id, row.id).run()
    await auth.payload.create({ collection: 'audit-logs', data: { actor: auth.user.id, action: 'ops.retry-dead-letter', entityType: 'task', entityId: row.task_id } })
    return Response.json({ requeued: true, taskId: row.task_id })
  }

  return Response.json({ message: 'Action inconnue.' }, { status: 422 })
}
