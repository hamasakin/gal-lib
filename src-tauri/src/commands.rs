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
use crate::metadata::types::MetadataSource;
use crate::{ingest, metadata, scan, AppPaths};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::task::JoinSet;

/// Serializes the entire `launch_game` command — eliminates the TOCTOU race
/// where two concurrent invocations both observed `active_state == None`
/// between the pre-check lock and the post-spawn lock, then both spawned LE
/// and the second `*g = Some(entry)` overwrote the first (CR-02 in 260524
/// review, leaving the first game's wait/screenshot tasks orphaned and
/// uncontrollable). The full launch path (prepare + spawn + INSERT) takes
/// ≤1s on a healthy install, so serializing is invisible to the user but
/// closes the race definitively. tokio::sync::Mutex is required (the lock
/// is held across `.await`); once_cell::Lazy avoids the const-fn version
/// bump that `Mutex::const_new` would require.
static LAUNCH_SERIAL: Lazy<tokio::sync::Mutex<()>> =
    Lazy::new(|| tokio::sync::Mutex::new(()));

/// 20260509g — cross-game ingest concurrency. Bangumi (1 req/s) and VNDB
/// (~30/min, burst 1) limiters are process-wide governor token-buckets, so
/// this number does not bypass rate limits — it bounds how many tasks
/// queue on the limiter in parallel. Lowered 4 -> 2 (debug session
/// auto-scan-metadata-match-low): VNDB enrichment already fans a matched
/// game out to 4 VNDB calls, so 2 concurrent games saturates the 30/min
/// limiter; 4-way only piled extra in-flight load against VNDB throttle.
const INGEST_CONCURRENCY: usize = 2;

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

/// Phase 13 (POL-03) — shared cancel flag for any in-flight backfill loop.
/// One `AtomicBool` is enough because each backfill IPC fire-and-forgets a
/// single tokio task; the per-iteration check is the only way
/// `cancel_backfill` can stop it. Currently retained for potential future
/// background tasks (quick 260513-3df folded `backfill_release_year` into
/// the shared-ScanState-based `refresh_metadata_smart`).
pub struct BackfillState {
    pub cancel: std::sync::atomic::AtomicBool,
}

impl BackfillState {
    pub fn new() -> Self {
        Self {
            cancel: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl Default for BackfillState {
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
/// without doing any network I/O or cover work. Resolves the `games.id` via
/// the `RETURNING id` clause — correct for BOTH the fresh-insert path and the
/// ON CONFLICT(path) upsert-update path.
///
/// Idempotent: a second call with the same path returns the same id (the
/// ON CONFLICT branch keeps the row stable). `start_scan` deliberately calls
/// it twice per discovered directory — once in the pre-ingest batch loop to
/// make placeholders visible immediately, then again at the head of each
/// ingest iteration to recover the id without threading a parallel `Vec<i64>`.
///
/// 20260516 — id resolution fixed. The previous form keyed off
/// `last_insert_rowid() != 0`, assuming the value is 0 when the upsert takes
/// the DO UPDATE branch. It is not: SQLite leaves `last_insert_rowid()`
/// pointing at the connection's *previous* real INSERT when no new row is
/// inserted. On the pooled connection that ran the pre-ingest batch loop,
/// every ingest-loop call therefore resolved a STALE rowid (the last
/// placeholder inserted) instead of the row actually being processed —
/// metadata was applied to the wrong `games` row and most games never got
/// enriched. `RETURNING id` reports the affected row's id directly, so both
/// branches are correct regardless of pooled-connection history.
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
    let game_id: i64 = sqlx::query(
        "INSERT INTO games (path, name, executable_path, screenshot_interval_sec) \
         VALUES (?, ?, ?, 0) \
         ON CONFLICT(path) DO UPDATE SET name=excluded.name, executable_path=excluded.executable_path \
         RETURNING id",
    )
    .bind(&path_str)
    .bind(&dg.clean_name)
    .bind(&exec_str)
    .fetch_one(pool)
    .await
    .and_then(|r| r.try_get::<i64, _>("id"))
    .map_err(err_str)?;

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
    apply_ingest_result(pool, game_id, &result).await
}

/// 20260509g — shared UPDATE for an `IngestResult`. Extracted from
/// `enrich_metadata_for_dir` so the start_scan parallel ingest path
/// (which calls `ingest::process_game_cached` directly to thread the
/// cross-game query cache through) can reuse the same SQL without
/// duplicating it. UPDATE shape is identical to the prior inline form
/// (cover_path / cover_url overwritten unconditionally, matching the
/// original two-phase enrich semantics).
async fn apply_ingest_result(
    pool: &SqlitePool,
    game_id: i64,
    result: &ingest::IngestResult,
) -> Result<(), String> {
    // Phase 11 — `summary` overwrites unconditionally (NULL clears stale data
    // when a re-fetch returns empty). `brand` uses COALESCE so a manually-set
    // brand survives a re-fetch where the source returns NULL — symmetric
    // with how `update_game_brand_year` lets users curate brand independently.
    // Quick 20260512b — release_year written via COALESCE (preserve manual
    // year override, symmetric with brand).
    let release_year_i64: Option<i64> = result.release_year.map(|y| y as i64);
    // Quick 260525-g1m — external_rating 三列写"覆盖"语义（与 summary 同），不走 COALESCE：
    // 用户主动刷新元数据就期望最新评分覆盖旧值；无 match 路径 IngestResult 三字段为 None
    // 自然写入 NULL（与 metadata_source = "none" 一致）。
    sqlx::query(
        "UPDATE games SET name = ?, name_cn = ?, cover_path = ?, cover_url = ?, \
                          bangumi_id = ?, vndb_id = ?, metadata_source = ?, \
                          match_confidence = ?, summary = ?, \
                          brand = COALESCE(?, brand), \
                          release_year = COALESCE(?, release_year), \
                          external_rating = ?, \
                          external_rating_count = ?, \
                          external_rating_source = ?, \
                          last_scanned_at = datetime('now'), \
                          metadata_fetched_at = datetime('now') \
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
    .bind(&result.summary)
    .bind(&result.brand)
    .bind(release_year_i64)
    .bind(result.external_rating)
    .bind(result.external_rating_count)
    .bind(&result.external_rating_source)
    .bind(game_id)
    .execute(pool)
    .await
    .map_err(err_str)?;

    // Phase 11 — write_staff_and_tags handles the persons/game_staff/
    // game_official_tags side. metadata_source on the IngestResult drives
    // the official_tags.source column; if metadata_source is "none"
    // (no-match path), there are no staff/tags to write so the helper
    // is a fast no-op (DELETE clears stale rows + the loops exit on empty).
    write_staff_and_tags(pool, game_id, &result.metadata_source, result).await?;

    // Phase 12 — sync scan_review_queue. Low-confidence or no-match ingests
    // enqueue the game for manual review; high-confidence ingests clear any
    // stale queue entry so a re-scan that finally succeeded auto-dismisses
    // the row.
    sync_review_queue_for_game(
        pool,
        game_id,
        &result.games_path,
        &result.metadata_source,
        result.match_confidence,
    )
    .await?;

    Ok(())
}

/// Phase 12 — keep `scan_review_queue` in sync with the latest ingest outcome.
///
/// Two paths:
///   1. metadata_source == "none" OR match_confidence < 80 → INSERT OR REPLACE
///      a queue row. INSERT OR REPLACE on the (game_id) PK keeps a single most-
///      recent entry per game and refreshes `created_at` so freshly-rescanned
///      items rise to the top of the user's review list.
///   2. otherwise (confident bind / re-scan succeeded) → DELETE any existing
///      queue row for this game so the queue reflects current state.
///
/// `metadata_source_id` is NULL when the source returned no match (suggested
/// fields are NULL in that case); for low-confidence Bangumi/VNDB binds the
/// source itself goes in `suggested_source` and the bound id in `suggested_id`
/// so the review-queue UI can pre-select the source the auto-bind chose.
async fn sync_review_queue_for_game(
    pool: &SqlitePool,
    game_id: i64,
    game_path: &str,
    metadata_source: &str,
    match_confidence: Option<u8>,
) -> Result<(), String> {
    let confidence = match_confidence.unwrap_or(0) as i64;
    let needs_review = metadata_source == "none" || confidence < 80;

    if needs_review {
        let (suggested_source, suggested_id) = if metadata_source == "none" {
            (None, None)
        } else {
            // bound row id is on `games.bangumi_id` / `games.vndb_id`; cheap
            // round-trip is fine here since the queue insert is rare (only
            // when confidence < 80).
            let row = sqlx::query("SELECT bangumi_id, vndb_id FROM games WHERE id = ?")
                .bind(game_id)
                .fetch_optional(pool)
                .await
                .map_err(err_str)?;
            let sid = row.and_then(|r| {
                match metadata_source {
                    "bangumi" => r.try_get::<Option<String>, _>("bangumi_id").ok().flatten(),
                    "vndb" => r.try_get::<Option<String>, _>("vndb_id").ok().flatten(),
                    _ => None,
                }
            });
            (Some(metadata_source.to_string()), sid)
        };

        sqlx::query(
            "INSERT OR REPLACE INTO scan_review_queue \
                 (game_id, game_path, current_confidence, suggested_source, suggested_id, created_at) \
             VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(game_id)
        .bind(game_path)
        .bind(confidence)
        .bind(suggested_source)
        .bind(suggested_id)
        .execute(pool)
        .await
        .map_err(err_str)?;
    } else {
        sqlx::query("DELETE FROM scan_review_queue WHERE game_id = ?")
            .bind(game_id)
            .execute(pool)
            .await
            .map_err(err_str)?;
    }
    Ok(())
}

/// Phase 12 — remove a game from the review queue. Used by `bind_metadata`
/// (manual bind = confidence 100, no longer needs review) and the explicit
/// `dismiss_review_item` / `accept_review_candidate` IPCs.
async fn delete_from_review_queue(pool: &SqlitePool, game_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM scan_review_queue WHERE game_id = ?")
        .bind(game_id)
        .execute(pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

/// Phase 11 — DELETE-then-INSERT staff + official_tags for `game_id`.
/// Wrapped in a single transaction so a partial failure (e.g. a UNIQUE
/// collision on persons mid-loop) doesn't leave half-written enrichment.
///
/// `source_str` is the metadata_source string ("bangumi" | "vndb" | "none" |
/// "manual") that's already on the IngestResult — passed in verbatim so
/// game_official_tags.source matches games.metadata_source.
///
/// The DELETE pair always runs (even when staff/tags are empty) so that a
/// re-fetch which returns 0 rows correctly clears stale rows rather than
/// leaving them. Personal `INSERT OR IGNORE` handles duplicate persons rows
/// gracefully when two different games share a contributor; the upsert
/// returns the existing rowid via the UNIQUE(source, source_id) index.
async fn write_staff_and_tags(
    pool: &SqlitePool,
    game_id: i64,
    source_str: &str,
    result: &ingest::IngestResult,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(err_str)?;

    sqlx::query("DELETE FROM game_staff WHERE game_id = ?")
        .bind(game_id)
        .execute(&mut *tx)
        .await
        .map_err(err_str)?;
    sqlx::query("DELETE FROM game_official_tags WHERE game_id = ?")
        .bind(game_id)
        .execute(&mut *tx)
        .await
        .map_err(err_str)?;

    for person in &result.staff {
        let person_source_str = match person.source {
            MetadataSource::Bangumi => "bangumi",
            MetadataSource::Vndb => "vndb",
            MetadataSource::Manual => "manual",
            MetadataSource::None => continue, // shouldn't occur, defensive
        };
        // Look up existing person by (source, source_id); if missing, insert
        // and grab the new rowid. UNIQUE(source, source_id) ensures the
        // SELECT-then-INSERT race is harmless (concurrent inserts would hit
        // the unique constraint and we'd just retry the SELECT next call —
        // but we're inside a tx so this is single-threaded anyway).
        let existing = sqlx::query("SELECT id FROM persons WHERE source = ? AND source_id = ?")
            .bind(person_source_str)
            .bind(&person.source_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(err_str)?;
        let person_id: i64 = match existing {
            Some(row) => row.try_get("id").map_err(err_str)?,
            None => {
                let r = sqlx::query(
                    "INSERT INTO persons (name, name_cn, source, source_id) VALUES (?, ?, ?, ?)",
                )
                .bind(&person.name)
                .bind(&person.name_cn)
                .bind(person_source_str)
                .bind(&person.source_id)
                .execute(&mut *tx)
                .await
                .map_err(err_str)?;
                r.last_insert_rowid()
            }
        };
        // character_name column is NOT NULL DEFAULT ''. We coerce None to ''
        // here so the PK (game_id, person_id, role, character_name) properly
        // dedups non-voice entries (NULLs would be treated as distinct,
        // letting INSERT OR IGNORE accept duplicates).
        let character_name = person.character_name.as_deref().unwrap_or("");
        sqlx::query(
            "INSERT OR IGNORE INTO game_staff (game_id, person_id, role, character_name) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(game_id)
        .bind(person_id)
        .bind(person.role.as_str())
        .bind(character_name)
        .execute(&mut *tx)
        .await
        .map_err(err_str)?;
    }

    for tag in &result.tags {
        sqlx::query(
            "INSERT OR IGNORE INTO game_official_tags (game_id, tag_name, source, weight) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(game_id)
        .bind(&tag.name)
        .bind(source_str)
        .bind(tag.weight)
        .execute(&mut *tx)
        .await
        .map_err(err_str)?;
    }

    tx.commit().await.map_err(err_str)?;
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

// ── Path-guard for IPC commands that accept arbitrary game directories ─────

/// Defense-in-depth guard against the frontend (or a malicious renderer)
/// registering a Windows system directory as a "game" — which the
/// subsequent ingest + on-disk cover/save-backup paths would then dutifully
/// touch. CR-03 in 260524 review. Applied to `add_game`, `restore_removed_dir`,
/// and `split_game_into_subdirs`.
///
/// Strategy: canonicalize the input, then reject if the result lies under
/// any well-known Windows system root resolved from environment variables
/// (so the guard works correctly on machines where Windows is installed on
/// a drive other than C:). Also rejects the literal drive-root case, since
/// registering an entire drive as a single game would be nonsensical and
/// would let any path under that drive be touched.
fn ensure_safe_game_dir(target: &Path) -> Result<(), String> {
    // canonicalize handles symlinks + relative-resolution. Fail closed on
    // bad inputs (path doesn't exist or unreadable).
    let canon = std::fs::canonicalize(target)
        .map_err(|e| format!("路径不可解析: {} ({})", target.display(), e))?;

    // Resolve forbidden roots from Windows env vars (no hard-coded "C:\Windows"
    // — works regardless of system drive letter).
    let forbidden_roots: Vec<PathBuf> = [
        std::env::var_os("SystemRoot"),
        std::env::var_os("WINDIR"),
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
        std::env::var_os("ProgramData"),
    ]
    .into_iter()
    .flatten()
    .filter_map(|s| std::fs::canonicalize(PathBuf::from(s)).ok())
    .collect();

    for root in &forbidden_roots {
        if canon.starts_with(root) {
            return Err(format!(
                "禁止将系统目录注册为游戏: {}",
                target.display()
            ));
        }
    }

    // Reject literal drive-root (`C:\` after canonicalization has no parent).
    if canon.parent().is_none() {
        return Err(format!(
            "禁止注册整个驱动器为游戏: {}",
            target.display()
        ));
    }

    Ok(())
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

/// Atomic depth update — single UPDATE replacing the previous remove+add
/// dance in Settings (which could lose the row entirely if the add half
/// failed mid-way; WR-04 in 260524 review).
#[tauri::command]
pub async fn update_scan_root_depth(
    id: i64,
    depth: u8,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    if !(1..=3).contains(&depth) {
        return Err(format!("depth must be 1..=3 (got {})", depth));
    }
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("UPDATE scan_roots SET depth = ? WHERE id = ?")
        .bind(depth as i64)
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
    // 20260516 — scan modes unified to incremental behaviour. Both "full" and
    // "incremental" now skip games already bound to a source and only (re)run
    // the metadata pipeline on unbound directories — see the `existing_paths`
    // query below. `mode` is still validated for API compatibility (the
    // frontend passes "full"/"incremental") but no longer changes behaviour.
    match mode.as_str() {
        "full" | "incremental" => {}
        other => return Err(format!("mode must be 'full' or 'incremental' (got '{}')", other)),
    }

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
                phase: scan::ScanPhase::Discovering,
            },
        );
        return Ok(());
    }

    // Skip set for the scan: directories whose `games` row is already bound
    // to a source. Filter to *bound* rows only — directories whose row has
    // metadata_source='none' (i.e. 「待复核」: scan happened but neither
    // Bangumi nor VNDB cleared the auto-bind threshold) are intentionally
    // excluded so a rescan re-runs the metadata pipeline on them. The
    // standard cleaning + scoring rules may have improved (see 20260509c)
    // and the user shouldn't have to right-click each unbound card to retry.
    // Manual binds ARE in the skip set so a rescan never overwrites a user's
    // explicit choice.
    //
    // 20260516 — applied unconditionally (both scan modes). A matched game
    // missing only its cover stays skipped here; covers are refreshed per
    // game via GameCard's 「重新抓取封面」, not by a full re-ingest.
    let mut existing_paths: HashSet<PathBuf> = {
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
    };

    // Quick 260516-q3y — UNION in the persistent skip-list. `scan_skip_dirs`
    // holds brand parent directories that were split into per-game subdir
    // entries (see `split_game_into_subdirs`); folding them into the same skip
    // set means a full scan never re-discovers the parent as a duplicate game.
    {
        let rows = sqlx::query("SELECT path FROM scan_skip_dirs")
            .fetch_all(&*pool)
            .await
            .map_err(err_str)?;
        for r in rows {
            if let Ok(p) = r.try_get::<String, _>("path") {
                existing_paths.insert(PathBuf::from(p));
            }
        }
    }

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
            // 20260516 — always run with the skip set active; see the
            // mode-unification note in start_scan above.
            true,
            ctx.clone(),
            on_progress,
        )
        .await;

        let discovered = match scan_res {
            // L9N-02 — run_scan now returns a ScanOutcome; start_scan only
            // needs the discovered games. removed_dirs is surfaced separately
            // via the `list_removed_dirs` IPC for the /scan review section.
            Ok(o) => o.discovered,
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
                        phase: scan::ScanPhase::Discovering,
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
                    phase: scan::ScanPhase::Discovering,
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
        // Transition event — reset the progress bar to phase 2 (ingest).
        // Emit BEFORE the placeholder loop so the UI flips copy from
        // "扫描目录中…" to "获取元数据 — …" immediately, then per-row
        // progress events update the directory shown in the bar.
        let _ = app_for_emit.emit(
            "scan-progress",
            scan::ScanProgress {
                current_dir: String::new(),
                completed: 0,
                total,
                status: scan::ScanStatus::Running,
                phase: scan::ScanPhase::Enriching,
            },
        );

        // Quick 260515-prog — Phase 2 placeholders: each successful INSERT
        // emits a `games-changed` event so the Library grid throttle-refetches
        // and the new row appears with the "获取中" badge before its metadata
        // fetch even starts.
        for dg in &discovered {
            if ctx.cancel.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = app_for_emit.emit(
                    "scan-progress",
                    scan::ScanProgress {
                        current_dir: String::new(),
                        completed: 0,
                        total,
                        status: scan::ScanStatus::Cancelled,
                        phase: scan::ScanPhase::Enriching,
                    },
                );
                return;
            }
            if insert_placeholder_dir(&*pool_for_task, dg).await.is_ok() {
                let _ = app_for_emit.emit("games-changed", ());
            }
        }

        // 20260509g — cross-game ingest concurrency. Up to INGEST_CONCURRENCY
        // tasks run in parallel; each one re-resolves its placeholder id
        // (idempotent ON CONFLICT(path)), runs `process_game_cached` so
        // duplicate cleaned queries dedup against the shared cache, then
        // applies the IngestResult via `apply_ingest_result`.
        //
        // Same-game Bangumi+VNDB stay parallel (`pick_best_across_sources`
        // uses tokio::join!) and aggressive_candidates fan-out stays
        // sequential per game — only the OUTER cross-game loop is parallel.
        //
        // Cancellation: the cancel flag is checked (a) before spawning each
        // new task and (b) inside each spawned task at its top so in-flight
        // tasks abort before doing more work. In-flight HTTP requests can't
        // be interrupted; worst case is INGEST_CONCURRENCY tasks completing
        // their current network round-trip before stopping.
        let query_cache = ingest::new_query_cache();
        let completed = Arc::new(AtomicUsize::new(0));
        let mut set: JoinSet<()> = JoinSet::new();
        let mut iter = discovered.into_iter();

        loop {
            // Quick 260515-cancel — if cancel just fired, drop everything in
            // flight immediately. `abort_all` cancels the JoinSet's tasks,
            // which makes their pending `process_game_cached` awaits return
            // (the underlying reqwest connections are torn down by tokio's
            // future-drop semantics). Without this, the terminal Cancelled
            // event waited for up to INGEST_CONCURRENCY full HTTP round-trips
            // (≈5–20 s) before the progress bar could even start its
            // auto-hide timer.
            if ctx.cancel.load(Ordering::Relaxed) && !set.is_empty() {
                set.abort_all();
            }

            // 1) Refill: spawn until we hit INGEST_CONCURRENCY in-flight tasks
            //    or run out of input. After cancel, stop spawning so the loop
            //    can drain + return.
            while set.len() < INGEST_CONCURRENCY {
                if ctx.cancel.load(Ordering::Relaxed) {
                    break;
                }
                let Some(dg) = iter.next() else { break };

                let pool_t = pool_for_task.clone();
                let data_dir_t = data_dir.clone();
                let app_t = app_for_emit.clone();
                let ctx_t = ctx.clone();
                let cache_t = query_cache.clone();
                let completed_t = completed.clone();
                let total_t = total;

                set.spawn(async move {
                    // Per-task cancel check — racy but cheap; the bigger
                    // savings come from avoiding the network round-trip.
                    if ctx_t.cancel.load(Ordering::Relaxed) {
                        return;
                    }

                    let path_str = dg.path.to_string_lossy().to_string();

                    // Re-resolve the placeholder id (idempotent INSERT with
                    // ON CONFLICT returns the existing rowid). On failure
                    // bump the counter so the progress bar still advances.
                    let game_id = match insert_placeholder_dir(&*pool_t, &dg).await {
                        Ok(id) => id,
                        Err(_) => {
                            let n = completed_t.fetch_add(1, Ordering::Relaxed) + 1;
                            let _ = app_t.emit(
                                "scan-progress",
                                scan::ScanProgress {
                                    current_dir: path_str,
                                    completed: n,
                                    total: total_t,
                                    status: scan::ScanStatus::Running,
                                    phase: scan::ScanPhase::Enriching,
                                },
                            );
                            return;
                        }
                    };

                    // Second cancel check — the placeholder INSERT may have
                    // taken a moment under contention; user might have
                    // already cancelled by now.
                    if ctx_t.cancel.load(Ordering::Relaxed) {
                        return;
                    }

                    let _ = app_t.emit(
                        "meta-fetch-progress",
                        serde_json::json!({ "game_id": game_id, "phase": "started" }),
                    );

                    // Cache-aware enrich: cross-game query dedup happens
                    // inside `process_game_cached`. Then UPDATE via shared
                    // helper so SQL stays in one place.
                    let res = ingest::process_game_cached(game_id, &data_dir_t, &dg, &cache_t).await;
                    let _ = apply_ingest_result(&*pool_t, game_id, &res).await;
                    // Quick 260515-prog — UPDATE happened (success OR fallback
                    // to placeholder-with-empty-metadata); either way the row
                    // mutated, so prompt the Library to throttle-refetch.
                    let _ = app_t.emit("games-changed", ());

                    let _ = app_t.emit(
                        "meta-fetch-progress",
                        serde_json::json!({ "game_id": game_id, "phase": "finished" }),
                    );

                    let n = completed_t.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = app_t.emit(
                        "scan-progress",
                        scan::ScanProgress {
                            current_dir: path_str,
                            completed: n,
                            total: total_t,
                            status: scan::ScanStatus::Running,
                            phase: scan::ScanPhase::Enriching,
                        },
                    );
                });
            }

            // 2) Wait for any one task to finish. When all in-flight tasks
            //    have drained AND iter is exhausted (or cancel was set),
            //    set.join_next() returns None → loop exits.
            if set.join_next().await.is_none() {
                break;
            }
        }

        // 3) Terminal event — Cancelled if cancel flag was flipped during
        //    the loop, otherwise Completed. `completed` reflects however
        //    many tasks actually finished before cancel propagated.
        if ctx.cancel.load(Ordering::Relaxed) {
            let _ = app_for_emit.emit(
                "scan-progress",
                scan::ScanProgress {
                    current_dir: String::new(),
                    completed: completed.load(Ordering::Relaxed),
                    total,
                    status: scan::ScanStatus::Cancelled,
                    phase: scan::ScanPhase::Enriching,
                },
            );
        } else {
            // Terminal Completed — emitted AFTER all ingest work is durable
            // in DB, so the frontend's status==="completed" → refetch sees
            // the rows.
            let _ = app_for_emit.emit(
                "scan-progress",
                scan::ScanProgress {
                    current_dir: String::new(),
                    completed: total,
                    total,
                    status: scan::ScanStatus::Completed,
                    phase: scan::ScanPhase::Enriching,
                },
            );
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
    ensure_safe_game_dir(&dir)?;
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

// ── Quick 260516-q3y — subdir split ─────────────────────────────────────────

/// One direct child directory of a path being inspected for subdir-split.
/// serde keeps field names snake_case (the frontend reads them verbatim).
#[derive(Debug, Serialize)]
pub struct SubdirEntry {
    /// Directory basename.
    pub name: String,
    /// Absolute path to the child directory.
    pub path: String,
    /// `clean_title(name)` — the search-friendly title preview.
    pub clean_title: String,
    /// Best executable found under the child directory, if any (absolute path).
    pub exe: Option<String>,
}

/// List the *direct* child directories of `path` (files filtered out), each
/// annotated with a cleaned-title preview and a detected best executable.
/// Used by the「整理子目录」dialog to let the user pick which subdirs become
/// independent game entries.
#[tauri::command]
pub async fn list_subdirs(path: String) -> Result<Vec<SubdirEntry>, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("path is not a directory: {}", path));
    }

    let read = std::fs::read_dir(&dir).map_err(err_str)?;
    let mut out: Vec<SubdirEntry> = read
        // Ignore per-entry read errors (sealed/locked dirs) — same tolerant
        // style as scan::walker.
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let child = e.path();
            let name = child
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let clean_title = crate::title_clean::clean_title(&name);
            let exe = crate::scan::walker::pick_best_exe(&child)
                .map(|p| p.to_string_lossy().into_owned());
            SubdirEntry {
                name,
                path: child.to_string_lossy().into_owned(),
                clean_title,
                exe,
            }
        })
        .collect();

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Split a mis-scanned brand parent directory into N independent game entries.
///
/// For each path in `paths` a fresh `DiscoveredGame` is built and fed to
/// `ingest_one_dir` (= placeholder INSERT + metadata pipeline), so every new
/// entry auto-runs metadata matching. After all subdirs ingest successfully
/// the original parent `games` row is deleted (scan_review_queue rows cascade
/// via the v9 FK ON DELETE CASCADE) and the parent path is recorded in
/// `scan_skip_dirs` so a later full scan never re-discovers it as a game.
///
/// Returns the ids of the newly created entries.
#[tauri::command]
pub async fn split_game_into_subdirs(
    game_id: i64,
    paths: Vec<String>,
    state: State<'_, AppPaths>,
) -> Result<Vec<i64>, String> {
    if paths.is_empty() {
        return Err("未选择任何子目录".to_string());
    }

    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Resolve the original parent directory path.
    let parent_path: String = sqlx::query("SELECT path FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_optional(&*pool)
        .await
        .map_err(err_str)?
        .ok_or_else(|| "游戏不存在".to_string())?
        .try_get("path")
        .map_err(err_str)?;
    let parent_pathbuf = PathBuf::from(&parent_path);

    let mut new_ids: Vec<i64> = Vec::with_capacity(paths.len());
    for p in &paths {
        let dir = PathBuf::from(p);
        // Guard against self-inclusion: never re-ingest the parent itself.
        if dir == parent_pathbuf {
            continue;
        }
        // CR-03 — refuse to register system paths even if the frontend
        // injects them into the subdir list.
        ensure_safe_game_dir(&dir)?;
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
        let id = ingest_one_dir(&*pool, &data_dir, &dg).await?;
        new_ids.push(id);
    }

    // All subdirs ingested — drop the original parent entry. scan_review_queue
    // rows cascade away via the v9 FK ON DELETE CASCADE.
    sqlx::query("DELETE FROM games WHERE id = ?")
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;

    // Persist the parent path in the skip-list so a full scan never
    // re-discovers it as a game (INSERT OR IGNORE keeps it idempotent).
    sqlx::query("INSERT OR IGNORE INTO scan_skip_dirs (path) VALUES (?)")
        .bind(&parent_path)
        .execute(&*pool)
        .await
        .map_err(err_str)?;

    Ok(new_ids)
}

/// Quick 260517-qnn — delete a single game's library record.
///
/// Removes ONLY the database rows for `game_id`: every child table that holds
/// a `game_id` FK (screenshots / save_backups / sessions / game_tags /
/// game_staff / game_official_tags / custom_view_games / scan_review_queue) is
/// cleared first, then the parent `games` row. Child rows are deleted
/// explicitly so the command works regardless of the connection's
/// `PRAGMA foreign_keys` state (sqlx doesn't auto-enable it per connection).
///
/// The on-disk game folder/files are deliberately NOT touched — a later
/// re-scan legitimately re-adds the game, which is the expected behavior.
/// (Contrast with `clear_all_data`, which also removes the cover/screenshot/
/// save subdirectories from disk.)
///
/// Returns `Err("游戏不存在")` if no `games` row matched the id.
#[tauri::command]
pub async fn delete_game(game_id: i64, state: State<'_, AppPaths>) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;

    // L9N-02 — capture the on-disk directory path BEFORE the games row is
    // deleted, so a removed-marker can be written afterwards (a marker stops
    // the next scan from silently re-adding the game).
    let game_path: Option<String> = sqlx::query_scalar("SELECT path FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_optional(&*pool)
        .await
        .map_err(err_str)?;

    // Delete child rows first so this works even with FK enforcement off.
    for table in [
        "screenshots",
        "save_backups",
        "sessions",
        "game_tags",
        "game_staff",
        "game_official_tags",
        "custom_view_games",
        "scan_review_queue",
    ] {
        sqlx::query(&format!("DELETE FROM {} WHERE game_id = ?", table))
            .bind(game_id)
            .execute(&*pool)
            .await
            .map_err(err_str)?;
    }

    let result = sqlx::query("DELETE FROM games WHERE id = ?")
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;

    if result.rows_affected() == 0 {
        return Err("游戏不存在".to_string());
    }

    // L9N-02 — write a `.gal-lib-removed` marker into the game folder so the
    // next scan skips it instead of re-adding the game the user just deleted.
    // best-effort: a marker-write failure must not fail the delete itself.
    if let Some(p) = game_path {
        if let Err(e) = scan::removed_marker::write_marker(std::path::Path::new(&p)) {
            eprintln!("[delete_game] write removed-marker failed for {}: {}", p, e);
        }
    }

    Ok(())
}

/// L9N-02 — 枚举所有 scan_roots 下带 `.gal-lib-removed` 标记的目录。
///
/// 供 Scan 页『已删除条目』区域。复用 `collect_game_dirs`（与扫描遍历同一
/// 套目录树枚举逻辑），过滤出带标记的目录，返回绝对路径列表。
#[tauri::command]
pub async fn list_removed_dirs(state: State<'_, AppPaths>) -> Result<Vec<String>, String> {
    let pool = state.pool().await.map_err(err_str)?;

    // Read scan_roots — same query shape as start_scan.
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

    // collect_game_dirs needs an Arc<AtomicBool> cancel handle; a fresh
    // never-cancelled flag is fine for this one-shot enumeration.
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let dirs = scan::walker::collect_game_dirs(&roots, &cancel).map_err(err_str)?;

    Ok(dirs
        .into_iter()
        .filter(|d| scan::removed_marker::has_marker(d))
        .map(|d| d.to_string_lossy().into_owned())
        .collect())
}

/// L9N-02 — 把一个被标记为已删除的目录重新加回库：删磁盘标记 + 作为新条目导入。
///
/// 先删 `.gal-lib-removed` 标记（否则导入后下次扫描仍会被跳过），再复用
/// `add_game` 同款的 `DiscoveredGame` 构造 + `ingest_one_dir`。返回新 `games.id`。
#[tauri::command]
pub async fn restore_removed_dir(
    path: String,
    state: State<'_, AppPaths>,
) -> Result<i64, String> {
    let dir = PathBuf::from(&path);
    // T-l9n-01 — validate the caller-supplied path is a real directory before
    // touching the filesystem or DB.
    if !dir.is_dir() {
        return Err(format!("目录不存在: {}", path));
    }
    ensure_safe_game_dir(&dir)?;
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // Remove the marker first — otherwise the next scan would skip the dir we
    // just re-imported.
    scan::removed_marker::remove_marker(&dir).map_err(err_str)?;

    // Reuse the add_game DiscoveredGame construction pattern.
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
        // Phase 12 — drop review queue rows before games (CASCADE handles it
        // implicitly, but explicit is friendlier when debugging FK-disabled
        // sqlite connections).
        "scan_review_queue",
        "games",
        "scan_roots",
    ] {
        sqlx::query(&format!("DELETE FROM {}", table))
            .execute(&*pool)
            .await
            .map_err(err_str)?;
    }

    for sub in ["covers", "screenshots", "saves", "portraits"] {
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

        // Phase 11 — bind also pulls staff/characters so the user sees the
        // full enrichment immediately. Best-effort; any failure logs via the
        // helper. We collect into a fresh IngestResult so we can reuse
        // `write_staff_and_tags` without duplicating the SQL.
        let (persons, characters) = match source.as_str() {
            "bangumi" => (
                metadata::bangumi::fetch_persons(&source_id).await,
                metadata::bangumi::fetch_characters(&source_id).await,
            ),
            "vndb" => (
                metadata::vndb::fetch_persons(&source_id).await,
                metadata::vndb::fetch_characters(&source_id).await,
            ),
            _ => unreachable!(),
        };
        let mut staff = persons.unwrap_or_else(|e| {
            eprintln!("[bind_metadata] fetch_persons failed for {}/{}: {}", source, source_id, e);
            Vec::new()
        });
        match characters {
            Ok(v) => staff.extend(v),
            Err(e) => eprintln!(
                "[bind_metadata] fetch_characters failed for {}/{}: {}",
                source, source_id, e
            ),
        }

        // Phase 11 — bind UPDATE writes summary unconditionally + brand via
        // COALESCE (preserve manual brand). cover_path keeps its original
        // COALESCE so a transient cover-cache failure doesn't blank an
        // already-cached cover. Quick 20260512b — release_year parsed from
        // detail.release_date, same COALESCE shape as brand.
        let release_year_i64: Option<i64> =
            ingest::parse_release_year(detail.release_date.as_deref()).map(|y| y as i64);
        // Quick 260525-g1m — bind_metadata 是用户手动绑定路径，写入官方评分三列；
        // source 此处已是 "bangumi" / "vndb" 字符串。
        sqlx::query(
            "UPDATE games SET name = ?, name_cn = ?, cover_path = COALESCE(?, cover_path), \
                              cover_url = ?, bangumi_id = ?, vndb_id = ?, \
                              metadata_source = ?, match_confidence = 100, \
                              summary = ?, brand = COALESCE(?, brand), \
                              release_year = COALESCE(?, release_year), \
                              external_rating = ?, \
                              external_rating_count = ?, \
                              external_rating_source = ?, \
                              last_scanned_at = datetime('now'), \
                              metadata_fetched_at = datetime('now') \
             WHERE id = ?",
        )
        .bind(&detail.title)
        .bind(&detail.title_cn)
        .bind(&cover_path)
        .bind(&detail.cover_url)
        .bind(&bangumi_id_col)
        .bind(&vndb_id_col)
        .bind(&source) // "bangumi" or "vndb"
        .bind(&detail.summary)
        .bind(&detail.brand)
        .bind(release_year_i64)
        .bind(detail.rating)
        .bind(detail.rating_count)
        .bind(Some(source.clone()))
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;

        // Build a synthetic IngestResult so we can reuse `write_staff_and_tags`.
        // Only the fields the helper reads (staff, tags) are populated meaningfully.
        let synthetic = ingest::IngestResult {
            games_path: String::new(),
            name: detail.title.clone(),
            name_cn: detail.title_cn.clone(),
            executable_path: None,
            cover_path: None,
            cover_url: detail.cover_url.clone(),
            bangumi_id: bangumi_id_col.clone(),
            vndb_id: vndb_id_col.clone(),
            metadata_source: source.clone(),
            match_confidence: Some(100),
            summary: detail.summary.clone(),
            brand: detail.brand.clone(),
            staff,
            tags: detail.tags.clone(),
            release_year: release_year_i64.map(|y| y as i32),
            external_rating: detail.rating,
            external_rating_count: detail.rating_count,
            external_rating_source: Some(source.clone()),
        };
        write_staff_and_tags(&*pool, game_id, &source, &synthetic).await?;

        // Phase 12 — manual bind = confidence 100 → drop any stale review row.
        delete_from_review_queue(&*pool, game_id).await?;

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

        let release_year_i64: Option<i64> = result.release_year.map(|y| y as i64);
        // Quick 260525-g1m — refresh_metadata 也覆盖式写入 external_rating 三列。
        sqlx::query(
            "UPDATE games SET name = ?, name_cn = ?, cover_path = COALESCE(?, cover_path), \
                              cover_url = COALESCE(?, cover_url), \
                              bangumi_id = COALESCE(?, bangumi_id), \
                              vndb_id = COALESCE(?, vndb_id), \
                              metadata_source = ?, match_confidence = ?, \
                              summary = ?, brand = COALESCE(?, brand), \
                              release_year = COALESCE(?, release_year), \
                              external_rating = ?, \
                              external_rating_count = ?, \
                              external_rating_source = ?, \
                              last_scanned_at = datetime('now'), \
                              metadata_fetched_at = datetime('now') \
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
        .bind(&result.summary)
        .bind(&result.brand)
        .bind(release_year_i64)
        .bind(result.external_rating)
        .bind(result.external_rating_count)
        .bind(&result.external_rating_source)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;

        // Phase 11 — write staff + official tags. metadata_source on the
        // result is "bangumi" / "vndb" / "none"; the helper handles each.
        write_staff_and_tags(&*pool, game_id, &result.metadata_source, &result).await?;

        Ok(())
    }
    .await;

    let _ = app.emit(
        "meta-fetch-progress",
        serde_json::json!({ "game_id": game_id, "phase": "finished" }),
    );

    result
}

/// Quick 260513-3df — 两按钮统一刷新入口。替换旧 `refresh_all_metadata` +
/// `backfill_release_year`，把「全库元数据刷新」整合到一个 IPC：
///
///   • 未绑定行 (bangumi_id IS NULL AND vndb_id IS NULL) — 走
///     `ingest::refresh_for_query` 做模糊匹配，UPDATE shape 沿用旧
///     `refresh_all_metadata`（含 COALESCE 保护）。
///   • 已绑定行 (任一非空) — 按 metadata_source 选源（manual/None 用
///     「bangumi 优先 vndb fallback」），直接调 `fetch_detail` +
///     `fetch_persons` + `fetch_characters`，**不重做模糊匹配**。UPDATE 仅写：
///       - `cover_url` (COALESCE)
///       - `summary` (覆盖)
///       - `brand` (COALESCE)
///       - `release_year` (覆盖 — 用户主动点刷新就期望新值；
///                          这是与 quick 260513-2nx `backfill_release_year`
///                          的 COALESCE 策略明确分道扬镳的一处)
///       - `last_scanned_at`
///     **不动** bangumi_id / vndb_id / metadata_source / match_confidence /
///     name / name_cn —— 这保住 manual 标记和用户改过的名字。
///     **不动** cover_path —— 已绑定行不重下封面，把本地下载路径留给
///     cover_cache 流程；只把可能更新的远端 url COALESCE 进 cover_url。
///   • staff/tags 通过 `write_staff_and_tags` 事务式重写（与旧
///     `refresh_all_metadata` 一致；已绑定行构造 IngestResult 壳传入）。
///
/// 共享 ScanState 使 `cancel_scan` 可中止；进度走 `scan-progress` +
/// `meta-fetch-progress`，BackfillProgressBar/ScanProgressBar 0 改动。
#[tauri::command]
pub async fn refresh_metadata_smart(
    app: AppHandle,
    state: State<'_, AppPaths>,
    scan_state: State<'_, ScanState>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    let data_dir = state.data_dir.clone();

    // 共享 ScanState ctx，使 `cancel_scan` 能中断本次刷新。
    let ctx = Arc::new(scan::ScanContext::new());
    {
        let mut g = scan_state
            .ctx
            .lock()
            .map_err(|_| "scan state mutex poisoned".to_string())?;
        *g = Some(ctx.clone());
    }

    let rows = sqlx::query(
        "SELECT id, name, path, executable_path, bangumi_id, vndb_id, metadata_source \
         FROM games ORDER BY id ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;

    let total = rows.len();
    let app_for_emit = app.clone();
    let pool_for_task = pool.clone();
    let ctx_for_task = ctx.clone();

    // Initial Running event so the progress bar opens at 0 / total.
    // refresh_metadata_smart only touches metadata — always Enriching phase.
    let _ = app.emit(
        "scan-progress",
        scan::ScanProgress {
            current_dir: String::new(),
            completed: 0,
            total,
            status: scan::ScanStatus::Running,
            phase: scan::ScanPhase::Enriching,
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
                phase: scan::ScanPhase::Enriching,
            },
        );
        return Ok(());
    }

    // Quick 260515-loading-phase-sort — 并发化（mirror start_scan 的 JoinSet
    // refill 模式）。INGEST_CONCURRENCY task 同时跑；任一完成立刻补上下一个，
    // 直到 rows 耗尽。原 serial for-loop 在 backend 看来一次只跑一个，用户
    // 在前端看到的"首批 4 并发"其实只是 600ms throttle 累积出来的视觉错觉。
    tokio::spawn(async move {
        let completed = Arc::new(AtomicUsize::new(0));
        let mut set: JoinSet<()> = JoinSet::new();
        let mut iter = rows.into_iter();

        loop {
            // Cancel: 立即 abort 所有 in-flight task，让进度条尽快收到 Cancelled。
            // start_scan 同款语义；in-flight HTTP 请求由 tokio future-drop 释放。
            if ctx_for_task.cancel.load(Ordering::Relaxed) && !set.is_empty() {
                set.abort_all();
            }

            // Refill: 补齐到 INGEST_CONCURRENCY 个 in-flight task。
            while set.len() < INGEST_CONCURRENCY {
                if ctx_for_task.cancel.load(Ordering::Relaxed) {
                    break;
                }
                let Some(row) = iter.next() else { break };

                // 解析 row；任一字段缺失 → 直接计入 completed 跳过（与原 serial 路径
                // `continue` 等价，但要手动推进计数器以保证 scan-progress 不卡）。
                let id: i64 = match row.try_get("id") {
                    Ok(v) => v,
                    Err(_) => {
                        completed.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                };
                let path: String = match row.try_get("path") {
                    Ok(v) => v,
                    Err(_) => {
                        completed.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                };
                let name: String = match row.try_get("name") {
                    Ok(v) => v,
                    Err(_) => {
                        completed.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                };
                let exec: Option<String> = row.try_get("executable_path").ok();
                let bangumi_id: Option<String> = row.try_get("bangumi_id").ok();
                let vndb_id: Option<String> = row.try_get("vndb_id").ok();
                let metadata_source: Option<String> = row.try_get("metadata_source").ok();

                let app_t = app_for_emit.clone();
                let pool_t = pool_for_task.clone();
                let data_dir_t = data_dir.clone();
                let ctx_t = ctx_for_task.clone();
                let completed_t = completed.clone();
                let total_t = total;

                set.spawn(async move {
                    // Per-task cancel check — racy but cheap; avoids 1 网络往返。
                    if ctx_t.cancel.load(Ordering::Relaxed) {
                        return;
                    }

                    let _ = app_t.emit(
                        "meta-fetch-progress",
                        serde_json::json!({ "game_id": id, "phase": "started" }),
                    );

                    let bound = bangumi_id.is_some() || vndb_id.is_some();

                    if !bound {
                        // ── 未绑定行 — 完整模糊匹配 + 旧 refresh_all_metadata UPDATE shape。
                        let result = ingest::refresh_for_query(
                            id,
                            &data_dir_t,
                            &path,
                            &name,
                            exec.as_deref(),
                        )
                        .await;

                        let release_year_i64: Option<i64> =
                            result.release_year.map(|y| y as i64);
                        // Quick 260525-g1m — refresh_metadata_smart 未绑定路径补 external_rating 三列。
                        let _ = sqlx::query(
                            "UPDATE games SET name = ?, name_cn = ?, \
                                              cover_path = COALESCE(?, cover_path), \
                                              cover_url = COALESCE(?, cover_url), \
                                              bangumi_id = COALESCE(?, bangumi_id), \
                                              vndb_id = COALESCE(?, vndb_id), \
                                              metadata_source = ?, match_confidence = ?, \
                                              summary = ?, brand = COALESCE(?, brand), \
                                              release_year = COALESCE(?, release_year), \
                                              external_rating = ?, \
                                              external_rating_count = ?, \
                                              external_rating_source = ?, \
                                              last_scanned_at = datetime('now'), \
                                              metadata_fetched_at = datetime('now') \
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
                        .bind(&result.summary)
                        .bind(&result.brand)
                        .bind(release_year_i64)
                        .bind(result.external_rating)
                        .bind(result.external_rating_count)
                        .bind(&result.external_rating_source)
                        .bind(id)
                        .execute(&*pool_t)
                        .await;

                        if let Err(e) = write_staff_and_tags(
                            &*pool_t,
                            id,
                            &result.metadata_source,
                            &result,
                        )
                        .await
                        {
                            eprintln!(
                                "[refresh_metadata_smart] staff/tags write failed for game {}: {}",
                                id, e
                            );
                        }
                    } else {
                        // ── 已绑定行 — 按 source_id 直拉 detail。
                        // source 选择：bangumi/vndb 显式 → 对应 id；其它（manual/None）
                        // → bangumi 优先，回落 vndb。
                        let pick: Option<(MetadataSource, String)> =
                            match metadata_source.as_deref() {
                                Some("bangumi") => bangumi_id
                                    .as_ref()
                                    .map(|sid| (MetadataSource::Bangumi, sid.clone())),
                                Some("vndb") => vndb_id
                                    .as_ref()
                                    .map(|sid| (MetadataSource::Vndb, sid.clone())),
                                _ => bangumi_id
                                    .as_ref()
                                    .map(|sid| (MetadataSource::Bangumi, sid.clone()))
                                    .or_else(|| {
                                        vndb_id
                                            .as_ref()
                                            .map(|sid| (MetadataSource::Vndb, sid.clone()))
                                    }),
                            };

                        if let Some((source_enum, source_id)) = pick {
                            let detail_res = match source_enum {
                                MetadataSource::Bangumi => {
                                    metadata::bangumi::fetch_detail(&source_id).await
                                }
                                MetadataSource::Vndb => {
                                    metadata::vndb::fetch_detail(&source_id).await
                                }
                                _ => unreachable!(
                                    "source_enum constrained to Bangumi/Vndb above"
                                ),
                            };

                            match detail_res {
                                Ok(detail) => {
                                    let persons = match source_enum {
                                        MetadataSource::Bangumi => {
                                            metadata::bangumi::fetch_persons(&source_id)
                                                .await
                                                .unwrap_or_default()
                                        }
                                        MetadataSource::Vndb => {
                                            metadata::vndb::fetch_persons(&source_id)
                                                .await
                                                .unwrap_or_default()
                                        }
                                        _ => Vec::new(),
                                    };
                                    let characters = match source_enum {
                                        MetadataSource::Bangumi => {
                                            metadata::bangumi::fetch_characters(&source_id)
                                                .await
                                                .unwrap_or_default()
                                        }
                                        MetadataSource::Vndb => {
                                            metadata::vndb::fetch_characters(&source_id)
                                                .await
                                                .unwrap_or_default()
                                        }
                                        _ => Vec::new(),
                                    };
                                    let mut staff = persons;
                                    staff.extend(characters);

                                    let release_year_i64: Option<i64> =
                                        ingest::parse_release_year(
                                            detail.release_date.as_deref(),
                                        )
                                        .map(|y| y as i64);

                                    let source_str: &str = match source_enum {
                                        MetadataSource::Bangumi => "bangumi",
                                        MetadataSource::Vndb => "vndb",
                                        _ => unreachable!(),
                                    };

                                    // Quick 260525-g1m — refresh_metadata_smart 已绑定路径补 external_rating
                                    // 三列；这条 UPDATE 此前只写最小集，现按全量刷新口径补齐。
                                    let _ = sqlx::query(
                                        "UPDATE games SET \
                                            cover_url           = COALESCE(?, cover_url), \
                                            summary             = ?, \
                                            brand               = COALESCE(?, brand), \
                                            release_year        = ?, \
                                            external_rating          = ?, \
                                            external_rating_count    = ?, \
                                            external_rating_source   = ?, \
                                            last_scanned_at     = datetime('now'), \
                                            metadata_fetched_at = datetime('now') \
                                         WHERE id = ?",
                                    )
                                    .bind(&detail.cover_url)
                                    .bind(&detail.summary)
                                    .bind(&detail.brand)
                                    .bind(release_year_i64)
                                    .bind(detail.rating)
                                    .bind(detail.rating_count)
                                    .bind(Some(source_str.to_string()))
                                    .bind(id)
                                    .execute(&*pool_t)
                                    .await;

                                    let result_shell = ingest::IngestResult {
                                        games_path: path.clone(),
                                        name: name.clone(),
                                        name_cn: None,
                                        executable_path: exec.clone(),
                                        cover_path: None,
                                        cover_url: detail.cover_url.clone(),
                                        bangumi_id: bangumi_id.clone(),
                                        vndb_id: vndb_id.clone(),
                                        metadata_source: source_str.to_string(),
                                        match_confidence: None,
                                        summary: detail.summary.clone(),
                                        brand: detail.brand.clone(),
                                        staff,
                                        tags: detail.tags.clone(),
                                        release_year: ingest::parse_release_year(
                                            detail.release_date.as_deref(),
                                        ),
                                        external_rating: detail.rating,
                                        external_rating_count: detail.rating_count,
                                        external_rating_source: Some(source_str.to_string()),
                                    };

                                    if let Err(e) = write_staff_and_tags(
                                        &*pool_t,
                                        id,
                                        source_str,
                                        &result_shell,
                                    )
                                    .await
                                    {
                                        eprintln!(
                                            "[refresh_metadata_smart] staff/tags write failed for game {}: {}",
                                            id, e
                                        );
                                    }
                                }
                                Err(e) => {
                                    eprintln!(
                                        "[refresh_metadata_smart] fetch_detail failed for game {} ({:?}/{}): {}",
                                        id, source_enum, source_id, e
                                    );
                                }
                            }
                        }
                        // pick == None → 数据不一致；跳过 UPDATE，仍发 finished + scan-progress 下面统一处理。
                    }

                    let _ = app_t.emit(
                        "meta-fetch-progress",
                        serde_json::json!({ "game_id": id, "phase": "finished" }),
                    );
                    // Quick 260515-prog — row updated; trigger throttled Library refetch.
                    let _ = app_t.emit("games-changed", ());

                    let n = completed_t.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = app_t.emit(
                        "scan-progress",
                        scan::ScanProgress {
                            current_dir: path,
                            completed: n,
                            total: total_t,
                            status: scan::ScanStatus::Running,
                            phase: scan::ScanPhase::Enriching,
                        },
                    );
                });
            }

            // Wait for any task to finish. Empty set + iter exhausted (or cancelled
            // mid-loop) → loop exits.
            if set.join_next().await.is_none() {
                break;
            }
        }

        // Terminal Cancelled vs Completed — counter reflects however many
        // tasks actually emitted their per-row scan-progress before cancel
        // propagated.
        if ctx_for_task.cancel.load(Ordering::Relaxed) {
            let _ = app_for_emit.emit(
                "scan-progress",
                scan::ScanProgress {
                    current_dir: String::new(),
                    completed: completed.load(Ordering::Relaxed),
                    total,
                    status: scan::ScanStatus::Cancelled,
                    phase: scan::ScanPhase::Enriching,
                },
            );
        } else {
            let _ = app_for_emit.emit(
                "scan-progress",
                scan::ScanProgress {
                    current_dir: String::new(),
                    completed: total,
                    total,
                    status: scan::ScanStatus::Completed,
                    phase: scan::ScanPhase::Enriching,
                },
            );
        }
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
    pub notes: Option<String>,
    pub metadata_source: Option<String>,
    pub match_confidence: Option<i64>,
    pub last_scanned_at: Option<String>,
    /// Quick 260515-loading-phase-sort — 元数据最近一次获取的时间锚点。
    /// 与 `last_scanned_at` 当前值一致，但语义上专门给排序用：未来若引入
    /// 只更新 `last_scanned_at` 的非元数据扫描，这个字段不被污染。
    pub metadata_fetched_at: Option<String>,
    // ── Phase 4 / schema v4 fields ──
    pub brand: Option<String>,
    pub release_year: Option<i64>,
    pub is_favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    // ── Phase 11 / schema v7 fields ──
    /// Synopsis text from Bangumi/VNDB. NULL when never enriched or when the
    /// source returned an empty summary.
    pub summary: Option<String>,
    // ── Quick 260525-g1m / schema v13 fields ──
    /// 官方评分（0..=10 浮点）。Bangumi rating.score 或 VNDB rating/10。
    /// 「评分」排序键按本列 DESC NULL LAST。NULL 表示未绑定 / 源未返回。
    pub external_rating: Option<f64>,
    /// 官方评分投票数（Bangumi rating.total / VNDB votecount）。
    pub external_rating_count: Option<i64>,
    /// "bangumi" | "vndb"（评分的来源），用于详情页 pill 后缀。
    pub external_rating_source: Option<String>,
    // ── Phase 3 / schema v3 launch-config fields ──
    // 历史欠账修复（260526）：这三列在 schema v3 起就存在且 `update_game_launch_config`
    // 一直在写，但 Game struct + 三个 SELECT 长期漏读，导致前端永远拿不到持久化值，
    // 详情页"启动配置"标签保存后再进入永远被重置回默认。
    /// LE 启动 profile 哨兵值：`"Japanese"` 表示日区 LE 启动（默认）；`"direct"`
    /// 表示直接启动（不经 LE）。schema v3 列为 `NOT NULL DEFAULT 'Japanese'`，
    /// 所以这里用 `String` 而不是 `Option<String>` —— 真实 DB 行始终有值。
    /// 已废弃的旧 profile 值（简中 / 繁中 / Custom）由前端 `leProfileToMethod` 兜底成 "le-jp"。
    pub le_profile: String,
    /// 自定义启动参数（whitespace 分割成 argv 的字符串）。NULL = 没设置。
    pub launch_args: Option<String>,
    /// 自定义工作目录。NULL = 自动取 exe 父目录。
    pub cwd: Option<String>,
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
                notes, metadata_source, match_confidence, last_scanned_at, \
                metadata_fetched_at, \
                brand, release_year, is_favorite, summary, \
                external_rating, external_rating_count, external_rating_source, \
                le_profile, launch_args, cwd, \
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

/// Single-row variant of `list_games`. Used by the Detail page's
/// `refreshGame` path — the previous implementation pulled the entire
/// `games` table and `.find()`d the row, which became O(N * #mutations)
/// IPC and N table reads per detail-page visit (BL-02 in 260524 review).
#[tauri::command]
pub async fn get_game(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Option<Game>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let row_opt = sqlx::query(
        "SELECT id, path, name, name_cn, executable_path, cover_path, cover_url, \
                bangumi_id, vndb_id, total_playtime_sec, last_played_at, status, \
                notes, metadata_source, match_confidence, last_scanned_at, \
                metadata_fetched_at, \
                brand, release_year, is_favorite, summary, \
                external_rating, external_rating_count, external_rating_source, \
                le_profile, launch_args, cwd, \
                created_at, updated_at \
         FROM games WHERE id = ?",
    )
    .bind(game_id)
    .fetch_optional(&*pool)
    .await
    .map_err(err_str)?;
    match row_opt {
        Some(row) => Ok(Some(row_to_game(&row)?)),
        None => Ok(None),
    }
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
        notes: row.try_get("notes").ok(),
        metadata_source: row.try_get("metadata_source").ok(),
        match_confidence: row.try_get("match_confidence").ok(),
        last_scanned_at: row.try_get("last_scanned_at").ok(),
        metadata_fetched_at: row.try_get("metadata_fetched_at").ok(),
        brand: row.try_get("brand").ok(),
        release_year: row.try_get("release_year").ok(),
        is_favorite: row.try_get::<i64, _>("is_favorite").unwrap_or(0) != 0,
        created_at: row.try_get("created_at").map_err(err_str)?,
        updated_at: row.try_get("updated_at").map_err(err_str)?,
        summary: row.try_get("summary").ok(),
        // Quick 260525-g1m
        external_rating: row.try_get("external_rating").ok(),
        external_rating_count: row.try_get("external_rating_count").ok(),
        external_rating_source: row.try_get("external_rating_source").ok(),
        // 260526 启动配置回填 — schema v3 列，前端「启动配置」标签的持久化来源。
        // le_profile 是 NOT NULL，但为了与历史脏数据兼容用 unwrap_or 兜底。
        le_profile: row
            .try_get::<String, _>("le_profile")
            .unwrap_or_else(|_| "Japanese".to_string()),
        launch_args: row.try_get("launch_args").ok(),
        cwd: row.try_get("cwd").ok(),
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
///
/// `cancel`: shared Notify with the screenshot task. `end_active_session`
/// fires `notify_waiters()` BEFORE `task.abort()` so the screenshot loop
/// wakes from its `iv.tick().await` and breaks immediately. Without this,
/// abort()ing the wait task drops the `cancel_flag.store(true)` line on the
/// floor (the wait task is killed mid-flight) and the screenshot loop runs
/// until the next interval tick — or forever, if the game survives the
/// force-end (CR-01 in 260524 review).
pub struct ActiveSessionEntry {
    pub session: orchestrator::ActiveSession,
    pub task: tokio::task::AbortHandle,
    pub cancel: Arc<tokio::sync::Notify>,
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
    // Serialize concurrent `launch_game` invocations end-to-end (CR-02 in
    // 260524 review). The original two-lock check-then-spawn pattern raced:
    // both calls saw `g.is_some() == false`, both spawned LE, and the second
    // `*g = Some(entry)` overwrote the first. Holding LAUNCH_SERIAL across
    // the full path makes the check + spawn + insert one atomic step.
    let _serial = LAUNCH_SERIAL.lock().await;

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

    let (_session_id, active, join, cancel) =
        orchestrator::launch_game(orchestrator::LaunchInputs {
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
            cancel: cancel.clone(),
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

    // Wake the screenshot task BEFORE aborting the wait task. If we aborted
    // first, the wait task's `cancel_flag.store(true)` + `notify_waiters()`
    // would never run (the task is killed mid-flight), and the screenshot
    // loop would keep capturing until the next interval tick observed the
    // (never-set) flag — or, if the game survives force-end, forever.
    // notify_waiters() on an empty Notify is a no-op; safe to call always.
    entry.cancel.notify_waiters();

    // Abort the wait-for-exit task so it can't race with our cancel_session
    // UPDATE. AbortHandle::abort returns immediately; the watcher task will
    // observe `JoinError::is_cancelled` and emit null.
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
    /// Phase 11 — multi-select staff filter. Games where ANY of these
    /// person_ids appear in `game_staff` match (OR within the list).
    /// Combined with other filters by AND.
    pub staff_ids: Option<Vec<i64>>,
    /// Phase 11 — multi-select official-tag filter (matches `tag_name`
    /// across all sources). OR within the list.
    pub official_tags: Option<Vec<String>>,
    /// Phase 11 — multi-select brand filter. OR within the list (extends
    /// the legacy single-value `brand` field which is kept for backward
    /// compatibility with the sidebar's existing brand-bucket clicks).
    pub brands: Option<Vec<String>>,
    /// Quick 20260510b — only return games belonging to this custom view.
    /// Empty join-table membership matches zero games.
    pub custom_view_id: Option<i64>,
}

/// Search + sort + filter the `games` table.
///
/// - `query` LIKE-matches against `name`, `name_cn`, the basename of `path`,
///   and any tag name attached via `game_tags`. Empty / whitespace-only query
///   means "no LIKE clause".
/// - `sort_by`: one of `last_played | created_at | name | playtime | rating`.
///   Unknown values → `Err`. Rating 自 Quick 260525-g1m 起切到 `external_rating`
///   （官方评分）；NULL-handling 始终把 NULL 沉底（NULLS LAST）。
/// - `sort_dir`: `asc` | `desc`（缺省 desc）。Quick 260525-g1m — 配合 SortSelect
///   旁的方向按钮；与 sort_by 正交。
/// - `filter`: optional bag of clauses ANDed onto the WHERE.
#[tauri::command]
pub async fn search_games(
    query: Option<String>,
    sort_by: String,
    sort_dir: Option<String>,
    filter: Option<SearchFilter>,
    state: State<'_, AppPaths>,
) -> Result<Vec<Game>, String> {
    let pool = state.pool().await.map_err(err_str)?;

    // Quick 260525-g1m — sort_dir 白名单（小写）；缺省 desc。任何非 asc/desc → Err。
    let dir = match sort_dir
        .as_deref()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("asc") => "ASC",
        Some("desc") | None => "DESC",
        Some(other) => {
            return Err(format!(
                "sort_dir must be 'asc' or 'desc' (got '{}')",
                other
            ));
        }
    };

    // Whitelist sort_by → ORDER BY clause (defensive: never interpolate user
    // input). NULLS LAST on optional columns (last_played / rating) — IS NULL
    // 子句**始终**沉底 NULL，不随 dir 翻转，符合「先按 dir 翻转主键、NULL 始终在末尾」直觉。
    // Quick 260525-g1m — "rating" 切到 `external_rating`（官方评分）；NULL 沉底语义不变。
    let order_by: String = match sort_by.as_str() {
        "last_played" => format!("last_played_at IS NULL, last_played_at {}", dir),
        "created_at" => format!("created_at {}", dir),
        "name" => format!("name COLLATE NOCASE {}", dir),
        "playtime" => format!("total_playtime_sec {}", dir),
        "rating" => format!("external_rating IS NULL, external_rating {}", dir),
        other => {
            return Err(format!(
                "sort_by must be one of last_played|created_at|name|playtime|rating (got '{}')",
                other
            ));
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
    // Phase 11 — staff_ids filter: any of these persons participated.
    // i64 list interpolation is injection-safe (numeric type) and matches
    // how `tag_id` is already inlined above.
    if let Some(ids) = f.staff_ids.as_ref().filter(|v| !v.is_empty()) {
        let csv = ids
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        where_clauses.push(format!(
            "g.id IN (SELECT game_id FROM game_staff WHERE person_id IN ({}))",
            csv
        ));
    }
    // Phase 11 — official_tags filter: any of these tag names hit on
    // game_official_tags. Strings, so use placeholders + bind.
    let official_tags_count = f
        .official_tags
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| v.len())
        .unwrap_or(0);
    if official_tags_count > 0 {
        let placeholders = std::iter::repeat("?")
            .take(official_tags_count)
            .collect::<Vec<_>>()
            .join(",");
        where_clauses.push(format!(
            "g.id IN (SELECT game_id FROM game_official_tags WHERE tag_name IN ({}))",
            placeholders
        ));
    }
    // Phase 11 — multi-brand filter (OR). Coexists with the legacy
    // single-value `brand` field (which is ANDed via the earlier clause).
    let brands_count = f
        .brands
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| v.len())
        .unwrap_or(0);
    if brands_count > 0 {
        let placeholders = std::iter::repeat("?")
            .take(brands_count)
            .collect::<Vec<_>>()
            .join(",");
        where_clauses.push(format!("g.brand IN ({})", placeholders));
    }

    // Quick 20260510b — custom view filter. i64 inline interpolation is
    // injection-safe (matches `tag_id` pattern earlier).
    if let Some(view_id) = f.custom_view_id {
        where_clauses.push(format!(
            "g.id IN (SELECT game_id FROM custom_view_games WHERE view_id = {})",
            view_id
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
                g.notes, g.metadata_source, g.match_confidence, g.last_scanned_at, \
                g.metadata_fetched_at, \
                g.brand, g.release_year, g.is_favorite, g.summary, \
                g.external_rating, g.external_rating_count, g.external_rating_source, \
                g.le_profile, g.launch_args, g.cwd, \
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
    // Phase 11 — bind official_tags then brands, matching WHERE append order.
    if let Some(tags) = f.official_tags.as_ref().filter(|v| !v.is_empty()) {
        for t in tags {
            qb = qb.bind(t);
        }
    }
    if let Some(brands) = f.brands.as_ref().filter(|v| !v.is_empty()) {
        for b in brands {
            qb = qb.bind(b);
        }
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
    /// Quick 20260510b — user-curated custom views (id + name + count).
    pub custom_views: Vec<CustomViewRow>,
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

    // Quick 20260510b — custom views; same shape as `list_custom_views` so
    // both sources stay aligned. Empty list when the user has no views yet.
    let cv_rows = sqlx::query(
        "SELECT cv.id, cv.name, cv.created_at, COUNT(cvg.game_id) AS cnt \
         FROM custom_views cv \
         LEFT JOIN custom_view_games cvg ON cvg.view_id = cv.id \
         GROUP BY cv.id, cv.name, cv.created_at \
         ORDER BY cv.created_at ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut custom_views = Vec::with_capacity(cv_rows.len());
    for row in cv_rows {
        custom_views.push(CustomViewRow {
            id: row.try_get("id").map_err(err_str)?,
            name: row.try_get("name").map_err(err_str)?,
            count: row.try_get("cnt").unwrap_or(0),
            created_at: row.try_get("created_at").map_err(err_str)?,
        });
    }

    Ok(SidebarCategories {
        tags,
        statuses,
        brands,
        year_decades,
        favorite_count,
        custom_views,
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

/// L9N-01 — 一次性把"有累计游玩时长但状态仍为 unplayed"的历史条目升级为 playing。
/// status 为 cleared/dropped 的行即使有时长也不改写（用户手动设置优先）。
/// 返回升级的行数。幂等：再次调用不再有未升级行时返回 0。
#[tauri::command]
pub async fn backfill_playing_status(state: State<'_, AppPaths>) -> Result<i64, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let result = sqlx::query(
        "UPDATE games SET status='playing', updated_at=datetime('now') \
         WHERE status='unplayed' AND total_playtime_sec > 0",
    )
    .execute(&*pool)
    .await
    .map_err(err_str)?;
    Ok(result.rows_affected() as i64)
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

// ── Quick task 20260509b / Phase 14 (FS-01,02,03) — open path in OS file manager
//
// Originally a `Command::new("explorer")` shell-out used by Detail's 更多 menu.
// Phase 14 routed it through `tauri-plugin-opener`. The debug session
// `open-dir-thread-block-popup` reverts that decision for the directory case:
//
//   Cycle 1 found `open_in_explorer` ran synchronously on the Tauri main
//   thread; the opener plugin's Windows path (`open` crate +
//   `shellexecute-on-windows`) calls `CoInitialize` + a synchronous
//   `SHOpenFolderAndSelectItems`, stalling the message pump. Moving the call
//   onto `spawn_blocking` fixed the *stalled-loading* symptom but NOT the
//   *stray Explorer window* — it merely relocated the bug.
//
//   Cycle 2 root cause: `open::that_detached` for a directory does
//   `CoInitialize(NULL)` (initialising the *calling* thread as an STA
//   apartment) and NEVER calls `CoUninitialize`. On a Tokio `spawn_blocking`
//   pool thread this leaves a permanently dirty STA on a thread that is then
//   recycled. `SHOpenFolderAndSelectItems` on an STA posts the real window
//   creation to that thread's message queue; the blocking thread returns to
//   the pool without pumping messages, so the Explorer window stays pending.
//   It finally appears the next time that pool thread is woken — which is
//   exactly when `refresh_metadata_smart`'s SQLx/HTTP work lands on it, i.e.
//   "the moment the metadata query returns". Matches every observed fact:
//   only reproduces after a real "打开目录" (nothing dirties the STA
//   otherwise) and the stray window pops exactly once.
//
// Fix: for directories, shell out to `explorer.exe <dir>` directly. Explorer
// is its own process with its own message pump — the window is created in
// that process, nothing COM-initialises our threads, and the child is fully
// detached the instant `spawn` returns. The `tauri-plugin-opener` path is
// kept only for the non-directory (file) case, which does not hit the
// `shell_open_folder` branch. Path-existence validation stays in Rust so a
// stale `games.path` surfaces a clean Chinese error.
//
// `open_in_explorer` keeps its name for backward compatibility with existing
// frontend callsites; `open_path` is the canonical Phase 14 alias. Both stay
// `async fn` so the (brief, non-COM) work never occupies the main thread.
#[tauri::command]
pub async fn open_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    open_path_offthread(app, path).await
}

/// Phase 14 (FS-01) — canonical open-path IPC. Validates existence then opens
/// the path in the OS file manager. New frontend callers should prefer this
/// over `open_in_explorer`.
#[tauri::command]
pub async fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    open_path_offthread(app, path).await
}

/// Runs the open-path work on a dedicated blocking thread so it never occupies
/// the Tauri main thread / message pump.
async fn open_path_offthread(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_path_impl(&app, &path))
        .await
        .map_err(|e| format!("无法打开目录：{}", e))?
}

fn open_path_impl(app: &AppHandle, path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("路径不存在：{}", path));
    }

    // Directory → spawn a detached `explorer.exe`. This deliberately bypasses
    // `tauri-plugin-opener` / `open::that_detached`, whose Windows directory
    // branch leaks an STA `CoInitialize` onto the calling thread and posts the
    // window creation to that thread's (un-pumped) message queue. See the
    // module comment above for the full debug-session analysis.
    #[cfg(target_os = "windows")]
    if p.is_dir() {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS — the child shares no console / handles with us.
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        std::process::Command::new("explorer.exe")
            .arg(path)
            .creation_flags(DETACHED_PROCESS)
            .spawn()
            // explorer.exe routinely exits non-zero even on success, so we
            // intentionally do NOT wait on / inspect the child. A failure
            // here means the process itself could not be launched.
            .map(|_child| ())
            .map_err(|e| format!("无法打开目录：{}", e))?;
        return Ok(());
    }

    // Files (and every non-Windows target) keep the plugin path: the opener's
    // file branch does not touch `shell_open_folder` / COM.
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("无法打开：{}", e))
}

// ── Phase 11 / 11c — metadata enrichment IPCs ──────────────────────────────
//
// Commands powering the Detail-page enrichment panel (staff list, official
// tags), the multi-dim filter sidebar (`get_filter_options`), the cross-page
// "browse by person" navigation (`list_games_for_person`), and external-link
// opens (Bangumi/VNDB urls in the staff popover). Quick 260513-3df folded the
// release-year backfill IPC into `refresh_metadata_smart`; only the shared
// `BackfillState` + `cancel_backfill` remain as Phase 13 leftovers.

/// Attribution for one underlying `persons` row that contributed to a merged
/// `GameStaffRow`. Phase 13 (PER-01) — cross-source dedup at the query layer.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct PersonSourceRef {
    pub source: String,
    pub source_id: String,
}

/// Row returned by `list_persons_for_game`. Joins `game_staff` ←→ `persons`
/// so the frontend has both the role/character_name (per-game data) and the
/// person identity (cross-game data) in one round-trip. `id` is the persons
/// rowid — pass it back to `list_games_for_person`.
///
/// Phase 13 (PER-01): same person on Bangumi+VNDB (matched by name + role +
/// character_name) is folded into a single row at the query layer. `sources`
/// lists every source that contributed; `person_ids` lists every underlying
/// `persons.id`. The representative `id` / `source` / `source_id` prefer
/// Bangumi when both sides agree, so the wire contract for older clients
/// stays meaningful (a single string source attribution).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameStaffRow {
    // Renamed on the wire to match the frontend's `person_id` field.
    // The struct keeps `id` internally to mirror the underlying `persons.id`
    // column (only one `id` in scope), but the JSON contract is `person_id`.
    #[serde(rename = "person_id")]
    pub id: i64,
    pub name: String,
    pub name_cn: Option<String>,
    pub source: String,
    pub source_id: String,
    pub role: String,
    pub character_name: Option<String>,
    /// All `(source, source_id)` pairs that the merged row covers. Single
    /// entry for the common case; two entries when Bangumi+VNDB matched.
    pub sources: Vec<PersonSourceRef>,
    /// All underlying `persons.id` values. Lets the frontend resolve a
    /// merged row from a URL parameter that targets either side.
    pub person_ids: Vec<i64>,
}

/// PER-01 — collapse same-person rows from different sources into one. Match
/// key is `(LOWER(TRIM(name)), role, LOWER(TRIM(character_name)))`. `name_cn`
/// is treated as supplemental: whichever side has it wins. Bangumi is
/// preferred as the representative `source` / `source_id` / `id`.
///
/// Input order is preserved (first-seen wins on positional ordering); only
/// the source/id attribution swaps when Bangumi wasn't first.
fn merge_persons(rows: Vec<GameStaffRow>) -> Vec<GameStaffRow> {
    use std::collections::HashMap;
    type Key = (String, String, String);
    let mut by_key: HashMap<Key, usize> = HashMap::new();
    let mut out: Vec<GameStaffRow> = Vec::with_capacity(rows.len());
    for row in rows {
        let name_lc = row.name.trim().to_lowercase();
        let char_lc = row
            .character_name
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let key = (name_lc, row.role.clone(), char_lc);
        if let Some(&idx) = by_key.get(&key) {
            let existing = &mut out[idx];
            // Add source attribution (de-dup defensively).
            if !existing
                .sources
                .iter()
                .any(|s| s.source == row.source && s.source_id == row.source_id)
            {
                existing.sources.push(PersonSourceRef {
                    source: row.source.clone(),
                    source_id: row.source_id.clone(),
                });
            }
            if !existing.person_ids.contains(&row.id) {
                existing.person_ids.push(row.id);
            }
            // Prefer Bangumi as representative.
            if row.source == "bangumi" && existing.source != "bangumi" {
                existing.id = row.id;
                existing.source = row.source.clone();
                existing.source_id = row.source_id.clone();
            }
            // Take name_cn from whichever side has it.
            if existing.name_cn.is_none() && row.name_cn.is_some() {
                existing.name_cn = row.name_cn.clone();
            }
        } else {
            by_key.insert(key, out.len());
            out.push(row);
        }
    }
    out
}

#[tauri::command]
pub async fn list_persons_for_game(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Vec<GameStaffRow>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT p.id, p.name, p.name_cn, p.source, p.source_id, \
                gs.role, gs.character_name \
         FROM game_staff gs JOIN persons p ON p.id = gs.person_id \
         WHERE gs.game_id = ? \
         ORDER BY \
            CASE gs.role \
                WHEN 'scenario' THEN 1 \
                WHEN 'artist'   THEN 2 \
                WHEN 'music'    THEN 3 \
                WHEN 'voice'    THEN 4 \
                ELSE 5 \
            END, \
            CASE p.source WHEN 'bangumi' THEN 1 WHEN 'vndb' THEN 2 ELSE 3 END, \
            COALESCE(p.name_cn, p.name) COLLATE NOCASE ASC",
    )
    .bind(game_id)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        // character_name in DB is NOT NULL DEFAULT '' (see migration 0007).
        // Map empty string back to None for the frontend so the wire contract
        // stays clean: `character_name: string | null` where null = non-voice.
        let cn: String = row.try_get("character_name").unwrap_or_default();
        let id: i64 = row.try_get("id").map_err(err_str)?;
        let source: String = row.try_get("source").map_err(err_str)?;
        let source_id: String = row.try_get("source_id").map_err(err_str)?;
        out.push(GameStaffRow {
            id,
            name: row.try_get("name").map_err(err_str)?,
            name_cn: row.try_get("name_cn").ok(),
            source: source.clone(),
            source_id: source_id.clone(),
            role: row.try_get("role").map_err(err_str)?,
            character_name: if cn.is_empty() { None } else { Some(cn) },
            sources: vec![PersonSourceRef { source, source_id }],
            person_ids: vec![id],
        });
    }
    Ok(merge_persons(out))
}

#[cfg(test)]
mod merge_persons_tests {
    use super::*;

    fn row(id: i64, name: &str, name_cn: Option<&str>, source: &str, source_id: &str, role: &str, character: Option<&str>) -> GameStaffRow {
        GameStaffRow {
            id,
            name: name.into(),
            name_cn: name_cn.map(|s| s.into()),
            source: source.into(),
            source_id: source_id.into(),
            role: role.into(),
            character_name: character.map(|s| s.into()),
            sources: vec![PersonSourceRef { source: source.into(), source_id: source_id.into() }],
            person_ids: vec![id],
        }
    }

    #[test]
    fn merges_same_name_different_source() {
        let rows = vec![
            row(1, "Tanaka Romeo", None, "vndb", "s17", "scenario", None),
            row(2, "Tanaka Romeo", Some("田中ロミオ"), "bangumi", "12345", "scenario", None),
        ];
        let merged = merge_persons(rows);
        assert_eq!(merged.len(), 1);
        let m = &merged[0];
        assert_eq!(m.sources.len(), 2);
        assert_eq!(m.source, "bangumi"); // bangumi preferred
        assert_eq!(m.source_id, "12345");
        assert_eq!(m.id, 2);
        assert!(m.person_ids.contains(&1));
        assert!(m.person_ids.contains(&2));
        assert_eq!(m.name_cn.as_deref(), Some("田中ロミオ"));
    }

    #[test]
    fn does_not_merge_different_role() {
        let rows = vec![
            row(1, "Tanaka", None, "vndb", "s17", "scenario", None),
            row(2, "Tanaka", None, "bangumi", "12345", "voice", None),
        ];
        let merged = merge_persons(rows);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn does_not_merge_different_character() {
        let rows = vec![
            row(1, "Sakura", None, "bangumi", "111", "voice", Some("Alice")),
            row(2, "Sakura", None, "vndb", "s222", "voice", Some("Bob")),
        ];
        let merged = merge_persons(rows);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn preserves_input_order() {
        let rows = vec![
            row(1, "Alpha", None, "bangumi", "1", "scenario", None),
            row(2, "Beta", None, "bangumi", "2", "scenario", None),
            row(3, "Alpha", None, "vndb", "x1", "scenario", None),
        ];
        let merged = merge_persons(rows);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].name, "Alpha");
        assert_eq!(merged[1].name, "Beta");
        assert_eq!(merged[0].sources.len(), 2);
    }
}

/// Reverse lookup: every game where `person_id` participated, optionally
/// filtered to a single role. Returns full `Game` rows so the caller can
/// render a result-grid card without a follow-up `list_games` call.
#[tauri::command]
pub async fn list_games_for_person(
    person_id: i64,
    role: Option<String>,
    state: State<'_, AppPaths>,
) -> Result<Vec<Game>, String> {
    let pool = state.pool().await.map_err(err_str)?;

    // Defensive whitelist: role enum already enforced by DB CHECK, but a
    // bad string would simply return zero rows; surface a precise error.
    if let Some(r) = role.as_deref() {
        match r {
            "scenario" | "artist" | "voice" | "music" => {}
            other => {
                return Err(format!(
                    "role must be scenario|artist|voice|music (got '{}')",
                    other
                ))
            }
        }
    }

    let role_clause = if role.is_some() {
        " AND gs.role = ?"
    } else {
        ""
    };

    let sql = format!(
        "SELECT DISTINCT g.id, g.path, g.name, g.name_cn, g.executable_path, \
                g.cover_path, g.cover_url, g.bangumi_id, g.vndb_id, \
                g.total_playtime_sec, g.last_played_at, g.status, \
                g.notes, g.metadata_source, g.match_confidence, \
                g.last_scanned_at, g.metadata_fetched_at, \
                g.brand, g.release_year, g.is_favorite, \
                g.summary, \
                g.external_rating, g.external_rating_count, g.external_rating_source, \
                g.created_at, g.updated_at \
         FROM games g \
         JOIN game_staff gs ON gs.game_id = g.id \
         WHERE gs.person_id = ?{} \
         ORDER BY g.created_at DESC",
        role_clause
    );

    let mut qb = sqlx::query(&sql).bind(person_id);
    if let Some(r) = &role {
        qb = qb.bind(r);
    }
    let rows = qb.fetch_all(&*pool).await.map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(row_to_game(&row)?);
    }
    Ok(out)
}

/// Pair returned by `list_voice_characters_for_person`. One row per
/// `game_staff` voice entry — the frontend folds the pairs into a single
/// `gameId → characterName` map to label the voice game cards on /persons.
#[derive(Debug, Serialize)]
pub struct VoiceCharacterPair {
    pub game_id: i64,
    pub character_name: Option<String>,
}

/// Bulk voice-character lookup. Replaces the per-game `listPersonsForGame`
/// loop the Persons route used to run for every voice game (BL-03 in 260524
/// review — 50 voice games = 50 IPCs + 50 full person JOINs just to pluck
/// 50 `character_name` strings). Single bound SELECT against `game_staff`,
/// filtered to the requested person + role='voice'.
#[tauri::command]
pub async fn list_voice_characters_for_person(
    person_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Vec<VoiceCharacterPair>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT game_id, character_name \
         FROM game_staff \
         WHERE person_id = ? AND role = 'voice'",
    )
    .bind(person_id)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let game_id: i64 = row.try_get("game_id").map_err(err_str)?;
        // character_name is NOT NULL DEFAULT '' (migration 0007); map empty
        // back to None so the wire contract matches the existing
        // `list_persons_for_game` semantics (null = unknown character).
        let cn: String = row.try_get("character_name").unwrap_or_default();
        out.push(VoiceCharacterPair {
            game_id,
            character_name: if cn.is_empty() { None } else { Some(cn) },
        });
    }
    Ok(out)
}

/// Row returned by `list_official_tags_for_game`. The table has no rowid
/// (composite PRIMARY KEY) so we mint a synthetic id from the rowid via
/// SQLite's implicit `_rowid_` column — purely for the React `key` prop.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OfficialTagRow {
    pub id: i64,
    pub tag_name: String,
    pub source: String,
    pub weight: i64,
}

#[tauri::command]
pub async fn list_official_tags_for_game(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<Vec<OfficialTagRow>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT _rowid_ AS id, tag_name, source, weight \
         FROM game_official_tags \
         WHERE game_id = ? \
         ORDER BY weight DESC, tag_name COLLATE NOCASE ASC",
    )
    .bind(game_id)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(OfficialTagRow {
            id: row.try_get("id").unwrap_or(0),
            tag_name: row.try_get("tag_name").map_err(err_str)?,
            source: row.try_get("source").map_err(err_str)?,
            weight: row.try_get("weight").unwrap_or(0),
        });
    }
    Ok(out)
}

/// Compact identity for facet-panel option lists. Includes Chinese alias so
/// the dropdown can render "夜永サクヤ / 夜永咲夜" without a second lookup.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonOption {
    pub id: i64,
    pub name: String,
    pub name_cn: Option<String>,
    pub count: i64,
}

/// Brand option for the FilterPanel facet — name + count so the chip can
/// render `品牌 · N` with frequency. Mirrors `TagOption` shape.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrandOption {
    pub name: String,
    pub count: i64,
}

/// Tag option carries its frequency so the panel can sort by relevance and
/// render tag clouds with weight indicators.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TagOption {
    pub name: String,
    pub count: i64,
}

/// Aggregated facet options for the multi-dim filter sidebar. One round-trip,
/// 6 SELECTs internally; the frontend caches the result and re-fetches only
/// after a metadata refresh / scan.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilterOptions {
    pub brands: Vec<BrandOption>,
    pub scenarios: Vec<PersonOption>,
    pub artists: Vec<PersonOption>,
    pub voices: Vec<PersonOption>,
    pub music: Vec<PersonOption>,
    pub official_tags: Vec<TagOption>,
}

/// Returns brands sorted by frequency desc, scenarios/artists/voices/music
/// sorted by participation count desc, official_tags sorted by count desc.
/// All lists exclude entries with zero usage in the current library.
#[tauri::command]
pub async fn get_filter_options(
    state: State<'_, AppPaths>,
) -> Result<FilterOptions, String> {
    let pool = state.pool().await.map_err(err_str)?;

    // Brands — ordered by frequency desc, name asc as tiebreak. NULL/empty
    // excluded (matches `get_sidebar_categories`'s brand query).
    let brand_rows = sqlx::query(
        "SELECT brand, COUNT(*) AS cnt FROM games \
         WHERE brand IS NOT NULL AND brand <> '' \
         GROUP BY brand ORDER BY cnt DESC, brand COLLATE NOCASE ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let brands: Vec<BrandOption> = brand_rows
        .into_iter()
        .filter_map(|r| {
            Some(BrandOption {
                name: r.try_get("brand").ok()?,
                count: r.try_get("cnt").unwrap_or(0),
            })
        })
        .collect();

    // Helper: load all persons for one role, ordered by participation count.
    async fn persons_for_role(
        pool: &SqlitePool,
        role: &str,
    ) -> Result<Vec<PersonOption>, String> {
        let rows = sqlx::query(
            "SELECT p.id, p.name, p.name_cn, COUNT(DISTINCT gs.game_id) AS cnt \
             FROM persons p JOIN game_staff gs ON gs.person_id = p.id \
             WHERE gs.role = ? \
             GROUP BY p.id, p.name, p.name_cn \
             ORDER BY cnt DESC, COALESCE(p.name_cn, p.name) COLLATE NOCASE ASC",
        )
        .bind(role)
        .fetch_all(pool)
        .await
        .map_err(err_str)?;
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(PersonOption {
                id: r.try_get("id").map_err(err_str)?,
                name: r.try_get("name").map_err(err_str)?,
                name_cn: r.try_get("name_cn").ok(),
                count: r.try_get("cnt").unwrap_or(0),
            });
        }
        Ok(out)
    }

    let scenarios = persons_for_role(&pool, "scenario").await?;
    let artists = persons_for_role(&pool, "artist").await?;
    let voices = persons_for_role(&pool, "voice").await?;
    let music = persons_for_role(&pool, "music").await?;

    // Official tags — count distinct games per tag_name (cross-source: a tag
    // present on both Bangumi and VNDB for the same game counts once).
    let tag_rows = sqlx::query(
        "SELECT tag_name, COUNT(DISTINCT game_id) AS cnt \
         FROM game_official_tags \
         GROUP BY tag_name \
         ORDER BY cnt DESC, tag_name COLLATE NOCASE ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let official_tags: Vec<TagOption> = tag_rows
        .into_iter()
        .filter_map(|r| {
            Some(TagOption {
                name: r.try_get("tag_name").ok()?,
                count: r.try_get("cnt").unwrap_or(0),
            })
        })
        .collect();

    Ok(FilterOptions {
        brands,
        scenarios,
        artists,
        voices,
        music,
        official_tags,
    })
}

/// POL-03 — request that any in-flight backfill loop stop at the next
/// iteration boundary. Idempotent and safe to call when no backfill is
/// running (flag just sits true until the next backfill task resets it).
/// Returns immediately. Quick 260513-3df: no IPC currently consumes this
/// flag — kept for forward compatibility; `cancel_scan` is what stops
/// `refresh_metadata_smart`.
#[tauri::command]
pub async fn cancel_backfill(state: State<'_, BackfillState>) -> Result<(), String> {
    state
        .cancel
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Open an external URL in the user's default browser. Used by the staff
/// popover's "在 Bangumi/VNDB 查看" links and any other outbound link the
/// frontend wants to surface.
///
/// Phase 14 (FS-01) — re-routed through `tauri-plugin-opener`. The http(s)
/// whitelist stays here so this command can't be turned into a generic
/// shell-exec by a compromised frontend, even though the plugin itself is
/// also permission-gated at the capabilities layer.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("仅支持 http/https URL：{}", url));
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("无法打开浏览器：{}", e))
}

// ── Phase 13 (PER-03) — Co-staff aggregation ────────────────────────────────

/// Row returned by `list_co_staff_for_person`. `coshare` is the count of
/// distinct games the two persons co-occurred in; `role_hint` is the role
/// the co-occurring person held most often across those shared games.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CoStaffRow {
    pub person_id: i64,
    pub name: String,
    pub name_cn: Option<String>,
    pub source: String,
    pub source_id: String,
    pub coshare: i64,
    pub role_hint: Option<String>,
}

/// PER-03 — "frequently appears with X" aggregation for `/persons/:id`.
/// Returns up to `limit` (default 12) other persons who co-appeared in
/// ≥ 2 of the target person's games, ordered by coshare desc.
///
/// `role_hint` is computed via correlated subquery: pick the role the
/// co-occurring person held most often across the shared games.
#[tauri::command]
pub async fn list_co_staff_for_person(
    person_id: i64,
    limit: Option<i64>,
    state: State<'_, AppPaths>,
) -> Result<Vec<CoStaffRow>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let lim = limit.unwrap_or(12).clamp(1, 50);

    let rows = sqlx::query(
        "SELECT b.id AS person_id, b.name, b.name_cn, b.source, b.source_id, \
                COUNT(DISTINCT gs_b.game_id) AS coshare, \
                ( \
                  SELECT gs_b2.role \
                  FROM game_staff gs_a2 \
                  JOIN game_staff gs_b2 ON gs_a2.game_id = gs_b2.game_id AND gs_b2.person_id = b.id \
                  WHERE gs_a2.person_id = ? \
                  GROUP BY gs_b2.role \
                  ORDER BY COUNT(*) DESC \
                  LIMIT 1 \
                ) AS role_hint \
         FROM game_staff gs_a \
         JOIN game_staff gs_b ON gs_a.game_id = gs_b.game_id AND gs_b.person_id != gs_a.person_id \
         JOIN persons b ON b.id = gs_b.person_id \
         WHERE gs_a.person_id = ? \
         GROUP BY b.id, b.name, b.name_cn, b.source, b.source_id \
         HAVING coshare >= 2 \
         ORDER BY coshare DESC, COALESCE(b.name_cn, b.name) COLLATE NOCASE ASC \
         LIMIT ?",
    )
    .bind(person_id)
    .bind(person_id)
    .bind(lim)
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(CoStaffRow {
            person_id: row.try_get("person_id").map_err(err_str)?,
            name: row.try_get("name").map_err(err_str)?,
            name_cn: row.try_get("name_cn").ok(),
            source: row.try_get("source").map_err(err_str)?,
            source_id: row.try_get("source_id").map_err(err_str)?,
            coshare: row.try_get("coshare").map_err(err_str)?,
            role_hint: row.try_get("role_hint").ok(),
        });
    }
    Ok(out)
}

// ── Phase 14 (POL-02) — real session count for Stats KPI ───────────────────

/// Returns the total number of completed sessions across all games.
/// `ended_at IS NOT NULL` filters out the row representing the active
/// in-flight session (if any) — only sessions with a recorded stop count.
///
/// Used by `Stats.tsx` to replace the previous `games.length` proxy that
/// undercounted multi-session games and overcounted unplayed ones.
#[tauri::command]
pub async fn get_session_count(state: State<'_, AppPaths>) -> Result<i64, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let row = sqlx::query("SELECT COUNT(*) AS cnt FROM sessions WHERE ended_at IS NOT NULL")
        .fetch_one(&*pool)
        .await
        .map_err(err_str)?;
    let cnt: i64 = row.try_get("cnt").map_err(err_str)?;
    Ok(cnt)
}

// ── Phase 13 (PER-04) — Portrait cache IPC ─────────────────────────────────

/// Cache-first portrait lookup. Returns a path relative to `data_dir` (e.g.
/// `portraits/bangumi-12345.jpg`) so the frontend can render via
/// `convertFileSrc`. `Ok(None)` means the source has no portrait or this is
/// a VNDB person (VNDB portraits deferred to v1.4). `Err` is network / IO
/// failure the UI may surface as a transient warning.
#[tauri::command]
pub async fn get_or_fetch_portrait(
    source: String,
    source_id: String,
    state: State<'_, AppPaths>,
) -> Result<Option<String>, String> {
    let data_dir = state.data_dir.clone();
    let rel = crate::portrait_cache::get_or_fetch(&data_dir, &source, &source_id).await?;
    Ok(rel.map(|p| p.to_string_lossy().replace('\\', "/")))
}

// ── Custom views (Quick 20260510b) ─────────────────────────────────────────

/// Row payload for sidebar rendering and view-management UI. `count` is the
/// number of games currently in the view; computed via LEFT JOIN so views
/// with zero games still appear (users can see an empty view they just
/// created and start adding to it).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomViewRow {
    pub id: i64,
    pub name: String,
    pub count: i64,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_custom_views(
    state: State<'_, AppPaths>,
) -> Result<Vec<CustomViewRow>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT cv.id, cv.name, cv.created_at, COUNT(cvg.game_id) AS cnt \
         FROM custom_views cv \
         LEFT JOIN custom_view_games cvg ON cvg.view_id = cv.id \
         GROUP BY cv.id, cv.name, cv.created_at \
         ORDER BY cv.created_at ASC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(CustomViewRow {
            id: row.try_get("id").map_err(err_str)?,
            name: row.try_get("name").map_err(err_str)?,
            count: row.try_get("cnt").unwrap_or(0),
            created_at: row.try_get("created_at").map_err(err_str)?,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn create_custom_view(
    name: String,
    state: State<'_, AppPaths>,
) -> Result<i64, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("视图名称不能为空".to_string());
    }
    if trimmed.chars().count() > 60 {
        return Err("视图名称过长（最多 60 字符）".to_string());
    }
    let pool = state.pool().await.map_err(err_str)?;
    let result = sqlx::query("INSERT INTO custom_views (name) VALUES (?)")
        .bind(trimmed)
        .execute(&*pool)
        .await
        .map_err(|e| {
            // sqlite UNIQUE violation surfaces as "constraint" — return a
            // user-readable Chinese error rather than the raw sqlx string.
            let s = e.to_string();
            if s.contains("UNIQUE") || s.contains("constraint") {
                "已存在同名视图".to_string()
            } else {
                s
            }
        })?;
    Ok(result.last_insert_rowid())
}

#[tauri::command]
pub async fn rename_custom_view(
    view_id: i64,
    name: String,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("视图名称不能为空".to_string());
    }
    if trimmed.chars().count() > 60 {
        return Err("视图名称过长（最多 60 字符）".to_string());
    }
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("UPDATE custom_views SET name = ? WHERE id = ?")
        .bind(trimmed)
        .bind(view_id)
        .execute(&*pool)
        .await
        .map_err(|e| {
            let s = e.to_string();
            if s.contains("UNIQUE") || s.contains("constraint") {
                "已存在同名视图".to_string()
            } else {
                s
            }
        })?;
    Ok(())
}

#[tauri::command]
pub async fn delete_custom_view(
    view_id: i64,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    // ON DELETE CASCADE on custom_view_games clears the join rows too.
    sqlx::query("DELETE FROM custom_views WHERE id = ?")
        .bind(view_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

#[tauri::command]
pub async fn add_games_to_view(
    view_id: i64,
    game_ids: Vec<i64>,
    state: State<'_, AppPaths>,
) -> Result<i64, String> {
    if game_ids.is_empty() {
        return Ok(0);
    }
    let pool = state.pool().await.map_err(err_str)?;
    let mut tx = pool.begin().await.map_err(err_str)?;
    let mut inserted: i64 = 0;
    for gid in &game_ids {
        let r = sqlx::query(
            "INSERT OR IGNORE INTO custom_view_games (view_id, game_id) VALUES (?, ?)",
        )
        .bind(view_id)
        .bind(gid)
        .execute(&mut *tx)
        .await
        .map_err(err_str)?;
        inserted += r.rows_affected() as i64;
    }
    tx.commit().await.map_err(err_str)?;
    Ok(inserted)
}

#[tauri::command]
pub async fn remove_game_from_view(
    view_id: i64,
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    sqlx::query("DELETE FROM custom_view_games WHERE view_id = ? AND game_id = ?")
        .bind(view_id)
        .bind(game_id)
        .execute(&*pool)
        .await
        .map_err(err_str)?;
    Ok(())
}

// ── Phase 12 — Scan review queue IPCs ─────────────────────────────────────

/// 4-tile KPI snapshot for the `/scan` page header. Combines four COUNT
/// queries into one round-trip so the strip can refresh in <50 ms after
/// scan / bind / dismiss events.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanKpis {
    pub total: i64,
    pub bound: i64,
    pub review_pending: i64,
    pub unmatched: i64,
}

#[tauri::command]
pub async fn get_scan_kpis(state: State<'_, AppPaths>) -> Result<ScanKpis, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let row = sqlx::query(
        "SELECT \
           (SELECT COUNT(*) FROM games) AS total, \
           (SELECT COUNT(*) FROM games WHERE metadata_source IN ('bangumi','vndb','manual')) AS bound, \
           (SELECT COUNT(*) FROM scan_review_queue) AS review_pending, \
           (SELECT COUNT(*) FROM games WHERE metadata_source = 'none') AS unmatched",
    )
    .fetch_one(&*pool)
    .await
    .map_err(err_str)?;

    Ok(ScanKpis {
        total: row.try_get("total").map_err(err_str)?,
        bound: row.try_get("bound").map_err(err_str)?,
        review_pending: row.try_get("review_pending").map_err(err_str)?,
        unmatched: row.try_get("unmatched").map_err(err_str)?,
    })
}

/// Row payload for the `ReviewQueue` UI. Joins `scan_review_queue` with
/// `games` so the frontend has the user-visible game name (which may have
/// changed since the queue row was created) plus the queue's snapshot fields.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewItem {
    pub game_id: i64,
    pub game_path: String,
    pub name: Option<String>,
    pub cover_path: Option<String>,
    pub current_confidence: i64,
    pub current_source: Option<String>,
    pub current_source_id: Option<String>,
    pub suggested_source: Option<String>,
    pub suggested_id: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_scan_review_queue(
    state: State<'_, AppPaths>,
) -> Result<Vec<ReviewItem>, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let rows = sqlx::query(
        "SELECT q.game_id, q.game_path, q.current_confidence, q.suggested_source, \
                q.suggested_id, q.created_at, \
                g.name AS name, g.cover_path AS cover_path, \
                g.metadata_source AS current_source, \
                CASE g.metadata_source \
                  WHEN 'bangumi' THEN g.bangumi_id \
                  WHEN 'vndb' THEN g.vndb_id \
                  ELSE NULL \
                END AS current_source_id \
         FROM scan_review_queue q \
         LEFT JOIN games g ON g.id = q.game_id \
         ORDER BY q.created_at DESC",
    )
    .fetch_all(&*pool)
    .await
    .map_err(err_str)?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(ReviewItem {
            game_id: r.try_get("game_id").map_err(err_str)?,
            game_path: r.try_get("game_path").map_err(err_str)?,
            name: r.try_get::<Option<String>, _>("name").ok().flatten(),
            cover_path: r.try_get::<Option<String>, _>("cover_path").ok().flatten(),
            current_confidence: r.try_get("current_confidence").map_err(err_str)?,
            current_source: r
                .try_get::<Option<String>, _>("current_source")
                .ok()
                .flatten(),
            current_source_id: r
                .try_get::<Option<String>, _>("current_source_id")
                .ok()
                .flatten(),
            suggested_source: r
                .try_get::<Option<String>, _>("suggested_source")
                .ok()
                .flatten(),
            suggested_id: r
                .try_get::<Option<String>, _>("suggested_id")
                .ok()
                .flatten(),
            created_at: r.try_get("created_at").map_err(err_str)?,
        });
    }
    Ok(out)
}

/// Drop a game from the review queue without re-binding. The user has decided
/// the current metadata (or lack thereof) is good enough; they can rebind
/// later via `MetadataPicker` if they change their mind. The games row stays
/// untouched.
#[tauri::command]
pub async fn dismiss_review_item(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    let pool = state.pool().await.map_err(err_str)?;
    delete_from_review_queue(&*pool, game_id).await
}

/// Accept a Bangumi or VNDB candidate from the review-queue UI. Thin wrapper
/// over `bind_metadata` — semantic alias so callers don't conflate the
/// review-queue flow with the standard MetadataPicker rebind path.
/// `bind_metadata` already clears the queue row on success.
#[tauri::command]
pub async fn accept_review_candidate(
    game_id: i64,
    source: String,
    source_id: String,
    app: AppHandle,
    state: State<'_, AppPaths>,
) -> Result<(), String> {
    bind_metadata(game_id, source, source_id, app, state).await
}

/// Side-by-side Bangumi vs VNDB top candidates for a queued game. Each source
/// is searched independently with the game's current `name`; results are
/// capped to the top-1 per source so the UI's 2-column compare card has a
/// clear "Bangumi 候选 / VNDB 候选" structure. Sources that fail or return
/// zero hits yield `None`, which the frontend renders as "未找到匹配".
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewCandidates {
    pub bangumi: Option<metadata::Candidate>,
    pub vndb: Option<metadata::Candidate>,
}

#[tauri::command]
pub async fn fetch_review_candidates(
    game_id: i64,
    state: State<'_, AppPaths>,
) -> Result<ReviewCandidates, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let row = sqlx::query("SELECT name FROM games WHERE id = ?")
        .bind(game_id)
        .fetch_optional(&*pool)
        .await
        .map_err(err_str)?;
    let name: String = match row {
        Some(r) => r.try_get("name").map_err(err_str)?,
        None => return Err(format!("game {} not found", game_id)),
    };

    // Best-effort dual fetch. tokio::join! runs both searches concurrently —
    // bangumi 1 req/s limiter and vndb 100 req/min limiter are independent
    // governors, so this saves ~1 s typical.
    let (bgm_res, vndb_res) = tokio::join!(
        metadata::bangumi::search(&name),
        metadata::vndb::search(&name),
    );
    let bangumi = bgm_res
        .ok()
        .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) });
    let vndb = vndb_res
        .ok()
        .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) });

    Ok(ReviewCandidates { bangumi, vndb })
}

/// Quick 20260512c — backfill the review queue from the existing `games`
/// table. `sync_review_queue_for_game` only fires on new ingest events, so
/// any `metadata_source='none'` row that pre-dates Phase 12 is invisible to
/// the Scan page's ReviewQueue. This IPC reseeds the queue in one shot so
/// the user can manually rebind those orphans.
///
/// Scope: every game where `metadata_source='none'` OR (source is not
/// 'manual' AND match_confidence < 80). `manual` rows are excluded —
/// they're the user's confirmed bindings; revisiting them via the queue
/// would be noise.
///
/// `INSERT OR REPLACE` semantics: rows already in the queue keep their PK
/// but their `created_at` is refreshed so the UI's ORDER BY DESC surfaces
/// reseeded entries at the top. Previously dismissed games will reappear —
/// that's the intended "let me see them again" behavior.
#[tauri::command]
pub async fn reseed_review_queue(state: State<'_, AppPaths>) -> Result<i64, String> {
    let pool = state.pool().await.map_err(err_str)?;
    let result = sqlx::query(
        "INSERT OR REPLACE INTO scan_review_queue \
             (game_id, game_path, current_confidence, suggested_source, suggested_id, created_at) \
         SELECT id, path, COALESCE(match_confidence, 0), \
                CASE WHEN metadata_source IN ('bangumi','vndb') THEN metadata_source ELSE NULL END, \
                CASE metadata_source \
                  WHEN 'bangumi' THEN bangumi_id \
                  WHEN 'vndb' THEN vndb_id \
                  ELSE NULL \
                END, \
                strftime('%Y-%m-%dT%H:%M:%fZ','now') \
         FROM games \
         WHERE metadata_source = 'none' \
            OR (metadata_source != 'manual' AND COALESCE(match_confidence, 0) < 80)",
    )
    .execute(&*pool)
    .await
    .map_err(err_str)?;
    Ok(result.rows_affected() as i64)
}
