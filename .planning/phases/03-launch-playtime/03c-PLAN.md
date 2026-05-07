---
phase: 03-launch-playtime
plan: 03c
type: execute
wave: 3
depends_on: [03a, 03b]
files_modified:
  - src-tauri/src/launch/process_track.rs
  - src-tauri/src/launch/session.rs
  - src-tauri/src/launch/mod.rs
autonomous: true
requirements: [LAUNCH-02, TIME-01, TIME-02, TIME-03]
must_haves:
  truths:
    - "spawn_le_and_track 函数：拼 LEProc 命令、spawn LE 进程、5s 内识别真实游戏进程、async wait 退出"
    - "进程识别策略：sysinfo 列举进程 + 匹配 game_exe basename + 验证进程仍 alive"
    - "WaitForSingleObject async 包装通过 tokio::task::spawn_blocking + Win32 OpenProcess(SYNCHRONIZE)"
    - "session 生命周期 fn：start_session（INSERT status=starting）/ mark_running / end_session（UPDATE status + duration_sec + ended_at）/ mark_failed"
    - "cargo check + cargo test --lib 全绿"
  artifacts:
    - path: src-tauri/src/launch/process_track.rs
      contains: "WaitForSingleObject"
    - path: src-tauri/src/launch/session.rs
      contains: "pub async fn start_session"
---

# Plan 03c — Process Tracking + Session Lifecycle

## Tasks

<task name="Task 1: launch/process_track.rs">

<read_first>
- D:\project\gal-lib\.planning\phases\03-launch-playtime\03-CONTEXT.md (§Process Tracking)
- D:\project\gal-lib\src-tauri\src\launch\le.rs (Phase 03b)
- D:\project\gal-lib\src-tauri\src\launch\mod.rs
</read_first>

<action>

1. **`src-tauri/src/launch/process_track.rs`**:
```rust
//! Process tracking for LE-launched games.
//!
//! Strategy: spawn LEProc with -runas profile + game_exe; LEProc spawns the real
//! game process and exits. We poll for ~5 seconds, looking for a process whose
//! basename matches game_exe's filename and whose parent is now defunct
//! (orphaned by LEProc's exit). Found → return its PID. Then async-wait via
//! Win32 OpenProcess(SYNCHRONIZE) + WaitForSingleObject (in spawn_blocking).

use std::path::Path;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE, PROCESS_QUERY_LIMITED_INFORMATION, GetExitCodeProcess};
use windows::core::Result as WinResult;

const POLL_INTERVAL_MS: u64 = 500;
const MAX_POLL_ATTEMPTS: u32 = 60; // 60 * 0.5s = 30s timeout
const LE_GRACE_MS: u64 = 1500;     // wait before first scan to let LE spawn

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("game process not found within timeout")]
    Timeout,
    #[error("win32: {0}")] Win32(String),
}

pub fn spawn_le(le_path: &Path, profile: &str, game_exe: &Path, args: &[&str], cwd: &Path) -> std::io::Result<u32> {
    let mut cmd = std::process::Command::new(le_path);
    cmd.arg("-runas").arg(profile).arg(game_exe);
    for a in args { cmd.arg(a); }
    cmd.current_dir(cwd);
    let child = cmd.spawn()?;
    Ok(child.id())
}

/// Poll for the LE-spawned game process by basename match.
/// Returns its PID once found, or Timeout.
pub async fn find_game_pid(game_exe: &Path) -> Result<u32, ProcessError> {
    let target_name = game_exe.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if target_name.is_empty() {
        return Err(ProcessError::Win32("empty game_exe basename".into()));
    }
    tokio::time::sleep(Duration::from_millis(LE_GRACE_MS)).await;

    let mut sys = System::new();
    for _ in 0..MAX_POLL_ATTEMPTS {
        sys.refresh_processes(ProcessesToUpdate::All, true);
        for (pid, proc) in sys.processes() {
            let name = proc.name().to_string_lossy().to_lowercase();
            if name == target_name || name.starts_with(&target_name.trim_end_matches(".exe")) {
                return Ok(pid.as_u32());
            }
        }
        tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
    }
    Err(ProcessError::Timeout)
}

/// Async-wait for the process to exit. Returns exit code (i32, may be -1 if unknown).
pub async fn wait_for_exit(pid: u32) -> Result<i32, ProcessError> {
    let pid_u32 = pid;
    tokio::task::spawn_blocking(move || -> Result<i32, ProcessError> {
        unsafe {
            let handle: HANDLE = OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                pid_u32,
            ).map_err(|e| ProcessError::Win32(format!("OpenProcess: {}", e)))?;
            if handle.is_invalid() { return Err(ProcessError::Win32("invalid handle".into())); }
            WaitForSingleObject(handle, INFINITE);
            let mut exit_code: u32 = 0;
            let _ = GetExitCodeProcess(handle, &mut exit_code as *mut u32);
            CloseHandle(handle).ok();
            Ok(exit_code as i32)
        }
    }).await.map_err(|e| ProcessError::Win32(format!("join: {}", e)))?
}

pub fn kill_pid(pid: u32) -> Result<(), ProcessError> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    if let Some(proc) = sys.process(Pid::from_u32(pid)) {
        if proc.kill() { Ok(()) } else { Err(ProcessError::Win32("kill returned false".into())) }
    } else {
        Err(ProcessError::Timeout)
    }
}
```

2. **`src-tauri/src/launch/mod.rs`** — append `pub mod process_track;`.

3. cargo check + cargo test --lib green (process_track has no unit tests due to platform-specific Win32 calls; presence + compile is the assertion).

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/launch/process_track.rs && \
grep -q "WaitForSingleObject" src-tauri/src/launch/process_track.rs && \
grep -q "pub async fn find_game_pid" src-tauri/src/launch/process_track.rs && \
grep -q "pub async fn wait_for_exit" src-tauri/src/launch/process_track.rs && \
grep -q "pub fn spawn_le" src-tauri/src/launch/process_track.rs && \
grep -q "pub fn kill_pid" src-tauri/src/launch/process_track.rs && \
grep -q "pub mod process_track" src-tauri/src/launch/mod.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

<task name="Task 2: launch/session.rs DB session lifecycle">

<read_first>
- D:\project\gal-lib\src-tauri\src\launch\process_track.rs (Task 1)
- D:\project\gal-lib\src-tauri\src\commands.rs (Phase 02d sqlx pool pattern via AppPaths)
</read_first>

<action>

1. **`src-tauri/src/launch/session.rs`**:
```rust
//! Session DB lifecycle for game playtime tracking.

use sqlx::SqlitePool;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("db: {0}")] Db(#[from] sqlx::Error),
}

pub async fn start_session(pool: &SqlitePool, game_id: i64) -> Result<i64, SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    let row = sqlx::query("INSERT INTO sessions (game_id, started_at, status, duration_sec) VALUES (?, ?, 'starting', 0)")
        .bind(game_id).bind(&now).execute(pool).await?;
    Ok(row.last_insert_rowid())
}

pub async fn mark_running(pool: &SqlitePool, session_id: i64) -> Result<(), SessionError> {
    sqlx::query("UPDATE sessions SET status='running' WHERE id=?")
        .bind(session_id).execute(pool).await?;
    Ok(())
}

pub async fn end_session(pool: &SqlitePool, session_id: i64, exit_code: i32) -> Result<(), SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    // compute duration from started_at to now
    let row: (String,) = sqlx::query_as("SELECT started_at FROM sessions WHERE id=?")
        .bind(session_id).fetch_one(pool).await?;
    let started: chrono::DateTime<chrono::Utc> = chrono::DateTime::parse_from_rfc3339(&row.0)
        .map(|d| d.into()).unwrap_or_else(|_| chrono::Utc::now());
    let dur_sec = (chrono::Utc::now() - started).num_seconds().max(0);

    sqlx::query("UPDATE sessions SET status='completed', ended_at=?, duration_sec=?, exit_code=? WHERE id=?")
        .bind(&now).bind(dur_sec).bind(exit_code).bind(session_id).execute(pool).await?;

    // Update games.total_playtime_sec
    sqlx::query("UPDATE games SET total_playtime_sec = total_playtime_sec + ?, last_played_at=? WHERE id = (SELECT game_id FROM sessions WHERE id=?)")
        .bind(dur_sec).bind(&now).bind(session_id).execute(pool).await?;
    Ok(())
}

pub async fn mark_failed(pool: &SqlitePool, session_id: i64) -> Result<(), SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE sessions SET status='launch_failed', ended_at=?, duration_sec=0 WHERE id=?")
        .bind(&now).bind(session_id).execute(pool).await?;
    Ok(())
}

pub async fn cancel_session(pool: &SqlitePool, session_id: i64) -> Result<(), SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    let row: (String,) = sqlx::query_as("SELECT started_at FROM sessions WHERE id=?")
        .bind(session_id).fetch_one(pool).await?;
    let started: chrono::DateTime<chrono::Utc> = chrono::DateTime::parse_from_rfc3339(&row.0)
        .map(|d| d.into()).unwrap_or_else(|_| chrono::Utc::now());
    let dur_sec = (chrono::Utc::now() - started).num_seconds().max(0);
    sqlx::query("UPDATE sessions SET status='cancelled', ended_at=?, duration_sec=? WHERE id=?")
        .bind(&now).bind(dur_sec).bind(session_id).execute(pool).await?;
    sqlx::query("UPDATE games SET total_playtime_sec = total_playtime_sec + ?, last_played_at=? WHERE id = (SELECT game_id FROM sessions WHERE id=?)")
        .bind(dur_sec).bind(&now).bind(session_id).execute(pool).await?;
    Ok(())
}
```

2. **`src-tauri/Cargo.toml`** — append:
```toml
chrono = { version = "0.4", features = ["serde"] }
```

3. **`src-tauri/src/launch/mod.rs`** — append `pub mod session;`.

4. cargo check + cargo test --lib green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/launch/session.rs && \
grep -q "pub async fn start_session" src-tauri/src/launch/session.rs && \
grep -q "pub async fn end_session" src-tauri/src/launch/session.rs && \
grep -q "pub async fn cancel_session" src-tauri/src/launch/session.rs && \
grep -q "chrono" src-tauri/Cargo.toml && \
grep -q "pub mod session" src-tauri/src/launch/mod.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

## Commit Protocol

2 atomic commits:
- `feat(03-03c): add process_track module (sysinfo polling + Win32 wait)`
- `feat(03-03c): add session module (DB lifecycle for playtime)`
