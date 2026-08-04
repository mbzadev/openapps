import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCloudflareContext, type CloudflareContext } from '@opennextjs/cloudflare'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { r2Storage } from '@payloadcms/storage-r2'
import { buildConfig } from 'payload'
import type { GetPlatformProxyOptions } from 'wrangler'

import { Apps, AppListings, AppMetrics, AppVersions, Countries, Members, Publishers, StoreCategories } from '@/collections/Catalog'
import { AdAppLinks, AdAssets, Ads, Advertisers, PayloadMedia } from '@/collections/Creatives'
import { AuditLogs, CollectionRuns, ConnectorConfigs, DeadLetters, SyncTasks, TaskAttempts } from '@/collections/Operations'
import { Staff } from '@/collections/Staff'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => fs.existsSync(value) ? fs.realpathSync(value) : undefined
const isCLI = process.argv.some((value) => realpath(value)?.endsWith(path.join('payload', 'bin.js')))
const isProduction = process.env.NODE_ENV === 'production'

const cloudflare = isCLI || !isProduction
  ? await getCloudflareContextFromWrangler()
  : await getCloudflareContext({ async: true })

type RuntimeEnv = CloudflareEnv & { PAYLOAD_SECRET?: string }
const runtimeEnv = cloudflare.env as RuntimeEnv
const appURL = runtimeEnv.APP_URL || process.env.APP_URL || 'http://localhost:3000'
const buildOnlySecret = process.env.OPENAPPS_BUILD_PHASE === '1' ? 'openapps-build-only-not-runtime' : undefined
const payloadSecret = runtimeEnv.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET || buildOnlySecret

if (!payloadSecret) throw new Error('PAYLOAD_SECRET is required')

export default buildConfig({
  admin: {
    user: Staff.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: '— OpenApps' },
    components: {
      views: {
        dashboard: { Component: '/components/OpsDashboard' },
      },
    },
  },
  collections: [
    Staff,
    Members,
    Countries,
    StoreCategories,
    Publishers,
    Apps,
    AppVersions,
    AppListings,
    AppMetrics,
    ConnectorConfigs,
    SyncTasks,
    TaskAttempts,
    CollectionRuns,
    DeadLetters,
    Advertisers,
    Ads,
    AdAssets,
    AdAppLinks,
    PayloadMedia,
    AuditLogs,
  ],
  cors: [appURL],
  csrf: [appURL],
  db: sqliteD1Adapter({ binding: runtimeEnv.DB }),
  editor: lexicalEditor(),
  logger: isProduction ? { options: { level: process.env.PAYLOAD_LOG_LEVEL ?? 'info' } } : undefined,
  plugins: [r2Storage({ bucket: runtimeEnv.PAYLOAD_MEDIA, collections: { 'payload-media': true } })],
  routes: { admin: '/admin', api: '/payload-api' },
  secret: payloadSecret,
  serverURL: appURL,
  telemetry: false,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
})

function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(({ getPlatformProxy }) =>
    getPlatformProxy({
      configPath: process.env.CLOUDFLARE_CONFIG_PATH,
      environment: process.env.CLOUDFLARE_ENV,
      remoteBindings: isProduction,
    } satisfies GetPlatformProxyOptions),
  )
}
