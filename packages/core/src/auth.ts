import { first, nowIso, type Database } from './db.js'
import { randomToken, sha256 } from './crypto.js'

export type AuthUser = { id: number; name: string; email: string; created_at: string; updated_at: string }

export type AuthContext = { user: AuthUser; tokenId: number; abilities: string[]; viaCookie: boolean }

export async function issueToken(
  db: Database,
  userId: number,
  name: string,
  abilities: string[],
  expiresAt: string | null,
): Promise<{ plainTextToken: string; id: number }> {
  const plainTextToken = randomToken()
  const tokenHash = await sha256(plainTextToken)
  const now = nowIso()
  const result = await db
    .prepare(`INSERT INTO personal_access_tokens
      (user_id, name, token_hash, abilities, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(userId, name, tokenHash, JSON.stringify(abilities), expiresAt, now, now)
    .first<{ id: number }>()
  if (!result) throw new Error('Failed to issue token')
  return { plainTextToken, id: result.id }
}

export async function authenticateRequest(db: Database, request: Request): Promise<AuthContext | null> {
  const authorization = request.headers.get('Authorization')
  const cookieToken = parseCookie(request.headers.get('Cookie'), '__Host-openapps-session')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : cookieToken
  if (!token) return null
  const tokenHash = await sha256(token)
  const row = await first<{
    token_id: number
    abilities: string
    expires_at: string | null
    id: number
    name: string
    email: string
    created_at: string
    updated_at: string
  }>(db, `SELECT t.id AS token_id, t.abilities, t.expires_at,
      u.id, u.name, u.email, u.created_at, u.updated_at
    FROM personal_access_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? LIMIT 1`, tokenHash)
  if (!row || (row.expires_at && row.expires_at <= nowIso())) return null
  await db.prepare('UPDATE personal_access_tokens SET last_used_at=?,updated_at=? WHERE id=?')
    .bind(nowIso(), nowIso(), row.token_id).run()
  return {
    user: { id: row.id, name: row.name, email: row.email, created_at: row.created_at, updated_at: row.updated_at },
    tokenId: row.token_id,
    abilities: JSON.parse(row.abilities) as string[],
    viaCookie: Boolean(cookieToken && !authorization),
  }
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function sessionCookie(token: string, maxAgeSeconds = 2_592_000): string {
  return `__Host-openapps-session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearSessionCookie(): string {
  return '__Host-openapps-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
}
