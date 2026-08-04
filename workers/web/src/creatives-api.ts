import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { all, first, jsonValue, nowIso, type JobMessage } from '@openapps/core'
import type { Env, Variables } from './env.js'

const creatives = new Hono<{ Bindings: Env; Variables: Variables }>()
const sourceSchema = z.enum(['meta', 'google', 'tiktok'])
const listSchema = z.object({
  search: z.string().max(100).optional(), source: sourceSchema.optional(), app: z.string().max(255).optional(),
  app_id: z.coerce.number().int().positive().optional(), advertiser_id: z.coerce.number().int().positive().optional(),
  publisher_id: z.coerce.number().int().positive().optional(), country: z.string().length(2).optional(),
  format: z.enum(['image', 'video', 'carousel', 'text', 'unknown']).optional(), status: z.enum(['active', 'inactive', 'removed', 'unknown']).optional(),
  date_from: z.iso.date().optional(), date_to: z.iso.date().optional(), page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(24),
})

function validation(error: z.ZodError) {
  return { message: 'The given data was invalid.', errors: z.flattenError(error).fieldErrors }
}

function assetUrl(sha256: string | null) {
  return sha256 ? `/api/v1/creative-assets/${sha256}` : null
}

function creativeSummary(row: Record<string, unknown>) {
  return {
    id: row.id, source: row.source, source_ad_id: row.source_ad_id, source_url: row.source_url,
    status: row.status, advertiser: row.advertiser_id ? { id: row.advertiser_id, name: row.advertiser_name, domain: row.advertiser_domain } : null,
    headline: row.headline, body: row.body, call_to_action: row.call_to_action, landing_url: row.landing_url,
    platforms: jsonValue(String(row.platforms ?? '[]'), []), languages: jsonValue(String(row.languages ?? '[]'), []),
    started_at: row.started_at, ended_at: row.ended_at,
    metrics: {
      impressions: row.impressions_min !== null || row.impressions_max !== null ? { min: row.impressions_min, max: row.impressions_max, exact: false } : null,
      reach: row.reach_min !== null || row.reach_max !== null ? { min: row.reach_min, max: row.reach_max, exact: false } : null,
      spend: row.spend_min !== null || row.spend_max !== null ? { min: row.spend_min, max: row.spend_max, currency: row.currency, exact: false } : null,
    },
    preview: row.asset_sha256 ? { url: assetUrl(String(row.asset_sha256)), type: row.asset_media_type, mime_type: row.asset_mime_type } : null,
    variants_count: Number(row.variants_count ?? 0), apps_count: Number(row.apps_count ?? 0),
    provenance: { source: row.source, collected_at: row.last_collected_at, raw_archived: Boolean(row.raw_r2_key) },
    first_collected_at: row.first_collected_at, last_collected_at: row.last_collected_at,
  }
}

async function sourceCoverage(db: Variables['db'], extraWhere = '', bindings: unknown[] = []) {
  const rows = await all<{ source: string; last_collected_at: string | null; status: string | null }>(db, `SELECT s.source,
    MAX(a.last_collected_at) AS last_collected_at,(SELECT r.status FROM ad_collection_runs r WHERE r.source=s.source ${extraWhere}
      ORDER BY r.started_at DESC LIMIT 1) AS status FROM (SELECT 'meta' source UNION ALL SELECT 'google' UNION ALL SELECT 'tiktok') s
    LEFT JOIN ads a ON a.source=s.source GROUP BY s.source`, ...bindings)
  return Object.fromEntries(rows.map((row) => [row.source, { status: row.status ?? 'never_collected', last_collected_at: row.last_collected_at }]))
}

type CreativeContext = Context<{ Bindings: Env; Variables: Variables }>

async function listCreatives(c: CreativeContext, forced: { appId?: number; advertiserId?: number } = {}) {
  const parsed = listSchema.safeParse({ ...c.req.query(), ...forced })
  if (!parsed.success) return c.json(validation(parsed.error), 422)
  const query = parsed.data, where: string[] = [], bindings: unknown[] = []
  if (query.search) { where.push('(a.headline LIKE ? OR a.body LIKE ? OR adv.name LIKE ?)'); bindings.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`) }
  if (query.source) { where.push('a.source=?'); bindings.push(query.source) }
  if (query.status) { where.push('a.status=?'); bindings.push(query.status) }
  if (query.advertiser_id) { where.push('a.advertiser_id=?'); bindings.push(query.advertiser_id) }
  if (query.publisher_id) { where.push('EXISTS(SELECT 1 FROM ad_app_links al JOIN apps ap ON ap.id=al.app_id WHERE al.ad_id=a.id AND ap.publisher_id=?)'); bindings.push(query.publisher_id) }
  if (query.app_id) { where.push('EXISTS(SELECT 1 FROM ad_app_links al WHERE al.ad_id=a.id AND al.app_id=?)'); bindings.push(query.app_id) }
  if (query.app && !query.app_id) { where.push(`EXISTS(SELECT 1 FROM ad_app_links al JOIN apps ap ON ap.id=al.app_id
    WHERE al.ad_id=a.id AND (ap.external_id=? OR ap.display_name LIKE ?))`); bindings.push(query.app, `%${query.app}%`) }
  if (query.country) { where.push('EXISTS(SELECT 1 FROM ad_regions ar WHERE ar.ad_id=a.id AND ar.country_code=?)'); bindings.push(query.country.toLocaleLowerCase()) }
  if (query.format) { where.push('EXISTS(SELECT 1 FROM ad_creative_variants av WHERE av.ad_id=a.id AND av.format=?)'); bindings.push(query.format) }
  if (query.date_from) { where.push('date(COALESCE(a.started_at,a.first_collected_at))>=date(?)'); bindings.push(query.date_from) }
  if (query.date_to) { where.push('date(COALESCE(a.ended_at,a.last_collected_at))<=date(?)'); bindings.push(query.date_to) }
  const condition = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = Number((await first<{ total: number }>(c.var.db, `SELECT COUNT(*) total FROM ads a LEFT JOIN ad_advertisers adv ON adv.id=a.advertiser_id ${condition}`, ...bindings))?.total ?? 0)
  const rows = await all<Record<string, unknown>>(c.var.db, `SELECT a.*,adv.name advertiser_name,adv.domain advertiser_domain,
    (SELECT COUNT(*) FROM ad_creative_variants v WHERE v.ad_id=a.id) variants_count,
    (SELECT COUNT(*) FROM ad_app_links l WHERE l.ad_id=a.id AND l.app_id IS NOT NULL) apps_count,
    (SELECT aa.sha256 FROM ad_creative_variants v JOIN ad_creative_assets ca ON ca.variant_id=v.id JOIN ad_assets aa ON aa.id=ca.asset_id
      WHERE v.ad_id=a.id ORDER BY ca.role='thumbnail' DESC,ca.position LIMIT 1) asset_sha256,
    (SELECT aa.media_type FROM ad_creative_variants v JOIN ad_creative_assets ca ON ca.variant_id=v.id JOIN ad_assets aa ON aa.id=ca.asset_id
      WHERE v.ad_id=a.id ORDER BY ca.role='thumbnail' DESC,ca.position LIMIT 1) asset_media_type,
    (SELECT aa.mime_type FROM ad_creative_variants v JOIN ad_creative_assets ca ON ca.variant_id=v.id JOIN ad_assets aa ON aa.id=ca.asset_id
      WHERE v.ad_id=a.id ORDER BY ca.role='thumbnail' DESC,ca.position LIMIT 1) asset_mime_type
    FROM ads a LEFT JOIN ad_advertisers adv ON adv.id=a.advertiser_id ${condition}
    ORDER BY COALESCE(a.started_at,a.first_collected_at) DESC,a.id DESC LIMIT ? OFFSET ?`, ...bindings, query.per_page, (query.page - 1) * query.per_page)
  const lastPage = Math.max(1, Math.ceil(total / query.per_page))
  return c.json({ data: rows.map(creativeSummary), links: { prev: query.page > 1 ? `?page=${query.page - 1}` : null, next: query.page < lastPage ? `?page=${query.page + 1}` : null },
    meta: { current_page: query.page, last_page: lastPage, per_page: query.per_page, total }, coverage: await sourceCoverage(c.var.db) })
}

async function creativeDetail(db: Variables['db'], id: number) {
  const row = await first<Record<string, unknown>>(db, `SELECT a.*,adv.name advertiser_name,adv.domain advertiser_domain,
    (SELECT COUNT(*) FROM ad_creative_variants WHERE ad_id=a.id) variants_count,
    (SELECT COUNT(*) FROM ad_app_links WHERE ad_id=a.id AND app_id IS NOT NULL) apps_count,NULL asset_sha256,NULL asset_media_type,NULL asset_mime_type
    FROM ads a LEFT JOIN ad_advertisers adv ON adv.id=a.advertiser_id WHERE a.id=?`, id)
  if (!row) return null
  const variants = await all<Record<string, unknown>>(db, 'SELECT * FROM ad_creative_variants WHERE ad_id=? ORDER BY position,id', id)
  const detailedVariants = await Promise.all(variants.map(async (variant) => ({
    id: variant.id, source_variant_id: variant.source_variant_id, format: variant.format, headline: variant.headline, body: variant.body,
    call_to_action: variant.call_to_action, landing_url: variant.landing_url, position: variant.position,
    assets: (await all<Record<string, unknown>>(db, `SELECT aa.id,aa.sha256,aa.media_type,aa.mime_type,aa.byte_size,aa.width,aa.height,aa.duration_ms,ca.role,ca.position
      FROM ad_creative_assets ca JOIN ad_assets aa ON aa.id=ca.asset_id WHERE ca.variant_id=? ORDER BY ca.position`, variant.id))
      .map((asset) => ({ ...asset, url: assetUrl(String(asset.sha256)) })),
  })))
  const regions = (await all<{ country_code: string }>(db, 'SELECT country_code FROM ad_regions WHERE ad_id=? ORDER BY country_code', id)).map((item) => item.country_code)
  const apps = await all<Record<string, unknown>>(db, `SELECT ap.id,ap.platform,ap.external_id,ap.display_name name,ap.icon_url,l.confidence,l.match_reason
    FROM ad_app_links l JOIN apps ap ON ap.id=l.app_id WHERE l.ad_id=? ORDER BY l.confidence,ap.display_name`, id)
  return { ...creativeSummary(row), variants: detailedVariants, countries: regions, apps }
}

async function ensureTarget(c: any, appId: number) {
  const app = await first<{ publisher_id: number | null; publisher_name: string | null; publisher_url: string | null }>(c.var.db, `SELECT a.publisher_id,p.name publisher_name,p.url publisher_url
    FROM apps a LEFT JOIN publishers p ON p.id=a.publisher_id WHERE a.id=?`, appId)
  if (!app?.publisher_id || !app.publisher_name) return null
  let target = await first<{ id: number; last_collected_at: string | null; status: string }>(c.var.db, 'SELECT id,last_collected_at,status FROM ad_collection_targets WHERE publisher_id=?', app.publisher_id)
  if (!target) {
    let domain: string | null = null
    try { const host = app.publisher_url ? new URL(app.publisher_url).hostname.toLocaleLowerCase().replace(/^www\./, '') : ''; if (host && !['apps.apple.com', 'play.google.com'].includes(host)) domain = host } catch { /* ignore */ }
    const now = nowIso()
    target = await c.var.db.prepare(`INSERT INTO ad_collection_targets (publisher_id,developer_domain,display_name,status,created_at,updated_at)
      VALUES (?,?,?,'pending',?,?) RETURNING id,last_collected_at,status`).bind(app.publisher_id, domain, app.publisher_name, now, now).first()
  }
  return target
}

async function enqueueTarget(c: any, targetId: number, reason: 'viewed' | 'manual') {
  const slot = Math.floor(Date.now() / (reason === 'manual' ? 60_000 : 86_400_000))
  const message: JobMessage = { v: 1, kind: 'creative.discover', targetId, source: null, reason, taskId: `creative:${reason}:${targetId}:${slot}` }
  await c.env.CREATIVE_DISCOVERY.send(message, { contentType: 'json' })
  await c.var.db.prepare("UPDATE ad_collection_targets SET status='pending',next_collect_at=datetime('now','+7 days'),updated_at=? WHERE id=?").bind(nowIso(), targetId).run()
}

export async function scheduleCreativeDiscovery(c: CreativeContext, appId: number) {
  if (String(c.env.CREATIVES_ENABLED) !== 'true') return
  const target = await ensureTarget(c, appId)
  if (!target || target.last_collected_at || target.status === 'running') return
  const message: JobMessage = { v: 1, kind: 'creative.discover', targetId: target.id, source: null, reason: 'discovery', taskId: `creative:discovery:${target.id}` }
  await c.env.CREATIVE_DISCOVERY.send(message, { contentType: 'json' })
  await c.var.db.prepare("UPDATE ad_collection_targets SET status='pending',updated_at=? WHERE id=?").bind(nowIso(), target.id).run()
}

creatives.get('/creatives', (c) => listCreatives(c))
creatives.get('/creatives/:id', async (c) => {
  const detail = await creativeDetail(c.var.db, Number(c.req.param('id')))
  return detail ? c.json(detail) : c.json({ message: 'Not found.' }, 404)
})
creatives.get('/ad-advertisers/:id/creatives', async (c) => {
  if (!(await first(c.var.db, 'SELECT id FROM ad_advertisers WHERE id=?', Number(c.req.param('id'))))) return c.json({ message: 'Not found.' }, 404)
  return listCreatives(c, { advertiserId: Number(c.req.param('id')) })
})
creatives.get('/apps/:platform/:externalId/creatives', async (c) => {
  const app = await first<{ id: number }>(c.var.db, 'SELECT id FROM apps WHERE platform=? AND external_id=?', c.req.param('platform'), c.req.param('externalId'))
  if (!app) return c.json({ message: 'Not found.' }, 404)
  const target = await ensureTarget(c, app.id)
  const stale = !target?.last_collected_at || Date.parse(target.last_collected_at) < Date.now() - 7 * 86_400_000
  if (target && stale && String(c.env.CREATIVES_ENABLED) === 'true' && target.status !== 'pending' && target.status !== 'running') c.executionCtx.waitUntil(enqueueTarget(c, target.id, 'viewed'))
  const response = await listCreatives(c, { appId: app.id })
  response.headers.set('x-openapps-creative-sync-status', String(c.env.CREATIVES_ENABLED) !== 'true' ? 'disabled' : target?.status ?? 'unavailable')
  return response
})
creatives.post('/apps/:platform/:externalId/creatives/sync', async (c) => {
  if (String(c.env.CREATIVES_ENABLED) !== 'true') return c.json({ message: 'Creative collection is disabled during staged rollout.', status: 'disabled' }, 503)
  const app = await first<{ id: number }>(c.var.db, 'SELECT id FROM apps WHERE platform=? AND external_id=?', c.req.param('platform'), c.req.param('externalId'))
  if (!app) return c.json({ message: 'Not found.' }, 404)
  const target = await ensureTarget(c, app.id)
  if (!target) return c.json({ message: 'This app has no publisher collection target.' }, 422)
  if (target.status !== 'running') await enqueueTarget(c, target.id, 'manual')
  return c.json({ status: target.status === 'running' ? 'running' : 'queued', target_id: target.id }, 202)
})

creatives.get('/creative-assets/:sha256', async (c) => {
  const sha256 = c.req.param('sha256')
  if (!/^[a-f0-9]{64}$/.test(sha256)) return c.json({ message: 'Not found.' }, 404)
  const asset = await first<{ r2_key: string; mime_type: string; byte_size: number }>(c.var.db, 'SELECT r2_key,mime_type,byte_size FROM ad_assets WHERE sha256=?', sha256)
  if (!asset) return c.json({ message: 'Not found.' }, 404)
  const range = c.req.header('range')
  const headers = range ? new Headers({ range }) : undefined
  const object = await c.env.CREATIVES.get(asset.r2_key, headers ? { range: headers } : {})
  if (!object?.body) return c.json({ message: 'Not found.' }, 404)
  const responseHeaders = new Headers({ 'content-type': asset.mime_type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', etag: object.httpEtag })
  if (object.range) {
    const offset = 'suffix' in object.range ? Math.max(0, asset.byte_size - object.range.suffix) : object.range.offset ?? 0
    const length = 'suffix' in object.range ? object.range.suffix : object.range.length ?? asset.byte_size - offset
    responseHeaders.set('content-range', `bytes ${offset}-${offset + length - 1}/${asset.byte_size}`)
    responseHeaders.set('content-length', String(length))
    return new Response(object.body, { status: 206, headers: responseHeaders })
  }
  responseHeaders.set('content-length', String(asset.byte_size))
  return new Response(object.body, { headers: responseHeaders })
})

export default creatives
