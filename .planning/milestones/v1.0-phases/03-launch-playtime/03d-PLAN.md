---
phase: 03-launch-playtime
plan: 03d
type: execute
wave: 4
depends_on: [03a, 03b, 03c]
files_modified:
  - src-tauri/src/launch/orchestrator.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/launch/mod.rs
  - src-tauri/src/lib.rs
autonomous: true
requirements: [LAUNCH-03, LAUNCH-04, LAUNCH-05, TIME-04]
must_haves:
  truths:
    - "launch::orchestrator::launch_game(game_id) 端到端：DB read → resolve LE path → spawn LE → find PID → start session → wait_for_exit → end_session → emit events"
    - "Tauri commands 注册：launch_game, get_active_session, end_active_session, list_sessions, update_game_launch_config, get_le_path, set_le_path"
    - "ActiveSession 状态在 lib.rs::ActiveSessionState（Arc<Mutex<Option<...>>>）；emit `active-session-changed` event 给前端"
    - "lib.rs generate_handler! 列表追加 7 个新 commands"
    - "cargo check + cargo test --lib 全绿"
  artifacts:
    - path: src-tauri/src/launch/orchestrator.rs
      contains: "pub async fn launch_game"
    - path: src-tauri/src/commands.rs
      contains: "tauri::command"
    - path: src-tauri/src/lib.rs
      contains: "launch_game"
---

# Plan 03d — Launch Orchestrator + Tauri Commands

## Tasks

<task name="Task 1: launch/orchestrator.rs end-to-end glue">

<read_first>
- D:\project\gal-lib\src-tauri\src\launch\le.rs
- D:\project\gal-lib\src-tauri\src\launch\process_track.rs
- D:\project\gal-lib\src-tauri\src\launch\session.rs
- D:\project\gal-lib\.planning\phases\03-launch-playtime\03-CONTEXT.md (§Process Tracking, §Session Lifecycle)
</read_first>

<action>

1. **`src-tauri/src/launch/orchestrator.rs`**:
```rust
use super::{le, process_track, session};
use sqlx::SqlitePool;
use std::path::PathBuf;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ActiveSession {
    pub session_id: i64,
    pub game_id: i64,
    pub game_name: String,
    pub started_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum OrchError {
    #[error("db: {0}")] Db(#[from] sqlx::Error),
    #[error("le: {0}")] Le(#[from] le::LeError),
    #[error("process: {0}")] Process(#[from] process_track::ProcessError),
    #[error("session: {0}")] Session(#[from] session::SessionError),
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("game not found")]
    NotFound,
    #[error("game has no executable_path")]
    NoExecutable,
    #[error("session already active")]
    AlreadyActive,
}

pub struct LaunchInputs {
    pub data_dir: PathBuf,
    pub pool: SqlitePool,
    pub game_id: i64,
}

pub async fn prepare_launch(inputs: &LaunchInputs) -> Result<(PathBuf, String, PathBuf, Vec<String>, PathBuf, String), OrchError> {
    let row: (String, Option<String>, String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT name, executable_path, le_profile, launch_args, cwd FROM games WHERE id=?"
    ).bind(inputs.game_id).fetch_optional(&inputs.pool).await?
        .ok_or(OrchError::NotFound)?;
    let (name, exe_opt, profile, args_opt, cwd_opt) = row;
    let exe = exe_opt.ok_or(OrchError::NoExecutable)?;
    let exe_path = PathBuf::from(&exe);
    let args: Vec<String> = args_opt.as_deref().unwrap_or("").split_whitespace().map(String::from).collect();
    let cwd_path: PathBuf = cwd_opt.map(PathBuf::from)
        .unwrap_or_else(|| exe_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from(".")));
    let le_path = le::resolve_le_path(&inputs.data_dir)?;
    Ok((le_path, profile, exe_path, args, cwd_path, name))
}

/// End-to-end launch+wait. Spawns nothing async itself — caller wraps in tokio::spawn.
pub async fn launch_game(inputs: LaunchInputs) -> Result<(i64, ActiveSession, tokio::task::JoinHandle<Result<(), OrchError>>), OrchError> {
    let (le_path, profile, exe_path, args, cwd, game_name) = prepare_launch(&inputs).await?;
    let session_id = session::start_session(&inputs.pool, inputs.game_id).await?;
    let started_at = chrono::Utc::now().to_rfc3339();
    let active = ActiveSession {
        session_id, game_id: inputs.game_id, game_name: game_name.clone(), started_at: started_at.clone(),
    };

    // Spawn LEProc, find game PID, async-wait, end session
    let pool = inputs.pool.clone();
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let pid_res = process_track::spawn_le(&le_path, &profile, &exe_path, &arg_refs, &cwd);
    let exe_for_pid = exe_path.clone();
    let join: tokio::task::JoinHandle<Result<(), OrchError>> = tokio::spawn(async move {
        match pid_res {
            Ok(_le_pid) => {
                match process_track::find_game_pid(&exe_for_pid).await {
                    Ok(game_pid) => {
                        session::mark_running(&pool, session_id).await?;
                        let exit_code = process_track::wait_for_exit(game_pid).await.unwrap_or(-1);
                        session::end_session(&pool, session_id, exit_code).await?;
                    }
                    Err(_) => {
                        session::mark_failed(&pool, session_id).await?;
                    }
                }
            }
            Err(_) => {
                session::mark_failed(&pool, session_id).await?;
            }
        }
        Ok(())
    });
    Ok((session_id, active, join))
}
```

2. **`src-tauri/src/launch/mod.rs`** — append `pub mod orchestrator;`.

3. cargo check + cargo test --lib all green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/launch/orchestrator.rs && \
grep -q "pub async fn launch_game" src-tauri/src/launch/orchestrator.rs && \
grep -q "ActiveSession" src-tauri/src/launch/orchestrator.rs && \
grep -q "pub mod orchestrator" src-tauri/src/launch/mod.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

<task name="Task 2: 7 new Tauri commands + lib.rs registration">

<read_first>
- D:\project\gal-lib\src-tauri\src\commands.rs (P02d existing 9+1 commands)
- D:\project\gal-lib\src-tauri\src\lib.rs (current generate_handler! list of 11 commands)
- D:\project\gal-lib\src-tauri\src\launch\orchestrator.rs (Task 1)
</read_first>

<action>

1. Edit `src-tauri/src/commands.rs` — APPEND (do NOT replace existing 11 commands) the following:

   - `launch_game(game_id: i64, app: AppHandle, state: State<AppPaths>, active_state: State<ActiveSessionState>) -> Result<orchestrator::ActiveSession, String>`:
     - Acquire `active_state.0.lock()`; if Some(_), return Err("session already active")
     - Acquire pool from AppPaths
     - call `orchestrator::launch_game(LaunchInputs { ... })`
     - store the JoinHandle in active_state for later end_active_session
     - emit `active-session-changed` with ActiveSession payload
     - on the spawned JoinHandle's completion (use a separate spawn that awaits join then clears active_state + emits null), return None
   - `get_active_session(active_state: State<ActiveSessionState>) -> Option<orchestrator::ActiveSession>`
   - `end_active_session(active_state: State<ActiveSessionState>, app: AppHandle, state: State<AppPaths>) -> Result<(), String>`:
     - take `active_state.0.lock()`, if Some(handle): kill_pid (via process_track if PID stored) OR call cancel_session + abort handle
     - emit `active-session-changed` with null
   - `list_sessions(game_id: i64, state: State<AppPaths>) -> Result<Vec<SessionRow>, String>`: SELECT * FROM sessions WHERE game_id=? ORDER BY started_at DESC LIMIT 100
   - `update_game_launch_config(game_id: i64, le_profile: Option<String>, launch_args: Option<String>, cwd: Option<String>, executable_path: Option<String>, state: State<AppPaths>) -> Result<(), String>`: COALESCE-style UPDATE games
   - `get_le_path(state: State<AppPaths>) -> Result<Option<String>, String>`: read config.json le_path
   - `set_le_path(path: String, state: State<AppPaths>) -> Result<(), String>`: call `le::set_le_path`

2. Define structs in commands.rs:
```rust
pub struct ActiveSessionState(pub std::sync::Mutex<Option<ActiveSessionEntry>>);
pub struct ActiveSessionEntry {
    pub session: orchestrator::ActiveSession,
    pub task: tokio::task::AbortHandle,
    pub game_pid: Option<u32>,  // captured if process_track succeeded
}
```

3. Edit `src-tauri/src/lib.rs`:
   - Add `.manage(commands::ActiveSessionState(std::sync::Mutex::new(None)))` after existing `.manage(...)` calls
   - APPEND to `tauri::generate_handler![...]` (keep the existing 11): `commands::launch_game, commands::get_active_session, commands::end_active_session, commands::list_sessions, commands::update_game_launch_config, commands::get_le_path, commands::set_le_path`

4. cargo check + cargo test --lib all green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "launch_game" src-tauri/src/commands.rs && \
grep -q "get_active_session" src-tauri/src/commands.rs && \
grep -q "end_active_session" src-tauri/src/commands.rs && \
grep -q "list_sessions" src-tauri/src/commands.rs && \
grep -q "update_game_launch_config" src-tauri/src/commands.rs && \
grep -q "get_le_path" src-tauri/src/commands.rs && \
grep -q "set_le_path" src-tauri/src/commands.rs && \
grep -q "ActiveSessionState" src-tauri/src/commands.rs && \
grep -q "commands::launch_game" src-tauri/src/lib.rs && \
grep -q "commands::list_sessions" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

## Commit Protocol

2 atomic commits:
- `feat(03-03d): add launch orchestrator (LE spawn → PID find → session lifecycle)`
- `feat(03-03d): wire 7 new tauri commands (launch_game, sessions, le_path)`
