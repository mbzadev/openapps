import puppeteer from '@cloudflare/puppeteer'
import { adCreativeRecordSchema, type AdCreativeRecord, type AdSource } from '@openapps/core'
import type { Env } from '../env.js'

export interface CreativeTarget {
  id: number
  displayName: string
  developerDomain: string | null
  countries: string[]
}

export interface ConnectorResult {
  records: AdCreativeRecord[]
  raw: unknown
  coverage: 'full' | 'partial'
  transport: 'official-api' | 'browser-run'
}

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const string = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const strings = (value: unknown) => Array.isArray(value) ? value.map(string).filter((item): item is string => item !== null) : string(value) ? [string(value)!] : []
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value ? Number(value) : null
const iso = (value: unknown) => {
  const raw = string(value)
  if (!raw) return null
  const parsed = /^\d{10}$/.test(raw) ? new Date(Number(raw) * 1000) : new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function mediaFrom(value: unknown) {
  const row = object(value)
  const sourceUrl = string(row.url ?? row.video_url ?? row.image_url ?? row.original_image_url ?? row.resized_image_url)
  if (!sourceUrl || !URL.canParse(sourceUrl)) return null
  const rawType = string(row.type ?? row.media_type)
  const mediaType = rawType?.includes('video') || /\.(mp4|webm)(\?|$)/i.test(sourceUrl) ? 'video' as const : 'image' as const
  return { sourceUrl, mediaType, role: 'primary' as const, position: 0, mimeType: undefined }
}

export function normalizeMetaAd(value: unknown): AdCreativeRecord | null {
  const row = object(value)
  const sourceAdId = string(row.id ?? row.ad_archive_id ?? row.adArchiveID)
  const advertiserName = string(row.page_name ?? row.pageName ?? object(row.page).name)
  if (!sourceAdId || !advertiserName) return null
  const cards = Array.isArray(row.ad_creative_link_captions) ? row.ad_creative_link_captions : []
  const images = strings(row.ad_creative_link_images).map((sourceUrl, position) => ({ sourceUrl, mediaType: 'image' as const, role: 'carousel' as const, position }))
  const videos = strings(row.ad_creative_link_videos).map((sourceUrl, position) => ({ sourceUrl, mediaType: 'video' as const, role: 'primary' as const, position }))
  const variantMedia = [...images, ...videos]
  const snapshotUrl = string(row.ad_snapshot_url)
  return adCreativeRecordSchema.parse({
    source: 'meta', sourceAdId, sourceUrl: snapshotUrl && URL.canParse(snapshotUrl) ? snapshotUrl : `https://www.facebook.com/ads/library/?id=${encodeURIComponent(sourceAdId)}`,
    advertiser: { sourceId: string(row.page_id ?? object(row.page).id), name: advertiserName, domain: null, sourceUrl: null },
    status: row.ad_delivery_stop_time ? 'inactive' : 'active', headline: strings(row.ad_creative_link_titles)[0] ?? null,
    body: strings(row.ad_creative_bodies)[0] ?? string(row.body), callToAction: string(row.call_to_action_type),
    landingUrl: strings(row.ad_creative_link_captions).find((candidate) => URL.canParse(candidate)) ?? null,
    platforms: strings(row.publisher_platforms), languages: strings(row.languages), countries: strings(row.ad_reached_countries).map((country) => country.toLowerCase()),
    startedAt: iso(row.ad_delivery_start_time ?? row.start_date), endedAt: iso(row.ad_delivery_stop_time ?? row.end_date),
    impressions: null, reach: null, spend: null, currency: string(row.currency),
    variants: [{ sourceVariantId: null, format: variantMedia.length > 1 || cards.length > 1 ? 'carousel' : videos.length ? 'video' : images.length ? 'image' : 'text',
      headline: strings(row.ad_creative_link_titles)[0] ?? null, body: strings(row.ad_creative_bodies)[0] ?? null,
      callToAction: string(row.call_to_action_type), landingUrl: null, position: 0, media: variantMedia }], raw: value,
  })
}

export function normalizeGoogleAd(value: unknown): AdCreativeRecord | null {
  const row = object(value)
  const sourceAdId = string(row.ad_id ?? row.creative_id ?? row.id)
  const advertiser = object(row.advertiser)
  const advertiserName = string(row.advertiser_name ?? advertiser.name ?? row.name)
  if (!sourceAdId || !advertiserName) return null
  const mediaValues = Array.isArray(row.media) ? row.media : Array.isArray(row.assets) ? row.assets : []
  const media = mediaValues.map(mediaFrom).filter((item): item is NonNullable<ReturnType<typeof mediaFrom>> => item !== null).map((item, position) => ({ ...item, position }))
  const landingUrl = string(row.landing_url ?? row.destination_url)
  return adCreativeRecordSchema.parse({
    source: 'google', sourceAdId, sourceUrl: string(row.source_url) ?? `https://adstransparency.google.com/advertiser/${encodeURIComponent(string(advertiser.id) ?? sourceAdId)}`,
    advertiser: { sourceId: string(advertiser.id ?? row.advertiser_id), name: advertiserName, domain: string(row.domain ?? advertiser.domain), sourceUrl: null },
    status: string(row.status)?.toLowerCase() === 'active' ? 'active' : 'unknown', headline: string(row.headline), body: string(row.text ?? row.body),
    callToAction: string(row.call_to_action ?? row.cta), landingUrl: landingUrl && URL.canParse(landingUrl) ? landingUrl : null,
    platforms: strings(row.platforms), languages: strings(row.languages), countries: strings(row.regions ?? row.countries).map((country) => country.toLowerCase()),
    startedAt: iso(row.start_date), endedAt: iso(row.end_date), impressions: null, reach: null, spend: null, currency: null,
    variants: [{ sourceVariantId: string(row.variant_id), format: media.some((item) => item.mediaType === 'video') ? 'video' : media.length > 1 ? 'carousel' : media.length ? 'image' : 'text',
      headline: string(row.headline), body: string(row.text ?? row.body), callToAction: string(row.call_to_action ?? row.cta), landingUrl: landingUrl && URL.canParse(landingUrl) ? landingUrl : null, position: 0, media }], raw: value,
  })
}

export function normalizeTikTokAd(value: unknown): AdCreativeRecord | null {
  const row = object(value)
  const sourceAdId = string(row.ad_id ?? row.id)
  const advertiser = object(row.advertiser)
  const advertiserName = string(row.advertiser_name ?? row.business_name ?? row.brand_name ?? advertiser.name)
  if (!sourceAdId || !advertiserName) return null
  const videos = Array.isArray(row.videos) ? row.videos : row.video ? [row.video] : []
  const media = videos.map(mediaFrom).filter((item): item is NonNullable<ReturnType<typeof mediaFrom>> => item !== null).map((item, position) => ({ ...item, position }))
  const reach = object(row.reach)
  return adCreativeRecordSchema.parse({
    source: 'tiktok', sourceAdId, sourceUrl: string(row.ad_url ?? row.source_url) ?? `https://library.tiktok.com/ads/detail/?ad_id=${encodeURIComponent(sourceAdId)}`,
    advertiser: { sourceId: string(row.advertiser_id ?? advertiser.id), name: advertiserName, domain: string(row.domain), sourceUrl: null },
    status: string(row.status)?.toLowerCase() === 'active' ? 'active' : 'unknown', headline: string(row.ad_title ?? row.title), body: string(row.ad_text ?? row.text),
    callToAction: string(row.call_to_action ?? row.cta), landingUrl: URL.canParse(string(row.landing_page_url) ?? '') ? string(row.landing_page_url) : null,
    platforms: ['tiktok'], languages: strings(row.languages), countries: strings(row.country_code ?? row.countries).map((country) => country.toLowerCase()),
    startedAt: iso(row.first_shown_date ?? row.start_date), endedAt: iso(row.last_shown_date ?? row.end_date), impressions: null,
    reach: number(reach.min ?? row.reach_min) !== null || number(reach.max ?? row.reach_max) !== null ? { min: number(reach.min ?? row.reach_min), max: number(reach.max ?? row.reach_max) } : null,
    spend: null, currency: null,
    variants: [{ sourceVariantId: string(row.video_id), format: media.length ? 'video' : 'text', headline: string(row.ad_title ?? row.title), body: string(row.ad_text ?? row.text),
      callToAction: string(row.call_to_action ?? row.cta), landingUrl: URL.canParse(string(row.landing_page_url) ?? '') ? string(row.landing_page_url) : null, position: 0, media }], raw: value,
  })
}

function walk(value: unknown, normalize: (value: unknown) => AdCreativeRecord | null, output: Map<string, AdCreativeRecord>, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return
  const normalized = normalize(value)
  if (normalized) output.set(normalized.sourceAdId, normalized)
  for (const child of Array.isArray(value) ? value : Object.values(value as JsonObject)) walk(child, normalize, output, depth + 1)
}

function normalizedFromPayload(payload: unknown, normalize: (value: unknown) => AdCreativeRecord | null) {
  const output = new Map<string, AdCreativeRecord>()
  walk(payload, normalize, output)
  return [...output.values()]
}

async function browserPayload(env: Env, url: string, normalize: (value: unknown) => AdCreativeRecord | null): Promise<ConnectorResult> {
  const browser = await puppeteer.launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    const networkPayloads: unknown[] = []
    const networkReads: Array<Promise<void>> = []
    page.on('response', (response) => {
      const contentType = response.headers()['content-type'] ?? ''
      if (!contentType.includes('json')) return
      networkReads.push(response.json().then((payload) => { networkPayloads.push(payload) }).catch(() => undefined))
    })
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 })
    await Promise.allSettled(networkReads)
    const scripts = await page.evaluate(() => {
      const browserDocument = (globalThis as unknown as { document: { querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }> } }).document
      return Array.from(browserDocument.querySelectorAll('script')).map((node) => node.textContent ?? '').filter(Boolean)
    })
    const payloads: unknown[] = [...networkPayloads]
    for (const script of scripts) {
      const trimmed = script.trim()
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue
      try { payloads.push(JSON.parse(trimmed)) } catch { /* Public pages often contain executable scripts. */ }
    }
    return { records: normalizedFromPayload(payloads, normalize), raw: payloads, coverage: 'partial', transport: 'browser-run' }
  } finally { await browser.close() }
}

async function meta(env: Env, target: CreativeTarget): Promise<ConnectorResult> {
  if (env.META_AD_LIBRARY_ACCESS_TOKEN) {
    const params = new URLSearchParams({
      access_token: env.META_AD_LIBRARY_ACCESS_TOKEN, ad_type: 'ALL', search_terms: target.displayName,
      ad_reached_countries: JSON.stringify(target.countries.map((country) => country.toUpperCase())), limit: '100',
      fields: 'id,page_id,page_name,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,publisher_platforms,languages',
    })
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION ?? 'v23.0'}/ads_archive?${params}`)
    if (response.ok) {
      const raw = await response.json()
      return { records: normalizedFromPayload(object(raw).data ?? raw, normalizeMetaAd), raw, coverage: 'full', transport: 'official-api' }
    }
    if (response.status === 429) throw new Error(`RATE_LIMIT:${Number(response.headers.get('retry-after') ?? 900) * 1000}`)
  }
  const query = encodeURIComponent(target.displayName)
  return browserPayload(env, `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${query}&search_type=keyword_unordered`, normalizeMetaAd)
}

async function google(env: Env, target: CreativeTarget): Promise<ConnectorResult> {
  const query = encodeURIComponent(target.developerDomain ?? target.displayName)
  const parameter = target.developerDomain ? 'domain' : 'query'
  return browserPayload(env, `https://adstransparency.google.com/?region=anywhere&${parameter}=${query}`, normalizeGoogleAd)
}

async function tiktok(env: Env, target: CreativeTarget): Promise<ConnectorResult> {
  if (env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET) {
    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'client_credentials' }) })
    if (tokenResponse.ok) {
      const token = object(await tokenResponse.json())
      const accessToken = string(token.access_token)
      if (accessToken) {
        const response = await fetch('https://open.tiktokapis.com/v2/research/adlib/ad/query/?fields=ad_id,advertiser_id,advertiser_name,ad_text,ad_title,first_shown_date,last_shown_date,videos,reach', {
          method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ query: { and: [{ field_name: 'advertiser_name', field_values: [target.displayName], operation: 'EQ' }] }, max_count: 100 }),
        })
        if (response.ok) {
          const raw = await response.json()
          return { records: normalizedFromPayload(raw, normalizeTikTokAd), raw, coverage: 'partial', transport: 'official-api' }
        }
        if (response.status === 429) throw new Error(`RATE_LIMIT:${Number(response.headers.get('retry-after') ?? 900) * 1000}`)
      }
    }
  }
  return browserPayload(env, `https://library.tiktok.com/ads?region=all&query=${encodeURIComponent(target.displayName)}`, normalizeTikTokAd)
}

export const creativeConnectors: Record<AdSource, (env: Env, target: CreativeTarget) => Promise<ConnectorResult>> = { meta, google, tiktok }
