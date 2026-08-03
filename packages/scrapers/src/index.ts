import type { Platform } from '@openapps/core'
import { AppleScraper } from './apple.js'
import { GooglePlayScraper } from './google.js'

export * from './types.js'
export * from './persist.js'

export function scraperFor(platform: Platform) {
  return platform === 'ios' ? new AppleScraper() : new GooglePlayScraper()
}

export { AppleScraper, GooglePlayScraper }
export { googlePlayAppUrl, parseGooglePlayHtml } from './google.js'
