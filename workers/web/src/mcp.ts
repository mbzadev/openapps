import { McpServer, createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { authenticateRequest } from '@openapps/core'
import api from './api.js'
import type { Env } from './env.js'

type Args = Record<string, unknown>
type AppExecutionContext = Parameters<typeof api.fetch>[2]
type ToolSpec = { name: string; method?: 'GET' | 'POST' | 'DELETE'; path: (args: Args) => string; write?: boolean; omit?: string[] }
const p = (args: Args, name: string) => encodeURIComponent(String(args[name] ?? ''))
const tools: ToolSpec[] = [
  { name: 'list_countries', path: () => '/countries' },
  { name: 'list_categories', path: () => '/store-categories' },
  { name: 'search_store_apps', path: () => '/apps/search' },
  { name: 'list_tracked_apps', path: () => '/apps' },
  { name: 'get_app', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}`, omit: ['platform', 'external_id'] },
  { name: 'get_app_listing', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/listing`, omit: ['platform', 'external_id'] },
  { name: 'get_app_sync_status', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/sync-status`, omit: ['platform', 'external_id'] },
  { name: 'track_app', method: 'POST', write: true, path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/track`, omit: ['platform', 'external_id'] },
  { name: 'untrack_app', method: 'DELETE', write: true, path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/track`, omit: ['platform', 'external_id'] },
  { name: 'list_app_competitors', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/competitors`, omit: ['platform', 'external_id'] },
  { name: 'list_all_competitors', path: () => '/competitors' },
  { name: 'add_competitor', method: 'POST', write: true, path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/competitors`, omit: ['platform', 'external_id'] },
  { name: 'remove_competitor', method: 'DELETE', write: true, path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/competitors/${p(a, 'competitor_id')}`, omit: ['platform', 'external_id', 'competitor_id'] },
  { name: 'list_app_changes', path: () => '/changes/apps' },
  { name: 'list_competitor_changes', path: () => '/changes/competitors' },
  { name: 'get_charts', path: () => '/charts' },
  { name: 'get_app_rankings', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/rankings`, omit: ['platform', 'external_id'] },
  { name: 'get_rating_summary', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/ratings/summary`, omit: ['platform', 'external_id'] },
  { name: 'get_rating_history', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/ratings/history`, omit: ['platform', 'external_id'] },
  { name: 'get_rating_country_breakdown', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/ratings/country-breakdown`, omit: ['platform', 'external_id'] },
  { name: 'get_app_keywords', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/keywords`, omit: ['platform', 'external_id'] },
  { name: 'compare_app_keywords', path: (a) => `/apps/${p(a, 'platform')}/${p(a, 'external_id')}/keywords/compare`, omit: ['platform', 'external_id'] },
  { name: 'search_publishers', path: () => '/publishers/search' },
  { name: 'list_user_publishers', path: () => '/publishers' },
  { name: 'get_publisher', path: (a) => `/publishers/${p(a, 'platform')}/${p(a, 'external_id')}`, omit: ['platform', 'external_id'] },
  { name: 'get_publisher_store_apps', path: (a) => `/publishers/${p(a, 'platform')}/${p(a, 'external_id')}/store-apps`, omit: ['platform', 'external_id'] },
  { name: 'browse_icons', path: () => '/explorer/icons' },
  { name: 'browse_screenshots', path: () => '/explorer/screenshots' },
  { name: 'get_dashboard', path: () => '/dashboard' },
]

function registerTools(server: McpServer, request: Request, auth: AuthInfo, env: Env, executionCtx: AppExecutionContext) {
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: `${tool.write ? 'Write' : 'Read'} OpenApps data through the compatible /api/v1 contract.`,
      inputSchema: z.object({}).catchall(z.unknown()),
      annotations: { readOnlyHint: !tool.write, destructiveHint: tool.method === 'DELETE' },
    }, async (args) => {
      if (tool.write && !auth.scopes.includes('openapps:write') && !auth.scopes.includes('*')) return { content: [{ type: 'text', text: 'OAuth scope openapps:write is required.' }], isError: true }
      const values = args as Args
      const url = new URL(`/api/v1${tool.path(values)}`, request.url)
      const method = tool.method ?? 'GET'
      const omit = new Set(tool.omit ?? [])
      const init: RequestInit = { method, headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' } }
      if (method === 'GET') {
        for (const [key, value] of Object.entries(values)) if (!omit.has(key) && value !== undefined && value !== null) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
      } else {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' }
        init.body = JSON.stringify(Object.fromEntries(Object.entries(values).filter(([key]) => !omit.has(key))))
      }
      // Dispatch through the already-mounted API router directly. Strip its public
      // mount prefix because this call enters the child Hono application itself.
      const internalUrl = new URL(url)
      internalUrl.pathname = internalUrl.pathname.slice('/api/v1'.length) || '/'
      const response = await api.fetch(new Request(internalUrl, init), env, executionCtx)
      const text = await response.text()
      return { content: [{ type: 'text', text: text || JSON.stringify({ status: response.status }) }], isError: !response.ok }
    })
  }
}

export async function handleMcp(request: Request, env: Env, executionCtx: AppExecutionContext) {
  const auth = await authenticateRequest(env.DB, request)
  if (!auth) return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${env.APP_URL}/.well-known/oauth-protected-resource/mcp"` } })
  if (!auth.abilities.includes('*') && !auth.abilities.includes('openapps:read')) return new Response(JSON.stringify({ error: 'insufficient_scope' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  const info: AuthInfo = { token: request.headers.get('Authorization')?.slice(7) ?? '', clientId: `user-${auth.user.id}`, scopes: auth.abilities, expiresAt: Math.floor(Date.now() / 1000) + 3600, resource: new URL(`${env.APP_URL}/mcp`), extra: { userId: auth.user.id } }
  const handler = createMcpHandler(async ({ requestInfo, authInfo }) => {
    const server = new McpServer({ name: 'openapps-by-mbza', version: '2.0.0' }, { instructions: 'OpenApps by MBZA provides App Store and Google Play intelligence through 29 account-isolated tools.' })
    if (requestInfo && authInfo) registerTools(server, requestInfo, authInfo, env, executionCtx)
    return server
  }, { legacy: 'stateless', responseMode: 'auto' })
  return handler.fetch(request, { authInfo: info })
}

export const MCP_TOOL_COUNT = tools.length
