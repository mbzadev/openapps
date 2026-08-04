import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'
import {
  apiTokenCreateRequest, appIdentity, appResource, competitorCreateRequest, errorResponse,
  folderCreateRequest, folderUpdateRequest, loginRequest, moveToFolderRequest,
  passwordUpdateRequest, profileDeleteRequest, profileUpdateRequest, publisherImportRequest,
  registerRequest, user,
  creativePage, creativeResource, creativeSyncResponse,
} from '../packages/contracts/src/schemas.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const paths = {}
const looseObject = z.object({}).loose()
const looseArray = z.array(looseObject)
const authResponse = z.object({ token: z.string(), user })
const folderResource = z.object({ id: z.number().int(), name: z.string(), color: z.string(), sort_order: z.number().int(), apps_count: z.number().int(), created_at: z.string(), updated_at: z.string() })
const successSchemas = {
  register: authResponse, login: authResponse, me: user, showProfile: user, updateProfile: user,
  listApiTokens: looseArray, createApiToken: looseObject,
  dashboard: looseObject, listFolders: z.array(folderResource), storeFolder: folderResource, updateFolder: folderResource,
  searchApps: z.array(appResource), listApps: z.array(appResource), storeApp: appResource, showApp: appResource, appListing: looseObject,
  syncApp: looseObject, appSyncStatus: looseObject, listCompetitors: looseArray, storeCompetitor: looseObject,
  listAllCompetitors: looseArray, listAppRankings: looseArray, appKeywords: looseObject, compareKeywords: looseObject,
  getRatingSummary: looseObject, getRatingHistory: looseArray, getRatingCountryBreakdown: looseObject,
  appChanges: looseObject, competitorChanges: looseObject, getCharts: looseObject,
  exploreScreenshots: looseObject, exploreIcons: looseObject, listCountries: looseArray, listStoreCategories: looseArray,
  searchPublishers: looseArray, listPublishers: looseArray, showPublisher: looseObject, publisherStoreApps: looseObject,
  listCreatives: creativePage, showCreative: creativeResource, listAppCreatives: creativePage,
  syncAppCreatives: creativeSyncResponse, listAdvertiserCreatives: creativePage,
}
const stringQuery = (name, required = false, extra = {}) => ({ name, in: 'query', required, schema: { type: 'string', ...extra } })
const integerQuery = (name, required = false, extra = {}) => ({ name, in: 'query', required, schema: { type: 'integer', ...extra } })
const platformQuery = (required = false) => stringQuery('platform', required, { enum: ['ios', 'android'] })
const pageQueries = [integerQuery('page', false, { minimum: 1 }), integerQuery('per_page', false, { minimum: 1, maximum: 100 })]
const changeQueries = [
  ...pageQueries, stringQuery('field'), platformQuery(), stringQuery('search', false, { maxLength: 100 }),
  integerQuery('app_id', false, { minimum: 1 }), stringQuery('folder_id'),
]
const queryParameters = {
  listApps: [platformQuery(), stringQuery('search', false, { maxLength: 100 }), stringQuery('folder_id')],
  appListing: [stringQuery('country_code', true, { minLength: 2, maxLength: 2 }), stringQuery('locale', true, { maxLength: 10 })],
  listAppRankings: [stringQuery('date', false, { format: 'date' }), stringQuery('collection', false, { enum: ['top_free', 'top_paid', 'top_grossing', 'all'] })],
  searchApps: [stringQuery('term', true, { minLength: 2, maxLength: 100 }), platformQuery(true), stringQuery('country_code', false, { minLength: 2, maxLength: 2 }), { name: 'exclude_external_ids[]', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } }],
  listAllCompetitors: [platformQuery(), stringQuery('search', false, { maxLength: 100 }), stringQuery('folder_id')],
  appKeywords: [stringQuery('locale'), integerQuery('ngram', false, { minimum: 1, maximum: 4 }), integerQuery('version_id', false, { minimum: 1 }), stringQuery('search', false, { maxLength: 100 }), stringQuery('sort', false, { enum: ['keyword', 'count', 'density'] }), stringQuery('order', false, { enum: ['asc', 'desc'] }), integerQuery('per_page', false, { minimum: 1, maximum: 500 }), integerQuery('page', false, { minimum: 1 })],
  compareKeywords: [{ name: 'app_ids[]', in: 'query', required: true, schema: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'integer', minimum: 1 } } }, stringQuery('locale'), integerQuery('ngram', false, { minimum: 1, maximum: 4 })],
  getRatingHistory: [integerQuery('days', false, { minimum: 1, maximum: 90 })],
  appChanges: changeQueries,
  competitorChanges: changeQueries,
  getCharts: [platformQuery(true), stringQuery('collection', true, { enum: ['top_free', 'top_paid', 'top_grossing'] }), stringQuery('country_code', false, { minLength: 2, maxLength: 2, default: 'us' }), integerQuery('category_id', false, { minimum: 1 })],
  exploreScreenshots: [platformQuery(), integerQuery('category_id', false, { minimum: 1 }), stringQuery('search'), ...pageQueries],
  exploreIcons: [platformQuery(), integerQuery('category_id', false, { minimum: 1 }), stringQuery('search'), ...pageQueries],
  listStoreCategories: [platformQuery(), stringQuery('type', false, { enum: ['app', 'game', 'magazine'] })],
  searchPublishers: [stringQuery('term', true, { minLength: 2 }), platformQuery(true), stringQuery('country_code', false, { minLength: 2, maxLength: 2 })],
  showPublisher: [stringQuery('name')],
  publisherStoreApps: [stringQuery('country_code', false, { minLength: 2, maxLength: 2 })],
  listCreatives: [...pageQueries, stringQuery('search', false, { maxLength: 100 }), stringQuery('source', false, { enum: ['meta', 'google', 'tiktok'] }),
    stringQuery('app'), integerQuery('app_id', false, { minimum: 1 }), integerQuery('advertiser_id', false, { minimum: 1 }),
    integerQuery('publisher_id', false, { minimum: 1 }), stringQuery('country', false, { minLength: 2, maxLength: 2 }),
    stringQuery('format', false, { enum: ['image', 'video', 'carousel', 'text', 'unknown'] }),
    stringQuery('status', false, { enum: ['active', 'inactive', 'removed', 'unknown'] }), stringQuery('date_from', false, { format: 'date' }), stringQuery('date_to', false, { format: 'date' })],
  listAppCreatives: [...pageQueries, stringQuery('source', false, { enum: ['meta', 'google', 'tiktok'] }), stringQuery('country', false, { minLength: 2, maxLength: 2 }), stringQuery('format', false, { enum: ['image', 'video', 'carousel', 'text', 'unknown'] })],
  listAdvertiserCreatives: [...pageQueries, stringQuery('source', false, { enum: ['meta', 'google', 'tiktok'] }), stringQuery('country', false, { minLength: 2, maxLength: 2 }), stringQuery('format', false, { enum: ['image', 'video', 'carousel', 'text', 'unknown'] })],
}
const operation = (method, path, tag, summary, operationId, requestBody, options = {}) => {
  paths[path] ??= {}
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name, in: 'path', required: true,
    schema: name === 'platform' ? { type: 'string', enum: ['ios', 'android'] } : name === 'tokenId' || name === 'folder' || name === 'competitor' ? { type: 'integer', minimum: 1 } : { type: 'string' },
  })).concat(queryParameters[operationId] ?? [])
  const successStatus = options.status ?? 200
  const successResponse = successStatus === 204
    ? { description: 'No content' }
    : { description: 'Success', content: { 'application/json': { schema: z.toJSONSchema(successSchemas[operationId] ?? looseObject) } } }
  paths[path][method.toLowerCase()] = {
    tags: [tag], summary, operationId,
    security: options.public ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(requestBody) } } } } : {}),
    responses: { [successStatus]: successResponse, 401: { description: 'Unauthenticated', content: { 'application/json': { schema: z.toJSONSchema(errorResponse) } } }, 422: { description: 'Validation error', content: { 'application/json': { schema: z.toJSONSchema(errorResponse) } } } },
  }
}

operation('post', '/auth/register', 'Auth', 'Register a public account', 'register', registerRequest, { public: true, status: 201 })
operation('post', '/auth/login', 'Auth', 'Login and create a secure browser session', 'login', loginRequest, { public: true })
operation('post', '/auth/logout', 'Auth', 'Revoke the current session', 'logout', undefined, { status: 204 })
operation('get', '/auth/me', 'Auth', 'Current user', 'me')
for (const [method, path, tag, summary, operationId, requestBody, options] of [
  ['get','/account/profile','Account','Show profile','showProfile'],['patch','/account/profile','Account','Update profile','updateProfile',profileUpdateRequest],['delete','/account/profile','Account','Delete profile','deleteProfile',profileDeleteRequest,{ status: 204 }],['put','/account/password','Account','Update password','updatePassword',passwordUpdateRequest],
  ['get','/account/api-tokens','Account','List API tokens','listApiTokens'],['post','/account/api-tokens','Account','Create API token','createApiToken',apiTokenCreateRequest,{ status: 201 }],['delete','/account/api-tokens/{tokenId}','Account','Delete API token','revokeApiToken',undefined,{ status: 204 }],
  ['get','/dashboard','Dashboard','Dashboard','dashboard'],['get','/folders','Folders','List folders','listFolders'],['post','/folders','Folders','Create folder','storeFolder',folderCreateRequest,{ status: 201 }],['patch','/folders/{folder}','Folders','Update folder','updateFolder',folderUpdateRequest],['delete','/folders/{folder}','Folders','Delete folder','destroyFolder',undefined,{ status: 204 }],
  ['get','/apps/search','Apps','Search store apps','searchApps'],['get','/apps','Apps','List tracked apps','listApps'],['post','/apps','Apps','Import app','storeApp',appIdentity,{ status: 201 }],['get','/apps/{platform}/{externalId}','Apps','App detail','showApp'],['get','/apps/{platform}/{externalId}/listing','Apps','Store listing','appListing'],
  ['patch','/apps/{platform}/{externalId}/folder','Apps','Move app','moveAppToFolder',moveToFolderRequest,{ status: 204 }],['post','/apps/{platform}/{externalId}/track','Apps','Track app','trackApp',undefined,{ status: 204 }],['delete','/apps/{platform}/{externalId}/track','Apps','Untrack app','untrackApp',undefined,{ status: 204 }],
  ['get','/apps/{platform}/{externalId}/competitors','Apps','List competitors','listCompetitors'],['post','/apps/{platform}/{externalId}/competitors','Apps','Add competitor','storeCompetitor',competitorCreateRequest,{ status: 201 }],['delete','/apps/{platform}/{externalId}/competitors/{competitor}','Apps','Remove competitor','deleteCompetitor',undefined,{ status: 204 }],
  ['get','/apps/{platform}/{externalId}/keywords','Apps','Keyword density','appKeywords'],['get','/apps/{platform}/{externalId}/keywords/compare','Apps','Compare keywords','compareKeywords'],['get','/apps/{platform}/{externalId}/rankings','Apps','Rankings','listAppRankings'],
  ['get','/apps/{platform}/{externalId}/ratings/summary','Apps','Rating summary','getRatingSummary'],['get','/apps/{platform}/{externalId}/ratings/history','Apps','Rating history','getRatingHistory'],['get','/apps/{platform}/{externalId}/ratings/country-breakdown','Apps','Country ratings','getRatingCountryBreakdown'],
  ['post','/apps/{platform}/{externalId}/sync','Apps','Queue synchronization','syncApp'],['get','/apps/{platform}/{externalId}/sync-status','Apps','Synchronization status','appSyncStatus'],['get','/competitors','Apps','All competitors','listAllCompetitors'],
  ['get','/changes/apps','Change Monitor','Tracked app changes','appChanges'],['get','/changes/competitors','Change Monitor','Competitor changes','competitorChanges'],['get','/charts','Charts','Trending charts','getCharts'],
  ['get','/explorer/screenshots','Explorer','Browse screenshots','exploreScreenshots'],['get','/explorer/icons','Explorer','Browse icons','exploreIcons'],['get','/countries','Countries','Countries','listCountries'],['get','/store-categories','Store Categories','Store categories','listStoreCategories'],
  ['get','/publishers/search','Publishers','Search publishers','searchPublishers'],['get','/publishers','Publishers','User publishers','listPublishers'],['get','/publishers/{platform}/{externalId}','Publishers','Publisher detail','showPublisher'],['get','/publishers/{platform}/{externalId}/store-apps','Publishers','Publisher store apps','publisherStoreApps'],['post','/publishers/{platform}/{externalId}/import','Publishers','Import publisher apps','importPublisherApps',publisherImportRequest,{ status: 204 }],
  ['get','/creatives','Creatives','Search public ad creatives','listCreatives'],['get','/creatives/{id}','Creatives','Creative detail','showCreative'],
  ['get','/apps/{platform}/{externalId}/creatives','Creatives','App creatives','listAppCreatives'],['post','/apps/{platform}/{externalId}/creatives/sync','Creatives','Queue creative refresh','syncAppCreatives',undefined,{ status: 202 }],
  ['get','/ad-advertisers/{id}/creatives','Creatives','Advertiser creatives','listAdvertiserCreatives'],
]) operation(method, path, tag, summary, operationId, requestBody, options)

const document = {
  openapi: '3.1.0', info: { title: 'OpenApps API', version: '2.0.0', description: 'Cloudflare-native App Store and Google Play intelligence API.' },
  servers: [{ url: 'https://apps.mbza.dev/api/v1' }], paths,
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, cookieAuth: { type: 'apiKey', in: 'cookie', name: '__Host-openapps-session' } }, schemas: { User: z.toJSONSchema(user), App: z.toJSONSchema(appResource) } },
}
const output = resolve(root, 'packages/contracts/openapi.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)
console.log(`Generated ${Object.keys(paths).length} OpenAPI paths`)
