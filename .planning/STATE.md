---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Scan Pipeline & Person Polish
status: shipped
stopped_at: "v1.3 milestone shipped + archived (2026-05-12). 下一步: `/gsd-cleanup` 归档 phase 目录 → `/gsd-new-milestone` 定义 v1.4 (first task: 12-step walkthrough)。"
last_updated: "2026-05-12T09:00:00.000Z"
last_activity: "2026-05-12 — v1.3 milestone close: roadmap + requirements archived to milestones/v1.3-*.md；ROADMAP.md collapsed；PROJECT.md updated；git tag v1.3 pending."
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

## Session Continuity

Last session: 2026-05-12T08:30:00Z
Stopped at: Phase 15 完成（verification-only）。下一步: `/gsd-audit-milestone v1.3` 跑 12 条 walkthrough；通过后 `/gsd-complete-milestone` + `/gsd-cleanup`。
Resume file: `.planning/phases/15-v12-real-app-smoke/15-SUMMARY.md` (含完整 walkthrough)
