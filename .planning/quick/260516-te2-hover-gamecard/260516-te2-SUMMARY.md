---
phase: quick-260516-te2
plan: 01
subsystem: library-ui
tags: [gamecard, favorite, hover, ui]
requires:
  - "onToggleFavorite() / updateGameFavorite IPC (既有，未改动)"
provides:
  - "GameCard 封面右上角 hover 快捷收藏按钮"
affects:
  - src/components/library/GameCard.tsx
tech-stack:
  added: []
  patterns:
    - "group-hover:opacity-100 淡入 + 独立 z-[4] / pointer-events-auto 保证按钮可点"
key-files:
  created: []
  modified:
    - src/components/library/GameCard.tsx
decisions:
  - "快捷按钮放独立 z-[4] 容器，凌驾于 z-[2] pointer-events-none hover overlay 之上"
  - "静态实心 heart 标记 hover 时 group-hover:opacity-0 淡出，避免与按钮堆叠"
  - "按钮尺寸 28px，略小于右下角 30px 启动按钮，不抢视觉焦点"
metrics:
  duration: "~5min"
  completed: "2026-05-16"
  tasks: 1
  files: 1
---

# Quick 260516-te2: GameCard hover 快捷收藏按钮 Summary

封面 hover 时右上角淡入一个圆形快捷收藏按钮，一次点击即可切换收藏状态，无需打开右键菜单或进入详情页。

## What Was Built

修改 `src/components/library/GameCard.tsx` 单文件，封面右上角区块新增 hover 快捷收藏按钮：

- **hover 显隐**：按钮默认 `opacity-0`，卡片根 div 既有 `group` class 驱动 `group-hover:opacity-100`（额外 `group-focus-visible:opacity-100` 兼顾键盘聚焦），`transition-all duration-200` 与现有 hover overlay 节奏一致。
- **两态视觉**：`game.is_favorite === true` → `bg-brand` 实心底 + `Heart fill="currentColor"`（已收藏，点此取消）；`false` → `bg-black/55 backdrop-blur` + `border-line-strong` 描边 + 空心 `Heart`（点此收藏）。按钮 28px 圆形，`shadow-lift` + `hover:scale-110`，对齐既有启动按钮风格但略小。
- **点击行为**：`onClick` 先 `e.stopPropagation()` 阻止冒泡到 `onCardClick`（否则会导航详情页），再 `void onToggleFavorite()` 复用既有函数 —— 未新写收藏逻辑、未新增 IPC。
- **层级**：按钮放独立 `z-[4]` 容器并自带 `pointer-events-auto`，凌驾于 `z-[2]` 的 `pointer-events-none` hover overlay 之上，确保可点击。
- **静态标记并存**：既有「非 hover 已收藏显示静态实心 heart」标记保留，并加 `group-hover:opacity-0`，hover 时淡出由快捷按钮接管该角落，避免堆叠。
- **选择模式抑制**：`selectMode === true` 时整个快捷按钮不渲染（与 stamp / 启动 overlay 在 select 模式下的处理一致）；静态 heart 标记的 `group-hover:opacity-0` 也在 select 模式下不施加，维持现状。
- **无障碍**：`type="button"`，`aria-label` 与 `title` 按状态切换「收藏」/「取消收藏」。

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | 封面右上角加入 hover 快捷收藏按钮 | 2b32395 | src/components/library/GameCard.tsx |

## Verification

- `tsc --noEmit` 无类型错误（EXIT 0）。
- 代码审查确认：hover 用 `group-hover:opacity-100`；按钮 `onClick` 含 `stopPropagation()` 且调用 `onToggleFavorite`；`selectMode` 为真时按钮不渲染；按钮按 `game.is_favorite` 切换实心/空心两态。
- 应用内 hover/点击/选择模式回归交互留待 `checkpoint:human-verify`（pnpm tauri dev）。

## Deviations from Plan

None - plan 中 Task 1 按原文执行。

注：plan 的 `<verify>` 指定 `pnpm exec tsc --noEmit`，但 worktree 无独立 `node_modules`，改用主仓库 `D:/project/gal-lib/node_modules/typescript/bin/tsc` 对 worktree tsconfig 运行同等检查，结果一致（EXIT 0）。此为环境适配，非代码偏差。

## Self-Check: PASSED

- FOUND: src/components/library/GameCard.tsx
- FOUND: commit 2b32395
