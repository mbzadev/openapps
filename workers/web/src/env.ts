import type { AuthContext, Database, JobMessage } from '@openapps/core'

export type RateLimitBinding = { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface Env {
  DB: D1Database
  OAUTH_KV: KVNamespace
  ARTIFACTS: R2Bucket
  ASSETS: Fetcher
  SYNC_TRACKED_IOS: Queue<JobMessage>
  SYNC_TRACKED_ANDROID: Queue<JobMessage>
  SYNC_ON_DEMAND_IOS: Queue<JobMessage>
  SYNC_ON_DEMAND_ANDROID: Queue<JobMessage>
  CHARTS_IOS: Queue<JobMessage>
  CHARTS_ANDROID: Queue<JobMessage>
  RECONCILE: Queue<JobMessage>
  AUTH_RATE_LIMITER: RateLimitBinding
  API_RATE_LIMITER: RateLimitBinding
  APP_NAME: string
  APP_URL: string
  ENVIRONMENT: string
  OAUTH_COOKIE_ENCRYPTION_KEY?: string
}

export type Variables = { auth: AuthContext; db: Database }
