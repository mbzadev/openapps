import { collectTikTok } from '../connectors.js'
import { baseHealth, type CreativeConnectorPlugin } from './types.js'

export const tiktokConnector: CreativeConnectorPlugin = {
  id: 'tiktok',
  label: 'TikTok Commercial Content',
  capabilities: ['creatives', 'media'],
  transport: 'official-api',
  collect: ({ env }, target) => collectTikTok(env, target),
  healthCheck: ({ env }) => baseHealth(env, 'tiktok'),
}
