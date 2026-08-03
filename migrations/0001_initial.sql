PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email_verified_at TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE personal_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  abilities TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(abilities)),
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX personal_access_tokens_user_id_idx ON personal_access_tokens(user_id);

CREATE TABLE publishers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, external_id)
);
CREATE INDEX publishers_name_idx ON publishers(name COLLATE NOCASE);

CREATE TABLE store_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  external_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('app', 'game', 'magazine')),
  parent_id INTEGER REFERENCES store_categories(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX store_categories_platform_external_unique
  ON store_categories(platform, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX store_categories_platform_all_unique
  ON store_categories(platform) WHERE external_id IS NULL;

CREATE TABLE countries (
  code TEXT PRIMARY KEY CHECK (length(code) = 2),
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  is_active_ios INTEGER NOT NULL DEFAULT 0 CHECK (is_active_ios IN (0, 1)),
  is_active_android INTEGER NOT NULL DEFAULT 0 CHECK (is_active_android IN (0, 1)),
  ios_languages TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(ios_languages)),
  android_languages TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(android_languages)),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  external_id TEXT NOT NULL,
  publisher_id INTEGER REFERENCES publishers(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES store_categories(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  origin_country_code TEXT NOT NULL DEFAULT 'us' REFERENCES countries(code),
  supported_locales TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supported_locales)),
  original_release_date TEXT,
  is_free INTEGER NOT NULL DEFAULT 1 CHECK (is_free IN (0, 1)),
  discovered_from TEXT NOT NULL DEFAULT 'unknown',
  discovered_at TEXT NOT NULL,
  last_synced_at TEXT,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, external_id)
);
CREATE INDEX apps_publisher_idx ON apps(publisher_id);
CREATE INDEX apps_category_idx ON apps(category_id);
CREATE INDEX apps_last_synced_idx ON apps(last_synced_at);

CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'slate',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE user_apps (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, app_id)
);
CREATE INDEX user_apps_folder_idx ON user_apps(folder_id);

CREATE TABLE app_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  release_date TEXT,
  whats_new TEXT,
  file_size_bytes INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(app_id, version)
);

CREATE TABLE app_store_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES app_versions(id) ON DELETE SET NULL,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  promotional_text TEXT,
  description TEXT NOT NULL DEFAULT '',
  whats_new TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(screenshots)),
  icon_url TEXT,
  video_url TEXT,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT,
  fetched_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX app_store_listings_unique
  ON app_store_listings(app_id, ifnull(version_id, 0), locale);
CREATE INDEX app_store_listings_app_locale_idx ON app_store_listings(app_id, locale);

CREATE TABLE app_store_listing_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES app_versions(id) ON DELETE SET NULL,
  locale TEXT NOT NULL,
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX listing_changes_app_detected_idx
  ON app_store_listing_changes(app_id, detected_at DESC);

CREATE TABLE app_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES app_versions(id) ON DELETE SET NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  date TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  rating_breakdown TEXT CHECK (rating_breakdown IS NULL OR json_valid(rating_breakdown)),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(app_id, country_code, date)
);
CREATE INDEX app_metrics_app_date_idx ON app_metrics(app_id, date DESC);

CREATE TABLE app_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  competitor_app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (app_id != competitor_app_id),
  UNIQUE(user_id, app_id, competitor_app_id)
);

CREATE TABLE trending_charts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  collection TEXT NOT NULL CHECK (collection IN ('top_free', 'top_paid', 'top_grossing')),
  category_id INTEGER NOT NULL REFERENCES store_categories(id),
  country_code TEXT NOT NULL REFERENCES countries(code),
  snapshot_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, collection, country_code, category_id, snapshot_date)
);

CREATE TABLE trending_chart_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trending_chart_id INTEGER NOT NULL REFERENCES trending_charts(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT,
  UNIQUE(trending_chart_id, rank),
  UNIQUE(trending_chart_id, app_id)
);
CREATE INDEX trending_chart_entries_app_idx ON trending_chart_entries(app_id, trending_chart_id);

CREATE TABLE sync_statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL UNIQUE REFERENCES apps(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  job_id TEXT,
  next_retry_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_status_id INTEGER REFERENCES sync_statuses(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  error_message TEXT,
  available_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sync_tasks_retry_idx ON sync_tasks(status, available_at);
