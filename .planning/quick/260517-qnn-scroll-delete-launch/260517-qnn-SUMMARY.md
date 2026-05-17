---
phase: quick-260517-qnn
plan: 01
subsystem: ui
tags: [tauri, react, sqlite, sqlx, scroll, locale-emulator]

requires:
  - phase: quick-260516-tzu
    provides: useSmoothWheel lerp-to-target smooth scroll model
  - phase: quick-260516-q3y
    provides: GameCard 右键菜单 + Library AlertDialog 拆分确认模式
provides:
  - useSmoothWheel 在外部滚动（拖动滚动条 / 键盘 / 程序写入）时重新同步 lerp 目标，不再回弹
  - delete_game Tauri 命令 — 删除单个游戏的所有 DB 记录（8 张 game_id 子表 + games 行），不碰磁盘
  - deleteGame invoke 包装 + GameCard 右键「删除条目」+ Library 删除确认 AlertDialog
  - Detail 启动方式收敛为两种：日区 LE 启动 / 直接启动
affects: [Library, Detail, GameCard, launch-config]

tech-stack:
  added: []
  patterns:
    - "单游戏删库：显式清 8 张 game_id 子表后删 games 行（不依赖 PRAGMA foreign_keys），磁盘文件不动"
    - "le_profile 自由 TEXT 列做启动方式哨兵：le-jp 存 Japanese / direct 存 direct，废弃值回落 le-jp"

key-files:
  created: []
  modified:
    - src/hooks/useSmoothWheel.ts
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
    - src/lib/games.ts
    - src/components/library/GameCard.tsx
    - src/components/library/GameGrid.tsx
    - src/routes/Library.tsx
    - src/routes/Persons.tsx
    - src/routes/Detail.tsx
    - src/components/library/LaunchButton.tsx

key-decisions:
  - "delete_game 显式删 8 张 game_id 子表（含 clear_all_data 未覆盖的 game_staff / game_official_tags / custom_view_games）再删 games 行，rows_affected()==0 时返回「游戏不存在」"
  - "删除确认 AlertDialog 由 Library 持有而非 GameCard — 卡片随其行删除而 unmount，会连带拆掉卡内对话框"
  - "le_profile 映射规则：只有显式 direct 哨兵算「直接启动」，其余一切值（含已删除的简中/繁中/Custom）回落「日区 LE 启动」，无需 DB migration"

patterns-established:
  - "单实体删库：子表先于父表 DELETE WHERE game_id，FK 关闭也安全；不触碰文件系统（区别于 clear_all_data）"
  - "启动方式两值 union（le-jp / direct）替代多 LE profile，持久化复用既有 le_profile TEXT 列"

requirements-completed: [QNN-01, QNN-02, QNN-03]

duration: 35min
completed: 2026-05-17
---

# Phase quick-260517-qnn: 滚动条修复 / 删除条目 / 简化启动配置 Summary

**修复网格滚动条拖动回弹、新增「删除条目」删库不删盘能力、并把 Detail 启动方式从 4 个 LE profile 收敛为日区 LE 启动 / 直接启动两种。**

## Performance

- **Duration:** ~35 min（Task 2+3 本次执行；Task 1 由前一次中断的运行完成）
- **Started:** 2026-05-17T19:37:08+08:00（Task 1，前次运行）
- **Completed:** 2026-05-17T20:12:09+08:00
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- **Task 1（前次运行）** — `useSmoothWheel` 加 `scroll` 监听，外部驱动的滚动（拖动滚动条 / 键盘 / 程序写入）会重新同步 lerp `target` 并取消正在跑的 rAF，新鲜启动时拖动滚动条不再回弹到拖动前位置。
- **Task 2** — 新增 `delete_game` Tauri 命令：清掉 8 张 `game_id` 外键子表（screenshots / save_backups / sessions / game_tags / game_staff / game_official_tags / custom_view_games / scan_review_queue）后删 `games` 行，缺失 id 返回「游戏不存在」，全程不碰文件系统。前端 `deleteGame` 包装 + GameCard 右键「删除条目」破坏性菜单项 + Library 的删除确认 AlertDialog（确认后刷新网格 + 侧边栏）。
- **Task 3** — Detail 启动方式从 4 个 LE profile（日 / 简中 / 繁中 / Custom）收敛为两种：日区 LE 启动 / 直接启动。直接启动走 `launchGame(gameId, false)` 不经 LE。旧的简中 / 繁中 / Custom 持久化值平滑回落到日区 LE 启动，无需 DB migration；删除无用的 `isCnVersionExe` 函数。

## Task Commits

每个任务原子提交：

1. **Task 1: 修复 useSmoothWheel 网格滚动条回弹** - `cc2244b` (fix) — 前一次运行完成，已合入 master（worktree base `a39c0f0` 包含该提交）
2. **Task 2: delete_game 命令 + 删除条目 UI（含确认对话框）** - `86aa131` (feat)
3. **Task 3: Detail 启动方式收敛为 日区 LE 启动 / 直接启动** - `c8cfa25` (feat)

**Plan metadata:** 由 orchestrator 后续提交（SUMMARY.md / STATE.md）

## Files Created/Modified

- `src/hooks/useSmoothWheel.ts` - Task 1：加 `scroll` 监听 + `lastWritten` 比对，外部滚动时重新同步 lerp 目标并停 rAF
- `src-tauri/src/commands.rs` - Task 2：新增 `delete_game` 命令（删 8 张子表 + games 行，不碰磁盘）
- `src-tauri/src/lib.rs` - Task 2：`invoke_handler!` 注册 `delete_game`
- `src/lib/games.ts` - Task 2：新增 `deleteGame` invoke 包装
- `src/components/library/GameCard.tsx` - Task 2：新增 `onRequestDelete` prop + 破坏性「删除条目」右键菜单项
- `src/components/library/GameGrid.tsx` - Task 2：把 `onRequestDelete` prop 透传到每个 GameCard
- `src/routes/Library.tsx` - Task 2：`deleteCandidate` 状态 + 删除确认 AlertDialog，确认后刷新网格 + 侧边栏
- `src/routes/Persons.tsx` - Task 2：为只读游戏网格提供 `noopRequestDelete`（满足新增的必填 prop）
- `src/routes/Detail.tsx` - Task 3：`LaunchMethod` 两值 union 替代 `LeProfile`，hydration / 持久化 / 启动派发 / 启动配置 tab 全部改写，删除 `isCnVersionExe`
- `src/components/library/LaunchButton.tsx` - Task 3：4-profile popover 改为 2-方式 popover，导出 `LaunchMethod` 类型

## Decisions Made

- **delete_game 子表清理范围** — 计划提示参考 `clear_all_data` 并 grep migrations 补全。grep 确认 `game_id` 外键子表共 8 张；`clear_all_data` 只列了 4 张（screenshots / save_backups / sessions / game_tags），本命令额外补上 `game_staff` / `game_official_tags` / `custom_view_games` / `scan_review_queue`，避免删游戏后留孤儿行。
- **删除确认 AlertDialog 归属 Library 而非 GameCard** — 卡片随其网格行被删而 unmount，若对话框在卡内会被一起拆掉，确认动作中途丢失。沿用 q3y 的 `splitCandidate` 模式由 Library 持有 `deleteCandidate`。
- **le_profile 映射规则** — 只有显式 `direct` 哨兵映射为「直接启动」，其余一切值（`Japanese`、已删除的 `Simplified Chinese` / `Traditional Chinese` / `Custom`、空串）回落「日区 LE 启动」。后端 LE 路径本就忽略 `le_profile` 值（恒用默认 ja-JP），该列是自由 TEXT 无 CHECK 约束，故无需后端 / DB migration。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Persons.tsx 直接渲染 GameCard，需补 onRequestDelete**

- **Found during:** Task 2（add delete_game + 删除条目 UI）
- **Issue:** GameCard 新增了必填 prop `onRequestDelete`，而 `src/routes/Persons.tsx` 也直接渲染 `<GameCard>`（人物聚合页的作品网格），`npx tsc` 报 TS2741 缺少 prop。计划 frontmatter 的 files_modified 未列 Persons.tsx。
- **Fix:** 在 Persons.tsx 按其既有 `noopPickMetadata` / `noopRefreshCover` / `noopSplitSubdirs` 模式新增 `noopRequestDelete` 空函数并传入 `<GameCard>`。人物页的作品网格是只读的，删除是 Library 专属流程，no-op 合理。
- **Files modified:** src/routes/Persons.tsx
- **Verification:** `npx tsc --noEmit` 通过
- **Committed in:** `86aa131`（Task 2 提交）

---

**Total deviations:** 1 auto-fixed（1 blocking）
**Impact on plan:** 该 deviation 是给 GameCard 加必填 prop 后跨页面编译必然产生的修补；计划在 Task 2 action 中已明确「线程化 onRequestDelete 也会触及 GameGrid.tsx」的同类预期，Persons.tsx 是同一波及面。无范围蔓延。

## Issues Encountered

- **执行环境的 cwd / 工作目录歧义** — Edit/Write/Read 工具按绝对路径解析到主仓 `D:\project\gal-lib\`（一个 additional working directory），而本任务的 worktree 在 `D:\project\gal-lib\.claude\worktrees\agent-a8ad9fbd50200ffa7\`。首次提交时 pre-commit HEAD 断言正确拦截了「在主仓 master 保护分支上提交」。改用：在主仓编辑 + `npx tsc` 校验（主仓有 node_modules）→ `git diff` 导出补丁 → 在 worktree `git apply` → 还原主仓 → 在 worktree 内提交。两个任务的补丁在 worktree 均 `git apply --check` 干净通过。Task 2 的 `cargo check` 在主仓 `src-tauri` 跑（Rust 文件在 worktree base 与 master 间逐字相同，结果对 worktree 有效）。
- **worktree base 与 master 的 Library.tsx 分叉** — worktree base `a39c0f0` 含 quick-260516-vs4 滚动恢复代码，master `b3ec840` 不含。Task 2 对 Library.tsx 的补丁块均不落在 vs4 区域（121-216 行），`git apply` 在 worktree 干净应用。

## Known Stubs

None — 三个任务均完整接线，无占位 / mock 数据。

## User Setup Required

None - 无外部服务配置需求。

## Next Phase Readiness

- 三项独立改进全部落地，自动化验证全绿（`npx tsc --noEmit` 通过、`cargo check` 通过）。
- 真机冒烟（新鲜启动拖动滚动条无回弹 / 右键删除条目后磁盘目录仍在 / Detail 启动选择只剩两项且直接启动不经 LE）按 autonomous-run 策略推迟到里程碑 audit。

## Self-Check: PASSED

- 提交存在：`cc2244b`（Task 1）/ `86aa131`（Task 2）/ `c8cfa25`（Task 3）全部 FOUND。
- 修改文件全部存在（10 个）。
- `delete_game` 已在 `86aa131` 的 commands.rs 中定义并在 lib.rs `invoke_handler!` 注册。
- `LaunchMethod` 已在 `c8cfa25` 的 Detail.tsx 中（10 处引用）。

---
*Phase: quick-260517-qnn*
*Completed: 2026-05-17*
