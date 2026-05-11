# Phase 12: Scan Pipeline & Review Queue — Summary

**Phase:** 12
**Status:** Implemented — backend + frontend committed, real-app smoke deferred to Phase 15 (VER)
**Completed:** 2026-05-12
**Plans completed:** 12a → 12b → 12c → 12d (4/4)

## What shipped

### 12a — Schema v9 migration (`91ec1f7`)

- New migration `0009_add_scan_review_queue.sql` — single new table
  `scan_review_queue (game_id PK ref games(id) ON DELETE CASCADE, game_path,
  current_confidence, suggested_source, suggested_id, created_at)` + index
  `idx_scan_review_queue_created`. `schema_version → 9`.
- `db.rs` registers `V9_SQL` + new migration test
  `migrations_v9_adds_scan_review_queue` asserts table/index/CASCADE/version
  bump.

### 12b — Backend IPCs + ingest/bind integration (`df5337d`)

- Private helpers in `commands.rs`:
  - `sync_review_queue_for_game(pool, id, path, source, confidence)` — INSERT
    OR REPLACE on low-confidence (or `none`) ingest; otherwise DELETE stale row.
  - `delete_from_review_queue(pool, id)` — shared by `bind_metadata` success
    path + `dismiss_review_item` IPC.
- `apply_ingest_result` calls `sync_review_queue_for_game` after staff/tags
  write so every ingest outcome is reflected in the queue.
- `bind_metadata` success path calls `delete_from_review_queue` (manual bind
  = confidence 100, no review needed).
- `clear_all_data` table list now explicitly includes `scan_review_queue`.
- 5 new IPC commands (registered in `lib.rs`):
  - `get_scan_kpis` → 4 COUNT queries combined in one round-trip
  - `list_scan_review_queue` → joins `games` so the UI has name + cover_path
  - `dismiss_review_item(game_id)`
  - `accept_review_candidate(game_id, source, source_id)` — thin alias over
    `bind_metadata`; queue auto-cleans via the existing success-path delete.
  - `fetch_review_candidates(game_id)` → `tokio::join!` Bangumi + VNDB
    `search`; returns top-1 per source as `ReviewCandidates`.
- `cargo build --lib` + `cargo test --lib` (61 tests) green.

### 12c — Frontend invoke wrappers (`6f4045c`)

- `src/lib/scan.ts` extended with `ScanKpis` type + `getScanKpis()`.
- `src/lib/scanReview.ts` (new) — types `ReviewItem` / `ReviewCandidates` +
  4 wrappers (`listScanReviewQueue` / `dismissReviewItem` /
  `acceptReviewCandidate` / `fetchReviewCandidates`).
- `pnpm tsc --noEmit` clean.

### 12d — `/scan` route + components + sidebar nav (`faf9cb2`)

- `src/routes/Scan.tsx` — new page; PageHeader (增量扫描 / 全量扫描 / 取消
  actions), KPI strip (4 cards, span-3 each in 12-col grid; 待复核 card
  highlighted brand-tinted when count > 0), 12-col body split 5 (ScanFeed) +
  7 (ReviewQueue), reuses `ScanProgressBar`.
- `src/components/library/ScanFeed.tsx` (new) — rolling 200-line live log
  subscribed to `scan-progress` + `meta-fetch-progress`; resolves
  `meta-fetch-progress.game_id` to a display name via a memoized map from
  `useLibraryStore.games`; mono 11px lines, newest on top; 3 dot variants
  (scan / meta / terminal).
- `src/components/library/ReviewQueue.tsx` (new) — list view of queued items
  with 50×66 thumbnail + path + confidence pill + chevron; lazy fetch dual-
  source candidates on expand; Bangumi vs VNDB side-by-side
  `CandidateCard`s (60×80 cover + serif title + aliases + release_date +
  3-line summary clamp + external link + 采用 button); footer actions 手工
  绑定… (opens existing `MetadataPicker`) + 不再提示 (dismiss); optimistic
  removal; reconcile via `listGames` after accept; debounced refetch on
  scan/meta events.
- `src/components/layout/Sidebar.tsx` — new `扫描复核` nav item with
  brand-tinted count pill (`badge` prop on `SidebarRow`) showing
  `review_pending`; sidebar subscribes to events for live updates.
- `src/router.tsx` — adds `{ path: "scan", element: <Scan /> }`.
- `pnpm tsc --noEmit` + `pnpm build` clean (708.80 kB JS gzip 213.51 kB
  vs 776 kB pre-Phase-12; bundle delta within noise).

## Decisions logged

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 一张表 `scan_review_queue` (PK game_id) | INSERT OR REPLACE keeps a single most-recent entry per game; CASCADE keeps queue in sync with games delete | ✓ Good |
| 入队 trigger 在 `apply_ingest_result` 末尾 | 任何 ingest 路径（scan/refresh/backfill）走同一处，省去多点维护 | ✓ Good |
| `accept_review_candidate` 仅是 `bind_metadata` 别名 | 复用既有逻辑（cover cache、staff/tags 写、queue 清理），保持 IPC 表面对应 UI 语义 | ✓ Good |
| 候选拉取在用户展开时才发请求 | 节省限速器配额；列表渲染 100% 命中本地 DB join | ✓ Good |
| `/scan` 复用 layout-route + 既有 Sidebar | 简化实现；用户从 sidebar 进入即可，无独立 layout 维护 | ✓ Good — 真机验证时确认 sidebar 不影响 |
| Sidebar pulse-dot 用 brand-tinted count pill 而非红点 | 视觉与既有 count chip 一致，避免重复样式系统 | ✓ Good |

## Issues encountered

- `text-brand-fg` 不存在；tailwind tokens 中是 `brand.on` → 用 `text-brand-on`
- 候选拉取 fallback：source 失败 / 0 hits 时 `ReviewCandidates.bangumi|vndb` 为 null，前端渲染 dashed "未找到匹配" 占位，引导用户点 「手工绑定…」 进 MetadataPicker

## Tech debt created

- ReviewQueue 列表与 KPI 在 200-game backfill 期间会触发 debounced 600ms 重读；如果用户反馈"撑到 1000+ 游戏卡顿"可改为只在终态事件后重读
- ScanFeed 不持久化（重启 app 清空）；现阶段是 session log 语义，不需要 history view —— 留作未来 enhancement
- 候选 AI 辅助评分推荐未做；用户使用一段时间后视反馈决定 v1.4 是否纳入

## Verification Status

**Code:**
- `cargo test --lib` 61 passed (含新增 `migrations_v9_adds_scan_review_queue`)
- `cargo build --lib` 绿
- `pnpm tsc --noEmit` 绿
- `pnpm build` 绿（708.80 kB JS gzip 213.51 kB；CSS 57.55 kB）

**Real-app smoke:** Deferred to Phase 15 VER per autonomous-mode policy.
Verification matrix to cover during Phase 15:
1. 触发 incremental scan → 低 confidence 游戏自动出现在 `/scan` 右栏
2. 重启 app → 队列保留
3. 展开队列项 → 看到 Bangumi vs VNDB 候选并排（或空 fallback）
4. 点「采用 Bangumi」→ 卡片消失 + games.name/cover 刷新 + KPI 重计
5. Sidebar pulse-dot 数字跟随队列变化
6. 触发 `bind_metadata` 通过 MetadataPicker → 队列条目自动消失
