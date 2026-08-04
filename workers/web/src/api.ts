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
  return { id: user.id, name: user.name, email: user.email, email_verified_at: user.email_verified_at, created_at: user.created_at, updated_at: user.updated_at }
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

async function enqueueSync(env: Env, platform: Platform, externalId: string, appId: number, source: 'api' | 'mcp' | 'cron' = 'api', db: Database = env.DB) {
  const now = nowIso()
  const taskId = crypto.randomUUID()
  await db.prepare(`INSERT INTO sync_statuses
    (app_id, status, current_step, progress_done, progress_total, job_id, created_at, updated_at)
    VALUES (?, 'pending', 'queued', 0, 1, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET status='pending', current_step='queued', progress_done=0,
      progress_total=1, error_message=NULL, job_id=excluded.job_id, updated_at=excluded.updated_at`)
    .bind(appId, taskId, now, now).run()
  const message: JobMessage = { v: 1, kind: 'app.sync', taskId, platform, appId, source: source === 'cron' ? 'scheduled' : 'on-demand' }
  await queueFor(env, platform).send(message, { contentType: 'json' })
  return taskId
}

function syncResource(row: Record<string, unknown>) {
  const status = row.status === 'pending' ? 'queued' : row.status === 'running' ? 'processing' : row.status
  let elapsedMs: number | null = null
  if (row.started_at) elapsedMs = Math.max(0, Date.parse(String(row.completed_at ?? nowIso())) - Date.parse(String(row.started_at)))
  return {
    app_id: row.app_id, status, current_step: row.current_step,
    progress: { done: row.progress_done, total: row.progress_total }, failed_items: [], failed_items_count: 0,
    error_message: row.error_message, job_id: row.job_id, started_at: row.started_at, completed_at: row.completed_at,
    next_retry_at: row.next_retry_at, elapsed_ms: elapsedMs,
  }
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
  const token = await issueToken(c.var.db, created.id, 'auth-token', ['*'], null)
  c.header('Set-Cookie', sessionCookie(token.plainTextToken))
  return c.json({ user: { id: created.id, name: parsed.data.name, email: parsed.data.email.toLowerCase(), email_verified_at: null, created_at: now, updated_at: now }, token: token.plainTextToken }, 201)
})

app.post('/auth/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  if (!(await c.env.AUTH_RATE_LIMITER.limit({ key: `login:${ip}` })).success) return c.json({ message: 'Too Many Attempts.' }, 429)
  const parsed = z.object({ email: z.email(), password: z.string() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const user = await first<AuthContext['user'] & { password_hash: string }>(c.var.db, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', parsed.data.email)
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) return c.json({ message: 'Invalid credentials' }, 401)
  await c.var.db.prepare("DELETE FROM personal_access_tokens WHERE user_id = ? AND name IN ('auth-token','browser-session')").bind(user.id).run()
  const token = await issueToken(c.var.db, user.id, 'auth-token', ['*'], null)
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
  const parsed = z.object({ name: z.string().trim().min(1).max(255), email: z.email().max(255) })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const name = parsed.data.name
  const email = parsed.data.email.toLowerCase()
  const duplicate = await first<{ id: number }>(c.var.db, 'SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?', email, c.var.auth.user.id)
  if (duplicate) return c.json(validation({ email: ['The email has already been taken.'] }), 422)
  const now = nowIso()
  const emailChanged = email !== c.var.auth.user.email.toLowerCase()
  await c.var.db.prepare('UPDATE users SET name = ?, email = ?, email_verified_at = CASE WHEN ? THEN NULL ELSE email_verified_at END, updated_at = ? WHERE id = ?')
    .bind(name, email, emailChanged ? 1 : 0, now, c.var.auth.user.id).run()
  return c.json({ ...userResource(c.var.auth.user), name, email, email_verified_at: emailChanged ? null : c.var.auth.user.email_verified_at, updated_at: now })
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
  "SELECT id, name, abilities, last_used_at, created_at FROM personal_access_tokens WHERE user_id = ? AND name NOT IN ('auth-token','browser-session') ORDER BY created_at DESC", c.var.auth.user.id))
  .map((t) => ({ ...t, abilities: jsonValue(t.abilities, []) }))))
app.post('/account/api-tokens', async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(255), abilities: z.array(z.string()).optional() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const issued = await issueToken(c.var.db, c.var.auth.user.id, parsed.data.name, parsed.data.abilities ?? ['openapps:read', 'openapps:write'], null)
  const createdAt = nowIso()
  return c.json({
    token: { id: issued.id, name: parsed.data.name, abilities: parsed.data.abilities ?? ['openapps:read', 'openapps:write'], last_used_at: null, created_at: createdAt },
    plain_text_token: issued.plainTextToken,
  }, 201)
})
app.delete('/account/api-tokens/:tokenId', async (c) => {
  const tokenId = Number(c.req.param('tokenId'))
  const token = await first<{ id: number }>(c.var.db, "SELECT id FROM personal_access_tokens WHERE id = ? AND user_id = ? AND name NOT IN ('auth-token','browser-session')", tokenId, c.var.auth.user.id)
  if (!token) return c.json({ message: 'Not found.' }, 404)
  await c.var.db.prepare('DELETE FROM personal_access_tokens WHERE id = ?').bind(tokenId).run()
  return c.body(null, 204)
})

app.get('/folders', async (c) => c.json(await all(c.var.db, `SELECT f.id,f.name,f.color,f.position AS sort_order,COUNT(ua.app_id) AS apps_count,f.created_at,f.updated_at
  FROM folders f LEFT JOIN user_apps ua ON ua.folder_id=f.id WHERE f.user_id=? GROUP BY f.id ORDER BY f.position DESC,f.id`, c.var.auth.user.id)))
app.post('/folders', async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(255), color: z.string().refine((color) => colors.has(color)), sort_order: z.number().int().optional() })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const color = parsed.data.color
  const now = nowIso()
  try {
    const row = await c.var.db.prepare(`INSERT INTO folders (user_id,name,color,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?) RETURNING id,name,color,position AS sort_order,created_at,updated_at`)
      .bind(c.var.auth.user.id, parsed.data.name, color, parsed.data.sort_order ?? 0, now, now).first()
    return c.json({ ...row, apps_count: 0 }, 201)
  } catch { return c.json(validation({ name: ['The name has already been taken.'] }), 422) }
})
app.patch('/folders/:folder', async (c) => {
  const body = await c.req.json<{ name?: string; color?: string; sort_order?: number; position?: number }>().catch(() => ({})) as { name?: string; color?: string; sort_order?: number; position?: number }
  const current = await first<Record<string, unknown>>(c.var.db, 'SELECT * FROM folders WHERE id=? AND user_id=?', Number(c.req.param('folder')), c.var.auth.user.id)
  if (!current) return c.json({ message: 'Not found.' }, 404)
  if (body.color !== undefined && !colors.has(body.color)) return c.json(validation({ color: ['The selected color is invalid.'] }), 422)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : current.name
  const color = body.color && colors.has(body.color) ? body.color : current.color
  const position = Number.isInteger(body.sort_order) ? body.sort_order : Number.isInteger(body.position) ? body.position : current.position
  try {
    await c.var.db.prepare('UPDATE folders SET name=?,color=?,position=?,updated_at=? WHERE id=? AND user_id=?')
      .bind(name, color, position, nowIso(), Number(c.req.param('folder')), c.var.auth.user.id).run()
  } catch { return c.json(validation({ name: ['The name has already been taken.'] }), 422) }
  return c.json({ id: current.id, name, color, sort_order: position, apps_count: await first(c.var.db, 'SELECT COUNT(*) AS count FROM user_apps WHERE folder_id=?', current.id).then((row) => (row as { count?: number } | null)?.count ?? 0), created_at: current.created_at, updated_at: nowIso() })
})
app.delete('/folders/:folder', async (c) => {
  const result = await c.var.db.prepare('DELETE FROM folders WHERE id=? AND user_id=?').bind(Number(c.req.param('folder')), c.var.auth.user.id).run()
  if ((result.meta.changes ?? 0) === 0) return c.json({ message: 'Not found.' }, 404)
  return c.body(null, 204)
})

app.get('/apps/search', async (c) => {
  const term = (c.req.query('term') ?? c.req.query('q') ?? '').trim()
  const parsed = platformSchema.safeParse(c.req.query('platform') ?? 'ios'), errors: Record<string, string[]> = {}
  if (term.length < 2) errors.term = ['The term field must contain at least 2 characters.']
  if (!parsed.success) errors.platform = ['The selected platform is invalid.']
  if (Object.keys(errors).length) return c.json(validation(errors), 422)
  const country = c.req.query('country_code') ?? c.req.query('country') ?? 'us'
  const platform = parsed.success ? parsed.data : 'ios'
  const results = (await scraperFor(platform).search(term, country, int(c.req.query('limit'), 20, 50))).filter((result) => result.external_id)
  const searchCountry = c.req.query('country_code') ?? c.req.query('country')
  await Promise.all(results.map((result) => persistStoreApp(c.var.db, result, { ...(searchCountry ? { country: searchCountry } : {}), discoveredFrom: 'search' })))
  const tracked = new Set((await all<{ external_id: string }>(c.var.db, `SELECT a.external_id FROM apps a JOIN user_apps ua ON ua.app_id=a.id
    WHERE ua.user_id=? AND a.platform=?`, c.var.auth.user.id, platform)).map((r) => r.external_id))
  const url = new URL(c.req.url), excluded = new Set([...url.searchParams.getAll('exclude_external_ids[]'), ...url.searchParams.getAll('exclude_external_ids')])
  return c.json(results.filter((result) => !excluded.has(result.external_id)).map((r) => ({ ...r, is_tracked: tracked.has(r.external_id), publisher: { name: r.publisher_name, external_id: r.publisher_external_id }, category: r.category ? { name: r.category, external_id: r.category_id } : null })))
})
app.get('/apps', async (c) => {
  if (c.req.query('platform') && !platformSchema.safeParse(c.req.query('platform')).success) return c.json(validation({ platform: ['The selected platform is invalid.'] }), 422)
  if ((c.req.query('search')?.length ?? 0) > 100) return c.json(validation({ search: ['The search field must not be greater than 100 characters.'] }), 422)
  const where = ['ua.user_id = ?']
  const bindings: unknown[] = [c.var.auth.user.id]
  if (c.req.query('platform')) { where.push('a.platform = ?'); bindings.push(c.req.query('platform')) }
  const folderId = c.req.query('folder_id')
  if (folderId === 'unassigned') where.push('ua.folder_id IS NULL')
  else if (folderId) {
    const folder = await first(c.var.db, 'SELECT id FROM folders WHERE id=? AND user_id=?', Number(folderId), c.var.auth.user.id)
    if (!folder) return c.json(validation({ folder_id: ['The selected folder is invalid.'] }), 422)
    where.push('ua.folder_id = ?'); bindings.push(Number(folderId))
  }
  if (c.req.query('search')) { where.push('(a.display_name LIKE ? OR a.external_id LIKE ?)'); bindings.push(`%${c.req.query('search')}%`, `%${c.req.query('search')}%`) }
  const rows = await all<Record<string, unknown>>(c.var.db, `${appSelect} JOIN user_apps ua ON ua.app_id=a.id WHERE ${where.join(' AND ')} ORDER BY ua.created_at DESC`, c.var.auth.user.id, ...bindings)
  return c.json(rows.map((r) => appResource(r as never)))
})
app.post('/apps', async (c) => {
  const parsed = z.object({ platform: platformSchema, external_id: z.string().min(1), country: z.string().length(2).optional() }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const target = await resolveApp(c.var.db, parsed.data.platform, parsed.data.external_id)
  if (!target) return c.json(validation({ external_id: ['The app must be discovered before it can be registered.'] }), 422)
  await c.var.db.prepare('INSERT OR IGNORE INTO user_apps (user_id,app_id,created_at) VALUES (?,?,?)')
    .bind(c.var.auth.user.id, target.id, nowIso()).run()
  const resource = await findAppResource(c.var.db, c.var.auth, parsed.data.platform, parsed.data.external_id)
  return c.json(resource, 201)
})
app.get('/apps/:platform/:externalId', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const target = await first<{ id: number; last_synced_at: string | null }>(c.var.db,
    'SELECT id,last_synced_at FROM apps WHERE platform=? AND external_id=?', platform, c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const configuredRefreshHours = Number(c.env.TRACKED_APP_REFRESH_HOURS ?? 24)
  const refreshHours = Number.isFinite(configuredRefreshHours) && configuredRefreshHours > 0 ? configuredRefreshHours : 24
  const stale = !target.last_synced_at || Date.parse(target.last_synced_at) < Date.now() - refreshHours * 60 * 60 * 1000
  if (stale && !(await first(c.var.db, "SELECT 1 AS found FROM sync_statuses WHERE app_id=? AND status IN ('pending','running','processing')", target.id))) {
    await enqueueSync(c.env, platform, c.req.param('externalId'), target.id, 'api', c.var.db)
  }
  const detail = await appDetailResource(c.var.db, c.var.auth, c.req.param('platform'), c.req.param('externalId'))
  return c.json(detail)
})
app.get('/apps/:platform/:externalId/listing', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const country = c.req.query('country_code'), locale = c.req.query('locale')
  const errors: Record<string, string[]> = {}
  if (!country || country.length !== 2 || !(await first(c.var.db, 'SELECT code FROM countries WHERE code=?', country))) errors.country_code = ['The selected country code is invalid.']
  if (!locale || locale.length > 10) errors.locale = ['The locale field is required.']
  if (Object.keys(errors).length) return c.json(validation(errors), 422)
  const row = await first<Record<string, unknown>>(c.var.db, 'SELECT * FROM app_store_listings WHERE app_id=? AND locale=? ORDER BY id DESC LIMIT 1', target.id, locale)
  if (row) return c.json({ ...row, screenshots: jsonValue(row.screenshots as string, []) })
  const platform = platformSchema.parse(c.req.param('platform'))
  if (!(await first(c.var.db, "SELECT 1 AS found FROM sync_statuses WHERE app_id=? AND status IN ('pending','running','processing')", target.id))) {
    await enqueueSync(c.env, platform, c.req.param('externalId'), target.id, 'api', c.var.db)
  }
  return c.json({ message: 'Not found.' }, 404)
})
app.post('/apps/:platform/:externalId/track', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const target = await resolveApp(c.var.db, platform, c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  await c.var.db.prepare('INSERT OR IGNORE INTO user_apps (user_id,app_id,created_at) VALUES (?,?,?)').bind(c.var.auth.user.id, target.id, nowIso()).run()
  return c.body(null, 204)
})
app.delete('/apps/:platform/:externalId/track', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (target) await c.var.db.batch([
    c.var.db.prepare('DELETE FROM app_competitors WHERE user_id=? AND app_id=?').bind(c.var.auth.user.id, target.id),
    c.var.db.prepare('DELETE FROM user_apps WHERE user_id=? AND app_id=?').bind(c.var.auth.user.id, target.id),
  ])
  return c.body(null, 204)
})
app.patch('/apps/:platform/:externalId/folder', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  if (!(await first(c.var.db, 'SELECT 1 AS found FROM user_apps WHERE user_id=? AND app_id=?', c.var.auth.user.id, target.id))) return c.json({ message: 'Not found.' }, 404)
  const body = await c.req.json<{ folder_id?: number | null }>().catch(() => ({})) as { folder_id?: number | null }
  if (body.folder_id && !(await first(c.var.db, 'SELECT id FROM folders WHERE id=? AND user_id=?', body.folder_id, c.var.auth.user.id))) return c.json(validation({ folder_id: ['The selected folder is invalid.'] }), 422)
  await c.var.db.prepare('UPDATE user_apps SET folder_id=? WHERE user_id=? AND app_id=?').bind(body.folder_id ?? null, c.var.auth.user.id, target.id).run()
  return c.body(null, 204)
})
app.post('/apps/:platform/:externalId/sync', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const target = await resolveApp(c.var.db, platform, c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const active = await first<Record<string, unknown>>(c.var.db, "SELECT * FROM sync_statuses WHERE app_id=? AND status IN ('pending','running','processing')", target.id)
  if (active) return c.json(syncResource(active))
  await enqueueSync(c.env, platform, c.req.param('externalId'), target.id, 'api', c.var.db)
  const status = await first<Record<string, unknown>>(c.var.db, 'SELECT * FROM sync_statuses WHERE app_id=?', target.id)
  return c.json(syncResource(status!))
})
app.get('/apps/:platform/:externalId/sync-status', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  let status = await first<Record<string, unknown>>(c.var.db, 'SELECT * FROM sync_statuses WHERE app_id=?', target.id)
  let created = false
  if (!status) {
    const now = nowIso()
    status = await c.var.db.prepare(`INSERT INTO sync_statuses
      (app_id,status,current_step,progress_done,progress_total,created_at,updated_at) VALUES (?,'pending',NULL,0,0,?,?) RETURNING *`)
      .bind(target.id, now, now).first<Record<string, unknown>>()
    created = true
  }
  return c.json(syncResource(status!), created ? 201 : 200)
})

app.get('/apps/:platform/:externalId/competitors', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target || !(await first(c.var.db, 'SELECT 1 AS found FROM user_apps WHERE user_id=? AND app_id=?', c.var.auth.user.id, target.id))) return c.json({ message: 'Not found.' }, 404)
  const rows = await all<{ id: number; relationship: string; created_at: string; competitor_app_id: number }>(c.var.db,
    'SELECT id,relationship,created_at,competitor_app_id FROM app_competitors WHERE user_id=? AND app_id=? ORDER BY created_at DESC', c.var.auth.user.id, target.id)
  return c.json(await Promise.all(rows.map(async (row) => {
    const app = await first<Record<string, unknown>>(c.var.db, `${appSelect} WHERE a.id=?`, c.var.auth.user.id, row.competitor_app_id)
    return { id: row.id, relationship: row.relationship, app: app ? appResource(app as never) : null, created_at: row.created_at }
  })))
})
app.post('/apps/:platform/:externalId/competitors', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target || !(await first(c.var.db, 'SELECT 1 AS found FROM user_apps WHERE user_id=? AND app_id=?', c.var.auth.user.id, target.id))) return c.json({ message: 'Not found.' }, 404)
  const parsed = z.object({
    competitor_app_id: z.number().int().positive().optional(), competitor_platform: platformSchema.optional(),
    competitor_external_id: z.string().min(1).optional(), relationship: z.enum(['direct', 'indirect', 'aspiration']).default('direct'),
  }).refine((value) => value.competitor_app_id !== undefined || value.competitor_external_id !== undefined, { message: 'A competitor is required.' })
    .safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  let competitor = parsed.data.competitor_app_id
    ? await first<{ id: number }>(c.var.db, 'SELECT id FROM apps WHERE id=?', parsed.data.competitor_app_id)
    : await resolveApp(c.var.db, parsed.data.competitor_platform ?? c.req.param('platform'), parsed.data.competitor_external_id!)
  if (parsed.data.competitor_app_id && !competitor) return c.json(validation({ competitor_app_id: ['The selected competitor app is invalid.'] }), 422)
  if (!competitor) {
    const competitorPlatform = parsed.data.competitor_platform ?? platformSchema.parse(c.req.param('platform'))
    competitor = { id: await persistStoreApp(c.var.db, await scraperFor(competitorPlatform).lookup(parsed.data.competitor_external_id!), { discoveredFrom: 'competitor' }) }
  }
  if (target.id === competitor.id) return c.json(validation({ competitor_external_id: ['An app cannot compete with itself.'] }), 422)
  const now = nowIso()
  let created: { id: number } | null
  try {
    created = await c.var.db.prepare(`INSERT INTO app_competitors (user_id,app_id,competitor_app_id,relationship,created_at,updated_at)
      VALUES (?,?,?,?,?,?) RETURNING id`).bind(c.var.auth.user.id, target.id, competitor.id, parsed.data.relationship, now, now).first<{ id: number }>()
  } catch { return c.json(validation({ competitor_app_id: ['This competitor has already been added.'] }), 422) }
  const competitorApp = await first<Record<string, unknown>>(c.var.db, `${appSelect} WHERE a.id=?`, c.var.auth.user.id, competitor.id)
  return c.json({ id: created!.id, relationship: parsed.data.relationship, app: competitorApp ? appResource(competitorApp as never) : null, created_at: now }, 201)
})
app.delete('/apps/:platform/:externalId/competitors/:competitor', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const result = await c.var.db.prepare('DELETE FROM app_competitors WHERE id=? AND user_id=? AND app_id=?').bind(Number(c.req.param('competitor')), c.var.auth.user.id, target.id).run()
  if ((result.meta.changes ?? 0) === 0) return c.json({ message: 'Not found.' }, 404)
  return c.body(null, 204)
})
app.get('/competitors', async (c) => {
  const platform = c.req.query('platform')
  if (platform && !platformSchema.safeParse(platform).success) return c.json(validation({ platform: ['The selected platform is invalid.'] }), 422)
  if ((c.req.query('search')?.length ?? 0) > 100) return c.json(validation({ search: ['The search field must not be greater than 100 characters.'] }), 422)
  const folder = c.req.query('folder_id')
  if (folder && folder !== 'unassigned' && (!/^\d+$/.test(folder) || !(await first(c.var.db, 'SELECT id FROM folders WHERE id=? AND user_id=?', Number(folder), c.var.auth.user.id)))) {
    return c.json(validation({ folder_id: ['The selected folder id is invalid.'] }), 422)
  }
  const where = ['ua.user_id=?'], bind: unknown[] = [c.var.auth.user.id]
  if (platform) { where.push('a.platform=?'); bind.push(platform) }
  if (folder === 'unassigned') where.push('ua.folder_id IS NULL')
  else if (folder) { where.push('ua.folder_id=?'); bind.push(Number(folder)) }
  const parents = await all<Record<string, unknown>>(c.var.db, `${appSelect} JOIN user_apps ua ON ua.app_id=a.id WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC`, c.var.auth.user.id, ...bind)
  const search = (c.req.query('search') ?? '').trim().toLocaleLowerCase(), groups = []
  for (const parentRow of parents) {
    const parent = appResource(parentRow as never)
    const mappings = await all<{ id: number; relationship: string; created_at: string; competitor_app_id: number }>(c.var.db,
      'SELECT id,relationship,created_at,competitor_app_id FROM app_competitors WHERE user_id=? AND app_id=? ORDER BY created_at DESC', c.var.auth.user.id, parent.id)
    const competitors = []
    for (const mapping of mappings) {
      const row = await first<Record<string, unknown>>(c.var.db, `${appSelect} WHERE a.id=?`, c.var.auth.user.id, mapping.competitor_app_id)
      if (row) competitors.push({ id: mapping.id, relationship: mapping.relationship, app: appResource(row as never), created_at: mapping.created_at })
    }
    const parentMatches = !search || parent.name.toLocaleLowerCase().includes(search)
    const visible = parentMatches ? competitors : competitors.filter((item) => item.app.name.toLocaleLowerCase().includes(search))
    if (visible.length) groups.push({ parent, competitors: visible })
  }
  return c.json(groups)
})

const englishStopWords = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with'])
function words(text: string, n: number, locale = 'en-US') {
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, ' ')
  const tokens = (plain.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length >= 2 && !(locale.toLocaleLowerCase().startsWith('en') && englishStopWords.has(word)))
  const counts = new Map<string, number>()
  for (let i = 0; i <= tokens.length - n; i++) { const key = tokens.slice(i, i + n).join(' '); counts.set(key, (counts.get(key) ?? 0) + 1) }
  return [...counts].map(([keyword, count]) => ({ keyword, count, density: tokens.length ? Math.round((count / tokens.length) * 10_000) / 100 : 0, ngram_size: n }))
}
app.get('/apps/:platform/:externalId/keywords', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const ngramRaw = c.req.query('ngram'), ngram = int(ngramRaw, 1, 4)
  if (ngramRaw && !['1', '2', '3', '4'].includes(ngramRaw)) return c.json(validation({ ngram: ['The selected ngram is invalid.'] }), 422)
  const locale = c.req.query('locale') ?? 'en-US', version = c.req.query('version_id')
  if (version && !(await first(c.var.db, 'SELECT id FROM app_versions WHERE id=?', Number(version)))) return c.json(validation({ version_id: ['The selected version id is invalid.'] }), 422)
  const listing = await first<{ title: string; subtitle: string | null; description: string; whats_new: string | null }>(c.var.db, `SELECT title,subtitle,description,whats_new FROM app_store_listings
    WHERE app_id=? AND locale=? ${version ? 'AND version_id=?' : ''} ORDER BY version_id DESC,id DESC LIMIT 1`, target.id, locale, ...(version ? [Number(version)] : []))
  let density = listing ? words(`${listing.title} ${listing.subtitle ?? ''} ${listing.description} ${listing.whats_new ?? ''}`, ngram, locale)
    .map((row) => ({ locale, ...row })) : []
  const search = (c.req.query('search') ?? '').toLocaleLowerCase()
  if (search) density = density.filter((row) => row.keyword.includes(search))
  const sort = c.req.query('sort') ?? 'density', order = c.req.query('order') ?? 'desc'
  if (!['keyword', 'count', 'density'].includes(sort) || !['asc', 'desc'].includes(order)) return c.json(validation({ sort: ['The selected sort is invalid.'] }), 422)
  density.sort((a, b) => {
    const left = a[sort as 'keyword' | 'count' | 'density'], right = b[sort as 'keyword' | 'count' | 'density']
    const compared = typeof left === 'string' ? left.localeCompare(String(right)) : Number(left) - Number(right)
    return order === 'asc' ? compared : -compared
  })
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 100, 500)
  return c.json(page(density.slice((p - 1) * per, p * per), p, per, density.length))
})
app.get('/apps/:platform/:externalId/keywords/compare', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const url = new URL(c.req.url)
  const ids = [...url.searchParams.getAll('app_ids[]'), ...url.searchParams.getAll('app_ids')].map(Number).filter(Number.isInteger)
  if (!ids.length || ids.length > 5) return c.json(validation({ app_ids: ['The app ids field is required.'] }), 422)
  const allowed = new Set((await all<{ competitor_app_id: number }>(c.var.db, 'SELECT competitor_app_id FROM app_competitors WHERE user_id=? AND app_id=?', c.var.auth.user.id, target.id)).map((row) => row.competitor_app_id))
  if (ids.some((id) => !allowed.has(id))) return c.json(validation({ app_ids: ['The selected app id is invalid.'] }), 422)
  const locale = c.req.query('locale') ?? 'en-US', ngram = int(c.req.query('ngram'), 1, 4), apps = [], keywords: Record<string, Record<string, { count: number; density: number }>> = {}
  for (const id of ids) {
    const row = await first<{ id: number; display_name: string; external_id: string; icon_url: string | null }>(c.var.db, 'SELECT id,display_name,external_id,icon_url FROM apps WHERE id=?', id)
    if (!row) continue
    const versions = await all<{ id: number; version: string }>(c.var.db, 'SELECT id,version FROM app_versions WHERE app_id=? ORDER BY id DESC', id)
    apps.push({ id, name: row.display_name || row.external_id, icon_url: row.icon_url, versions })
    const requestedVersion = url.searchParams.get(`version_ids[${id}]`)
    const versionId = requestedVersion ? Number(requestedVersion) : versions[0]?.id
    const listing = await first<{ title: string; subtitle: string | null; description: string; whats_new: string | null }>(c.var.db,
      `SELECT title,subtitle,description,whats_new FROM app_store_listings WHERE app_id=? AND locale=? ${versionId ? 'AND version_id=?' : ''} ORDER BY version_id DESC,id DESC LIMIT 1`,
      id, locale, ...(versionId ? [versionId] : []))
    if (listing) keywords[String(id)] = Object.fromEntries(words(`${listing.title} ${listing.subtitle ?? ''} ${listing.description} ${listing.whats_new ?? ''}`, ngram, locale)
      .map((item) => [item.keyword, { count: item.count, density: item.density }]))
  }
  return c.json({ apps, keywords })
})

type MetricRow = { date: string; rating: number; rating_count: number; rating_breakdown: string | null }
type RatingSnapshot = { rating: number; rating_count: number; breakdown: Record<string, number> | null }

function aggregateMetrics(rows: MetricRow[]): RatingSnapshot {
  if (!rows.length) return { rating: 0, rating_count: 0, breakdown: null }
  let ratingCount = 0, weightedRating = 0
  const breakdown: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let hasBreakdown = false
  for (const row of rows) {
    if (row.rating_count <= 0) continue
    ratingCount += row.rating_count
    weightedRating += row.rating * row.rating_count
    const values = jsonValue<Record<string, number> | null>(row.rating_breakdown, null)
    if (values) {
      hasBreakdown = true
      for (const [star, count] of Object.entries(values)) breakdown[star] = (breakdown[star] ?? 0) + Number(count)
    }
  }
  if (!ratingCount) return { rating: 0, rating_count: 0, breakdown: null }
  return { rating: Math.round((weightedRating / ratingCount + Number.EPSILON) * 100) / 100, rating_count: ratingCount, breakdown: hasBreakdown ? breakdown : null }
}

async function metricRows(db: Database, appId: number, platform: string, date?: string) {
  const where = ['app_id=?'], bind: unknown[] = [appId]
  if (platform === 'android') { where.push("country_code='zz'") }
  if (date) { where.push('date=?'); bind.push(date) }
  return all<MetricRow>(db, `SELECT date,rating,rating_count,rating_breakdown FROM app_metrics WHERE ${where.join(' AND ')} ORDER BY date`, ...bind)
}

function utcDate(value: Date) { return value.toISOString().slice(0, 10) }
function shiftUtcDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return utcDate(value)
}

app.get('/apps/:platform/:externalId/ratings/summary', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const platform = c.req.param('platform')
  const latest = await first<{ date: string }>(c.var.db, `SELECT MAX(date) AS date FROM app_metrics WHERE app_id=? ${platform === 'android' ? "AND country_code='zz'" : ''}`, target.id)
  if (!latest?.date) return c.json({ rating: 0, rating_count: 0, breakdown: null, trend: { rating_delta_30d: null, rating_count_delta_30d: null } })
  const current = aggregateMetrics(await metricRows(c.var.db, target.id, platform, latest.date))
  const baselineDate = await first<{ date: string }>(c.var.db, `SELECT MAX(date) AS date FROM app_metrics
    WHERE app_id=? ${platform === 'android' ? "AND country_code='zz'" : ''} AND date<=?`, target.id, shiftUtcDate(latest.date, -30))
  const baseline = baselineDate?.date ? aggregateMetrics(await metricRows(c.var.db, target.id, platform, baselineDate.date)) : null
  return c.json({ ...current, trend: {
    rating_delta_30d: baseline ? Math.round((current.rating - baseline.rating + Number.EPSILON) * 100) / 100 : null,
    rating_count_delta_30d: baseline ? current.rating_count - baseline.rating_count : null,
  } })
})
app.get('/apps/:platform/:externalId/ratings/history', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const daysRaw = c.req.query('days')
  if (daysRaw && (!/^\d+$/.test(daysRaw) || Number(daysRaw) < 1 || Number(daysRaw) > 90)) return c.json(validation({ days: ['The days field must be between 1 and 90.'] }), 422)
  const days = Number(daysRaw ?? 30), end = utcDate(new Date()), start = shiftUtcDate(end, -(days - 1))
  const rows = await metricRows(c.var.db, target.id, c.req.param('platform'))
  const byDate = new Map<string, MetricRow[]>()
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row])
  let previous: RatingSnapshot | null = null
  for (const [date, dateRows] of byDate) if (date < start) previous = aggregateMetrics(dateRows)
  const result = []
  for (let offset = 0; offset < days; offset++) {
    const date = shiftUtcDate(start, offset), dateRows = byDate.get(date)
    if (!dateRows) { result.push({ date, rating: null, rating_count: null, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, delta_total: null, delta_breakdown: null }); continue }
    const current = aggregateMetrics(dateRows)
    const deltaBreakdown = previous && current.breakdown && previous.breakdown
      ? Object.fromEntries([...new Set([...Object.keys(current.breakdown), ...Object.keys(previous.breakdown)])]
        .map((star) => [star, (current.breakdown?.[star] ?? 0) - (previous?.breakdown?.[star] ?? 0)])) : null
    result.push({ date, ...current, delta_total: deltaBreakdown ? Object.values(deltaBreakdown).reduce((sum, count) => sum + count, 0) : null, delta_breakdown: deltaBreakdown })
    previous = current
  }
  return c.json(result)
})
app.get('/apps/:platform/:externalId/ratings/country-breakdown', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  if (c.req.param('platform') === 'android') return c.json({ data: [], supported: false, message: 'Google Play does not provide ratings data by country.' })
  const rows = await all(c.var.db, `SELECT m.country_code,m.rating,m.rating_count FROM app_metrics m WHERE m.app_id=?
    AND m.id=(SELECT lm.id FROM app_metrics lm WHERE lm.app_id=m.app_id AND lm.country_code=m.country_code ORDER BY lm.date DESC,lm.id DESC LIMIT 1)
    ORDER BY m.country_code`, target.id)
  return c.json({ data: rows, supported: true })
})
app.get('/apps/:platform/:externalId/rankings', async (c) => {
  const target = await resolveApp(c.var.db, c.req.param('platform'), c.req.param('externalId'))
  if (!target) return c.json({ message: 'Not found.' }, 404)
  const date = c.req.query('date')
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) return c.json(validation({ date: ['The date field must match the format Y-m-d.'] }), 422)
  const collection = c.req.query('collection')
  if (collection && !['top_free', 'top_paid', 'top_grossing', 'all'].includes(collection)) return c.json(validation({ collection: ['The selected collection is invalid.'] }), 422)
  const selectedDate = date ?? utcDate(new Date()), where = ['tce.app_id=?', 'tc.platform=?', 'tc.snapshot_date=?'], bind: unknown[] = [target.id, c.req.param('platform'), selectedDate]
  if (collection && collection !== 'all') { where.push('tc.collection=?'); bind.push(collection) }
  const rows = await all<Record<string, unknown>>(c.var.db, `SELECT tc.snapshot_date, tce.rank, tc.platform, tc.collection, tc.country_code,
    sc.id AS category_id, sc.name AS category_name FROM trending_chart_entries tce
    JOIN trending_charts tc ON tc.id=tce.trending_chart_id JOIN store_categories sc ON sc.id=tc.category_id
    WHERE ${where.join(' AND ')} ORDER BY tc.snapshot_date DESC,tce.rank`, ...bind)
  return c.json(await Promise.all(rows.map(async (row) => {
    const previous = await first<{ rank: number }>(c.var.db, `SELECT pe.rank FROM trending_chart_entries pe
      JOIN trending_charts pc ON pc.id=pe.trending_chart_id WHERE pe.app_id=? AND pc.platform=? AND pc.collection=?
      AND pc.country_code=? AND pc.category_id=? AND pc.snapshot_date<? ORDER BY pc.snapshot_date DESC LIMIT 1`,
    target.id, row.platform, row.collection, row.country_code, row.category_id, row.snapshot_date)
    const rank = Number(row.rank), previousRank = previous?.rank ?? null, change = previousRank === null ? null : previousRank - rank
    return { country_code: row.country_code, collection: row.collection,
      category: { id: row.category_id, name: row.category_name }, rank, previous_rank: previousRank, rank_change: change,
      status: previousRank === null ? 'new' : change! > 0 ? 'up' : change! < 0 ? 'down' : 'same', snapshot_date: row.snapshot_date }
  })))
})

app.get('/dashboard', async (c) => {
  const [tracked, versions, changes, recent] = await Promise.all([
    first<{ count: number }>(c.var.db, 'SELECT COUNT(*) AS count FROM user_apps WHERE user_id=?', c.var.auth.user.id),
    first<{ count: number }>(c.var.db, `SELECT COUNT(*) AS count FROM app_versions v WHERE EXISTS
      (SELECT 1 FROM user_apps ua WHERE ua.user_id=? AND ua.app_id=v.app_id)`, c.var.auth.user.id),
    first<{ count: number }>(c.var.db, `SELECT COUNT(*) AS count FROM app_store_listing_changes lc WHERE EXISTS
      (SELECT 1 FROM user_apps ua WHERE ua.user_id=? AND ua.app_id=lc.app_id)`, c.var.auth.user.id),
    all(c.var.db, `SELECT lc.id,COALESCE(NULLIF(a.display_name,''),a.external_id) AS app_name,lc.field_changed,lc.locale,lc.detected_at FROM app_store_listing_changes lc
      JOIN apps a ON a.id=lc.app_id WHERE EXISTS (SELECT 1 FROM user_apps ua WHERE ua.user_id=? AND ua.app_id=lc.app_id)
      ORDER BY lc.detected_at DESC LIMIT 5`, c.var.auth.user.id),
  ])
  return c.json({ total_apps: tracked?.count ?? 0, total_versions: versions?.count ?? 0, total_changes: changes?.count ?? 0, recent_changes: recent })
})

async function changes(c: Context<{ Bindings: Env; Variables: Variables }>, competitor: boolean) {
  const allowedFields = ['title', 'subtitle', 'description', 'whats_new', 'screenshots', 'locale_added', 'locale_removed']
  const invalid: Record<string, string[]> = {}
  for (const key of ['page', 'per_page', 'app_id'] as const) {
    const value = c.req.query(key)
    if (value && (!/^\d+$/.test(value) || Number(value) < 1 || (key === 'per_page' && Number(value) > 100))) invalid[key] = [`The ${key.replace('_', ' ')} field is invalid.`]
  }
  if (c.req.query('platform') && !platformSchema.safeParse(c.req.query('platform')).success) invalid.platform = ['The selected platform is invalid.']
  if (c.req.query('field') && !allowedFields.includes(c.req.query('field')!)) invalid.field = ['The selected field is invalid.']
  if ((c.req.query('search')?.length ?? 0) > 100) invalid.search = ['The search field must not be greater than 100 characters.']
  if (Object.keys(invalid).length) return c.json(validation(invalid), 422)
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 50, 100)
  const folder = c.req.query('folder_id')
  if (folder && folder !== 'unassigned') {
    if (!/^\d+$/.test(folder) || !(await first(c.var.db, 'SELECT id FROM folders WHERE id=? AND user_id=?', Number(folder), c.var.auth.user.id))) {
      return c.json(validation({ folder_id: ['The selected folder id is invalid.'] }), 422)
    }
  }
  const visible = competitor
    ? 'EXISTS (SELECT 1 FROM app_competitors ac WHERE ac.user_id=? AND ac.competitor_app_id=lc.app_id)'
    : 'EXISTS (SELECT 1 FROM user_apps ua WHERE ua.user_id=? AND ua.app_id=lc.app_id) AND NOT EXISTS (SELECT 1 FROM app_competitors ac WHERE ac.user_id=? AND ac.competitor_app_id=lc.app_id)'
  const where = [visible], bind: unknown[] = competitor ? [c.var.auth.user.id] : [c.var.auth.user.id, c.var.auth.user.id]
  if (c.req.query('platform')) { where.push('a.platform=?'); bind.push(c.req.query('platform')) }
  if (c.req.query('field')) { where.push('lc.field_changed=?'); bind.push(c.req.query('field')) }
  if (c.req.query('field_changed')) { where.push('lc.field_changed=?'); bind.push(c.req.query('field_changed')) }
  if (c.req.query('search')) { where.push('a.display_name LIKE ?'); bind.push(`%${c.req.query('search')}%`) }
  if (c.req.query('app_id')) { where.push('lc.app_id=?'); bind.push(Number(c.req.query('app_id'))) }
  if (folder) {
    const relation = competitor
      ? `EXISTS (SELECT 1 FROM app_competitors fac JOIN user_apps fua ON fua.user_id=fac.user_id AND fua.app_id=fac.app_id
          WHERE fac.user_id=? AND fac.competitor_app_id=lc.app_id AND fua.folder_id ${folder === 'unassigned' ? 'IS NULL' : '= ?'})`
      : `EXISTS (SELECT 1 FROM user_apps fua WHERE fua.user_id=? AND fua.app_id=lc.app_id AND fua.folder_id ${folder === 'unassigned' ? 'IS NULL' : '= ?'})`
    where.push(relation); bind.push(c.var.auth.user.id); if (folder !== 'unassigned') bind.push(Number(folder))
  }
  const from = `FROM app_store_listing_changes lc JOIN apps a ON a.id=lc.app_id WHERE ${where.join(' AND ')}`
  const rows = await all<Record<string, unknown>>(c.var.db, `SELECT lc.*,
    a.id AS app_id,a.display_name AS app_name,a.platform,a.external_id,a.icon_url,
    v.version,(SELECT pv.version FROM app_versions pv WHERE pv.app_id=lc.app_id AND pv.id<lc.version_id ORDER BY pv.id DESC LIMIT 1) AS previous_version
    ${from.replace('WHERE', 'LEFT JOIN app_versions v ON v.id=lc.version_id WHERE')}
    ORDER BY lc.detected_at DESC LIMIT ? OFFSET ?`, ...bind, per, (p - 1) * per)
  const total = (await first<{ count: number }>(c.var.db, `SELECT COUNT(*) AS count ${from}`, ...bind))?.count ?? 0
  const hasScopeApps = await first(c.var.db, competitor
    ? 'SELECT 1 AS found FROM app_competitors WHERE user_id=? LIMIT 1'
    : 'SELECT 1 AS found FROM user_apps ua WHERE ua.user_id=? AND NOT EXISTS (SELECT 1 FROM app_competitors ac WHERE ac.user_id=ua.user_id AND ac.competitor_app_id=ua.app_id) LIMIT 1', c.var.auth.user.id)
  const paginated = page(rows.map((row) => ({
    id: row.id, version: row.version, previous_version: row.previous_version, locale: row.locale, field_changed: row.field_changed,
    old_value: row.field_changed === 'screenshots' ? null : row.old_value, new_value: row.field_changed === 'screenshots' ? null : row.new_value,
    detected_at: row.detected_at,
    app: { id: row.app_id, name: row.app_name, platform: row.platform, external_id: row.external_id, icon_url: row.icon_url },
  })), p, per, total)
  return c.json({ ...paginated, meta_ext: { has_scope_apps: Boolean(hasScopeApps) } })
}
app.get('/changes/apps', (c) => changes(c, false))
app.get('/changes/competitors', (c) => changes(c, true))

app.get('/countries', async (c) => c.json((await all<Record<string, unknown>>(c.var.db, `SELECT code,name,emoji,ios_languages,android_languages FROM countries
  WHERE code!='zz' AND (is_active_ios=1 OR is_active_android=1) ORDER BY name`)).map((r) => ({ ...r, ios_languages: jsonValue(r.ios_languages as string, []), android_languages: jsonValue(r.android_languages as string, []) }))))
app.get('/store-categories', async (c) => {
  const where: string[] = [], bind: unknown[] = []
  const platform = c.req.query('platform'), type = c.req.query('type')
  if (platform && !platformSchema.safeParse(platform).success) return c.json(validation({ platform: ['The selected platform is invalid.'] }), 422)
  if (type && !['app', 'game', 'magazine'].includes(type)) return c.json(validation({ type: ['The selected type is invalid.'] }), 422)
  if (platform) { where.push('platform=?'); bind.push(platform) }
  if (type) { where.push('type=?'); bind.push(type) }
  return c.json(await all(c.var.db, `SELECT id,platform,external_id,name,slug,type,parent_id FROM store_categories ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`, ...bind))
})
app.get('/charts', async (c) => {
  const parsed = z.object({
    platform: platformSchema, collection: z.enum(['top_free', 'top_paid', 'top_grossing']),
    country_code: z.string().length(2).default('us'), category_id: z.coerce.number().int().positive().optional(),
  }).safeParse({ platform: c.req.query('platform'), collection: c.req.query('collection'), country_code: c.req.query('country_code') ?? c.req.query('country'), category_id: c.req.query('category_id') })
  if (!parsed.success) return c.json(validation(z.flattenError(parsed.error).fieldErrors as Record<string, string[]>), 422)
  const { platform, collection, country_code: country } = parsed.data
  if (!(await first(c.var.db, 'SELECT code FROM countries WHERE code=?', country))) return c.json(validation({ country_code: ['The selected country code is invalid.'] }), 422)
  const category = parsed.data.category_id
    ? await first<{ id: number; external_id: string | null }>(c.var.db, 'SELECT id,external_id FROM store_categories WHERE id=? AND platform=?', parsed.data.category_id, platform)
    : await first<{ id: number; external_id: string | null }>(c.var.db, 'SELECT id,external_id FROM store_categories WHERE platform=? AND external_id IS NULL', platform)
  if (!category) return c.json(validation({ category_id: ['The selected category id is invalid.'] }), 422)
  const snapshot = await first<{ id: number; snapshot_date: string; updated_at: string }>(c.var.db, `SELECT id,snapshot_date,updated_at FROM trending_charts
    WHERE platform=? AND collection=? AND country_code=? AND category_id=? ORDER BY snapshot_date DESC LIMIT 1`, platform, collection, country, category.id)
  const today = utcDate(new Date()), isStale = !snapshot || snapshot.snapshot_date < today
  if (isStale) {
    const message: JobMessage = { v: 1, kind: 'chart.sync', platform, countryCode: country, collection,
      categoryExternalId: category.external_id, snapshotDate: today, taskId: `chart:${platform}:${collection}:${country}:${category.id}:${today}` }
    await (platform === 'ios' ? c.env.CHARTS_IOS : c.env.CHARTS_ANDROID).send(message, { contentType: 'json' })
  }
  if (!snapshot) return c.json({ data: [], meta: { message: 'No chart data available.', snapshot_date: null, updated_at: null, platform, collection, country_code: country } })
  const previous = await first<{ id: number }>(c.var.db, `SELECT id FROM trending_charts WHERE platform=? AND collection=?
    AND country_code=? AND category_id=? AND snapshot_date<? ORDER BY snapshot_date DESC LIMIT 1`, platform, collection, country, category.id, snapshot.snapshot_date)
  const rows = await all<Record<string, unknown>>(c.var.db, `SELECT tce.rank,pe.rank AS previous_rank,a.id AS app_id,a.display_name AS app_name,
    a.external_id AS app_external_id,a.icon_url,a.platform,tce.price,tce.currency,p.id AS publisher_id,p.name AS publisher_name,sc.name AS category_name
    FROM trending_chart_entries tce JOIN apps a ON a.id=tce.app_id LEFT JOIN publishers p ON p.id=a.publisher_id
    LEFT JOIN store_categories sc ON sc.id=a.category_id
    LEFT JOIN trending_chart_entries pe ON pe.trending_chart_id=? AND pe.app_id=tce.app_id
    WHERE tce.trending_chart_id=? ORDER BY tce.rank`, previous?.id ?? -1, snapshot.id)
  return c.json({ data: rows.map((row) => ({ rank: row.rank,
    rank_change: row.previous_rank == null ? null : Number(row.previous_rank) - Number(row.rank), app_id: row.app_id,
    app_external_id: row.app_external_id, app_name: row.app_name, icon_url: row.icon_url, platform: row.platform,
    publisher: row.publisher_id == null ? null : { id: row.publisher_id, name: row.publisher_name }, category_name: row.category_name,
    price: Number(row.price), currency: row.currency, is_free: Number(row.price) === 0 })),
  meta: { snapshot_date: snapshot.snapshot_date, updated_at: snapshot.updated_at, platform, collection, country_code: country } })
})
app.get('/explorer/icons', async (c) => {
  if (c.req.query('platform') && !platformSchema.safeParse(c.req.query('platform')).success) return c.json(validation({ platform: ['The selected platform is invalid.'] }), 422)
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 48, 100)
  const where = ['a.icon_url IS NOT NULL'], bind: unknown[] = []
  if (c.req.query('platform')) { where.push('a.platform=?'); bind.push(c.req.query('platform')) }
  if (c.req.query('category_id')) { where.push('a.category_id=?'); bind.push(Number(c.req.query('category_id'))) }
  if (c.req.query('search')) { where.push('a.display_name LIKE ?'); bind.push(`%${c.req.query('search')}%`) }
  const from = `FROM apps a LEFT JOIN publishers pub ON pub.id=a.publisher_id LEFT JOIN store_categories cat ON cat.id=a.category_id WHERE ${where.join(' AND ')}`
  const rows = await all(c.var.db, `SELECT a.id AS app_id,a.external_id,a.platform,a.display_name AS name,a.icon_url,
    pub.name AS publisher_name,cat.name AS category_name ${from} ORDER BY a.discovered_at DESC LIMIT ? OFFSET ?`, ...bind, per, (p - 1) * per)
  const total = (await first<{ count: number }>(c.var.db, `SELECT COUNT(*) AS count ${from}`, ...bind))?.count ?? 0
  return c.json(page(rows, p, per, total))
})
app.get('/explorer/screenshots', async (c) => {
  if (c.req.query('platform') && !platformSchema.safeParse(c.req.query('platform')).success) return c.json(validation({ platform: ['The selected platform is invalid.'] }), 422)
  const p = int(c.req.query('page'), 1, 10000), per = int(c.req.query('per_page'), 12, 100)
  const where = ['a.last_synced_at IS NOT NULL', `EXISTS (SELECT 1 FROM app_store_listings el WHERE el.app_id=a.id AND el.locale LIKE 'en%' AND el.screenshots IS NOT NULL AND json_array_length(el.screenshots)>0)`], bind: unknown[] = []
  if (c.req.query('platform')) { where.push('a.platform=?'); bind.push(c.req.query('platform')) }
  if (c.req.query('category_id')) { where.push('a.category_id=?'); bind.push(Number(c.req.query('category_id'))) }
  if (c.req.query('search')) { where.push('a.display_name LIKE ?'); bind.push(`%${c.req.query('search')}%`) }
  const from = `FROM apps a LEFT JOIN publishers pub ON pub.id=a.publisher_id LEFT JOIN store_categories cat ON cat.id=a.category_id WHERE ${where.join(' AND ')}`
  const rows = await all<Record<string, unknown>>(c.var.db, `SELECT a.id AS app_id,a.external_id,a.platform,a.display_name AS name,
    COALESCE((SELECT el.icon_url FROM app_store_listings el WHERE el.app_id=a.id AND el.locale LIKE 'en%' ORDER BY CASE WHEN el.locale='en-US' THEN 0 ELSE 1 END,el.version_id DESC LIMIT 1),a.icon_url) AS icon_url,
    pub.name AS publisher_name,cat.name AS category_name,
    (SELECT el.screenshots FROM app_store_listings el WHERE el.app_id=a.id AND el.locale LIKE 'en%' ORDER BY CASE WHEN el.locale='en-US' THEN 0 ELSE 1 END,el.version_id DESC LIMIT 1) AS screenshots
    ${from} ORDER BY a.last_synced_at DESC LIMIT ? OFFSET ?`, ...bind, per, (p - 1) * per)
  const total = (await first<{ count: number }>(c.var.db, `SELECT COUNT(*) AS count ${from}`, ...bind))?.count ?? 0
  return c.json(page(rows.map((r) => ({ ...r, screenshots: jsonValue(r.screenshots as string, []) })), p, per, total))
})

app.get('/publishers/search', async (c) => {
  const q = (c.req.query('term') ?? c.req.query('q') ?? '').trim(), parsed = platformSchema.safeParse(c.req.query('platform'))
  const errors: Record<string, string[]> = {}
  if (q.length < 2) errors.term = ['The term field must contain at least 2 characters.']
  if (!parsed.success) errors.platform = ['The selected platform is invalid.']
  const country = c.req.query('country_code') ?? c.req.query('country') ?? 'us'
  if (!(await first(c.var.db, 'SELECT code FROM countries WHERE code=?', country))) errors.country_code = ['The selected country code is invalid.']
  if (Object.keys(errors).length) return c.json(validation(errors), 422)
  const platform = parsed.success ? parsed.data : 'ios'
  let discovered
  try { discovered = await scraperFor(platform).search(q, country, 25) } catch { return c.json([]) }
  const grouped = new Map<string, { external_id: string; name: string; url: string | null; platform: Platform; app_count: number; sample_apps: Array<{ name: string; icon_url: string | null }> }>()
  for (const result of discovered) {
    if (!result.publisher_name) continue
    const key = result.publisher_external_id ?? result.publisher_name
    const publisher = grouped.get(key) ?? { external_id: key, name: result.publisher_name, url: result.publisher_url, platform, app_count: 0,
      sample_apps: [] as Array<{ name: string; icon_url: string | null }> }
    publisher.app_count++
    if (publisher.sample_apps.length < 3) publisher.sample_apps.push({ name: result.name, icon_url: result.icon_url })
    grouped.set(key, publisher)
    await persistStoreApp(c.var.db, result, { discoveredFrom: 'publisher-search' })
  }
  return c.json([...grouped.values()])
})
app.get('/publishers', async (c) => c.json(await all(c.var.db, `SELECT p.id,p.name,p.external_id,p.platform,p.url,COUNT(a.id) AS apps_count FROM publishers p
  JOIN apps a ON a.publisher_id=p.id JOIN user_apps ua ON ua.app_id=a.id WHERE ua.user_id=? GROUP BY p.id ORDER BY p.name`, c.var.auth.user.id)))
app.get('/publishers/:platform/:externalId', async (c) => {
  const publisher = await first<Record<string, unknown>>(c.var.db, 'SELECT id,name,external_id,platform,url FROM publishers WHERE platform=? AND external_id=?', c.req.param('platform'), decodeURIComponent(c.req.param('externalId')))
  if (!publisher) return c.json({ message: 'Not found.' }, 404)
  const apps = await all<Record<string, unknown>>(c.var.db, `${appSelect} JOIN user_apps ua ON ua.app_id=a.id
    WHERE ua.user_id=? AND a.publisher_id=? ORDER BY a.updated_at DESC`, c.var.auth.user.id, c.var.auth.user.id, publisher.id)
  return c.json({ publisher, apps: apps.map((row) => appResource(row as never)) })
})
app.get('/publishers/:platform/:externalId/store-apps', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const externalId = decodeURIComponent(c.req.param('externalId'))
  if (!(await first(c.var.db, 'SELECT id FROM publishers WHERE platform=? AND external_id=?', platform, externalId))) return c.json({ message: 'Not found.' }, 404)
  let results
  try { results = await scraperFor(platform).developerApps(externalId, c.req.query('country_code') ?? c.req.query('country') ?? 'us') } catch { return c.json({ apps: [] }) }
  const tracked = new Set((await all<{ external_id: string }>(c.var.db, `SELECT a.external_id FROM apps a JOIN user_apps ua ON ua.app_id=a.id
    WHERE ua.user_id=? AND a.platform=?`, c.var.auth.user.id, platform)).map((row) => row.external_id))
  for (const result of results) await persistStoreApp(c.var.db, result, { discoveredFrom: 'publisher' })
  return c.json({ apps: results.map((result) => ({ external_id: result.external_id, name: result.name, icon_url: result.icon_url,
    rating: result.rating, rating_count: result.rating_count, is_free: result.is_free, category: result.category, is_tracked: tracked.has(result.external_id) })) })
})
app.post('/publishers/:platform/:externalId/import', async (c) => {
  const platform = platformSchema.parse(c.req.param('platform'))
  const body = await c.req.json<{ external_ids?: string[] }>().catch(() => ({})) as { external_ids?: string[] }
  if (!Array.isArray(body.external_ids) || body.external_ids.length < 1 || body.external_ids.length > 50 || body.external_ids.some((id) => typeof id !== 'string' || !id)) {
    return c.json(validation({ external_ids: ['The external ids field is required.'] }), 422)
  }
  const targets: Array<{ externalId: string; appId: number }> = []
  for (const id of body.external_ids) {
    const app = await resolveApp(c.var.db, platform, id)
    if (!app) return c.json(validation({ external_ids: [`App ${id} has not been discovered.`] }), 422)
    targets.push({ externalId: id, appId: app.id })
  }
  for (const target of targets) {
    await c.var.db.prepare('INSERT OR IGNORE INTO user_apps (user_id,app_id,created_at) VALUES (?,?,?)').bind(c.var.auth.user.id, target.appId, nowIso()).run()
    if (!(await first(c.var.db, "SELECT 1 AS found FROM sync_statuses WHERE app_id=? AND status IN ('pending','running','processing')", target.appId))) {
      await enqueueSync(c.env, platform, target.externalId, target.appId, 'api', c.var.db)
    }
  }
  return c.body(null, 204)
})

export default app
