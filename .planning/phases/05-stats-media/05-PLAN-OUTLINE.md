# Phase 5 Plan Outline

**Phase:** 05-stats-media
**Goal:** 用户能查看游玩时间统计图表，从详情页管理截图，以及对任意游戏的存档进行备份和恢复
**Phase req IDs:** STATS-01, STATS-02, SHOT-01, SHOT-02, SAVE-01, SAVE-02, SAVE-03 (7 IDs)

Plans are SERIAL.

| Plan | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 05a | Schema v5 + Rust crates (screenshots, png) + recharts npm | 1 | [] | (foundation) |
| 05b | Backend: stats queries + screenshot capture (tokio interval task in launch::orchestrator) + save backup commands | 2 | [05a] | STATS-01, STATS-02, SHOT-01, SAVE-01, SAVE-02, SAVE-03 |
| 05c | Frontend invoke layer (stats.ts, screenshots.ts, saves.ts) + library store extensions | 3 | [05a, 05b] | STATS-01, SHOT-02, SAVE-03 |
| 05d | Stats page (/stats route) — period select + AreaChart trend + BarChart top games | 4 | [05a, 05c] | STATS-01, STATS-02 |
| 05e | Detail page extensions — 截图 tab + 存档 tab; Sidebar 统计 nav | 5 | [05a, 05c] | SHOT-02, SAVE-01, SAVE-03 |

5 plans (Phase 5 is smaller than P2/P3/P4).

## Coverage Map

| REQ-ID | Plan |
|---|---|
| STATS-01 | 05b (cmd) + 05d (chart) |
| STATS-02 | 05b (cmd) + 05d (chart) |
| SHOT-01 | 05b (capture in orchestrator interval task) |
| SHOT-02 | 05c (invoke) + 05e (Detail Tab UI) |
| SAVE-01 | 05c (invoke) + 05e (Detail Settings save_path field) |
| SAVE-02 | 05b (create_save_backup cmd) + 05e (Detail Tab UI) |
| SAVE-03 | 05b (list/restore/delete) + 05e (Detail Tab UI) |

All 7 IDs covered.

## Schema v5 Diff

```sql
ALTER TABLE games ADD COLUMN screenshot_interval_sec INTEGER NOT NULL DEFAULT 300;
ALTER TABLE games ADD COLUMN save_path TEXT;

CREATE TABLE screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_screenshots_game_id ON screenshots(game_id);

CREATE TABLE save_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  backup_dir TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  total_size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);
CREATE INDEX idx_save_backups_game_id ON save_backups(game_id);

UPDATE app_meta SET value = '5' WHERE key = 'schema_version';
```

## OUTLINE COMPLETE
Plans: 05a, 05b, 05c, 05d, 05e
