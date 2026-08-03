import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashPassword, jobMessageSchema, randomToken, sha256, verifyPassword } from '../packages/core/src/index.ts'
import { AppleScraper, GooglePlayScraper } from '../packages/scrapers/src/index.ts'

afterEach(() => vi.unstubAllGlobals())

describe('security primitives', () => {
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
    expect(hash).toMatch(/^pbkdf2-sha256-cf-v1\$600000\$/)
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('incorrect', hash)).toBe(false)
  }, 20_000)
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

  it('normalizes Google Play JSON-LD', async () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'SoftwareApplication', name: 'Example Android', author: { name: 'MBZA', url: '/store/apps/dev?id=mbza' }, applicationCategory: 'Tools', image: 'https://img', aggregateRating: { ratingValue: '4.5', ratingCount: '100' }, offers: { price: '0', priceCurrency: 'USD' }, description: 'Description' })}</script></html>`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })))
    const app = await new GooglePlayScraper().lookup('dev.mbza.example')
    expect(app).toMatchObject({ platform: 'android', external_id: 'dev.mbza.example', name: 'Example Android', publisher_name: 'MBZA', is_free: true })
  })
})
