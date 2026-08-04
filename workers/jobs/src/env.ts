import type { JobMessage } from '@openapps/core'

// Binding names and runtime types come from the committed Wrangler output.
export type Env = Cloudflare.Env & {
  SYNC_TRACKED_IOS: Queue<JobMessage>
  SYNC_TRACKED_ANDROID: Queue<JobMessage>
  SYNC_ON_DEMAND_IOS: Queue<JobMessage>
  SYNC_ON_DEMAND_ANDROID: Queue<JobMessage>
  CHARTS_IOS: Queue<JobMessage>
  CHARTS_ANDROID: Queue<JobMessage>
  RECONCILE: Queue<JobMessage>
  CREATIVE_DISCOVERY: Queue<JobMessage>
  CREATIVE_MEDIA: Queue<JobMessage>
  CREATIVES_ENABLED?: string
  CREATIVE_SOURCES?: string
  CREATIVE_BACKFILL_LIMIT?: string
  META_GRAPH_API_VERSION?: string
  META_AD_LIBRARY_ACCESS_TOKEN?: string
  TIKTOK_CLIENT_KEY?: string
  TIKTOK_CLIENT_SECRET?: string
}
