export type ConnectorCapability = 'lookup' | 'search' | 'charts' | 'creatives' | 'media'
export type ConnectorTransport = 'fetch' | 'official-api' | 'browser-rendering'

export type ConnectorHealth = {
  code?: string
  message?: string
  status: 'healthy' | 'limited' | 'failing' | 'disabled'
}

export interface ConnectorPlugin<TContext, TTarget, TResult> {
  readonly capabilities: readonly ConnectorCapability[]
  readonly id: string
  readonly label: string
  readonly transport: ConnectorTransport
  collect(context: TContext, target: TTarget): Promise<TResult>
  healthCheck(context: TContext): Promise<ConnectorHealth>
}

export function connectorRegistry<TContext, TTarget, TResult, TPlugin extends ConnectorPlugin<TContext, TTarget, TResult>>(
  plugins: readonly TPlugin[],
): Readonly<Record<string, TPlugin>> {
  const entries = plugins.map((plugin) => [plugin.id, plugin] as const)
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('Connector identifiers must be unique')
  return Object.freeze(Object.fromEntries(entries))
}
