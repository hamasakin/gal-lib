---
quick_id: 260526-0bi
description: 移除本地用户评分字段 games.rating，只保留官方评分 external_rating
date: 2026-05-26
mode: quick
status: complete
commits:
  - 007daf4 — feat(quick-260526-0bi): 前端移除本地评分 — StarRating/Game.rating/updateGameRating 与 i18n key 三语同步
  - bd35859 — feat(quick-260526-0bi): 后端移除本地评分 — Game struct/SELECT 4 处/update_game_rating IPC 全部删除
  - 2b4b8e2 — feat(quick-260526-0bi): schema v14 DROP COLUMN games.rating + db.rs 注册（v13 翻版预防）
files_modified:
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/db.rs
  - src-tauri/migrations/0014_drop_local_rating.sql (new)
  - src/lib/games.ts
  - src/routes/Detail.tsx
  - src/lib/advancedFilter.ts
  - src/components/library/SubdirSplitDialog.tsx
  - src/components/library/StarRating.tsx (deleted)
  - src/components/library/GameList.tsx (comment refresh)
  - src/locales/zh-CN/translation.json
  - src/locales/ja-JP/translation.json
  - src/locales/en-US/translation.json
verification:
  cargo_check: pass
  cargo_test_lib: 87 passed, 1 failed (pre-existing http_safe::rejects_ip_literals — unrelated)
  cargo_test_migrations_v14: pass
  tsc_noemit: pass
  pnpm_build: pass (vite built in 3.38s, 1987 modules)
---

# Quick Task 260526-0bi: 移除本地用户评分字段，只保留官方评分

## 背景

`games.rating` (INTEGER 0..=10, NULL) 本地用户打分字段从 v1 schema 起一直存在，
由 `StarRating` 组件维护。v13 migration (Quick 260525-g1m) 引入了 `external_rating`
(REAL 0..=10) 官方评分。用户决策放弃本地打分一套，只保留官方评分。

## 执行结果

按计划「先解前后端引用，再 DROP COLUMN」顺序执行 3 个 atomic commit + 1 个验证步骤；
v13 翻版（migration 漏注册）通过 db.rs 三处定向追加 + grep 三组自验 + cargo test 三道防线预防。

### Task 1 — 前端去 rating 引用 → commit `007daf4`

- **删除文件**：`src/components/library/StarRating.tsx` 整个组件
- `src/routes/Detail.tsx`：移除 StarRating import / `onSetRating` handler / `updateGameRating` import / 信息栏「评分」DT-DD 整行 / 「常用操作」区 StarRating 组件用法
- `src/lib/games.ts`：删除 `Game.rating: number | null` 字段 + `updateGameRating(...)` 函数 + 注释 `external_rating` 更新
- `src/lib/advancedFilter.ts`：`ratingMin/ratingMax` 切到读 `g.external_rating`（UI 字段名保留）；注释更新
- `src/components/library/SubdirSplitDialog.tsx`：`gameHasUserData` 中 `g.rating != null` 一行删除
- `src/components/library/GameList.tsx`：评分列注释顺手刷新到 260526-0bi（不影响代码行为）
- `src/locales/{zh-CN,ja-JP,en-US}/translation.json`：三语同步删除 `detail.info.rating` + `toast.rating_failed` 两个 key（保留 `settings.sort.rating` / `filter_panel.section.rating` / `detail.info.external_rating`，语义切到官方评分）

**Verify**：
- `pnpm exec tsc --noEmit` EXIT=0
- `rg "game\.rating\b|game\.rating\)" src/` → 0 hit ✓
- `rg "updateGameRating|StarRating" src/` → 0 hit ✓

### Task 2 — 后端去 rating 引用 + Game struct + IPC → commit `bd35859`

- `src-tauri/src/commands.rs`：
  - `Game` struct: `pub rating: Option<i64>` 删除
  - `row_to_game`: `rating: row.try_get("rating").ok()` 删除
  - 4 处 SELECT 子句去 `rating,` / `g.rating,` 列：
    - `list_games` (~2111)
    - `get_game` (~2142)
    - `search_games` (~2778)
    - `list_games_for_person` (~4057)
  - `update_game_rating` IPC 函数整体删除（约 21 行）
- `src-tauri/src/lib.rs`：`tauri::generate_handler![...]` 列表中 `commands::update_game_rating,` 一行删除

**Verify**：
- `cargo check` 通过（仅 6 项 pre-existing dead_code warnings）
- `rg "rating: row|pub rating:|update_game_rating|UPDATE games SET rating" src-tauri/src/` → 1 hit on `metadata/types.rs:103: pub rating: Option<f64>`（这是 MetadataDetail DTO，来自 Bangumi/VNDB API 响应的源端 rating 字段，归一化后会被映射到 `external_rating`——与本地用户评分无关，保留正确）
- `rg "^\s*rating,|\srating,\s" src-tauri/src/commands.rs` → 0 hit ✓
- 旧库（v13 schema）仍有 rating 列但不被任何 SELECT/UPDATE 触碰，运行时兼容

### Task 3 — v14 migration + db.rs 三处定向追加 → commit `2b4b8e2`

- 新增 `src-tauri/migrations/0014_drop_local_rating.sql`：
  ```sql
  ALTER TABLE games DROP COLUMN rating;
  UPDATE app_meta SET value = '14' WHERE key = 'schema_version';
  ```
  （参 v10 同款 SQLite >= 3.42 原生 DROP COLUMN 手法）
- `src-tauri/src/db.rs` **三处定向追加**（v13 漏注册事故的根本预防）：
  - **位置 A** module-doc 末段：补 Schema v14 文档段（2 行）
  - **位置 B** const 块 V13_SQL 之后：`const V14_SQL: &str = include_str!("../migrations/0014_drop_local_rating.sql");`
  - **位置 C** `migrations()` vec v13 entry 之后：`Migration { version: 14, description: "drop_local_rating", sql: V14_SQL, kind: MigrationKind::Up }`
  - **位置 D** tests 模块末段：新增 `migrations_v14_drops_local_rating` 测试（参 v10 模板）

**Verify（v13 翻版预防三道防线）**：
- `cargo check` 通过
- `cargo test --lib migrations_v14` → 1 passed; 0 failed
- 三组 grep 自验：
  - `rg "version: 14" src-tauri/src/db.rs` → 1 行 (vec entry) ✓
  - `rg "V14_SQL" src-tauri/src/db.rs` → 2 行 (const 定义 + sql: 引用) ✓
  - `rg "0014_drop_local_rating\.sql" src-tauri/src/db.rs` → 1 行 (include_str!) ✓

### Task 4 — 全套构建验证（无 commit）

- `cargo check` 通过（仅 pre-existing dead_code warnings：`OrchError` / `MetadataError::RateLimited` / `ScanOutcome.removed_dirs` 等 6 项）
- `cargo test --lib` → 87 passed; **1 failed**：`http_safe::tests::rejects_ip_literals`
  - **预存在失败**，与本任务无关。STATE.md 第 111 行（Quick 260525-g1m 完成时）已记录："http_safe::rejects_ip_literals 1 项 pre-existing 失败与本任务无关"。本次不修。
  - 新增 `migrations_v14_drops_local_rating` 测试在 87 passed 内 ✓
- `pnpm exec tsc --noEmit` EXIT=0
- `pnpm build` 通过：vite v7.3.3, 1987 modules transformed, built in 3.38s

## 自验清单（grep）— 全部命中预期数

```
rg "pub rating:|rating: row\.try_get\(.rating.\)|update_game_rating" src-tauri/src/
  → metadata/types.rs:103 (MetadataDetail DTO — 与本地评分无关，保留正确)

rg "Game\.rating|game\.rating\b|game\.rating\)|updateGameRating|StarRating" src/
  → 0 hit ✓

rg "UPDATE games SET rating = " src-tauri/
  → 0 hit ✓

rg "version: 14" src-tauri/src/db.rs
  → 1 行 (Migration vec entry) ✓

rg "V14_SQL" src-tauri/src/db.rs
  → 2 行 (const + sql: 引用) ✓

rg "0014_drop_local_rating\.sql" src-tauri/src/db.rs
  → 1 行 (include_str!) ✓

rg "external_rating" src-tauri/src/commands.rs
  → 47 行 (远超计划 ≥12 行最低线) ✓

rg "external_rating" src/lib/games.ts
  → 4 行 (≥ 计划 3 行最低线) ✓
```

## Deviations from Plan

### 1. [Rule 1 - Stale comment] GameList.tsx 评分列注释顺手刷新

- **Found during**: Task 1 verification（`rg StarRating src/` 还命中一行）
- **Issue**: `src/components/library/GameList.tsx:232` 的注释 `本地 rating（StarRating 用户打分）不再露出在列表` 在 StarRating 文件被删除后变成 stale 引用
- **Fix**: 注释更新为 `Quick 260525-g1m / 260526-0bi — 评分列读官方评分 external_rating（toFixed(1)）。本地用户评分字段已整体移除。`
- **Files modified**: `src/components/library/GameList.tsx` (1 行注释)
- **Included in commit**: `007daf4` (Task 1)
- **Reason**: 注释提及已删除的组件会让未来读代码的人困惑，2 秒修复，纳入同一 commit 避免独立空 commit

### 2. [Note - Plan grep precision] `metadata/types.rs::MetadataDetail.rating` 保留

- **Plan grep**: `rg "pub rating:|..." src-tauri/src/` 期望 0 hit
- **Actual**: 1 hit on `metadata/types.rs:103: pub rating: Option<f64>`
- **判断**: 这是 Bangumi/VNDB API 响应 DTO 字段，承载源端原始 rating；在 `commands.rs:1508 / 1957` 处归一化后写到 `external_rating`。**与本地用户评分无关**。
- **Action**: 不修改 — grep 命中是合法的 false positive，保留作为元数据采集的源端字段

## Pre-existing Test Failures Encountered

| Test | Status | Note |
|------|--------|------|
| `http_safe::tests::rejects_ip_literals` | FAIL | Pre-existing since Quick 260525-g1m (per STATE.md row 111). Not touched by this task. |

## Known Stubs

None. 本任务是纯删除/重构 + 一次 schema migration，没有引入新组件或数据源。

## 老库迁移路径

- v0.3.2 老库 schema_version=13，games 表含 `rating` 列
- 启动 v0.3.3 build（待发版）后：
  - tauri-plugin-sql 检测 schema_version 13 < 14 → 跑 V14_SQL
  - `ALTER TABLE games DROP COLUMN rating` 执行（SQLite >= 3.42 原生支持）
  - 用户原本的 rating 数据丢弃（符合用户决策）
  - 列表 / 详情页 / 筛选 / 排序「评分」维度全部基于 `external_rating` 工作

未刷新元数据的老条目 `external_rating` 仍为 NULL，需要用户在 Settings 点「刷新元数据」补回填——这是 v13 既有行为，本任务不引入新的回填需求。

## 后续动作

- 待主对话执行 `npm run release patch` → v0.3.3
- 真机验证（用户在新 build 出来后亲自确认）：
  - 旧库 v13→v14 自动 migrate（无错误日志）
  - Detail 页「评分」行消失，仅显示「官方评分」行
  - 「常用操作」区无 StarRating 组件
  - FilterPanel「评分范围」筛选基于 external_rating 工作
  - 列表 / 排序「评分」维度依然可用（基于 external_rating）

## Self-Check: PASSED

- ✓ `src-tauri/migrations/0014_drop_local_rating.sql` 存在
- ✓ `src/components/library/StarRating.tsx` 不存在（已删）
- ✓ git log 含 3 个 commit hash (`007daf4` / `bd35859` / `2b4b8e2`)
- ✓ db.rs 三组 grep 自验全中预期数
- ✓ cargo test --lib 含 `migrations_v14_drops_local_rating ... ok`
- ✓ cargo check / tsc / pnpm build 三道自动化门全绿（http_safe pre-existing 1 项排除）
