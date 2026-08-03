import type { Platform } from '@openapps/core'

export type StoreApp = {
  platform: Platform
  external_id: string
  name: string
  publisher_name: string
  publisher_external_id: string | null
  publisher_url: string | null
  category: string | null
  category_id: string | null
  icon_url: string | null
  rating: number | null
  rating_count: number | null
  is_free: boolean
  price: number
  currency: string | null
  version: string | null
  current_version_release_date: string | null
  original_release_date: string | null
  supported_locales: string[]
  content_rating: string | null
  description: string
  subtitle: string | null
  promotional_text: string | null
  whats_new: string | null
  screenshots: Array<{ url: string; device_type: string; order: number }>
  video_url: string | null
  file_size_bytes: number | null
}

export type ChartApp = Pick<StoreApp,
  'external_id' | 'name' | 'publisher_name' | 'icon_url' | 'category' | 'category_id' |
  'price' | 'currency' | 'is_free' | 'rating' | 'version'> & { rank: number }

export interface StoreScraper {
  lookup(externalId: string, country?: string, locale?: string): Promise<StoreApp>
  search(term: string, country?: string, limit?: number): Promise<StoreApp[]>
  chart(collection: 'top_free' | 'top_paid' | 'top_grossing', country: string, limit?: number, categoryId?: string | null): Promise<ChartApp[]>
  developerApps(developerId: string, country?: string): Promise<StoreApp[]>
}
