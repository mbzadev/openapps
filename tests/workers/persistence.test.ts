/// <reference path="../../workers/jobs/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { detectLocaleChanges, persistStoreApp, type StoreApp } from '../../packages/scrapers/src/index.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }
beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS))

function store(overrides: Partial<StoreApp> = {}): StoreApp {
  return {
    platform: 'ios', external_id: 'persist.app', name: 'Title A', publisher_name: 'MBZA', publisher_external_id: 'mbza', publisher_url: null,
    category: 'Utilities', category_id: '6002', icon_url: null, rating: 4.5, rating_count: 100, is_free: true, price: 0, currency: 'USD',
    version: '1.0', current_version_release_date: '2026-08-01', original_release_date: '2026-01-01', supported_locales: ['en-US'],
    content_rating: '4+', description: 'Description A', subtitle: 'Subtitle A', promotional_text: null, whats_new: 'News A',
    screenshots: [{ url: 'https://cdn.example/a.png', device_type: 'iphone', order: 0 }], video_url: null, file_size_bytes: 123,
    ...overrides,
  }
}

describe('idempotent storefront persistence', () => {
  it('detects field transitions only across versions and preserves known file size', async () => {
    const appId = await persistStoreApp(testEnv.DB, store(), { country: 'us', locale: 'en-US', discoveredFrom: 'test' })
    await persistStoreApp(testEnv.DB, store({ name: 'Same-version refresh', file_size_bytes: null }), { country: 'us', locale: 'en-US', discoveredFrom: 'test' })
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM app_store_listing_changes WHERE app_id=?').bind(appId).first()).toEqual({ count: 0 })
    expect(await testEnv.DB.prepare("SELECT file_size_bytes FROM app_versions WHERE app_id=? AND version='1.0'").bind(appId).first()).toEqual({ file_size_bytes: 123 })

    const next = store({ version: '2.0', name: 'Title B', subtitle: 'Subtitle B', description: 'Description B', whats_new: 'News B', screenshots: [{ url: 'https://cdn.example/b.png', device_type: 'iphone', order: 0 }], file_size_bytes: 456 })
    await persistStoreApp(testEnv.DB, next, { country: 'us', locale: 'en-US', discoveredFrom: 'test' })
    const fields = (await testEnv.DB.prepare('SELECT field_changed FROM app_store_listing_changes WHERE app_id=? ORDER BY field_changed').bind(appId).all<{ field_changed: string }>()).results.map((row) => row.field_changed)
    expect(fields).toEqual(['description', 'screenshots', 'subtitle', 'title', 'whats_new'])

    await persistStoreApp(testEnv.DB, { ...next, name: 'Second same-version refresh' }, { country: 'us', locale: 'en-US', discoveredFrom: 'test' })
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM app_store_listing_changes WHERE app_id=?').bind(appId).first()).toEqual({ count: 5 })
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM app_metrics WHERE app_id=? AND country_code=?').bind(appId, 'us').first()).toEqual({ count: 1 })
  })

  it('records added and removed locales once when the storefront fan-out completes', async () => {
    const externalId = 'locale.app'
    const appId = await persistStoreApp(testEnv.DB, store({ external_id: externalId, name: 'English', version: '1.0' }), { country: 'us', locale: 'en-US', discoveredFrom: 'test' })
    await persistStoreApp(testEnv.DB, store({ external_id: externalId, name: 'Français', version: '1.0' }), { country: 'fr', locale: 'fr-FR', discoveredFrom: 'test' })
    await persistStoreApp(testEnv.DB, store({ external_id: externalId, name: 'English', version: '2.0' }), { country: 'us', locale: 'en-US', discoveredFrom: 'test' })
    await persistStoreApp(testEnv.DB, store({ external_id: externalId, name: 'Türkçe', version: '2.0' }), { country: 'tr', locale: 'tr-TR', discoveredFrom: 'test' })
    const current = await testEnv.DB.prepare("SELECT id FROM app_versions WHERE app_id=? AND version='2.0'").bind(appId).first<{ id: number }>()
    await detectLocaleChanges(testEnv.DB, appId, current!.id)
    await detectLocaleChanges(testEnv.DB, appId, current!.id)
    expect(await testEnv.DB.prepare("SELECT locale,field_changed,old_value,new_value FROM app_store_listing_changes WHERE app_id=? AND field_changed LIKE 'locale_%' ORDER BY field_changed").bind(appId).all()).toMatchObject({
      results: [
        { locale: 'tr-TR', field_changed: 'locale_added', old_value: null, new_value: 'Türkçe' },
        { locale: 'fr-FR', field_changed: 'locale_removed', old_value: 'Français', new_value: null },
      ],
    })
  })

  it('falls back to a case-insensitive category-name lookup when the store has no category id', async () => {
    const appId = await persistStoreApp(testEnv.DB, store({ platform: 'android', external_id: 'category.app', category_id: null, category: '  tools  ' }), { country: 'us', locale: 'en-US', discoveredFrom: 'test' })
    expect(await testEnv.DB.prepare(`SELECT sc.name FROM apps a JOIN store_categories sc ON sc.id=a.category_id WHERE a.id=?`).bind(appId).first()).toEqual({ name: 'Tools' })
  })
})
