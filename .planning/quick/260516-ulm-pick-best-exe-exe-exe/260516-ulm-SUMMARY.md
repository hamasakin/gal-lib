---
phase: quick-260516-ulm
plan: 01
subsystem: scan
tags: [scan, exe-picker, bugfix, tdd]
requires:
  - "src-tauri/src/scan/exe_score.rs::score_exe (locked scoring contract)"
provides:
  - "pick_best_exe — layered (shallow-first) executable matching"
affects:
  - "扫描首发候选 exe 选择（per-game scan）"
tech-stack:
  added: []
  patterns:
    - "BTreeMap<usize, _> 按 WalkDir entry.depth() 分桶 → 升序迭代取首个非空层"
key-files:
  created: []
  modified:
    - "src-tauri/src/scan/walker.rs"
decisions:
  - "pick_best_exe 改为按目录深度分层匹配：浅层（depth 小）有正分候选即在该层取最佳返回，浅层全无正分才下探深层"
  - "保持 WalkDir 全树遍历不加 min/max_depth —— 分层只在评估阶段做，避免漏掉需要兜底的深层 exe"
  - "SCAN-05 locked 评分契约逐字不变：score>0 门槛、score_exe parent_dir=game_dir 根、全负返回 None、同分 mtime 兜底"
metrics:
  duration: "~4 分钟"
  completed: "2026-05-16"
  tasks: 2
  files-changed: 1
---

# Quick 260516-ulm: 修复 pick_best_exe EXE 分层匹配逻辑 Summary

按目录深度分层重写 `pick_best_exe`：浅层（更靠近游戏根）的正分 exe 优先于深层子目录里评分更高的 exe，消除「深层 redist/汉化补丁里的高分 exe 压过游戏正主」的扫描 bug；浅层无正分候选时才逐层下探兜底。

## What Was Done

### Task 1 — pick_best_exe 改写为按目录深度分层匹配（TDD）

- **RED**：新增 `pick_best_exe_prefers_shallow_over_deeper_higher_score` 测试 —— 游戏根放正分 `Fate.exe`（+8），深层 `data/bin/` 放更高分 `Fate_cn.exe`（+23）。对旧的全递归平铺实现该测试失败（选了深层 `Fate_cn.exe`）。同时新增 `pick_best_exe_falls_through_to_deeper_when_shallow_has_no_positive`。
- **GREEN**：把 `pick_best_exe` 从「全递归平铺、纯按分数取最高」改为「按 `entry.depth()` 分桶 → `BTreeMap<usize, (i32, SystemTime, PathBuf)>` → 升序迭代取首个非空层的最佳 path」。仍用 `WalkDir::new(game_dir)` 全树遍历（不加 min/max_depth），分层只在评估阶段做。
- 锁定契约逐字保留：`score > 0` 合格门槛、`score_exe(path, game_dir)` 的 `parent_dir` 仍传游戏根、全负/无候选返回 `None`、同层并列按 mtime 较新者胜、`filter_map(Result::ok)` 忽略单条目 IO 错误。

### Task 2 — 单元测试 + doc 注释同步

- 两个分层测试在 RED 阶段已落地（浅层优先 + 深层兜底），GREEN 后全部通过。
- `walker.rs` 模块顶部 doc 第 2 条改为分层描述（逐层、浅层优先、深层兜底），并一行注明这是 SCAN-05 的分层精化（评分启发式不变）。
- `pick_best_exe` 函数 doc 改为分层描述。
- 已确认无残留 `full-recursive` / `no depth limit` 措辞。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml scan::` — 18 passed, 0 failed（walker 7 + exe_score 7 + scan 4）。
- `cargo build --manifest-path src-tauri/Cargo.toml` — Finished，无新增警告（5 个 warning 均为预先存在的 dead-code，与本次改动无关，未在范围内）。
- 现有 4 个 walker 测试 + 7 个 exe_score 测试无回退。

## Deviations from Plan

None — plan executed exactly as written.

说明：计划 Task 1 标 `tdd="true"`、Task 2 要求新增同样的两个具名测试。为遵守 TDD gate 顺序，两个具名测试在 RED 阶段（Task 1）一次性落地，Task 2 只剩 doc 同步。这与计划意图一致，非偏差。

## TDD Gate Compliance

- RED gate：`a779cbb test(quick-260516-ulm): add failing test ...` —— 失败测试先行，确认对旧实现 FAIL。
- GREEN gate：`cc6a8cc feat(quick-260516-ulm): rewrite pick_best_exe ...` —— 实现后全绿。
- REFACTOR gate：无需 refactor（实现已干净）；doc 同步以 `2d426b1 docs(...)` 提交。

## Commits

| Hash | Type | Description |
|------|------|-------------|
| a779cbb | test | RED — pick_best_exe 分层匹配失败测试（浅层优先 + 深层兜底） |
| cc6a8cc | feat | GREEN — pick_best_exe 改写为按深度分层（浅层优先）匹配 |
| 2d426b1 | docs | walker 模块 doc 同步为分层描述 |

## Self-Check: PASSED

- FOUND: src-tauri/src/scan/walker.rs (modified)
- FOUND commit a779cbb
- FOUND commit cc6a8cc
- FOUND commit 2d426b1
