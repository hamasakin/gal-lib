//! End-to-end launch orchestration glue (Phase 3, 03d).
//!
//! Stitches together the four launch building blocks defined in 03a-03c into
//! a single `launch_game(LaunchInputs)` entry-point that the Tauri command
//! layer (commands.rs) drives:
//!
//! ```text
//!   prepare_launch (DB read + LE path resolve + cwd default)
//!         ↓
//!   session::start_session   (status='starting')
//!         ↓
//!   process_track::spawn_le  (LEProc -runas <profile> <exe> <args>)
//!         ↓               ── tokio::spawn from here ──
//!   process_track::find_game_pid  (poll ~30s for the real game PID)
//!         ↓
//!   session::mark_running    (status='running')
//!         ↓
//!   process_track::wait_for_exit (WaitForSingleObject in spawn_blocking)
//!         ↓
//!   session::end_session     (status='completed', + total_playtime_sec)
//! ```
//!
//! Failures map to terminal session states:
//!   - `spawn_le` IO error  →  `session::mark_failed`
//!   - `find_game_pid` timeout → `session::mark_failed`
//!   - `wait_for_exit` error → `end_session(_, -1)` (we still want playtime credited)
//!
//! ## Why a `JoinHandle` is returned
//!
//! The synchronous part (`prepare_launch` → `start_session` → `spawn_le`)
//! must complete BEFORE the command returns to the frontend so the UI can
//! show the active-session indicator immediately. The wait-for-exit phase
//! can take hours; it runs in a detached `tokio::spawn` and the handle is
//! handed back to the command layer so:
//!   1. `end_active_session` can `.abort()` the wait when the user clicks
//!      "强制结束" (after `kill_pid` cleans up the game process).
//!   2. The command's own follow-up task can `.await` the join to know
//!      precisely when state should be cleared.

use std::path::PathBuf;

use serde::Serialize;
use sqlx::SqlitePool;

use super::{le, process_track, session};

/// Snapshot of the in-flight game session. Sent over the
/// `active-session-changed` Tauri event so the frontend can render the
/// active-session bar without re-querying.
#[derive(Debug, Clone, Serialize)]
pub struct ActiveSession {
    pub session_id: i64,
    pub game_id: i64,
    pub game_name: String,
    /// RFC3339 UTC timestamp; same shape as `sessions.started_at`.
    pub started_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum OrchError {
    #[error("db: {0}")]
    Db(#[from] sqlx::Error),
    #[error("le: {0}")]
    Le(#[from] le::LeError),
    #[error("process: {0}")]
    Process(#[from] process_track::ProcessError),
    #[error("session: {0}")]
    Session(#[from] session::SessionError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("game not found")]
    NotFound,
    #[error("game has no executable_path")]
    NoExecutable,
    #[error("session already active")]
    AlreadyActive,
}

/// Inputs the command layer must supply per-launch. `pool` and `data_dir`
/// come from `AppPaths`; `game_id` comes from the frontend.
pub struct LaunchInputs {
    pub data_dir: PathBuf,
    pub pool: SqlitePool,
    pub game_id: i64,
}

/// Synchronous prep step (DB read + LE resolve). Split out so command-layer
/// validation can fail fast — before a `sessions` row is created — when the
/// game has no executable or LE is missing.
///
/// Returns: (le_path, le_profile, exe_path, args_vec, cwd_path, game_name).
pub async fn prepare_launch(
    inputs: &LaunchInputs,
) -> Result<(PathBuf, String, PathBuf, Vec<String>, PathBuf, String), OrchError> {
    // Single round-trip — touched columns mirror the games-table additions
    // from 03a's schema-v3 migration (`le_profile`, `launch_args`, `cwd`).
    let row: (String, Option<String>, String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT name, executable_path, le_profile, launch_args, cwd FROM games WHERE id=?",
    )
    .bind(inputs.game_id)
    .fetch_optional(&inputs.pool)
    .await?
    .ok_or(OrchError::NotFound)?;

    let (name, exe_opt, profile, args_opt, cwd_opt) = row;
    let exe = exe_opt.ok_or(OrchError::NoExecutable)?;
    let exe_path = PathBuf::from(&exe);

    // launch_args: whitespace-split. 03 CONTEXT explicitly chose the simple
    // shell-style splitter — quoted arguments are a P5 concern.
    let args: Vec<String> = args_opt
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .map(String::from)
        .collect();

    // cwd default: parent of executable_path. NULL cwd column means "auto",
    // which matches the 03 CONTEXT default-and-overridable contract.
    let cwd_path: PathBuf = cwd_opt.map(PathBuf::from).unwrap_or_else(|| {
        exe_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    });

    // Resolve LE last — it's the most likely failure point on a fresh install,
    // and we want the games-table read to validate first so a missing-exe
    // game surfaces NoExecutable instead of LE::NotFound.
    let le_path = le::resolve_le_path(&inputs.data_dir)?;
    Ok((le_path, profile, exe_path, args, cwd_path, name))
}

/// Result returned to the command layer.
///
/// - `session_id` / `active`: persisted state ready to put into
///   `ActiveSessionState` and emit over `active-session-changed`.
/// - `game_pid`: captured if `find_game_pid` succeeded inside the spawned
///   task. **Note:** this is `None` at return time; the spawned task fills
///   it via the channel-less path used by the command layer wrapper. See
///   the simpler `(session_id, ActiveSession, JoinHandle)` tuple below.
/// - `join`: handle for the wait-for-exit task. The command layer can
///   `.abort()` it on user-initiated cancel and `.await` it for natural exit.
pub type LaunchHandle = (
    i64,
    ActiveSession,
    tokio::task::JoinHandle<Result<(), OrchError>>,
);

/// End-to-end launch + asynchronous wait.
///
/// Synchronously: prepares inputs, INSERTs the `sessions` row, spawns LEProc.
/// Asynchronously (in the returned `JoinHandle`): finds game PID, marks the
/// session running, waits for exit, finalizes the row.
///
/// The synchronous half completes in <1s on a healthy install. The async
/// half runs for the duration of the play-session (potentially hours).
pub async fn launch_game(inputs: LaunchInputs) -> Result<LaunchHandle, OrchError> {
    let (le_path, profile, exe_path, args, cwd, game_name) = prepare_launch(&inputs).await?;

    let session_id = session::start_session(&inputs.pool, inputs.game_id).await?;
    let started_at = chrono::Utc::now().to_rfc3339();
    let active = ActiveSession {
        session_id,
        game_id: inputs.game_id,
        game_name: game_name.clone(),
        started_at: started_at.clone(),
    };

    // Spawn LEProc synchronously so we know upfront whether the launch
    // command itself failed (bad LE path, OS-level spawn failure). On
    // failure we still mark the session and surface the IO error — the
    // session row is the single source of truth for failed launches.
    let pool = inputs.pool.clone();
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let spawn_result = process_track::spawn_le(&le_path, &profile, &exe_path, &arg_refs, &cwd);

    let exe_for_pid = exe_path.clone();
    let join: tokio::task::JoinHandle<Result<(), OrchError>> = tokio::spawn(async move {
        match spawn_result {
            Ok(_le_pid) => {
                // Find the real game PID (LEProc exits ~immediately after
                // forking; we poll for the descendant matching exe basename).
                match process_track::find_game_pid(&exe_for_pid).await {
                    Ok(game_pid) => {
                        session::mark_running(&pool, session_id).await?;
                        // wait_for_exit is INFINITE; its only failure mode
                        // is OpenProcess (process gone before we attached).
                        // Default to -1 in that case; lifecycle still finalizes.
                        let exit_code =
                            process_track::wait_for_exit(game_pid).await.unwrap_or(-1);
                        session::end_session(&pool, session_id, exit_code).await?;
                    }
                    Err(_) => {
                        // 30s polling timed out (or PID resolution failed).
                        // Caller's UI sees status='launch_failed' on next read.
                        session::mark_failed(&pool, session_id).await?;
                    }
                }
            }
            Err(_) => {
                // LEProc spawn failed (binary missing, permission denied, etc.).
                session::mark_failed(&pool, session_id).await?;
            }
        }
        Ok(())
    });

    Ok((session_id, active, join))
}

#[cfg(test)]
mod tests {
    //! Compile-only smoke: ensures the orchestrator entry-points keep their
    //! signatures aligned with `commands.rs`. Real end-to-end coverage needs
    //! a live LE install, which is exercised manually before a release.
    use super::*;

    #[allow(dead_code)]
    fn _signatures_compile(pool: &SqlitePool, data_dir: PathBuf) {
        let inputs = LaunchInputs {
            data_dir: data_dir.clone(),
            pool: pool.clone(),
            game_id: 1,
        };
        let _ = prepare_launch(&inputs);
        let _ = launch_game(LaunchInputs {
            data_dir,
            pool: pool.clone(),
            game_id: 1,
        });
    }
}
