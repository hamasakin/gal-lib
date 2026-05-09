-- 0008_add_age_rating_and_custom_views.sql
-- gal-lib schema v8 — Quick task 20260510b
-- Two adjacent features bundled in one migration:
--   1. games.age_rating column (R18 / 全年龄 / NULL=unknown)
--   2. custom_views + custom_view_games tables (user-curated game lists)
-- Bumps schema_version to 8.

ALTER TABLE games ADD COLUMN age_rating TEXT
  CHECK(age_rating IS NULL OR age_rating IN ('all_ages','r18'));

CREATE TABLE custom_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE custom_view_games (
  view_id INTEGER NOT NULL REFERENCES custom_views(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (view_id, game_id)
);
CREATE INDEX idx_custom_view_games_game ON custom_view_games(game_id);

UPDATE app_meta SET value = '8' WHERE key = 'schema_version';
