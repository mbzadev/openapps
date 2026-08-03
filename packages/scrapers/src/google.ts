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
    const path = collection === 'top_free' ? 'topselling_free' : collection === 'top_paid' ? 'topselling_paid' : 'topgrossing'
    const url = new URL(`https://play.google.com/store/apps/collection/${path}`)
    if (categoryId) url.searchParams.set('cat', categoryId)
    url.searchParams.set('gl', country.toUpperCase())
    url.searchParams.set('hl', 'en-US')
    const html = await fetchBoundedText(url.toString())
    const ids = appIds(html).slice(0, Math.min(limit, 100))
    const results = await Promise.allSettled(ids.map((id) => this.lookup(id, country)))
    return results.flatMap((result, index) => result.status === 'fulfilled'
      ? [{
          rank: index + 1,
          external_id: result.value.external_id,
          name: result.value.name,
          publisher_name: result.value.publisher_name,
          icon_url: result.value.icon_url,
          category: result.value.category,
          category_id: result.value.category_id,
          price: result.value.price,
          currency: result.value.currency,
          is_free: result.value.is_free,
          rating: result.value.rating,
          version: result.value.version,
        }]
      : [])
  }
}
