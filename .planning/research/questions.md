# Open Research Questions

## Bangumi / VNDB 字段映射验证 — Phase 11 前置

**Source:** /gsd-explore 2026-05-09 "metadata enrichment"

在编写 Phase 11 PLAN.md 之前，需要调研以下事实问题（可派 gsd-phase-researcher）：

### Bangumi v0 API
1. `/v0/subjects/{id}` 返回结构里 `infobox` 数组的 key 命名约定（中文 key 名是否稳定？例如「品牌」「制作」「企画」是否始终用这几个 key？）
2. `/v0/subjects/{id}/persons` 返回的 person object 字段：包含 `id`、`name`、`relation`，relation 值的 enum（"脚本" / "原画" / "音乐" / 等）是否稳定，需不需要做 normalization 表
3. `/v0/subjects/{id}/characters` 返回的 character + actors，actors 数组里的字段（id / name），rate-limit 限制（v0 默认 1req/s 是否对 sub-resources 也算）
4. `/v0/subjects/{id}` 是否包含 `tags`（带 count），tags 数组与上述独立 endpoints 是否需要 N+1 调用

### VNDB Kana GraphQL API
1. `vn` 查询里 `staff{}` 子字段（role enum 与名称）— 其 role 命名（VNDB 用英文如 "scenario"/"art"/"music"/"chardesign"），与我们的 4-role 设计如何 normalize（特别是 "chardesign" 是否归到 artist）
2. `vn{ va{} }` (vns_va) 字段是否同时返回 staff person id 与 character 引用
3. `vn{ tags{} }` 的 spoiler / category 字段（我们要不要按 spoiler level 过滤）
4. `vn{ producers{} }` 与 `vn{ developers{} }` 哪个对应「品牌」(brand) — Bangumi 与 VNDB 的"品牌"语义是否一致

### 跨源数据归一化
1. 同一作家/声优 Bangumi 与 VNDB 是否给同一 source_id —— 几乎肯定不会，需要按 (name, name_cn) 模糊去重
2. 如果同时绑定 Bangumi+VNDB 的游戏，staff 数据冲突时取哪边（建议主源 Bangumi 优先，VNDB 补全 missing）

### 工程细节
1. Bangumi 的 person/character 子查询限速对全库 backfill 的总耗时估算（200 个游戏 × 3 子端点 / 1req/s = 10 分钟级，是否需要后台队列）
2. persons 表的 person portrait 是否需要本地缓存（人物聚合页要展示头像）
