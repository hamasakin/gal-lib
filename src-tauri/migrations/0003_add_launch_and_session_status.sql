-- 0003_add_launch_and_session_status.sql
-- gal-lib schema v3 — Phase 3 lockup
-- Adds 3 launch-config columns to games + 2 session-status columns to sessions
-- + bumps schema_version to 3.
--
-- SQLite ALTER TABLE supports only ADD COLUMN (no DROP / RENAME COLUMN before
-- 3.25 / 3.35); all changes here are additive and preserve existing rows.

ALTER TABLE games ADD COLUMN le_profile TEXT NOT NULL DEFAULT 'Japanese';
ALTER TABLE games ADD COLUMN launch_args TEXT;
ALTER TABLE games ADD COLUMN cwd TEXT;

ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('starting','running','completed','launch_failed','cancelled'));
ALTER TABLE sessions ADD COLUMN exit_code INTEGER;

UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
