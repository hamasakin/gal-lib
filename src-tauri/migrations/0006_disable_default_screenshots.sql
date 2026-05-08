-- 0006 — disable auto-screenshot for all games by default.
--
-- Context: schema-v5 (0005) introduced `games.screenshot_interval_sec` with a
-- DEFAULT of 300 (5-minute auto-capture during gameplay). User feedback:
-- captures end up showing whatever was on the desktop (alt-tabbed apps,
-- empty wallpaper) far more often than the actual game. Switch the default
-- to "off" — auto-capture is now opt-in per game via the Detail page's
-- 设置 tab → 截图间隔 select. Manual capture moves to a global hotkey
-- handled in the next migration's companion code.
--
-- We can't ALTER COLUMN ... SET DEFAULT in SQLite without recreating the
-- table, so this migration only resets existing rows. New INSERTs in
-- `ingest_one_dir` (commands.rs) explicitly bind `screenshot_interval_sec`
-- to 0 so the column default never matters in practice.

UPDATE games SET screenshot_interval_sec = 0;

UPDATE app_meta SET value = '6' WHERE key = 'schema_version';
