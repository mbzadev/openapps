import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  all, authenticateRequest, clearSessionCookie, first, hashPassword, issueToken, jsonValue,
  nowIso, sessionCookie, verifyPassword, type AuthContext, type Database, type JobMessage, type Platform,
} from '@openapps/core'
import { persistStoreApp, scraperFor } from '@openapps/scrapers'
import { appDetailResource, appResource, appSelect, findAppResource } from './resources.js'
import type { Env, Variables } from './env.js'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
const platformSchema = z.enum(['ios', 'android'])
const colors = new Set(['slate', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'])

app.use('*', async (c, next) => {
  const bookmark = c.req.header('x-d1-bookmark') ?? 'first-unconstrained'
  const session = c.env.DB.withSession(bookmark)
  c.set('db', session)
  await next()
  const nextBookmark = session.getBookmark()
  if (nextBookmark) c.header('x-d1-bookmark', nextBookmark)
})

function validation(errors: Record<string, string[]>) {
  return { message: 'The given data was invalid.', errors }
}

function userResource(user: AuthContext['user']) {
  return { id: user.id, name: user.name, email: user.email, created_at: user.created_at, updated_at: user.updated_at }
}

function int(value: string | undefined, fallback: number, max = 100) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback
}

function page<T>(data: T[], currentPage: number, perPage: number, total: number) {
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  return {
    data,
    links: { first: null, last: null, prev: currentPage > 1 ? `?page=${currentPage - 1}` : null, next: currentPage < lastPage ? `?page=${currentPage + 1}` : null },
    meta: { current_page: currentPage, from: total ? (currentPage - 1) * perPage + 1 : null, last_page: lastPage, path: '', per_page: perPage, to: total ? Math.min(currentPage * perPage, total) : null, total },
  }
}

function queueFor(env: Env, platform: Platform, onDemand = true) {
  if (onDemand) return platform === 'ios' ? env.SYNC_ON_DEMAND_IOS : env.SYNC_ON_DEMAND_ANDROID
  return platform === 'ios' ? env.SYNC_TRACKED_IOS : env.SYNC_TRACKED_ANDROID
}

async function resolveApp(db: Database, platform: string, externalId: string) {
  return first<{ id: number }>(db, 'SELECT id FROM apps WHERE platform = ? AND external_id = ?', platform, externalId)
}

async function enqueueSync(env: Env, platform: Platform, externalId: string, appId: number, source: 'api' | 'mcp' | 'cron' = 'api') {
  const now = nowIso()
  const taskId = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO sync_statuses
    (app_id, status, current_step, progress_done, progress_total, job_id, created_at, updated_at)
    VALUES (?, 'pending', 'queued', 0, 1, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET status='pending', current_step='queued', progress_done=0,
      progress_total=1, error_message=NULL, job_id=excluded.job_id, updated_at=excluded.updated_at`)
    .bind(appId, taskId, now, now).run()
  const message: JobMessage = { v: 1, kind: 'app.sync', taskId, platform, appId, source: source === 'cron' ? 'scheduled' : 'on-demand' }
  await queueFor(env, platform).send(message, { contentType: 'json' })
  return taskId
}

app.post('/auth/register', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  if (!(await c.env.AUTH_RATE_LIMITER.limit({ key: `register:${ip}` })).success) return c.json({ message: 'Too Many Attempts.' }, 429)
  const parsed = z.object({ name: z.string().trim().min(1).max(255), email: z.email(), password: z.string().min(8), password_confirmation: z.string() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  if (parsed.data.password !== parsed.data.password_confirmation) return c.json(validation({ password: ['The password confirmation does not match.'] }), 422)
  if (await first(c.var.db, 'SELECT id FROM users WHERE email = ? COLLATE NOCASE', parsed.data.email)) return c.json(validation({ email: ['The email has already been taken.'] }), 422)
  const now = nowIso()
  const passwordHash = await hashPassword(parsed.data.password)
  const created = await c.var.db.prepare('INSERT INTO users (name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(parsed.data.name, parsed.data.email.toLowerCase(), passwordHash, now, now).first<{ id: number }>()
  if (!created) return c.json({ message: 'Account creation failed.' }, 500)
  const token = await issueToken(c.var.db, created.id, 'browser-session', ['*'], null)
  c.header('Set-Cookie', sessionCookie(token.plainTextToken))
  return c.json({ user: { id: created.id, name: parsed.data.name, email: parsed.data.email.toLowerCase(), created_at: now, updated_at: now }, token: token.plainTextToken }, 201)
})

app.post('/auth/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  if (!(await c.env.AUTH_RATE_LIMITER.limit({ key: `login:${ip}` })).success) return c.json({ message: 'Too Many Attempts.' }, 429)
  const parsed = z.object({ email: z.email(), password: z.string() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const user = await first<AuthContext['user'] & { password_hash: string }>(c.var.db, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', parsed.data.email)
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) return c.json({ message: 'Invalid credentials' }, 401)
  await c.var.db.prepare("DELETE FROM personal_access_tokens WHERE user_id = ? AND name = 'browser-session'").bind(user.id).run()
  const token = await issueToken(c.var.db, user.id, 'browser-session', ['*'], null)
  c.header('Set-Cookie', sessionCookie(token.plainTextToken))
  return c.json({ user: userResource(user), token: token.plainTextToken })
})

app.get('/health', (c) => c.json({ status: 'ok', service: 'openapps-web', time: nowIso() }))

app.use('*', async (c, next) => {
  const auth = await authenticateRequest(c.var.db, c.req.raw)
  if (!auth) return c.json({ message: 'Unauthenticated.' }, 401)
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  if (!(await c.env.API_RATE_LIMITER.limit({ key: `${auth.user.id}:${ip}` })).success) return c.json({ message: 'Too Many Attempts.' }, 429)
  c.set('auth', auth)
  await next()
})

app.get('/auth/me', (c) => c.json(userResource(c.var.auth.user)))
app.post('/auth/logout', async (c) => {
  await c.var.db.prepare('DELETE FROM personal_access_tokens WHERE id = ?').bind(c.var.auth.tokenId).run()
  c.header('Set-Cookie', clearSessionCookie())
  return c.body(null, 204)
})

app.get('/account/profile', (c) => c.json(userResource(c.var.auth.user)))
app.patch('/account/profile', async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(255), email: z.email().max(255) }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const name = parsed.data.name ?? c.var.auth.user.name
  const email = (parsed.data.email ?? c.var.auth.user.email).toLowerCase()
  const duplicate = await first<{ id: number }>(c.var.db, 'SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?', email, c.var.auth.user.id)
  if (duplicate) return c.json(validation({ email: ['The email has already been taken.'] }), 422)
  const now = nowIso()
  await c.var.db.prepare('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?').bind(name, email, now, c.var.auth.user.id).run()
  return c.json({ ...userResource(c.var.auth.user), name, email, updated_at: now })
})
app.delete('/account/profile', async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({})) as { password?: string }
  const row = await first<{ password_hash: string }>(c.var.db, 'SELECT password_hash FROM users WHERE id = ?', c.var.auth.user.id)
  if (!row || !body.password || !(await verifyPassword(body.password, row.password_hash))) return c.json(validation({ password: ['The password is incorrect.'] }), 422)
  await c.var.db.prepare('DELETE FROM users WHERE id = ?').bind(c.var.auth.user.id).run()
  c.header('Set-Cookie', clearSessionCookie())
  return c.body(null, 204)
})
app.put('/account/password', async (c) => {
  const parsed = z.object({ current_password: z.string(), password: z.string().min(8), password_confirmation: z.string() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  if (parsed.data.password !== parsed.data.password_confirmation) return c.json(validation({ password: ['The password confirmation does not match.'] }), 422)
  const row = await first<{ password_hash: string }>(c.var.db, 'SELECT password_hash FROM users WHERE id = ?', c.var.auth.user.id)
  if (!row || !(await verifyPassword(parsed.data.current_password, row.password_hash))) return c.json(validation({ current_password: ['The password is incorrect.'] }), 422)
  await c.var.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(await hashPassword(parsed.data.password), nowIso(), c.var.auth.user.id).run()
  return c.json({ message: 'Password updated successfully.' })
})

app.get('/account/api-tokens', async (c) => c.json((await all<{ id: number; name: string; abilities: string; last_used_at: string | null; created_at: string }>(c.var.db,
  "SELECT id, name, abilities, last_used_at, created_at FROM personal_access_tokens WHERE user_id = ? AND name != 'browser-session' ORDER BY created_at DESC", c.var.auth.user.id))
  .map((t) => ({ ...t, abilities: jsonValue(t.abilities, []) }))))
app.post('/account/api-tokens', async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(255), abilities: z.array(z.string()).optional() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const issued = await issueToken(c.var.db, c.var.auth.user.id, parsed.data.name, parsed.data.abilities ?? ['openapps:read', 'openapps:write'], null)
  return c.json({ id: issued.id, name: parsed.data.name, token: issued.plainTextToken, created_at: nowIso() }, 201)
})
app.delete('/account/api-tokens/:tokenId', async (c) => {
  const tokenId = Number(c.req.param('tokenId'))
  const token = await first<{ id: number }>(c.var.db, "SELECT id FROM personal_access_tokens WHERE id = ? AND user_id = ? AND name != 'browser-session'", tokenId, c.var.auth.user.id)
  if (!token) return c.json({ message: 'Not found.' }, 404)
  await c.var.db.prepare('DELETE FROM personal_access_tokens WHERE id = ?').bind(tokenId).run()
  return c.body(null, 204)
})

app.get('/folders', async (c) => c.json(await all(c.var.db, `SELECT f.id, f.name, f.color, f.position, COUNT(ua.app_id) AS apps_count, f.created_at, f.updated_at
  FROM folders f LEFT JOIN user_apps ua ON ua.folder_id=f.id WHERE f.user_id=? GROUP BY f.id ORDER BY f.position, f.name`, c.var.auth.user.id)))
app.post('/folders', async (c) => {
  const body = await c.req.json<{ name?: string; color?: string }>().catch(() => ({})) as { name?: string; color?: string }
  if (!body.name?.trim()) return c.json(validation({ name: ['The name field is required.'] }), 422)
  const color = colors.has(body.color ?? '') ? body.color! : 'slate'
  const now = nowIso()
  try {
    const row = await c.var.db.prepare(`INSERT INTO folders (user_id,name,color,position,created_at,updated_at)
      VALUES (?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM folders WHERE user_id=?),?,?) RETURNING *`)
      .bind(c.var.auth.user.id, body.name.trim(), color, c.var.auth.user.id, now, now).first()
    return c.json({ ...row, apps_count: 0 }, 201)
  } catch { return c.json(validation({ name: ['The name has already been taken.'] }), 422) }
})
app.patch('/folders/:folder', async (c) => {
  const body = await c.req.json<{ name?: string; color?: string; position?: number }>().catch(() => ({})) as { name?: string; color?: string; position?: number }
  const current = await first<Record<string, unknown>>(c.var.db, 'SELECT * FROM folders WHERE id=? AND user_id=?', Number(c.req.param('folder')), c.var.auth.user.id)
  if (!current) return c.json({ message: 'Not found.' }, 404)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : current.name
  const color = body.color && colors.has(body.color) ? body.color : current.color
  const position = Number.isInteger(body.position) ? body.position : current.position
  await c.var.db.prepare('UPDATE folders SET name=?,color=?,position=?,updated_at=? WHERE id=? AND user_id=?')
    .bind(name, color, position, nowIso(), Number(c.req.param('folder')), c.var.auth.user.id).run()
  return c.json({ ...current, name, color, position, updated_at: nowIso() })
})
app.delete('/folders/:folder', async (c) => {
  await c.var.db.prepare('DELETE FROM folders WHERE id=? AND user_id=?').bind(Number(c.req.param('folder')), c.var.auth.user.id).run()
  return c.body(null, 204)
})

app.get('/apps/search', async (c) => {
  const term = (c.req.query('q') ?? '').trim()
  const parsed = platformSchema.safeParse(c.req.query('platform') ?? 'ios')
  if (!term || !parsed.success) return c.json(validation({ q: ['The q field is required.'] }), 422)
  const results = await scraperFor(parsed.data).search(term, c.req.query('country') ?? 'us', int(c.req.query('limit'), 20, 50))
  const searchCountry = c.req.query('country')
  await Promise.all(results.map((result) => persistStoreApp(c.var.db, result, { ...(searchCountry ? { country: searchCountry } : {}), discoveredFrom: 'search' })))
  const tracked = new Set((await all<{ external_id: string }>(c.var.db, `SELECT a.external_id FROM apps a JOIN user_apps ua ON ua.app_id=a.id
    WHERE ua.user_id=? AND a.platform=?`, c.var.auth.user.id, parsed.data)).map((r) => r.external_id))
  return c.json(results.map((r) => ({ ...r, is_tracked: tracked.has(r.external_id), publisher: { name: r.publisher_name, external_id: r.publisher_external_id }, category: r.category ? { name: r.category, external_id: r.category_id } : null })))
})
app.get('/apps', async (c) => {
  const where = ['ua.user_id = ?']
  const bindings: unknown[] = [c.var.auth.user.id]
  if (c.req.query('platform')) { where.push('a.platform = ?'); bindings.push(c.req.query('platform')) }
  if (c.req.query('folder_id')) { where.push('ua.folder_id = ?'); bindings.push(Number(c.req.query('folder_id'))) }
  if (c.req.query('search')) { where.push('(a.display_name LIKE ? OR a.external_id LIKE ?)'); bindings.push(`%${c.req.query('search')}%`, `%${c.req.query('search')}%`) }
  const rows = await all<Record<string, unknown>>(c.var.db, `${appSelect} JOIN user_apps ua ON ua.app_id=a.id WHERE ${where.join(' AND ')} ORDER BY ua.created_at DESC`, c.var.auth.user.id, ...bindings)
  return c.json(rows.map((r) => appResource(r as never)))
})
app.post('/apps', async (c) => {
  const parsed = z.object({ platform: platformSchema, external_id: z.string().min(1), country: z.string().length(2).optional() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const store = await scraperFor(parsed.data.platform).lookup(parsed.data.external_id, parsed.data.country)
  await persistStoreApp(c.var.db, store, { ...(parsed.data.country ? { country: parsed.data.country } : {}), discoveredFrom: 'manual' })
  const resource = await findAppResource(c.var.db, c.var.auth, parsed.data.platform, parsed.data.external_id)
  return c.json(resource, 201)
})
app.get('/apps/:platform/:externalId', async (c) => {
  const detail = await appDetailResource(c.var.db, c.var.auth, c.req.param('platform'), c.req.param('externalId'))
  return detail ? c.json(detail) : c.json({ message: 'Not found.' }, 404)
})
app.get('/apps/:platform/:externalId/listing', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const locale = c.req.query('locale') ?? 'en-US'
  const row = await first<Record<string, unknown>>(c.var.db, 'SELECT * FROM app_store_listings WHERE app_id=? AND locale=? ORDER BY id DESC LIMIT 1', target.id, locale)
  return row ? c.json({ ...row, screenshots: jsonValue(row.screenshots as string, []) }) : c.json({ message: 'Not found.' }, 404)
})
app.post('/apps/:platform/:externalId/track', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  let target = await resolveApp(c.var.db, platform, c.req.param('externalId'))
  if (!target) {
    const store = await scraperFor(platform).lookup(c.req.param('externalId'))
    target = { id: await persistStoreApp(c.var.db, store, { discoveredFrom: 'tracking' }) }
  }
  await c.var.db.prepare('INSERT OR IGNORE INTO user_apps (user_id,app_id,created_at) VALUES (?,?,?)').bind(c.var.auth.user.id, target.id, nowIso()).run()
  return c.json({ message: 'App tracked successfully.' }, 201)
})
app.delete('/apps/:platform/:externalId/track', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (target) await c.var.db.prepare('DELETE FROM user_apps WHERE user_id=? AND app_id=?').bind(c.var.auth.user.id, target.id).run()
  return c.body(null, 204)
})
app.patch('/apps/:platform/:externalId/folder', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const body = await c.req.json<{ folder_id?: number | null }>().catch(() => ({})) as { folder_id?: number | null }
  if (body.folder_id && !(await first(c.var.db, 'SELECT id FROM folders WHERE id=? AND user_id=?', body.folder_id, c.var.auth.user.id))) return c.json(validation({ folder_id: ['The selected folder is invalid.'] }), 422)
  await c.var.db.prepare('UPDATE user_apps SET folder_id=? WHERE user_id=? AND app_id=?').bind(body.folder_id ?? null, c.var.auth.user.id, target.id).run()
  return c.json({ message: 'App moved successfully.' })
})
app.post('/apps/:platform/:externalId/sync', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const target = await resolveApp(c.var.db, platform, c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  return c.json({ message: 'Sync queued.', job_id: await enqueueSync(c.env, platform, c.req.param('externalId'), target.id) }, 202)
})
app.get('/apps/:platform/:externalId/sync-status', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const status = await first<Record<string, unknown>>(c.var.db, 'SELECT * FROM sync_statuses WHERE app_id=?', target.id)
  return c.json(status ? { ...status, progress: { done: status.progress_done, total: status.progress_total } } : { status: 'idle', current_step: null, progress: { done: 0, total: 0 }, failed_items: [] })
})

app.get('/apps/:platform/:externalId/competitors', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json([])
  return c.json(await all(c.var.db, `SELECT ac.id, ac.relationship, ac.created_at, ca.id AS app_id, ca.display_name AS name,
    ca.platform, ca.external_id, ca.icon_url FROM app_competitors ac JOIN apps ca ON ca.id=ac.competitor_app_id
    WHERE ac.user_id=? AND ac.app_id=? ORDER BY ac.created_at DESC`, c.var.auth.user.id, target.id))
})
app.post('/apps/:platform/:externalId/competitors', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  const parsed = z.object({ competitor_platform: platformSchema, competitor_external_id: z.string(), relationship: z.string().optional() }).safeParse(await c.req.json().catch(() => ({})))
  if (!target || !parsed.success) return c.json(validation({ competitor_external_id: ['Invalid competitor.'] }), 422)
  let competitor = await resolveApp(c.var.db, parsed.data.competitor_platform, parsed.data.competitor_external_id)
  if (!competitor) competitor = { id: await persistStoreApp(c.var.db, await scraperFor(parsed.data.competitor_platform).lookup(parsed.data.competitor_external_id), { discoveredFrom: 'competitor' }) }
  if (target.id === competitor.id) return c.json(validation({ competitor_external_id: ['An app cannot compete with itself.'] }), 422)
  const now = nowIso()
  await c.var.db.prepare(`INSERT INTO app_competitors (user_id,app_id,competitor_app_id,relationship,created_at,updated_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,app_id,competitor_app_id) DO UPDATE SET relationship=excluded.relationship,updated_at=excluded.updated_at`)
    .bind(c.var.auth.user.id, target.id, competitor.id, parsed.data.relationship ?? 'direct', now, now).run()
  return c.json({ message: 'Competitor added successfully.' }, 201)
})
app.delete('/apps/:platform/:externalId/competitors/:competitor', async (c) => {
  await c.var.db.prepare('DELETE FROM app_competitors WHERE id=? AND user_id=?').bind(Number(c.req.param('competitor')), c.var.auth.user.id).run()
  return c.body(null, 204)
})
app.get('/competitors', async (c) => c.json(await all(c.var.db, `SELECT ac.id, ac.relationship, ac.created_at,
  a.display_name AS parent_name, a.platform AS parent_platform, a.external_id AS parent_external_id,
  ca.display_name AS competitor_name, ca.platform AS competitor_platform, ca.external_id AS competitor_external_id, ca.icon_url
  FROM app_competitors ac JOIN apps a ON a.id=ac.app_id JOIN apps ca ON ca.id=ac.competitor_app_id
  WHERE ac.user_id=? ORDER BY ac.created_at DESC`, c.var.auth.user.id)))

function words(text: string, n: number) {
  const tokens = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const counts = new Map<string, number>()
  for (let i = 0; i <= tokens.length - n; i++) { const key = tokens.slice(i, i + n).join(' '); counts.set(key, (counts.get(key) ?? 0) + 1) }
  return [...counts].map(([keyword, count]) => ({ keyword, count, density: tokens.length ? (count * n * 100) / tokens.length : 0 })).sort((a, b) => b.count - a.count)
}
app.get('/apps/:platform/:externalId/keywords', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json(page([], 1, 25, 0))
  const listing = await first<{ title: string; subtitle: string | null; description: string }>(c.var.db, 'SELECT title,subtitle,description FROM app_store_listings WHERE app_id=? ORDER BY id DESC LIMIT 1', target.id)
  const density = words(`${listing?.title ?? ''} ${listing?.subtitle ?? ''} ${listing?.description ?? ''}`, int(c.req.query('ngram'), 1, 3))
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 25, 100)
  return c.json(page(density.slice((p - 1) * per, p * per), p, per, density.length))
})
app.get('/apps/:platform/:externalId/keywords/compare', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ apps: [], keywords: {} })
  const listings = await all<{ id: number; title: string; subtitle: string | null; description: string }>(c.var.db, 'SELECT id,title,subtitle,description FROM app_store_listings WHERE app_id=? ORDER BY id DESC LIMIT 5', target.id)
  return c.json({ apps: listings.map((l) => ({ id: l.id })), keywords: Object.fromEntries(listings.map((l) => [String(l.id), words(`${l.title} ${l.subtitle ?? ''} ${l.description}`, int(c.req.query('ngram'), 1, 3)).slice(0, 50)])) })
})
app.get('/apps/:platform/:externalId/ratings/summary', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  const row = target ? await first<Record<string, unknown>>(c.var.db, `SELECT rating, rating_count, rating_breakdown, date FROM app_metrics WHERE app_id=? ORDER BY date DESC LIMIT 1`, target.id) : null
  return c.json(row ? { ...row, rating_breakdown: jsonValue(row.rating_breakdown as string | null, {}), trend: null } : { rating: 0, rating_count: 0, rating_breakdown: {}, trend: null })
})
app.get('/apps/:platform/:externalId/ratings/history', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  return c.json(target ? await all(c.var.db, 'SELECT date,rating,rating_count,rating_breakdown,country_code FROM app_metrics WHERE app_id=? ORDER BY date', target.id) : [])
})
app.get('/apps/:platform/:externalId/ratings/country-breakdown', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  return c.json(target ? await all(c.var.db, `SELECT m.country_code, c.name AS country_name, m.rating, m.rating_count, m.date
    FROM app_metrics m JOIN countries c ON c.code=m.country_code WHERE m.app_id=? GROUP BY m.country_code HAVING m.date=MAX(m.date)`, target.id) : [])
})
app.get('/apps/:platform/:externalId/rankings', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  return c.json(target ? await all(c.var.db, `SELECT tc.snapshot_date AS date, tce.rank, tc.collection, tc.country_code,
    sc.id AS category_id, sc.name AS category_name FROM trending_chart_entries tce
    JOIN trending_charts tc ON tc.id=tce.trending_chart_id JOIN store_categories sc ON sc.id=tc.category_id
    WHERE tce.app_id=? ORDER BY tc.snapshot_date DESC`, target.id) : [])
})

app.get('/dashboard', async (c) => {
  const [tracked, competitors, changes, recent] = await Promise.all([
    first<{ count: number }>(c.var.db, 'SELECT COUNT(*) AS count FROM user_apps WHERE user_id=?', c.var.auth.user.id),
    first<{ count: number }>(c.var.db, 'SELECT COUNT(*) AS count FROM app_competitors WHERE user_id=?', c.var.auth.user.id),
    first<{ count: number }>(c.var.db, `SELECT COUNT(*) AS count FROM app_store_listing_changes lc JOIN user_apps ua ON ua.app_id=lc.app_id WHERE ua.user_id=?`, c.var.auth.user.id),
    all(c.var.db, `SELECT lc.*,a.display_name AS app_name,a.platform,a.external_id FROM app_store_listing_changes lc
      JOIN apps a ON a.id=lc.app_id JOIN user_apps ua ON ua.app_id=a.id WHERE ua.user_id=? ORDER BY lc.detected_at DESC LIMIT 10`, c.var.auth.user.id),
  ])
  return c.json({ tracked_apps_count: tracked?.count ?? 0, competitors_count: competitors?.count ?? 0, changes_count: changes?.count ?? 0, recent_changes: recent, build_status_counts: {} })
})

async function changes(c: Context<{ Bindings: Env; Variables: Variables }>, competitor: boolean) {
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 20, 100)
  const join = competitor ? 'JOIN app_competitors ac ON ac.competitor_app_id=lc.app_id AND ac.user_id=?' : 'JOIN user_apps ua ON ua.app_id=lc.app_id AND ua.user_id=?'
  const rows = await all<Record<string, unknown>>(c.var.db, `SELECT lc.*,a.display_name AS app_name,a.platform,a.external_id,a.icon_url
    FROM app_store_listing_changes lc JOIN apps a ON a.id=lc.app_id ${join} ORDER BY lc.detected_at DESC LIMIT ? OFFSET ?`, c.var.auth.user.id, per, (p - 1) * per)
  const total = (await first<{ count: number }>(c.var.db, `SELECT COUNT(*) AS count FROM app_store_listing_changes lc ${join}`, c.var.auth.user.id))?.count ?? 0
  return c.json(page(rows, p, per, total))
}
app.get('/changes/apps', (c) => changes(c, false))
app.get('/changes/competitors', (c) => changes(c, true))

app.get('/countries', async (c) => c.json((await all<Record<string, unknown>>(c.var.db, 'SELECT * FROM countries ORDER BY priority DESC,name')).map((r) => ({ ...r, ios_languages: jsonValue(r.ios_languages as string, []), android_languages: jsonValue(r.android_languages as string, []) }))))
app.get('/store-categories', async (c) => {
  const where: string[] = [], bind: unknown[] = []
  if (c.req.query('platform')) { where.push('platform=?'); bind.push(c.req.query('platform')) }
  if (c.req.query('type')) { where.push('type=?'); bind.push(c.req.query('type')) }
  return c.json(await all(c.var.db, `SELECT * FROM store_categories ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY priority DESC,name`, ...bind))
})
app.get('/charts', async (c) => {
  const platform = c.req.query('platform') ?? 'ios', collection = c.req.query('collection') ?? 'top_free', country = c.req.query('country') ?? 'us'
  const rows = await all(c.var.db, `SELECT tce.rank,a.display_name AS name,a.external_id,a.icon_url,a.platform,tce.price,tce.currency,
    p.name AS publisher,tc.snapshot_date FROM trending_chart_entries tce JOIN trending_charts tc ON tc.id=tce.trending_chart_id
    JOIN apps a ON a.id=tce.app_id LEFT JOIN publishers p ON p.id=a.publisher_id
    WHERE tc.platform=? AND tc.collection=? AND tc.country_code=? AND tc.snapshot_date=(SELECT MAX(snapshot_date) FROM trending_charts WHERE platform=? AND collection=? AND country_code=?) ORDER BY tce.rank`, platform, collection, country, platform, collection, country)
  return c.json({ data: rows, meta: { platform, collection, country } })
})
app.get('/explorer/icons', async (c) => {
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 40, 100)
  const rows = await all(c.var.db, 'SELECT id,platform,external_id,display_name AS name,icon_url FROM apps WHERE icon_url IS NOT NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?', per, (p - 1) * per)
  const total = (await first<{ count: number }>(c.var.db, 'SELECT COUNT(*) AS count FROM apps WHERE icon_url IS NOT NULL'))?.count ?? 0
  return c.json(page(rows, p, per, total))
})
app.get('/explorer/screenshots', async (c) => {
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 20, 100)
  const rows = await all<Record<string, unknown>>(c.var.db, `SELECT a.id,a.platform,a.external_id,a.display_name AS name,a.icon_url,l.screenshots
    FROM apps a JOIN app_store_listings l ON l.app_id=a.id WHERE json_array_length(l.screenshots)>0 ORDER BY l.fetched_at DESC LIMIT ? OFFSET ?`, per, (p - 1) * per)
  return c.json(page(rows.map((r) => ({ ...r, screenshots: jsonValue(r.screenshots as string, []) })), p, per, rows.length))
})

app.get('/publishers/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim(), platform = platformSchema.parse(c.req.query('platform') ?? 'ios')
  const local = await all(c.var.db, `SELECT p.*,COUNT(a.id) AS apps_count FROM publishers p LEFT JOIN apps a ON a.publisher_id=p.id
    WHERE p.platform=? AND p.name LIKE ? GROUP BY p.id ORDER BY apps_count DESC LIMIT 30`, platform, `%${q}%`)
  if (local.length) return c.json(local)
  const discovered = await scraperFor(platform).search(q, c.req.query('country') ?? 'us', 30)
  return c.json([...new Map(discovered.map((r) => [r.publisher_external_id ?? r.publisher_name, { platform, external_id: r.publisher_external_id ?? r.publisher_name, name: r.publisher_name, sample_apps: [r] }])).values()])
})
app.get('/publishers', async (c) => c.json(await all(c.var.db, `SELECT p.*,COUNT(a.id) AS apps_count FROM publishers p
  JOIN apps a ON a.publisher_id=p.id JOIN user_apps ua ON ua.app_id=a.id WHERE ua.user_id=? GROUP BY p.id ORDER BY p.name`, c.var.auth.user.id)))
app.get('/publishers/:platform/:externalId', async (c) => {
  const row = await first<Record<string, unknown>>(c.var.db, `SELECT p.*,COUNT(a.id) AS apps_count FROM publishers p LEFT JOIN apps a ON a.publisher_id=p.id
    WHERE p.platform=? AND p.external_id=? GROUP BY p.id`, c.req.param('platform'), decodeURIComponent(c.req.param('externalId')))
  return row ? c.json(row) : c.json({ message: 'Not found.' }, 404)
})
app.get('/publishers/:platform/:externalId/store-apps', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const results = await scraperFor(platform).developerApps(decodeURIComponent(c.req.param('externalId')), c.req.query('country') ?? 'us')
  return c.json(results)
})
app.post('/publishers/:platform/:externalId/import', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const body = await c.req.json<{ external_ids?: string[] }>().catch(() => ({})) as { external_ids?: string[] }
  const ids = body.external_ids ?? (await scraperFor(platform).developerApps(decodeURIComponent(c.req.param('externalId')))).map((r) => r.external_id)
  let imported = 0
  for (const id of ids.slice(0, 100)) { const store = await scraperFor(platform).lookup(id); await persistStoreApp(c.var.db, store, { discoveredFrom: 'publisher' }); imported++ }
  return c.json({ message: 'Publisher apps imported.', imported }, 202)
})

export default app
