-- The chart tuple uniqueness indexes already cover chart entry access. The
-- legacy audit removed the standalone app lookup index because it amplified
-- every daily chart write without serving the chart-first query patterns.
DROP INDEX IF EXISTS trending_chart_entries_app_idx;
