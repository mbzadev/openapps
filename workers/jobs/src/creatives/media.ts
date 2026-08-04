import { createHash } from 'node:crypto'
import { first, nowIso, type JobMessage } from '@openapps/core'
import type { Env } from '../env.js'

const MAX_MEDIA_BYTES = 250 * 1024 * 1024
const ALLOWED_HOST_SUFFIXES = [
  'fbcdn.net', 'facebook.com', 'fbsbx.com',
  'googleusercontent.com', 'googlevideo.com', 'gstatic.com', 'ggpht.com', 'googlesyndication.com', 'youtube.com', 'ytimg.com', 'doubleclick.net',
  'tiktokcdn.com', 'tiktokcdn-eu.com', 'byteoversea.com', 'ibyteimg.com', 'muscdn.com', 'tiktok.com',
]

export function isAllowedCreativeMediaUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    const host = url.hostname.toLocaleLowerCase().replace(/\.$/, '')
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch { return false }
}

async function fetchAllowed(rawUrl: string): Promise<Response> {
  let url = rawUrl
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!isAllowedCreativeMediaUrl(url)) throw new Error(`MEDIA_SSRF_REFUSED:${new URL(url).hostname}`)
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000), headers: { accept: 'image/*,video/*' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('MEDIA_REDIRECT_WITHOUT_LOCATION')
      url = new URL(location, url).toString()
      continue
    }
    if (!response.ok) throw new Error(`MEDIA_HTTP_${response.status}`)
    return response
  }
  throw new Error('MEDIA_TOO_MANY_REDIRECTS')
}

async function hashStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const hash = createHash('sha256')
  let byteSize = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteSize += value.byteLength
    if (byteSize > MAX_MEDIA_BYTES) {
      await reader.cancel('Media exceeds 250 MiB')
      throw new Error('MEDIA_TOO_LARGE')
    }
    hash.update(value)
  }
  return { sha256: hash.digest('hex'), byteSize }
}

export async function archiveCreativeMedia(env: Env, message: Extract<JobMessage, { kind: 'creative.media' }>) {
  const response = await fetchAllowed(message.sourceUrl)
  if (!response.body) throw new Error('MEDIA_EMPTY_BODY')
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_MEDIA_BYTES) throw new Error('MEDIA_TOO_LARGE')
  const mimeType = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLocaleLowerCase()
  if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/') && mimeType !== 'application/octet-stream') throw new Error(`MEDIA_MIME_REFUSED:${mimeType}`)

  const temporaryKey = `temporary/${crypto.randomUUID()}`
  const [hashBranch, uploadBranch] = response.body.tee()
  let hashed: { sha256: string; byteSize: number }
  try {
    const [hashResult] = await Promise.all([
      hashStream(hashBranch),
      env.CREATIVES.put(temporaryKey, uploadBranch, { httpMetadata: { contentType: mimeType } }),
    ])
    hashed = hashResult
    const existing = await first<{ id: number; r2_key: string }>(env.DB, 'SELECT id,r2_key FROM ad_assets WHERE sha256=?', hashed.sha256)
    let assetId: number
    if (existing) {
      assetId = existing.id
    } else {
      const finalKey = `assets/${hashed.sha256}`
      const temporary = await env.CREATIVES.get(temporaryKey)
      if (!temporary?.body) throw new Error('MEDIA_TEMPORARY_OBJECT_MISSING')
      await env.CREATIVES.put(finalKey, temporary.body, {
        httpMetadata: { contentType: mimeType, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { sha256: hashed.sha256, originalUrl: message.sourceUrl },
      })
      const now = nowIso()
      const inserted = await env.DB.prepare(`INSERT INTO ad_assets
        (sha256,r2_key,media_type,mime_type,byte_size,original_url,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(sha256) DO UPDATE SET updated_at=excluded.updated_at RETURNING id`)
        .bind(hashed.sha256, finalKey, message.mediaType, mimeType, hashed.byteSize, message.sourceUrl, now, now).first<{ id: number }>()
      if (!inserted) throw new Error('MEDIA_ASSET_INSERT_FAILED')
      assetId = inserted.id
    }
    await env.DB.prepare(`INSERT OR IGNORE INTO ad_creative_assets (variant_id,asset_id,role,position,created_at) VALUES (?,?,?,?,?)`)
      .bind(message.variantId, assetId, message.role, message.position, nowIso()).run()
    return { ...hashed, assetId }
  } finally {
    await env.CREATIVES.delete(temporaryKey)
  }
}
