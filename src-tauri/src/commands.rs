//! Phase 2 Tauri commands — wires scan / metadata / ingest pipeline to the
//! frontend. 9 new commands + 1 inherited (`get_data_dir` from Phase 1) =
//! 10 commands total in `tauri::generate_handler!`.
//!
//! The 9 new commands (locked names per 02-CONTEXT § Tauri commands list):
//!   - add_scan_root(path, depth)         -> i64                 (new rowid)
//!   - remove_scan_root(id)               -> ()
//!   - list_scan_roots()                  -> Vec<ScanRoot>
//!   - start_scan(mode)                   -> ()                  (spawns)
//!   - cancel_scan()                      -> ()
//!   - mark_skip_dir(path)                -> ()
//!   - search_metadata(query, source)     -> Vec<Candidate>
//!   - bind_metadata(game_id, source, source_id) -> ()
//!   - refresh_metadata(game_id)          -> ()
//!
//! DB access: a single `SqlitePool` is stashed in `AppPaths` at setup time
//! (created via `SqlitePool::connect_lazy` so it doesn't block the sync
//! `tauri::Builder::manage` call); commands `await` queries against it.
//!
//! Errors returned to JS as `Result<T, String>` (Tauri requires
//! Serialize-able errors; we render with `{:#}` to capture context chains).

use crate::launch::{le, orchestrator, process_track, session};
use crate::{ingest, metadata, scan, AppPaths};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Shared scan handle — wrapped Arc<ScanContext> stored across the lifetime
/// of the app so `cancel_scan` and `mark_skip_dir` can reach into the in-flight
/// scan from a different command invocation.
///
/// The inner `Mutex<Option<...>>` is necessary because:
/// 1. `start_scan` REPLACES the ScanContext (fresh cancel flag per scan)
/// 2. `cancel_scan` / `mark_skip_dir` can be invoked even when no scan is
///    running (no-op or stage in pending ctx) — current behavior is no-op
///    when None.
pub struct ScanState {
    pub ctx: Mutex<Option<Arc<scan::ScanContext>>>,
}

impl ScanState {
    pub fn new() -> Self {
        Self {
            ctx: Mutex::new(None),
        }
    }
}

impl Default for ScanState {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper: stringify any error for Tauri's String error contract.
fn err_str<E: std::fmt::Display>(e: E) -> String {
    format!("{}", e)
}

// ── scan_roots CRUD ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanRoot {
    pub id: i64,
    pub path: String,
    pub depth: u8,
    pub created_at: String,
}

#[tauri::command]
pub async fn add_scan_root(
    path: String,
    depth: u8,
    state: State<'_, AppPaths>,
) -> Result<i64, String> {
    if !(1..=3).contains(&depth) {
        return Err(format!("depth must be 1..=3 (got {})", depth));
    }
    let pool = state.pool().await.map_err(err_str)?;
    let res = sqlx::query("INSERT INTO scan_roots (path, depth) VALUES (?, ?)")
        .bind(&path)
        .bind(depth as i64)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(res.last_insert_rowid())
}

#[tauri::command]
pub async fn remove_scan_root(id: i64, state: State<'_, AppPaths>) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("DELETE FROM scan_roots WHERE id = ?")
        .bind(id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn list_scan_roots(state: State<'_, AppPaths>) -> Result<Vec<ScanRoot>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query("SELECT id, path, depth, created_at FROM scan_roots ORDER BY id ASC")
        .fetch_all(&*pool)
        .await
        .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let depth_i64: i64 = row.try_get("depth").map_err(err_str)?;
        out.push(ScanRoot {
            id: row.try_get("id").map_err(err_str)?,
            path: row.try_get("path").map_err(err_str)?,
            depth: depth_i64 as u8,
            created_at: row.try_get("created_at").map_err(err_str)?,
        });
    }
    Ok(out)
}

// ── start_scan / cancel_scan / mark_skip_dir ────────────────────────────────

#[tauri::command]
pub async fn start_scan(
    mode: String,
    app: AppHandle,
    state: State<'_, AppPaths>,
    scan_state: State<'_, ScanState>,
) -> Result<(), String> {
    let incremental = match mode.as_str() {
        "full" => false,
        "incremental" => true,
        other => return Err(format!("mode must be 'full' or 'incremental' (got '{}')", other)),
    };

    // Fresh ScanContext for this scan run.
    let ctx = Arc::new(scan::ScanContext::new());
    {
        let mut g = scan_state.ctx.lock().map_err(|_| "scan state mutex poisoned".to_string())?;
        *g = Some(ctx.clone());
    }

    // Snapshot DB state synchronously inside the command (so the spawned
    // task doesn't borrow `state`, which is `'_` lifetimed).
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Read scan_roots
    let roots: Vec<(PathBuf, u8)> = {
        let rows = sqlx::query("SELECT path, depth FROM scan_roots ORDER BY id ASC")
            .fetch_all(&*pool)
            .await
            .map_err(err_str)?;
        rows.into_iter()
            .filter_map(|r| {
                let p: String = r.try_get("path").ok()?;
                let d: i64 = r.try_get("depth").ok()?;
                Some((PathBuf::from(p), d as u8))
            })
            .collect()
    };

    if roots.is_empty() {
        // Emit a terminal Completed event so the UI clears any "scanning..."
        // indicator the user might have triggered prematurely.
        let _ = app.emit(
            "scan-progress",
            scan::ScanProgress {
                current_dir: String::new(),
                completed: 0,
                total: 0,
                status: scan::ScanStatus::Completed,
            },
        );
        return Ok(());
    }

    // Read existing games.path set (only used in incremental mode).
    let existing_paths: HashSet<PathBuf> = if incremental {
        let rows = sqlx::query("SELECT path FROM games")
            .fetch_all(&*pool)
            .await
            .map_err(err_str)?;
        rows.into_iter()
            .filter_map(|r| r.try_get::<String, _>("path").ok().map(PathBuf::from))
            .collect()
    } else {
        HashSet::new()
    };

    // Spawn the scan + ingest pipeline; command returns immediately.
    let app_for_emit = app.clone();
    let pool_for_task = pool.clone();
    tokio::spawn(async move {
        // Progress callback: forward each ScanProgress to the frontend.
        let app_progress = app_for_emit.clone();
        let on_progress = move |p: scan::ScanProgress| {
            let _ = app_progress.emit("scan-progress", p);
        };

        let scan_res = scan::run_scan(
            roots,
            existing_paths,
            incremental,
            ctx.clone(),
            on_progress,
        )
        .await;

        let discovered = match scan_res {
            Ok(d) => d,
            Err(e) => {
                let _ = app_for_emit.emit(
                    "scan-progress",
                    scan::ScanProgress {
                        current_dir: String::new(),
                        completed: 0,
                        total: 0,
                        status: match e {
                            scan::ScanError::Cancelled => scan::ScanStatus::Cancelled,
                            _ => scan::ScanStatus::Failed,
                        },
                    },
                );
                return;
            }
        };

        // Ingest each discovered game sequentially (intentional — Bangumi
        // limiter is 1 req/s, parallelism wouldn't help and would garble
        // the per-game progress reporting).
        for dg in discovered {
            // INSERT base row to obtain rowid for cover filename.
            let path_str = dg.path.to_string_lossy().to_string();
            let exec_str = dg.executable.as_ref().map(|p| p.to_string_lossy().to_string());

            let insert_res = sqlx::query(
                "INSERT INTO games (path, name, executable_path) VALUES (?, ?, ?) \
                 ON CONFLICT(path) DO UPDATE SET name=excluded.name, executable_path=excluded.executable_path",
            )
            .bind(&path_str)
            .bind(&dg.clean_name)
            .bind(&exec_str)
            .execute(&*pool_for_task)
            .await;

            // Resolve the row id (last_insert_rowid is 0 on UPDATE-only
            // path of UPSERT; need a SELECT then).
            let game_id: i64 = match insert_res {
                Ok(r) if r.last_insert_rowid() != 0 => r.last_insert_rowid(),
                _ => {
                    match sqlx::query("SELECT id FROM games WHERE path = ?")
                        .bind(&path_str)
                        .fetch_one(&*pool_for_task)
                        .await
                        .and_then(|r| r.try_get::<i64, _>("id"))
                    {
                        Ok(id) => id,
                        Err(_) => continue, // row gone / DB error — skip
                    }
                }
            };

            // Run metadata + cover pipeline.
            let result = ingest::process_game(game_id, &data_dir, &dg).await;

            // Persist the result.
            let _ = sqlx::query(
                "UPDATE games SET name = ?, name_cn = ?, cover_path = ?, cover_url = ?, \
                                  bangumi_id = ?, vndb_id = ?, metadata_source = ?, \
                                  match_confidence = ?, last_scanned_at = datetime('now') \
                 WHERE id = ?",
            )
            .bind(&result.name)
            .bind(&result.name_cn)
            .bind(&result.cover_path)
            .bind(&result.cover_url)
            .bind(&result.bangumi_id)
            .bind(&result.vndb_id)
            .bind(&result.metadata_source)
            .bind(result.match_confidence.map(|x| x as i64))
            .bind(game_id)
            .execute(&*pool_for_task)
            .await;
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_scan(scan_state: State<'_, ScanState>) -> Result<(), String> {
    let g = scan_state.ctx.lock().map_err(|_| "scan state mutex poisoned".to_string())?;
    if let Some(ctx) = g.as_ref() {
        ctx.cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn mark_skip_dir(
    path: String,
    scan_state: State<'_, ScanState>,
) -> Result<(), String> {
    let g = scan_state.ctx.lock().map_err(|_| "scan state mutex poisoned".to_string())?;
    if let Some(ctx) = g.as_ref() {
        let mut s = ctx.skip.lock().map_err(|_| "skip set mutex poisoned".to_string())?;
        s.insert(PathBuf::from(path));
    }
    Ok(())
}

// ── metadata search / bind / refresh ────────────────────────────────────────

#[tauri::command]
pub async fn search_metadata(
    query: String,
    source: String,
) -> Result<Vec<metadata::Candidate>, String> {
    match source.as_str() {
        "bangumi" => metadata::bangumi::search(&query).await.map_err(err_str),
        "vndb" => metadata::vndb::search(&query).await.map_err(err_str),
        other => Err(format!("source must be 'bangumi' or 'vndb' (got '{}')", other)),
    }
}

#[tauri::command]
pub async fn bind_metadata(
    game_id: i64,
    source: String,
    source_id: String,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Fetch detail from the chosen source.
    let detail = match source.as_str() {
        "bangumi" => metadata::bangumi::fetch_detail(&source_id).await.map_err(err_str)?,
        "vndb" => metadata::vndb::fetch_detail(&source_id).await.map_err(err_str)?,
        other => return Err(format!("source must be 'bangumi' or 'vndb' (got '{}')", other)),
    };

    // Cache cover (best-effort).
    let cover_path = if let Some(url) = &detail.cover_url {
        crate::cover_cache::cache_cover(&data_dir, game_id, url)
            .await
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    };

    let (bangumi_id_col, vndb_id_col) = match source.as_str() {
        "bangumi" => (Some(detail.source_id.clone()), None),
        "vndb" => (None, Some(detail.source_id.clone())),
        _ => unreachable!(),
    };

    sqlx::query(
        "UPDATE games SET name = ?, name_cn = ?, cover_path = COALESCE(?, cover_path), \
                          cover_url = ?, bangumi_id = ?, vndb_id = ?, \
                          metadata_source = ?, match_confidence = 100, \
                          last_scanned_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(&detail.title)
    .bind(&detail.title_cn)
    .bind(&cover_path)
    .bind(&detail.cover_url)
    .bind(&bangumi_id_col)
    .bind(&vndb_id_col)
    .bind(&source) // "bangumi" or "vndb"
    .bind(game_id)
    .execute(&*pool)
    .await
    .map_err(err_str)?;

    Ok(())
}

#[tauri::command]
pub async fn refresh_metadata(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Read the row's current state.
    let row = sqlx::query("SELECT path, name, executable_path FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let games_path: String = row.try_get("path").map_err(err_str)?;
    let current_name: String = row.try_get("name").map_err(err_str)?;
    let exec: Option<String> = row.try_get("executable_path").ok();

    // Use current `name` as the search query (it's typically the cleaned
    // disk-name from initial ingest, OR the bound title from prior bind).
    let result = ingest::refresh_for_query(
        game_id,
        &data_dir,
        &games_path,
        &current_name,
        exec.as_deref(),
    )
    .await;

    sqlx::query(
        "UPDATE games SET name = ?, name_cn = ?, cover_path = COALESCE(?, cover_path), \
                          cover_url = COALESCE(?, cover_url), \
                          bangumi_id = COALESCE(?, bangumi_id), \
                          vndb_id = COALESCE(?, vndb_id), \
                          metadata_source = ?, match_confidence = ?, \
                          last_scanned_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(&result.name)
    .bind(&result.name_cn)
    .bind(&result.cover_path)
    .bind(&result.cover_url)
    .bind(&result.bangumi_id)
    .bind(&result.vndb_id)
    .bind(&result.metadata_source)
    .bind(result.match_confidence.map(|x| x as i64))
    .bind(game_id)
    .execute(&*pool)
    .await
    .map_err(err_str)?;

    Ok(())
}

// ── games read API (02f) ────────────────────────────────────────────────────

/// JSON shape returned by `list_games`. Mirrors the `games` table 1:1 so the
/// frontend `Game` interface in `src/lib/games.ts` lines up column-for-column.
///
/// All Option<T> columns deserialize to `null` over the wire (Tauri uses
/// serde-json default Some/None handling).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Game {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub name_cn: Option<String>,
    pub executable_path: Option<String>,
    pub cover_path: Option<String>,
    pub cover_url: Option<String>,
    pub bangumi_id: Option<String>,
    pub vndb_id: Option<String>,
    pub total_playtime_sec: i64,
    pub last_played_at: Option<String>,
    pub status: String,
    pub rating: Option<i64>,
    pub notes: Option<String>,
    pub metadata_source: Option<String>,
    pub match_confidence: Option<i64>,
    pub last_scanned_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Read every row from `games`, ordered by `created_at DESC`.
///
/// Phase 2 has no filter / pagination surface — the Library grid renders the
/// full rowset and virtualizes client-side. Phase 4 will likely introduce
/// server-side filtering (status / tags / search) and paging.
#[tauri::command]
pub async fn list_games(state: State<'_, AppPaths>) -> Result<Vec<Game>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT id, path, name, name_cn, executable_path, cover_path, cover_url, \
                bangumi_id, vndb_id, total_playtime_sec, last_played_at, status, \
                rating, notes, metadata_source, match_confidence, last_scanned_at, \
                created_at, updated_at \
         FROM games ORDER BY created_at DESC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(Game {
            id: row.try_get("id").map_err(err_str)?,
            path: row.try_get("path").map_err(err_str)?,
            name: row.try_get("name").map_err(err_str)?,
            name_cn: row.try_get("name_cn").ok(),
            executable_path: row.try_get("executable_path").ok(),
            cover_path: row.try_get("cover_path").ok(),
            cover_url: row.try_get("cover_url").ok(),
            bangumi_id: row.try_get("bangumi_id").ok(),
            vndb_id: row.try_get("vndb_id").ok(),
            total_playtime_sec: row.try_get("total_playtime_sec").unwrap_or(0),
            last_played_at: row.try_get("last_played_at").ok(),
            status: row
                .try_get("status")
                .unwrap_or_else(|_| "unplayed".to_string()),
            rating: row.try_get("rating").ok(),
            notes: row.try_get("notes").ok(),
            metadata_source: row.try_get("metadata_source").ok(),
            match_confidence: row.try_get("match_confidence").ok(),
            last_scanned_at: row.try_get("last_scanned_at").ok(),
            created_at: row.try_get("created_at").map_err(err_str)?,
            updated_at: row.try_get("updated_at").map_err(err_str)?,
        });
    }
    Ok(out)
}

// Avoid a dangling `Manager` import warning when no command uses it directly;
// keep it imported so future additions (e.g. window-handle access) compile.
#[allow(dead_code)]
fn _retain_manager_import(app: &AppHandle) {
    let _ = app.app_handle();
}

// ── Phase 3 / 03d: launch + sessions + LE-path commands ─────────────────────

/// Held in Tauri-managed state for the lifetime of the app. Wraps the active
/// (running) game session — `None` when nothing is playing.
///
/// `std::sync::Mutex` (not `tokio::sync::Mutex`) is intentional: every lock
/// in this file is short-lived and never held across an `await`. The
/// lock → clone-or-take → unlock pattern is enforced by inspection in each
/// command; do NOT add a `.await` between `lock()` and the matching drop.
pub struct ActiveSessionState(pub Mutex<Option<ActiveSessionEntry>>);

/// Per-session bookkeeping. The `task` AbortHandle (NOT the JoinHandle) is
/// what `end_active_session` needs — we only ever cancel, never join here.
/// The JoinHandle is owned by the secondary watcher spawned in `launch_game`,
/// which awaits it and then clears this state + emits the `null` event.
pub struct ActiveSessionEntry {
    pub session: orchestrator::ActiveSession,
    pub task: tokio::task::AbortHandle,
}

/// Tauri event name for active-session lifecycle changes. Payload is
/// `Option<ActiveSession>` (None / null = no active session).
pub const ACTIVE_SESSION_EVENT: &str = "active-session-changed";

/// Start a new game session. End-to-end:
///   1. Validate no other session is active.
///   2. Resolve pool, call `orchestrator::launch_game`.
///   3. Spawn a watcher task that awaits the orchestrator's JoinHandle,
///      then clears `ActiveSessionState` and emits the null event.
///   4. Store the AbortHandle + ActiveSession in state.
///   5. Emit `active-session-changed` with the session payload.
#[tauri::command]
pub async fn launch_game(
    game_id: i64,
    app: AppHandle,
    state: State<'_, AppPaths>,
    active_state: State<'_, ActiveSessionState>,
) -> Result<orchestrator::ActiveSession, String> {
    // Pre-check: refuse if a session is already running. Hold the lock for
    // the minimum span — only to read the Option discriminant.
    {
        let g = active_state
            .0
            .lock()
            .map_err(|_| "active session mutex poisoned".to_string())?;
        if g.is_some() {
            return Err("session already active".to_string());
        }
    }

    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    let (_session_id, active, join) = orchestrator::launch_game(orchestrator::LaunchInputs {
        data_dir,
        pool: (*pool).clone(),
        game_id,
    })
    .await
    .map_err(err_str)?;

    let abort = join.abort_handle();

    // Store the active session BEFORE spawning the watcher: the watcher must
    // see the same entry it will later clear, and we want the UI emission to
    // race-free reflect the just-stored state.
    {
        let mut g = active_state
            .0
            .lock()
            .map_err(|_| "active session mutex poisoned".to_string())?;
        *g = Some(ActiveSessionEntry {
            session: active.clone(),
            task: abort,
        });
    }

    // Emit "session started" — payload is Option<ActiveSession> (Some).
    let _ = app.emit(ACTIVE_SESSION_EVENT, Some(active.clone()));

    // Watcher: when the orchestrator's join completes (natural exit OR abort),
    // clear state + emit null. ManagedState (`State<'_, ActiveSessionState>`)
    // can't be moved across threads, so we capture the AppHandle and look up
    // the state via `app.state()` from inside the spawned task.
    let app_for_watch = app.clone();
    tokio::spawn(async move {
        // Awaiting an aborted JoinHandle returns Err(JoinError::is_cancelled).
        // We don't care which path got us here — either way, finalize state.
        let _ = join.await;
        if let Some(state) = app_for_watch.try_state::<ActiveSessionState>() {
            if let Ok(mut g) = state.0.lock() {
                *g = None;
            }
        }
        let _ = app_for_watch.emit(ACTIVE_SESSION_EVENT, None::<orchestrator::ActiveSession>);
    });

    Ok(active)
}

/// Read the currently-active session, if any. Returns None when nothing is
/// playing. Used by the frontend on app boot to rehydrate the active-session
/// bar after a reload.
#[tauri::command]
pub fn get_active_session(
    active_state: State<'_, ActiveSessionState>,
) -> Result<Option<orchestrator::ActiveSession>, String> {
    let g = active_state
        .0
        .lock()
        .map_err(|_| "active session mutex poisoned".to_string())?;
    Ok(g.as_ref().map(|e| e.session.clone()))
}

/// User-initiated "强制结束". Aborts the wait-for-exit task, marks the DB
/// session as 'cancelled' (which credits playtime to the games row), and
/// emits the null event.
///
/// We do NOT call `kill_pid` here: by the time the user clicks "force end",
/// the game may have crashed / closed itself. `kill_pid` is best-effort —
/// the session_id is the source of truth for DB cleanup.
#[tauri::command]
pub async fn end_active_session(
    app: AppHandle,
    state: State<'_, AppPaths>,
    active_state: State<'_, ActiveSessionState>,
) -> Result<(), String> {
    // Take the entry (don't just peek) — the watcher will also try to clear
    // state, and `take()` is idempotent. Hold the lock only long enough to
    // extract the session_id and abort handle.
    let entry_opt = {
        let mut g = active_state
            .0
            .lock()
            .map_err(|_| "active session mutex poisoned".to_string())?;
        g.take()
    };

    let entry = match entry_opt {
        Some(e) => e,
        None => return Ok(()), // already ended — idempotent no-op
    };

    let session_id = entry.session.session_id;

    // Abort the wait-for-exit task FIRST so it can't race with our
    // cancel_session UPDATE. AbortHandle::abort returns immediately; the
    // watcher task will observe `JoinError::is_cancelled` and emit null.
    entry.task.abort();

    // Mark cancelled in DB — credits elapsed time to games.total_playtime_sec.
    let pool = state.pool().await.map_err(err_str)?;
    session::cancel_session(&*pool, session_id)
        .await
        .map_err(err_str)?;

    // Belt-and-braces: explicitly emit null in case the watcher hasn't fired
    // yet (its emit is also null, so a duplicate is harmless on the frontend).
    let _ = app.emit(ACTIVE_SESSION_EVENT, None::<orchestrator::ActiveSession>);
    Ok(())
}

/// JSON shape for `list_sessions`. Fields mirror the `sessions` table after
/// the schema-v3 migration (status + exit_code added in 03a). `rename_all =
/// "snake_case"` keeps the wire format aligned with the column names so the
/// frontend can use the same field names without translation.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct SessionRow {
    pub id: i64,
    pub game_id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_sec: i64,
    pub status: String,
    pub exit_code: Option<i64>,
}

/// Read the most recent 100 sessions for `game_id`, newest first. Used by
/// the detail-page session-history list.
#[tauri::command]
pub async fn list_sessions(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Vec<SessionRow>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT id, game_id, started_at, ended_at, duration_sec, status, exit_code \
         FROM sessions WHERE game_id = ? \
         ORDER BY started_at DESC LIMIT 100",
    )
    .bind(game_id)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(SessionRow {
            id: row.try_get("id").map_err(err_str)?,
            game_id: row.try_get("game_id").map_err(err_str)?,
            started_at: row.try_get("started_at").map_err(err_str)?,
            ended_at: row.try_get("ended_at").ok(),
            duration_sec: row.try_get("duration_sec").unwrap_or(0),
            status: row
                .try_get("status")
                .unwrap_or_else(|_| "completed".to_string()),
            exit_code: row.try_get("exit_code").ok(),
        });
    }
    Ok(out)
}

/// COALESCE-style update for `games` launch-config columns. Each parameter is
/// optional — `None` means "leave unchanged"; `Some(value)` overwrites. Note
/// that `Some("")` will overwrite with empty string (intentional — lets the
/// user clear `launch_args` to "no args").
///
/// Uses sqlx's bind-NULL = SQL NULL semantics combined with `COALESCE(?, col)`
/// to express "use new value if provided, otherwise keep current".
#[tauri::command]
pub async fn update_game_launch_config(
    game_id: i64,
    le_profile: Option<String>,
    launch_args: Option<String>,
    cwd: Option<String>,
    executable_path: Option<String>,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query(
        "UPDATE games SET \
            le_profile      = COALESCE(?, le_profile), \
            launch_args     = COALESCE(?, launch_args), \
            cwd             = COALESCE(?, cwd), \
            executable_path = COALESCE(?, executable_path) \
         WHERE id = ?",
    )
    .bind(&le_profile)
    .bind(&launch_args)
    .bind(&cwd)
    .bind(&executable_path)
    .bind(game_id)
    .execute(&*pool)
    .await
    .map_err(err_str)?;
    Ok(())
}

/// Read the persisted LE path from `data/config.json`. Does NOT trigger
/// detection — that's `launch_game`'s responsibility (via `resolve_le_path`).
/// Returns None when the field is missing or the persisted path no longer
/// exists, so the Settings page can prompt for manual override.
#[tauri::command]
pub fn get_le_path(state: State<'_, AppPaths>) -> Result<Option<String>, String> {
    let cfg_path = state.data_dir.join("config.json");
    let cfg_str = std::fs::read_to_string(&cfg_path).unwrap_or_else(|_| "{}".into());
    let cfg: serde_json::Value =
        serde_json::from_str(&cfg_str).unwrap_or_else(|_| serde_json::Value::Object(Default::default()));
    let p = cfg
        .get("le_path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    // Filter out stale paths so the frontend doesn't display a non-existent
    // location as "configured".
    Ok(p.filter(|s| Path::new(s).exists()))
}

/// Manual override: persist `path` as the LE path. Validates existence (via
/// `le::set_le_path`) and surfaces InvalidPath as a String error so the
/// frontend can render a precise message.
#[tauri::command]
pub fn set_le_path(path: String, state: State<'_, AppPaths>) -> Result<(), String> {
    le::set_le_path(&state.data_dir, Path::new(&path)).map_err(err_str)
}

// Retain process_track import in dead-code-aware modules (kill_pid etc. are
// referenced from end_active_session-adjacent flows in 03e tray cleanup).
#[allow(dead_code)]
fn _retain_process_track_import() {
    let _ = process_track::kill_pid;
}
