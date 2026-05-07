mod commands;
mod cover_cache;
mod data_dir;
mod db;
mod ingest;
mod launch;
mod metadata;
mod scan;
mod title_clean;
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
        .manage(AppPaths {
            data_dir,
            db_url,
            pool: OnceCell::new(),
        })
        .manage(commands::ScanState::new())
        .manage(commands::ActiveSessionState(std::sync::Mutex::new(None)))
        .setup(|app| {
            // 03e — system tray (icon + 「显示主窗口」/「退出应用」 menu + tooltip).
            tray::setup_tray(&app.handle())?;

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
            commands::search_metadata,
            commands::bind_metadata,
            commands::refresh_metadata,
            commands::list_games,
            // 03d — launch + sessions + LE path
            commands::launch_game,
            commands::get_active_session,
            commands::end_active_session,
            commands::list_sessions,
            commands::update_game_launch_config,
            commands::get_le_path,
            commands::set_le_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
