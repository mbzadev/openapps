PRAGMA foreign_keys = ON;

CREATE TABLE ad_advertisers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('meta','google','tiktok')),
  source_advertiser_id TEXT,
  name TEXT NOT NULL,
  domain TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ad_advertisers_source_external_unique
  ON ad_advertisers(source, source_advertiser_id) WHERE source_advertiser_id IS NOT NULL;
CREATE INDEX ad_advertisers_name_idx ON ad_advertisers(name COLLATE NOCASE);
CREATE INDEX ad_advertisers_domain_idx ON ad_advertisers(domain);

CREATE TABLE ad_collection_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publisher_id INTEGER REFERENCES publishers(id) ON DELETE CASCADE,
  developer_domain TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','partial','failed','disabled')),
  last_collected_at TEXT,
  next_collect_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (publisher_id IS NOT NULL OR developer_domain IS NOT NULL)
);
CREATE UNIQUE INDEX ad_collection_targets_publisher_unique
  ON ad_collection_targets(publisher_id) WHERE publisher_id IS NOT NULL;
CREATE UNIQUE INDEX ad_collection_targets_domain_unique
  ON ad_collection_targets(developer_domain) WHERE publisher_id IS NULL AND developer_domain IS NOT NULL;
CREATE INDEX ad_collection_targets_due_idx ON ad_collection_targets(status, next_collect_at, last_collected_at);

CREATE TABLE ad_collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER NOT NULL REFERENCES ad_collection_targets(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('meta','google','tiktok')),
  reason TEXT NOT NULL CHECK (reason IN ('discovery','tracked','viewed','manual','backfill')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','partial','failed','skipped')),
  result_count INTEGER NOT NULL DEFAULT 0,
  new_ad_count INTEGER NOT NULL DEFAULT 0,
  linked_app_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  raw_r2_key TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ad_collection_runs_target_source_idx ON ad_collection_runs(target_id, source, started_at DESC);

CREATE TABLE ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  advertiser_id INTEGER REFERENCES ad_advertisers(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('meta','google','tiktok')),
  source_ad_id TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('active','inactive','removed','unknown')),
  headline TEXT,
  body TEXT,
  call_to_action TEXT,
  landing_url TEXT,
  platforms TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  ended_at TEXT,
  impressions_min INTEGER,
  impressions_max INTEGER,
  reach_min INTEGER,
  reach_max INTEGER,
  spend_min REAL,
  spend_max REAL,
  currency TEXT,
  first_collected_at TEXT NOT NULL,
  last_collected_at TEXT NOT NULL,
  raw_r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, source_ad_id)
);
CREATE INDEX ads_advertiser_idx ON ads(advertiser_id, last_collected_at DESC);
CREATE INDEX ads_source_status_idx ON ads(source, status, last_collected_at DESC);
CREATE INDEX ads_dates_idx ON ads(started_at, ended_at);

CREATE TABLE ad_creative_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  source_variant_id TEXT,
  format TEXT NOT NULL DEFAULT 'unknown' CHECK (format IN ('image','video','carousel','text','unknown')),
  headline TEXT,
  body TEXT,
  call_to_action TEXT,
  landing_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ad_creative_variants_source_unique
  ON ad_creative_variants(ad_id, source_variant_id) WHERE source_variant_id IS NOT NULL;
CREATE INDEX ad_creative_variants_ad_idx ON ad_creative_variants(ad_id, position);

CREATE TABLE ad_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image','video','thumbnail')),
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0 AND byte_size <= 262144000),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  original_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ad_assets_media_type_idx ON ad_assets(media_type, created_at DESC);

CREATE TABLE ad_creative_assets (
  variant_id INTEGER NOT NULL REFERENCES ad_creative_variants(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES ad_assets(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','thumbnail','carousel')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (variant_id, asset_id, role)
);
CREATE INDEX ad_creative_assets_variant_idx ON ad_creative_assets(variant_id, position);

CREATE TABLE ad_regions (
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL REFERENCES countries(code),
  created_at TEXT NOT NULL,
  PRIMARY KEY (ad_id, country_code)
);
CREATE INDEX ad_regions_country_idx ON ad_regions(country_code, ad_id);

CREATE TABLE ad_app_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  app_id INTEGER REFERENCES apps(id) ON DELETE CASCADE,
  candidate_name TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('certain','strong','candidate')),
  match_reason TEXT NOT NULL CHECK (match_reason IN ('store_id','developer_domain','advertiser_alias','name_only')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (app_id IS NOT NULL OR candidate_name IS NOT NULL)
);
CREATE UNIQUE INDEX ad_app_links_app_unique ON ad_app_links(ad_id, app_id) WHERE app_id IS NOT NULL;
CREATE INDEX ad_app_links_app_idx ON ad_app_links(app_id, confidence, ad_id);

CREATE TABLE ad_advertiser_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  advertiser_id INTEGER NOT NULL REFERENCES ad_advertisers(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(advertiser_id, normalized_alias)
);
CREATE INDEX ad_advertiser_aliases_lookup_idx ON ad_advertiser_aliases(normalized_alias, is_verified);
