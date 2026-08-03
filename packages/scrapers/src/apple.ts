import { fetchBoundedJson } from './http.js'
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
    const data = await fetchBoundedJson<ItunesResponse>(itunesUrl('lookup', {
      id: externalId,
      country,
      ...(locale ? { lang: locale } : {}),
    }))
    const item = data.results[0]
    if (!item) throw new Error('App Store app not found')
    return normalize(item)
  }

  async search(term: string, country = 'us', limit = 10): Promise<StoreApp[]> {
    const data = await fetchBoundedJson<ItunesResponse>(itunesUrl('search', {
      term,
      country,
      entity: 'software',
      limit: Math.min(Math.max(limit, 1), 50),
    }))
    return data.results.filter((item) => item.trackId).map(normalize)
  }

  async developerApps(developerId: string, country = 'us'): Promise<StoreApp[]> {
    const data = await fetchBoundedJson<ItunesResponse>(itunesUrl('lookup', {
      id: developerId,
      country,
      entity: 'software',
      limit: 200,
    }))
    return data.results.filter((item) => item.trackId).map(normalize)
  }

  async chart(
    collection: 'top_free' | 'top_paid' | 'top_grossing',
    country: string,
    limit = 100,
    categoryId?: string | null,
  ): Promise<ChartApp[]> {
    const feed = collection === 'top_free' ? 'topfreeapplications' : collection === 'top_paid' ? 'toppaidapplications' : 'topgrossingapplications'
    const genre = categoryId ? `/genre=${encodeURIComponent(categoryId)}` : ''
    const url = `https://itunes.apple.com/${country}/rss/${feed}/limit=${Math.min(limit, 200)}${genre}/json`
    const data = await fetchBoundedJson<{ feed?: { entry?: Array<Record<string, unknown>> } }>(url)
    const entries = data.feed?.entry ?? []
    return entries.map((entry, index) => {
      const id = entry.id as { attributes?: { 'im:id'?: string } } | undefined
      const name = entry['im:name'] as { label?: string } | undefined
      const artist = entry['im:artist'] as { label?: string; attributes?: { href?: string } } | undefined
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
}
