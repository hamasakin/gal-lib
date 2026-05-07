mod data_dir;
mod db;

use std::path::PathBuf;

/// State managed by Tauri; exposed to the frontend via the `get_data_dir` command.
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_url: String,
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
    //    (Replaced by tauri-plugin-log in a later plan; println is sufficient
    //     for Phase 1 bring-up smoke testing.)
    eprintln!("[gal-lib] portable data_dir = {}", data_dir.display());
    eprintln!("[gal-lib] sqlite url = {}", db_url);

    let migrations = db::migrations();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&db_url, migrations)
                .build(),
        )
        .manage(AppPaths {
            data_dir,
            db_url,
        })
        .invoke_handler(tauri::generate_handler![get_data_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
