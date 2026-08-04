import type { ConnectorPlugin } from '@openapps/connectors'
import type { AdSource } from '@openapps/core'
import type { Env } from '../../env.js'
import type { ConnectorResult, CreativeTarget } from '../connectors.js'

export type CreativeConnectorContext = { env: Env }
export type CreativeConnectorPlugin = ConnectorPlugin<CreativeConnectorContext, CreativeTarget, ConnectorResult> & { readonly id: AdSource }

export function baseHealth(env: Env, source: AdSource) {
  if (source === 'meta' && !env.META_AD_LIBRARY_ACCESS_TOKEN) return Promise.resolve({ status: 'limited' as const, code: 'browser-fallback', message: 'Meta API token is not configured' })
  if (source === 'tiktok' && (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET)) return Promise.resolve({ status: 'limited' as const, code: 'browser-fallback', message: 'TikTok API credentials are not configured' })
  return Promise.resolve({ status: 'healthy' as const })
}
