//! Filesystem scan engine — module root + orchestrator.
//!
//! Sub-modules:
//!   - `types`     : ScanProgress / ScanStatus / DiscoveredGame / ScanError
//!   - `exe_score` : pure scoring heuristic for main-exe selection
//!   - `walker`    : game-directory enumeration + per-game exe picker
//!
//! The orchestrator (`run_scan`) is intentionally Tauri-runtime-agnostic:
//! it accepts a caller-supplied progress callback (`Fn(ScanProgress)`) so the
//! same code path is reachable from a unit test, a Tauri command (02d),
//! or a future CLI binary. 02d is responsible for translating the callback
//! into `app.emit("scan-progress", payload)`.

pub mod exe_score;
pub mod types;
pub mod walker;

use crate::title_clean::clean_title;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub use types::{DiscoveredGame, ScanError, ScanPhase, ScanProgress, ScanStatus};

/// Shared cancellation + skip handle for one scan run.
///
/// `cancel` is polled at the top of every game-directory iteration; flipping
/// it to `true` causes the next iteration to return `Err(ScanError::Cancelled)`
/// after emitting a final `Cancelled` progress event.
///
/// `skip` is a set of fully-qualified game directory paths to silently skip
/// during iteration (UI "skip this directory" button writes here). Skipped
/// directories still increment `completed` so the progress bar advances.
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

impl Default for ScanContext {
    fn default() -> Self {
        Self::new()
    }
}

/// Walk all `roots` and yield one `DiscoveredGame` per game directory.
///
/// Two-pass design:
///   1. Enumerate every game directory across all roots first (so `total`
///      is known up front and progress fractions are stable).
///   2. For each game directory, optionally skip (via `skip` set or
///      `incremental` + `existing_paths` membership), otherwise pick the
///      best executable and yield a `DiscoveredGame`.
///
/// `existing_paths` is the set returned by `SELECT path FROM games` —
/// 02d is responsible for fetching it before calling `run_scan`.
///
/// `on_progress` is invoked synchronously from the iteration thread; the
/// caller is responsible for any throttling / debouncing / event emission.
///
/// On cancellation, emits one final `ScanStatus::Cancelled` event with the
/// current `completed` count and returns `Err(ScanError::Cancelled)`.
///
/// On clean completion, `run_scan` emits only `Running` events — it does NOT
/// emit a terminal `Completed` event, because discovery finishing is not the
/// same as the pipeline finishing. The caller (commands.rs::start_scan) owns
/// the terminal event after the ingest loop drains.
pub async fn run_scan<F>(
    roots: Vec<(PathBuf, u8)>,
    existing_paths: HashSet<PathBuf>,
    incremental: bool,
    ctx: Arc<ScanContext>,
    on_progress: F,
) -> Result<Vec<DiscoveredGame>, ScanError>
where
    F: Fn(ScanProgress) + Send + Sync + 'static,
{
    // Pass 1 — enumerate every game directory across all roots.
    let game_dirs = walker::collect_game_dirs(&roots, &ctx.cancel)?;
    let total = game_dirs.len();
    let mut discovered: Vec<DiscoveredGame> = Vec::with_capacity(total);

    // Pass 2 — process each game dir.
    for (i, dir) in game_dirs.into_iter().enumerate() {
        // Cancel check at the TOP of each iteration (locked rule SCAN-06).
        if ctx.cancel.load(Ordering::Relaxed) {
            on_progress(ScanProgress {
                current_dir: dir.to_string_lossy().into_owned(),
                completed: i,
                total,
                status: ScanStatus::Cancelled,
                phase: ScanPhase::Discovering,
            });
            return Err(ScanError::Cancelled);
        }

        // Caller-requested skip set (UI "skip this directory" button).
        // Lock briefly, copy-out membership, drop the guard before doing FS I/O.
        let skipped_by_user = {
            let g = ctx.skip.lock().expect("scan skip mutex poisoned");
            g.contains(&dir)
        };
        if skipped_by_user {
            on_progress(ScanProgress {
                current_dir: dir.to_string_lossy().into_owned(),
                completed: i + 1,
                total,
                status: ScanStatus::Running,
                phase: ScanPhase::Discovering,
            });
            continue;
        }

        // Incremental mode — silently skip directories already in the DB.
        if incremental && existing_paths.contains(&dir) {
            on_progress(ScanProgress {
                current_dir: dir.to_string_lossy().into_owned(),
                completed: i + 1,
                total,
                status: ScanStatus::Running,
                phase: ScanPhase::Discovering,
            });
            continue;
        }

        // Find the best executable inside this game dir.
        let exe = walker::pick_best_exe(&dir);
        let raw = dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let clean = clean_title(&raw);
        discovered.push(DiscoveredGame {
            path: dir.clone(),
            raw_name: raw,
            clean_name: clean,
            executable: exe,
        });

        on_progress(ScanProgress {
            current_dir: dir.to_string_lossy().into_owned(),
            completed: i + 1,
            total,
            status: ScanStatus::Running,
            phase: ScanPhase::Discovering,
        });
    }

    Ok(discovered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex as StdMutex;

    fn temp_dir(label: &str) -> PathBuf {
        let mut d = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|x| x.as_nanos())
            .unwrap_or(0);
        d.push(format!("gal-lib-runscan-{}-{}-{}", label, pid, nanos));
        fs::create_dir_all(&d).expect("create temp dir");
        d
    }

    /// Collector for progress events emitted during a test scan.
    type Collector = Arc<StdMutex<Vec<ScanProgress>>>;
    fn make_collector() -> (Collector, impl Fn(ScanProgress) + Send + Sync + 'static) {
        let buf: Collector = Arc::new(StdMutex::new(Vec::new()));
        let buf2 = buf.clone();
        let cb = move |p: ScanProgress| {
            buf2.lock().unwrap().push(p);
        };
        (buf, cb)
    }

    #[tokio::test]
    async fn run_scan_emits_running_then_completed() {
        // Layout: root/Game1, root/Game2 (both empty — no exe to find).
        let root = temp_dir("happy");
        fs::create_dir_all(root.join("Game1")).unwrap();
        fs::create_dir_all(root.join("Game2")).unwrap();

        let ctx = Arc::new(ScanContext::new());
        let (buf, cb) = make_collector();

        let result = run_scan(
            vec![(root.clone(), 1)],
            HashSet::new(),
            false,
            ctx,
            cb,
        )
        .await
        .expect("happy path scan");

        assert_eq!(result.len(), 2, "should discover 2 games");
        for g in &result {
            assert!(g.executable.is_none(), "no exes were created in test fixture");
            assert!(!g.raw_name.is_empty());
            assert_eq!(g.clean_name, g.raw_name); // no noise tokens to clean
        }

        let events = buf.lock().unwrap();
        // run_scan no longer emits a terminal Completed event — that's the
        // caller's responsibility (commands.rs::start_scan, after ingest).
        // Expect exactly one Running event per discovered dir, nothing else.
        assert_eq!(events.len(), 2, "events: {:?}", *events);
        for ev in events.iter() {
            assert!(
                matches!(ev.status, ScanStatus::Running),
                "expected only Running events, got {:?}",
                ev.status
            );
        }
        assert_eq!(events[1].completed, 2);
        assert_eq!(events[1].total, 2);
    }

    #[tokio::test]
    async fn run_scan_skips_existing_paths_when_incremental() {
        let root = temp_dir("incr");
        let g1 = root.join("Existing");
        let g2 = root.join("Newcomer");
        fs::create_dir_all(&g1).unwrap();
        fs::create_dir_all(&g2).unwrap();

        let mut existing = HashSet::new();
        existing.insert(g1.clone());

        let ctx = Arc::new(ScanContext::new());
        let (_buf, cb) = make_collector();

        let result = run_scan(
            vec![(root.clone(), 1)],
            existing,
            true, // incremental
            ctx,
            cb,
        )
        .await
        .expect("incremental scan");

        // Only Newcomer should be discovered; Existing is silently skipped.
        assert_eq!(result.len(), 1, "incremental should yield 1 (got {})", result.len());
        assert_eq!(
            result[0].path.file_name().unwrap().to_string_lossy(),
            "Newcomer"
        );
    }

    #[tokio::test]
    async fn run_scan_honors_cancel_flag() {
        let root = temp_dir("cancel");
        for i in 0..3 {
            fs::create_dir_all(root.join(format!("g{}", i))).unwrap();
        }

        let ctx = Arc::new(ScanContext::new());
        ctx.cancel.store(true, Ordering::Relaxed); // pre-set
        let (buf, cb) = make_collector();

        let result = run_scan(
            vec![(root.clone(), 1)],
            HashSet::new(),
            false,
            ctx,
            cb,
        )
        .await;

        // Pre-set cancel triggers ScanError::Cancelled inside collect_game_dirs.
        assert!(matches!(result, Err(ScanError::Cancelled)));
        // No progress events emitted (we never got past Pass 1).
        let events = buf.lock().unwrap();
        assert!(events.is_empty(), "expected no events, got {:?}", *events);
    }

    #[tokio::test]
    async fn run_scan_skips_via_skip_set() {
        let root = temp_dir("skipset");
        let kept = root.join("Kept");
        let skipped = root.join("Skipped");
        fs::create_dir_all(&kept).unwrap();
        fs::create_dir_all(&skipped).unwrap();

        let ctx = Arc::new(ScanContext::new());
        ctx.skip.lock().unwrap().insert(skipped.clone());
        let (_buf, cb) = make_collector();

        let result = run_scan(
            vec![(root.clone(), 1)],
            HashSet::new(),
            false,
            ctx,
            cb,
        )
        .await
        .expect("skip-set scan");

        assert_eq!(result.len(), 1, "should yield only the non-skipped dir");
        assert_eq!(
            result[0].path.file_name().unwrap().to_string_lossy(),
            "Kept"
        );
    }
}
