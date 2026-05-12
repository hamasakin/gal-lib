mod commands;
mod cover_cache;
mod data_dir;
mod db;
mod ingest;
mod launch;
mod metadata;
mod portrait_cache;
mod save_backup;
mod scan;
mod screenshot;
pub mod title_clean;
mod tray;

use std::path::PathBuf;
use std::sync::Arc;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tauri::{Emitter, Manager};
use tokio::sync::OnceCell;

/// State managed by Tauri; exposed to commands and (for `data_dir`) the
/// frontend via `get_data_dir`.
///
/// `pool` is a `OnceCell` because:
///   - sqlx 0.8's `SqlitePoolOptions::connect_lazy` panics outside a Tokio
///     context (issues a `tokio::spawn` for an internal connection task)
///   - Tauri 2.x's `Builder::default()` runs before the runtime is up; its
///     `.setup()` hook runs on the main thread (also non-Tokio in this build)
///   - Commands ARE async and run on Tokio, so the first command that needs
///     the pool initialises it via `get_or_try_init` and subsequent
///     commands share the cached `Arc<SqlitePool>`
///
/// `pool_url` is stored alongside so the OnceCell init closure has the
/// connection string without re-borrowing AppPaths.
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_url: String,
    /// Resolved absolute path to the bundled `LEProc.exe`. Populated in
    /// `setup` via `app.path().resolve(..., BaseDirectory::Resource)`.
    /// `None` only if the resource doesn't actually exist on disk (which
    /// would be a packaging bug). resolve_le_path uses this as the default
    /// when no user override is configured.
    pub bundled_le_proc: std::sync::OnceLock<PathBuf>,
    pub(crate) pool: OnceCell<Arc<SqlitePool>>,
}

impl AppPaths {
    /// Resolve (and on first call, build) the shared sqlx pool.
    ///
    /// Errors propagate as `sqlx::Error`; commands stringify them via the
    /// `err_str` helper for Tauri's `Result<T, String>` contract.
    pub async fn pool(&self) -> Result<Arc<SqlitePool>, sqlx::Error> {
        let pool = self
            .pool
            .get_or_try_init(|| async {
                let p = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect_lazy(&self.db_url)?;
                Ok::<_, sqlx::Error>(Arc::new(p))
            })
            .await?;
        Ok(pool.clone())
    }
}

/// Tauri command: returns the absolute, canonicalized `data/` directory path.
/// The frontend appends `/app.db` itself (see `src/lib/db.ts`) — keeping the
/// command return value path-only makes it reusable for cover/screenshot/save
/// helpers in later phases.
#[tauri::command]
fn get_data_dir(state: tauri::State<AppPaths>) -> String {
    state.data_dir.to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Resolve + ensure the portable data directory BEFORE building Tauri,
    //    so tauri-plugin-sql can register the migration against an absolute
    //    on-disk path. Failure here is a hard panic — the app cannot run
    //    without writable data dir.
    let data_dir = data_dir::ensure()
        .expect("failed to initialize portable data directory");

    // 2. Construct the sqlite URL with forward-slashes and ABSOLUTE path.
    //    The plugin's path_mapper does `app_path.push(connection_string)`
    //    and PathBuf::push(absolute) replaces app_path entirely (RESEARCH §A1),
    //    bypassing the default app_config_dir join.
    let db_url = data_dir::build_db_url(&data_dir);

    // 3. Print the resolved path so dev runs visibly confirm the bypass worked.
    eprintln!("[gal-lib] portable data_dir = {}", data_dir.display());
    eprintln!("[gal-lib] sqlite url = {}", db_url);

    let migrations = db::migrations();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&db_url, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppPaths {
            data_dir,
            db_url,
            bundled_le_proc: std::sync::OnceLock::new(),
            pool: OnceCell::new(),
        })
        .manage(commands::ScanState::new())
        .manage(commands::BackfillState::new())
        .manage(commands::ActiveSessionState(std::sync::Mutex::new(None)))
        .setup(|app| {
            // 03e — system tray (icon + 「显示主窗口」/「退出应用」 menu + tooltip).
            tray::setup_tray(&app.handle())?;

            // Resolve the bundled LEProc.exe path now that app.path() is
            // available. PathResolver handles the dev-vs-bundle directory
            // mapping — in production this lands in <install>/resources/,
            // in `pnpm tauri dev` it points at src-tauri/. Either way, the
            // resource declared as "resources/locale-emulator/*" in
            // tauri.conf.json resolves correctly.
            if let Ok(le_proc) = app
                .path()
                .resolve(
                    "resources/locale-emulator/LEProc.exe",
                    tauri::path::BaseDirectory::Resource,
                )
            {
                if le_proc.exists() {
                    eprintln!("[gal-lib] bundled LEProc resolved at {:?}", le_proc);
                    let paths = app.state::<AppPaths>();
                    let _ = paths.bundled_le_proc.set(le_proc);
                } else {
                    eprintln!(
                        "[gal-lib] bundled LEProc resolved but missing on disk: {:?}",
                        le_proc
                    );
                }
            }

            // 03e — close-to-tray: intercept main window close, hide instead of exit.
            // The session orchestrator + tokio tasks live independently of the
            // webview window, so timing continues unaffected after hide().
            let main_window = app
                .get_webview_window("main")
                .expect("main window must exist (declared in tauri.conf.json)");
            let app_handle = app.handle().clone();
            let main_for_handler = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = main_for_handler.hide();
                    // Frontend listens for this and shows a one-shot toast
                    // ("已最小化到系统托盘") on the first close-to-tray event.
                    let _ = app_handle.emit("close-to-tray", ());
                }
            });

            // 20260509f — purge orphan placeholder rows from previous crashed /
            // force-killed scans. A placeholder is `metadata_source IS NULL
            // AND last_scanned_at IS NULL` — i.e. INSERT ran but the enrich
            // half never updated the row. Safe to do at startup because a
            // scan in progress belongs to the previous (now-dead) process;
            // this process's own ingest loop hasn't started yet.
            //
            // Lives in setup (not db.rs migrations) because migrations
            // should be schema-only — running data-cleanup there blurs
            // responsibility and would re-execute every schema upgrade.
            // We spawn into the tauri async runtime because setup is sync;
            // the cleanup is best-effort (DELETE failures are non-fatal,
            // worst case is a few visible "获取中" cards that the user
            // can right-click to retry).
            let app_for_cleanup = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(paths) = app_for_cleanup.try_state::<AppPaths>() {
                    if let Ok(pool) = paths.pool().await {
                        let _ = sqlx::query(
                            "DELETE FROM games WHERE metadata_source IS NULL AND last_scanned_at IS NULL",
                        )
                        .execute(&*pool)
                        .await;
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            commands::add_scan_root,
            commands::remove_scan_root,
            commands::list_scan_roots,
            commands::start_scan,
            commands::cancel_scan,
            commands::mark_skip_dir,
            commands::add_game,
            commands::clear_all_data,
            commands::search_metadata,
            commands::bind_metadata,
            commands::refresh_metadata,
            // Quick 260513-3df — unified two-button refresh entry; replaces
            // refresh_all_metadata + backfill_release_year.
            commands::refresh_metadata_smart,
            commands::list_games,
            // 03d — launch + sessions + LE path
            commands::launch_game,
            commands::get_active_session,
            commands::end_active_session,
            commands::list_sessions,
            commands::update_game_launch_config,
            commands::get_le_path,
            commands::set_le_path,
            // 04b — search/sort/filter + tag CRUD + game property updates
            commands::search_games,
            commands::get_sidebar_categories,
            commands::list_tags,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::set_game_tags,
            commands::list_game_tags,
            commands::update_game_status,
            commands::update_game_favorite,
            commands::update_game_rating,
            commands::update_game_notes,
            commands::update_game_brand_year,
            // 05b — stats (2) + screenshots (5) + save backups (5) = 12 new
            commands::get_playtime_trend,
            commands::get_top_games,
            commands::get_screenshots,
            commands::delete_screenshot,
            commands::export_screenshot,
            commands::set_screenshot_interval,
            commands::get_screenshot_settings,
            commands::set_save_path,
            commands::get_save_path,
            commands::list_save_backups,
            commands::create_save_backup,
            commands::restore_save_backup,
            commands::delete_save_backup,
            // 20260509b — open game directory in OS file manager (1 new)
            commands::open_in_explorer,
            // Phase 14 (FS-01) — canonical open-path IPC backed by opener plugin
            commands::open_path,
            // 11c — Phase 11 metadata enrichment IPCs (6 new)
            commands::list_persons_for_game,
            commands::list_games_for_person,
            commands::list_official_tags_for_game,
            commands::get_filter_options,
            commands::open_external_url,
            // Phase 13 — Person enrichment
            commands::list_co_staff_for_person,
            commands::get_or_fetch_portrait,
            commands::cancel_backfill,
            // Phase 14 — Stats KPI real session count
            commands::get_session_count,
            // Quick 20260510b — custom views (6 new)
            commands::list_custom_views,
            commands::create_custom_view,
            commands::rename_custom_view,
            commands::delete_custom_view,
            commands::add_games_to_view,
            commands::remove_game_from_view,
            // Phase 12 — scan review queue (5 new)
            commands::get_scan_kpis,
            commands::list_scan_review_queue,
            commands::dismiss_review_item,
            commands::accept_review_candidate,
            commands::fetch_review_candidates,
            commands::reseed_review_queue,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
