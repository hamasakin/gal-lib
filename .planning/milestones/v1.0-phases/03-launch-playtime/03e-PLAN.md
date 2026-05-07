---
phase: 03-launch-playtime
plan: 03e
type: execute
wave: 5
depends_on: [03a]
files_modified:
  - src-tauri/src/tray.rs
  - src-tauri/src/lib.rs
  - src-tauri/capabilities/default.json
autonomous: true
requirements: [TRAY-01, TRAY-02, TRAY-03, TIME-05]
must_haves:
  truths:
    - "Tauri 2 TrayIconBuilder 在 setup 时建图标 + 菜单（显示主窗口 / 退出应用）+ tooltip 'gal-lib'"
    - "WindowEvent::CloseRequested intercept → prevent_default + window.hide()，首次提示 toast『已最小化到系统托盘』"
    - "托盘左键单击 → window.show() + set_focus()"
    - "托盘菜单右键 + 选「退出应用」→ app.exit(0)（如有 active session 先 cancel_session）"
    - "cargo check 退出 0；release build 退出 0"
  artifacts:
    - path: src-tauri/src/tray.rs
      contains: "TrayIconBuilder"
    - path: src-tauri/src/lib.rs
      contains: "tray::setup_tray"
---

# Plan 03e — System Tray + Close-to-Tray + Background Lifetime

## Tasks

<task name="Task 1: tray.rs setup + lib.rs window-event interceptor">

<read_first>
- D:\project\gal-lib\src-tauri\src\lib.rs (current — add tray setup hook)
- D:\project\gal-lib\src-tauri\Cargo.toml (verify tauri features for tray)
- D:\project\gal-lib\.planning\phases\03-launch-playtime\03-CONTEXT.md (§System Tray)
- D:\project\gal-lib\src-tauri\capabilities\default.json
</read_first>

<action>

1. **`src-tauri/Cargo.toml`** — ensure `tauri` features include `"tray-icon"`:
```toml
tauri = { version = "2", features = ["tray-icon"] }
```
(default features may already include this; verify)

2. **`src-tauri/capabilities/default.json`** — append:
```json
"core:app:allow-version",
"core:app:allow-name",
"core:app:default"
```
(if not already present from Phase 1's `core:default`)

3. **`src-tauri/src/tray.rs`**:
```rust
use tauri::{
    AppHandle, Manager, Wry,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, MouseButton, TrayIconEvent},
};

const TRAY_ID: &str = "main";

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let _ = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("gal-lib")
        .icon(app.default_window_icon().cloned().unwrap())
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                quit_with_session_cleanup(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.unminimize();
    }
}

fn quit_with_session_cleanup(app: &AppHandle) {
    // Best-effort: if there's an active session, cancel it before exit.
    if let Some(state) = app.try_state::<crate::commands::ActiveSessionState>() {
        let active_opt = state.0.lock().ok().and_then(|g| g.as_ref().map(|e| e.session.session_id));
        if let Some(sid) = active_opt {
            let pool_arc = crate::commands::get_pool_blocking(app).ok();
            if let Some(pool) = pool_arc {
                tauri::async_runtime::block_on(async {
                    let _ = crate::launch::session::cancel_session(&pool, sid).await;
                });
            }
        }
    }
    app.exit(0);
}

pub fn update_tray_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(text));
    }
}
```

> **Note:** `commands::get_pool_blocking(app)` is a small helper that synchronously reads `AppPaths.pool` — add it to commands.rs as a free function `pub fn get_pool_blocking(app: &AppHandle) -> Result<Arc<SqlitePool>, String> { ... }`. If pool is OnceCell-based and may not be initialized at quit time, return None / Err; tray quit gracefully degrades.

4. **`src-tauri/src/lib.rs`** — modifications:

   a. Append `mod tray;` to module declarations.
   
   b. In the `setup` closure of `tauri::Builder::default()` (or add one if not present), call `tray::setup_tray(&app.handle())?;` and set up the close-requested interceptor on the main window:
   ```rust
   .setup(|app| {
       tray::setup_tray(&app.handle())?;
       // Close-to-tray: intercept main window close
       let main_window = app.get_webview_window("main").expect("main window");
       let app_handle = app.handle().clone();
       main_window.clone().on_window_event(move |event| {
           if let tauri::WindowEvent::CloseRequested { api, .. } = event {
               api.prevent_close();
               let _ = main_window.hide();
               // Emit a hint event for first-time tray-toast
               let _ = app_handle.emit("close-to-tray", ());
           }
       });
       Ok(())
   })
   ```
   
   c. The `setup` closure goes between `.manage(...)` calls and `.invoke_handler(...)`.

5. cargo check + cargo build --bin gal-lib all green. (Don't smoke-test interactively in autonomous mode.)

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/tray.rs && \
grep -q "TrayIconBuilder" src-tauri/src/tray.rs && \
grep -q "显示主窗口" src-tauri/src/tray.rs && \
grep -q "退出应用" src-tauri/src/tray.rs && \
grep -q "mod tray" src-tauri/src/lib.rs && \
grep -q "tray::setup_tray" src-tauri/src/lib.rs && \
grep -q "CloseRequested" src-tauri/src/lib.rs && \
grep -q "prevent_close" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml
</automated>
</verify>

</task>

## Commit

`feat(03-03e): system tray + close-to-tray (background lifetime preserved)`
