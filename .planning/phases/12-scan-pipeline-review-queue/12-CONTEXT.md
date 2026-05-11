# Phase 12: Scan Pipeline & Review Queue — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Mode:** Auto-generated for /gsd-autonomous (skip_discuss equivalent — REQUIREMENTS 已锁定细节，无需进一步 grey-area 答疑)

<domain>
## Phase Boundary

让 v1.0 起就一直藏在 Library 顶部 progress bar 后面的扫描流程，浮上来成为可视化的独立 `/scan` 工作台：

1. 用户能在 `/scan` 看到「已扫游戏 / 已绑定 / 待复核 / 不匹配」四联 KPI + 触发增量/全量按钮
2. 左栏滚动的实时日志（最新 200 条），右栏是持久化的「待复核」队列（match_confidence < 80 自动入队 + 重启后保留）
3. 待复核卡片展开 = Bangumi vs VNDB 并排候选对比；点「采用 Bangumi」/「采用 VNDB」 → 一键 rebind + 重抓 + 出队

**Out of scope（明确推迟）:**
- 候选 AI 辅助评分（高级用户需求，留待用户实际使用后再决定）
- `/scan` 待复核队列虚拟化滚动（典型场景 < 50 项）
- 不调整 walkdir 边界识别 / exe_score 启发式
- 不引入新的 KPI 之外的全局扫描分析

</domain>

<decisions>
## Implementation Decisions

### Schema (locked)
- 新 migration `0009_add_scan_review_queue.sql`；bumps schema_version → 9
- 新表 `scan_review_queue (game_id INTEGER PK ref games(id) ON DELETE CASCADE, game_path TEXT NOT NULL, current_confidence INTEGER NOT NULL, suggested_source TEXT, suggested_id TEXT, created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')))`
- 索引 `idx_scan_review_queue_created ON scan_review_queue(created_at DESC)`
- 入队时机：ingest `apply_ingest_result` 后若 `metadata_source = 'none'` 或 `match_confidence < 80` 则 INSERT OR REPLACE
- 出队时机：用户调 `accept_review_candidate` 或 `dismiss_review_item`，或 `bind_metadata` 显式 rebind（清理副作用）

### IPC contracts (locked)
- `get_scan_kpis() -> ScanKpis { total, bound, review_pending, unmatched }` —— `total = COUNT(*) FROM games`、`bound = ... WHERE metadata_source IN ('bangumi','vndb','manual')`、`review_pending = COUNT(*) FROM scan_review_queue`、`unmatched = ... WHERE metadata_source='none'`
- `list_scan_review_queue() -> Vec<ReviewItem { game_id, game_path, name, current_confidence, current_source, current_source_id, suggested_source, suggested_id, created_at }>` —— LEFT JOIN games 拿到当前 name + metadata
- `dismiss_review_item(game_id)` —— 仅 `DELETE FROM scan_review_queue WHERE game_id = ?`
- `accept_review_candidate(game_id, source, source_id)` —— 调用既有 `bind_metadata` 逻辑 + 自动 DELETE FROM scan_review_queue（事务化）
- `fetch_review_candidates(game_id) -> Vec<Candidate>` —— 对 game 当前 name 调用既有 `search_metadata`，先 Bangumi 再 VNDB；返回 top 1 of each source（按 confidence）
- `bind_metadata` 修改：成功后顺带 `DELETE FROM scan_review_queue WHERE game_id = ?`（保持队列与库状态一致）

### Frontend (locked)
- 新路由 `/scan` —— `App.tsx` 已是 layout-route 模式；router.tsx 加 `path: "scan"`，children 共用 `<Outlet>` 但 Scan 页内部用 `min-h-[calc(100vh-...)]` 抑制 Library Sidebar 影响。**简化：直接在 Sidebar 加入 nav item「扫描复核」**（与 stats/screenshots/settings 平级），无需独立 layout —— 用户从 sidebar 进入即可，技术上仍是 layout-route 子页
- 顶部 4 KPI 用 PageHeader pattern + 4 个一致的 KpiCard（参考 Stats.tsx KPI 样式）；mount 时 + `meta-fetch-progress` 完成时 + `scan-progress` Completed 时 refetch
- 左栏「实时增量日志」复用 `scan-progress` + `meta-fetch-progress` 已有事件流 —— 在新组件 `ScanFeed.tsx` 维护本地 `useState<string[]>` rolling buffer（最大 200 行）；不持久化（重启后清空，符合"日志"语义）
- 右栏「待复核」用新组件 `ReviewQueue.tsx` —— mount + 事件刷新时 `list_scan_review_queue()`；展开行调 `fetch_review_candidates(game_id)` 拉双源 top-1 候选；并排 2 列对比卡 + 单击「采用 X」按钮
- 候选对比卡用既有 Candidate type；显示封面 / 标题 / 品牌（若 candidate 没拉 brand 就跳过）/ 简介首 200 字 / 评分 / source id
- 候选拉取期间 skeleton；空候选 = "未找到匹配，请手工 `MetadataPicker` 绑定 ID"（按钮直接打开既有 `<MetadataPicker game={game} />`）

### Persistence semantics (locked)
- 待复核行的 lifecycle：scan/ingest 入队 → 用户 accept 或 dismiss → 出队
- 重新扫描同一目录时，若 ingest 再次产出低 confidence，会 INSERT OR REPLACE（保持唯一一条最新记录）
- `clear_all_data` 必须 truncate `scan_review_queue`（CASCADE 已保证，但显式 DELETE 写在 clear_all_data 帮助调试）

### What NOT to change
- 不改 `walker.rs` / `exe_score.rs` / `match_score.rs`
- 不动 metadata `limiter` 配额；候选拉取直接复用 `search_metadata` IPC
- 不改 `apply_ingest_result` 主体；只在末尾加 `INSERT INTO scan_review_queue` 分支
- 不破坏 v1.2 `getFilterOptions` / `backfill_metadata_enrichment` 行为
- 不强行做 `/scan` 独立 layout (无 Sidebar)；坚守 layout-route 子页约束，简化实现

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `commands.rs::search_metadata(query, source)` —— 已经接受 bangumi/vndb 字符串，返回 `Vec<Candidate>`
- `commands.rs::bind_metadata(game_id, source, source_id)` —— 现成的 rebind 入口，confidence=100，会写 summary/brand/persons/staff/tags
- `commands.rs::apply_ingest_result()` —— ingest 终点，已经更新 metadata_source/match_confidence；在这里 piggyback 入队逻辑
- `MetadataPicker.tsx` —— 既有手工绑定 dialog；ReviewQueue 的「展开手工绑定」按钮直接复用，传 game 进去即可
- `Candidate` type from `lib/metadata.ts` —— 候选展示直接复用
- `PageHeader.tsx` —— 顶部 breadcrumb + h1 + actions，Scan 页头部 reuse 模板
- `ScanProgressBar.tsx` —— 顶部进度条；保留在 `/scan` 页内继续展示

### Established Patterns
- HashRouter + layout-route：所有 `/foo` 路径都是 `App.tsx` `<Outlet>` 的子项；sidebar nav 由 `Sidebar.tsx` 管理
- IPC 命名：`snake_case` Rust → camelCase JS keys 自动转换
- DB 访问：`State<'_, AppPaths>` → `state.pool().await`
- Tauri event：`app.emit("event-name", payload)`；前端 `listen("event-name", cb)`
- Mono uppercase typography for status/labels；serif H1；Tailwind tokens (`var(--accent)`, `text-ink-*`, `bg-bg-*`)
- 文件命名：组件 `PascalCase.tsx`、路由 `routes/Foo.tsx`、IPC wrappers 在 `src/lib/foo.ts`

### Integration Points
- `router.tsx` 加 `{ path: "scan", element: <Scan /> }`
- `Sidebar.tsx` nav 新增「扫描复核」入口（pulse dot 显示 review_pending 数量）
- `lib/scan.ts` 加 4 个新 invoke wrapper (`getScanKpis` / `listScanReviewQueue` / `dismissReviewItem` / `acceptReviewCandidate`) + 1 个 `fetchReviewCandidates`
- `lib.rs` `generate_handler!` 注册 4 新命令
- `commands.rs::apply_ingest_result` 末尾加 `INSERT OR REPLACE INTO scan_review_queue ...` 分支
- `commands.rs::bind_metadata` 成功路径末尾 `DELETE FROM scan_review_queue WHERE game_id = ?`
- `commands.rs::clear_all_data` 增 `DELETE FROM scan_review_queue`

</code_context>

<specifics>
## Specific Ideas

- KPI 4 联视觉：mono uppercase 标签 + 大号数字（参考 Stats.tsx KPI 卡），4 列 grid
- 左栏「实时日志」语义：mono 单行，时间 hh:mm:ss + 路径或 game id；不是 toast，纯滚动列表
- 候选对比卡里如果 Bangumi 没拉到 summary 字段，就把 candidate.alias join("、") 当作 "alias preview" 占位（已有数据，不再多请求）
- ReviewQueue 项卡片折叠时只显示：缩略封面 50×66 + 名称 + 路径 mono 小字 + 当前 confidence pill + 「展开候选」按钮；展开后 2 列 Bangumi/VNDB 对比 + 「采用」+「手工 ID 绑定」+「不再提示」操作
- KPI「待复核」chip 在 sidebar nav 上做小 badge，提示用户去 `/scan` 处理
- KPI refresh 策略：mount + `meta-fetch-progress.phase==='finished'` 节流 1s + 用户 dismiss/accept 之后立即刷
- 候选拉取的「未找到匹配」fallback：直接显示 「调用 MetadataPicker 手工绑定」按钮，复用既有 dialog

</specifics>

<deferred>
## Deferred Ideas

- 候选 AI 辅助评分 / 标签推荐（v1.4+）
- review queue 批量 accept（先看用户实际行为）
- 历史已 dismiss 但用户后悔 restore（暂不需要，dismiss 即彻底放弃）
- 跨多个 root 的 scan_root 维度 KPI（不必拆解，全局 4 联够用）
- `/scan` 页本身的虚拟化（< 50 项典型，CSS 滚动足够）

</deferred>
