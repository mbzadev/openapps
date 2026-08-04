import { fetchBoundedText } from './http.js'
import type { ChartApp, StoreApp, StoreScraper } from './types.js'

function unescapeHtml(value: string): string {
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>')
}

function meta(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return unescapeHtml(match[1])
  }
  return null
}

function jsonLd(html: string): Record<string, unknown> {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1] ?? '{}') as Record<string, unknown>
      if (parsed['@type'] === 'SoftwareApplication' || parsed['@type'] === 'MobileApplication') return parsed
    } catch {
      // Ignore unrelated invalid JSON-LD blocks.
    }
  }
  return {}
}

function appIds(html: string): string[] {
  return [...new Set([...html.matchAll(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g)].map((match) => match[1]).filter(Boolean))] as string[]
}

function nested(value: unknown, path: number[]): unknown {
  let current = value
  for (const index of path) {
    if (!Array.isArray(current)) return undefined
    current = current[index]
  }
  return current
}

function googlePlayChartRequest(collection: string, category: string, limit: number): URLSearchParams {
  // Google removed chart links from the collection HTML. The Play Store web
  // client now loads the same data through its vyAe2 batched Fetch endpoint.
  // Keep the request projection deliberately small: it asks only for the app
  // card fields used below instead of mirroring the full browser payload.
  const fields = [64, 1, 195, 71, 8, 72, 9, 10, 11, 139, 12, 16, 145, 148, 150, 151, 152, 27, 30, 31, 96, 32, 34, 163, 100, 165, 104, 169, 108, 110, 113, 55, 56, 57, 122]
  const filters = [
    [[true], null, [[null, []]], null, null, null, null, [null, 2], null, null, null, null, null, null, [1], null, null, null, null, null, null, null, [1]],
    [null, [[null, []]]],
    [null, [[null, []]], null, [true]],
    [null, [[null, []]]],
    null,
    null,
    null,
    null,
    [[[null, []]]],
    [[[null, []]]],
  ]
  const config = [
    [8, [20, limit]], true, null, fields,
    [null, null, filters, [[]]],
    null, null, [[[1, 2], [10, 8, 9], [], []]],
  ]
  const request = [[['vyAe2', JSON.stringify([[null, config, [2, collection, category]]]), null, 'generic']]]
  return new URLSearchParams({ 'f.req': JSON.stringify(request) })
}

function parseGooglePlayChartResponse(responseText: string): unknown[] {
  for (const line of responseText.split('\n')) {
    if (!line.startsWith('[[')) continue
    try {
      const envelope = JSON.parse(line) as unknown
      const payloadText = nested(envelope, [0, 2])
      if (typeof payloadText !== 'string') continue
      const apps = nested(JSON.parse(payloadText), [0, 1, 0, 28, 0])
      if (Array.isArray(apps)) return apps
    } catch {
      // Batchexecute responses include non-JSON framing and unrelated rows.
    }
  }
  throw new Error('Google Play chart response format changed')
}

export function googlePlayAppUrl(id: string, country: string, locale: string): string {
  const url = new URL('https://play.google.com/store/apps/details')
  url.searchParams.set('id', id)
  url.searchParams.set('gl', country.toUpperCase())
  url.searchParams.set('hl', locale)
  return url.toString()
}

export function parseGooglePlayHtml(externalId: string, html: string, locale = 'en-US'): StoreApp {
  const ld = jsonLd(html)
  const author = ld.author as { name?: string; url?: string } | string | undefined
  const aggregate = ld.aggregateRating as { ratingValue?: string | number; ratingCount?: string | number } | undefined
  const offers = ld.offers as { price?: string | number; priceCurrency?: string } | undefined
  const screenshots = [...html.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/[a-zA-Z0-9_=?&%.-]+/g)]
    .map((match) => match[0])
    .filter((url) => !url.includes('=w240-h480'))
    .slice(0, 24)
    .map((url, order) => ({ url, device_type: 'phone', order }))
  const name = String(ld.name ?? meta(html, 'og:title') ?? '').replace(/ - Apps on Google Play$/, '')
  if (!name) throw new Error('Google Play app not found or page format changed')
  const publisherName = typeof author === 'string' ? author : author?.name ?? ''
  const publisherUrl = typeof author === 'object' ? author.url ?? null : null
  const price = Number(offers?.price ?? 0)
  return {
    platform: 'android',
    external_id: externalId,
    name,
    publisher_name: publisherName,
    publisher_external_id: publisherUrl ? new URL(publisherUrl, 'https://play.google.com').searchParams.get('id') : null,
    publisher_url: publisherUrl,
    category: String(ld.applicationCategory ?? '') || null,
    category_id: null,
    icon_url: String(ld.image ?? meta(html, 'og:image') ?? '') || null,
    rating: aggregate?.ratingValue === undefined ? null : Number(aggregate.ratingValue),
    rating_count: aggregate?.ratingCount === undefined ? null : Number(aggregate.ratingCount),
    is_free: !Number.isFinite(price) || price === 0,
    price: Number.isFinite(price) ? price : 0,
    currency: offers?.priceCurrency ?? null,
    version: null,
    current_version_release_date: null,
    original_release_date: String(ld.datePublished ?? '') || null,
    supported_locales: [locale],
    content_rating: String(ld.contentRating ?? '') || null,
    description: String(ld.description ?? meta(html, 'og:description') ?? ''),
    subtitle: meta(html, 'og:description'),
    promotional_text: null,
    whats_new: null,
    screenshots,
    video_url: null,
    file_size_bytes: null,
  }
}

export class GooglePlayScraper implements StoreScraper {
  async lookup(externalId: string, country = 'us', locale = 'en-US'): Promise<StoreApp> {
    const html = await fetchBoundedText(googlePlayAppUrl(externalId, country, locale))
    return parseGooglePlayHtml(externalId, html, locale)
  }

  async search(term: string, country = 'us', limit = 10): Promise<StoreApp[]> {
    const url = new URL('https://play.google.com/store/search')
    url.searchParams.set('q', term)
    url.searchParams.set('c', 'apps')
    url.searchParams.set('gl', country.toUpperCase())
    url.searchParams.set('hl', 'en-US')
    const html = await fetchBoundedText(url.toString())
    const ids = appIds(html).slice(0, Math.min(limit, 20))
    const results = await Promise.allSettled(ids.map((id) => this.lookup(id, country)))
    return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  }

  async developerApps(developerId: string, country = 'us'): Promise<StoreApp[]> {
    const url = new URL('https://play.google.com/store/apps/developer')
    url.searchParams.set('id', developerId)
    url.searchParams.set('gl', country.toUpperCase())
    url.searchParams.set('hl', 'en-US')
    const html = await fetchBoundedText(url.toString())
    const results = await Promise.allSettled(appIds(html).slice(0, 50).map((id) => this.lookup(id, country)))
    return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  }

  async chart(
    collection: 'top_free' | 'top_paid' | 'top_grossing',
    country: string,
    limit = 100,
    categoryId?: string | null,
  ): Promise<ChartApp[]> {
    const cluster = collection === 'top_free' ? 'topselling_free' : collection === 'top_paid' ? 'topselling_paid' : 'topgrossing'
    const url = new URL('https://play.google.com/_/PlayStoreUi/data/batchexecute')
    url.searchParams.set('rpcids', 'vyAe2')
    url.searchParams.set('source-path', '/store/apps')
    url.searchParams.set('authuser', '0')
    url.searchParams.set('soc-app', '121')
    url.searchParams.set('soc-platform', '1')
    url.searchParams.set('soc-device', '1')
    url.searchParams.set('rt', 'c')
    url.searchParams.set('hl', 'en')
    url.searchParams.set('gl', country.toLowerCase())
    const boundedLimit = Math.min(Math.max(1, limit), 100)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: googlePlayChartRequest(cluster, categoryId ?? 'APPLICATION', boundedLimit),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`Upstream ${response.status} for play.google.com`)
    const entries = parseGooglePlayChartResponse(await response.text()).slice(0, boundedLimit)
    return entries.flatMap((entry, index) => {
      const externalId = nested(entry, [0, 0, 0])
      if (typeof externalId !== 'string' || !externalId) return []
      const rawPrice = Number(nested(entry, [0, 8, 1, 0, 0]) ?? 0)
      const price = Number.isFinite(rawPrice) ? rawPrice / 1_000_000 : 0
      const currency = nested(entry, [0, 8, 1, 0, 1])
      const rating = Number(nested(entry, [0, 4, 1]))
      return [{
        rank: index + 1,
        external_id: externalId,
        name: String(nested(entry, [0, 3]) ?? externalId),
        publisher_name: String(nested(entry, [0, 14]) ?? ''),
        icon_url: typeof nested(entry, [0, 1, 3, 2]) === 'string' ? String(nested(entry, [0, 1, 3, 2])) : null,
        category: null,
        category_id: null,
        price,
        currency: typeof currency === 'string' ? currency : null,
        is_free: price === 0,
        rating: Number.isFinite(rating) ? rating : null,
        version: null,
      }]
    })
  }
}
