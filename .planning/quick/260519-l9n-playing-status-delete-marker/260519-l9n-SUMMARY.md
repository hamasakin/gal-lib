---
phase: quick-260519-l9n
plan: 01
subsystem: 库条目状态/生命周期
tags: [status-upgrade, removed-marker, scan, ipc]
requires:
  - games 表 status CHECK 约束 (migration 0001)
  - launch::session end_session / cancel_session
  - scan::run_scan / walker::collect_game_dirs
  - commands::delete_game / ingest_one_dir
provides:
  - 有时长自动 playing 状态升级 (session + backfill)
  - removed-marker 模块 (.gal-lib-removed 写/删/检测)
  - 3 个新 IPC: backfill_playing_status / list_removed_dirs / restore_removed_dir
  - ScanOutcome 类型 (run_scan 新返回值)
  - Scan 页『已删除条目』区域
affects:
  - run_scan 返回类型 Vec<DiscoveredGame> → ScanOutcome (调用方需取 .discovered)
  - delete_game 现在写磁盘标记 (此前明确不碰磁盘)
tech-stack:
  added:
    - windows crate feature Win32_Storage_FileSystem (已有 crate 加 feature，非新依赖)
  patterns:
    - 带守卫的条件 UPDATE 保护用户级状态
    - best-effort 磁盘标记 + 幂等 remove
key-files:
  created:
    - src-tauri/src/scan/removed_marker.rs
    - src/components/library/RemovedDirs.tsx
  modified:
    - src-tauri/src/launch/session.rs
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/scan/mod.rs
    - src-tauri/src/scan/types.rs
    - src-tauri/Cargo.toml
    - src/lib/scanReview.ts
    - src/lib/games.ts
    - src/routes/Scan.tsx
decisions:
  - "Task 2 分支点：windows crate 已存在 → 用真实 SetFileAttributesW（加 Win32_Storage_FileSystem feature），未新增 crate 依赖"
  - "Task 1 TDD：session.rs 沿用 compile-only smoke test 约定（内存 pool 需跑 migrations，成本过高），状态升级逻辑靠 cargo build + verify 覆盖"
metrics:
  duration: ~12min
  completed: 2026-05-19
---

# Quick 260519-l9n: 有时长自动『游玩中』+ 删除标记防重扫 Summary

会话结束/取消时把仍为 unplayed 且有累计时长的条目自动升级为 playing（守卫保护 cleared/dropped 不被改写）；删除游戏时在磁盘目录写 `.gal-lib-removed` 隐藏标记，扫描跳过带标记目录不再重扫加回，Scan 页新增『已删除条目』区域支持点「重新添加」恢复。

## 执行结果

3 个任务全部完成并各自原子提交：

| Task | 名称 | Commit |
|------|------|--------|
| 1 | 自动『游玩中』状态升级 — session 结束 + 历史补齐 | `cb80348` |
| 2 | removed-marker 模块 + delete_game 写标记 + 扫描跳过收集 | `493bdc0` |
| 3 | 前端『已删除条目』区域 + IPC 封装 + Scan 页接入 | `cad57d5` |

## Task 2 分支决策（计划要求记录）

计划 Task 2 有一个分支点：grep `src-tauri/Cargo.toml` 是否已有 `windows`/`winapi` 依赖。

**结果：`windows` crate v0.58 已存在**（Cargo.toml:59，原用于进程/注册表）。
**采用分支：用真实 `SetFileAttributesW` 调用。**

- 给已有的 `windows` 依赖追加 `Win32_Storage_FileSystem` feature（`SetFileAttributesW` / `FILE_ATTRIBUTE_HIDDEN` 所在模块）。这是给**已链接的 crate 加 feature**，不是新增 crate 依赖 —— 符合约束「不为隐藏属性新增 crate 依赖」。
- `removed_marker.rs` 的 `#[cfg(windows)] set_hidden` 用 `windows::Win32::Storage::FileSystem::SetFileAttributesW` + `PCWSTR`，best-effort（失败不影响功能）。
- `Cargo.lock` 未变化（加 feature 不改锁文件版本解析）。

## 自动化验证结果（实际运行）

所有验证命令在 bash shell 实跑（计划 verify 块的 PowerShell `Select-String` 已翻译为 `grep`），下列为真实结果：

| Gate | 命令 | 结果 |
|------|------|------|
| Task 1 build | `cargo build` | 通过（`Finished dev profile`，仅 5 个 pre-existing 无关 warning） |
| Task 1 test | `cargo test --lib session` | `test result: ok. 1 passed; 0 failed` |
| Task 2 build | `cargo build` | 通过（`Finished` 30.24s） |
| Task 2 test | `cargo test --lib scan` | `test result: ok. 21 passed; 0 failed`（含新 removed_marker roundtrip + 4 个适配后的 run_scan 测试） |
| 全量 lib test | `cargo test --lib` | `test result: ok. 83 passed; 0 failed` |
| Task 3 build | `npm run build`（tsc -b + vite build） | 通过，0 TypeScript 错误，`✓ built in 3.39s` |

**这些自动化 gate 证明的：** Rust 后端编译通过、全部单元测试绿（含 SQL 字符串语法、ScanOutcome 类型适配、removed_marker 文件写删检测 roundtrip）、前端 TypeScript 类型检查通过、Scan 页组件树编译通过。

**这些 gate 不证明的（仍需真机 GUI 验证 — 计划标 `autonomous: false` 的原因）：**

- 删除游戏 → 磁盘真的出现 `.gal-lib-removed` 隐藏文件（`SetFileAttributesW` 隐藏属性效果）。
- 删除后跑增量/全量扫描 → 该目录确实被跳过、不重新加回库。
- Scan 页『已删除条目』区域真机渲染、列表正确填充。
- 点「重新添加」→ 标记文件被删、目录作为新条目入库、列表行消失、KPI 刷新。
- 有时长的 unplayed 游戏会话结束后真机状态显示变为「游玩中」。

子代理在 worktree 中无法运行 Tauri GUI，上述链路未做真机验证 —— 实现按代码核实的契约编写，根因属设计推断而非已验证事实。建议执行一次真机 walkthrough：删一个游戏 → 看目录标记 → 重扫确认跳过 → Scan 页恢复 → 玩一局游戏看状态。

## 关键实现点（代码核查）

- `session.rs`：`end_session` 与 `cancel_session` 各追加一条 `UPDATE games SET status='playing' ... WHERE ... AND status='unplayed' AND total_playtime_sec > 0`。`mark_failed` 未改（不滚时长）。grep `status='playing'` session.rs 命中 2 次。
- `commands.rs::backfill_playing_status`：批量 UPDATE `status='unplayed' AND total_playtime_sec>0` → playing，返回 `rows_affected`。已注册到 lib.rs。
- `removed_marker.rs`：`write_marker` / `remove_marker`（幂等）/ `has_marker` 三函数 + `MARKER_FILENAME` 常量 + Windows `set_hidden`。含一个 roundtrip 单元测试。
- `run_scan` 返回 `ScanOutcome { discovered, removed_dirs }`；Pass 2 在 incremental skip 之后、`pick_best_exe` 之前检测 `has_marker` 并 `continue` + 收集。`start_scan` 取 `o.discovered`。
- `delete_game`：删子表前先 `SELECT path`，删 games 行确认 `rows_affected>0` 后 best-effort `write_marker`。
- `list_removed_dirs` / `restore_removed_dir` 已注册到 lib.rs；`restore_removed_dir` 带 `dir.is_dir()` 校验（T-l9n-01 mitigation）。
- 前端：`RemovedDirs.tsx` 导出 `RemovedDirs` 组件，挂载 `listRemovedDirs()` 填表、「重新添加」乐观移除 + toast + 失败回滚 + `onRestored` 回调。`Scan.tsx` 在两栏 feed 下方 `mt-6` 渲染。

## Deviations from Plan

### 自动处理项

**1. [Rule 3 - 阻塞修复] 启用 windows crate 的 Win32_Storage_FileSystem feature**
- **发现于：** Task 2
- **问题：** 计划要求「windows crate 存在则用真实 SetFileAttributesW」，但 `SetFileAttributesW` 所在的 `Win32_Storage_FileSystem` feature 此前未启用，直接 use 会编译失败。
- **处理：** 给已有的 `windows` 依赖追加该 feature。这是对已链接 crate 加 feature，非新增 crate 依赖，符合约束。
- **文件：** `src-tauri/Cargo.toml`
- **Commit：** `493bdc0`

其余按计划逐字执行。Task 1 TDD 按计划提供的 fallback（内存 pool 跑 migrations 成本过高 → 沿用 session.rs compile-only smoke 约定，状态逻辑靠 build + verify 覆盖）执行 —— 这是计划 `<action>` 明文允许的路径，非偏差。

## TDD Gate Compliance

Task 1 标 `tdd="true"`，但计划 `<action>` 明确给出 fallback：session.rs 现有测试是 compile-only smoke，内存 pool 需跑 migrations 成本过高时「依赖 cargo build + verify」。本任务采用该 fallback，未走 RED/GREEN 分离提交 —— 属计划授权路径。状态升级逻辑由 `cargo build`（SQL 字符串编译期不校验，但语法已人工核对）+ `cargo test --lib`（83 全绿）+ verify 块覆盖。提交为单个 `feat` commit。

## Known Stubs

无。所有数据路径已接通（IPC ↔ 后端 ↔ DB/文件系统），`RemovedDirs` 组件挂载即调真实 `list_removed_dirs`。

## Self-Check: PASSED

- 文件存在：`src-tauri/src/scan/removed_marker.rs` FOUND；`src/components/library/RemovedDirs.tsx` FOUND。
- 提交存在：`cb80348` FOUND；`493bdc0` FOUND；`cad57d5` FOUND。
- 自动化 gate：cargo build / cargo test --lib (83 passed) / npm run build 全部实跑通过。
