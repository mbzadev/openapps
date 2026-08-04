import { connectorRegistry } from '@openapps/connectors'
import { googleAdsConnector } from './google.js'
import { metaConnector } from './meta.js'
import { tiktokConnector } from './tiktok.js'
import type { CreativeConnectorPlugin } from './types.js'

export const creativeConnectorRegistry = connectorRegistry([
  metaConnector,
  googleAdsConnector,
  tiktokConnector,
] satisfies readonly CreativeConnectorPlugin[]) as Readonly<Record<'meta' | 'google' | 'tiktok', CreativeConnectorPlugin>>

export { googleAdsConnector, metaConnector, tiktokConnector }
export type { CreativeConnectorPlugin }
