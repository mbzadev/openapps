import { Hono } from 'hono'
import { cors } from 'hono/cors'
import api from './api.js'
import oauth from './oauth.js'
import { handleMcp, MCP_TOOL_COUNT } from './mcp.js'
import { secureHeaders } from './security.js'
import type { Env, Variables } from './env.js'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use('*', secureHeaders)
app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return 'https://apps.mbza.dev'
    try {
      const hostname = new URL(origin).hostname
      return hostname === 'apps.mbza.dev' || hostname.endsWith('.openapps-web.workers.dev') ? origin : ''
    } catch { return '' }
  },
  allowHeaders: ['Authorization', 'Content-Type', 'Accept'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}))
app.route('/', oauth)
app.route('/api/v1', api)
app.all('/mcp', (c) => handleMcp(c.req.raw, c.env, c.executionCtx))
app.get('/config.js', (c) => c.text(`window.OPENAPPS_CONFIG=${JSON.stringify({ apiUrl: '/api/v1', mcpUrl: `${c.env.APP_URL}/mcp`, toolCount: MCP_TOOL_COUNT })};window.__BACKEND_API_URL__='/api/v1';window.__GA_MEASUREMENT_ID__='';`, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }))
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw))
app.onError((error, c) => {
  console.error(JSON.stringify({ level: 'error', event: 'request.failed', path: c.req.path, method: c.req.method, message: error.message, stack: error.stack }))
  return c.json({ message: 'Internal Server Error' }, 500)
})

export default app
