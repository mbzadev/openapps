/// <reference path="../../workers/jobs/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createExecutionContext, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import api from '../../workers/web/src/api.js'
import type { JobMessage } from '../../packages/core/src/messages.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }
beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS))

describe('legacy /api/v1 behavior in workerd', () => {
  it('preserves account, folder, app, analytics, sync and competitor rules', async () => {
    const queued: JobMessage[] = []
    const queue = { send: async (body: JobMessage) => { queued.push(body) } }
    const bindings = {
      ...testEnv,
      AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
      API_RATE_LIMITER: { limit: async () => ({ success: true }) },
      SYNC_TRACKED_IOS: queue, SYNC_TRACKED_ANDROID: queue,
      SYNC_ON_DEMAND_IOS: queue, SYNC_ON_DEMAND_ANDROID: queue,
      CHARTS_IOS: queue, CHARTS_ANDROID: queue, RECONCILE: queue,
      APP_NAME: 'OpenApps', APP_URL: 'https://apps.mbza.dev', ENVIRONMENT: 'test', TRACKED_APP_REFRESH_HOURS: '24',
    }
    let token = ''
    const call = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      if (init.body) headers.set('Content-Type', 'application/json')
      return api.fetch(new Request(`https://apps.mbza.dev${path}`, { ...init, headers }), bindings as never, createExecutionContext())
    }

    const registration = await call('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Legacy User', email: 'legacy@example.test', password: 'Password!234', password_confirmation: 'Password!234' }) })
    expect(registration.status).toBe(201)
    token = ((await registration.json()) as { token: string }).token

    const profile = await call('/account/profile', { method: 'PATCH', body: JSON.stringify({ name: 'Updated only', email: 'legacy@example.test' }) })
    expect(profile.status).toBe(200)
    expect((await profile.json() as { name: string }).name).toBe('Updated only')

    const now = new Date().toISOString()
    const insertApp = async (id: string) => Number((await testEnv.DB.prepare(`INSERT INTO apps
      (platform,external_id,display_name,origin_country_code,discovered_from,discovered_at,created_at,updated_at)
      VALUES ('ios',?,?, 'us','test',?,?,?) RETURNING id`).bind(id, id, now, now, now).first<{ id: number }>())!.id)
    const parentId = await insertApp('com.example.parent')
    const rivalId = await insertApp('com.example.rival')
    await insertApp('com.example.untracked')
    const refreshId = await insertApp('com.example.refresh-window')
    const freshId = await insertApp('com.example.fresh-status')

    await testEnv.DB.prepare('UPDATE apps SET last_synced_at=? WHERE id=?').bind(now, freshId).run()
    const freshStatus = await call('/apps/ios/com.example.fresh-status/sync-status')
    expect(freshStatus.status).toBe(200)
    expect(await freshStatus.json()).toMatchObject({ app_id: freshId, status: 'completed', completed_at: now })
    expect(await testEnv.DB.prepare('SELECT id FROM sync_statuses WHERE app_id=?').bind(freshId).first()).toBeNull()

    expect((await call('/apps', { method: 'POST', body: JSON.stringify({ platform: 'ios', external_id: 'com.example.parent' }) })).status).toBe(201)
    expect((await call('/apps?folder_id=unassigned')).status).toBe(200)
    expect((await call('/apps/ios/com.example.untracked/folder', { method: 'PATCH', body: JSON.stringify({ folder_id: null }) })).status).toBe(404)
    expect((await call('/apps/ios/missing/ratings/summary')).status).toBe(404)
    expect((await call('/apps/ios/missing/ratings/history')).status).toBe(404)
    expect((await call('/apps/ios/missing/rankings')).status).toBe(404)
    expect((await call('/apps/ios/missing/keywords')).status).toBe(404)

    const missingListing = await call('/apps/ios/com.example.untracked/listing?country_code=us&locale=en-US')
    expect(missingListing.status).toBe(404)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ kind: 'app.sync', platform: 'ios', appId: expect.any(Number), source: 'on-demand' })
    queued.length = 0

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    await testEnv.DB.prepare('UPDATE apps SET last_synced_at=? WHERE id=?').bind(twoHoursAgo, refreshId).run()
    expect((await call('/apps/ios/com.example.refresh-window')).status).toBe(200)
    expect(queued).toHaveLength(0)
    bindings.TRACKED_APP_REFRESH_HOURS = '1'
    expect((await call('/apps/ios/com.example.refresh-window')).status).toBe(200)
    expect(queued).toHaveLength(1)
    queued.length = 0
    bindings.TRACKED_APP_REFRESH_HOURS = '24'

    const firstSync = await call('/apps/ios/com.example.parent/sync', { method: 'POST' })
    expect(firstSync.status).toBe(200)
    expect(await firstSync.json()).toMatchObject({ app_id: parentId, status: 'queued', progress: { done: 0, total: 1 }, failed_items: [], failed_items_count: 0 })
    expect((await call('/apps/ios/com.example.parent/sync', { method: 'POST' })).status).toBe(200)
    expect(queued).toHaveLength(1)
    await testEnv.DB.prepare("UPDATE sync_statuses SET updated_at=datetime('now','-5 minutes') WHERE app_id=?").bind(parentId).run()
    expect((await call('/apps/ios/com.example.parent/sync', { method: 'POST' })).status).toBe(200)
    expect(queued).toHaveLength(2)

    const competitor = await call('/apps/ios/com.example.parent/competitors', { method: 'POST', body: JSON.stringify({ competitor_app_id: rivalId, relationship: 'indirect' }) })
    expect(competitor.status).toBe(201)
    expect(await competitor.json()).toMatchObject({ relationship: 'indirect', app: { id: rivalId, external_id: 'com.example.rival' } })
    expect((await testEnv.DB.prepare('SELECT count(*) AS count FROM user_apps WHERE app_id=?').bind(parentId).first<{ count: number }>())!.count).toBe(1)
    expect((await testEnv.DB.prepare('SELECT count(*) AS count FROM user_apps WHERE app_id=?').bind(rivalId).first<{ count: number }>())!.count).toBe(0)

    const date = (offset: number) => {
      const value = new Date()
      value.setUTCHours(0, 0, 0, 0)
      value.setUTCDate(value.getUTCDate() + offset)
      return value.toISOString().slice(0, 10)
    }
    const metric = async (country: string, offset: number, rating: number, count: number, breakdown: Record<string, number>) => {
      await testEnv.DB.prepare(`INSERT INTO app_metrics
        (app_id,country_code,date,rating,rating_count,rating_breakdown,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(parentId, country, date(offset), rating, count, JSON.stringify(breakdown), now, now).run()
    }
    await metric('us', -30, 4, 10, { 4: 4, 5: 6 })
    await metric('fr', -30, 2, 10, { 2: 10 })
    await metric('us', 0, 5, 30, { 5: 30 })
    await metric('fr', 0, 3, 10, { 3: 10 })

    const summary = await call('/apps/ios/com.example.parent/ratings/summary')
    expect(summary.status).toBe(200)
    expect(await summary.json()).toEqual({ rating: 4.5, rating_count: 40, breakdown: { 1: 0, 2: 0, 3: 10, 4: 0, 5: 30 }, trend: { rating_delta_30d: 1.5, rating_count_delta_30d: 20 } })
    const history = await call('/apps/ios/com.example.parent/ratings/history?days=2')
    expect(await history.json()).toEqual([
      { date: date(-1), rating: null, rating_count: null, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, delta_total: null, delta_breakdown: null },
      { date: date(0), rating: 4.5, rating_count: 40, breakdown: { 1: 0, 2: 0, 3: 10, 4: 0, 5: 30 }, delta_total: 20, delta_breakdown: { 1: 0, 2: -10, 3: 10, 4: -4, 5: 24 } },
    ])

    const rootCategory = await testEnv.DB.prepare("SELECT id FROM store_categories WHERE platform='ios' AND external_id IS NULL").first<{ id: number }>()
    expect(rootCategory).not.toBeNull()
    const chart = async (offset: number) => Number((await testEnv.DB.prepare(`INSERT INTO trending_charts
      (platform,collection,category_id,country_code,snapshot_date,created_at,updated_at)
      VALUES ('ios','top_free',?,'us',?,?,?) RETURNING id`).bind(rootCategory!.id, date(offset), now, now).first<{ id: number }>())!.id)
    const oldChart = await chart(-1), currentChart = await chart(0)
    await testEnv.DB.prepare('INSERT INTO trending_chart_entries (trending_chart_id,rank,app_id,price,currency) VALUES (?,?,?,?,?)').bind(oldChart, 5, parentId, 0, 'USD').run()
    await testEnv.DB.prepare('INSERT INTO trending_chart_entries (trending_chart_id,rank,app_id,price,currency) VALUES (?,?,?,?,?)').bind(currentChart, 2, parentId, 0, 'USD').run()

    const rankings = await call(`/apps/ios/com.example.parent/rankings?date=${date(0)}&collection=top_free`)
    expect(await rankings.json()).toEqual([expect.objectContaining({ snapshot_date: date(0), rank: 2, previous_rank: 5, rank_change: 3, status: 'up' })])
    expect((await call('/charts')).status).toBe(422)
    const charts = await call('/charts?platform=ios&collection=top_free')
    expect(await charts.json()).toMatchObject({
      data: [{ app_id: parentId, app_name: 'com.example.parent', rank: 2, rank_change: 3, is_free: true }],
      meta: { platform: 'ios', collection: 'top_free', country_code: 'us', snapshot_date: date(0) },
    })

    const folderResponse = await call('/folders', { method: 'POST', body: JSON.stringify({ name: 'Watch', color: 'blue' }) })
    const folderId = (await folderResponse.json() as { id: number }).id
    await call('/apps/ios/com.example.parent/folder', { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) })
    const change = async (appId: number, field: string) => testEnv.DB.prepare(`INSERT INTO app_store_listing_changes
      (app_id,locale,field_changed,old_value,new_value,detected_at,created_at,updated_at) VALUES (?,'en-US',?,'old','new',?,?,?)`)
      .bind(appId, field, now, now, now).run()
    await change(parentId, 'description')
    await change(rivalId, 'title')
    const trackedChanges = await call(`/changes/apps?folder_id=${folderId}&field=description&search=parent`)
    expect(await trackedChanges.json()).toMatchObject({ data: [{ field_changed: 'description', app: { id: parentId, name: 'com.example.parent' } }], meta: { per_page: 50, total: 1 } })
    const competitorChanges = await call(`/changes/competitors?folder_id=${folderId}`)
    expect(await competitorChanges.json()).toMatchObject({ data: [{ field_changed: 'title', app: { id: rivalId } }], meta: { total: 1 } })
    expect((await call('/changes/apps?folder_id=999999')).status).toBe(422)

    expect((await call('/apps/ios/missing/track', { method: 'POST' })).status).toBe(404)
    expect((await call('/apps/ios/com.example.rival/track', { method: 'POST' })).status).toBe(204)
    expect((await call('/apps/ios/com.example.rival/track', { method: 'DELETE' })).status).toBe(204)
    expect((await call('/apps/ios/com.example.parent/listing')).status).toBe(422)

    const versionId = Number((await testEnv.DB.prepare(`INSERT INTO app_versions
      (app_id,version,created_at,updated_at) VALUES (?,'1.0',?,?) RETURNING id`).bind(parentId, now, now).first<{ id: number }>())!.id)
    const screenshots = [{ url: 'https://cdn.example.test/1.png', device_type: 'iphone', order: 1 }]
    await testEnv.DB.prepare(`INSERT INTO app_store_listings
      (app_id,version_id,locale,title,subtitle,description,whats_new,screenshots,icon_url,price,fetched_at,checksum,created_at,updated_at)
      VALUES (?,?,'en-US','Photo Editor Studio','Photo Editor Pro','Photo editor photo editor studio with tools','New photo features',?,'https://cdn.example.test/icon.png',0,?,'fixture',?,?)`)
      .bind(parentId, versionId, JSON.stringify(screenshots), now, now, now).run()
    await testEnv.DB.prepare(`INSERT INTO app_store_listings
      (app_id,version_id,locale,title,subtitle,description,whats_new,screenshots,price,fetched_at,checksum,created_at,updated_at)
      VALUES (?,NULL,'en-US','Rival Editor',NULL,'Photo filters and studio tools',NULL,'[]',0,?,'rival-fixture',?,?)`)
      .bind(rivalId, now, now, now).run()
    await testEnv.DB.prepare("UPDATE apps SET icon_url='https://cdn.example.test/icon.png',last_synced_at=?,category_id=? WHERE id=?")
      .bind(now, rootCategory!.id, parentId).run()
    const keywords = await call('/apps/ios/com.example.parent/keywords?ngram=1')
    const keywordPayload = await keywords.json() as { data: Array<Record<string, unknown>>; meta: { total: number } }
    expect(keywordPayload.data[0]).toMatchObject({ locale: 'en-US', ngram_size: 1, keyword: 'photo' })
    expect(keywordPayload.meta.total).toBeGreaterThan(1)
    const compare = await call(`/apps/ios/com.example.parent/keywords/compare?app_ids[]=${rivalId}`)
    expect(compare.status).toBe(200)
    expect(await compare.json()).toMatchObject({
      apps: [{ id: rivalId, name: 'com.example.rival', versions: [] }],
      keywords: { [rivalId]: { photo: { count: 1, density: expect.any(Number) } } },
    })

    const countryBreakdown = await call('/apps/ios/com.example.parent/ratings/country-breakdown')
    expect(await countryBreakdown.json()).toMatchObject({ supported: true, data: [expect.objectContaining({ country_code: 'fr' }), expect.objectContaining({ country_code: 'us' })] })
    const countries = await call('/countries')
    expect((await countries.json() as Array<{ code: string }>).some((country) => country.code === 'zz')).toBe(false)
    expect((await call('/store-categories?platform=windows')).status).toBe(422)

    const groups = await call(`/competitors?folder_id=${folderId}`)
    expect(await groups.json()).toMatchObject([{ parent: { id: parentId }, competitors: [{ app: { id: rivalId } }] }])
    const dashboard = await call('/dashboard')
    expect(await dashboard.json()).toMatchObject({ total_apps: 1, total_versions: 1, total_changes: 1, recent_changes: [{ app_name: 'com.example.parent' }] })
    const icons = await call('/explorer/icons?platform=ios&search=parent')
    expect(await icons.json()).toMatchObject({ data: [{ app_id: parentId, category_name: expect.any(String) }], meta: { per_page: 48, total: 1 } })
    const screenshotFeed = await call('/explorer/screenshots?platform=ios')
    expect(await screenshotFeed.json()).toMatchObject({ data: [{ app_id: parentId, screenshots }], meta: { per_page: 12, total: 1 } })

    const publisherId = Number((await testEnv.DB.prepare(`INSERT INTO publishers
      (platform,external_id,name,url,created_at,updated_at) VALUES ('ios','pub-1','Publisher One','https://publisher.test',?,?) RETURNING id`)
      .bind(now, now).first<{ id: number }>())!.id)
    await testEnv.DB.prepare('UPDATE apps SET publisher_id=? WHERE id=?').bind(publisherId, parentId).run()
    expect(await (await call('/publishers')).json()).toMatchObject([{ id: publisherId, apps_count: 1 }])
    expect(await (await call('/publishers/ios/pub-1')).json()).toMatchObject({ publisher: { id: publisherId, name: 'Publisher One' }, apps: [{ id: parentId }] })
    expect((await call('/publishers/ios/pub-1/import', { method: 'POST', body: JSON.stringify({ external_ids: ['com.example.parent'] }) })).status).toBe(204)

    const advertiserId = Number((await testEnv.DB.prepare(`INSERT INTO ad_advertisers
      (source,source_advertiser_id,name,domain,created_at,updated_at) VALUES ('meta','page-1','Publisher One','publisher.test',?,?) RETURNING id`)
      .bind(now, now).first<{ id: number }>())!.id)
    const adId = Number((await testEnv.DB.prepare(`INSERT INTO ads
      (advertiser_id,source,source_ad_id,status,headline,body,platforms,languages,first_collected_at,last_collected_at,created_at,updated_at)
      VALUES (?,'meta','ad-1','active','Install Parent','Public copy','["facebook"]','["en"]',?,?,?,?) RETURNING id`)
      .bind(advertiserId, now, now, now, now).first<{ id: number }>())!.id)
    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO ad_creative_variants(ad_id,source_variant_id,format,position,created_at,updated_at) VALUES (?,'variant-1','image',0,?,?)").bind(adId, now, now),
      testEnv.DB.prepare("INSERT INTO ad_regions(ad_id,country_code,created_at) VALUES (?,'us',?)").bind(adId, now),
      testEnv.DB.prepare("INSERT INTO ad_app_links(ad_id,app_id,confidence,match_reason,created_at,updated_at) VALUES (?,?,'certain','store_id',?,?)").bind(adId, parentId, now, now),
    ])
    const variantId = (await testEnv.DB.prepare("SELECT id FROM ad_creative_variants WHERE ad_id=? AND source_variant_id='variant-1'").bind(adId).first<{ id: number }>())!.id
    const assetId = Number((await testEnv.DB.prepare(`INSERT INTO ad_assets
      (sha256,r2_key,media_type,mime_type,byte_size,created_at,updated_at) VALUES (?,'assets/test','image','image/png',4,?,?) RETURNING id`)
      .bind('a'.repeat(64), now, now).first<{ id: number }>())!.id)
    await testEnv.DB.prepare("INSERT INTO ad_creative_assets(variant_id,asset_id,role,position,created_at) VALUES (?,?,'primary',0,?)").bind(variantId, assetId, now).run()
    const newerAdId = Number((await testEnv.DB.prepare(`INSERT INTO ads
      (advertiser_id,source,source_ad_id,status,headline,body,platforms,languages,started_at,first_collected_at,last_collected_at,created_at,updated_at)
      VALUES (?,'meta','ad-without-media','active','Newer without media','Public copy','["facebook"]','["en"]','2099-01-01',?,?,?,?) RETURNING id`)
      .bind(advertiserId, now, now, now, now).first<{ id: number }>())!.id)
    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO ad_regions(ad_id,country_code,created_at) VALUES (?,'us',?)").bind(newerAdId, now),
      testEnv.DB.prepare("INSERT INTO ad_app_links(ad_id,app_id,confidence,match_reason,created_at,updated_at) VALUES (?,?,'strong','advertiser_alias',?,?)").bind(newerAdId, parentId, now, now),
    ])
    const unrelatedAdId = Number((await testEnv.DB.prepare(`INSERT INTO ads
      (source,source_ad_id,status,headline,platforms,languages,first_collected_at,last_collected_at,created_at,updated_at)
      VALUES ('google','unrelated-ad','active','Unrelated advertiser','[]','[]',?,?,?,?) RETURNING id`)
      .bind(now, now, now, now).first<{ id: number }>())!.id)
    const creatives = await call('/creatives?source=meta&country=us')
    expect(creatives.status).toBe(200)
    expect(await creatives.json()).toMatchObject({
      data: [
        { id: adId, source: 'meta', headline: 'Install Parent', advertiser: { id: advertiserId }, preview: { url: `/api/v1/creative-assets/${'a'.repeat(64)}` } },
        { id: newerAdId, headline: 'Newer without media', preview: null },
      ],
      meta: { total: 2 },
    })
    const appCreatives = await (await call('/apps/ios/com.example.parent/creatives')).json() as { data: Array<{ id: number }>; meta: { total: number } }
    expect(appCreatives).toMatchObject({ data: [{ id: adId }, { id: newerAdId }], meta: { total: 2 } })
    expect(appCreatives.data.some((creative) => creative.id === unrelatedAdId)).toBe(false)
    expect((await call('/apps/ios/com.example.parent/creatives/sync', { method: 'POST' })).status).toBe(202)
  }, 30_000)
})
