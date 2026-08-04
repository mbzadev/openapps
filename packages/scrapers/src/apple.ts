import { fetchBoundedJson, fetchBoundedText } from './http.js'
import type { ChartApp, StoreApp, StoreScraper } from './types.js'

type ItunesResult = {
  trackId?: number
  trackName?: string
  artistId?: number
  artistName?: string
  artistViewUrl?: string
  primaryGenreName?: string
  primaryGenreId?: number
  artworkUrl512?: string
  artworkUrl100?: string
  averageUserRating?: number
  userRatingCount?: number
  formattedPrice?: string
  price?: number
  currency?: string
  version?: string
  currentVersionReleaseDate?: string
  releaseDate?: string
  languageCodesISO2A?: string[]
  contentAdvisoryRating?: string
  description?: string
  trackCensoredName?: string
  releaseNotes?: string
  screenshotUrls?: string[]
  ipadScreenshotUrls?: string[]
  fileSizeBytes?: string
}

type ItunesResponse = { resultCount: number; results: ItunesResult[] }

type MarketingFeedResult = {
  id?: string
  name?: string
  artistName?: string
  artworkUrl100?: string
  genres?: Array<{ genreId?: string; name?: string }>
}

type MarketingFeed = { feed?: { results?: MarketingFeedResult[] } }
type LegacyChartFeed = { feed?: { entry?: Array<Record<string, unknown>> } }

type ApplePage = Record<string, unknown>

function record(value: unknown): ApplePage {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApplePage : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pageData(html: string): ApplePage {
  const match = html.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!match?.[1]) throw new Error('App Store page has no serialized data')
  const payload = record(JSON.parse(match[1]))
  const entry = record(array(payload.data)[0])
  return record(entry.data)
}

function artwork(value: unknown, width = 512, height = width): string | null {
  const template = text(record(value).template)
  return template
    ?.replaceAll('{w}', String(width))
    .replaceAll('{h}', String(height))
    .replaceAll('{c}', 'bb')
    .replaceAll('{f}', 'jpg') ?? null
}

function compactCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const match = text(value)?.replaceAll(',', '').match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?$/i)
  if (!match) return null
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return Math.round(Number(match[1]) * scale)
}

function priceFromLockup(lockup: ApplePage): number {
  const configuration = record(record(lockup.buttonAction).purchaseConfiguration)
  const match = text(configuration.buyParams)?.match(/(?:^|&)price=([0-9.]+)/)
  return match ? Number(match[1]) : 0
}

export function appleLegacyChartUrl(
  collection: 'top_free' | 'top_paid' | 'top_grossing',
  country: string,
  limit: number,
  categoryId?: string | null,
): string {
  const feed = collection === 'top_free'
    ? 'topfreeapplications'
    : collection === 'top_paid'
      ? 'toppaidapplications'
      : 'topgrossingapplications'
  const genre = categoryId ? `/genre=${encodeURIComponent(categoryId)}` : ''
  // The country-prefixed RSS route intermittently rejects Cloudflare Worker
  // egress. Apple's MZStoreServices route serves the same feed and accepts the
  // storefront through cc, with Browser Rendering retained as a final fallback.
  return `https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/RSS/${feed}/limit=${Math.min(limit, 200)}${genre}/json?cc=${encodeURIComponent(country.toLowerCase())}`
}

export function parseAppleLegacyChart(data: LegacyChartFeed): ChartApp[] {
  return (data.feed?.entry ?? []).map((entry, index) => {
    const id = entry.id as { attributes?: { 'im:id'?: string } } | undefined
    const name = entry['im:name'] as { label?: string } | undefined
    const artist = entry['im:artist'] as { label?: string } | undefined
    const images = entry['im:image'] as Array<{ label?: string }> | undefined
    const category = entry.category as { attributes?: { label?: string; 'im:id'?: string } } | undefined
    const price = entry['im:price'] as { attributes?: { amount?: string; currency?: string } } | undefined
    return {
      rank: index + 1,
      external_id: id?.attributes?.['im:id'] ?? '',
      name: name?.label ?? '',
      publisher_name: artist?.label ?? '',
      icon_url: images?.at(-1)?.label ?? null,
      category: category?.attributes?.label ?? null,
      category_id: category?.attributes?.['im:id'] ?? null,
      price: Number(price?.attributes?.amount ?? 0),
      currency: price?.attributes?.currency ?? null,
      is_free: Number(price?.attributes?.amount ?? 0) === 0,
      rating: null,
      version: null,
    }
  }).filter((entry) => entry.external_id)
}

function storeAppFromLockup(lockup: ApplePage, developerId: string | null = null): StoreApp {
  const externalId = text(lockup.adamId)
  if (!externalId) throw new Error('App Store result has no app id')
  const screenshots = array(lockup.screenshots).flatMap((group, groupIndex) =>
    array(record(group).artwork).map((item, order) => ({
      url: artwork(item, 1284, 2778) ?? '',
      device_type: groupIndex === 0 ? 'iphone' : 'ipad',
      order,
    })),
  ).filter((item) => item.url)
  const price = priceFromLockup(lockup)
  const developerName = text(lockup.developerName) ?? text(record(record(lockup.buttonAction).purchaseConfiguration).vendor) ?? ''
  return {
    platform: 'ios',
    external_id: externalId,
    name: text(lockup.title) ?? '',
    publisher_name: developerName,
    publisher_external_id: developerId,
    publisher_url: text(record(lockup.clickAction).pageUrl),
    category: null,
    category_id: null,
    icon_url: artwork(lockup.icon),
    rating: number(lockup.rating),
    rating_count: compactCount(lockup.ratingCount),
    is_free: record(lockup.offerDisplayProperties).isFree === true || price === 0,
    price,
    currency: null,
    version: null,
    current_version_release_date: null,
    original_release_date: null,
    supported_locales: [],
    content_rating: text(lockup.ageRating),
    description: '',
    subtitle: text(lockup.subtitle),
    promotional_text: null,
    whats_new: null,
    screenshots,
    video_url: text(record(array(record(array(lockup.trailers)[0]).videos)[0]).videoUrl),
    file_size_bytes: null,
  }
}

function annotation(mapping: ApplePage, title: string): ApplePage {
  return record(array(record(mapping.information).items).find((item) => text(record(item).title) === title))
}

function annotationText(mapping: ApplePage, title: string): string | null {
  return text(record(array(annotation(mapping, title).items)[0]).text)
}

function bytes(value: string | null): number | null {
  const match = value?.match(/^([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)$/i)
  if (!match) return null
  const units: Record<string, number> = { KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 }
  return Math.round(Number(match[1]) * (units[match[2]?.toUpperCase() ?? ''] ?? 1))
}

function searchPageUrl(term: string, country: string): string {
  const url = new URL(`https://apps.apple.com/${encodeURIComponent(country.toLowerCase())}/iphone/search`)
  url.searchParams.set('term', term)
  return url.toString()
}

function productPageUrl(externalId: string, country: string): string {
  return `https://apps.apple.com/${encodeURIComponent(country.toLowerCase())}/app/id${encodeURIComponent(externalId)}`
}

async function searchPage(term: string, country: string, limit: number): Promise<StoreApp[]> {
  const data = pageData(await fetchBoundedText(searchPageUrl(term, country)))
  const seen = new Set<string>()
  const results: StoreApp[] = []
  for (const shelf of array(data.shelves)) for (const item of array(record(shelf).items)) {
    const lockup = record(record(item).lockup)
    const id = text(lockup.adamId)
    if (!id || seen.has(id)) continue
    seen.add(id)
    results.push(storeAppFromLockup(lockup))
    if (results.length >= limit) return results
  }
  return results
}

async function lookupPage(externalId: string, country: string): Promise<StoreApp> {
  const data = pageData(await fetchBoundedText(productPageUrl(externalId, country)))
  const lockup = record(data.lockup)
  const developer = record(data.developerAction)
  const developerId = text(record(developer.destination).id)
  const app = storeAppFromLockup(lockup, developerId)
  const mapping = record(data.shelfMapping)
  const version = record(array(record(mapping.mostRecentVersion).items)[0])
  const rating = record(array(record(mapping.productRatings).items)[0])
  const description = record(array(record(mapping.description).items)[0])
  const languages = annotationText(mapping, 'Languages')
  const category = annotationText(mapping, 'Category')
  const screenshots: StoreApp['screenshots'] = []
  for (const [key, shelf] of Object.entries(mapping)) {
    if (!key.startsWith('product_media_')) continue
    const deviceType = key.includes('pad') ? 'ipad' : 'iphone'
    for (const item of array(record(shelf).items)) {
      const url = artwork(record(item).screenshot, deviceType === 'ipad' ? 2752 : 1284, deviceType === 'ipad' ? 2064 : 2778)
      if (url) screenshots.push({ url, device_type: deviceType, order: screenshots.length })
    }
  }
  return {
    ...app,
    publisher_name: text(developer.title) ?? app.publisher_name,
    publisher_url: text(developer.pageUrl),
    category,
    rating: number(rating.ratingAverage) ?? app.rating,
    rating_count: compactCount(rating.totalNumberOfRatings) ?? app.rating_count,
    version: text(version.primarySubtitle)?.replace(/^Version\s+/i, '') ?? null,
    current_version_release_date: dateOnly(text(version.secondarySubtitle) ?? undefined),
    supported_locales: languages?.split(',').map((language) => language.trim()).filter(Boolean) ?? [],
    content_rating: text(annotation(mapping, 'Age Rating').summary) ?? app.content_rating,
    description: text(record(description.paragraph).text) ?? '',
    whats_new: text(version.text),
    screenshots: screenshots.length ? screenshots : app.screenshots,
    file_size_bytes: bytes(annotationText(mapping, 'Size')),
  }
}

async function developerPage(developerId: string, country: string): Promise<StoreApp[]> {
  const url = `https://apps.apple.com/${encodeURIComponent(country.toLowerCase())}/developer/id${encodeURIComponent(developerId)}`
  const data = pageData(await fetchBoundedText(url))
  const results = new Map<string, StoreApp>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const candidate = record(value)
    if (text(candidate.adamId) && text(candidate.title) && artwork(candidate.icon)) {
      const app = storeAppFromLockup(candidate, developerId)
      results.set(app.external_id, app)
    }
    for (const child of Object.values(candidate)) visit(child)
  }
  visit(data.shelves)
  return [...results.values()]
}

function dateOnly(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function normalize(item: ItunesResult): StoreApp {
  if (!item.trackId) throw new Error('App Store result has no track id')
  const screenshots = [
    ...(item.screenshotUrls ?? []).map((url, order) => ({ url, device_type: 'iphone', order })),
    ...(item.ipadScreenshotUrls ?? []).map((url, order) => ({ url, device_type: 'ipad', order })),
  ]
  return {
    platform: 'ios',
    external_id: String(item.trackId),
    name: item.trackName ?? item.trackCensoredName ?? '',
    publisher_name: item.artistName ?? '',
    publisher_external_id: item.artistId ? String(item.artistId) : null,
    publisher_url: item.artistViewUrl ?? null,
    category: item.primaryGenreName ?? null,
    category_id: item.primaryGenreId ? String(item.primaryGenreId) : null,
    icon_url: item.artworkUrl512 ?? item.artworkUrl100 ?? null,
    rating: item.averageUserRating ?? null,
    rating_count: item.userRatingCount ?? null,
    is_free: (item.price ?? 0) === 0,
    price: item.price ?? 0,
    currency: item.currency ?? null,
    version: item.version ?? null,
    current_version_release_date: dateOnly(item.currentVersionReleaseDate),
    original_release_date: dateOnly(item.releaseDate),
    supported_locales: item.languageCodesISO2A ?? [],
    content_rating: item.contentAdvisoryRating ?? null,
    description: item.description ?? '',
    subtitle: null,
    promotional_text: null,
    whats_new: item.releaseNotes ?? null,
    screenshots,
    video_url: null,
    file_size_bytes: item.fileSizeBytes ? Number(item.fileSizeBytes) : null,
  }
}

function itunesUrl(path: 'lookup' | 'search', params: Record<string, string | number>): string {
  const url = new URL(`https://itunes.apple.com/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  return url.toString()
}

export class AppleScraper implements StoreScraper {
  async lookup(externalId: string, country = 'us', locale?: string): Promise<StoreApp> {
    try {
      const data = await fetchBoundedJson<ItunesResponse>(itunesUrl('lookup', {
        id: externalId,
        country,
        ...(locale ? { lang: locale } : {}),
      }))
      const item = data.results[0]
      if (!item) throw new Error('App Store app not found')
      return normalize(item)
    } catch {
      return lookupPage(externalId, country)
    }
  }

  async search(term: string, country = 'us', limit = 10): Promise<StoreApp[]> {
    const boundedLimit = Math.min(Math.max(limit, 1), 50)
    try {
      const data = await fetchBoundedJson<ItunesResponse>(itunesUrl('search', {
        term,
        country,
        entity: 'software',
        limit: boundedLimit,
      }))
      return data.results.filter((item) => item.trackId).map(normalize)
    } catch {
      return searchPage(term, country, boundedLimit)
    }
  }

  async developerApps(developerId: string, country = 'us'): Promise<StoreApp[]> {
    try {
      const data = await fetchBoundedJson<ItunesResponse>(itunesUrl('lookup', {
        id: developerId,
        country,
        entity: 'software',
        limit: 200,
      }))
      return data.results.filter((item) => item.trackId).map(normalize)
    } catch {
      return developerPage(developerId, country)
    }
  }

  async chart(
    collection: 'top_free' | 'top_paid' | 'top_grossing',
    country: string,
    limit = 100,
    categoryId?: string | null,
  ): Promise<ChartApp[]> {
    if (collection !== 'top_grossing' && !categoryId) {
      const feed = collection === 'top_free' ? 'top-free' : 'top-paid'
      const url = `https://rss.marketingtools.apple.com/api/v2/${encodeURIComponent(country.toLowerCase())}/apps/${feed}/${Math.min(limit, 100)}/apps.json`
      const data = await fetchBoundedJson<MarketingFeed>(url)
      return (data.feed?.results ?? []).map((entry, index) => ({
        rank: index + 1,
        external_id: entry.id ?? '',
        name: entry.name ?? '',
        publisher_name: entry.artistName ?? '',
        icon_url: entry.artworkUrl100 ?? null,
        category: entry.genres?.[0]?.name ?? null,
        category_id: entry.genres?.[0]?.genreId ?? null,
        price: 0,
        currency: null,
        is_free: collection === 'top_free',
        rating: null,
        version: null,
      })).filter((entry) => entry.external_id)
    }
    const data = await fetchBoundedJson<LegacyChartFeed>(appleLegacyChartUrl(collection, country, limit, categoryId))
    return parseAppleLegacyChart(data)
  }
}
