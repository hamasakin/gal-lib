---
phase: 03-launch-playtime
plan: 03e
subsystem: launch-playtime
tags: [tauri, tray, window-event, close-to-tray, background-lifetime]
requires: [03a, 03d]
provides:
  - tray-icon (id="main") with menu + tooltip
  - close-to-tray window-event interceptor
  - "close-to-tray" event for frontend toast (consumed by 03f)
  - quit-path session cleanup (best-effort cancel_session before app.exit)
affects:
  - src-tauri/Cargo.toml (tauri features += "tray-icon")
  - src-tauri/src/lib.rs (mod tray + setup closure)
  - src-tauri/src/commands.rs (get_pool_blocking helper, AppPaths.pool pub(crate))
tech-stack:
  added:
    - tauri tray-icon feature (already in tauri 2 — feature-gated)
  patterns:
    - tray::setup_tray called from Builder.setup closure
    - WindowEvent::CloseRequested → api.prevent_close + window.hide + emit
    - Sync OnceCell.get() accessor (no await) for main-thread tray callbacks
    - tauri::async_runtime::block_on inside tray menu callback (main thread)
key-files:
  created:
    - src-tauri/src/tray.rs
  modified:
    - src-tauri/Cargo.toml
    - src-tauri/src/lib.rs
    - src-tauri/src/commands.rs
decisions:
  - "Make AppPaths.pool pub(crate) instead of adding an accessor on AppPaths: tray helper needs synchronous read with no await; pool() initialiser is async."
  - "tray::setup_tray placed in Builder.setup closure (not in run() prelude): needs an &AppHandle, which is only available after Builder construction."
  - "Tray quit path uses block_on (not spawn): runs on main thread from tray menu callback; we want app.exit(0) to fire only after cancel_session finishes (or fails)."
  - "update_tray_tooltip exposed as pub but unused in P3: stable extension point for future 'playing X' tooltip."
metrics:
  duration_min: 12
  completed_at: "2026-05-07"
  tasks_completed: 1
  files_changed: 4
  files_created: 1
---

# Phase 3 Plan 03e: System Tray + Close-to-Tray Summary

**One-liner:** Tauri 2 `TrayIconBuilder` registered in setup hook with 「显示主窗口」/「退出应用」 menu, left-click restores window, close-to-tray intercepts `WindowEvent::CloseRequested` (background timing preserved), graceful quit cancels active session before `app.exit(0)`.

## What Was Built

1. **`src-tauri/src/tray.rs`** (114 lines, new):
   - `setup_tray(app: &AppHandle) -> tauri::Result<()>` — builds `TrayIconBuilder::with_id("main")` with the bundled window icon, tooltip "gal-lib", and a 2-item menu (`show` / `quit`). Click-on-icon (left button) and the 「显示主窗口」 menu item both call `show_main_window` (show + set_focus + unminimize).
   - `quit_with_session_cleanup(app: &AppHandle)` — looks up `ActiveSessionState` via `app.try_state::<…>()`, extracts the `session_id` while holding the std `Mutex` only briefly (no `await` inside the lock), then `tauri::async_runtime::block_on(cancel_session(&pool, sid))` and finally `app.exit(0)`. All failure paths degrade silently — quit is never blocked.
   - `update_tray_tooltip(app, text)` — exposed as `pub` but unused in P3; reserved for "currently playing X" UX in later phases.
2. **`src-tauri/src/lib.rs`** (27 line delta):
   - Added `mod tray;` to module declarations.
   - Added `use tauri::{Emitter, Manager}` (Manager for `get_webview_window`, Emitter for the `close-to-tray` emit).
   - Inserted `.setup(|app| { … })` between `.manage(ActiveSessionState…)` and `.invoke_handler(…)`. The closure:
     1. Calls `tray::setup_tray(&app.handle())?` (propagates icon/menu errors loudly).
     2. Looks up the main webview window, attaches a `on_window_event` handler that, on `WindowEvent::CloseRequested`, calls `api.prevent_close()`, `main_window.hide()`, then `app_handle.emit("close-to-tray", ())` so 03f's frontend toast can fire.
3. **`src-tauri/Cargo.toml`** (1 line delta): `tauri` features changed from `[]` to `["tray-icon"]` — required to compile `tauri::tray::*` types.
4. **`src-tauri/src/commands.rs`** (27 line delta):
   - Added `pub fn get_pool_blocking(app: &AppHandle) -> Result<Arc<SqlitePool>, String>` — synchronous read of `AppPaths.pool.get()`. Errors when the OnceCell hasn't been initialised yet (no command has touched the DB), in which case the tray quit path skips cleanup and exits anyway.
   - Added `use sqlx::SqlitePool` near the helper.
5. **`AppPaths.pool` visibility:** changed from private to `pub(crate)` so `commands::get_pool_blocking` can read the `OnceCell` directly (its `.get()` is sync; the existing `pool()` async accessor is unsuitable for the main-thread tray callback).

## Verification

- `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 (only 4 pre-existing dead_code/unused warnings, all out of scope per SCOPE BOUNDARY).
- `cargo build --release --manifest-path src-tauri/Cargo.toml --bin gal-lib` → exit 0 (release profile: codegen-units=1 + lto + opt-level="s").
- All `must_haves.truths` from the plan satisfied:
  - TrayIconBuilder created in setup with 2 menu items + tooltip "gal-lib" ✓
  - WindowEvent::CloseRequested → prevent_close + hide + emit ✓
  - Left-click → show_main_window (show + set_focus + unminimize) ✓
  - 「退出应用」 → cancel active session (if any) → app.exit(0) ✓
- `must_haves.artifacts`: `tray.rs` contains `TrayIconBuilder`; `lib.rs` contains `tray::setup_tray` ✓.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] AppPaths.pool was private — tray helper could not read OnceCell**
- **Found during:** Task 1 (writing `commands::get_pool_blocking`)
- **Issue:** Plan's helper sketch assumed `state.pool.get()` was reachable from `commands.rs`, but `lib.rs` declared `pool: OnceCell<Arc<SqlitePool>>` without `pub` / `pub(crate)`. Sub-modules of a crate root cannot access private fields on a parent-module struct.
- **Fix:** Changed visibility to `pub(crate)` (no API exposure outside the crate; same effective surface as the existing `pool()` async accessor).
- **Files modified:** `src-tauri/src/lib.rs`
- **Commit:** 15df4de

**2. [Rule 3 - Blocking] `Manager` and `Emitter` were not in scope in lib.rs**
- **Found during:** Task 1 (cargo check)
- **Issue:** New `setup` closure calls `app.get_webview_window("main")` (requires `tauri::Manager`) and `app_handle.emit("close-to-tray", ())` (requires `tauri::Emitter`). Pre-03e `lib.rs` did not import either.
- **Fix:** Added `use tauri::{Emitter, Manager};` near the top of `lib.rs`.
- **Files modified:** `src-tauri/src/lib.rs`
- **Commit:** 15df4de

### Skipped from Plan

**capabilities/default.json — no edits made.** The plan suggested optionally appending `core:app:allow-version`, `core:app:allow-name`, `core:app:default` if cargo build complained. cargo check + release build both passed cleanly with the existing `core:default` permission, so no changes were applied (Tauri 2's `core:default` already grants `core:app:default` and `core:tray:default`). Documented as a no-op deviation per Rule "less is more — only add when build complains".

## Authentication Gates

None.

## Deferred Issues

None. Pre-existing dead_code warnings in `metadata/`, `ingest.rs`, `launch/orchestrator.rs` are out of scope for 03e (introduced in 02x / 03c).

## Threat Flags

None — 03e adds no new network surface, no auth path, no file I/O at trust boundaries. Tray menu is local-only UI; close-to-tray is intra-process window-event interception.

## Known Stubs

None — `update_tray_tooltip` is exposed `pub` and `#[allow(dead_code)]` because future phases (e.g. "playing X" tooltip) will wire it. Not a UI-facing stub.

## TDD Gate Compliance

N/A — plan type is `execute`, not `tdd`. No RED gate required.

## Self-Check: PASSED

- `src-tauri/src/tray.rs` exists ✓ (FOUND via Bash test -f)
- `src-tauri/src/lib.rs` contains `mod tray` + `tray::setup_tray` + `CloseRequested` + `prevent_close` ✓ (Grep)
- `src-tauri/src/commands.rs` contains `get_pool_blocking` ✓
- `Cargo.toml` `tauri` features include `tray-icon` ✓
- Commit 15df4de exists in git log ✓
- cargo check exit 0 ✓
- cargo build --release exit 0 ✓
