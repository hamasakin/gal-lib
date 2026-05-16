-- 0012_add_scan_skip_dirs.sql
-- gal-lib schema v12 — Quick 260516-q3y (整理子目录 / subdir split)
--
-- One new table `scan_skip_dirs` — persistent list of directory paths the
-- full scan must skip. Populated by `split_game_into_subdirs`: when a brand-
-- name parent directory (mis-scanned as a single game) is split into N
-- per-game subdir entries, the original parent path is written here so a
-- later full scan never re-discovers it as a game and re-creates a duplicate.
--
-- Differs from the in-memory `ScanState.skip` set used by `mark_skip_dir`,
-- which is lost on process restart. This table survives restarts; `start_scan`
-- UNIONs its rows into the `existing_paths` skip set.
--
-- Bumps schema_version to 12.

CREATE TABLE scan_skip_dirs (
  path       TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE app_meta SET value = '12' WHERE key = 'schema_version';
