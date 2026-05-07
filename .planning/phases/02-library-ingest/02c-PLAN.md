---
phase: 02-library-ingest
plan: 02c
type: execute
wave: 3
depends_on: [02a, 02b]
files_modified:
  - src-tauri/src/scan/mod.rs
  - src-tauri/src/scan/walker.rs
  - src-tauri/src/scan/exe_score.rs
  - src-tauri/src/scan/types.rs
autonomous: true
requirements: [SCAN-01, SCAN-02, SCAN-03, SCAN-04, SCAN-05, SCAN-06, SCAN-08]
must_haves:
  truths:
    - "scan::walker 实现『根目录第 N 层子目录 = 1 款游戏』，N 由 scan_roots.depth 决定"
    - "scan::exe_score 启发式选 executable_path：加分（前缀匹配/大小>1MB/不在工具子目录）-减分（setup/uninst/patch/launcher/crack/redist）"
    - "扫描期间通过 Tauri event `scan-progress` emit { current_dir, completed, total, status }"
    - "增量扫描跳过 games.path 已存在的目录"
    - "Cancel 通过 Arc<AtomicBool> 在每个目录起点检查；Skip 通过 Arc<Mutex<HashSet<PathBuf>>>"
    - "cargo check + cargo test --lib 全绿（新增 ~6 个单元测试）"
  artifacts:
    - path: src-tauri/src/scan/mod.rs
      contains: "pub async fn run_scan"
    - path: src-tauri/src/scan/walker.rs
      contains: "WalkDir"
    - path: src-tauri/src/scan/exe_score.rs
      contains: "pub fn score_exe"
---

# Plan 02c — Scan Engine

## Objective

实现 Rust 后端扫描引擎：根目录遍历、游戏边界识别、exe 启发式选择、进度事件 emit、cancel/skip 支持、增量逻辑。零 frontend 改动。

## Tasks

<task name="Task 1: scan/types.rs + scan/walker.rs + scan/exe_score.rs">

<read_first>
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-CONTEXT.md (§Filesystem Scan Engine, §Game boundary, §Exe heuristic 全部锁定)
- D:\project\gal-lib\src-tauri\src\title_clean.rs (Phase 02b — 用于扫描期 game.name 初值)
</read_first>

<action>

1. **`src-tauri/src/scan/types.rs`**:
```rust
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub current_dir: String,
    pub completed: usize,
    pub total: usize,
    pub status: ScanStatus,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanStatus { Running, Completed, Cancelled, Failed }

#[derive(Debug, Clone)]
pub struct DiscoveredGame {
    pub path: PathBuf,
    pub raw_name: String,
    pub clean_name: String,
    pub executable: Option<PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("walk: {0}")]
    Walk(#[from] walkdir::Error),
    #[error("cancelled")]
    Cancelled,
}
```

2. **`src-tauri/src/scan/walker.rs`** — `walkdir::WalkDir` with `.max_depth(depth)` + `.min_depth(depth)` + `.into_iter().filter_entry(|e| e.file_type().is_dir())` for game boundary; for each game dir, scan exe with `WalkDir::new(game_dir)` (no depth limit). Skip flag via `Arc<Mutex<HashSet<PathBuf>>>`. Cancel flag via `Arc<AtomicBool>`. Emit fn parameter `Box<dyn Fn(ScanProgress) + Send + Sync>` (closure injected by caller).

3. **`src-tauri/src/scan/exe_score.rs`** — pure scoring fn:
```rust
pub fn score_exe(path: &Path, parent_dir: &Path) -> i32 {
    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let parent_name = parent_dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let mut score = 0i32;
    let bad = ["setup", "uninst", "uninstall", "patch", "tool", "config", "launcher", "crash", "vcredist", "dotnet"];
    for b in bad.iter() { if name.contains(b) { score -= 10; } }
    if name.len() >= 5 && name.len() <= 30 { score += 1; }
    if !parent_name.is_empty() && (name.starts_with(&parent_name) || parent_name.starts_with(&name)) { score += 5; }
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > 1_000_000 { score += 2; }
        else if meta.len() < 100_000 { score -= 3; }
    }
    let path_str = path.to_string_lossy().to_lowercase();
    let bad_dirs = ["redist", "tools", "launcher", "extras", "crack", "_install"];
    for bd in bad_dirs.iter() {
        if path_str.contains(&format!("\\{}\\", bd)) || path_str.contains(&format!("/{}/", bd)) {
            score -= 3;
            break;
        }
    }
    score
}
```

4. Unit tests for exe_score:
- `prefers_main_exe_over_setup` (game name "Fate", files Fate.exe + setup.exe → Fate.exe wins)
- `excludes_redist_subdirectory` (large.exe in redist/ scores lower than even small.exe in root)
- `large_executable_bonus` (size > 1MB gets +2)
- `name_length_bonus` (5-30 char names get +1)

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/scan/types.rs && \
test -f src-tauri/src/scan/walker.rs && \
test -f src-tauri/src/scan/exe_score.rs && \
grep -q "WalkDir" src-tauri/src/scan/walker.rs && \
grep -q "max_depth" src-tauri/src/scan/walker.rs && \
grep -q "score_exe" src-tauri/src/scan/exe_score.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib scan::exe_score::tests
</automated>
</verify>

</task>

<task name="Task 2: scan/mod.rs orchestrator + run_scan async fn + module declaration">

<read_first>
- D:\project\gal-lib\src-tauri\src\scan\walker.rs (Task 1 above)
- D:\project\gal-lib\src-tauri\src\scan\exe_score.rs
- D:\project\gal-lib\src-tauri\src\scan\types.rs
- D:\project\gal-lib\src-tauri\src\lib.rs (extend mod declarations)
</read_first>

<action>

1. **`src-tauri/src/scan/mod.rs`**:
```rust
pub mod exe_score;
pub mod types;
pub mod walker;

use crate::title_clean::clean_title;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::collections::HashSet;
use std::path::PathBuf;
pub use types::{ScanProgress, ScanStatus, DiscoveredGame, ScanError};

pub struct ScanContext {
    pub cancel: Arc<AtomicBool>,
    pub skip: Arc<Mutex<HashSet<PathBuf>>>,
}

impl ScanContext {
    pub fn new() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            skip: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

/// Walk all scan_roots and yield DiscoveredGame for each game directory.
/// `existing_paths` is from `SELECT path FROM games` for incremental skip.
pub async fn run_scan<F>(
    roots: Vec<(PathBuf, u8)>, // (root_path, depth)
    existing_paths: HashSet<PathBuf>,
    incremental: bool,
    ctx: Arc<ScanContext>,
    on_progress: F,
) -> Result<Vec<DiscoveredGame>, ScanError>
where F: Fn(ScanProgress) + Send + Sync + 'static
{
    // 1. Enumerate all game directories first (so we know `total`)
    let game_dirs = walker::collect_game_dirs(&roots, &ctx.cancel)?;
    let total = game_dirs.len();
    let mut discovered = Vec::with_capacity(total);

    for (i, dir) in game_dirs.into_iter().enumerate() {
        if ctx.cancel.load(std::sync::atomic::Ordering::Relaxed) {
            on_progress(ScanProgress {
                current_dir: dir.to_string_lossy().into(),
                completed: i,
                total,
                status: ScanStatus::Cancelled,
            });
            return Err(ScanError::Cancelled);
        }
        // Skip set check
        if ctx.skip.lock().unwrap().contains(&dir) {
            on_progress(ScanProgress {
                current_dir: dir.to_string_lossy().into(),
                completed: i + 1,
                total,
                status: ScanStatus::Running,
            });
            continue;
        }
        // Incremental: skip if already in DB
        if incremental && existing_paths.contains(&dir) {
            on_progress(ScanProgress {
                current_dir: dir.to_string_lossy().into(),
                completed: i + 1,
                total,
                status: ScanStatus::Running,
            });
            continue;
        }
        // Find best exe
        let exe = walker::pick_best_exe(&dir);
        let raw = dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        discovered.push(DiscoveredGame {
            path: dir.clone(),
            raw_name: raw.clone(),
            clean_name: clean_title(&raw),
            executable: exe,
        });
        on_progress(ScanProgress {
            current_dir: dir.to_string_lossy().into(),
            completed: i + 1,
            total,
            status: ScanStatus::Running,
        });
    }
    on_progress(ScanProgress {
        current_dir: String::new(),
        completed: total,
        total,
        status: ScanStatus::Completed,
    });
    Ok(discovered)
}
```

2. **`walker::collect_game_dirs`** + **`walker::pick_best_exe`** — implement as documented in Task 1.

3. **`src-tauri/src/lib.rs`** — append `mod scan;` after existing `mod metadata;` (don't register commands yet — 02d does that).

4. cargo check + test all green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/scan/mod.rs && \
grep -q "pub async fn run_scan" src-tauri/src/scan/mod.rs && \
grep -q "ScanContext" src-tauri/src/scan/mod.rs && \
grep -q "collect_game_dirs" src-tauri/src/scan/walker.rs && \
grep -q "pick_best_exe" src-tauri/src/scan/walker.rs && \
grep -q "mod scan" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

## Commit Protocol

2 atomic commits:
- `feat(02-02c): add scan/types + walker + exe_score (with tests)`
- `feat(02-02c): add scan orchestrator (run_scan with progress callback)`

## Success

✅ 4 个 Rust 文件就位，walker / exe_score / orchestrator 各自有单元测试，cargo check + lib tests 全绿。02d 现在可调 `scan::run_scan` + `scan::ScanContext` 包装 Tauri command。
