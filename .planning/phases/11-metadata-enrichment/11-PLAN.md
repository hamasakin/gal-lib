# Phase 11: Metadata Enrichment & Multi-dim Filtering — Plan

**Phase:** 11
**Goal:** 补齐 metadata "三层缺口"，让 Library 能按品牌/编剧/画师/声优/官方 tag 多维筛选，详情页展示完整 staff + 跳转外部源链接 + 应用内人物聚合页。
**Depends on:** v1.1 (UI redesign — Detail page hero + FilterPanel pattern locked)
**Requirements covered:** MET-01..05, API-01..05, ING-01..04, UI-01..04

## Plans

The phase decomposes into 7 sequential plans (plan e/f/g may parallelize after d completes):

### 11a — Schema migration (DB v7)

**Files:**
- `src-tauri/migrations/0007_add_metadata_enrichment.sql` (new)
- `src-tauri/src/db.rs` (register V7_SQL + add v7 migration test)

**SQL contents (locked):**
```sql
ALTER TABLE games ADD COLUMN summary TEXT;

CREATE TABLE persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_cn TEXT,
  source TEXT NOT NULL,            -- 'bangumi' | 'vndb'
  source_id TEXT NOT NULL,         -- bangumi person_id (numeric str) or vndb staff id ("s123")
  UNIQUE(source, source_id)
);

CREATE TABLE game_staff (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('scenario','artist','voice','music')),
  character_name TEXT,             -- voice 角色专用，其他 role NULL
  PRIMARY KEY (game_id, person_id, role, COALESCE(character_name, ''))
);
CREATE INDEX idx_game_staff_game ON game_staff(game_id);
CREATE INDEX idx_game_staff_person_role ON game_staff(person_id, role);

CREATE TABLE game_official_tags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  source TEXT NOT NULL,            -- 'bangumi' | 'vndb'
  weight INTEGER NOT NULL DEFAULT 0,  -- bangumi tag count, vndb rating ×100 等
  PRIMARY KEY (game_id, tag_name, source)
);
CREATE INDEX idx_official_tags_game ON game_official_tags(game_id);
CREATE INDEX idx_official_tags_name ON game_official_tags(tag_name);

UPDATE app_meta SET value = '7' WHERE key = 'schema_version';
```

**Acceptance:** `cargo test migrations_v7` 通过；schema_version='7' 验证；4 张新 / 加宽对象齐全

---

### 11b — Bangumi/VNDB API client widening

**Files:**
- `src-tauri/src/metadata/types.rs` — 扩展 `MetadataDetail` + 新结构 `PersonRef` / `OfficialTagRef`
- `src-tauri/src/metadata/bangumi.rs` — `fetch_detail` 解析 infobox brand + tags 数组；新增 `fetch_persons` / `fetch_characters` 函数
- `src-tauri/src/metadata/vndb.rs` — GraphQL fields 加 `staff{}/va{}/developers{}/tags{}`，统一返回到扩展 `MetadataDetail`

**Acceptance:** 单元测试 `bangumi_role_normalization()`、`vndb_role_normalization()` 通过；fetch_persons/fetch_characters 函数签名稳定

---

### 11c — Ingest pipeline rewrite + commands.rs new IPCs

**Files:**
- `src-tauri/src/ingest.rs` — process_game 在 final_choice 后调 fetch_detail+fetch_persons+fetch_characters，扩展 `IngestResult` 携带 summary/brand/persons/staff/tags
- `src-tauri/src/commands.rs` —
  - `start_scan` / `add_game` / `bind_metadata` / `refresh_metadata` UPDATE 加 summary/brand 列；写 persons/game_staff/game_official_tags（事务化）
  - `list_games` row_to_game 加 summary 字段
  - 新 IPC `list_persons_for_game(game_id) -> Vec<GameStaffRow>`
  - 新 IPC `list_games_for_person(person_id, role?) -> Vec<Game>`
  - 新 IPC `get_filter_options() -> FilterOptions { brands, scenarios, artists, voices, official_tags }`
  - 新 IPC `backfill_metadata_enrichment() -> ()`
  - 新 IPC `open_external_url(url: String) -> ()`（包装 tauri shell.open）
  - `search_games` filter 加 `staff_ids: Vec<i64>` / `official_tags: Vec<String>` 字段
- `src-tauri/src/lib.rs` — 注册新 IPC 命令

**Acceptance:** `cargo build` 通过；scan 一个新游戏后查看 DB persons/game_staff/game_official_tags 行数 > 0

---

### 11d — Frontend types + invoke wrappers

**Files:**
- `src/lib/games.ts` — Game interface 加 `summary: string | null`
- `src/lib/metadata.ts` — 加 `Person` / `GameStaffRow` / `OfficialTag` / `FilterOptions` 类型
- `src/lib/persons.ts` (new) — invoke wrappers (`listPersonsForGame`, `listGamesForPerson`, `getFilterOptions`, `backfillMetadataEnrichment`, `openExternalUrl`)
- `src/lib/search.ts` 或 `lib/advancedFilter.ts` — 加 staff/tag filter 字段

**Acceptance:** `pnpm tsc --noEmit` 通过；Game 类型 includes summary；新 invoke 函数 export 完成

---

### 11e — Detail page metadata display + jump links

**Files:**
- `src/routes/Detail.tsx` —
  - 加简介区块（顶部 hero 下方独立 section，markdown-friendly）
  - 加 staff 区块（按 role 分组卡片：编剧 / 画师 / 声优 / 音乐；每行人物名可点击 → 跳 /persons/:id）
  - 加官方标签 chip 区（灰色 chip + tooltip 显示 weight）
  - 加 "在 Bangumi 看 ↗" / "在 VNDB 看 ↗" 外部链接按钮（meta pills 区或更多菜单）

**Acceptance:** 详情页加载 已绑定 Bangumi 的游戏，能看到 summary/staff/tags；点 staff 名跳路由；点外部链接打开浏览器

---

### 11f — Library FilterPanel multi-dim facet

**Files:**
- `src/components/library/FilterPanel.tsx` — 在已有 4 维（状态/评分/年份/时长）后追加：
  - 品牌（chip 多选 + 搜索框）
  - 编剧 / 画师 / 声优（按 role 分 3 个 section，chip + 搜索框）
  - 官方标签（chip 多选）
  - 跨维度 AND（filter 累加），同维度 OR（chip 多选）
- `src/lib/advancedFilter.ts` — 加 brands/staffIds/tagNames 三个 Set，applyFilter 函数串入新维度
- `src/store/library.ts` — filter slice 字段已经能扩展（SearchFilter 类型本身扩展即可）

**Acceptance:** Library 页 FilterPanel 出现 4 + 4 = 8 个 section；勾选某品牌后 grid 仅显示该品牌；勾选某编剧 + 某声优后只显示同时满足的游戏

---

### 11g — Persons aggregate page + routing

**Files:**
- `src/routes/Persons.tsx` (new) — `/persons/:id` 路由组件：顶部人物卡（name + name_cn + source badge + 参与作品数 chip）+ 按 role 分组的游戏 grid（复用 GameCard）
- `src/router.tsx` — 加 `{ path: "persons/:id", element: <Persons /> }`
- `src/components/layout/Sidebar.tsx` — 不动（人物页通过点击进入，不在导航里）

**Acceptance:** 在 Detail 点编剧名跳 /persons/:id 看到该编剧所有作品；URL 直接访问 /persons/:id 也能渲染

## Execution order

11a → 11b → 11c → 11d → (11e || 11f || 11g)

11e/11f/11g 可并行执行（改不同文件）。

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Bangumi `/persons` endpoint 限速被打爆 | 现有 `limiter::wait_bangumi` 1req/s 串行所有调用；backfill 加进度 + 可取消 |
| VNDB role enum 不止 art/scenario/music | 把未知 role 落到 'voice' 之外的 normalization 中 silently drop（log + 不写 game_staff） |
| Schema migration 失败 | tauri-plugin-sql migration 是 transactional（rusqlite ATTACH 内 BEGIN），失败回滚不留中间态 |
| 现有 200 game 库 backfill 耗时 ~10 分钟 | 后台任务 + 进度 emit；UI 不阻塞 |
| 跨源人物在两个 source 各一行 | v1.2 不解决；v1.3 seed 处理 |
