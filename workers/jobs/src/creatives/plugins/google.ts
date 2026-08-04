import { collectGoogle } from '../connectors.js'
import { baseHealth, type CreativeConnectorPlugin } from './types.js'

export const googleAdsConnector: CreativeConnectorPlugin = {
  id: 'google',
  label: 'Google Ads Transparency',
  capabilities: ['creatives', 'media'],
  transport: 'browser-rendering',
  collect: ({ env }, target) => collectGoogle(env, target),
  healthCheck: ({ env }) => baseHealth(env, 'google'),
}
