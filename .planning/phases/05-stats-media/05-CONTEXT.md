# Phase 5: Stats & Media - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Mode:** Auto-generated via `/gsd-discuss-phase 5 --auto`

<domain>
## Phase Boundary

用户能查看游玩时间统计图表，从详情页管理截图，以及对任意游戏的存档进行备份和恢复。

**包含：**
- 统计页（新路由 `/stats`）：每日/每周/每月游玩时长趋势图 + Top N 游戏时长分布
- 截图功能：游戏运行期间通过定时机制（每 N 分钟）拍主屏截图到 `data/screenshots/<game_id>/`；详情页查看 / 导出 / 删除
- 存档备份：为每款游戏配置存档目录路径；手动触发备份（带时间戳到 `data/saves/<game_id>/<timestamp>/`）；查看历史 + 恢复

**不包含：**
- 全局 PrintScreen 监听（替代为定时机制；技术上 PrintScreen 系统级监听需要 hooks，复杂；定时 + 用户可配置间隔即够用）
- 视频录制（Out of Scope）
- 云同步存档（Out of Scope v1）
- 截图自动剔除非游戏窗口（截全屏；用户自己处理）
- 存档差异比较（diff）（Out of Scope）
- 跨游戏存档迁移（Out of Scope）

**REQ-IDs：** STATS-01, STATS-02, SHOT-01, SHOT-02, SAVE-01, SAVE-02, SAVE-03（共 7 项）

</domain>

<decisions>
## Implementation Decisions

### Stats Page (STATS-01, STATS-02)
- **路由：** `/stats` 新路由；侧栏底部 "统计" nav（Settings 上方）
- **图表库：** `recharts`（React-friendly, 体积约 100KB gzipped；优于 chart.js 因为我们要 React 组件式）
- **数据查询：** 后端 `get_playtime_trend(period: "daily"|"weekly"|"monthly", limit: i32)` 用 sqlx GROUP BY date(started_at, ...) 聚合 + `get_top_games(limit: i32)` ORDER BY total_playtime_sec DESC LIMIT
- **趋势图类型：** AreaChart（per recharts），X 轴日期，Y 轴时长（小时）
- **Top N 类型：** BarChart 横向，每条 = 1 game name + 时长
- **空数据：** 友好显示 "还没有游玩记录 — 启动游戏开始记录"

### Screenshot Capture (SHOT-01, SHOT-02)
- **机制：** 定时（默认每 5 分钟）拍主屏截图，保存到 `data/screenshots/<game_id>/<timestamp>.png`
- **配置：** 全局 + 每游戏覆盖（games 表 ALTER：`screenshot_interval_sec INTEGER DEFAULT 300`，0 = 关闭）
- **触发：** 游戏 active session 期间，orchestrator 启动一个 tokio interval task，每 N 秒调 screenshot crate
- **Rust crate：** `screenshots = "0.8"` (跨平台屏幕截图；Win32 GDI)
- **存储：** PNG 格式，`png` crate；文件名 `<unix_timestamp_seconds>.png`
- **DB schema v5 ALTER：**
  ```sql
  ALTER TABLE games ADD COLUMN screenshot_interval_sec INTEGER NOT NULL DEFAULT 300;
  CREATE TABLE screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_screenshots_game_id ON screenshots(game_id);
  ```
- **详情页查看：** 新 Tab "截图"；网格缩略图（150×150 cover-fit）；click → 大图 modal（lightbox）；导出 → 文件 dialog 选目标路径；删除 → confirm + DB row + file
- **lightbox：** 简单 Dialog（无 carousel 翻页 in v1）；P5 简化

### Save Backup (SAVE-01, SAVE-02, SAVE-03)
- **配置存档目录：** `games.save_path TEXT`（v5 ALTER）；用户在 Detail 设置 Tab 配置（Tauri dialog directory picker）
- **备份操作：**
  - 触发：详情页"备份存档"按钮 → confirm → 后端 copy save_path 到 `data/saves/<game_id>/<unix_timestamp>/`（递归 copy；保留目录结构）
  - 用 `walkdir` (已装) + `std::fs::copy` 递归
  - 完成后 toast "已备份存档 — {N} 文件 / {size}"
- **DB schema v5 ALTER：**
  ```sql
  ALTER TABLE games ADD COLUMN save_path TEXT;
  CREATE TABLE save_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    backup_dir TEXT NOT NULL,    -- relative to data/saves/
    file_count INTEGER NOT NULL,
    total_size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT
  );
  CREATE INDEX idx_save_backups_game_id ON save_backups(game_id);
  ```
- **恢复：** 详情页"存档历史"列表（新 Tab "存档"）；每条 confirm → 把备份目录递归 copy 回 save_path（覆盖；warn 用户）
- **删除备份：** 同 confirm → DELETE row + 递归删目录

### Schema v5 Migration
```sql
-- migration 0005_add_screenshots_and_saves.sql
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

### Claude's Discretion
- 截图缩略图缓存策略：P5 不预生成；浏览器/webview 自动缩放；Phase 6+ 优化
- recharts 主题：用 UI-SPEC 的 #7C5CFF accent；坐标轴 #2A2F3A border；网格线虚线
- 存档备份压缩 vs 不压缩：不压缩（简单优先；P6+ 可加 zip 压缩）
- 删除备份是软删除（DB row 标记）vs 硬删除：硬删除（简单）
- 截图间隔的下限：60 秒（避免每秒截图填满磁盘）

</decisions>

<code_context>
## Existing Code Insights

### Reusable from P1-P4
- 全部 backend (data_dir / db / scan / metadata / launch / commands / tray)
- 全部 frontend (lib/* / store/* / components/* / routes/*)
- shadcn 17 个 blocks
- DB schema v4

### Established Patterns
- 同 P1-P4 patterns

### Integration Points
- 新 Rust crate: `screenshots = "0.8"`, `png = "0.17"` (image crate 已装但显式 png 更快)
- 新 npm: `recharts ^2.x`
- 新 Tauri commands: get_playtime_trend / get_top_games / get_screenshots / delete_screenshot / export_screenshot / set_save_path / list_save_backups / create_save_backup / restore_save_backup / delete_save_backup / set_screenshot_interval / get_screenshot_settings
- 新组件: routes/Stats.tsx + components/library/ScreenshotsTab.tsx + components/library/SavesTab.tsx
- 新 Detail tabs: 简介/标签/笔记/会话历史/截图/存档/设置（7 tabs，复杂度增加；考虑 5 tabs + 子 tabs）

</code_context>

<specifics>
## Specific Ideas

- Stats 页布局：顶部 period select (daily/weekly/monthly) + 主区上 trendChart + 下 topGamesBar
- 截图 Tab 缩略图网格：3 列 grid + click 大图 modal
- 存档 Tab 列表：每行 timestamp + file_count + size + Restore + Delete buttons
- recharts AreaChart 用 stroke=accent fill=accent/30
- 截图自动捕获在 active session 启动时通过 tokio::time::interval 启动 task；session 结束时 abort
- screenshots crate API：`Screen::all()?` 取 monitors，对每个 `screen.capture()?` 拿 RgbaImage，存为 png

</specifics>

<deferred>
## Deferred Ideas

- 视频录制（Out of Scope）
- 云同步存档（Out of Scope v1）
- 截图自动剔除非游戏窗口（Out of Scope）
- 存档差异比较（Out of Scope）
- 截图缩略图缓存（Phase 6+）
- 截图标记 / 标注（Out of Scope）
- 时长统计跨年度对比图（Phase 6）
- 自动清理超过 N 天的截图（Out of Scope v1）

</deferred>
