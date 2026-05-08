//! Process tracking for LE-launched games.
//!
//! ## Why we cannot just `wait()` on LEProc
//!
//! Locale Emulator's `LEProc.exe` is a *launcher*: it spawns the real game
//! process under a transcoded locale, then exits. Waiting on LEProc itself
//! returns instantly and tells us nothing about how long the user played.
//! We therefore have to:
//!   1. Spawn LEProc with `-runas <profile> <game_exe> [args]` (`spawn_le`).
//!   2. Poll the process table for ~30s, looking for a process whose
//!      basename matches `game_exe` (`find_game_pid`). LE's own subprocess
//!      keeps the original exe name, so basename matching is reliable.
//!   3. Open that PID with `OpenProcess(SYNCHRONIZE | QUERY_LIMITED_INFO)`,
//!      `WaitForSingleObject(handle, INFINITE)` inside a `spawn_blocking`
//!      task so the tokio runtime stays free, then read the exit code.
//!
//! ## Polling parameters
//!
//! - `LE_GRACE_MS` (1500ms): LE typically forks within 1s; we sleep first
//!   to avoid racing it before the child even appears.
//! - `POLL_INTERVAL_MS` (500ms): cheap relative to `WaitForSingleObject`
//!   and gives ~2 samples/sec — plenty for human-perceptible launches.
//! - `MAX_POLL_ATTEMPTS` (60): 60 * 500ms = 30s total budget. After this
//!   we surface `ProcessError::Timeout` so the caller can mark the session
//!   `launch_failed`.
//!
//! ## Platform note
//!
//! This module is Win32-only by design (LE itself only runs on Windows;
//! see CLAUDE.md). No `cfg!` guards needed because the project does not
//! compile for other targets.

use std::path::Path;
use std::time::Duration;

use sysinfo::{Pid, ProcessesToUpdate, System};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, WaitForSingleObject, INFINITE,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};

const POLL_INTERVAL_MS: u64 = 500;
const MAX_POLL_ATTEMPTS: u32 = 60; // 60 * 0.5s = 30s timeout
const LE_GRACE_MS: u64 = 1500; // wait before first scan to let LE spawn

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("game process not found within timeout")]
    Timeout,
    #[error("win32: {0}")]
    Win32(String),
}

/// Spawn `LEProc.exe -runas <profile> <game_exe> [args...]` with `cwd`.
///
/// Returns the LEProc PID, *not* the game's PID. Caller must follow up with
/// `find_game_pid` to discover the actual game process. Synchronous on
/// purpose: `Command::spawn` already returns immediately on Windows.
pub fn spawn_le(
    le_path: &Path,
    profile: &str,
    game_exe: &Path,
    args: &[&str],
    cwd: &Path,
) -> std::io::Result<u32> {
    let mut cmd = std::process::Command::new(le_path);
    cmd.arg("-runas").arg(profile).arg(game_exe);
    for a in args {
        cmd.arg(a);
    }
    cmd.current_dir(cwd);
    let child = cmd.spawn()?;
    Ok(child.id())
}

/// Spawn the game executable directly (no LE wrapper). Returns the game's
/// own PID — caller can pass it straight to `wait_for_exit`, no
/// `find_game_pid` polling needed since there is no launcher fork in the way.
pub fn spawn_direct(
    game_exe: &Path,
    args: &[&str],
    cwd: &Path,
) -> std::io::Result<u32> {
    let mut cmd = std::process::Command::new(game_exe);
    for a in args {
        cmd.arg(a);
    }
    cmd.current_dir(cwd);
    let child = cmd.spawn()?;
    Ok(child.id())
}

/// Poll the process table until a process with basename matching
/// `game_exe.file_name()` appears (case-insensitive). Returns its PID.
///
/// Falls back to a `starts_with(stem)` match so renamed/aliased binaries
/// (e.g. `game.exe` vs `game-1.0.exe`) still resolve. Returns
/// `ProcessError::Timeout` if no match within ~30s.
pub async fn find_game_pid(game_exe: &Path) -> Result<u32, ProcessError> {
    let target_name = game_exe
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if target_name.is_empty() {
        return Err(ProcessError::Win32("empty game_exe basename".into()));
    }
    let target_stem = target_name.trim_end_matches(".exe").to_string();

    // Brief grace window so LE has a chance to fork before our first scan.
    tokio::time::sleep(Duration::from_millis(LE_GRACE_MS)).await;

    let mut sys = System::new();
    for _ in 0..MAX_POLL_ATTEMPTS {
        sys.refresh_processes(ProcessesToUpdate::All, true);
        for (pid, proc) in sys.processes() {
            let name = proc.name().to_string_lossy().to_lowercase();
            // Exact match first; fall back to stem-prefix to tolerate
            // versioned/aliased binaries.
            if name == target_name || (!target_stem.is_empty() && name.starts_with(&target_stem)) {
                return Ok(pid.as_u32());
            }
        }
        tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
    }
    Err(ProcessError::Timeout)
}

/// Block until process `pid` exits, then read its exit code.
///
/// `WaitForSingleObject(handle, INFINITE)` parks the thread, so we run it
/// inside `spawn_blocking` to keep the tokio runtime responsive.
/// `GetExitCodeProcess` is best-effort: if it fails we still return Ok with
/// `-1` because the *exit itself* is what the session lifecycle cares about.
pub async fn wait_for_exit(pid: u32) -> Result<i32, ProcessError> {
    tokio::task::spawn_blocking(move || -> Result<i32, ProcessError> {
        unsafe {
            let handle: HANDLE = OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                pid,
            )
            .map_err(|e| ProcessError::Win32(format!("OpenProcess: {}", e)))?;
            if handle.is_invalid() {
                return Err(ProcessError::Win32("invalid handle".into()));
            }
            // INFINITE: we already established the process is alive when
            // find_game_pid returned its PID; if it dies between then and
            // now, WaitForSingleObject returns immediately with WAIT_OBJECT_0.
            WaitForSingleObject(handle, INFINITE);
            let mut exit_code: u32 = 0;
            // Best-effort: we already proved the process exited; if reading
            // its exit code fails we still want to return Ok so the session
            // lifecycle can finalize.
            let exit = match GetExitCodeProcess(handle, &mut exit_code as *mut u32) {
                Ok(_) => exit_code as i32,
                Err(_) => -1,
            };
            // Releasing the handle cannot meaningfully fail here; ignore.
            let _ = CloseHandle(handle);
            Ok(exit)
        }
    })
    .await
    .map_err(|e| ProcessError::Win32(format!("join: {}", e)))?
}

/// Force-terminate the process `pid` via `sysinfo::Process::kill` (which
/// wraps `TerminateProcess` on Windows). Used by the "强制结束" UI button
/// (wired in 03d). Returns Timeout if the PID is no longer in the table.
pub fn kill_pid(pid: u32) -> Result<(), ProcessError> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    if let Some(proc) = sys.process(Pid::from_u32(pid)) {
        if proc.kill() {
            Ok(())
        } else {
            Err(ProcessError::Win32("kill returned false".into()))
        }
    } else {
        // Reuse Timeout for "process gone" — it semantically means
        // "we couldn't find the PID"; the caller treats both as terminal.
        Err(ProcessError::Timeout)
    }
}
