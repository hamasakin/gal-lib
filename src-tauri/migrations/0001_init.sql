-- 0001_init.sql
-- gal-lib schema v1
-- Source: planner_scope verbatim; aligns with CONTEXT.md decisions and APP-02

PRAGMA foreign_keys = ON;

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_cn TEXT,
  executable_path TEXT,
  cover_path TEXT,
  bangumi_id TEXT,
  vndb_id TEXT,
  total_playtime_sec INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  status TEXT NOT NULL DEFAULT 'unplayed' CHECK(status IN ('unplayed','playing','cleared','dropped')),
  rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 0 AND 10)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_game_id ON sessions(game_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE game_tags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, tag_id)
);
CREATE INDEX idx_game_tags_tag_id ON game_tags(tag_id);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO app_meta (key, value) VALUES ('schema_version', '1');
