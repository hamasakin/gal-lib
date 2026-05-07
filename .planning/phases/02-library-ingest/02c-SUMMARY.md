---
phase: 02-library-ingest
plan: 02c
subsystem: scan
tags: [filesystem-walk, exe-heuristic, game-boundary, progress-callback, cancel-skip, incremental]
requires: [02a, 02b]
provides:
  - scan_module
  - scan_types
  - exe_scoring_heuristic
  - walker_collect_game_dirs
  - walker_pick_best_exe
  - run_scan_orchestrator
  - scan_context
affects:
  - src-tauri/src/scan/mod.rs
  - src-tauri/src/scan/types.rs
  - src-tauri/src/scan/walker.rs
  - src-tauri/src/scan/exe_score.rs
  - src-tauri/src/lib.rs
tech-stack:
  added: []
  patterns:
    - walkdir-min-max-depth-for-exact-game-boundary
    - pure-fn-scoring (score_exe takes &Path, no I/O contract beyond fs::metadata)
    - cooperative-cancel (Arc<AtomicBool> polled per directory)
    - skip-set (Arc<Mutex<HashSet<PathBuf>>>)
    - injected-progress-callback (decouples scan from Tauri runtime)
    - incremental-via-existing-paths-set (HashSet<PathBuf> from games.path)
key-files:
  created:
    - src-tauri/src/scan/mod.rs
    - src-tauri/src/scan/types.rs
    - src-tauri/src/scan/walker.rs
    - src-tauri/src/scan/exe_score.rs
  modified:
    - src-tauri/src/lib.rs
decisions:
  - "Game-boundary enforced via walkdir min_depth==max_depth==N — single iterator pass, no manual depth tracking"
  - "pick_best_exe rejects all-negative-score candidates — surfaces None for UI to render '无可识别 exe' badge per SCAN-05"
  - "Tie-break on mtime (newest wins) — matches 02-CONTEXT § Filesystem Scan Engine"
  - "Walker swallows per-entry walkdir errors via filter_map(Result::ok) — single permission-denied dir does not abort the whole scan"
  - "run_scan takes a Box<dyn Fn(ScanProgress)+Send+Sync> closure — module is unit-testable without Tauri AppHandle; 02d wires app.emit"
  - "ScanContext bundles cancel + skip Arc handles — caller passes one Arc<ScanContext> instead of two separate Arcs"
metrics:
  start: 2026-05-07
  completed: 2026-05-07
---

# Phase 2 Plan 02c: Scan Engine Summary

**One-liner:** 落地 Rust 后端文件系统扫描引擎 — walkdir 严格深度遍历做"第 N 层 = 1 款游戏"边界识别 + 启发式 exe 打分 + 注入式进度回调 + cancel/skip/增量三件套；02d 包装为 Tauri command 即可上层消费。

## Tasks Completed

### Task 1: scan/types.rs + walker.rs + exe_score.rs (commit `0b916e1`)

- **`src-tauri/src/scan/types.rs`** (NEW) — 共享数据类型：
  - `ScanProgress { current_dir, completed, total, status }` — Serialize；02d 通过 Tauri `emit("scan-progress", ...)` 推到前端
  - `ScanStatus { Running / Completed / Cancelled / Failed }` — `serde(rename_all = "lowercase")` 匹配 JS-side 联合类型
  - `DiscoveredGame { path, raw_name, clean_name, executable }` — 02d/02e 持久化进 `games` 表的载体
  - `ScanError` thiserror — `Io(#[from] std::io::Error)` / `Walk(#[from] walkdir::Error)` / `Cancelled`
- **`src-tauri/src/scan/exe_score.rs`** (NEW) — 纯 fn `score_exe(path, parent_dir) -> i32`：
  - 加分：name 长度 5..=30 (+1) / 与 parent 双向前缀匹配 (+5) / size > 1MB (+2)
  - 减分：name 含 setup|uninst|uninstall|patch|tool|config|launcher|crash|vcredist|dotnet (-10) / size < 100KB (-3) / 路径含 redist|tools|launcher|extras|crack|_install (-3, 一次)
  - 4 unit tests 全绿: `prefers_main_exe_over_setup` / `excludes_redist_subdirectory` / `large_executable_bonus` / `name_length_bonus`
- **`src-tauri/src/scan/walker.rs`** (NEW) — 两个公开 fn：
  - `collect_game_dirs(roots: &[(PathBuf, u8)], cancel: &Arc<AtomicBool>) -> Result<Vec<PathBuf>, ScanError>` — 对每个 (root, depth) 用 `WalkDir::new(root).min_depth(d).max_depth(d).follow_links(false)` 锁定深度；不存在的 root 静默跳过（拔出的可移动盘）；cancel flag 在每个 entry 之前轮询
  - `pick_best_exe(game_dir: &Path) -> Option<PathBuf>` — 在游戏目录里全递归扫所有 `.exe`，调 `score_exe` 打分；分数 ≤ 0 直接淘汰；高分胜出，并列时 mtime 新者胜
  - 5 unit tests 全绿: `collect_at_depth_one` / `collect_at_depth_two` / `cancel_flag_aborts_walk` / `pick_best_exe_finds_main_over_setup` / `pick_best_exe_returns_none_when_all_negative`
- **`src-tauri/src/scan/mod.rs`** (NEW) — 仅声明 3 个子模块 + 重导出 types；run_scan 在 Task 2 追加
- **`src-tauri/src/lib.rs`** — 追加 `mod scan;`（保持 alphabetical：data_dir / db / metadata / scan / title_clean）；零 command 注册（02d 工作）
- 验证：
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0（46 个 dead-code warnings — 这些 fn 直到 02d/02e/02f 才有调用方，符合预期）
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib scan::exe_score::tests` → **4/4 passed**

### Task 2: scan/mod.rs orchestrator — run_scan + ScanContext (commit `8dbcba2`)

- **`ScanContext`** — bundles 两个共享 handle：`cancel: Arc<AtomicBool>` + `skip: Arc<Mutex<HashSet<PathBuf>>>`；`new()` / `Default` 都提供（02d 会从 Tauri State 共享同一个 ctx 给 `cancel_scan` command）
- **`pub async fn run_scan<F>(roots, existing_paths, incremental, ctx, on_progress) -> Result<Vec<DiscoveredGame>, ScanError>`**：
  - Pass 1：调 `walker::collect_game_dirs(&roots, &ctx.cancel)` — 把所有游戏目录列出来，得到 `total`，进度分数从一开始就是稳定的
  - Pass 2：对每个目录：
    1. **Cancel check**（每次迭代起点）：`ctx.cancel.load(Relaxed)` → emit `Cancelled` event + return `ScanError::Cancelled`
    2. **Skip set check**：从 `ctx.skip` lock 中查 membership（短锁；释放后再做 FS I/O，避免握锁过久）；命中 → emit Running event +1 跳过
    3. **Incremental check**：`incremental && existing_paths.contains(&dir)` → 同上 emit + skip
    4. 三道闸都没拦截 → `walker::pick_best_exe(&dir)` + `clean_title(&raw)` → push `DiscoveredGame { path, raw_name, clean_name, executable }`
    5. emit Running event with `completed = i + 1`
  - 退出前 emit 终结 `Completed` event（`current_dir = ""`, `completed == total`）
- **on_progress** 签名：`Fn(ScanProgress) + Send + Sync + 'static` —— 完全 Tauri-runtime-agnostic；scan 模块在单元测试里直接传一个把事件累加进 `Vec<ScanProgress>` 的闭包；02d 把它翻译成 `app.emit("scan-progress", payload)`
- **`src-tauri/src/lib.rs`** — Task 1 已经追加 `mod scan;`，Task 2 不再触碰
- 4 个 `#[tokio::test]` 单元测试全绿:
  - `run_scan_emits_running_then_completed` — 2 个空目录，应得 2×Running + 1×Completed = 3 events
  - `run_scan_skips_existing_paths_when_incremental` — Existing 目录在 `existing_paths` 里 → 只剩 Newcomer
  - `run_scan_honors_cancel_flag` — 预置 cancel=true → `collect_game_dirs` 立刻返回 `ScanError::Cancelled`，零事件
  - `run_scan_skips_via_skip_set` — `ctx.skip` 里塞 Skipped 路径 → 只剩 Kept
- 验证：
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0（48 个 dead-code warnings — 都是 02d/02e/02f 才接入的 fn / struct，符合预期）
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **29/29 passed**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical functionality] mod.rs 在 Task 1 也必须创建 + lib.rs 在 Task 1 也必须追加 `mod scan;`**

- **Found during:** Task 1 — Plan Task 1 verify 命令包含 `cargo check`，但 walker.rs 的 `use crate::scan::exe_score::score_exe` / `use crate::scan::types::ScanError` 都是相对于已注册的 `scan` 模块的；如果 Task 1 不创建 mod.rs + 不追加 `mod scan;` 到 lib.rs，cargo check 会失败 ("file not found for module `scan`")。
- **Fix:** Task 1 提交里就创建一个最小 mod.rs（只声明 3 个 sub-modules 和 re-export types），并把 `mod scan;` 追加到 lib.rs（保持 alphabetical：data_dir / db / metadata / scan / title_clean）。Task 2 仅在已存在的 mod.rs 上追加 `ScanContext` + `run_scan` 实现。Plan 把 lib.rs 修改放在 Task 2 的 read-first，但实际执行顺序要求它必须在 Task 1 一并完成 —— 这是 Rust crate-level 模块系统的硬约束，不是 plan 错，而是 plan 没显式说明 lib.rs 在哪个 task 改。
- **Files modified:** `src-tauri/src/scan/mod.rs`（Task 1 创建最小版） / `src-tauri/src/lib.rs`（Task 1 追加 `mod scan;`）
- **Commit:** `0b916e1`（Task 1）

**2. [Rule 2 - Critical functionality] ScanContext 实现 Default 以满足 clippy 习惯**

- **Found during:** Task 2 — 给 `ScanContext` 写了 `pub fn new() -> Self`，clippy 会警告 `new` without `Default`。
- **Fix:** 加 `impl Default for ScanContext { fn default() -> Self { Self::new() } }`。这不是 plan 显式要求，但是惯用 Rust 模式，避免 02d 在 Tauri State 注册时拿不到 `Default::default()`。
- **Files modified:** `src-tauri/src/scan/mod.rs`
- **Commit:** `8dbcba2`

**3. [Rule 1 - Bug] Plan 文本里 walker.rs 用的 `Box<dyn Fn(ScanProgress) + Send + Sync>` 改为泛型 `F: Fn(...)+Send+Sync+'static`**

- **Found during:** Task 2 — 仔细看 plan 里 run_scan 的签名其实就是泛型 `F` 不是 boxed dyn；但 plan 在 walker.rs 段落里说 "Emit fn parameter `Box<dyn Fn(ScanProgress) + Send + Sync>` (closure injected by caller)"。我选了泛型 F 的版本（plan run_scan 段就是这么写的）—— walker.rs 自己不需要进度回调（它只是 collect_game_dirs / pick_best_exe 两个函数，由 run_scan 编排进度事件）。两份 plan 文本在这点上不一致；按 run_scan 段的更精确签名为准。
- **Fix:** walker.rs 不带 on_progress 参数；run_scan 用泛型 `F: Fn(ScanProgress) + Send + Sync + 'static` 接收回调，这样调用站不用强制 Box。
- **Files modified:** `src-tauri/src/scan/walker.rs`、`src-tauri/src/scan/mod.rs`
- **Commit:** `0b916e1` + `8dbcba2`

### Auth Gates

无（纯 Rust 后端逻辑层；零网络/凭据依赖）。

### Deferred Issues

无。

## Threat Flags

无（纯本地文件系统遍历；walkdir `follow_links(false)` 防 symlink-cycle DoS；per-entry walkdir errors 被 `filter_map(Result::ok)` 吞掉避免单坏目录拖死整轮扫描；cancel 是 cooperative 的，扫描期间不持有 DB / 网络 handle，故 cancel 不会泄漏资源）。

## Self-Check

### Files

- [x] `src-tauri/src/scan/types.rs` exists; contains `ScanProgress` + `ScanStatus` + `DiscoveredGame` + `ScanError` ✓
- [x] `src-tauri/src/scan/exe_score.rs` exists; contains `pub fn score_exe` + 4 unit tests ✓
- [x] `src-tauri/src/scan/walker.rs` exists; contains `WalkDir` + `max_depth` + `collect_game_dirs` + `pick_best_exe` + 5 unit tests ✓
- [x] `src-tauri/src/scan/mod.rs` exists; contains `pub async fn run_scan` + `ScanContext` + 4 unit tests ✓
- [x] `src-tauri/src/lib.rs` updated; contains `mod scan;` ✓

### Build / Test

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 ✓
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib scan::exe_score::tests` → **4/4 passed** ✓
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **29/29 passed** ✓
  - 4 既有 (data_dir × 2 + db × 2)
  - 6 title_clean
  - 5 metadata::match_score + 1 metadata::bangumi (compile-only)
  - 4 scan::exe_score (NEW: prefers_main_exe_over_setup, excludes_redist_subdirectory, large_executable_bonus, name_length_bonus)
  - 5 scan::walker (NEW: collect_at_depth_one, collect_at_depth_two, cancel_flag_aborts_walk, pick_best_exe_finds_main_over_setup, pick_best_exe_returns_none_when_all_negative)
  - 4 scan::tests (NEW: run_scan_emits_running_then_completed, run_scan_skips_existing_paths_when_incremental, run_scan_honors_cancel_flag, run_scan_skips_via_skip_set)

### Commits

- [x] `0b916e1` feat(02-02c): add scan/types + walker + exe_score (with tests) ✓
- [x] `8dbcba2` feat(02-02c): add scan orchestrator (run_scan with progress callback) ✓

## Self-Check: PASSED
