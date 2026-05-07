//! Filesystem scan engine — module root.
//!
//! Sub-modules:
//!   - `types`     : ScanProgress / ScanStatus / DiscoveredGame / ScanError
//!   - `exe_score` : pure scoring heuristic for main-exe selection
//!   - `walker`    : game-directory enumeration + per-game exe picker
//!
//! The orchestrator (`run_scan` + `ScanContext`) is added in Task 2 of plan 02c.

pub mod exe_score;
pub mod types;
pub mod walker;

pub use types::{DiscoveredGame, ScanError, ScanProgress, ScanStatus};
