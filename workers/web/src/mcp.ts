import { McpServer, createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { authenticateRequest } from '@openapps/core'
import api from './api.js'
import type { Env } from './env.js'

type Args = Record<string, unknown>
type AppExecutionContext = Parameters<typeof api.fetch>[2]
type ToolSpec = { name: string; method?: 'GET' | 'POST' | 'DELETE'; path: (args: Args) => string; write?: boolean; omit?: string[] }
const p = (args: Args, name: string) => encodeURIComponent(String(args[name] ?? ''))
const platform = z.enum(['ios', 'android'])
const externalId = z.string().min(1)
const appIdentity = { platform, external_id: externalId }
const paging = { page: z.number().int().min(1).optional(), per_page: z.number().int().min(1).max(100).optional() }
const changeFields = z.enum(['title', 'subtitle', 'description', 'whats_new', 'screenshots', 'locale_added', 'locale_removed'])
const inputSchemas: Record<string, z.ZodObject> = {
  list_countries: z.object({}),
  list_categories: z.object({ platform: platform.optional(), type: z.enum(['app', 'game', 'magazine']).optional() }),
  search_store_apps: z.object({ term: z.string().min(2).max(100), platform, country_code: z.string().length(2).optional(), exclude_external_ids: z.array(z.string()).optional() }),
  list_tracked_apps: z.object({ platform: platform.optional(), search: z.string().max(100).optional(), folder_id: z.union([z.string(), z.number().int().positive()]).optional() }),
  get_app: z.object(appIdentity),
  get_app_listing: z.object({ ...appIdentity, country_code: z.string().length(2), locale: z.string().min(1).max(10) }),
  get_app_sync_status: z.object(appIdentity),
  track_app: z.object(appIdentity),
  untrack_app: z.object(appIdentity),
  list_app_competitors: z.object(appIdentity),
  list_all_competitors: z.object({ platform: platform.optional(), search: z.string().max(100).optional(), folder_id: z.union([z.string(), z.number().int().positive()]).optional() }),
  add_competitor: z.object({ ...appIdentity, competitor_external_id: externalId.optional(), competitor_platform: platform.optional(), competitor_app_id: z.number().int().positive().optional(), relationship: z.enum(['direct', 'indirect', 'aspiration']).optional() }).refine((value) => value.competitor_external_id !== undefined || value.competitor_app_id !== undefined),
  remove_competitor: z.object({ ...appIdentity, competitor_id: z.number().int().positive() }),
  list_app_changes: z.object({ ...paging, field: changeFields.optional(), platform: platform.optional(), search: z.string().max(100).optional(), app_id: z.number().int().positive().optional(), folder_id: z.union([z.string(), z.number().int().positive()]).optional() }),
  list_competitor_changes: z.object({ ...paging, field: changeFields.optional(), platform: platform.optional(), search: z.string().max(100).optional(), app_id: z.number().int().positive().optional(), folder_id: z.union([z.string(), z.number().int().positive()]).optional() }),
  get_charts: z.object({ platform, collection: z.enum(['top_free', 'top_paid', 'top_grossing']), country_code: z.string().length(2).optional(), category_id: z.number().int().positive().optional() }),
  get_app_rankings: z.object({ ...appIdentity, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), collection: z.enum(['top_free', 'top_paid', 'top_grossing', 'all']).optional() }),
  get_rating_summary: z.object(appIdentity),
  get_rating_history: z.object({ ...appIdentity, days: z.number().int().min(1).max(90).optional() }),
  get_rating_country_breakdown: z.object(appIdentity),
  get_app_keywords: z.object({ ...appIdentity, locale: z.string().optional(), ngram: z.number().int().min(1).max(4).optional(), version_id: z.number().int().positive().optional(), search: z.string().max(100).optional(), sort: z.enum(['keyword', 'count', 'density']).optional(), order: z.enum(['asc', 'desc']).optional(), per_page: z.number().int().min(1).max(500).optional(), page: z.number().int().min(1).optional() }),
  compare_app_keywords: z.object({ ...appIdentity, app_ids: z.array(z.number().int().positive()).min(1).max(5), version_ids: z.record(z.string(), z.number().int().positive()).optional(), locale: z.string().optional(), ngram: z.number().int().min(1).max(4).optional() }),
  search_publishers: z.object({ term: z.string().min(2), platform, country_code: z.string().length(2).optional() }),
  list_user_publishers: z.object({}),
  get_publisher: z.object({ ...appIdentity, name: z.string().optional() }),
  get_publisher_store_apps: z.object({ ...appIdentity, country_code: z.string().length(2).optional() }),
  browse_icons: z.object({ platform: platform.optional(), category_id: z.number().int().positive().optional(), search: z.string().optional(), ...paging }),
  browse_screenshots: z.object({ platform: platform.optional(), category_id: z.number().int().positive().optional(), search: z.string().optional(), ...paging }),
  get_dashboard: z.object({}),
}
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
      inputSchema: inputSchemas[tool.name] ?? z.object({}),
      annotations: { readOnlyHint: !tool.write, destructiveHint: tool.method === 'DELETE' },
    }, async (args) => {
      if (tool.write && !auth.scopes.includes('openapps:write') && !auth.scopes.includes('*')) return { content: [{ type: 'text', text: 'OAuth scope openapps:write is required.' }], isError: true }
      const values = args as Args
      const url = new URL(`/api/v1${tool.path(values)}`, request.url)
      const method = tool.method ?? 'GET'
      const omit = new Set(tool.omit ?? [])
      const init: RequestInit = { method, headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' } }
      if (method === 'GET') {
        for (const [key, value] of Object.entries(values)) if (!omit.has(key)) appendQueryValue(url.searchParams, key, value)
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

export function appendQueryValue(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) params.append(key, String(item))
    return
  }
  if (typeof value === 'object') {
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (nestedValue !== undefined && nestedValue !== null) params.append(`${key}[${nestedKey}]`, String(nestedValue))
    }
    return
  }
  params.set(key, String(value))
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
