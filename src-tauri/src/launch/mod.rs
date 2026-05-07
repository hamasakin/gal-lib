//! LE-based launch + process tracking subsystem.
//!
//! Phase 3 module group:
//!   - `le` (03b): Locale Emulator path detection + persistence (this plan).
//!   - `process_track` (03c, future): track LE-spawned game processes after
//!     LEProc itself exits (parent-orphan PID resolution + exit watcher).
//!
//! No Tauri command handlers are defined here — they live in `commands.rs`
//! (registered by the 03d plan). This module is library-pure, which keeps
//! `cargo test --lib` cheap and avoids dragging the Tauri runtime into
//! unit tests.
pub mod le;
pub mod orchestrator;
pub mod process_track;
pub mod session;
