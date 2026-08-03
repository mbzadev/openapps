import type { JobMessage } from '@openapps/core'
import type { StoreRateLimiter } from './rate-limiter.js'

export interface Env {
  DB: D1Database
  ARTIFACTS: R2Bucket
  BROWSER: Fetcher
  STORE_RATE_LIMITER: DurableObjectNamespace<StoreRateLimiter>
  SYNC_TRACKED_IOS: Queue<JobMessage>
  SYNC_TRACKED_ANDROID: Queue<JobMessage>
  CHARTS_IOS: Queue<JobMessage>
  CHARTS_ANDROID: Queue<JobMessage>
  RECONCILE: Queue<JobMessage>
  ENVIRONMENT: string
}
