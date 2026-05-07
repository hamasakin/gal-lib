//! Phase 3 / 03e — System tray + close-to-tray glue.
//!
//! Tauri 2 ships an internal `tray-icon` feature (enabled in Cargo.toml).
//! `setup_tray` is invoked from the Builder's `.setup()` closure in `lib.rs`
//! AFTER `.manage(...)` calls register `ActiveSessionState`, so the quit-path
//! cleanup helper can look up the active session via `app.try_state::<…>()`.
//!
//! Tray contract (CONTEXT §System Tray):
//!   - icon: reuse the bundled window icon (no separate art asset in P3)
//!   - tooltip: "gal-lib"
//!   - menu: 「显示主窗口」 + 「退出应用」
//!   - left-click on icon = same as 「显示主窗口」
//!   - 「退出应用」 first cancels any active session (best-effort) then app.exit(0)
//!
//! `update_tray_tooltip` is exposed for future phases (e.g. show running game
//! name in the tooltip while a session is active). Currently unused but kept
//! as a stable extension point.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Stable tray-icon id. Phase 3 only registers one tray icon; future phases
/// may add more (e.g. download-progress mini-tray) but this one stays "main".
const TRAY_ID: &str = "main";

/// Build and register the system tray icon. Call once from the Builder
/// `.setup()` closure. Errors propagate as `tauri::Error` so the setup hook
/// fails loudly if the icon / menu APIs throw (vs silently returning `()`).
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let _ = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("gal-lib")
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("default window icon must be bundled (tauri.conf.json icons[])"),
        )
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                quit_with_session_cleanup(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Tauri 2 fires distinct Click / DoubleClick / Enter / Leave / Move
            // events. We only react to a primary (left) button click.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Restore the main webview window: show + focus + un-minimize. Called from
/// the tray menu「显示主窗口」 and from a left-click on the tray icon.
fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.unminimize();
    }
}

/// Best-effort graceful quit. If a session is currently active, mark it
/// `cancelled` in the DB (so `total_playtime_sec` is credited) before calling
/// `app.exit(0)`. Failures (no active session, pool not initialised, DB
/// error) all degrade silently — quit is not blocked on cleanup.
fn quit_with_session_cleanup(app: &AppHandle) {
    if let Some(state) = app.try_state::<crate::commands::ActiveSessionState>() {
        // Hold the std::sync::Mutex only long enough to extract session_id;
        // cancel_session is async and we cannot await while holding it.
        let active_sid = state
            .0
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|e| e.session.session_id));

        if let Some(sid) = active_sid {
            if let Ok(pool) = crate::commands::get_pool_blocking(app) {
                // block_on is safe here: we're on the main thread (tray menu
                // callback context), NOT inside a Tokio task. The async
                // runtime is up because `tauri::async_runtime::set` was
                // called by the Builder.
                tauri::async_runtime::block_on(async {
                    let _ = crate::launch::session::cancel_session(&pool, sid).await;
                });
            }
        }
    }
    app.exit(0);
}

/// Update the tray tooltip to `text`. No-op if the tray hasn't been built
/// yet. Provided for future phases (e.g. "gal-lib — playing <game name>");
/// not wired in P3.
#[allow(dead_code)]
pub fn update_tray_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(text));
    }
}
