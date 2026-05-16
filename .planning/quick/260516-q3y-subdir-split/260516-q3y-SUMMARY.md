---
phase: 260516-q3y
plan: 01
subsystem: scan / library-ui
tags: [subdir-split, scan-skip, ipc, dialog]
requires:
  - ingest_one_dir / clean_title / pick_best_exe (既有后端 helper)
  - MetadataPicker / alert-dialog (既有前端范本)
provides:
  - scan_skip_dirs 持久化跳过表 (schema v12)
  - list_subdirs / split_game_into_subdirs 两个 Tauri 命令
  - SubdirSplitDialog 对话框组件 + gameHasUserData helper
affects:
  - start_scan (existing_paths 跳过集 UNION scan_skip_dirs)
  - GameCard / GameGrid / Library / Detail / Persons (新增 onSplitSubdirs prop)
tech-stack:
  added: []
  patterns:
    - migration include_str! 注册 (db.rs v12)
    - shadcn Dialog 组件 (复用 MetadataPicker 风格)
    - 受控 game prop + onClose/onSplit 回调
key-files:
  created:
    - src-tauri/migrations/0012_add_scan_skip_dirs.sql
    - src/components/library/SubdirSplitDialog.tsx
  modified:
    - src-tauri/src/db.rs
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
    - src/lib/scan.ts
    - src/components/library/GameCard.tsx
    - src/components/library/GameGrid.tsx
    - src/routes/Library.tsx
    - src/routes/Detail.tsx
    - src/routes/Persons.tsx
decisions:
  - "持久化跳过用新建 scan_skip_dirs 表，而非复用 mark_skip_dir 的内存集合（进程重启即失效）"
  - "拆分前的用户数据删除确认放在父组件（Library/Detail），SubdirSplitDialog 只管列目录+拆分，保持单一职责"
metrics:
  duration: ~12min
  completed: 2026-05-16
  tasks: 3
  files: 11
---

# Phase 260516-q3y Plan 01: 整理子目录 (Subdir Split) Summary

为 gal-lib 新增「整理子目录」能力：把被误识别成单款游戏的品牌名父目录条目，拆分成 N 个独立游戏条目并各自走元数据匹配，原父目录写入持久化扫描跳过表。

## What Was Built

### Task 1 — 后端 (commit `92d0a09`)
- **migration 0012**：新建 `scan_skip_dirs(path PK, created_at)` 持久化跳过表，schema v12。db.rs 仿 v11 模式注册（`V12_SQL` const + `migrations()` vec 末尾追加）+ 文件头 doc 补 v11/v12 说明。
- **`SubdirEntry` struct**：`{ name, path, clean_title, exe }`，serde snake_case。
- **`list_subdirs(path)` 命令**：校验目录后用 `std::fs::read_dir` 取直接子目录，对每个子目录算 `clean_title` + `pick_best_exe`，按 name 排序返回；单项 read 错误用 `filter_map(Result::ok)` 忽略。
- **`split_game_into_subdirs(game_id, paths)` 命令**：空 paths 直接 Err；查原父目录路径；对每个 path 构造 `DiscoveredGame` 调 `ingest_one_dir`（= placeholder INSERT + 元数据匹配）；自包含路径跳过；全部成功后 `DELETE` 原父条目（scan_review_queue 经 v9 FK CASCADE 自动清）+ `INSERT OR IGNORE` 写 `scan_skip_dirs`；返回新 id 列表。
- **`start_scan` 修改**：`existing_paths` 改为 `mut`，构造后 UNION 进 `SELECT path FROM scan_skip_dirs` 的结果，全量扫描永久跳过被拆分的父目录。
- **lib.rs**：注册 `list_subdirs` / `split_game_into_subdirs`。

### Task 2 — 前端 IPC + 对话框 (commit `3ada5eb`)
- **scan.ts**：`SubdirEntry` 接口 + `listSubdirs` / `splitGameIntoSubdirs` invoke 封装。
- **SubdirSplitDialog.tsx**（新建，~290 行）：复用 MetadataPicker 的 shadcn Dialog 风格。
  - 受控 `game` prop；`currentPath` / `pathStack` / `entries` / `selected`(路径集合) / `loading` / `splitting` 状态。
  - `useEffect` 在 game 打开 / currentPath 变化时 `listSubdirs`；加载后对「有 exe 且未在 selected」的条目做默认勾选（不覆盖用户取消勾选）。
  - 每行：原生 checkbox + 目录名 + clean_title 预览（与 name 不同时）+ exe basename / 灰色「无 exe」。点目录名下钻、checkbox `stopPropagation` 只切勾选。
  - 顶部 currentPath truncate + 「返回上一层」（pathStack 栈）。
  - 「手动浏览…」用 `@tauri-apps/plugin-dialog` 的 `open({directory:true})`，去重追加 entries 并勾选。
  - 确认按钮文案随勾选数动态变化（`拆分为 N 个游戏`），0 时 disabled。
  - `gameHasUserData(g)` helper 一并导出（playtime>0 / notes / rating / favorite / status≠unplayed）。

### Task 3 — 两处入口接入 (commit `5006de9`)
- **GameCard**：新增 `onSplitSubdirs` prop；ContextMenu「重新抓取封面」下方加 `<ContextMenuSeparator/>` + 「整理子目录」项。
- **GameGrid**：`onSplitSubdirs` prop 透传到每个 GameCard。
- **Library.tsx**：`splitGame` / `splitCandidate` 双 state + `onSplitSubdirs` 回调。带用户数据先弹 AlertDialog 删除确认，无用户数据直接打开 SubdirSplitDialog；拆分成功后 `refetchGrid` + `refreshSidebar` 刷新。
- **Detail.tsx**：DropdownMenu「重新抓取封面」下方加「整理子目录」项（`FolderTree` 图标）；同样的用户数据 AlertDialog 流程；拆分成功后 `navigate("/")` 回库首页（原条目已删，Detail 的 game 失效）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Persons.tsx 补 GameCard 新增必填 prop**
- **Found during:** Task 3 — `tsc --noEmit` 报 `Property 'onSplitSubdirs' is missing`。
- **Issue:** `Persons.tsx` 也直接渲染 `GameCard`，新增的必填 `onSplitSubdirs` prop 导致类型错误。计划的 `files_modified` 未列入 Persons.tsx。
- **Fix:** 仿现有 `noopPickMetadata` / `noopRefreshCover` 加 `noopSplitSubdirs` 并传入（Persons 页右键拆分不是有意义操作，与既有 noop 一致）。
- **Files modified:** src/routes/Persons.tsx
- **Commit:** `5006de9`

## Verification

| 步骤 | 命令 | 结果 |
|------|------|------|
| Task 1 | `cd src-tauri && cargo build --lib` | 通过（仅 5 条既有 dead-code 警告，与本次改动无关） |
| Task 2 | `npx tsc --noEmit` | 通过，无错误 |
| Task 3 | `npx tsc --noEmit` | 通过，无错误（修 Persons.tsx 后） |

真机冒烟（人工，留待 milestone audit）：plan `<verification>` 列出的 5 条 walkthrough。

## Self-Check: PASSED

- FOUND: src-tauri/migrations/0012_add_scan_skip_dirs.sql
- FOUND: src/components/library/SubdirSplitDialog.tsx
- FOUND: commit 92d0a09 (Task 1)
- FOUND: commit 3ada5eb (Task 2)
- FOUND: commit 5006de9 (Task 3)
