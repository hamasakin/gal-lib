-- 0005_add_screenshots_and_saves.sql
-- gal-lib schema v5 — Phase 5 lockup (stats-media)
-- Adds 2 columns to games (screenshot_interval_sec + save_path),
-- 2 new tables (screenshots + save_backups) with FK ON DELETE CASCADE,
-- 2 indexes (idx_screenshots_game_id + idx_save_backups_game_id),
-- + bumps schema_version to 5.
--
-- SQLite ALTER TABLE supports only ADD COLUMN (no DROP / RENAME COLUMN before
-- 3.25 / 3.35); all changes here are additive and preserve existing rows.

ALTER TABLE games ADD COLUMN screenshot_interval_sec INTEGER NOT NULL DEFAULT 300;
ALTER TABLE games ADD COLUMN save_path TEXT;

CREATE TABLE screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_screenshots_game_id ON screenshots(game_id);

CREATE TABLE save_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  backup_dir TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  total_size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);
CREATE INDEX idx_save_backups_game_id ON save_backups(game_id);

UPDATE app_meta SET value = '5' WHERE key = 'schema_version';
