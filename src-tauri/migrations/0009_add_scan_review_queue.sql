-- 0009_add_scan_review_queue.sql
-- gal-lib schema v9 — Phase 12 (Scan Pipeline & Review Queue)
--
-- One new table `scan_review_queue` for low-confidence ingest matches that
-- the user should manually review. Populated by `apply_ingest_result` when
-- `metadata_source = 'none'` OR `match_confidence < 80`. Cleared by
-- `accept_review_candidate` / `dismiss_review_item` / `bind_metadata`.
--
-- Bumps schema_version to 9.

CREATE TABLE scan_review_queue (
  game_id            INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  game_path          TEXT    NOT NULL,
  current_confidence INTEGER NOT NULL DEFAULT 0,
  suggested_source   TEXT,    -- 'bangumi' | 'vndb' | NULL (NULL = no match found)
  suggested_id       TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_scan_review_queue_created ON scan_review_queue(created_at DESC);

UPDATE app_meta SET value = '9' WHERE key = 'schema_version';
