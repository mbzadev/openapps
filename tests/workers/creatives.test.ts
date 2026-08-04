import { describe, expect, it } from 'vitest'
import { isGoogleCreativeAssetUrl, normalizeGoogleAd, normalizeMetaAd, normalizeTikTokAd } from '../../workers/jobs/src/creatives/connectors.js'
import { isAllowedCreativeMediaUrl } from '../../workers/jobs/src/creatives/media.js'

describe('creative connector normalization', () => {
  it('normalizes Meta carousels and keeps only supplied public metrics', () => {
    const ad = normalizeMetaAd({ id: 'meta-1', page_id: 'page-1', page_name: 'Example Studio', ad_creative_bodies: ['Install today'],
      ad_creative_link_titles: ['Example App'], ad_creative_link_images: ['https://scontent.xx.fbcdn.net/a.jpg'],
      publisher_platforms: ['facebook', 'instagram'], ad_reached_countries: ['US', 'FR'], ad_delivery_start_time: '2026-01-01' })
    expect(ad).toMatchObject({ source: 'meta', sourceAdId: 'meta-1', countries: ['us', 'fr'], impressions: null, spend: null })
    expect(ad?.variants[0]?.media).toHaveLength(1)
  })

  it('normalizes Google and TikTok media without inventing spend', () => {
    const google = normalizeGoogleAd({ ad_id: 'google-1', advertiser_name: 'Example Studio', headline: 'Play now', assets: [{ url: 'https://lh3.googleusercontent.com/a.png' }] })
    const tiktok = normalizeTikTokAd({ ad_id: 'tiktok-1', advertiser_name: 'Example Studio', videos: [{ video_url: 'https://v16.tiktokcdn.com/a.mp4' }], reach: { min: 100, max: 200 } })
    expect(google).toMatchObject({ source: 'google', spend: null })
    expect(tiktok).toMatchObject({ source: 'tiktok', reach: { min: 100, max: 200 }, spend: null })
  })
})

describe('creative media SSRF policy', () => {
  it('accepts only HTTPS source/CDN hosts', () => {
    expect(isAllowedCreativeMediaUrl('https://video.xx.fbcdn.net/ad.mp4')).toBe(true)
    expect(isAllowedCreativeMediaUrl('https://lh3.googleusercontent.com/ad.png')).toBe(true)
    expect(isAllowedCreativeMediaUrl('http://video.xx.fbcdn.net/ad.mp4')).toBe(false)
    expect(isAllowedCreativeMediaUrl('https://fbcdn.net.evil.example/ad.mp4')).toBe(false)
    expect(isAllowedCreativeMediaUrl('https://127.0.0.1/ad.mp4')).toBe(false)
  })

  it('keeps Google ad assets while excluding account avatars and lookalike hosts', () => {
    expect(isGoogleCreativeAssetUrl('https://tpc.googlesyndication.com/archive/simgad/123')).toBe(true)
    expect(isGoogleCreativeAssetUrl('https://rr1---sn.example.googlevideo.com/videoplayback?id=123')).toBe(true)
    expect(isGoogleCreativeAssetUrl('https://lh3.googleusercontent.com/account-avatar')).toBe(false)
    expect(isGoogleCreativeAssetUrl('https://tpc.googlesyndication.com.evil.example/archive/simgad/123')).toBe(false)
  })
})
