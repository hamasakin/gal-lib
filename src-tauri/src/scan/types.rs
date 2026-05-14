//! Shared data types for the filesystem scan engine.
//!
//! `ScanProgress` is the payload emitted via the caller-supplied progress
//! callback (02d will wire this to the Tauri `scan-progress` event).
//! `DiscoveredGame` is the per-directory result yielded by `run_scan`;
//! 02d/02e is responsible for persisting it to the `games` table.

use serde::Serialize;
use std::path::PathBuf;

/// Progress event emitted during a scan run.
///
/// `current_dir` is the absolute path of the directory currently being
/// processed (or empty string for the terminal `Completed` event).
/// `completed`/`total` count game directories (not arbitrary FS entries).
/// `phase` distinguishes the two pipeline stages so the frontend can show
/// distinct copy ("扫描目录中…" vs "获取元数据 — …"):
///   - `Discovering` during `run_scan` (filesystem walk + exe picking)
///   - `Enriching` during the placeholder INSERT + per-game metadata fetch
#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub current_dir: String,
    pub completed: usize,
    pub total: usize,
    pub status: ScanStatus,
    pub phase: ScanPhase,
}

/// Lifecycle status of a scan run, serialized as lowercase strings to
/// match the JS-side discriminated union (`"running" | "completed" | ...`).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScanStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

/// Sub-phase of a scan run. Orthogonal to `ScanStatus`: a `Running` event
/// may be in either phase; terminal events carry the last active phase
/// (frontend only differentiates copy on `Running`).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScanPhase {
    /// Pass 1 — directory walk + exe selection (`run_scan`).
    Discovering,
    /// Pass 2 — placeholder INSERT + per-game metadata pipeline.
    Enriching,
}

/// One game directory discovered during a scan, ready for metadata pipeline.
///
/// `path` is the absolute directory path (also used as the unique
/// `games.path` DB column for incremental dedup).
/// `raw_name` is the on-disk directory basename (preserved for debugging).
/// `clean_name` is the result of `title_clean::clean_title(raw_name)`,
/// suitable as a search query for Bangumi/VNDB.
/// `executable` is the best-scoring `.exe` found inside the directory,
/// or `None` if no candidates scored above zero.
#[derive(Debug, Clone)]
pub struct DiscoveredGame {
    pub path: PathBuf,
    pub raw_name: String,
    pub clean_name: String,
    pub executable: Option<PathBuf>,
}

/// Errors surfaced by the scan engine.
///
/// `Cancelled` is the cooperative-cancellation signal raised when the
/// caller flips the `Arc<AtomicBool>` cancel flag mid-scan; callers
/// should treat it as a clean stop, not a failure.
#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("walk: {0}")]
    Walk(#[from] walkdir::Error),
    #[error("cancelled")]
    Cancelled,
}
