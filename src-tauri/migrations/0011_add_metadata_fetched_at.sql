-- 0011_add_metadata_fetched_at.sql
-- gal-lib schema v11 — Quick 260515-loading-phase-sort
--
-- 加 games.metadata_fetched_at 列，专门作为「元数据最近一次获取的时间」排序锚点。
-- 原 last_scanned_at 实际只被元数据获取路径写，但语义上是「最后扫描时间」——
-- 这里另起一根字段让前端按它排序、后端在每次元数据写入时同步更新，未来即使
-- 引入只更新 last_scanned_at 的非元数据扫描也不会污染排序键。
--
-- 写入时机：
--   - apply_ingest_result（start_scan / add_game enrich）
--   - bind_metadata（手动绑定）
--   - refresh_metadata（单条刷新）
--   - refresh_metadata_smart（批量刷新，bound + unbound 两条路径）
--
-- Bumps schema_version to 11.

ALTER TABLE games ADD COLUMN metadata_fetched_at TEXT;

-- 历史数据回填：把 last_scanned_at 作为初始值复制过来，老库重启时
-- 排序立刻有意义（否则全部 NULL 全沉底，初始视觉很乱）。
UPDATE games SET metadata_fetched_at = last_scanned_at
WHERE last_scanned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_games_metadata_fetched_at
ON games(metadata_fetched_at DESC);

UPDATE app_meta SET value = '11' WHERE key = 'schema_version';
