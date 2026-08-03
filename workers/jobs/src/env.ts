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
}
