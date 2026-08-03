import { afterEach, describe, expect, it, vi } from 'vitest'
import { pbkdf2Sync } from 'node:crypto'
import { hashPassword, jobMessageSchema, randomToken, sha256, verifyPassword } from '../packages/core/src/index.ts'
import { AppleScraper, GooglePlayScraper } from '../packages/scrapers/src/index.ts'
import { escapeHtml } from '../workers/web/src/oauth.ts'
import { appendQueryValue } from '../workers/web/src/mcp.ts'
import { allowedCorsOrigin, publicAppUrl } from '../workers/web/src/origin.ts'
import { matchPath } from '../web/src/lib/router.tsx'

afterEach(() => vi.unstubAllGlobals())

describe('security primitives', () => {
  it('escapes untrusted OAuth client markup', () => {
    expect(escapeHtml(`<img src=x onerror='alert(1)'>&\"`)).toBe('&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;&quot;')
  })
  it('generates opaque random tokens', () => {
    const first = randomToken(), second = randomToken()
    expect(first).toHaveLength(64)
    expect(second).toHaveLength(64)
    expect(first).not.toBe(second)
  })

  it('hashes values deterministically with SHA-256', async () => {
    expect(await sha256('openapps')).toBe('fddd15c39b112a766715266ad63149c021a9f620e87dee1733a31d8421876ddb')
  })

  it('uses versioned PBKDF2 hashes and rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^pbkdf2-sha256-v1\$600000\$/)
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('incorrect', hash)).toBe(false)
    const [, iterations, salt, derived] = hash.split('$')
    expect(Buffer.from(derived!, 'base64')).toEqual(pbkdf2Sync('correct horse battery staple', Buffer.from(salt!, 'base64'), Number(iterations), 32, 'sha256'))
  }, 20_000)
})

describe('MCP-compatible query encoding', () => {
  it('repeats arrays and expands keyed version maps using Laravel-compatible query names', () => {
    const params = new URLSearchParams()
    appendQueryValue(params, 'app_ids', [10, 20])
    appendQueryValue(params, 'version_ids', { 10: 100, 20: 200 })
    appendQueryValue(params, 'locale', 'en-US')
    appendQueryValue(params, 'missing', undefined)
    expect(params.getAll('app_ids')).toEqual(['10', '20'])
    expect(params.get('version_ids[10]')).toBe('100')
    expect(params.get('version_ids[20]')).toBe('200')
    expect(params.get('locale')).toBe('en-US')
    expect(params.has('missing')).toBe(false)
  })
})

describe('native SPA route matching', () => {
  it('matches exact and decoded dynamic segments without accepting partial paths', () => {
    expect(matchPath('/apps/:platform/:externalId', '/apps/ios/com.example%2Fencoded')).toEqual({ platform: 'ios', externalId: 'com.example/encoded' })
    expect(matchPath('/apps/:platform/:externalId', '/apps/ios')).toBeNull()
    expect(matchPath('/apps', '/apps/ios')).toBeNull()
    expect(matchPath('*', '/anything')).toEqual({})
  })
})

describe('production and Cloudflare preview origins', () => {
  it('keeps production canonical and makes version previews self-contained', () => {
    expect(publicAppUrl({ APP_URL: 'https://apps.mbza.dev', ENVIRONMENT: 'production' }, 'https://attacker.invalid/path')).toBe('https://apps.mbza.dev')
    const preview = 'https://6f2d2f2-openapps-web-preview.mbza.workers.dev'
    expect(publicAppUrl({ APP_URL: 'https://openapps-web-preview.mbza.workers.dev', ENVIRONMENT: 'preview' }, `${preview}/mcp`)).toBe(preview)
    expect(allowedCorsOrigin(preview)).toBe(preview)
    expect(allowedCorsOrigin('https://apps.mbza.dev.attacker.invalid')).toBe('')
  })
})

describe('versioned queue messages', () => {
  const valid = [
    { v: 1, kind: 'app.sync', platform: 'ios', appId: 1, source: 'scheduled', taskId: 'a' },
    { v: 1, kind: 'chart.sync', platform: 'android', countryCode: 'us', collection: 'top_free', categoryExternalId: null, snapshotDate: '2026-08-03', taskId: 'b' },
    { v: 1, kind: 'sync.reconcile', syncStatusId: 1, taskId: 'c' },
    { v: 1, kind: 'dead-letter', original: {}, error: 'failed', failedAt: '2026-08-03T00:00:00Z', taskId: 'd' },
  ]
  it.each(valid)('accepts $kind', (message) => expect(jobMessageSchema.safeParse(message).success).toBe(true))
  it.each([
    { v: 2, kind: 'app.sync', platform: 'ios', appId: 1, source: 'scheduled', taskId: 'a' },
    { v: 1, kind: 'app.sync', platform: 'windows', appId: 1, source: 'scheduled', taskId: 'a' },
    { v: 1, kind: 'chart.sync', platform: 'ios', countryCode: 'usa', collection: 'top_free', categoryExternalId: null, snapshotDate: 'x', taskId: 'b' },
  ])('rejects invalid messages', (message) => expect(jobMessageSchema.safeParse(message).success).toBe(false))
})

describe('store adapters', () => {
  it('normalizes Apple lookup responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ resultCount: 1, results: [{ trackId: 123, trackName: 'Example', artistName: 'MBZA', artistId: 9, artistViewUrl: 'https://apps.apple.com/dev/id9', primaryGenreName: 'Utilities', primaryGenreId: 6002, artworkUrl512: 'https://img', averageUserRating: 4.7, userRatingCount: 42, price: 0, currency: 'USD', version: '2.0', currentVersionReleaseDate: '2026-08-01', releaseDate: '2026-01-01', languageCodesISO2A: ['EN'], contentAdvisoryRating: '4+', description: 'Description', releaseNotes: 'Notes', screenshotUrls: ['https://screen'], fileSizeBytes: '1234' }] }), { headers: { 'content-type': 'application/json' } })))
    const app = await new AppleScraper().lookup('123')
    expect(app).toMatchObject({ platform: 'ios', external_id: '123', name: 'Example', rating: 4.7, is_free: true, version: '2.0' })
  })

  it('falls back to server-rendered App Store search data when iTunes is throttled', async () => {
    const serialized = JSON.stringify({ data: [{ data: { shelves: [{ items: [{ lockup: {
      adamId: '389801252', title: 'Instagram', subtitle: 'Videos and friends', developerName: 'Instagram, Inc.',
      rating: 4.7, ratingCount: '29M', ageRating: '13+', icon: { template: 'https://img/{w}x{h}{c}.{f}' },
      offerDisplayProperties: { isFree: true }, buttonAction: { purchaseConfiguration: { buyParams: 'price=0' } },
      clickAction: { pageUrl: 'https://apps.apple.com/us/app/instagram/id389801252' },
    } }] }] } }] })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('throttled', { status: 429 }))
      .mockResolvedValueOnce(new Response(`<script type="application/json" id="serialized-server-data">${serialized}</script>`))
    vi.stubGlobal('fetch', fetchMock)
    const apps = await new AppleScraper().search('Instagram', 'us', 10)
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({ external_id: '389801252', name: 'Instagram', publisher_name: 'Instagram, Inc.', rating_count: 29_000_000, is_free: true })
    expect(fetchMock.mock.calls[1]?.[0]).toContain('apps.apple.com/us/iphone/search')
  })

  it('falls back to server-rendered App Store product data for lookups', async () => {
    const information = (title: string, value: string, summary?: string) => ({ title, summary, items: [{ text: value }] })
    const serialized = JSON.stringify({ data: [{ data: {
      lockup: { adamId: '123', title: 'Example', subtitle: 'Native fallback', rating: 4.8, icon: { template: 'https://img/{w}x{h}{c}.{f}' }, offerDisplayProperties: { isFree: true }, buttonAction: { purchaseConfiguration: { vendor: 'MBZA', buyParams: 'price=0' } } },
      developerAction: { title: 'MBZA', pageUrl: 'https://apps.apple.com/us/developer/id9', destination: { id: '9' } },
      shelfMapping: {
        description: { items: [{ paragraph: { text: 'Description' } }] },
        productRatings: { items: [{ ratingAverage: 4.8, totalNumberOfRatings: 42 }] },
        mostRecentVersion: { items: [{ primarySubtitle: 'Version 3.0', secondarySubtitle: '2026-08-01', text: 'Notes' }] },
        information: { items: [information('Category', 'Utilities'), information('Size', '12 MB'), information('Languages', 'English, French'), information('Age Rating', '', '4+')] },
        product_media_phone_: { items: [{ screenshot: { template: 'https://screen/{w}x{h}{c}.{f}' } }] },
      },
    } }] })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('throttled', { status: 429 }))
      .mockResolvedValueOnce(new Response(`<script type="application/json" id="serialized-server-data">${serialized}</script>`)))
    const app = await new AppleScraper().lookup('123')
    expect(app).toMatchObject({ external_id: '123', publisher_external_id: '9', category: 'Utilities', version: '3.0', description: 'Description', file_size_bytes: 12_000_000, content_rating: '4+' })
    expect(app.screenshots).toHaveLength(1)
  })

  it('normalizes Google Play JSON-LD', async () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'SoftwareApplication', name: 'Example Android', author: { name: 'MBZA', url: '/store/apps/dev?id=mbza' }, applicationCategory: 'Tools', image: 'https://img', aggregateRating: { ratingValue: '4.5', ratingCount: '100' }, offers: { price: '0', priceCurrency: 'USD' }, description: 'Description' })}</script></html>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })))
    const app = await new GooglePlayScraper().lookup('dev.mbza.example')
    expect(app).toMatchObject({ platform: 'android', external_id: 'dev.mbza.example', name: 'Example Android', publisher_name: 'MBZA', is_free: true })
  })
})
