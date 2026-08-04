import { describe, expect, it, vi } from 'vitest'
import { connectorRegistry, type ConnectorPlugin } from '@openapps/connectors'
import { storeConnectorRegistry } from '@openapps/scrapers'
import { creativeConnectorRegistry } from '../workers/jobs/src/creatives/plugins/index.js'

type TestPlugin = ConnectorPlugin<Record<string, never>, string, string>

const plugin = (id: string): TestPlugin => ({
  id,
  label: id,
  capabilities: ['lookup'],
  transport: 'fetch',
  collect: vi.fn(async (_context, target) => target),
  healthCheck: vi.fn(async () => ({ status: 'healthy' })),
})

describe('connector plugin registries', () => {
  it('creates an immutable registry and rejects duplicate connector IDs', () => {
    const registry = connectorRegistry([plugin('first'), plugin('second')])

    expect(Object.keys(registry)).toEqual(['first', 'second'])
    expect(Object.isFrozen(registry)).toBe(true)
    expect(() => connectorRegistry([plugin('duplicate'), plugin('duplicate')])).toThrow(/unique/)
  })

  it('exposes every supported store and creative source explicitly', () => {
    expect(Object.keys(storeConnectorRegistry)).toEqual(['ios', 'android'])
    expect(storeConnectorRegistry.ios).toMatchObject({ id: 'apple', transport: 'fetch' })
    expect(storeConnectorRegistry.android).toMatchObject({ id: 'google-play', transport: 'fetch' })

    expect(Object.keys(creativeConnectorRegistry)).toEqual(['meta', 'google', 'tiktok'])
    expect(creativeConnectorRegistry.meta.transport).toBe('official-api')
    expect(creativeConnectorRegistry.google.transport).toBe('browser-rendering')
    expect(creativeConnectorRegistry.tiktok.transport).toBe('official-api')
  })
})
