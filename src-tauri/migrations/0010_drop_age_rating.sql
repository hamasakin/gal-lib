-- 0010_drop_age_rating.sql
-- gal-lib schema v10 — Quick 260513-404
-- Drops games.age_rating column added by 0008 (R18 分类整体删除)
-- 关联代码改动: types.rs / bangumi.rs / vndb.rs / ingest.rs / commands.rs / lib.rs 全栈清理
-- 不动 custom_views / custom_view_games 表（继续保留）
-- sqlx 0.8 bundles SQLite >= 3.42 — ALTER TABLE ... DROP COLUMN (3.35+) is native.
-- Bumps schema_version to 10.

ALTER TABLE games DROP COLUMN age_rating;

UPDATE app_meta SET value = '10' WHERE key = 'schema_version';
