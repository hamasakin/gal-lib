---
id: 260515-prog
slug: prog-incremental-scan
description: 扫描流程区分"扫目录/抓元数据"两阶段 + 渐进式刷新游戏列表
date: 2026-05-15
status: complete
---

# Quick Task 260515-prog — PLAN

## 用户诉求

1. 全量扫描时，UI 文案要区分「扫描目录」和「刷新元数据」两个阶段，方便辨认当前在做什么；
2. 期望扫描到一个 exe 就立刻在游戏列表里出现，元数据 enrich 完后再原地更新；现在必须等所有目录全部扫完且元数据全部抓完才一次性 refresh，目录量大时体验差。

## 现状摸底

后端：
- `scan::run_scan`：走目录、找 exe，发 `scan-progress`(Running) 事件，**只携带 status，不区分阶段**；
- `commands::start_scan`：discovery 结束 → 批量 INSERT placeholder（带 `metadata_source=NULL`，`GameCard` 已能渲染成「获取中」） → 并发 enrich，每条完成发 `scan-progress` + `meta-fetch-progress`；
- 终止事件 `Completed/Cancelled/Failed` 由 `start_scan` 发，不发 `games-changed` 之类事件。

前端：
- `Library.tsx` 仅在 `scanProgress.status === "completed"` 边沿触发 `refetchGrid()`，全程中间不刷新；
- `ScanProgressBar.tsx` 文案统一是「扫描中 — {dir}」；
- `ScanFeed.tsx` 同样不区分阶段。

## 实施方案

**后端**
1. `scan/types.rs` 加 `ScanPhase { Discovering, Enriching }`，`ScanProgress` 加 `phase` 字段；
2. `scan/mod.rs::run_scan` 所有 emit 带 `Discovering`；
3. `commands.rs::start_scan` 阶段切换点：先 emit 一次 Enriching transition，再做 placeholder INSERT 循环（每行 emit `games-changed`），enrich 任务 UPDATE 完成后再 emit `games-changed`；所有 scan-progress 带 `Enriching`；
4. `commands.rs::refresh_metadata_smart` 同步加 `phase: Enriching` + 每行 UPDATE 后 emit `games-changed`。

**前端**
5. `lib/scan.ts` `ScanProgress.phase` 类型同步 + 新增 `onGamesChanged()`；
6. `ScanProgressBar.tsx`：`running + discovering` → 「扫描目录中 — {dir}」；`running + enriching` → 「获取元数据 — {dir}」；终止事件不变；
7. `ScanFeed.tsx`：在 discovering→enriching 切换处插一条 `── 目录扫描完成 · 开始抓取元数据（共 N 款）` 分隔；enriching 阶段的 scan-progress 行不再 push（让 `meta-fetch-progress` 用游戏名替它说话），避免 200 行 buffer 被填爆；
8. `Library.tsx` 订阅 `games-changed`，600ms 节流（trailing fire）调 `refetchGrid + refreshSidebar`；保留 completed 边沿那一次完整 refresh（含 filterOptions + toast）。

## 验证

- `cargo check`：通过（5 个原有 warning，无新增）；
- `cargo test --lib scan::`：16/16 通过；
- `pnpm tsc -p tsconfig.json --noEmit`：通过；
- 启动 `pnpm tauri dev` 走一次大目录全量扫描，肉眼确认：
  - 进度条 / 实时日志阶段文案切换正确；
  - 扫描目录阶段每发现一条 placeholder，主界面卡片即时出现「获取中」；
  - 元数据 enrich 阶段每完成一条，卡片标题/封面就近原地更新。
