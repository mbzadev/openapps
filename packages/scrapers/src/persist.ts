import { first, nowIso, sha256, type Database } from '@openapps/core'
import type { StoreApp } from './types.js'

async function resolveCategoryId(db: Database, store: StoreApp): Promise<number | null> {
  if (store.category_id) {
    const byExternalId = await first<{ id: number }>(db,
      'SELECT id FROM store_categories WHERE platform=? AND external_id=?', store.platform, store.category_id)
    if (byExternalId) return byExternalId.id
  }
  const name = store.category?.trim()
  if (name) {
    const byName = await first<{ id: number }>(db,
      'SELECT id FROM store_categories WHERE platform=? AND name=? COLLATE NOCASE ORDER BY priority DESC,id LIMIT 1', store.platform, name)
    if (byName) return byName.id
  }
  if (store.category_id || name) console.warn(JSON.stringify({ level: 'warn', event: 'category.unknown', platform: store.platform, externalId: store.external_id, categoryExternalId: store.category_id, categoryName: name ?? null }))
  return null
}

export async function persistStoreApp(
  db: Database,
  store: StoreApp,
  options: { country?: string; locale?: string; discoveredFrom?: string } = {},
): Promise<number> {
  const now = nowIso()
  const country = (options.country ?? 'us').toLowerCase()
  const locale = options.locale ?? 'en-US'

  let publisherId: number | null = null
  if (store.publisher_name) {
    const publisherExternalId = store.publisher_external_id ?? store.publisher_name
    await db.prepare(`INSERT INTO publishers (platform, external_id, name, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, external_id) DO UPDATE SET name=excluded.name, url=excluded.url, updated_at=excluded.updated_at`)
      .bind(store.platform, publisherExternalId, store.publisher_name, store.publisher_url, now, now).run()
    publisherId = (await first<{ id: number }>(db,
      'SELECT id FROM publishers WHERE platform = ? AND external_id = ?', store.platform, publisherExternalId))?.id ?? null
  }

  const categoryId = await resolveCategoryId(db, store)

  await db.prepare(`INSERT INTO apps
    (platform, external_id, publisher_id, category_id, display_name, icon_url, origin_country_code,
     supported_locales, original_release_date, is_free, discovered_from, discovered_at,
     last_synced_at, is_available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(platform, external_id) DO UPDATE SET
      publisher_id=excluded.publisher_id, category_id=excluded.category_id,
      display_name=excluded.display_name, icon_url=excluded.icon_url,
      supported_locales=excluded.supported_locales, original_release_date=excluded.original_release_date,
      is_free=excluded.is_free, last_synced_at=excluded.last_synced_at,
      is_available=1, updated_at=excluded.updated_at`)
    .bind(store.platform, store.external_id, publisherId, categoryId, store.name, store.icon_url, country,
      JSON.stringify(store.supported_locales), store.original_release_date, store.is_free ? 1 : 0,
      options.discoveredFrom ?? 'api', now, now, now, now).run()

  const app = await first<{ id: number }>(db,
    'SELECT id FROM apps WHERE platform = ? AND external_id = ?', store.platform, store.external_id)
  if (!app) throw new Error('App persistence failed')

  let versionId: number | null = null
  if (store.version) {
    await db.prepare(`INSERT INTO app_versions
      (app_id, version, release_date, whats_new, file_size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_id, version) DO UPDATE SET release_date=excluded.release_date,
        whats_new=excluded.whats_new, file_size_bytes=COALESCE(excluded.file_size_bytes,app_versions.file_size_bytes), updated_at=excluded.updated_at`)
      .bind(app.id, store.version, store.current_version_release_date, store.whats_new, store.file_size_bytes, now, now).run()
    versionId = (await first<{ id: number }>(db,
      'SELECT id FROM app_versions WHERE app_id = ? AND version = ?', app.id, store.version))?.id ?? null
  }

  const listingPayload = JSON.stringify({
    title: store.name,
    subtitle: store.subtitle,
    promotional_text: store.promotional_text,
    description: store.description,
    whats_new: store.whats_new,
    screenshots: store.screenshots,
    icon_url: store.icon_url,
    video_url: store.video_url,
    price: store.price,
    currency: store.currency,
  })
  const checksum = await sha256(listingPayload)
  const prior = await first<{ id: number; version_id: number | null; checksum: string; title: string; subtitle: string | null; description: string; whats_new: string | null; screenshots: string }>(db,
    'SELECT id, version_id, checksum, title, subtitle, description, whats_new, screenshots FROM app_store_listings WHERE app_id = ? AND locale = ? ORDER BY id DESC LIMIT 1',
    app.id, locale)
  if (prior && versionId !== null && prior.version_id !== null && prior.version_id !== versionId && prior.checksum !== checksum) {
    const changed: Array<[string, string | null, string | null]> = [
      ['title', prior.title, store.name],
      ['subtitle', prior.subtitle, store.subtitle],
      ['description', prior.description, store.description],
      ['whats_new', prior.whats_new, store.whats_new],
      ['screenshots', prior.screenshots, JSON.stringify(store.screenshots)],
    ]
    for (const [field, before, after] of changed) {
      if (before !== after) {
        await db.prepare(`INSERT OR IGNORE INTO app_store_listing_changes
          (app_id, version_id, locale, field_changed, old_value, new_value, detected_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(app.id, versionId, locale, field, before, after, now, now, now).run()
      }
    }
  }
  await db.prepare(`INSERT INTO app_store_listings
    (app_id, version_id, locale, title, subtitle, promotional_text, description, whats_new,
     screenshots, icon_url, video_url, price, currency, fetched_at, checksum, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle,
      promotional_text=excluded.promotional_text, description=excluded.description,
      whats_new=excluded.whats_new, screenshots=excluded.screenshots, icon_url=excluded.icon_url,
      video_url=excluded.video_url, price=excluded.price, currency=excluded.currency,
      fetched_at=excluded.fetched_at, checksum=excluded.checksum, updated_at=excluded.updated_at`)
    .bind(app.id, versionId, locale, store.name, store.subtitle, store.promotional_text, store.description,
      store.whats_new, JSON.stringify(store.screenshots), store.icon_url, store.video_url,
      store.price, store.currency, now, checksum, now, now).run()

  await db.prepare(`INSERT INTO app_metrics
    (app_id, version_id, country_code, date, rating, rating_count, is_available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(app_id, country_code, date) DO UPDATE SET rating=excluded.rating,
      rating_count=excluded.rating_count, is_available=1, updated_at=excluded.updated_at`)
    .bind(app.id, versionId, country, now.slice(0, 10), store.rating ?? 0, store.rating_count ?? 0, now, now).run()
  return app.id
}

export async function detectLocaleChanges(db: Database, appId: number, currentVersionId: number | null): Promise<void> {
  if (currentVersionId === null) return
  const previous = await first<{ id: number }>(db,
    'SELECT id FROM app_versions WHERE app_id=? AND id<? ORDER BY id DESC LIMIT 1', appId, currentVersionId)
  if (!previous) return
  const previousRows = await db.prepare('SELECT locale,title FROM app_store_listings WHERE app_id=? AND version_id=?')
    .bind(appId, previous.id).all<{ locale: string; title: string }>()
  const currentRows = await db.prepare('SELECT locale,title FROM app_store_listings WHERE app_id=? AND version_id=?')
    .bind(appId, currentVersionId).all<{ locale: string; title: string }>()
  const previousLocales = new Map((previousRows.results ?? []).map((row) => [row.locale, row.title]))
  const currentLocales = new Map((currentRows.results ?? []).map((row) => [row.locale, row.title]))
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  for (const [locale, title] of currentLocales) if (!previousLocales.has(locale)) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO app_store_listing_changes
      (app_id,version_id,locale,field_changed,old_value,new_value,detected_at,created_at,updated_at)
      VALUES (?,? ,?,'locale_added',NULL,?,?,?,?)`).bind(appId, currentVersionId, locale, title, now, now, now))
  }
  for (const [locale, title] of previousLocales) if (!currentLocales.has(locale)) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO app_store_listing_changes
      (app_id,version_id,locale,field_changed,old_value,new_value,detected_at,created_at,updated_at)
      VALUES (?,? ,?,'locale_removed',?,NULL,?,?,?)`).bind(appId, currentVersionId, locale, title, now, now, now))
  }
  if (statements.length) await db.batch(statements)
}
