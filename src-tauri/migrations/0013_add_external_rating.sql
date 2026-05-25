-- 0013_add_external_rating.sql
-- gal-lib schema v13 — Quick 260525-g1m (官方评分入库 + 排序方向切换)
--
-- 新增 3 列存储官方评分：来自 Bangumi `rating.score` (0..=10 float, 1 位小数)
-- 或 VNDB `rating` (0..=100 float → 归一化 /10 写入)。与本地 `games.rating`
-- (StarRating 用户打分，1..=10 整数) 完全分离 —— 后者走前端星标交互不动。
--
--   * `external_rating`         REAL  nullable  — 0..=10 浮点 (官方评分)
--   * `external_rating_count`   INT   nullable  — 参与打分人数 (Bangumi total / VNDB votecount)
--   * `external_rating_source`  TEXT  nullable  — 'bangumi' | 'vndb'
--
-- 「评分」排序键从本任务起切到 external_rating DESC NULL LAST。索引 idx_games_external_rating
-- 服务这条排序路径（games 表行数级别，DESC 索引避免 ORDER BY 排序步骤）。
--
-- ⚠️ 不做 backfill —— 旧库迁移后 external_rating 全为 NULL；用户需要去 Settings
-- 点「刷新元数据」(refresh_metadata_smart) 自然回填。这是预期行为：迁移期间
-- 不重抓外部 API，避免启动卡顿；reseed 路径写入即覆盖。
--
-- Bumps schema_version to 13.

ALTER TABLE games ADD COLUMN external_rating REAL;
ALTER TABLE games ADD COLUMN external_rating_count INTEGER;
ALTER TABLE games ADD COLUMN external_rating_source TEXT;

CREATE INDEX IF NOT EXISTS idx_games_external_rating ON games(external_rating DESC);

UPDATE app_meta SET value = '13' WHERE key = 'schema_version';
