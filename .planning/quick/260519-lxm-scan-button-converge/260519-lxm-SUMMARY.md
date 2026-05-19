---
phase: quick-260519-lxm
plan: 01
subsystem: ui
tags: [scan, settings, ui-cleanup, refactor]
requires: []
provides: ["单一「扫描」按钮的 /scan 页", "「扫描操作」区块单一「扫描」按钮的 /settings 页"]
affects: [src/routes/Scan.tsx, src/routes/Settings.tsx]
tech-stack:
  added: []
  patterns: ["前端按钮收敛 — 后端已统一行为时移除等价冗余 UI"]
key-files:
  created: []
  modified:
    - src/routes/Scan.tsx
    - src/routes/Settings.tsx
decisions:
  - "startScan(mode) 签名保持不变，前端固定传 \"full\"——不动 src/lib/scan.ts，零后端改动"
metrics:
  duration: ~5min
  completed: 2026-05-19
---

# Quick 260519-lxm: 扫描按钮收敛 Summary

把 /scan 页和 /settings 页里完全等价的「增量扫描 / 全量扫描」冗余扫描按钮收敛为单一「扫描」按钮，运行时行为零变化。

## 背景

后端 `start_scan(mode)` 自 20260516 起把 `full` 与 `incremental` 统一为同一行为，`mode` 参数只做校验、不再影响行为。因此前端两个扫描按钮本就完全等价，是会让用户困惑的冗余 UI（「增量」与「全量」实际无差别）。

## 完成的任务

### Task 1 — Scan.tsx：/scan 页扫描按钮收敛（commit 7564e18）

- 删除「增量扫描」按钮（`onClick={() => void onScan("incremental")}` + `<RefreshCw>` 图标的整个 `<button>` 块）。
- 「全量重扫」按钮改名为「扫描」，保留 `Search` 图标（视觉中性，符合「扫描」语义）。
- `onScan` 回调从 `async (mode) => {...}` 收敛为无参函数：内部固定 `startScan("full")`，toast 文案 `已开始全量重扫 / 已开始增量扫描` 简化为 `已开始扫描`；空目录守卫 + `navigate("/settings")` + catch 报错逻辑不变；`useCallback` 依赖数组仍为 `[navigate]`。
- 剩余按钮 onClick 从 `() => void onScan("full")` 改为 `() => void onScan()`。
- 清理：第 25 行 import 移除不再使用的 `RefreshCw`（`ListRestart`/`Search`/`X` 保留）；文件头注释 actions 行更新为「扫描 / 重新生成待复核队列 / 取消（active 时）」。

### Task 2 — Settings.tsx：扫描操作区按钮收敛（commit 6976ca5）

- 「扫描操作」区块「全量扫描」按钮改名为「扫描」，`primary` 等属性不动。
- 同步该区块 lede 说明文案开头「全量扫描」→「扫描」。
- `onScan` 回调从 `async (mode) => {...}` 收敛为无参函数：内部固定 `startScan("full")`；空守卫报错 toast、`toast.info("扫描已启动")`、`navigate("/")`、catch 逻辑不变。
- 按钮 onClick 从 `() => void onScan("full")` 改为 `() => void onScan()`。
- 文件头注释第 11 行 scan-ops 行 `full/incremental scan` → `scan`。

## 验证

- `npx tsc --noEmit` 两次（Task 1 后、Task 2 后）均通过，无未使用变量 / 缺失引用报错。
- grep 确认 `src/routes/` 中已无字符串「增量扫描」「全量重扫」「全量扫描」残留。
- grep 确认两处 `onScan` 内部均固定 `startScan("full")`（Scan.tsx:94、Settings.tsx:252）——后端收到的 mode 与改动前完全一致，运行时行为零变化。
- `git diff --diff-filter=D` 确认无意外文件删除。
- 后端 `src-tauri/` 与 `src/lib/scan.ts` 零改动（`startScan` 签名保留 `mode` 参数）。

## 与计划的偏差

无 —— 计划逐字执行。l9n 在 Scan 页新增的「已删除条目」区域（RemovedDirs）与本任务改动的扫描模式按钮不在同一处，互不影响，无需处理。

## 提交

- `7564e18` refactor(quick-260519-lxm): /scan 页扫描按钮收敛为单一「扫描」
- `6976ca5` refactor(quick-260519-lxm): /settings 扫描操作区按钮收敛为「扫描」

## Self-Check: PASSED

- FOUND: src/routes/Scan.tsx（已修改，含 `startScan("full")`）
- FOUND: src/routes/Settings.tsx（已修改，含 `startScan("full")`）
- FOUND: commit 7564e18
- FOUND: commit 6976ca5
