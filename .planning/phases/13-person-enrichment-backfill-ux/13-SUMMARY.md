---
phase: 13
name: Person Enrichment & Backfill UX
milestone: v1.3
status: complete
completed_at: "2026-05-12"
requirements: [PER-01, PER-02, PER-03, PER-04, POL-03]
plans_completed: [13a, 13b, 13c, 13d, 13e]
commits:
  - 93409c9 feat(13a): PER-01 cross-source person dedup (query layer)
  - c18bc90 feat(13b): PER-02 PersonTimeline component on /persons/:id
  - 36cb5ac feat(13c): PER-03 list_co_staff_for_person + CoStaffStrip
  - a7f627c feat(13d): PER-04 portrait cache backend + UI
  - 038fdd0 feat(13e): POL-03 backfill progress bar + cancel
---

# Phase 13: Person Enrichment & Backfill UX — Summary

## What shipped

把 `/persons/:id` 从「单 grid」升级到完整人物聚合页 + 给 Library 加 backfill 进度条。

### 13a — PER-01 cross-source person dedup (query layer)

**Files:**
- `src-tauri/src/commands.rs` — 新 `PersonSourceRef` struct；`GameStaffRow` 增 `sources: Vec<PersonSourceRef>` + `person_ids: Vec<i64>` 字段；新 `merge_persons(rows)` reduce；`list_persons_for_game` 末尾调用 + SQL ORDER 增 `source ASC` 让 Bangumi 优先；4 个 fixture 单元测试。
- `src/lib/persons.ts` — 新 `PersonSourceRef` interface；`GameStaffRow` 增 `sources` / `person_ids`。
- `src/routes/Persons.tsx` — identity 派生改用 `person_ids.includes(personId)`（兼容 VNDB-id URL 命中 merged Bangumi 代表）；voice character-name 查询同步调整；PageHeader sub 改为 `sourceLabel()` 显示「BANGUMI + VNDB · 共参与 N 部作品」。

**Key decision:** dedup 只在 IPC 查询层做归并，不动 persons 表 schema/不迁移 game_staff FK；merge key = `(LOWER(TRIM(name)), role, LOWER(TRIM(character_name)))`；name_cn 走「whichever has it wins」；Bangumi 优先作为代表 source/source_id/id。

### 13b — PER-02 PersonTimeline component

**Files:**
- `src/components/library/PersonTimeline.tsx` (新) — 横向年份气泡 strip；气泡 diameter = sqrt(playtime_hours + 1) 映射到 8..28 px；同年作品垂直堆叠；release_year 缺失归到 "—" bucket；hover Tooltip 显示 name + playtime + 通关状态（reuse shadcn Tooltip）。
- `src/routes/Persons.tsx` — `mergedGames` useMemo 跨 role dedup；4 role section 之上插入 `<PersonTimeline games={mergedGames} />`。

**Visual:** scrollbar-thin + scroll-snap-x proximity；空数组渲染单行空状态文字。

### 13c — PER-03 Co-staff IPC + CoStaffStrip

**Files:**
- `src-tauri/src/commands.rs` — 新 `CoStaffRow` struct + `list_co_staff_for_person(person_id, limit?)` IPC；SQL JOIN game_staff × game_staff 求共现 game 数；HAVING coshare >= 2；相关子查询求 role_hint；LIMIT 默认 12 / 上限 50。
- `src-tauri/src/lib.rs` — 注册 handler。
- `src/lib/persons.ts` — 新 `CoStaffRow` interface + `listCoStaffForPerson()` wrapper。
- `src/components/library/CoStaffStrip.tsx` (新) — 横滑条 PersonCard（40px monogram + name + role hint + 「共 N」chip）；点击跳 `/persons/:id`；空结果时整组件隐藏。
- `src/routes/Persons.tsx` — 在 role section 之后挂 `<CoStaffStrip personId={personId} />`。

### 13d — PER-04 Portrait cache backend + UI

**Files:**
- `src-tauri/src/portrait_cache.rs` (新模块) — cache-first 解析 `data/portraits/{source}-{source_id}.{ext}`；缓存 miss 时调 Bangumi `/v0/persons/{id}` 取 `images.medium`，下载后写盘；走 `metadata::limiter::wait_bangumi`；3 个单元测试覆盖 ext_for + lookup_cached。
- `src-tauri/src/lib.rs` — `mod portrait_cache;` + 注册 `get_or_fetch_portrait` handler。
- `src-tauri/src/commands.rs` — 新 `get_or_fetch_portrait(source, source_id) -> Option<String>` IPC；`clear_all_data` 增 `portraits` 子目录清理。
- `src/lib/persons.ts` — `getOrFetchPortrait()` wrapper。
- `src/routes/Persons.tsx` — `useEffect` 在 identity ready 后 fetch 自身 portrait；PageHeader actions 渲染 56px 圆形头像（缺失则首字 monogram fallback）。
- `src/components/library/CoStaffStrip.tsx` — 每张 PersonCard avatar 槽位 lazy fetch portrait，便携式 monogram 兜底。

**Scope simplification:** 本 phase 只支持 Bangumi portrait；VNDB-source persons 直接返回 None（v1.4 再加 VNDB GraphQL 补全）。

### 13e — POL-03 Backfill progress UI

**Files:**
- `src-tauri/src/commands.rs` — 新 `BackfillState` struct (AtomicBool cancel)；`backfill_metadata_enrichment` 启动时 reset cancel + emit `meta-fetch-progress-meta {total}`；循环 top 每 iter check cancel；完成 / 取消时 emit `meta-fetch-progress-meta {done|cancelled}`；每条 `meta-fetch-progress` 携带 `name`；新 `cancel_backfill` IPC。
- `src-tauri/src/lib.rs` — `.manage(BackfillState::new())` + 注册 `cancel_backfill` handler。
- `src/lib/persons.ts` — 新 `cancelBackfill()` wrapper + `MetaFetchProgressMeta` / `MetaFetchProgress` types。
- `src/components/library/BackfillProgressBar.tsx` (新) — 镜像 ScanProgressBar 的视觉语言：2px 渐变条 + mono 状态行 +「取消」按钮（AlertDialog 确认）；监听 meta + per-game 两条事件流；终态后 5s 自动隐藏。
- `src/routes/Library.tsx` — `import { BackfillProgressBar }`；在 PageHeader 与 ActiveSessionBar 之间挂载。

## Acceptance

| Plan | cargo build --lib | cargo test --lib | pnpm tsc --noEmit | pnpm build |
|------|-------------------|------------------|-------------------|------------|
| 13a  | ✅                | ✅ 4/4 merge tests | ✅               | (整体)     |
| 13b  | n/a               | n/a              | ✅                | (整体)     |
| 13c  | ✅                | ✅               | ✅                | (整体)     |
| 13d  | ✅                | ✅ 3/3 portrait tests | ✅            | (整体)     |
| 13e  | ✅                | ✅               | ✅                | (整体)     |
| 全 phase | ✅            | ✅ 68/68 lib tests | ✅              | ✅ 3.11s   |

## Out of scope (locked in CONTEXT.md / 推到 v1.4)

- 跨源 persons 物理合并（迁移 game_staff FK）— PER-01 查询层归并已足够
- VNDB portrait 抓取 — Bangumi /v0/persons 已稳定，VNDB GraphQL person query 留到 v1.4
- 完成度 chip（"5 部 / 已通关 3 / 47 h"）— v1.4
- co-staff 复杂权重（voice ↔ scenario 的 affinity）— 现阶段 count ≥ 2 朴素阈值

## Real-app smoke (deferred to Phase 15)

PER-01/02/03/04 + POL-03 的真机走查（含 Bangumi portrait 实际首次抓取、cancel_backfill 实际打断 in-flight HTTP、co-staff strip 在大库下渲染密度）一并推迟到 Phase 15 与 v1.2 VER-01/02/03 一同 smoke。Phase 13 commit 内已锁定 success criteria 对应的代码 / 类型，自动化（cargo test + tsc + build）已覆盖正常路径。
