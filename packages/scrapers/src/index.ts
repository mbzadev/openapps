import type { Platform } from '@openapps/core'
import { AppleScraper } from './apple.js'
import { GooglePlayScraper } from './google.js'

export * from './types.js'
export * from './persist.js'

export const storeConnectorRegistry = Object.freeze({
  ios: {
    id: 'apple',
    label: 'Apple Store',
    capabilities: ['lookup', 'search', 'charts'] as const,
    transport: 'fetch' as const,
    create: () => new AppleScraper(),
  },
  android: {
    id: 'google-play',
    label: 'Google Play',
    capabilities: ['lookup', 'search', 'charts'] as const,
    transport: 'fetch' as const,
    create: () => new GooglePlayScraper(),
  },
})

export function scraperFor(platform: Platform) {
  return storeConnectorRegistry[platform].create()
}

export { AppleScraper, GooglePlayScraper }
export { appleLegacyChartUrl, parseAppleLegacyChart } from './apple.js'
export { googlePlayAppUrl, parseGooglePlayHtml } from './google.js'
