-- Focus chart and storefront synchronization on 30 monetization-priority markets.
-- China is intentionally iOS-only because Google Play is not the primary
-- Android distribution channel there.
UPDATE countries
SET
  is_active_ios = CASE
    WHEN code IN (
      'us', 'jp', 'cn', 'kr', 'gb', 'de', 'tw', 'ca', 'au', 'fr',
      'br', 'sa', 'it', 'th', 'hk', 'es', 'nl', 'tr', 'ch', 'mx',
      'pt', 'ae', 'za', 'ng', 'eg', 'ma', 'dz', 'ke', 'cd', 'gh'
    ) THEN 1 ELSE 0
  END,
  is_active_android = CASE
    WHEN code IN (
      'us', 'jp', 'kr', 'gb', 'de', 'tw', 'ca', 'au', 'fr', 'br',
      'sa', 'it', 'th', 'hk', 'es', 'nl', 'tr', 'ch', 'mx', 'pt',
      'ae', 'za', 'ng', 'eg', 'ma', 'dz', 'ke', 'cd', 'gh'
    ) THEN 1 ELSE 0
  END,
  priority = CASE code
    WHEN 'us' THEN 300
    WHEN 'jp' THEN 290
    WHEN 'cn' THEN 280
    WHEN 'kr' THEN 270
    WHEN 'gb' THEN 260
    WHEN 'de' THEN 250
    WHEN 'tw' THEN 240
    WHEN 'ca' THEN 230
    WHEN 'au' THEN 220
    WHEN 'fr' THEN 210
    WHEN 'br' THEN 200
    WHEN 'sa' THEN 190
    WHEN 'it' THEN 180
    WHEN 'th' THEN 170
    WHEN 'hk' THEN 160
    WHEN 'es' THEN 150
    WHEN 'nl' THEN 140
    WHEN 'tr' THEN 130
    WHEN 'ch' THEN 120
    WHEN 'mx' THEN 110
    WHEN 'pt' THEN 100
    WHEN 'ae' THEN 90
    WHEN 'za' THEN 80
    WHEN 'ng' THEN 70
    WHEN 'eg' THEN 60
    WHEN 'ma' THEN 50
    WHEN 'dz' THEN 40
    WHEN 'ke' THEN 30
    WHEN 'cd' THEN 20
    WHEN 'gh' THEN 10
    ELSE 0
  END,
  updated_at = '2026-08-04T00:00:00.000Z';
