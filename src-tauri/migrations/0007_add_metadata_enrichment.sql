-- 0007_add_metadata_enrichment.sql
-- gal-lib schema v7 — Phase 11 lockup
-- Adds metadata-enrichment infrastructure:
--   1. games.summary column for Bangumi/VNDB synopsis text
--   2. persons table — independent person registry across both sources
--   3. game_staff table — N:M between games and persons with role enum
--      ('scenario' | 'artist' | 'voice' | 'music') + character_name (voice only)
--   4. game_official_tags table — Bangumi/VNDB official tag list per game,
--      separate from user-built tags/game_tags
-- Bumps schema_version to 7.

ALTER TABLE games ADD COLUMN summary TEXT;

CREATE TABLE persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_cn TEXT,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  UNIQUE(source, source_id)
);

CREATE TABLE game_staff (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('scenario','artist','voice','music')),
  character_name TEXT,
  PRIMARY KEY (game_id, person_id, role, COALESCE(character_name, ''))
);
CREATE INDEX idx_game_staff_game ON game_staff(game_id);
CREATE INDEX idx_game_staff_person_role ON game_staff(person_id, role);

CREATE TABLE game_official_tags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  source TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, tag_name, source)
);
CREATE INDEX idx_official_tags_game ON game_official_tags(game_id);
CREATE INDEX idx_official_tags_name ON game_official_tags(tag_name);

UPDATE app_meta SET value = '7' WHERE key = 'schema_version';
