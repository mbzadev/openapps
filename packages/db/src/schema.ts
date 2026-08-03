import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, unique, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}

export const users = sqliteTable('users', {
  id: integer().primaryKey({ autoIncrement: true }), name: text().notNull(),
  email: text().notNull().unique(), emailVerifiedAt: text('email_verified_at'),
  passwordHash: text('password_hash').notNull(), ...timestamps,
})

export const personalAccessTokens = sqliteTable('personal_access_tokens', {
  id: integer().primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(), tokenHash: text('token_hash').notNull().unique(),
  abilities: text({ mode: 'json' }).notNull().default([]), lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'), ...timestamps,
}, (table) => [index('personal_access_tokens_user_id_idx').on(table.userId)])

export const publishers = sqliteTable('publishers', {
  id: integer().primaryKey({ autoIncrement: true }), platform: text({ enum: ['ios', 'android'] }).notNull(),
  externalId: text('external_id').notNull(), name: text().notNull(), url: text(), ...timestamps,
}, (table) => [unique().on(table.platform, table.externalId), index('publishers_name_idx').on(table.name)])

export const storeCategories = sqliteTable('store_categories', {
  id: integer().primaryKey({ autoIncrement: true }), platform: text({ enum: ['ios', 'android'] }).notNull(),
  externalId: text('external_id'), name: text().notNull(), slug: text().notNull(),
  type: text({ enum: ['app', 'game', 'magazine'] }).notNull(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => storeCategories.id, { onDelete: 'set null' }),
  priority: integer().notNull().default(0), ...timestamps,
}, (table) => [
  uniqueIndex('store_categories_platform_external_unique').on(table.platform, table.externalId).where(sql`${table.externalId} IS NOT NULL`),
  uniqueIndex('store_categories_platform_all_unique').on(table.platform).where(sql`${table.externalId} IS NULL`),
])

export const countries = sqliteTable('countries', {
  code: text().primaryKey(), name: text().notNull(), emoji: text().notNull().default(''),
  isActiveIos: integer('is_active_ios', { mode: 'boolean' }).notNull().default(false),
  isActiveAndroid: integer('is_active_android', { mode: 'boolean' }).notNull().default(false),
  iosLanguages: text('ios_languages', { mode: 'json' }).notNull().default([]),
  androidLanguages: text('android_languages', { mode: 'json' }).notNull().default([]),
  priority: integer().notNull().default(0), ...timestamps,
})

export const apps = sqliteTable('apps', {
  id: integer().primaryKey({ autoIncrement: true }), platform: text({ enum: ['ios', 'android'] }).notNull(),
  externalId: text('external_id').notNull(), publisherId: integer('publisher_id').references(() => publishers.id, { onDelete: 'set null' }),
  categoryId: integer('category_id').references(() => storeCategories.id, { onDelete: 'set null' }),
  displayName: text('display_name').notNull().default(''), iconUrl: text('icon_url'),
  originCountryCode: text('origin_country_code').notNull().default('us').references(() => countries.code),
  supportedLocales: text('supported_locales', { mode: 'json' }).notNull().default([]), originalReleaseDate: text('original_release_date'),
  isFree: integer('is_free', { mode: 'boolean' }).notNull().default(true), discoveredFrom: text('discovered_from').notNull().default('unknown'),
  discoveredAt: text('discovered_at').notNull(), lastSyncedAt: text('last_synced_at'),
  isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true), ...timestamps,
}, (table) => [unique().on(table.platform, table.externalId), index('apps_publisher_idx').on(table.publisherId), index('apps_category_idx').on(table.categoryId), index('apps_last_synced_idx').on(table.lastSyncedAt)])

export const folders = sqliteTable('folders', {
  id: integer().primaryKey({ autoIncrement: true }), userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(), color: text().notNull().default('slate'), position: integer().notNull().default(0), ...timestamps,
}, (table) => [unique().on(table.userId, table.name)])

export const userApps = sqliteTable('user_apps', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  appId: integer('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }), createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.appId] }), index('user_apps_folder_idx').on(table.folderId)])

export const appVersions = sqliteTable('app_versions', {
  id: integer().primaryKey({ autoIncrement: true }), appId: integer('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  version: text().notNull(), releaseDate: text('release_date'), whatsNew: text('whats_new'), fileSizeBytes: integer('file_size_bytes'), ...timestamps,
}, (table) => [unique().on(table.appId, table.version)])

export const appStoreListings = sqliteTable('app_store_listings', {
  id: integer().primaryKey({ autoIncrement: true }), appId: integer('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  versionId: integer('version_id').references(() => appVersions.id, { onDelete: 'set null' }), locale: text().notNull(), title: text().notNull(),
  subtitle: text(), promotionalText: text('promotional_text'), description: text().notNull().default(''), whatsNew: text('whats_new'),
  screenshots: text({ mode: 'json' }).notNull().default([]), iconUrl: text('icon_url'), videoUrl: text('video_url'),
  price: real().notNull().default(0), currency: text(), fetchedAt: text('fetched_at').notNull(), checksum: text().notNull(), ...timestamps,
}, (table) => [uniqueIndex('app_store_listings_unique').on(table.appId, sql`ifnull(${table.versionId}, 0)`, table.locale), index('app_store_listings_app_locale_idx').on(table.appId, table.locale)])

export const appStoreListingChanges = sqliteTable('app_store_listing_changes', {
  id: integer().primaryKey({ autoIncrement: true }), appId: integer('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  versionId: integer('version_id').references(() => appVersions.id, { onDelete: 'set null' }), locale: text().notNull(), fieldChanged: text('field_changed').notNull(),
  oldValue: text('old_value'), newValue: text('new_value'), detectedAt: text('detected_at').notNull(), ...timestamps,
}, (table) => [index('listing_changes_app_detected_idx').on(table.appId, table.detectedAt)])

export const appMetrics = sqliteTable('app_metrics', {
  id: integer().primaryKey({ autoIncrement: true }), appId: integer('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  versionId: integer('version_id').references(() => appVersions.id, { onDelete: 'set null' }), countryCode: text('country_code').notNull().references(() => countries.code),
  date: text().notNull(), rating: real().notNull().default(0), ratingCount: integer('rating_count').notNull().default(0),
  ratingBreakdown: text('rating_breakdown', { mode: 'json' }), isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true), ...timestamps,
}, (table) => [unique().on(table.appId, table.countryCode, table.date), index('app_metrics_app_date_idx').on(table.appId, table.date)])

export const appCompetitors = sqliteTable('app_competitors', {
  id: integer().primaryKey({ autoIncrement: true }), userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  appId: integer('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }), competitorAppId: integer('competitor_app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  relationship: text().notNull().default('direct'), ...timestamps,
}, (table) => [unique().on(table.userId, table.appId, table.competitorAppId)])

export const trendingCharts = sqliteTable('trending_charts', {
  id: integer().primaryKey({ autoIncrement: true }), platform: text({ enum: ['ios', 'android'] }).notNull(),
  collection: text({ enum: ['top_free', 'top_paid', 'top_grossing'] }).notNull(), categoryId: integer('category_id').notNull().references(() => storeCategories.id),
  countryCode: text('country_code').notNull().references(() => countries.code), snapshotDate: text('snapshot_date').notNull(), ...timestamps,
}, (table) => [unique().on(table.platform, table.collection, table.countryCode, table.categoryId, table.snapshotDate)])

export const trendingChartEntries = sqliteTable('trending_chart_entries', {
  id: integer().primaryKey({ autoIncrement: true }), trendingChartId: integer('trending_chart_id').notNull().references(() => trendingCharts.id, { onDelete: 'cascade' }),
  rank: integer().notNull(), appId: integer('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }), price: real().notNull().default(0), currency: text(),
}, (table) => [unique().on(table.trendingChartId, table.rank), unique().on(table.trendingChartId, table.appId), index('trending_chart_entries_app_idx').on(table.appId, table.trendingChartId)])

export const syncStatuses = sqliteTable('sync_statuses', {
  id: integer().primaryKey({ autoIncrement: true }), appId: integer('app_id').notNull().unique().references(() => apps.id, { onDelete: 'cascade' }),
  status: text().notNull().default('pending'), currentStep: text('current_step'), progressDone: integer('progress_done').notNull().default(0),
  progressTotal: integer('progress_total').notNull().default(0), errorMessage: text('error_message'), jobId: text('job_id'), nextRetryAt: text('next_retry_at'),
  startedAt: text('started_at'), completedAt: text('completed_at'), ...timestamps,
})

export const syncTasks = sqliteTable('sync_tasks', {
  id: integer().primaryKey({ autoIncrement: true }), syncStatusId: integer('sync_status_id').references(() => syncStatuses.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().unique(), kind: text().notNull(), payload: text({ mode: 'json' }).notNull(), status: text().notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0), failureReason: text('failure_reason'), errorMessage: text('error_message'), availableAt: text('available_at'), ...timestamps,
}, (table) => [index('sync_tasks_retry_idx').on(table.status, table.availableAt)])
