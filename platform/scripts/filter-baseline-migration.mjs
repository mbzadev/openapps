import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const migrationPath = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Pass the generated Payload migration path')

const legacyTables = new Set([
  'users',
  'store_categories',
  'publishers',
  'apps',
  'app_versions',
  'app_store_listings',
  'app_metrics',
  'sync_tasks',
  'ad_collection_runs',
  'ad_advertisers',
  'ads',
  'ad_assets',
  'ad_app_links',
])

const source = await readFile(migrationPath, 'utf8')
const filtered = source.replace(/  await db\.run\(sql`([\s\S]*?)`\)\n/g, (statement, sql) => {
  const normalized = sql.replaceAll('\\`', '`')
  const createTable = normalized.match(/^CREATE TABLE `([^`]+)`/)
  const createIndex = normalized.match(/^CREATE (?:UNIQUE )?INDEX `[^`]+` ON `([^`]+)`/)
  const dropTable = normalized.match(/^DROP TABLE `([^`]+)`/)
  const table = createTable?.[1] ?? createIndex?.[1] ?? dropTable?.[1]
  return table && legacyTables.has(table) ? '' : statement
})

await writeFile(migrationPath, filtered)
