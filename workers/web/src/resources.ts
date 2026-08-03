import { all, first, jsonValue, type AuthContext, type Database } from '@openapps/core'

type AppRow = {
  id: number
  display_name: string
  platform: 'ios' | 'android'
  external_id: string
  icon_url: string | null
  origin_country_code: string
  supported_locales: string
  original_release_date: string | null
  is_free: number
  is_available: number
  created_at: string
  updated_at: string
  publisher_id: number | null
  publisher_name: string | null
  publisher_external_id: string | null
  category_id: number | null
  category_name: string | null
  category_slug: string | null
  rating: number | null
  rating_count: number | null
  version: string | null
  is_tracked: number
}

export const appSelect = `SELECT a.id, a.display_name, a.platform, a.external_id, a.icon_url,
  a.origin_country_code, a.supported_locales, a.original_release_date, a.is_free,
  a.is_available, a.created_at, a.updated_at,
  p.id AS publisher_id, p.name AS publisher_name, p.external_id AS publisher_external_id,
  c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
  (SELECT rating FROM app_metrics WHERE app_id = a.id ORDER BY date DESC LIMIT 1) AS rating,
  (SELECT rating_count FROM app_metrics WHERE app_id = a.id ORDER BY date DESC LIMIT 1) AS rating_count,
  (SELECT version FROM app_versions WHERE app_id = a.id ORDER BY id DESC LIMIT 1) AS version,
  EXISTS(SELECT 1 FROM user_apps ua WHERE ua.app_id = a.id AND ua.user_id = ?) AS is_tracked
  FROM apps a
  LEFT JOIN publishers p ON p.id = a.publisher_id
  LEFT JOIN store_categories c ON c.id = a.category_id`

export function appResource(row: AppRow) {
  return {
    id: row.id,
    name: row.display_name,
    display_name: row.display_name,
    platform: row.platform,
    external_id: row.external_id,
    publisher: row.publisher_id ? {
      id: row.publisher_id,
      name: row.publisher_name,
      external_id: row.publisher_external_id,
      platform: row.platform,
    } : null,
    category: row.category_id ? { id: row.category_id, name: row.category_name, slug: row.category_slug } : null,
    icon_url: row.icon_url,
    origin_country_code: row.origin_country_code,
    supported_locales: jsonValue<string[]>(row.supported_locales, []),
    original_release_date: row.original_release_date,
    is_free: Boolean(row.is_free),
    rating: row.rating,
    rating_count: row.rating_count,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_available: Boolean(row.is_available),
    is_tracked: Boolean(row.is_tracked),
  }
}

export async function findAppResource(
  db: Database,
  auth: AuthContext,
  platform: string,
  externalId: string,
) {
  const row = await first<AppRow>(db, `${appSelect} WHERE a.platform = ? AND a.external_id = ?`, auth.user.id, platform, externalId)
  return row ? appResource(row) : null
}

export async function appDetailResource(db: Database, auth: AuthContext, platform: string, externalId: string) {
  const app = await findAppResource(db, auth, platform, externalId)
  if (!app) return null
  const [versions, changes, listings, unavailable] = await Promise.all([
    all<{ id: number; version: string; release_date: string | null; whats_new: string | null; file_size_bytes: number | null }>(db,
      'SELECT id, version, release_date, whats_new, file_size_bytes FROM app_versions WHERE app_id = ? ORDER BY id DESC', app.id),
    all<{ id: number; field_changed: string; old_value: string | null; new_value: string | null; locale: string; detected_at: string }>(db,
      'SELECT id, field_changed, old_value, new_value, locale, detected_at FROM app_store_listing_changes WHERE app_id = ? ORDER BY detected_at DESC LIMIT 100', app.id),
    all<{ locale: string; title: string; subtitle: string | null; promotional_text: string | null; description: string; whats_new: string | null; screenshots: string; icon_url: string | null; video_url: string | null; price: number; currency: string | null; version_id: number | null }>(db,
      'SELECT locale, title, subtitle, promotional_text, description, whats_new, screenshots, icon_url, video_url, price, currency, version_id FROM app_store_listings WHERE app_id = ? ORDER BY id DESC', app.id),
    all<{ country_code: string }>(db,
      'SELECT DISTINCT country_code FROM app_metrics WHERE app_id = ? AND is_available = 0', app.id),
  ])
  return {
    ...app,
    versions,
    listings: listings.map((listing) => ({ ...listing, screenshots: jsonValue(listing.screenshots, []) })),
    recent_changes: changes.map((change) => ({
      ...change,
      old_value: change.field_changed === 'screenshots' ? null : change.old_value,
      new_value: change.field_changed === 'screenshots' ? null : change.new_value,
    })),
    unavailable_countries: unavailable.map((row) => row.country_code),
  }
}
