-- Keep the focused market set at 30 countries while adding India.
UPDATE countries
SET is_active_ios = 0, is_active_android = 0, priority = 0,
    updated_at = '2026-08-04T00:00:00.000Z'
WHERE code = 'gh';

UPDATE countries
SET is_active_ios = 1, is_active_android = 1, priority = 10,
    updated_at = '2026-08-04T00:00:00.000Z'
WHERE code = 'in';
