# Phase 11: Metadata Enrichment & Multi-dim Filtering — Context

**Gathered:** 2026-05-09
**Status:** Ready for planning
**Mode:** Auto-generated from explore session (skipping discuss-phase since explore covered all decisions)
**Source-of-context:** `.planning/notes/metadata-enrichment-context.md` (committed in 1df9fdf)

<domain>
## Phase Boundary

补齐 metadata "三层缺口"（API 客户端字段抓取 / DB schema 列与关系表 / UI 展示与筛选），让用户能：
1. 在 Detail 页看到游戏简介、品牌、编剧/画师/声优/音乐 staff、官方 tags
2. 点 "在 Bangumi 看 ↗" / "在 VNDB 看 ↗" 跳到外部源页
3. 点详情页的品牌名跳到 Library 该品牌筛选视图（已部分支持）
4. 点详情页的人物名跳到 `/persons/:id` 聚合页（看该人物参与的所有游戏）
5. 在 Library FilterPanel 中按品牌 / 编剧 / 画师 / 声优 / 官方标签多维筛选（跨维度 AND，同维度 OR）

**Out of scope (defer to v1.3 or seeds):**
- 跨源人物去重（同一作家 Bangumi+VNDB 双源各占一行）
- 人物聚合页的"作品时光轴 / 同台伙伴推荐"（在 seeds/persons-page-enrichment.md）
- person portrait 头像本地缓存

</domain>

<decisions>
## Implementation Decisions

### Data model (locked in explore)
- 独立 `persons` 表 + `game_staff` N:M 关系表 — 而非反范式 JSON 列
- 独立 `game_official_tags` 表，与现有 `tags / game_tags`（用户自建）解耦

### Roles enum (locked)
4 类：`scenario | artist | voice | music`

### Schema strategy
- 一次性 migration `0007_add_metadata_enrichment.sql`，避免反复 ALTER
- bump `schema_version` 到 7

### Cross-source role normalization
- `bangumi::scenario|脚本` → `'scenario'`
- `bangumi::原画|插画|人物设定` → `'artist'`
- `bangumi::声优` → `'voice'`（带 character_name from /characters endpoint）
- `bangumi::作曲|音乐|主题曲` → `'music'`
- `vndb::scenario` → `'scenario'`
- `vndb::art|chardesign` → `'artist'`（合并到一类）
- `vndb::music` → `'music'`
- `vndb::vns_va` → `'voice'`（带 character.name）

### Jump links strategy
- 外部链接：`tauri-plugin-opener` 已是项目缺失依赖；用 `tauri::api::shell::open` 或 webview-side `window.open` 兜底
- 内部品牌跳转：复用已有 `setFilter({ brand })` 路径
- 内部人物聚合页：新路由 `/persons/:id`（hash router）

### Backfill
- 新增 IPC `backfill_metadata_enrichment()`：对已绑定 Bangumi/VNDB 但缺 staff 数据的 games 重新走 detail+persons+characters 流程
- 进度通过 `meta-fetch-progress` event emit（复用现有事件通道）
- 限速：现有 `limiter::wait_bangumi` 1req/s 串行（200 game × 3 endpoint ≈ 10 分钟）

</decisions>

<code_context>
## Existing Code Insights

**Backend metadata pipeline:**
- `src-tauri/src/metadata/types.rs` 定义 `MetadataDetail`（来自 fetch_detail）
- `src-tauri/src/metadata/bangumi.rs` 现仅拉 `name/name_cn/summary/cover/date`
- `src-tauri/src/metadata/vndb.rs` 现仅拉 `title/titles/image/description/released`
- **关键发现**：ingest 流程 (`src-tauri/src/ingest.rs::process_game`) 用的是 search 阶段的 `Candidate`（含 summary 但不含 staff/brand/tags），从未调 `fetch_detail`！要补 staff/tags/brand 必须在 process_game 末尾增加 fetch_detail+fetch_persons+fetch_characters 调用
- `src-tauri/src/db.rs` 通过 `tauri-plugin-sql` 注册 migrations，已到 v6

**Frontend:**
- `src/router.tsx` HashRouter，已有 `/games/:id`，加 `/persons/:id` 模式相同
- `src/components/library/FilterPanel.tsx` 320px popover，已有「状态/评分/年份/时长」四维 facet
- `src/lib/advancedFilter.ts` 客户端二次过滤层（不打 backend）
- `src/store/library.ts` Zustand store；filter slice 已经支持 brand 过滤（通过 SearchFilter 和 setFilter）
- `src/routes/Detail.tsx` 已有 buildSummary 函数和 game.brand 点击 setFilter 逻辑，等数据接通

</code_context>

<specifics>
## Specific Requirements

REQ 列表见 `.planning/REQUIREMENTS.md` v1.2 段（MET-01..05, API-01..05, ING-01..04, UI-01..04 共 18 个 requirement）。

</specifics>

<deferred>
## Deferred Ideas

- Person dedup across sources → v1.3 seed
- Persons portrait local caching → seed
- Person aggregation page advanced features (timeline / co-staff recommendations) → seeds/persons-page-enrichment.md
- Backfill progress UI 完整化（仅 emit 事件 + Library 顶部进度条复用）→ if time permits in Phase 11; otherwise carry to v1.3

</deferred>
