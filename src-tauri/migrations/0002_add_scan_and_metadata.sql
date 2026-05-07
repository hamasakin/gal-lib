-- 0002_add_scan_and_metadata.sql
-- gal-lib schema v2 — Phase 2 lockup
-- Adds scan_roots table + 4 metadata columns to games + bumps schema_version to 2

CREATE TABLE scan_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  depth INTEGER NOT NULL DEFAULT 1 CHECK(depth IN (1, 2, 3)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE games ADD COLUMN cover_url TEXT;
ALTER TABLE games ADD COLUMN metadata_source TEXT;
ALTER TABLE games ADD COLUMN match_confidence INTEGER;
ALTER TABLE games ADD COLUMN last_scanned_at TEXT;

UPDATE app_meta SET value = '2' WHERE key = 'schema_version';
