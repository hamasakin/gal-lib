# Requirements: gal-lib

**Milestone:** v1.2 — Metadata Enrichment & Filtering
**Defined:** 2026-05-09
**Core Value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆——而且每张卡片背后都有充实的元数据，可按品牌/作者/画师/声优深度筛选与跳转。

## v1.2 Requirements

v1.2 总计 18 个 requirement，分布在 6 个类别。Phase 11 是 v1.2 唯一的主 phase；它一次性补齐 metadata 三层缺口（API 客户端字段抓取 / DB schema 列与关系表 / UI 展示与筛选 / 跳转链接）。

### MET (Metadata Schema)

- [x] **MET-01**: `games` 表新增 `summary TEXT` 列，存储 Bangumi/VNDB 抓取的简介；ingest 与 refresh_metadata 路径写入此列
- [x] **MET-02**: 新增 `persons (id, name, name_cn, source, source_id)` 表存储人物（编剧/画师/声优/作曲家），UNIQUE(source, source_id)
- [x] **MET-03**: 新增 `game_staff (game_id, person_id, role, character_name)` 关系表；role IN ('scenario','artist','voice','music')；character_name 仅 voice 角色填写
- [x] **MET-04**: 新增 `game_official_tags (game_id, tag_name, source, weight)` 表存储 Bangumi/VNDB 官方 tags，与现有用户 `tags`/`game_tags` 解耦
- [x] **MET-05**: 新增 migration `0007_add_metadata_enrichment.sql`，bumps schema_version 到 7；migration idempotent（重跑不破坏）

### API (Metadata Client Widening)

- [x] **API-01**: Bangumi 客户端 `fetch_detail` 返回的 `MetadataDetail` 新增 `brand`, `tags: Vec<{name, weight}>` 字段（从 `infobox` 提取「品牌」key + 顶层 `tags` array）
- [x] **API-02**: 新增 `bangumi::fetch_persons(subject_id)` 调 `/v0/subjects/{id}/persons`，返回 `Vec<PersonRef{id, name, relation}>`，relation normalize 到 4 类 role
- [x] **API-03**: 新增 `bangumi::fetch_characters(subject_id)` 调 `/v0/subjects/{id}/characters`，提取 voice actors（每个 actor 关联到 character_name）
- [x] **API-04**: VNDB 客户端 `fetch_detail` 通过 GraphQL 查询新增 `staff{id, name, role}`、`va{staff{id, name}, character{name}}`、`developers{name}`、`tags{name, rating, spoiler}` 字段
- [x] **API-05**: 跨源 role 映射归一化：`bangumi::scenario|脚本 → 'scenario'`，`bangumi::原画|插画 → 'artist'`，`bangumi::作曲|音乐 → 'music'`；`vndb::scenario → 'scenario'`，`vndb::art|chardesign → 'artist'`，`vndb::music → 'music'`

### ING (Ingest Pipeline)

- [x] **ING-01**: `ingest::process_game` 在写 `games` 时同时写入 summary、brand（覆盖手填的 brand 仅当当前 brand 为 NULL）
- [x] **ING-02**: ingest 调 fetch_persons + fetch_characters 后写入 persons / game_staff（事务化，cross-bind 时归一化人物名+source_id）
- [x] **ING-03**: ingest 写入 game_official_tags（覆盖已有 tags：先 DELETE WHERE game_id THEN INSERT）
- [x] **ING-04**: 新增 IPC 命令 `backfill_metadata_enrichment()` 对所有已有游戏（绑定 Bangumi/VNDB 但缺 staff 数据）触发补抓；遵守现有 limiter；带进度 emit

### UI (Frontend Display & Filtering)

- [~] **UI-01**: Detail 页新增简介区块（多段落 markdown / 普通文本）；新增 staff 区块按 role 分组展示（编剧 / 画师 / 声优 / 音乐）；新增「在 Bangumi 看 ↗」/「在 VNDB 看 ↗」外部链接按钮
- [~] **UI-02**: Detail 页 staff 行人物名可点击 → 跳 `/persons/:id`；官方 tags 区分「官方标签」（灰色 chip 不可编辑）与「我的标签」（保留现有用户 tag 编辑）
- [~] **UI-03**: Library 页 FilterPanel 新增多维 facet：品牌 / 编剧 / 画师 / 声优 / 官方标签；多 facet 跨维度 AND，同维度 OR；支持搜索人物名
- [~] **UI-04**: 新增路由 `/persons/:id` 人物聚合页：顶部人物名 + 平均参与作品数 chip + 该人物按 role 在你库中参与的所有游戏 grid（复用 GameCard）

## Constraints / Notes

- **Schema 一次迁完**: MET-01..05 在同一 migration（0007）原子执行，避免反复 ALTER
- **Bangumi limiter**: 现有 `limiter::wait_bangumi` 1req/s 必须串行所有新增子端点（subject + persons + characters = 3 req per game），200 game backfill ≈ 10 分钟，需进度 UI
- **VNDB role normalization**: VNDB `chardesign` 与 `art` 都归到 'artist'，避免双行（同一人在同一作品里同时挂 chardesign + art）
- **Person dedup 不在 v1.2 范围**: 同一作家 Bangumi+VNDB 双源各占一行（source 不同 → 两条 persons 记录）；v1.3 再做 cross-source merge（写进 v1.3 seed）
- **跳转外部链接**: 优先 `tauri-plugin-opener` (`open_path` IPC) 而非自己 spawn cmd
