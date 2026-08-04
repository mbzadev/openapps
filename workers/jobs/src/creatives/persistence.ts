import { all, first, normalizeAdvertiserAlias, nowIso, type AdCreativeRecord, type AdSource, type JobMessage } from '@openapps/core'
import type { Env } from '../env.js'
import type { ConnectorResult, CreativeTarget } from './connectors.js'

export interface CollectionTargetRow extends CreativeTarget {
  publisherId: number | null
}

async function stableId(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function storeIdentity(url: string | null) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const android = parsed.searchParams.get('id')
    if (android && (parsed.hostname === 'play.google.com' || parsed.hostname.endsWith('.play.google.com'))) return { platform: 'android', externalId: android }
    const ios = parsed.pathname.match(/\/id(\d+)(?:\/|$)/)?.[1]
    if (ios && (parsed.hostname === 'apps.apple.com' || parsed.hostname.endsWith('.apps.apple.com'))) return { platform: 'ios', externalId: ios }
  } catch { /* An invalid landing URL cannot produce a certain match. */ }
  return null
}

function hostname(url: string | null) {
  if (!url) return null
  try { return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, '') } catch { return null }
}

function companyAlias(value: string) {
  return normalizeAdvertiserAlias(value).replace(/\s+(incorporated|inc|limited|ltd|llc|corp|corporation)$/, '')
}

async function linkPublisherApps(env: Env, adId: number, publisherId: number, publisherName: string, matchReason: 'developer_domain' | 'advertiser_alias', now: string) {
  const apps = await all<{ id: number }>(env.DB, `SELECT ap.id FROM apps ap JOIN publishers p ON p.id=ap.publisher_id
    WHERE ap.publisher_id=? OR p.name=? COLLATE NOCASE`, publisherId, publisherName)
  for (const app of apps) {
    await env.DB.prepare(`INSERT INTO ad_app_links (ad_id,app_id,confidence,match_reason,created_at,updated_at)
      VALUES (?,?,'strong',?,?,?) ON CONFLICT(ad_id,app_id) WHERE app_id IS NOT NULL DO UPDATE SET
      confidence=CASE WHEN ad_app_links.confidence='certain' THEN ad_app_links.confidence ELSE 'strong' END,
      match_reason=CASE WHEN ad_app_links.confidence='certain' THEN ad_app_links.match_reason ELSE excluded.match_reason END,
      updated_at=excluded.updated_at`).bind(adId, app.id, matchReason, now, now).run()
  }
  return apps.length
}

async function persistAdvertiser(env: Env, record: AdCreativeRecord) {
  const now = nowIso()
  let existing = record.advertiser.sourceId
    ? await first<{ id: number }>(env.DB, 'SELECT id FROM ad_advertisers WHERE source=? AND source_advertiser_id=?', record.source, record.advertiser.sourceId)
    : null
  if (!existing) existing = await first<{ id: number }>(env.DB, `SELECT id FROM ad_advertisers WHERE source=? AND name=? COLLATE NOCASE
    AND ifnull(domain,'')=ifnull(?,'') ORDER BY id LIMIT 1`, record.source, record.advertiser.name, record.advertiser.domain)
  if (existing) {
    await env.DB.prepare(`UPDATE ad_advertisers SET source_advertiser_id=COALESCE(source_advertiser_id,?),name=?,domain=COALESCE(?,domain),
      source_url=COALESCE(?,source_url),updated_at=? WHERE id=?`).bind(record.advertiser.sourceId, record.advertiser.name, record.advertiser.domain, record.advertiser.sourceUrl, now, existing.id).run()
    return existing.id
  }
  const inserted = await env.DB.prepare(`INSERT INTO ad_advertisers (source,source_advertiser_id,name,domain,source_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?) RETURNING id`).bind(record.source, record.advertiser.sourceId, record.advertiser.name, record.advertiser.domain, record.advertiser.sourceUrl, now, now).first<{ id: number }>()
  if (!inserted) throw new Error('ADVERTISER_INSERT_FAILED')
  return inserted.id
}

async function linkAd(env: Env, adId: number, advertiserId: number, record: AdCreativeRecord, target: CollectionTargetRow) {
  const now = nowIso()
  const certain = storeIdentity(record.landingUrl) ?? record.variants.map((variant) => storeIdentity(variant.landingUrl)).find(Boolean)
  if (certain) {
    const app = await first<{ id: number }>(env.DB, 'SELECT id FROM apps WHERE platform=? AND external_id=?', certain.platform, certain.externalId)
    if (app) {
      await env.DB.prepare(`INSERT INTO ad_app_links (ad_id,app_id,confidence,match_reason,created_at,updated_at) VALUES (?,?,'certain','store_id',?,?)
        ON CONFLICT(ad_id,app_id) WHERE app_id IS NOT NULL DO UPDATE SET confidence='certain',match_reason='store_id',updated_at=excluded.updated_at`).bind(adId, app.id, now, now).run()
      return { linked: 1, candidate: 0 }
    }
  }

  const landingDomain = hostname(record.landingUrl)
  if (landingDomain && target.developerDomain && (landingDomain === target.developerDomain || landingDomain.endsWith(`.${target.developerDomain}`)) && target.publisherId) {
    const linked = await linkPublisherApps(env, adId, target.publisherId, target.displayName, 'developer_domain', now)
    if (linked) return { linked, candidate: 0 }
  }

  // A Google transparency result is returned only after the connector has selected
  // a concrete advertiser identity for this publisher target. Keep that verified
  // source identity linked to every iOS/Android app owned by the publisher.
  if (record.source === 'google' && record.advertiser.sourceId && target.publisherId) {
    const alias = companyAlias(record.advertiser.name)
    if (alias) {
      await env.DB.prepare(`INSERT INTO ad_advertiser_aliases (advertiser_id,alias,normalized_alias,is_verified,created_at,updated_at)
        VALUES (?,?,?,1,?,?) ON CONFLICT(advertiser_id,normalized_alias) DO UPDATE SET is_verified=1,updated_at=excluded.updated_at`)
        .bind(advertiserId, record.advertiser.name, alias, now, now).run()
    }
    const linked = await linkPublisherApps(env, adId, target.publisherId, target.displayName, 'advertiser_alias', now)
    if (linked) return { linked, candidate: 0 }
  }

  const alias = companyAlias(record.advertiser.name)
  const targetAlias = companyAlias(target.displayName)
  if (alias && alias === targetAlias && target.publisherId) {
    await env.DB.prepare(`INSERT INTO ad_advertiser_aliases (advertiser_id,alias,normalized_alias,is_verified,created_at,updated_at)
      VALUES (?,?,?,1,?,?) ON CONFLICT(advertiser_id,normalized_alias) DO UPDATE SET is_verified=1,updated_at=excluded.updated_at`)
      .bind(advertiserId, record.advertiser.name, alias, now, now).run()
    const linked = await linkPublisherApps(env, adId, target.publisherId, target.displayName, 'advertiser_alias', now)
    if (linked) return { linked, candidate: 0 }
  }

  await env.DB.prepare(`INSERT INTO ad_app_links (ad_id,candidate_name,confidence,match_reason,created_at,updated_at)
    SELECT ?,?,'candidate','name_only',?,? WHERE NOT EXISTS (SELECT 1 FROM ad_app_links WHERE ad_id=? AND app_id IS NULL AND candidate_name=?)`)
    .bind(adId, record.advertiser.name, now, now, adId, record.advertiser.name).run()
  return { linked: 0, candidate: 1 }
}

async function persistRecord(env: Env, target: CollectionTargetRow, record: AdCreativeRecord, rawKey: string) {
  const advertiserId = await persistAdvertiser(env, record)
  const existing = await first<{ id: number }>(env.DB, 'SELECT id FROM ads WHERE source=? AND source_ad_id=?', record.source, record.sourceAdId)
  const now = nowIso()
  await env.DB.prepare(`INSERT INTO ads
    (advertiser_id,source,source_ad_id,source_url,status,headline,body,call_to_action,landing_url,platforms,languages,
     started_at,ended_at,impressions_min,impressions_max,reach_min,reach_max,spend_min,spend_max,currency,
     first_collected_at,last_collected_at,raw_r2_key,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source,source_ad_id) DO UPDATE SET advertiser_id=excluded.advertiser_id,source_url=excluded.source_url,
      status=excluded.status,headline=excluded.headline,body=excluded.body,call_to_action=excluded.call_to_action,
      landing_url=excluded.landing_url,platforms=excluded.platforms,languages=excluded.languages,started_at=excluded.started_at,
      ended_at=excluded.ended_at,impressions_min=excluded.impressions_min,impressions_max=excluded.impressions_max,
      reach_min=excluded.reach_min,reach_max=excluded.reach_max,spend_min=excluded.spend_min,spend_max=excluded.spend_max,
      currency=excluded.currency,last_collected_at=excluded.last_collected_at,raw_r2_key=excluded.raw_r2_key,updated_at=excluded.updated_at`)
    .bind(advertiserId, record.source, record.sourceAdId, record.sourceUrl, record.status, record.headline, record.body, record.callToAction,
      record.landingUrl, JSON.stringify(record.platforms), JSON.stringify(record.languages), record.startedAt, record.endedAt,
      record.impressions?.min ?? null, record.impressions?.max ?? null, record.reach?.min ?? null, record.reach?.max ?? null,
      record.spend?.min ?? null, record.spend?.max ?? null,
      record.currency, now, now, rawKey, now, now).run()
  const ad = await first<{ id: number }>(env.DB, 'SELECT id FROM ads WHERE source=? AND source_ad_id=?', record.source, record.sourceAdId)
  if (!ad) throw new Error('AD_INSERT_FAILED')

  const activeCountries = new Set((await all<{ code: string }>(env.DB, 'SELECT code FROM countries WHERE is_active_ios=1 OR is_active_android=1')).map((row) => row.code))
  for (const country of record.countries.map((value) => value.toLocaleLowerCase())) {
    if (activeCountries.has(country)) await env.DB.prepare('INSERT OR IGNORE INTO ad_regions (ad_id,country_code,created_at) VALUES (?,?,?)').bind(ad.id, country, now).run()
  }
  for (const [position, variant] of record.variants.entries()) {
    const sourceVariantId = variant.sourceVariantId ?? `${record.sourceAdId}:${position}`
    await env.DB.prepare(`INSERT INTO ad_creative_variants (ad_id,source_variant_id,format,headline,body,call_to_action,landing_url,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ad_id,source_variant_id) WHERE source_variant_id IS NOT NULL DO UPDATE SET format=excluded.format,headline=excluded.headline,
      body=excluded.body,call_to_action=excluded.call_to_action,landing_url=excluded.landing_url,position=excluded.position,updated_at=excluded.updated_at`)
      .bind(ad.id, sourceVariantId, variant.format, variant.headline, variant.body, variant.callToAction, variant.landingUrl, variant.position, now, now).run()
    const persisted = await first<{ id: number }>(env.DB, 'SELECT id FROM ad_creative_variants WHERE ad_id=? AND source_variant_id=?', ad.id, sourceVariantId)
    if (!persisted) continue
    const mediaMessages: JobMessage[] = []
    for (const media of variant.media) {
      const mediaId = await stableId(`${persisted.id}:${media.sourceUrl}:${media.role}:${media.position}`)
      mediaMessages.push({ v: 1, kind: 'creative.media', adId: ad.id, variantId: persisted.id, sourceUrl: media.sourceUrl,
        mediaType: media.mediaType, role: media.role, position: media.position, taskId: `creative-media:${mediaId}` })
    }
    if (mediaMessages.length) await env.CREATIVE_MEDIA.sendBatch(mediaMessages.map((body) => ({ body, contentType: 'json' as const })))
  }
  return { isNew: !existing, ...(await linkAd(env, ad.id, advertiserId, record, target)) }
}

export async function persistCollection(env: Env, target: CollectionTargetRow, source: AdSource, reason: string, result: ConnectorResult) {
  const now = nowIso()
  const run = await env.DB.prepare(`INSERT INTO ad_collection_runs (target_id,source,reason,status,started_at,created_at,updated_at)
    VALUES (?,?,?,'running',?,?,?) RETURNING id`).bind(target.id, source, reason, now, now, now).first<{ id: number }>()
  if (!run) throw new Error('COLLECTION_RUN_INSERT_FAILED')
  const month = now.slice(0, 7).replace('-', '/')
  const rawKey = `raw/${source}/${month}/${run.id}.json`
  await env.CREATIVES.put(rawKey, JSON.stringify({ collected_at: now, transport: result.transport, coverage: result.coverage, payload: result.raw }), {
    httpMetadata: { contentType: 'application/json' }, customMetadata: { source, targetId: String(target.id) },
  })
  let newAds = 0, linkedApps = 0, candidates = 0
  for (const record of result.records) {
    const persisted = await persistRecord(env, target, record, rawKey)
    if (persisted.isNew) newAds++
    linkedApps += persisted.linked
    candidates += persisted.candidate
  }
  const status = result.coverage === 'partial' ? 'partial' : 'completed'
  await env.DB.batch([
    env.DB.prepare(`UPDATE ad_collection_runs SET status=?,result_count=?,new_ad_count=?,linked_app_count=?,candidate_count=?,
      raw_r2_key=?,completed_at=?,updated_at=? WHERE id=?`).bind(status, result.records.length, newAds, linkedApps, candidates, rawKey, nowIso(), nowIso(), run.id),
    env.DB.prepare(`UPDATE ad_collection_targets SET status=?,last_collected_at=?,next_collect_at=datetime('now','+7 days'),last_error=NULL,updated_at=? WHERE id=?`)
      .bind(status === 'partial' ? 'partial' : 'ready', nowIso(), nowIso(), target.id),
  ])
  return { runId: run.id, resultCount: result.records.length, newAds, linkedApps, candidates, rawKey }
}

export async function recordCollectionFailure(env: Env, targetId: number, source: AdSource, reason: string, error: unknown) {
  const now = nowIso(), message = error instanceof Error ? error.message : String(error)
  const updated = await env.DB.prepare(`UPDATE ad_collection_runs SET status='failed',error_message=?,completed_at=?,updated_at=?
    WHERE id=(SELECT id FROM ad_collection_runs WHERE target_id=? AND source=? AND status='running' ORDER BY id DESC LIMIT 1)`)
    .bind(message, now, now, targetId, source).run()
  if ((updated.meta.changes ?? 0) === 0) await env.DB.prepare(`INSERT INTO ad_collection_runs
    (target_id,source,reason,status,error_message,started_at,completed_at,created_at,updated_at)
    VALUES (?,?,?,'failed',?,?,?,?,?)`).bind(targetId, source, reason, message, now, now, now, now).run()
  await env.DB.prepare(`UPDATE ad_collection_targets SET status='failed',last_error=?,next_collect_at=datetime('now','+24 hours'),updated_at=? WHERE id=?`)
    .bind(message, now, targetId).run()
}
