import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'
import { appResource, errorResponse, loginRequest, registerRequest, user } from '../packages/contracts/src/schemas.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const paths = {}
const operation = (method, path, tag, summary, requestBody) => {
  paths[path] ??= {}
  paths[path][method.toLowerCase()] = {
    tags: [tag], summary,
    security: path.startsWith('/auth/') ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }],
    ...(requestBody ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(requestBody) } } } } : {}),
    responses: { 200: { description: 'Success' }, 401: { description: 'Unauthenticated', content: { 'application/json': { schema: z.toJSONSchema(errorResponse) } } }, 422: { description: 'Validation error' } },
  }
}

operation('post', '/auth/register', 'Auth', 'Register a public account', registerRequest)
operation('post', '/auth/login', 'Auth', 'Login and create a secure browser session', loginRequest)
operation('post', '/auth/logout', 'Auth', 'Revoke the current session')
operation('get', '/auth/me', 'Auth', 'Current user')
for (const [method, path, tag, summary] of [
  ['get','/account/profile','Account','Show profile'],['patch','/account/profile','Account','Update profile'],['delete','/account/profile','Account','Delete profile'],['put','/account/password','Account','Update password'],
  ['get','/account/api-tokens','Account','List API tokens'],['post','/account/api-tokens','Account','Create API token'],['delete','/account/api-tokens/{tokenId}','Account','Delete API token'],
  ['get','/dashboard','Dashboard','Dashboard'],['get','/folders','Folders','List folders'],['post','/folders','Folders','Create folder'],['patch','/folders/{folder}','Folders','Update folder'],['delete','/folders/{folder}','Folders','Delete folder'],
  ['get','/apps/search','Apps','Search store apps'],['get','/apps','Apps','List tracked apps'],['post','/apps','Apps','Import app'],['get','/apps/{platform}/{externalId}','Apps','App detail'],['get','/apps/{platform}/{externalId}/listing','Apps','Store listing'],
  ['patch','/apps/{platform}/{externalId}/folder','Apps','Move app'],['post','/apps/{platform}/{externalId}/track','Apps','Track app'],['delete','/apps/{platform}/{externalId}/track','Apps','Untrack app'],
  ['get','/apps/{platform}/{externalId}/competitors','Competitors','List competitors'],['post','/apps/{platform}/{externalId}/competitors','Competitors','Add competitor'],['delete','/apps/{platform}/{externalId}/competitors/{competitor}','Competitors','Remove competitor'],
  ['get','/apps/{platform}/{externalId}/keywords','Analytics','Keyword density'],['get','/apps/{platform}/{externalId}/keywords/compare','Analytics','Compare keywords'],['get','/apps/{platform}/{externalId}/rankings','Analytics','Rankings'],
  ['get','/apps/{platform}/{externalId}/ratings/summary','Analytics','Rating summary'],['get','/apps/{platform}/{externalId}/ratings/history','Analytics','Rating history'],['get','/apps/{platform}/{externalId}/ratings/country-breakdown','Analytics','Country ratings'],
  ['post','/apps/{platform}/{externalId}/sync','Apps','Queue synchronization'],['get','/apps/{platform}/{externalId}/sync-status','Apps','Synchronization status'],['get','/competitors','Competitors','All competitors'],
  ['get','/changes/apps','Changes','Tracked app changes'],['get','/changes/competitors','Changes','Competitor changes'],['get','/charts','Charts','Trending charts'],
  ['get','/explorer/screenshots','Explorer','Browse screenshots'],['get','/explorer/icons','Explorer','Browse icons'],['get','/countries','Reference','Countries'],['get','/store-categories','Reference','Store categories'],
  ['get','/publishers/search','Publishers','Search publishers'],['get','/publishers','Publishers','User publishers'],['get','/publishers/{platform}/{externalId}','Publishers','Publisher detail'],['get','/publishers/{platform}/{externalId}/store-apps','Publishers','Publisher store apps'],['post','/publishers/{platform}/{externalId}/import','Publishers','Import publisher apps'],
]) operation(method, path, tag, summary)

const document = {
  openapi: '3.1.0', info: { title: 'OpenApps by MBZA API', version: '2.0.0', description: 'Cloudflare-native App Store and Google Play intelligence API.' },
  servers: [{ url: 'https://apps.mbza.dev/api/v1' }], paths,
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, cookieAuth: { type: 'apiKey', in: 'cookie', name: '__Host-openapps-session' } }, schemas: { User: z.toJSONSchema(user), App: z.toJSONSchema(appResource) } },
}
const output = resolve(root, 'packages/contracts/openapi.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)
console.log(`Generated ${Object.keys(paths).length} OpenAPI paths`)
