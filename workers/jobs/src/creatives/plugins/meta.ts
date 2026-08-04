import { collectMeta } from '../connectors.js'
import { baseHealth, type CreativeConnectorPlugin } from './types.js'

export const metaConnector: CreativeConnectorPlugin = {
  id: 'meta',
  label: 'Meta Ads',
  capabilities: ['creatives', 'media'],
  transport: 'official-api',
  collect: ({ env }, target) => collectMeta(env, target),
  healthCheck: ({ env }) => baseHealth(env, 'meta'),
}
