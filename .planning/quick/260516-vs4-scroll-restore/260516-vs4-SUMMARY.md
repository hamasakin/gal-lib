---
phase: quick-260516-vs4
plan: 01
subsystem: library-route
tags: [scroll-restore, zustand, react-virtual, ux]
requires: []
provides:
  - "useLibraryStore.libraryScrollTop — 会话内持久化的列表页 scrollTop"
  - "Library 路由卸载快照 / 挂载恢复滚动位置"
affects:
  - src/store/library.ts
  - src/routes/Library.tsx
tech-stack:
  added: []
  patterns:
    - "cleanup-only useEffect 在组件卸载一刻快照状态到全局 store（避免 scroll 高频写）"
    - "双 requestAnimationFrame 延后写 scrollTop，等虚拟列表 totalHeight 撑起 scrollHeight"
key-files:
  created: []
  modified:
    - src/store/library.ts
    - src/routes/Library.tsx
decisions:
  - "滚动位置存全局 Zustand store 而非组件 state：Library 导航到 Detail 时整体卸载，组件内 state 全失"
  - "不引入 persist 中间件：位置仅会话内存活，App 重启回顶部是可接受/预期行为"
  - "恢复用双 rAF 而非单 rAF：网格视图首帧 scrollHeight 不足，过早写 scrollTop 会被浏览器夹回"
metrics:
  duration: "~6m"
  completed: "2026-05-16"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 2
status: checkpoint-pending
---

# Quick 260516-vs4: 列表页滚动位置恢复 Summary

从详情页返回游戏库列表页时，自动恢复进入详情页之前的滚动条位置（网格与列表视图均生效）；首次进入仍停在顶部。

## What Was Built

把 Library 路由的滚动位置存入 Zustand `useLibraryStore`（跨组件卸载存活）。Library 与 Detail 是 HashRouter 的兄弟路由，导航到详情页时 `<Library/>` 整体卸载、组件内 state 全部丢失。新增的快照/恢复机制：

- **Task 1** — `src/store/library.ts`：`LibraryState` 新增 `libraryScrollTop: number`（默认 0，带 JSDoc 解释为何放全局 store 与为何不持久化到磁盘）和 setter `setLibraryScrollTop`，沿用文件现有单 `create()` + shallow setter 风格。
- **Task 2** — `src/routes/Library.tsx`：
  - 取 setter `setLibraryScrollTop`（仅 setter 响应式订阅；saved 值在恢复 effect 内用 `getState()` 一次性读取，避免无谓 re-render）。
  - 卸载快照 effect（deps `[]`）：cleanup 内读一次 `scrollContainerRef.current?.scrollTop` 写进 store —— 用 cleanup 而非 scroll 监听，避免高频滚动每帧写 store。
  - 挂载恢复 effect（deps `[]`）：`saved <= 0` 早退保持顶部；否则嵌套两层 `requestAnimationFrame` 延后写 `scrollTop`（第一帧等 GameGrid ResizeObserver 测出 columnCount、virtualizer 算出 totalHeight 撑起 scrollHeight，第二帧再写，否则会被不足的 scrollHeight 夹回）；cleanup 里 `cancelAnimationFrame` 两个 rAF id。
  - 未改动 GameGrid / GameList / useSmoothWheel —— `@tanstack/react-virtual` 读原生 `scrollTop` 派发的 scroll 事件更新 virtualItems，直接写 `el.scrollTop` 即可恢复；useSmoothWheel 的 `target` 惰性初始化且仅首次 wheel 才重对齐，恢复 scrollTop 与平滑滚动不冲突。

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | 给 library store 增加 libraryScrollTop 持久化 slice | d392501 | src/store/library.ts |
| 2 | Library 卸载前快照、挂载后恢复 scrollTop | 5fb0e93 | src/routes/Library.tsx |
| 3 | checkpoint:human-verify（blocking） | — | 待人工验证 |

## Verification

- `npx tsc --noEmit -p tsconfig.json` — Task 1 后通过，Task 2 后通过（EXIT=0）。
- 网格 / 列表视图实机滚动恢复 + 重启回顶部 + 滚轮无冲突 —— 属 Task 3 blocking 人工验证项，未自动化。

## Deviations from Plan

None - plan executed exactly as written.

**Worktree base 修正（非偏离，环境处理）**：worktree HEAD 初始基于 `b3ec840`，不含计划提交 `87cac86`（pre-dispatch plan）。按 `<worktree_branch_check>` 规程在确认 HEAD 处于 per-agent 分支后 `git reset --hard 87cac86` 修正基底。先前另一 worktree 留下的未提交 `src-tauri/Cargo.toml` 改动因此不在工作区 —— 与本任务无关，按约束本就不应触碰。

## Checkpoint Status

Task 3 是 `checkpoint:human-verify`（`gate="blocking"`）。Task 1、2 已完成并提交，执行在 Task 3 暂停，等待人工按以下步骤验证：

1. `npm run tauri dev` 启动应用，进入游戏库（确保库里游戏足够多能滚动）。
2. 网格视图：向下滚到中段，点开某游戏进入详情页。
3. 详情页点返回 / 后退回到列表页 —— 列表应恢复到刚才的滚动位置。
4. 顶部 ViewToggle 切「列表视图」，重复 2-3，确认列表视图也恢复。
5. 完全重启应用，首次进入列表页应停在顶部。
6. 恢复后立刻用滚轮滚动，确认平滑滚动正常、不会瞬间跳回。

Resume signal：输入 "approved" 或描述异常。

## Self-Check: PASSED

- FOUND: src/store/library.ts（已修改，含 `libraryScrollTop`）
- FOUND: src/routes/Library.tsx（已修改，含 snapshot + restore effects）
- FOUND: commit d392501
- FOUND: commit 5fb0e93
