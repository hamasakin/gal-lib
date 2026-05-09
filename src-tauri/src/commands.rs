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
use sqlx::{Row, SqlitePool};
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

/// 20260509f — Phase 1 of two-phase ingest: idempotent placeholder INSERT.
///
/// Writes the minimum row (path / name / executable_path / screenshot_interval_sec=0)
/// without doing any network I/O or cover work. Resolves the `games.id` —
/// either freshly inserted (last_insert_rowid != 0) or via the ON CONFLICT(path)
/// `SELECT id` fallback when the row already exists.
///
/// Idempotent: a second call with the same path returns the same id (the
/// ON CONFLICT branch keeps the row stable). `start_scan` deliberately calls
/// it twice per discovered directory — once in the pre-ingest batch loop to
/// make placeholders visible immediately, then again at the head of each
/// ingest iteration to recover the id without threading a parallel `Vec<i64>`.
async fn insert_placeholder_dir(
    pool: &SqlitePool,
    dg: &scan::DiscoveredGame,
) -> Result<i64, String> {
    let path_str = dg.path.to_string_lossy().to_string();
    let exec_str = dg.executable.as_ref().map(|p| p.to_string_lossy().to_string());

    // screenshot_interval_sec=0 keeps auto-capture off by default for new
    // games; users who want it can flip the per-game value via the Detail
    // page's 设置 tab. The schema column default of 300 (set in v5) is not
    // referenced because we always specify the column explicitly here.
    let insert_res = sqlx::query(
        "INSERT INTO games (path, name, executable_path, screenshot_interval_sec) \
         VALUES (?, ?, ?, 0) \
         ON CONFLICT(path) DO UPDATE SET name=excluded.name, executable_path=excluded.executable_path",
    )
    .bind(&path_str)
    .bind(&dg.clean_name)
    .bind(&exec_str)
    .execute(pool)
    .await;

    let game_id: i64 = match insert_res {
        Ok(r) if r.last_insert_rowid() != 0 => r.last_insert_rowid(),
        _ => sqlx::query("SELECT id FROM games WHERE path = ?")
            .bind(&path_str)
            .fetch_one(pool)
            .await
            .and_then(|r| r.try_get::<i64, _>("id"))
            .map_err(err_str)?,
    };

    Ok(game_id)
}

/// 20260509f — Phase 2 of two-phase ingest: run metadata + cover pipeline
/// then UPDATE the row. Caller is responsible for emitting
/// `meta-fetch-progress` started/finished events around this call (see
/// `start_scan` for the canonical pattern).
async fn enrich_metadata_for_dir(
    pool: &SqlitePool,
    data_dir: &Path,
    game_id: i64,
    dg: &scan::DiscoveredGame,
) -> Result<(), String> {
    let result = ingest::process_game(game_id, data_dir, dg).await;

    sqlx::query(
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
    .execute(pool)
    .await
    .map_err(err_str)?;

    Ok(())
}

/// Ingest one DiscoveredGame: placeholder INSERT → metadata+cover → UPDATE.
/// Shared by `start_scan` (the bulk scan loop) and `add_game` (single-directory
/// entry-point). Returns the row id.
///
/// 20260509f — composed of `insert_placeholder_dir` + `enrich_metadata_for_dir`.
/// `add_game` keeps calling this monolithic helper (no `meta-fetch-progress`
/// emit needed for the single-add path: caller-side optimistic refetch is
/// the only existing UX, and there's no card on screen to highlight before
/// the row exists). `start_scan` bypasses this helper and calls the two
/// halves directly so it can emit between them.
async fn ingest_one_dir(
    pool: &SqlitePool,
    data_dir: &Path,
    dg: &scan::DiscoveredGame,
) -> Result<i64, String> {
    let game_id = insert_placeholder_dir(pool, dg).await?;
    enrich_metadata_for_dir(pool, data_dir, game_id, dg).await?;
    Ok(game_id)
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
    //
    // Filter to *bound* rows only — directories whose row has
    // metadata_source='none' (i.e. 「待复核」: scan happened but neither
    // Bangumi nor VNDB cleared the auto-bind threshold) are intentionally
    // excluded so an incremental rescan re-runs the metadata pipeline on
    // them. The standard cleaning + scoring rules may have improved
    // (see 20260509c) and the user shouldn't have to right-click each
    // unbound card to retry. Manual binds are kept in the skip set so
    // a rescan never overwrites a user's explicit choice.
    let existing_paths: HashSet<PathBuf> = if incremental {
        let rows = sqlx::query(
            "SELECT path FROM games \
             WHERE metadata_source IN ('bangumi', 'vndb', 'manual')",
        )
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
        // run_scan emits only Running events; the terminal Completed/Failed
        // event is emitted below, AFTER the ingest loop drains.
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

        let total = discovered.len();

        // Edge case: nothing to ingest (incremental mode with all skips, or
        // empty roots). Emit a terminal Completed so the UI clears its
        // "scanning..." indicator instead of getting stuck on the last Running.
        if total == 0 {
            let _ = app_for_emit.emit(
                "scan-progress",
                scan::ScanProgress {
                    current_dir: String::new(),
                    completed: 0,
                    total: 0,
                    status: scan::ScanStatus::Completed,
                },
            );
            return;
        }

        // 20260509f — Phase 1 of two-phase ingest: batch-INSERT placeholders
        // BEFORE the per-game enrich loop runs. Each row lands as
        // `metadata_source=NULL last_scanned_at=NULL`, which GameCard
        // already renders as "获取中". This makes the full set of
        // discovered directories visible in the grid the moment ingest
        // starts (rather than appearing one-at-a-time as enrich completes).
        // Errors are swallowed per-row: a single failed INSERT shouldn't
        // abort the whole scan; the enrich loop will retry the INSERT
        // (idempotent ON CONFLICT(path)) and surface its own error.
        //
        // 20260509g — cancel check at top of each placeholder-insert iteration:
        // if the user clicked "取消扫描" while we're seeding placeholders,
        // bail immediately with a Cancelled event instead of continuing to
        // INSERT every remaining discovery before the ingest loop's check.
        for dg in &discovered {
            if ctx.cancel.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = app_for_emit.emit(
                    "scan-progress",
                    scan::ScanProgress {
                        current_dir: String::new(),
                        completed: 0,
                        total,
                        status: scan::ScanStatus::Cancelled,
                    },
                );
                return;
            }
            let _ = insert_placeholder_dir(&*pool_for_task, dg).await;
        }

        // Transition event — reset the progress bar to phase 2 (ingest).
        // Frontend's existing scan-progress completed→refetch flow picks up
        // the placeholder rows on terminal status; we deliberately don't
        // emit a separate `games-changed` event here to keep the event
        // surface minimal (CONTEXT decision logged in PLAN Task 2).
        let _ = app_for_emit.emit(
            "scan-progress",
            scan::ScanProgress {
                current_dir: String::new(),
                completed: 0,
                total,
                status: scan::ScanStatus::Running,
            },
        );

        // Ingest each discovered game sequentially (intentional — Bangumi
        // limiter is 1 req/s, parallelism wouldn't help and would garble
        // the per-game progress reporting).
        //
        // 20260509g — Task 2 will replace this sequential loop with a
        // tokio::task::JoinSet for cross-game concurrency. Task 1 only
        // adds the per-iteration cancel check so users can abort the
        // scan without waiting for the entire library to finish.
        for (i, dg) in discovered.into_iter().enumerate() {
            // Top-of-iteration cancel check — bail before spending any
            // more time on Bangumi/VNDB limiter waits or DB writes.
            if ctx.cancel.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = app_for_emit.emit(
                    "scan-progress",
                    scan::ScanProgress {
                        current_dir: String::new(),
                        completed: i,
                        total,
                        status: scan::ScanStatus::Cancelled,
                    },
                );
                return;
            }

            let path_str = dg.path.to_string_lossy().to_string();

            // 20260509f — Phase 2 of two-phase ingest with per-game emit.
            // Re-resolve the id via the idempotent `insert_placeholder_dir`
            // (ON CONFLICT(path) returns the existing rowid); avoids the
            // need to thread a parallel `Vec<i64>` through the enumerate.
            // Skip this iteration on placeholder failure — the row simply
            // won't be enriched this pass; user can rescan or right-click
            // 「重新匹配元数据」later.
            let game_id = match insert_placeholder_dir(&*pool_for_task, &dg).await {
                Ok(id) => id,
                Err(_) => {
                    // Still bump the progress bar so the user sees us moving.
                    let _ = app_for_emit.emit(
                        "scan-progress",
                        scan::ScanProgress {
                            current_dir: path_str,
                            completed: i + 1,
                            total,
                            status: scan::ScanStatus::Running,
                        },
                    );
                    continue;
                }
            };

            let _ = app_for_emit.emit(
                "meta-fetch-progress",
                serde_json::json!({ "game_id": game_id, "phase": "started" }),
            );
            let _ = enrich_metadata_for_dir(&*pool_for_task, &data_dir, game_id, &dg).await;
            let _ = app_for_emit.emit(
                "meta-fetch-progress",
                serde_json::json!({ "game_id": game_id, "phase": "finished" }),
            );

            let _ = app_for_emit.emit(
                "scan-progress",
                scan::ScanProgress {
                    current_dir: path_str,
                    completed: i + 1,
                    total,
                    status: scan::ScanStatus::Running,
                },
            );
        }

        // Terminal Completed — emitted AFTER all ingest work is durable in DB,
        // so the frontend's status==="completed" → refetch sees the rows.
        let _ = app_for_emit.emit(
            "scan-progress",
            scan::ScanProgress {
                current_dir: String::new(),
                completed: total,
                total,
                status: scan::ScanStatus::Completed,
            },
        );
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

/// Skip the bulk scan and add a single game directory directly. Builds a
/// `DiscoveredGame` from the directory (basename → clean_title, exe via
/// `walker::pick_best_exe`) and feeds it to the shared `ingest_one_dir`
/// helper. Returns the resulting `games.id`.
#[tauri::command]
pub async fn add_game(
    dir_path: String,
    state: State<'_, AppPaths>,
) -> Result<i64, String> {
    let dir = PathBuf::from(&dir_path);
    if !dir.is_dir() {
        return Err(format!("path is not a directory: {}", dir_path));
    }
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    let raw_name = dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let clean_name = crate::title_clean::clean_title(&raw_name);
    let executable = scan::walker::pick_best_exe(&dir);

    let dg = scan::DiscoveredGame {
        path: dir,
        raw_name,
        clean_name,
        executable,
    };

    ingest_one_dir(&*pool, &data_dir, &dg).await
}

/// Wipe all game-related data — for debugging only. Clears the games table
/// (and its child rows in screenshots / save_backups / sessions / game_tags)
/// plus scan_roots, then best-effort removes the on-disk cover, screenshot,
/// and save-backup subdirectories. Tags definitions and config (LE path,
/// per-game screenshot interval defaults from migration) are preserved.
#[tauri::command]
pub async fn clear_all_data(state: State<'_, AppPaths>) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Delete child tables first so this works regardless of the connection's
    // `PRAGMA foreign_keys` state (sqlx doesn't auto-enable it per connection).
    for table in [
        "screenshots",
        "save_backups",
        "sessions",
        "game_tags",
        "games",
        "scan_roots",
    ] {
        sqlx::query(&format!("DELETE FROM {}", table))
            .execute(&*pool)
            .await
            .map_err(err_str)?;
    }

    for sub in ["covers", "screenshots", "saves"] {
        let dir = data_dir.join(sub);
        if dir.exists() {
            let _ = std::fs::remove_dir_all(&dir);
        }
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
    app: AppHandle,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // 20260509f — emit started, then run the bind in an inner async block so
    // that BOTH success and error paths fall through to the finished emit
    // before returning. Avoids a leaked card-pulse if the inner work fails
    // (without scopeguard which the project doesn't depend on).
    let _ = app.emit(
        "meta-fetch-progress",
        serde_json::json!({ "game_id": game_id, "phase": "started" }),
    );

    let result: Result<(), String> = async {
        // Fetch detail from the chosen source.
        let detail = match source.as_str() {
            "bangumi" => metadata::bangumi::fetch_detail(&source_id).await.map_err(err_str)?,
            "vndb" => metadata::vndb::fetch_detail(&source_id).await.map_err(err_str)?,
            other => return Err(format!("source must be 'bangumi' or 'vndb' (got '{}')", other)),
        };

        // Cache cover (best-effort). Surface failures via stderr so a user
        // reporting "no cover after bind" has a log line to grep — the row's
        // cover_url is still set from the bind, and the frontend falls back to
        // it when cover_path is null.
        let cover_path = if let Some(url) = &detail.cover_url {
            match crate::cover_cache::cache_cover(&data_dir, game_id, url).await {
                Ok(p) => Some(p.to_string_lossy().into_owned()),
                Err(e) => {
                    eprintln!(
                        "[bind_metadata] cover cache failed for game {} ({}): {}",
                        game_id, url, e
                    );
                    None
                }
            }
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
    .await;

    let _ = app.emit(
        "meta-fetch-progress",
        serde_json::json!({ "game_id": game_id, "phase": "finished" }),
    );

    result
}

#[tauri::command]
pub async fn refresh_metadata(
    game_id: i64,
    app: AppHandle,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // 20260509f — emit started, then run the refresh in an inner async block
    // so the finished emit always runs even on row-not-found / network error.
    let _ = app.emit(
        "meta-fetch-progress",
        serde_json::json!({ "game_id": game_id, "phase": "started" }),
    );

    let result: Result<(), String> = async {
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
    .await;

    let _ = app.emit(
        "meta-fetch-progress",
        serde_json::json!({ "game_id": game_id, "phase": "finished" }),
    );

    result
}

/// Bulk version of `refresh_metadata`: iterates every game in the library
/// and re-runs the Bangumi+VNDB search for it. Useful after the scoring
/// rules change (e.g. 20260509c) — one click instead of right-clicking
/// every card.
///
/// Reuses the `scan-progress` event stream so the existing
/// `ScanProgressBar` UI just works (Running for each game finished, then
/// Completed at the end). Returns immediately after spawning the worker
/// task (mirrors `start_scan`).
///
/// Note: unlike incremental scan, this DOES re-search rows that are
/// already bound (including manual). The button is gated by an
/// AlertDialog confirmation in the frontend so this is opt-in.
#[tauri::command]
pub async fn refresh_all_metadata(
    app: AppHandle,
    state: State<'_, AppPaths>,
    scan_state: State<'_, ScanState>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // 20260509g — share the ScanState ctx so `cancel_scan` can stop this
    // bulk refresh too. Mirrors `start_scan` line ~241-245: replace any
    // prior ctx (a stale ctx left by a finished scan is harmless because
    // its cancel flag was never read; replacing keeps semantics simple).
    let ctx = Arc::new(scan::ScanContext::new());
    {
        let mut g = scan_state.ctx.lock().map_err(|_| "scan state mutex poisoned".to_string())?;
        *g = Some(ctx.clone());
    }

    let rows = sqlx::query(
        "SELECT id, path, name, executable_path FROM games ORDER BY id ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;

    let total = rows.len();
    let app_for_emit = app.clone();
    let pool_for_task = pool.clone();
    let ctx_for_task = ctx.clone();

    // Initial Running event so the progress bar opens at 0 / total.
    let _ = app.emit(
        "scan-progress",
        scan::ScanProgress {
            current_dir: String::new(),
            completed: 0,
            total,
            status: scan::ScanStatus::Running,
        },
    );

    if total == 0 {
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

    tokio::spawn(async move {
        for (i, row) in rows.into_iter().enumerate() {
            // 20260509g — cancel check at top of each iteration: if the user
            // clicked the cancel button while we were mid-refresh, stop here
            // (in-flight Bangumi/VNDB request finishes naturally) and emit a
            // terminal Cancelled event so the progress bar UI can clear.
            if ctx_for_task.cancel.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = app_for_emit.emit(
                    "scan-progress",
                    scan::ScanProgress {
                        current_dir: String::new(),
                        completed: i,
                        total,
                        status: scan::ScanStatus::Cancelled,
                    },
                );
                return;
            }

            let id: i64 = match row.try_get("id") {
                Ok(v) => v,
                Err(_) => continue,
            };
            let path: String = match row.try_get("path") {
                Ok(v) => v,
                Err(_) => continue,
            };
            let name: String = match row.try_get("name") {
                Ok(v) => v,
                Err(_) => continue,
            };
            let exec: Option<String> = row.try_get("executable_path").ok();

            // 20260509f — pulse this card while we hit Bangumi+VNDB. The
            // scan-progress terminal status (emitted at the end of this
            // spawn) is the safety net for any missed finished emit; the
            // pair below covers the happy path.
            let _ = app_for_emit.emit(
                "meta-fetch-progress",
                serde_json::json!({ "game_id": id, "phase": "started" }),
            );

            let result = ingest::refresh_for_query(
                id,
                &data_dir,
                &path,
                &name,
                exec.as_deref(),
            )
            .await;

            // Same UPDATE shape as the single-game refresh_metadata: keep
            // the existing cover_path / cover_url / bangumi_id / vndb_id
            // when the new fetch returns NULL (e.g. transient network blip)
            // so we don't blank a working row on a partial failure.
            let _ = sqlx::query(
                "UPDATE games SET name = ?, name_cn = ?, \
                                  cover_path = COALESCE(?, cover_path), \
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
            .bind(id)
            .execute(&*pool_for_task)
            .await;

            let _ = app_for_emit.emit(
                "meta-fetch-progress",
                serde_json::json!({ "game_id": id, "phase": "finished" }),
            );

            let _ = app_for_emit.emit(
                "scan-progress",
                scan::ScanProgress {
                    current_dir: path,
                    completed: i + 1,
                    total,
                    status: scan::ScanStatus::Running,
                },
            );
        }

        let _ = app_for_emit.emit(
            "scan-progress",
            scan::ScanProgress {
                current_dir: String::new(),
                completed: total,
                total,
                status: scan::ScanStatus::Completed,
            },
        );
    });

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
    // ── Phase 4 / schema v4 fields ──
    pub brand: Option<String>,
    pub release_year: Option<i64>,
    pub is_favorite: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Read every row from `games`, ordered by `created_at DESC`.
///
/// Phase 2 has no filter / pagination surface — the Library grid renders the
/// full rowset and virtualizes client-side. Phase 4 server-side filtering /
/// search lives in `search_games` (04b).
///
/// Phase-4 04b extension: also serializes `brand`, `release_year`, and
/// `is_favorite` (added by schema v4 / migration 0004), so the frontend can
/// surface sidebar auto-categories without an extra query.
#[tauri::command]
pub async fn list_games(state: State<'_, AppPaths>) -> Result<Vec<Game>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT id, path, name, name_cn, executable_path, cover_path, cover_url, \
                bangumi_id, vndb_id, total_playtime_sec, last_played_at, status, \
                rating, notes, metadata_source, match_confidence, last_scanned_at, \
                brand, release_year, is_favorite, \
                created_at, updated_at \
         FROM games ORDER BY created_at DESC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(row_to_game(&row)?);
    }
    Ok(out)
}

/// Map a sqlx row to a `Game` struct. Shared by `list_games` and
/// `search_games` to keep field-by-field column wiring consistent.
fn row_to_game(row: &sqlx::sqlite::SqliteRow) -> Result<Game, String> {
    Ok(Game {
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
        brand: row.try_get("brand").ok(),
        release_year: row.try_get("release_year").ok(),
        is_favorite: row.try_get::<i64, _>("is_favorite").unwrap_or(0) != 0,
        created_at: row.try_get("created_at").map_err(err_str)?,
        updated_at: row.try_get("updated_at").map_err(err_str)?,
    })
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
    use_le: Option<bool>,
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
    let bundled_le_proc = state.bundled_le_proc.get().cloned();

    let (_session_id, active, join) = orchestrator::launch_game(orchestrator::LaunchInputs {
        data_dir,
        pool: (*pool).clone(),
        game_id,
        use_le: use_le.unwrap_or(false),
        bundled_le_proc,
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

// ── 03e tray helper: synchronous pool accessor ──────────────────────────────

/// Synchronous accessor for the shared sqlx pool. Used by the tray quit path
/// (`tray::quit_with_session_cleanup`) which runs on the main thread and
/// cannot `.await` the async `AppPaths::pool()` initializer.
///
/// Returns `Err` if either:
///   - `AppPaths` is not in app state (shouldn't happen post-setup), OR
///   - the pool's `OnceCell` has not yet been initialised (no command has
///     touched the DB yet — meaning there can't be an active session anyway,
///     so the tray quit-cleanup path degrades to a plain `app.exit(0)`).
///
/// Intentionally does NOT trigger pool init: doing so would require an async
/// runtime context we don't want to claim from a tray callback.
pub fn get_pool_blocking(app: &AppHandle) -> Result<Arc<SqlitePool>, String> {
    let state = app
        .try_state::<AppPaths>()
        .ok_or_else(|| "AppPaths not in state".to_string())?;
    state
        .pool
        .get()
        .cloned()
        .ok_or_else(|| "pool not initialised".to_string())
}

// ── Phase 4 / 04b: search/sort/filter + tag CRUD + game property updates ────
//
// 13 new commands wired into the frontend's library/sidebar/detail flows. All
// follow the existing `Result<T, String>` Tauri convention and lean on the
// shared `AppPaths`-managed sqlx pool. Schema reference (post-v4):
//   games:     adds brand, release_year, is_favorite (v4) on top of v1/v2/v3.
//   tags:      (id, name UNIQUE, color)                — v1
//   game_tags: (game_id, tag_id)                       — v1, FK CASCADE both ways
//
// Sort + filter SQL is built dynamically; sort_by uses a hard-coded whitelist
// (no user string ever interpolated into the ORDER BY clause), filter clauses
// are bound parameters. The query LIKE clause covers name + name_cn + path
// basename + tags.name (via subquery).

/// Tag row 1:1 mirror.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

/// Filter clauses for `search_games`. All fields are optional and ANDed.
///
/// - `tag_id`: only games tagged with this tag id (via `game_tags` join).
/// - `status`: one of {unplayed, playing, cleared, dropped} (CHECK enforced
///   by the games table; we whitelist here defensively too).
/// - `favorite`: when Some(true), only `is_favorite = 1` rows.
/// - `brand`: exact match against `games.brand` (Phase 4 metadata-fetch fills
///   this). NULL brands never match.
/// - `year_decade`: e.g. 2020 → matches release_year in [2020, 2029].
#[derive(Debug, Deserialize, Clone, Default)]
pub struct SearchFilter {
    pub tag_id: Option<i64>,
    pub status: Option<String>,
    pub favorite: Option<bool>,
    pub brand: Option<String>,
    pub year_decade: Option<i32>,
}

/// Search + sort + filter the `games` table.
///
/// - `query` LIKE-matches against `name`, `name_cn`, the basename of `path`,
///   and any tag name attached via `game_tags`. Empty / whitespace-only query
///   means "no LIKE clause".
/// - `sort_by`: one of `last_played | created_at | name | playtime | rating`.
///   Unknown values → `Err`. NULL-handling matches CONTEXT.md (NULLS LAST for
///   last_played/rating).
/// - `filter`: optional bag of clauses ANDed onto the WHERE.
#[tauri::command]
pub async fn search_games(
    query: Option<String>,
    sort_by: String,
    filter: Option<SearchFilter>,
    state: State<'_, AppPaths>,
) -> Result<Vec<Game>, String> {
    let pool = state.pool().await.map_err(err_str)?;

    // Whitelist sort_by → ORDER BY clause (defensive: never interpolate user
    // input). NULLS LAST on optional columns to keep "no value" rows at the
    // end of ascending-meaning sorts.
    let order_by: &str = match sort_by.as_str() {
        "last_played" => "last_played_at IS NULL, last_played_at DESC",
        "created_at" => "created_at DESC",
        "name" => "name COLLATE NOCASE ASC",
        "playtime" => "total_playtime_sec DESC",
        "rating" => "rating IS NULL, rating DESC",
        other => {
            return Err(format!(
                "sort_by must be one of last_played|created_at|name|playtime|rating (got '{}')",
                other
            ))
        }
    };

    // Build dynamic WHERE clause + bind list. We bind in the same order we
    // append placeholders; bind_args tracks each (kind, value) pair.
    let q = query
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let f = filter.unwrap_or_default();

    let mut where_clauses: Vec<String> = Vec::new();
    // The query argument has 4 placeholders (name, name_cn, path-basename,
    // tag-subquery). We build the sub-SQL and rely on .bind() being called
    // 4 times with the same %q% string.
    if q.is_some() {
        where_clauses.push(
            "(g.name LIKE ? \
              OR g.name_cn LIKE ? \
              OR g.path LIKE ? \
              OR g.id IN ( \
                  SELECT gt.game_id FROM game_tags gt \
                  JOIN tags t ON t.id = gt.tag_id \
                  WHERE t.name LIKE ? \
              ))"
            .to_string(),
        );
    }
    if let Some(tag_id) = f.tag_id {
        where_clauses.push(format!(
            "g.id IN (SELECT game_id FROM game_tags WHERE tag_id = {})",
            tag_id
        ));
    }
    if let Some(status) = f.status.as_deref() {
        // Defensive whitelist (games.status CHECK already enforces this, but
        // bad input here would just return zero rows — surface a clear error).
        match status {
            "unplayed" | "playing" | "cleared" | "dropped" => {}
            other => {
                return Err(format!(
                    "filter.status must be unplayed|playing|cleared|dropped (got '{}')",
                    other
                ))
            }
        }
        where_clauses.push(format!("g.status = '{}'", status));
    }
    if let Some(true) = f.favorite {
        where_clauses.push("g.is_favorite = 1".to_string());
    }
    if f.brand.is_some() {
        where_clauses.push("g.brand = ?".to_string());
    }
    if let Some(decade) = f.year_decade {
        // 2020 → [2020, 2029]; treat decade as anchor. NULL release_year
        // never matches.
        let lo = decade;
        let hi = decade + 9;
        where_clauses.push(format!(
            "g.release_year IS NOT NULL AND g.release_year BETWEEN {} AND {}",
            lo, hi
        ));
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let sql = format!(
        "SELECT g.id, g.path, g.name, g.name_cn, g.executable_path, g.cover_path, g.cover_url, \
                g.bangumi_id, g.vndb_id, g.total_playtime_sec, g.last_played_at, g.status, \
                g.rating, g.notes, g.metadata_source, g.match_confidence, g.last_scanned_at, \
                g.brand, g.release_year, g.is_favorite, \
                g.created_at, g.updated_at \
         FROM games g {} ORDER BY {}",
        where_sql, order_by
    );

    let mut qb = sqlx::query(&sql);
    if let Some(qstr) = &q {
        let like = format!("%{}%", qstr);
        qb = qb.bind(like.clone()).bind(like.clone()).bind(like.clone()).bind(like);
    }
    if let Some(brand) = &f.brand {
        qb = qb.bind(brand);
    }

    let rows = qb.fetch_all(&*pool).await.map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(row_to_game(&row)?);
    }
    Ok(out)
}

// ── Sidebar auto-categories (TAG-04) ─────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct TagWithCount {
    pub tag: Tag,
    pub count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct StatusCount {
    pub status: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct BrandCount {
    pub brand: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct DecadeCount {
    pub decade: i32,
    pub count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct SidebarCategories {
    pub tags: Vec<TagWithCount>,
    pub statuses: Vec<StatusCount>,
    pub brands: Vec<BrandCount>,
    pub year_decades: Vec<DecadeCount>,
    pub favorite_count: i64,
}

/// Aggregate counts for the sidebar's auto-derived sections. 4 SELECTs:
///  - tags + per-tag count via LEFT JOIN game_tags (tags with 0 games still
///    appear → users can see "empty" categories they created).
///  - status counts (only the 4 enum values that actually exist in games).
///  - distinct brands + counts (NULL brand excluded).
///  - decade buckets (2020s / 2010s / etc.) — NULL release_year excluded.
/// Plus a single scalar: favorite_count.
#[tauri::command]
pub async fn get_sidebar_categories(
    state: State<'_, AppPaths>,
) -> Result<SidebarCategories, String> {
    let pool = state.pool().await.map_err(err_str)?;

    // Tags + per-tag game count.
    let tag_rows = sqlx::query(
        "SELECT t.id, t.name, t.color, COUNT(gt.game_id) AS cnt \
         FROM tags t LEFT JOIN game_tags gt ON gt.tag_id = t.id \
         GROUP BY t.id, t.name, t.color \
         ORDER BY t.name COLLATE NOCASE ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut tags = Vec::with_capacity(tag_rows.len());
    for row in tag_rows {
        tags.push(TagWithCount {
            tag: Tag {
                id: row.try_get("id").map_err(err_str)?,
                name: row.try_get("name").map_err(err_str)?,
                color: row.try_get("color").ok(),
            },
            count: row.try_get("cnt").unwrap_or(0),
        });
    }

    // Status counts.
    let status_rows = sqlx::query(
        "SELECT status, COUNT(*) AS cnt FROM games GROUP BY status ORDER BY status",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut statuses = Vec::with_capacity(status_rows.len());
    for row in status_rows {
        statuses.push(StatusCount {
            status: row.try_get("status").map_err(err_str)?,
            count: row.try_get("cnt").unwrap_or(0),
        });
    }

    // Brands (exclude NULL).
    let brand_rows = sqlx::query(
        "SELECT brand, COUNT(*) AS cnt FROM games \
         WHERE brand IS NOT NULL AND brand <> '' \
         GROUP BY brand ORDER BY cnt DESC, brand COLLATE NOCASE ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut brands = Vec::with_capacity(brand_rows.len());
    for row in brand_rows {
        brands.push(BrandCount {
            brand: row.try_get("brand").map_err(err_str)?,
            count: row.try_get("cnt").unwrap_or(0),
        });
    }

    // Year decades. Group by `(release_year / 10) * 10`. NULL excluded.
    let decade_rows = sqlx::query(
        "SELECT (release_year / 10) * 10 AS decade, COUNT(*) AS cnt FROM games \
         WHERE release_year IS NOT NULL \
         GROUP BY decade ORDER BY decade DESC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut year_decades = Vec::with_capacity(decade_rows.len());
    for row in decade_rows {
        let decade_i64: i64 = row.try_get("decade").unwrap_or(0);
        year_decades.push(DecadeCount {
            decade: decade_i64 as i32,
            count: row.try_get("cnt").unwrap_or(0),
        });
    }

    // Favorite count (single scalar).
    let fav_row = sqlx::query("SELECT COUNT(*) AS cnt FROM games WHERE is_favorite = 1")
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let favorite_count: i64 = fav_row.try_get("cnt").unwrap_or(0);

    Ok(SidebarCategories {
        tags,
        statuses,
        brands,
        year_decades,
        favorite_count,
    })
}

// ── Tag CRUD (TAG-01..03) ────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_tags(state: State<'_, AppPaths>) -> Result<Vec<Tag>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE ASC")
        .fetch_all(&*pool)
        .await
        .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(Tag {
            id: row.try_get("id").map_err(err_str)?,
            name: row.try_get("name").map_err(err_str)?,
            color: row.try_get("color").ok(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn create_tag(
    name: String,
    color: Option<String>,
    state: State<'_, AppPaths>,
) -> Result<i64, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("tag name must not be empty".to_string());
    }
    let pool = state.pool().await.map_err(err_str)?;
    let res = sqlx::query("INSERT INTO tags (name, color) VALUES (?, ?)")
        .bind(trimmed)
        .bind(&color)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(res.last_insert_rowid())
}

#[tauri::command]
pub async fn update_tag(
    id: i64,
    name: String,
    color: Option<String>,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("tag name must not be empty".to_string());
    }
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("UPDATE tags SET name = ?, color = ? WHERE id = ?")
        .bind(trimmed)
        .bind(&color)
        .bind(id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_tag(id: i64, state: State<'_, AppPaths>) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    // ON DELETE CASCADE on game_tags.tag_id (Phase 1 schema) → game_tags rows
    // for this tag are auto-removed by SQLite. PRAGMA foreign_keys = ON is set
    // by 0001_init.sql so the cascade actually fires.
    sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

/// Replace the full tag set for `game_id` with `tag_ids` (transactional).
/// Empty `tag_ids` simply clears the tag set. Existing rows for absent tags
/// are deleted, then INSERT for each desired tag — within a single
/// `BEGIN ... COMMIT` so partial writes never linger after an error.
#[tauri::command]
pub async fn set_game_tags(
    game_id: i64,
    tag_ids: Vec<i64>,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let mut tx = pool.begin().await.map_err(err_str)?;

    sqlx::query("DELETE FROM game_tags WHERE game_id = ?")
        .bind(game_id)
        .execute(&mut *tx)
        .await
        .map_err(err_str)?;

    for tid in tag_ids {
        sqlx::query("INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?, ?)")
            .bind(game_id)
            .bind(tid)
            .execute(&mut *tx)
            .await
            .map_err(err_str)?;
    }

    tx.commit().await.map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn list_game_tags(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Vec<Tag>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT t.id, t.name, t.color FROM tags t \
         JOIN game_tags gt ON gt.tag_id = t.id \
         WHERE gt.game_id = ? \
         ORDER BY t.name COLLATE NOCASE ASC",
    )
    .bind(game_id)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(Tag {
            id: row.try_get("id").map_err(err_str)?,
            name: row.try_get("name").map_err(err_str)?,
            color: row.try_get("color").ok(),
        });
    }
    Ok(out)
}

// ── Game property updates (STAT-01..04) ─────────────────────────────────────

#[tauri::command]
pub async fn update_game_status(
    game_id: i64,
    status: String,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    // CHECK constraint already enforces this on the DB side, but a precise
    // String error is nicer than sqlx's generic constraint-failed surface.
    match status.as_str() {
        "unplayed" | "playing" | "cleared" | "dropped" => {}
        other => {
            return Err(format!(
                "status must be unplayed|playing|cleared|dropped (got '{}')",
                other
            ))
        }
    }
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("UPDATE games SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&status)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn update_game_favorite(
    game_id: i64,
    is_favorite: bool,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let val: i64 = if is_favorite { 1 } else { 0 };
    sqlx::query("UPDATE games SET is_favorite = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(val)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn update_game_rating(
    game_id: i64,
    rating: Option<i32>,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    if let Some(r) = rating {
        if !(1..=10).contains(&r) {
            return Err(format!("rating must be 1..=10 or null (got {})", r));
        }
    }
    let pool = state.pool().await.map_err(err_str)?;
    let val: Option<i64> = rating.map(|r| r as i64);
    sqlx::query("UPDATE games SET rating = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(val)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn update_game_notes(
    game_id: i64,
    notes: Option<String>,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("UPDATE games SET notes = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&notes)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

/// Update both `brand` and `release_year` together — used by the metadata
/// re-fetch pipeline (Phase-4 META) when binding/refreshing a game pulls in
/// brand and release-date metadata that 04a's schema-v4 migration added
/// columns for. Both args are independently nullable; passing None for either
/// CLEARS that column (overwrite-with-NULL semantics, matching what the
/// metadata pipeline needs when a refresh returns no brand).
#[tauri::command]
pub async fn update_game_brand_year(
    game_id: i64,
    brand: Option<String>,
    release_year: Option<i32>,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let year_i64: Option<i64> = release_year.map(|y| y as i64);
    sqlx::query(
        "UPDATE games SET brand = ?, release_year = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&brand)
    .bind(year_i64)
    .bind(game_id)
    .execute(&*pool)
    .await
    .map_err(err_str)?;
    Ok(())
}

// ── Phase 5 / 05b: stats + screenshots + save backups (12 commands) ──────────
//
// Stats (2): get_playtime_trend / get_top_games
// Screenshots (5): get_screenshots / delete_screenshot / export_screenshot /
//                  set_screenshot_interval / get_screenshot_settings
// Save backups (5): set_save_path / list_save_backups / create_save_backup /
//                   restore_save_backup / delete_save_backup
//
// All Tauri commands return `Result<T, String>` per project convention. SQL is
// parameter-bound; the only string interpolation is on the whitelisted
// `period` discriminator in `get_playtime_trend` (one of 3 hard-coded SQL
// fragments — never user input verbatim).

// ── Stats (STATS-01, STATS-02) ──────────────────────────────────────────────

/// One bucket on the trend chart. `bucket` is an ISO-style string suitable for
/// the recharts X-axis without further parsing on the frontend:
///   - daily   → "YYYY-MM-DD"
///   - weekly  → "YYYY-Www"  (ISO 8601 week, e.g. "2026-W19")
///   - monthly → "YYYY-MM"
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrendPoint {
    pub bucket: String,
    pub hours: f64,
}

/// Aggregate `sessions.duration_sec` into a per-period chart series.
///
/// Only sessions in terminal status `completed` or `cancelled` count — the
/// pre-`mark_running` ones (status='starting') and `launch_failed` ones have
/// zero playtime and would just contribute zero rows anyway, but excluding
/// them keeps the GROUP BY result smaller on big libraries.
///
/// `days` bounds the window: we look back `days` days from `datetime('now')`.
/// The frontend can pass 30/90/365 from a select. We do NOT clamp `days` here —
/// negative values would simply return no rows, which is harmless.
#[tauri::command]
pub async fn get_playtime_trend(
    period: String,
    days: i32,
    state: State<'_, AppPaths>,
) -> Result<Vec<TrendPoint>, String> {
    let pool = state.pool().await.map_err(err_str)?;

    // Whitelist the SQLite strftime format for each period. Never interpolate
    // user input — always pick from this hard-coded set.
    let bucket_expr: &str = match period.as_str() {
        "daily" => "strftime('%Y-%m-%d', started_at)",
        // SQLite's %W = week-of-year (Mon-start, 00..53). Combined with %Y
        // we get a sortable string close to ISO 8601 (e.g. "2026-W19").
        "weekly" => "strftime('%Y-W%W', started_at)",
        "monthly" => "strftime('%Y-%m', started_at)",
        other => {
            return Err(format!(
                "period must be daily|weekly|monthly (got '{}')",
                other
            ))
        }
    };

    let sql = format!(
        "SELECT {bucket} AS bucket, SUM(duration_sec) / 3600.0 AS hours \
         FROM sessions \
         WHERE status IN ('completed', 'cancelled') \
           AND started_at >= datetime('now', ?) \
         GROUP BY bucket \
         ORDER BY bucket ASC",
        bucket = bucket_expr
    );

    // SQLite expects modifier strings like "-30 days".
    let modifier = format!("-{} days", days);

    let rows = sqlx::query(&sql)
        .bind(&modifier)
        .fetch_all(&*pool)
        .await
        .map_err(err_str)?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(TrendPoint {
            bucket: row.try_get("bucket").map_err(err_str)?,
            hours: row.try_get::<f64, _>("hours").unwrap_or(0.0),
        });
    }
    Ok(out)
}

/// Top-N games by total playtime. Skips zero-playtime games so empty libraries
/// don't render meaningless rows. `limit` is whitelisted at sane bounds (1..=50).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TopGame {
    pub id: i64,
    pub name: String,
    pub name_cn: Option<String>,
    pub total_playtime_sec: i64,
}

#[tauri::command]
pub async fn get_top_games(
    limit: i32,
    state: State<'_, AppPaths>,
) -> Result<Vec<TopGame>, String> {
    if !(1..=50).contains(&limit) {
        return Err(format!("limit must be 1..=50 (got {})", limit));
    }
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT id, name, name_cn, total_playtime_sec FROM games \
         WHERE total_playtime_sec > 0 \
         ORDER BY total_playtime_sec DESC LIMIT ?",
    )
    .bind(limit as i64)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(TopGame {
            id: row.try_get("id").map_err(err_str)?,
            name: row.try_get("name").map_err(err_str)?,
            name_cn: row.try_get("name_cn").ok(),
            total_playtime_sec: row.try_get("total_playtime_sec").unwrap_or(0),
        });
    }
    Ok(out)
}

// ── Screenshots (SHOT-01, SHOT-02) ──────────────────────────────────────────

/// 1:1 mirror of the `screenshots` table. `path` is RELATIVE to `data_dir`
/// (matches how `screenshot::capture_to_disk` writes); the frontend prepends
/// the result of `get_data_dir` when building `<img src>`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScreenshotRow {
    pub id: i64,
    pub game_id: i64,
    pub path: String,
    pub captured_at: String,
}

#[tauri::command]
pub async fn get_screenshots(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Vec<ScreenshotRow>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT id, game_id, path, captured_at FROM screenshots \
         WHERE game_id = ? ORDER BY captured_at DESC",
    )
    .bind(game_id)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(ScreenshotRow {
            id: row.try_get("id").map_err(err_str)?,
            game_id: row.try_get("game_id").map_err(err_str)?,
            path: row.try_get("path").map_err(err_str)?,
            captured_at: row.try_get("captured_at").map_err(err_str)?,
        });
    }
    Ok(out)
}

/// Delete one screenshot — DB row + on-disk PNG. The disk side is best-effort
/// (a missing file is a no-op `Err` we swallow); the DB side is the source of
/// truth, so a stale orphan PNG is preferred to a stale orphan row.
#[tauri::command]
pub async fn delete_screenshot(
    id: i64,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // 1. Read path BEFORE deleting (we need it to remove the file).
    let row = sqlx::query("SELECT path FROM screenshots WHERE id = ?")
        .bind(id)
        .fetch_optional(&*pool)
        .await
        .map_err(err_str)?;
    let path: Option<String> = row.and_then(|r| r.try_get("path").ok());

    // 2. DELETE row first — if this fails, we leave the file alone.
    sqlx::query("DELETE FROM screenshots WHERE id = ?")
        .bind(id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;

    // 3. Best-effort file removal.
    if let Some(rel) = path {
        let abs = data_dir.join(&rel);
        let _ = std::fs::remove_file(&abs);
    }
    Ok(())
}

/// Copy `data/<screenshot.path>` to `target_path` (a user-chosen absolute
/// path from the frontend's file dialog). The dialog already validates
/// writability; here we just need to surface a precise error if the copy
/// fails (e.g. user picked a read-only drive).
#[tauri::command]
pub async fn export_screenshot(
    id: i64,
    target_path: String,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();
    let row = sqlx::query("SELECT path FROM screenshots WHERE id = ?")
        .bind(id)
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let rel: String = row.try_get("path").map_err(err_str)?;
    let src = data_dir.join(&rel);
    std::fs::copy(&src, &target_path).map_err(err_str)?;
    Ok(())
}

/// Update `games.screenshot_interval_sec`. 0 = disable capture entirely; any
/// other value < 60 will be silently clamped to 60 inside the orchestrator
/// (see launch_game), so the UI doesn't need to enforce that lower bound.
#[tauri::command]
pub async fn set_screenshot_interval(
    game_id: i64,
    interval_sec: i32,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    if interval_sec < 0 {
        return Err(format!("interval_sec must be ≥ 0 (got {})", interval_sec));
    }
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("UPDATE games SET screenshot_interval_sec = ? WHERE id = ?")
        .bind(interval_sec as i64)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn get_screenshot_settings(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<i32, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let row = sqlx::query("SELECT screenshot_interval_sec FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let v: i64 = row.try_get("screenshot_interval_sec").unwrap_or(300);
    Ok(v as i32)
}

// ── Save backups (SAVE-01, SAVE-02, SAVE-03) ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SaveBackupRow {
    pub id: i64,
    pub game_id: i64,
    pub backup_dir: String,
    pub file_count: i64,
    pub total_size_bytes: i64,
    pub created_at: String,
    pub note: Option<String>,
}

/// Set (or clear) `games.save_path`. The frontend feeds in a directory path
/// from a Tauri dialog picker — we store it verbatim. None clears the column,
/// disabling backup until the user re-configures.
#[tauri::command]
pub async fn set_save_path(
    game_id: i64,
    save_path: Option<String>,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("UPDATE games SET save_path = ? WHERE id = ?")
        .bind(&save_path)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

/// Read the current `games.save_path` for a game. Returns `None` (JSON `null`)
/// when the user hasn't configured a save dir yet. Added in 05e so the Detail
/// SavesTab can hydrate the read-only path Input on page mount without forcing
/// the user to re-pick after restart. (Rule 2: missing critical functionality —
/// `set_save_path` exists but no symmetric reader; the column lives in `games`
/// but `row_to_game` doesn't surface it, keeping `Game` lean.)
#[tauri::command]
pub async fn get_save_path(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Option<String>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let row = sqlx::query("SELECT save_path FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    Ok(row.try_get::<Option<String>, _>("save_path").unwrap_or(None))
}

#[tauri::command]
pub async fn list_save_backups(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Vec<SaveBackupRow>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT id, game_id, backup_dir, file_count, total_size_bytes, created_at, note \
         FROM save_backups WHERE game_id = ? ORDER BY created_at DESC",
    )
    .bind(game_id)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(SaveBackupRow {
            id: row.try_get("id").map_err(err_str)?,
            game_id: row.try_get("game_id").map_err(err_str)?,
            backup_dir: row.try_get("backup_dir").map_err(err_str)?,
            file_count: row.try_get("file_count").unwrap_or(0),
            total_size_bytes: row.try_get("total_size_bytes").unwrap_or(0),
            created_at: row.try_get("created_at").map_err(err_str)?,
            note: row.try_get("note").ok(),
        });
    }
    Ok(out)
}

/// Snapshot the game's currently-configured save dir. Returns the new
/// `save_backups` row id so the frontend can immediately optimistic-update.
///
/// Errors:
///   - "save path not configured" — `games.save_path IS NULL`
///   - "source not found: ..." — the configured dir was deleted/moved on disk
///
/// Note: `save_backup::create_backup` is sync (disk-bound, < 100ms typically).
/// For very large save dirs the call can block the runtime; the v1 trade-off
/// is "simpler error path" over "always non-blocking". If profiling shows it,
/// wrap in `tokio::task::spawn_blocking` later.
#[tauri::command]
pub async fn create_save_backup(
    game_id: i64,
    note: Option<String>,
    state: State<'_, AppPaths>,
) -> Result<i64, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Read save_path. Bail early on NULL (don't even start a directory walk).
    let row = sqlx::query("SELECT save_path FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let save_path: Option<String> = row.try_get("save_path").ok();
    let src = save_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "save path not configured".to_string())?;

    // Recursive copy → BackupResult.
    let result = crate::save_backup::create_backup(&data_dir, game_id, Path::new(src))
        .map_err(err_str)?;

    // INSERT into save_backups. backup_dir is the relative path (saves/ID/TS).
    let res = sqlx::query(
        "INSERT INTO save_backups (game_id, backup_dir, file_count, total_size_bytes, note) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(game_id)
    .bind(&result.backup_dir)
    .bind(result.file_count)
    .bind(result.total_size_bytes)
    .bind(&note)
    .execute(&*pool)
    .await
    .map_err(err_str)?;

    Ok(res.last_insert_rowid())
}

/// Restore a backup back into the game's currently-configured save_path.
/// **Overwrites existing files in the live save dir** — the frontend confirm
/// dialog is the user-consent gate for this destructive operation.
#[tauri::command]
pub async fn restore_save_backup(
    id: i64,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Read backup_dir + game_id (to look up save_path).
    let row = sqlx::query("SELECT game_id, backup_dir FROM save_backups WHERE id = ?")
        .bind(id)
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let game_id: i64 = row.try_get("game_id").map_err(err_str)?;
    let backup_dir: String = row.try_get("backup_dir").map_err(err_str)?;

    // Look up the current save_path for game_id (NOT cached on save_backups
    // intentionally — the user may have moved the save dir between backup
    // and restore; we always restore to the current configured location).
    let g = sqlx::query("SELECT save_path FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let save_path: Option<String> = g.try_get("save_path").ok();
    let dst = save_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "save path not configured".to_string())?;

    crate::save_backup::restore_backup(&data_dir, &backup_dir, Path::new(dst))
        .map_err(err_str)?;
    Ok(())
}

/// Delete a backup — disk tree first, then DB row. Tree-delete is idempotent
/// (no-op when already gone), so a previously-failed delete that left a stale
/// row can be retried safely.
#[tauri::command]
pub async fn delete_save_backup(
    id: i64,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    let row = sqlx::query("SELECT backup_dir FROM save_backups WHERE id = ?")
        .bind(id)
        .fetch_optional(&*pool)
        .await
        .map_err(err_str)?;
    let backup_dir: Option<String> = row.and_then(|r| r.try_get("backup_dir").ok());

    if let Some(rel) = backup_dir {
        crate::save_backup::delete_backup_dir(&data_dir, &rel).map_err(err_str)?;
    }

    sqlx::query("DELETE FROM save_backups WHERE id = ?")
        .bind(id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

// ── Quick task 20260509b — open path in OS file manager ────────────────────
//
// Used by the Detail-page 更多 menu's 打开本地目录 entry. Validates that the
// path exists so a stale `games.path` (deleted directory) surfaces a clean
// error instead of Explorer's generic "location not available" dialog.
//
// `Command::arg(path)` passes the path as a separate argv entry — no shell
// interpretation, no command injection vector. The path itself originates
// from `games.path`, which the user added during scan.
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    use std::process::Command;
    if !Path::new(&path).exists() {
        return Err(format!("路径不存在：{}", path));
    }
    Command::new("explorer")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法打开 Explorer：{}", e))
}
