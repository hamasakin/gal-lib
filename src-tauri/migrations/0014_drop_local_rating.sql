-- 0014_drop_local_rating.sql
-- Quick 260526-0bi — 移除本地用户评分字段
--
-- Drops games.rating column (本地用户打分，0001_init 起的 INTEGER 0..=10)。
-- v13 引入的 external_rating 现在是评分唯一字段；StarRating 组件 + update_game_rating IPC
-- 已在前端 + 后端一并移除。
--
-- 行为：
--   * ALTER TABLE games DROP COLUMN rating —— 无损丢弃旧用户打分数据
--     (符合需求：用户决策放弃本地打分维度)
--   * 索引 idx_games_rating 不存在 (0001 未建)，无需 DROP INDEX
--   * schema_version 升到 14
--
-- sqlx 0.8 bundles SQLite >= 3.42 → 原生 DROP COLUMN 可用 (参 0010 同款手法)

ALTER TABLE games DROP COLUMN rating;

UPDATE app_meta SET value = '14' WHERE key = 'schema_version';
