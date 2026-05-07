-- 0004_add_brand_year_favorite.sql
-- gal-lib schema v4 — Phase 4 lockup
-- Adds 3 metadata/state columns to games (brand, release_year, is_favorite)
-- + bumps schema_version to 4.
--
-- SQLite ALTER TABLE supports only ADD COLUMN (no DROP / RENAME COLUMN before
-- 3.25 / 3.35); all changes here are additive and preserve existing rows.

ALTER TABLE games ADD COLUMN brand TEXT;
ALTER TABLE games ADD COLUMN release_year INTEGER;
ALTER TABLE games ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
