---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Scan Pipeline & Person Polish
status: shipped
stopped_at: "v1.3 milestone shipped + archived (2026-05-12). 下一步: `/gsd-cleanup` 归档 phase 目录 → `/gsd-new-milestone` 定义 v1.4 (first task: 12-step walkthrough)。"
last_updated: "2026-05-15T00:00:00.000Z"
last_activity: "2026-05-15 — Quick 260515-loading-phase: 修三个刷新元数据 loading 视觉 bug — fetchingMetaIds 加 phase 区分 in_flight / awaiting_refetch；刷新期 rest 按 last_scanned_at DESC 排序。"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 16
  completed_plans: 16
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-12 with Current Milestone v1.3)

**Core value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆——并且每张卡片背后都有充实的元数据
**Current focus:** v1.3 Scan Pipeline & Person Polish — 清掉 v1.1/v1.2 累积 carry-over

## Current Position

Phase: 12 ✅ · 13 ✅ · 14 ✅ · 15 ✅ (verification-only)
Plan: 全部完成；下一步 /gsd-audit-milestone v1.3
Status: 4/4 phases shipped；自动化全绿；real-app walkthrough 清单交付待 audit
Last activity: 2026-05-12 — Phase 15 close：cargo build + test (68/68) + tsc + pnpm build 全绿，15-SUMMARY 含 12 条 walkthrough (V-01..V-12)

## Carried Tech Debt → v1.3 (folded into requirements)

Items deferred or carried at v1.2 close — 已映射到 v1.3 requirements，详见 `.planning/REQUIREMENTS.md`：

| Category | Item | Origin | Mapped REQ |
|----------|------|--------|------------|
| verification | UI-01 Detail summary/staff/外链 real-app smoke | Phase 11 deferred | VER-01 |
| verification | UI-02 人物 chip + 官方标签 region real-app smoke | Phase 11 deferred | VER-02 |
| verification | UI-03 FilterPanel 多维 facet real-app smoke | Phase 11 deferred | VER-03 |
| feature | 跨源人物去重 (Bangumi+VNDB) | Phase 11 carry | PER-01 |
| feature | 人物聚合页加强（时光轴 + 同台伙伴） | seeds/persons-page-enrichment.md | PER-02, PER-03 |
| feature | 人物头像本地缓存 | Phase 11 carry | PER-04 |
| feature | Backfill 进度 UI 完整化 | Phase 11 carry | POL-03 |

## Carried from v1.1 (folded into v1.3)

| Category | Item | Status | Mapped REQ |
|----------|------|--------|------------|
| requirement | LIB-02 杂志式不对称网格回归或废止 | Phase 7 reverted | POL-04 |
| requirement | PGE-01 standalone /scan + KPI strip | Phase 9 deferred | SCAN-01, SCAN-02 |
| requirement | PGE-02 Bangumi/VNDB review queue | Phase 9 deferred | SCAN-03 |
| feature | Detail 「打开目录」按钮 | Phase 8 carry | FS-01, FS-02 |
| feature | Screenshots 「打开截图目录」按钮 | Phase 10 carry | FS-01, FS-03 |
| feature | Detail `?tab=` deeplink 解析 | Phase 10 carry | POL-01 |
| metric | 真实会话总数 IPC | Phase 9 carry | POL-02 |
| copy | UIPreferences.tsx:135 stale "Phase 5" hint | Phase 4 carry | 可在任一执行 phase 顺手清除（非独立 req） |

## Carried from v1.0 (still open)

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| verification | Phase 01-05 GUI/integration items requiring real-machine QA | human_needed | v1.0 close |

**Resolution path:** Real-machine QA pass on clean Win10/Win11 environment with Locale Emulator + a real galgame library installed. 在 v1.3 VER-01/02/03 真机 smoke 期间可顺带覆盖 v1.0 GUI 项。

## Pending Todos

None.

## Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 20260510 | 修复 4 个 UI 问题（人物 chip 跳错 / FilterPanel UNDEFINED + 透明 / 侧边栏品牌限高 / Detail 更多菜单补全） | 2026-05-10 | 86a5f33 | [20260510-ui-fixes-detail-cards-filter-brands](./quick/20260510-ui-fixes-detail-cards-filter-brands/) |
| 20260510b | R18/全年龄 标识 + 自定义视图（schema v8、7 个新命令、网格批量选择模式） | 2026-05-10 | 68afa62 | [20260510b-r18-marker-and-custom-views](./quick/20260510b-r18-marker-and-custom-views/) |
| 20260512 | 封面 cache-buster — bind/refresh 后前端立即显示新封面（4 处 convertFileSrc 加 ?v=last_scanned_at） | 2026-05-12 | 2cd17b8 | [20260512-cover-cache-buster](./quick/20260512-cover-cache-buster/) |
| 20260512c | MetadataPicker 遮罩加深 + Bangumi infobox 发售日兜底 + reseed_review_queue IPC + Scan 页按钮 | 2026-05-12 | f38d4a6 | [20260512c-picker-overlay-year-fallback-reseed-review](./quick/20260512c-picker-overlay-year-fallback-reseed-review/) |
| 20260512d | alert-dialog overlay 同步加深 + match_score 前缀包含 baseline 80（修复 アマエミDL版 等短前缀场景不自动绑） | 2026-05-12 | 8b717e2 | [20260512d-overlay-followup-prefix-confidence](./quick/20260512d-overlay-followup-prefix-confidence/) |
| 20260512e | main overflow-hidden 修双滚动条 + Sidebar 去掉与 FilterPanel 重复的品牌/年份 + 次要导航底部固定 | 2026-05-12 | d8e7d7e | [20260512e-sidebar-redesign-outer-scrollbar](./quick/20260512e-sidebar-redesign-outer-scrollbar/) |
| 20260512f | Sidebar 视觉打磨（印章红短线 section / active 左缘 / hover ⋯）+ ViewNameDialog/DeleteViewDialog 替换 prompt/confirm | 2026-05-12 | 81189a5 | [20260512f-sidebar-polish-and-view-dialogs](./quick/20260512f-sidebar-polish-and-view-dialogs/) |
| 20260512g | 修复 isFilterEmpty 漏检 custom_view_id / age_ratings — 选自定义视图后列表回退全库的 bug | 2026-05-12 | 2fc5e6e | [20260512g-fix-isfilterempty-custom-view](./quick/20260512g-fix-isfilterempty-custom-view/) |
| 260513-2nx | 新增 backfill_release_year IPC + Settings「补全发行年份」按钮；移除旧 backfill_metadata_enrichment 整套代码 | 2026-05-12 | dd06714 | [260513-2nx-year-backfill-replace-enrich](./quick/260513-2nx-year-backfill-replace-enrich/) |
| 260513-3df | Settings「扫描操作」合并为 2 个按钮（全量扫描 + 刷新元数据）；新 IPC refresh_metadata_smart 替代 refresh_all_metadata + backfill_release_year | 2026-05-12 | d2b4c41 | [260513-3df-two-button-metadata-refresh](./quick/260513-3df-two-button-metadata-refresh/) |
| 260513-404 | 彻底删除 R18/age_rating 分类 — migration 0010 DROP COLUMN + 后端 IPC/自动判定 + 前端 badge/dropdown/FilterPanel facet 全部清除 | 2026-05-12 | 776412e | [260513-404-remove-r18-age-rating](./quick/260513-404-remove-r18-age-rating/) |
| 260513-r6t | 详情页启动按钮走 LE（修复硬编码 use_le=false）+ exe 评分对 _cn/_chs/_zh 后缀 +15 + Detail exe 路径加「浏览…」按钮 | 2026-05-13 | f9e98cc | [260513-r6t-exe-cn](./quick/260513-r6t-exe-cn/) |
| 260514-upd | Tauri 自动更新 — plugin-updater 接通 GH Releases、启动 5s silent check、Settings 关于区块、release.yml CI、docs/release.md；bump 0.2.0；v0.2.0 已发布到 hamasakin/gal-lib | 2026-05-14 | 7d57bff | [260514-upd-tauri-auto-update](./quick/260514-upd-tauri-auto-update/) |
| 260515-loading-phase | 修刷新元数据三个 loading 视觉 bug — fetchingMetaIds 加 phase (in_flight/awaiting_refetch) 区分；reconcile 只清 awaiting_refetch；scanRunning 时 rest 按 last_scanned_at DESC | 2026-05-15 | d96045b | [260515-loading-phase-sort](./quick/260515-loading-phase-sort/) |

## Session Continuity

Last session: 2026-05-12T08:30:00Z
Stopped at: Phase 15 完成（verification-only）。下一步: `/gsd-audit-milestone v1.3` 跑 12 条 walkthrough；通过后 `/gsd-complete-milestone` + `/gsd-cleanup`。
Resume file: `.planning/phases/15-v12-real-app-smoke/15-SUMMARY.md` (含完整 walkthrough)
