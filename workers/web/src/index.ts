import { Hono } from 'hono'
import { cors } from 'hono/cors'
import api from './api.js'
import oauth from './oauth.js'
import { handleMcp, MCP_TOOL_COUNT } from './mcp.js'
import { allowedCorsOrigin, publicAppUrl } from './origin.js'
import { secureHeaders } from './security.js'
import type { Env, Variables } from './env.js'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.use('*', secureHeaders)
app.use('/api/*', cors({
  origin: allowedCorsOrigin,
  allowHeaders: ['Authorization', 'Content-Type', 'Accept', 'x-d1-bookmark'],
  exposeHeaders: ['x-d1-bookmark'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}))
app.route('/', oauth)
app.route('/api/v1', api)
app.all('/mcp', (c) => handleMcp(c.req.raw, c.env, c.executionCtx))
app.get('/config.js', (c) => c.text(`window.OPENAPPS_CONFIG=${JSON.stringify({ apiUrl: '/api/v1', mcpUrl: `${publicAppUrl(c.env, c.req.url)}/mcp`, toolCount: MCP_TOOL_COUNT })};window.__BACKEND_API_URL__='/api/v1';window.__GA_MEASUREMENT_ID__='';`, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }))
app.get('/', (c) => c.redirect('/login', 302))
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw))
app.onError((error, c) => {
  console.error(JSON.stringify({ level: 'error', event: 'request.failed', path: c.req.path, method: c.req.method, message: error.message, stack: error.stack }))
  return c.json({ message: 'Internal Server Error' }, 500)
})

export default app
