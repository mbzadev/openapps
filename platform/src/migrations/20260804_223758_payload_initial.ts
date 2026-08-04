import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`payload_staff_sessions\` (
	\`_order\` integer NOT NULL,
	\`_parent_id\` integer NOT NULL,
	\`id\` text PRIMARY KEY NOT NULL,
	\`created_at\` text,
	\`expires_at\` text NOT NULL,
	FOREIGN KEY (\`_parent_id\`) REFERENCES \`payload_staff\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_staff_sessions_order_idx\` ON \`payload_staff_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`payload_staff_sessions_parent_id_idx\` ON \`payload_staff_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_staff\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`role\` text DEFAULT 'operator' NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`email\` text NOT NULL,
	\`reset_password_token\` text,
	\`reset_password_expiration\` text,
	\`salt\` text,
	\`hash\` text,
	\`login_attempts\` numeric DEFAULT 0,
	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_staff_updated_at_idx\` ON \`payload_staff\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_staff_created_at_idx\` ON \`payload_staff\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_staff_email_idx\` ON \`payload_staff\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`payload_countries\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`emoji\` text DEFAULT '',
	\`is_active_ios\` integer DEFAULT false,
	\`is_active_android\` integer DEFAULT false,
	\`ios_languages\` text DEFAULT '[]',
	\`android_languages\` text DEFAULT '[]',
	\`priority\` numeric DEFAULT 0,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_countries_priority_idx\` ON \`payload_countries\` (\`priority\`);`)
  await db.run(sql`CREATE INDEX \`payload_countries_updated_at_idx\` ON \`payload_countries\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_countries_created_at_idx\` ON \`payload_countries\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_connector_configs_capabilities\` (
	\`order\` integer NOT NULL,
	\`parent_id\` integer NOT NULL,
	\`value\` text,
	\`id\` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_connector_configs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_connector_configs_capabilities_order_idx\` ON \`payload_connector_configs_capabilities\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_connector_configs_capabilities_parent_idx\` ON \`payload_connector_configs_capabilities\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_connector_configs\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`label\` text NOT NULL,
	\`source\` text NOT NULL,
	\`enabled\` integer DEFAULT true,
	\`transport\` text NOT NULL,
	\`countries\` text DEFAULT '[]',
	\`requests_per_minute\` numeric DEFAULT 2,
	\`concurrency\` numeric DEFAULT 2,
	\`health\` text DEFAULT 'unknown',
	\`last_health_code\` text,
	\`last_success_at\` text,
	\`last_failure_at\` text,
	\`circuit_open_until\` text,
	\`secret_status\` text DEFAULT 'not-required',
	\`notes\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_connector_configs_source_idx\` ON \`payload_connector_configs\` (\`source\`);`)
  await db.run(sql`CREATE INDEX \`payload_connector_configs_enabled_idx\` ON \`payload_connector_configs\` (\`enabled\`);`)
  await db.run(sql`CREATE INDEX \`payload_connector_configs_health_idx\` ON \`payload_connector_configs\` (\`health\`);`)
  await db.run(sql`CREATE INDEX \`payload_connector_configs_updated_at_idx\` ON \`payload_connector_configs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_connector_configs_created_at_idx\` ON \`payload_connector_configs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_task_attempts\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`task_id\` text NOT NULL,
	\`attempt\` numeric NOT NULL,
	\`status\` text NOT NULL,
	\`source\` text,
	\`started_at\` text NOT NULL,
	\`completed_at\` text,
	\`duration_ms\` numeric,
	\`result_count\` numeric,
	\`error_code\` text,
	\`error_message\` text,
	\`raw_r2_key\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_task_attempts_task_id_idx\` ON \`payload_task_attempts\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_task_attempts_status_idx\` ON \`payload_task_attempts\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`payload_task_attempts_source_idx\` ON \`payload_task_attempts\` (\`source\`);`)
  await db.run(sql`CREATE INDEX \`payload_task_attempts_started_at_idx\` ON \`payload_task_attempts\` (\`started_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_task_attempts_updated_at_idx\` ON \`payload_task_attempts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_task_attempts_created_at_idx\` ON \`payload_task_attempts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_dead_letters\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`task_id\` text NOT NULL,
	\`kind\` text NOT NULL,
	\`source\` text,
	\`status\` text DEFAULT 'open',
	\`attempt_count\` numeric NOT NULL,
	\`error_code\` text,
	\`error_message\` text NOT NULL,
	\`payload\` text NOT NULL,
	\`raw_r2_key\` text,
	\`failed_at\` text NOT NULL,
	\`resolved_at\` text,
	\`resolved_by_id\` integer,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (\`resolved_by_id\`) REFERENCES \`payload_staff\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_dead_letters_task_id_idx\` ON \`payload_dead_letters\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_dead_letters_kind_idx\` ON \`payload_dead_letters\` (\`kind\`);`)
  await db.run(sql`CREATE INDEX \`payload_dead_letters_source_idx\` ON \`payload_dead_letters\` (\`source\`);`)
  await db.run(sql`CREATE INDEX \`payload_dead_letters_status_idx\` ON \`payload_dead_letters\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`payload_dead_letters_failed_at_idx\` ON \`payload_dead_letters\` (\`failed_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_dead_letters_resolved_by_idx\` ON \`payload_dead_letters\` (\`resolved_by_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_dead_letters_updated_at_idx\` ON \`payload_dead_letters\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_dead_letters_created_at_idx\` ON \`payload_dead_letters\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_media\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`alt\` text NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`url\` text,
	\`thumbnail_u_r_l\` text,
	\`filename\` text,
	\`mime_type\` text,
	\`filesize\` numeric,
	\`width\` numeric,
	\`height\` numeric
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_media_updated_at_idx\` ON \`payload_media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_media_created_at_idx\` ON \`payload_media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_media_filename_idx\` ON \`payload_media\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`payload_audit_logs\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`actor_id\` integer,
	\`action\` text NOT NULL,
	\`entity_type\` text NOT NULL,
	\`entity_id\` text,
	\`metadata\` text,
	\`ip_address\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (\`actor_id\`) REFERENCES \`payload_staff\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_audit_logs_actor_idx\` ON \`payload_audit_logs\` (\`actor_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_audit_logs_action_idx\` ON \`payload_audit_logs\` (\`action\`);`)
  await db.run(sql`CREATE INDEX \`payload_audit_logs_entity_type_idx\` ON \`payload_audit_logs\` (\`entity_type\`);`)
  await db.run(sql`CREATE INDEX \`payload_audit_logs_entity_id_idx\` ON \`payload_audit_logs\` (\`entity_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_audit_logs_updated_at_idx\` ON \`payload_audit_logs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_audit_logs_created_at_idx\` ON \`payload_audit_logs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`key\` text NOT NULL,
	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`global_slug\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`order\` integer,
	\`parent_id\` integer NOT NULL,
	\`path\` text NOT NULL,
	\`payload_staff_id\` integer,
	\`users_id\` integer,
	\`payload_countries_id\` text,
	\`store_categories_id\` integer,
	\`publishers_id\` integer,
	\`apps_id\` integer,
	\`app_versions_id\` integer,
	\`app_store_listings_id\` integer,
	\`app_metrics_id\` integer,
	\`payload_connector_configs_id\` integer,
	\`sync_tasks_id\` integer,
	\`payload_task_attempts_id\` integer,
	\`ad_collection_runs_id\` integer,
	\`payload_dead_letters_id\` integer,
	\`ad_advertisers_id\` integer,
	\`ads_id\` integer,
	\`ad_assets_id\` integer,
	\`ad_app_links_id\` integer,
	\`payload_media_id\` integer,
	\`payload_audit_logs_id\` integer,
	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_staff_id\`) REFERENCES \`payload_staff\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_countries_id\`) REFERENCES \`payload_countries\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`store_categories_id\`) REFERENCES \`store_categories\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`publishers_id\`) REFERENCES \`publishers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`apps_id\`) REFERENCES \`apps\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`app_versions_id\`) REFERENCES \`app_versions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`app_store_listings_id\`) REFERENCES \`app_store_listings\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`app_metrics_id\`) REFERENCES \`app_metrics\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_connector_configs_id\`) REFERENCES \`payload_connector_configs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`sync_tasks_id\`) REFERENCES \`sync_tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_task_attempts_id\`) REFERENCES \`payload_task_attempts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`ad_collection_runs_id\`) REFERENCES \`ad_collection_runs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_dead_letters_id\`) REFERENCES \`payload_dead_letters\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`ad_advertisers_id\`) REFERENCES \`ad_advertisers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`ads_id\`) REFERENCES \`ads\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`ad_assets_id\`) REFERENCES \`ad_assets\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`ad_app_links_id\`) REFERENCES \`ad_app_links\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_media_id\`) REFERENCES \`payload_media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_audit_logs_id\`) REFERENCES \`payload_audit_logs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_staff_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_staff_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_countries_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_countries_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_categories_id_idx\` ON \`payload_locked_documents_rels\` (\`store_categories_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_publishers_id_idx\` ON \`payload_locked_documents_rels\` (\`publishers_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_apps_id_idx\` ON \`payload_locked_documents_rels\` (\`apps_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_app_versions_id_idx\` ON \`payload_locked_documents_rels\` (\`app_versions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_app_store_listings_id_idx\` ON \`payload_locked_documents_rels\` (\`app_store_listings_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_app_metrics_id_idx\` ON \`payload_locked_documents_rels\` (\`app_metrics_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_connector_configs__idx\` ON \`payload_locked_documents_rels\` (\`payload_connector_configs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_sync_tasks_id_idx\` ON \`payload_locked_documents_rels\` (\`sync_tasks_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_task_attempts_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_task_attempts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ad_collection_runs_id_idx\` ON \`payload_locked_documents_rels\` (\`ad_collection_runs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_dead_letters_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_dead_letters_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ad_advertisers_id_idx\` ON \`payload_locked_documents_rels\` (\`ad_advertisers_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ads_id_idx\` ON \`payload_locked_documents_rels\` (\`ads_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ad_assets_id_idx\` ON \`payload_locked_documents_rels\` (\`ad_assets_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ad_app_links_id_idx\` ON \`payload_locked_documents_rels\` (\`ad_app_links_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_media_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_audit_logs_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_audit_logs_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`key\` text,
	\`value\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`order\` integer,
	\`parent_id\` integer NOT NULL,
	\`path\` text NOT NULL,
	\`payload_staff_id\` integer,
	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`payload_staff_id\`) REFERENCES \`payload_staff\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_payload_staff_id_idx\` ON \`payload_preferences_rels\` (\`payload_staff_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`name\` text,
	\`batch\` numeric,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`payload_staff_sessions\`;`)
  await db.run(sql`DROP TABLE \`payload_staff\`;`)
  await db.run(sql`DROP TABLE \`payload_countries\`;`)
  await db.run(sql`DROP TABLE \`payload_connector_configs_capabilities\`;`)
  await db.run(sql`DROP TABLE \`payload_connector_configs\`;`)
  await db.run(sql`DROP TABLE \`payload_task_attempts\`;`)
  await db.run(sql`DROP TABLE \`payload_dead_letters\`;`)
  await db.run(sql`DROP TABLE \`payload_media\`;`)
  await db.run(sql`DROP TABLE \`payload_audit_logs\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
}
