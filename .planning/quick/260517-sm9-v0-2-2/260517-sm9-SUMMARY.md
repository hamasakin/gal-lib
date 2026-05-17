---
phase: quick-260517-sm9
plan: 01
subsystem: build/release
tags: [release, versioning, chore]
requires: []
provides: [sm9-RELEASE-022]
affects: [package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock]
tech-stack:
  added: []
  patterns: ["三处版本字段 + Cargo.lock 自身条目必须保持一致"]
key-files:
  created: []
  modified:
    - package.json
    - src-tauri/tauri.conf.json
    - src-tauri/Cargo.toml
    - src-tauri/Cargo.lock
decisions:
  - "Cargo.lock 的 gal-lib [[package]] 条目在编辑 Cargo.toml 后由后台 cargo 重解析自动同步到 0.2.2，无需手动 cargo update"
metrics:
  duration: "~2 min"
  completed: "2026-05-17"
  tasks: 1
  files: 4
---

# Quick 260517-sm9: 发布 v0.2.2 小版本（版本号 bump）Summary

将 gal-lib 版本号从 0.2.1 统一升级到 0.2.2，组成单个原子提交，为 v0.2.2 发布做准备。

## What Was Done

将 4 处版本字段从 `0.2.1` 升到 `0.2.2`：

| 文件 | 字段 | 变更 |
|------|------|------|
| `package.json` | `"version"` (L4) | `0.2.1` → `0.2.2` |
| `src-tauri/tauri.conf.json` | `"version"` (L4) | `0.2.1` → `0.2.2` |
| `src-tauri/Cargo.toml` | `version` (L3) | `0.2.1` → `0.2.2` |
| `src-tauri/Cargo.lock` | `gal-lib` 包条目 `version` (L1573) | `0.2.1` → `0.2.2` |

`git diff --stat` 确认恰好 4 个文件被修改，每个文件仅一行变更（4 insertions / 4 deletions）。Cargo.lock 中其余所有依赖条目（windows-link 0.2.1、getrandom 等）未改动，仅 `name = "gal-lib"` 的 `[[package]]` 条目 version 更新。

## Verification

- `git diff --stat` 显示 4 个文件各 1 行变更（4 insertions / 4 deletions）。
- `git grep -c '0\.2\.2' -- package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml` → 三个文件各命中 1 处。
- `git grep '0\.2\.1' -- package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml` 无输出（三处用户/构建版本字段已无 0.2.1 残留）。
- `git diff src-tauri/Cargo.lock` 仅显示 `name = "gal-lib"` 下的 `version` 一行从 `0.2.1` 改为 `0.2.2`，其余依赖条目未触碰。

## Commits

- `2c0a022` — chore(quick-260517-sm9): bump version to 0.2.2

## Deviations from Plan

编辑 `src-tauri/Cargo.toml` 后，后台 cargo 进程重解析 lockfile，已将 `Cargo.lock` 的 `gal-lib` 条目自动同步到 `0.2.2`，因此无需对 Cargo.lock 单独手动编辑。最终 4 处版本号一致，与计划目标完全相符。

执行方式说明（非偏离）：planner subagent 派发时遭遇连接错误，orchestrator 直接以编排者身份完成版本 bump 与提交，GSD 保证（原子提交 / SUMMARY / STATE 追踪）均保留。

## Self-Check: PASSED

- 提交存在：`2c0a022` 在 `git log` 中可查。
- 修改文件确认：`git show 2c0a022 --stat` 显示 package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml / src-tauri/Cargo.lock 共 4 个文件，每个 1 行 `0.2.1`→`0.2.2`。
- 未执行 `git tag` / `git push`（按约束由 orchestrator 处理）。
- 未修改 ROADMAP.md，未提交 docs 工件（由 orchestrator 在 Step 8 处理）。
