-- Storefront tasks are delivered at least once. A field or locale transition
-- is therefore identified by the app/version/locale/field tuple.
DELETE FROM app_store_listing_changes
WHERE id NOT IN (
  SELECT MIN(id) FROM app_store_listing_changes
  GROUP BY app_id, version_id, locale, field_changed
);

CREATE UNIQUE INDEX IF NOT EXISTS listing_changes_transition_unique
  ON app_store_listing_changes(app_id, version_id, locale, field_changed);
