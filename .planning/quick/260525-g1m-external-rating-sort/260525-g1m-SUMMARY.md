---
quick_id: 260525-g1m
description: 官方评分入库 + 排序升降序切换
status: complete
date: 2026-05-25
commits:
  - a24ae21: feat(quick-260525-g1m): schema v13 add external_rating + MetadataDetail.rating fields
  - 9717c63: feat(quick-260525-g1m): fetch external rating from Bangumi rating.score + VNDB rating (normalize /10)
  - 876ce49: feat(quick-260525-g1m): persist external_rating across 4 UPDATE paths + expose in Game struct
  - ae517d5: feat(quick-260525-g1m): search_games accept sort_dir asc/desc, switch rating to external_rating
  - c352591: feat(quick-260525-g1m): SortSelect direction toggle + sortDir wired through store + i18n
  - e3fb81d: feat(quick-260525-g1m): GameList shows external rating + Detail pill/info show official rating
---

# Quick 260525-g1m — 官方评分入库 + 排序升降序切换

## What changed

### Task 1 — schema v13 + MetadataDetail.rating（`a24ae21`）
- **新增** `src-tauri/migrations/0013_add_external_rating.sql`：
  - `ALTER TABLE games ADD COLUMN external_rating REAL` — 官方评分（0..=10 归一化后浮点）
  - `ALTER TABLE games ADD COLUMN external_rating_count INTEGER` — 投票数
  - `ALTER TABLE games ADD COLUMN external_rating_source TEXT` — 'bangumi' | 'vndb'
  - `CREATE INDEX IF NOT EXISTS idx_games_external_rating ON games(external_rating DESC)` — 服务「评分」排序
  - `UPDATE app_meta SET value = '13' WHERE key = 'schema_version'`
  - 头注释说明**不做 backfill** — 详见 "CRITICAL user action" 段。
- **`src-tauri/src/metadata/types.rs`** — `MetadataDetail` 末尾追加 `rating: Option<f64>` + `rating_count: Option<i64>`。

### Task 2 — Bangumi + VNDB fetch_detail 读取 rating（`9717c63`）
- **`src-tauri/src/metadata/bangumi.rs`**：
  - `SubjectDetail` 加 `#[serde(default)] rating: Option<RatingObj>`；新增 `RatingObj { score: Option<f64>, total: Option<i64> }`
  - `fetch_detail` 构造 `MetadataDetail` 时填 `rating: raw.rating.as_ref().and_then(|r| r.score)` / `rating_count: raw.rating.as_ref().and_then(|r| r.total)`
- **`src-tauri/src/metadata/vndb.rs`**：
  - `DetailHit` 顶层加 `rating: Option<f64>` + `votecount: Option<i64>`（注意与 `TagEntry.rating` 标签权重独立）
  - VNDB `fields` 字符串追加 `rating,votecount`（与 `tags{name,rating,...}` 共存）
  - 构造 `MetadataDetail` 时 `rating: hit.rating.map(|r| r / 10.0)` — 0..=100 归一化到 0..=10 与 Bangumi 同口径

### Task 3 — 持久化（`876ce49`）
- **`src-tauri/src/ingest.rs`**：
  - `IngestResult` 末尾追加 `external_rating: Option<f64>` / `external_rating_count: Option<i64>` / `external_rating_source: Option<String>`
  - `fetch_enrichment` 返回 tuple 从 5 元组扩到 8 元组（额外 rating / rating_count / source_str）；`source_str` 由顶层 `MetadataSource` 决定 (Bangumi→"bangumi" / Vndb→"vndb" / 其他→None)
  - `process_game` + `process_game_cached` 两处调用解构 8 元组并赋值到 result
  - 两处 `IngestResult { ... }` 默认构造（无 match 路径）补三字段为 `None`
- **`src-tauri/src/commands.rs`** — 4 处 `UPDATE games SET ...` 全部覆盖式写入三新列（不走 COALESCE — 与 summary 同语义，用户主动刷新就期望最新分数）：
  1. `apply_ingest_result`（line ~198）— start_scan / add_game 路径
  2. `bind_metadata`（line ~1448）— 用户手动绑定
  3. `refresh_metadata`（line ~1548）— 单条刷新
  4. `refresh_metadata_smart` 未绑定（line ~1761）+ 已绑定（line ~1879）两路径
- `Game` 结构末尾追加三字段；`row_to_game` 同步加 `try_get`；4 处 SELECT 列表（`list_games` / `get_game` / `search_games` / `list_games_for_person`）都加三列。
- `bind_metadata` 的 `synthetic` IngestResult + `refresh_metadata_smart` 已绑定路径的 `result_shell` IngestResult 也同步补三字段（保证 `write_staff_and_tags` 等下游消费一致）。

### Task 4 — `search_games` sort_dir + rating → external_rating（`ae517d5`）
- **`src-tauri/src/commands.rs`** — `search_games` 签名插入 `sort_dir: Option<String>`（在 `sort_by` 之后、`filter` 之前；Tauri 反序列化对旧前端的 3 参调用兼容 → `sort_dir = None` → DESC）。
- 排序白名单从硬编码 `&str` 改为按 `dir` 渲染 `String`：
  - `last_played` → `last_played_at IS NULL, last_played_at {dir}`（NULL 始终沉底）
  - `created_at` → `created_at {dir}`
  - `name` → `name COLLATE NOCASE {dir}`
  - `playtime` → `total_playtime_sec {dir}`
  - `rating` → **`external_rating IS NULL, external_rating {dir}`**（切到官方评分，NULL 沉底语义不变）
- `sort_dir` 白名单：`asc` / `desc` / `None`（默认 desc）；其他值 → `Err`。

### Task 5 — 前端（`c352591`）
- **`src/lib/games.ts`** — `Game` 接口加三字段（`external_rating` / `external_rating_count` / `external_rating_source`，注释说明 NULL 语义）。
- **`src/lib/search.ts`** — 新增 `export type SortDir = "asc" | "desc"`；`searchGames` 签名扩到 4 参 `(query, sortBy, sortDir, filter)`。
- **`src/store/library.ts`** — 加 `DEFAULT_SORT_DIR = "desc"` 常量 + `sortDir: SortDir` state + `setSortDir(d)` setter，不持久化（与 `sortBy` 同 pattern）。
- **7 处 `searchGames` 调用点全部更新为 4 参**：
  - `routes/Library.tsx` / `components/library/GameGrid.tsx` / `components/library/MetadataPicker.tsx` → 读 store.sortDir
  - `routes/Stats.tsx` / `routes/Screenshots.tsx` / `routes/Settings.tsx`（2 处）→ 硬编码 `"desc"`（这些是一次性全库 hydrate，沿用历史 DESC）
- **`src/components/library/SortSelect.tsx`** — 在 select 右侧新增 28×28 方向按钮：
  - 点击翻转 store.sortDir（desc ↔ asc）；图标用 `↓` / `↑` 静态字符
  - `aria-label` + `title` 走 `t("sort.direction.{asc,desc}")` 三语
- **i18n 三套 `translation.json` 各 +2 key**：
  - `sort.direction.asc`: 升序 / 昇順 / Ascending
  - `sort.direction.desc`: 降序 / 降順 / Descending

### Task 6 — GameList + Detail UI（`e3fb81d`）
- **`src/components/library/GameList.tsx` (line 231)** — 评分列从 `g.rating` 改读 `g.external_rating.toFixed(1)`，NULL 显示 `—`。
- **`src/routes/Detail.tsx` (line ~1109)** — 顶部 Pill 改读 `external_rating`，附带 `· BGM` / `· VNDB` 后缀；NULL 时整个 Pill 不渲染（去掉「★ — / 5」无意义占位）。
- **`src/routes/Detail.tsx` (line ~1546)** — 「信息」侧栏在本地 `rating` 行**之后**新增「官方评分」行（保留本地行）：`★ {value} / 10 · BGM/VNDB ({count})`，NULL 显示 `—` 占位。
- **i18n 三套 `translation.json` 各 +1 key**：
  - `detail.info.external_rating`: 官方评分 / 公式評価 / Official rating

## Schema migration note

迁移 `0013_add_external_rating.sql` 把 `app_meta.schema_version` 升到 `'13'`。
启动时 sqlx 检测 `schema_version='12'` → 执行 0013 → 三列 ADD + 索引创建 + version bump。**幂等**：`ALTER TABLE ... ADD COLUMN` 在已存在时会报错但 sqlx migration runner 用文件级 `_sqlx_migrations` 跟踪，已应用的版本不会重复执行。

## CRITICAL user action required

**老库（已扫过、未升级到 v13 的）首次启动迁移后，`external_rating` 三列全为 NULL。**

迁移**故意不写回填 SQL**，原因：
1. 没有可复制的源列 — 旧库的 `games.rating` 是本地用户打分（1..=10 整数），与官方评分（0..=10 浮点）口径不同。
2. 启动时同步重抓 Bangumi/VNDB API 会卡几分钟（库越大越久），破坏「启动 = 秒看到列表」体验。
3. 已有路径解决 — 用户去 **Settings 页点「刷新元数据」**（IPC `refresh_metadata_smart`）即可触发并发刷新（JoinSet=4），未绑定行走完整搜索 + 绑定行直拉 detail，4 处 UPDATE 都已写入 `external_rating` 三列（Task 3）。

**症状提示**：用户升级后会看到：
- GameList 评分列全部显示 `—`
- Detail 顶部官方评分 Pill 不显示
- 「评分」排序仍能用但所有行都沉底（NULL last）
点一次「刷新元数据」即可恢复正常。

## Verify gates

| Gate | Status | Output |
|---|---|---|
| `cargo check` | ✅ green | `Finished dev profile [unoptimized + debuginfo] target(s) in 0.48s`（6 个 pre-existing warnings 未变） |
| `cargo test --lib` | 86 passed / 1 failed | `http_safe::tests::rejects_ip_literals` **预存在失败**，git stash 后 clean tree 复现，与本任务无关；其余 86 测试包括 release_year 解析、ingest 等全部通过 |
| `pnpm tsc --noEmit` | ✅ green | 无输出（一切类型 OK） |
| i18n 三语 `sort.direction.*` | ✅ 2/2/2 | 三语各 2 条 key（asc + desc） |
| i18n 三语 `detail.info.external_rating` | ✅ 1/1/1 | 三语各 1 条 key |
| `external_rating` refs in commands.rs | ✅ 47 | 远超预期 ≥25（4 处 UPDATE × 3 列 + 4 处 SELECT × 3 列 + Game 结构 + row_to_game + 排序白名单 + bind 等） |

`pnpm run build` 跳过（无 `pnpm install` 在 worktree，会触发完整 vite + tauri bundle 耗时长；`pnpm tsc --noEmit` 已覆盖类型检查路径）。

## Deviations

### [Rule 1 不适用 — 预存在测试失败]
`http_safe::tests::rejects_ip_literals` 在 master 已失败（git stash 后 clean tree 复现确认）；与本任务的 `external_rating` / `sort_dir` 改动完全无关，属 Out of scope。**未修复，未阻塞提交**。已在 Task 3 commit message 内说明。

### [N/A — 实施全程对齐 PLAN]
计划描述的所有 6 个 task 锚点 / 字段名 / SQL / i18n key 全部按文字落地，无技术性 deviation。

### 工具链注记（不算 deviation，仅记录）
- worktree 没装 `node_modules`，`pnpm exec tsc` 不可用；改用主仓 `node /d/project/gal-lib/node_modules/typescript/bin/tsc --noEmit` 跑同一份 worktree 的 tsconfig.json + src/，效果等价。
- 中途一次绝对路径混淆（向 `D:\project\gal-lib\src-tauri\...` Write 而非 worktree），及时迁移文件 + 还原主仓后继续，不影响最终成品。

## Real-machine verification checklist (human_needed)

子代理跑不动 GUI，以下交互需用户真机验证：

1. **新装 / 删 `data/app.db` 重扫**：
   - 启动 → 扫描 → Bangumi 命中的卡 Detail 顶部应看到 `★ 7.x · BGM`；信息侧栏「官方评分」行有值。
2. **VNDB-only 命中**：Detail Pill 后缀 `· VNDB`，信息行同样。
3. **老库升级首次（仅升级未刷新）**：
   - GameList 评分列全 `—`、Detail 官方评分 Pill 不显示、「评分」排序所有行都沉底。
   - 去 Settings 点「刷新元数据」→ 等进度跑完 → 评分排序立刻有意义、Pill 出现。
4. **SortSelect 方向切换**：
   - 切到「评分」+ ↓ → 高分在前；点 ↑ → 低分在前（NULL 仍沉底，不翻转）。
   - 切到「最近游玩」+ ↑ → 久远的在前；NULL 仍沉底。
5. **三语切换**：
   - Settings → 界面语言 → 中/日/英
   - SortSelect 方向按钮 hover tooltip / aria-label 三语切换（升序/昇順/Ascending）
   - Detail 信息行 label：官方评分 / 公式評価 / Official rating
6. **排序 ASC 时 NULL 仍沉底**（核对 `external_rating IS NULL, external_rating ASC` 语义）。
