---
phase: quick-260519-oh9
plan: 01
subsystem: scan-ui
tags: [ui, scan-page, frontend]
requires: []
provides:
  - "ReviewQueue 待复核列表块内滚动（有界高度）"
  - "Scan 页 3 卡 KPI 条 + 合并无匹配数的 delta 文案"
affects:
  - src/components/library/ReviewQueue.tsx
  - src/routes/Scan.tsx
tech-stack:
  added: []
  patterns:
    - "基于视口的 max-h-[calc(100vh-Npx)] 给 flex 子区赋有界高度，让内部 overflow-y-auto 接管滚动"
key-files:
  created: []
  modified:
    - src/components/library/ReviewQueue.tsx
    - src/routes/Scan.tsx
decisions:
  - "max-height 取 calc(100vh-280px)，与左栏 ScanFeed 视口受限高度视觉协调"
  - "保留 KpiCard 的 tone?: \"muted\" 可选形参（删卡后未被调用，但可选形参不报错，无需改签名）"
metrics:
  duration: ~3min
  completed: 2026-05-19
  tasks: 2
  files: 2
---

# Phase quick-260519-oh9 Plan 01: 扫描页两项 UI 改进 Summary

`/scan`「扫描复核」页两项纯前端改进：ReviewQueue 待复核列表加视口受限 max-height 让其在块内滚动而非撑长整页；KPI 条由 4 卡收敛为 3 卡，无匹配数并入「待复核」卡 delta 副行。运行时行为与 KPI 数值口径零变化。

## Tasks Completed

### Task 1: ReviewQueue 加 max-height 让列表块内滚动
- 在 ReviewQueue 根 div className 追加 `max-h-[calc(100vh-280px)]`，`h-full` 与 `min-h-[420px]` 保留。
- 根 div 拿到有界高度后，其内部既有的 `flex-1 overflow-y-auto` 列表区自然在块内接管滚动 —— 待复核条目超长时不再撑长整个 `/scan` 页。
- 列表区、数据逻辑、事件订阅（scan-progress / meta-fetch-progress / reseedSeq）、采用-不再提示-手工绑定流程、MetadataPicker 渲染均未改动。
- **Commit:** 3fe09c6

### Task 2: Scan 页 KPI 条 4 卡并 3 卡 + 合并 delta 文案
- 删除独立的「无匹配」KpiCard（含 `tone="muted"`）。
- 「待复核」卡 delta 改为同时反映 unmatched：`unmatched > 0` 时显示「其中 N 项无匹配 · 需人工确认」，`unmatched === 0` 时回退原逻辑（`reviewPending > 0 ? "需要人工确认" : "队列已清空"`）；`highlight={reviewPending > 0}` 保留。
- `KpiCard` 组件 `gridColumn` 由 `span 3 / span 3` 改为 `span 4 / span 4`，3 张卡均匀铺满 12 列网格。
- `unmatched` 变量保留并继续读取（现用于待复核卡 delta），PageHeader 的 `sub` 文案对 `unmatched` 的引用保持不动。
- 后端 `get_scan_kpis` / `ScanKpis` 类型零变化。
- **Commit:** f5ee6ba

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npx tsc --noEmit` —— Task 1 后通过、Task 2 后通过（EXIT 0，无类型报错）。
- 两项改动均为纯前端，未触碰 `src-tauri/` 与 `src/lib/scan.ts`。
- KPI 数值来源（getScanKpis / ScanKpis）零变化，仅卡片数量与 delta 文案调整。
- ReviewQueue 数据逻辑 / 事件订阅 / 采用-不再提示-手工绑定流程完全不变。

## Self-Check: PASSED

- FOUND: src/components/library/ReviewQueue.tsx (modified)
- FOUND: src/routes/Scan.tsx (modified)
- FOUND: commit 3fe09c6
- FOUND: commit f5ee6ba
