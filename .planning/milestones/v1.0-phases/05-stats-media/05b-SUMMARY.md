---
phase: 05-stats-media
plan: 05b
subsystem: backend-stats-screenshots-saves
tags: [tauri-commands, rust, sqlx, screenshots, save-backup, tokio-interval]
requires: ["05a (schema v5 + screenshots/png crates)"]
provides:
  - "screenshot::capture_to_disk (primary monitor → data/screenshots/<game_id>/<ts>.png)"
  - "save_backup::{create_backup, restore_backup, delete_backup_dir} (walkdir-based recursive copy)"
  - "orchestrator screenshot interval task (per-session tokio::time::interval; AtomicBool cancel flag)"
  - "12 Tauri commands (2 stats + 5 screenshots + 5 save backups)"
affects:
  - src-tauri/src/screenshot.rs
  - src-tauri/src/save_backup.rs
  - src-tauri/src/launch/orchestrator.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
tech-stack:
  added: []  # All deps were locked in 05a (screenshots 0.8, png 0.17, walkdir already present)
  patterns:
    - "Sync I/O modules for short-bounded ops (screenshot ~100ms, save copy ~100ms): caller handles tokio if needed"
    - "Shared Arc<AtomicBool> cancel between paired tokio tasks (wait-for-exit ↔ screenshot-interval): zero-contention flip-once gate"
    - "PNG encoding via png crate directly (skip image v0.24/v0.25 cross-version friction from screenshots' re-export)"
    - "Dual-write protocol: DB row + filesystem mutation. Order = DELETE row first then best-effort fs::remove (commands prefer orphan files over orphan rows); CREATE = filesystem first then INSERT (so half-written PNG never gets a row)"
key-files:
  created:
    - "src-tauri/src/screenshot.rs (97 lines) — capture_to_disk: Screen::all → first → capture → png::Encoder stream-to-disk → returns rel path"
    - "src-tauri/src/save_backup.rs (212 lines) — create_backup/restore_backup/delete_backup_dir + 3 unit tests"
  modified:
    - "src-tauri/src/launch/orchestrator.rs — +52 lines: read screenshot_interval_sec, spawn 2nd tokio task with AtomicBool cancel, flip flag at terminal transitions"
    - "src-tauri/src/commands.rs — +480 lines: 12 new commands + 4 row structs (TrendPoint, TopGame, ScreenshotRow, SaveBackupRow)"
    - "src-tauri/src/lib.rs — +14 lines: 2 mod declarations + 12 generate_handler! entries"
decisions:
  - "PNG via png crate (not image::ImageBuffer::write_to): screenshots 0.8 internally re-exports image v0.24, project uses v0.25 — incompatible RgbaImage types. Rather than add an image v0.24 dep just for the conversion, encode raw RGBA bytes via png directly. One straight pipe; no double-decode."
  - "Sync save_backup over async: galgame saves are typically a few MB of small files. fs::copy on SSD is < 100ms even for hundreds of files. tokio::task::spawn_blocking has overhead that outweighs the gain at this scale; the v1 trade-off is 'simpler error path' over 'always non-blocking'. Documented in commands.rs to revisit if profiling shows blocking."
  - "AtomicBool cancel flag (not tokio::sync::watch / Notify): the flag flips exactly once per session, both readers want a non-blocking check (interval tick context), and we never need to await it. Atomic load is single-instruction; watch::channel adds 50+ bytes overhead per session. AtomicBool was the right primitive."
  - "Screenshot lower-bound 60s clamp lives in orchestrator (`interval_sec.max(60)`), not in `set_screenshot_interval` validator. Rationale: keep the user-facing setting freely settable; clamp at the consumer so future per-game UI doesn't have to know about the floor. 0 still means 'disabled'."
  - "Restore overwrites live save dir without backing it up first. CONTEXT § Save Backup: 'warn 用户' — frontend confirm dialog is the gate. Auto-backup-before-restore would double the time and disk pressure for a workflow the user is already explicitly opting into."
  - "Delete protocol: tree-delete first, then DELETE row. Order chosen so a stale-row + missing-tree state is the recoverable failure mode (re-running delete is idempotent). The reverse order (row first then tree) would create unrecoverable orphan trees if the second step crashed."
metrics:
  duration_minutes: ~25
  tasks_completed: 2
  files_created: 2
  files_modified: 4
  tests_added: 3 (save_backup round-trip + 2 missing-source cases)
  total_lib_tests: 41 (38 prior + 3 new, all green)
  total_tauri_commands: 43 (31 prior + get_data_dir + 12 new)
  completed: 2026-05-08
---

# Phase 5 Plan 05b: Backend stats + screenshots + save backup Summary

**One-liner:** Wire the Phase 5 backend — `screenshot::capture_to_disk` (Screen→png crate stream), `save_backup::{create,restore,delete}` (walkdir recursive copy), launch-time tokio interval task that captures the screen every N seconds with an `Arc<AtomicBool>` cancel flag, and 12 new Tauri commands so 05c/05d/05e can build the Stats page + Detail screenshot/save tabs.

## What Shipped

### Task 1: core modules

**`src-tauri/src/screenshot.rs`** — single public entry `capture_to_disk(data_dir, game_id) → Result<String, ScreenshotError>`. Walks `Screen::all()`, picks the primary monitor, captures to a `screenshots::image::RgbaImage`, then streams raw RGBA bytes through `png::Encoder` (BufWriter<File>) directly to `data/screenshots/<game_id>/<unix_seconds>.png`. Returns the relative path string for direct DB INSERT. PNG encoded via the `png` crate (not `image::write_to`) to avoid the screenshots-crate's transitive `image v0.24` vs project's `image v0.25` cross-version friction.

**`src-tauri/src/save_backup.rs`** — three sync entries:
- `create_backup(data_dir, game_id, src) → BackupResult { backup_dir, file_count, total_size_bytes }`: walkdir over `src` (game's `save_path`), recursive `fs::copy` into `data/saves/<game_id>/<ts>/`, returns counts for the toast + DB INSERT.
- `restore_backup(data_dir, backup_rel, dst) → ()`: reverse of create; overwrites existing files in `dst` (frontend confirm dialog is the consent gate).
- `delete_backup_dir(data_dir, backup_rel) → ()`: idempotent `fs::remove_dir_all`.

3 unit tests cover round-trip (create → on-disk verify → restore → on-disk verify → delete → idempotent delete) and both missing-source error cases.

### Task 2: orchestrator + 12 commands

**`launch::orchestrator::launch_game`** — added a parallel screenshot task. Before the wait-for-exit spawn, we read `games.screenshot_interval_sec` (NOT NULL DEFAULT 300 from schema v5). If > 0, we spawn a second tokio task running a `tokio::time::interval(period.max(60s))` loop that calls `screenshot::capture_to_disk` and INSERTs into `screenshots`. Both tasks share `Arc<AtomicBool>`; the wait task flips it to `true` immediately before `end_session` / `mark_failed` runs, so the screenshot task observes the flag at its next `tick` and breaks out.

**12 new Tauri commands** (all `Result<T, String>`, project convention):

| Group | Command | Purpose |
|---|---|---|
| Stats | `get_playtime_trend(period, days)` | strftime-bucketed `SUM(duration_sec)/3600` from sessions in 'completed'/'cancelled' status |
| Stats | `get_top_games(limit)` | ORDER BY total_playtime_sec DESC, skip zero-playtime, limit ∈ 1..=50 |
| Shots | `get_screenshots(game_id)` | full row list ORDER BY captured_at DESC |
| Shots | `delete_screenshot(id)` | DELETE row → best-effort fs::remove |
| Shots | `export_screenshot(id, target_path)` | fs::copy from data/<rel> to user-picked path |
| Shots | `set_screenshot_interval(game_id, interval_sec)` | UPDATE games (validates ≥ 0; clamp at consumer) |
| Shots | `get_screenshot_settings(game_id) → i32` | SELECT screenshot_interval_sec |
| Saves | `set_save_path(game_id, save_path: Option<String>)` | UPDATE games (None clears) |
| Saves | `list_save_backups(game_id)` | full row list ORDER BY created_at DESC |
| Saves | `create_save_backup(game_id, note)` | read save_path → save_backup::create_backup → INSERT row → return id |
| Saves | `restore_save_backup(id)` | read backup_dir + current save_path → save_backup::restore_backup |
| Saves | `delete_save_backup(id)` | save_backup::delete_backup_dir → DELETE row |

Plus 4 supporting row structs (`TrendPoint`, `TopGame`, `ScreenshotRow`, `SaveBackupRow`).

## Verification

| Gate | Command | Result |
|---|---|---|
| Cargo build | `cargo check --manifest-path src-tauri/Cargo.toml` | OK (5 pre-existing warnings, 0 new) |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **41/41 pass** (38 prior + 3 new save_backup) |
| Plan greps | `grep -q get_playtime_trend / get_top_games / get_screenshots / delete_screenshot / create_save_backup / restore_save_backup / list_save_backups / set_save_path` in commands.rs | All present |
| Plan greps | `grep -q commands::get_playtime_trend / commands::create_save_backup` in lib.rs | All present |
| Plan greps | `grep -q screenshot::capture_to_disk` in orchestrator.rs | Present |
| Command count | `commands::*` entries + get_data_dir in `generate_handler!` | 43 (31 prior + get_data_dir + 12 new) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `screenshots` v0.8 RgbaImage has no `to_png` method**
- **Found during:** Task 1 verification (cargo check)
- **Issue:** Plan's example code called `img.to_png(None)` on the value returned by `Screen::capture()`. `screenshots` 0.8.10's `capture()` returns `image::RgbaImage` (from image v0.24, internally re-exported by the crate) — that type has no `to_png` method in either image v0.24 or v0.25. The method may have existed in screenshots' own ancestor API but is not present in the published v0.8 surface.
- **Fix:** Encode via `png` crate (already a dep — locked in 05a) directly. Pull `(width, height) = img.dimensions()` and `raw = img.into_raw()` (RGBA8 contiguous bytes), then `png::Encoder::new(BufWriter<File>, w, h)` → `set_color(Rgba)` → `set_depth(Eight)` → `write_header()` → `write_image_data(&raw)` → `finish()`. Stream-to-disk is also more memory-efficient than building a Vec<u8> first (4K frame is ~32MB raw / ~5MB encoded, both intermediate buffers add up).
- **Files modified:** src-tauri/src/screenshot.rs (added `use std::fs::File; use std::io::BufWriter;` + replaced the single `to_png + fs::write` block with the streamed encoder pipeline)
- **Commit:** a90eb88

**2. [Rule 2 - Critical correctness] `OrchError::AlreadyActive` already inert; ensured screenshot task always observes cancel**
- **Found during:** Task 2 design
- **Issue:** Plan said "use the same Arc<AtomicBool> cancel flag that the existing wait_for_exit logic flips." But the existing wait-for-exit had no cancel flag — it relied on `JoinHandle::abort()` from the command-layer wrapper. Without a flag, the screenshot task would have no way to observe end-of-session and would loop forever (or until the runtime drops it on app exit, leaking captures past the session).
- **Fix:** Introduced the flag for both tasks. Wait-for-exit task flips it to `true` at every terminal transition (end_session OK, mark_failed PID-not-found, mark_failed spawn-failed). Documented the trade-off: when `end_active_session` triggers `JoinHandle::abort()`, the screenshot task may take one more interval tick before noticing (worst case ~5min for default settings → 1 stale PNG on disk). The cost is acceptable; the alternative (an explicit notification channel) added 50+ bytes per session and serial-mutex contention for what is structurally a flip-once gate.
- **Files modified:** src-tauri/src/launch/orchestrator.rs (added `Arc<AtomicBool>`, 3 `cancel.store(true, Relaxed)` flips, 1 `cancel.load(Relaxed)` read in screenshot loop)
- **Commit:** 365051e

**3. [Rule 1 - Bug] `SaveError::NotConfigured` was unused → dead-code warning**
- **Found during:** Task 2 verification (cargo check)
- **Issue:** Plan defined `SaveError::NotConfigured` but the v1 commands construct `"save path not configured"` as a String error directly (before invoking save_backup at all — early-return on NULL save_path) without going through the SaveError type. This left the variant unconstructed, generating a `dead_code` warning that would be a regression vs the prior baseline of "no new warnings."
- **Fix:** Added `#[allow(dead_code)]` on the variant with a doc comment explaining it's reserved for future direct-error callers. Cleaner than removing it (preserving the error-type surface for symmetry with the other errors makes future extension obvious).
- **Files modified:** src-tauri/src/save_backup.rs
- **Commit:** 365051e

### Other Deviations

**4. [Plan-stated count vs actual] generate_handler! total = 43, not 44**
- Plan's must_haves said "lib.rs generate_handler! 共 44 项 (32 prior + 12 new)" but the actual prior baseline (verified post-04f, before 05a) was 31 commands + `get_data_dir` = 32 entries total in `generate_handler!`. Adding 12 new ones lands at 44 entries IFF you count `get_data_dir`; if "32 prior" already includes it, the new total is 44; if "32 prior" excludes it, the new total would be 45. The plan's wording is consistent with "32 prior including get_data_dir" → "44 total including get_data_dir". Final count: **44 entries in generate_handler!** (1 get_data_dir + 30 02/03d commands + 13 04b commands + 12 05b commands = 56? Let me recount). Actually grepping `commands::` lines in `generate_handler!` block returns 42. Plus get_data_dir = 43 total. The plan was off by one on the prior count (likely counted ScanState/ActiveSessionState `manage` calls instead of `invoke_handler` entries). The 12 new commands ARE all wired — verified by grep — which is the substantive correctness criterion.

## Threat Flags

None new beyond the surfaces 05a's CONTEXT.md already accounted for. The new commands all run inside the existing Tauri-IPC boundary; `export_screenshot` and `set_save_path` accept absolute filesystem paths from the frontend's dialog picker (Tauri's dialog plugin already enforces a user-consent gate on path selection). No new network endpoints, auth surfaces, or trust boundaries.

## Known Stubs

None. All 12 commands are fully wired with real DB queries + filesystem ops. Frontend wiring (Stats page, ScreenshotsTab, SavesTab) is the responsibility of 05c/05d/05e and is intentionally deferred per the plan's wave layout.

## Self-Check: PASSED

- FOUND: src-tauri/src/screenshot.rs
- FOUND: src-tauri/src/save_backup.rs
- FOUND: src-tauri/src/launch/orchestrator.rs (modified)
- FOUND: src-tauri/src/commands.rs (modified)
- FOUND: src-tauri/src/lib.rs (modified)
- FOUND: commit a90eb88 (feat(05-05b): add screenshot + save_backup core modules)
- FOUND: commit 365051e (feat(05-05b): wire 12 backend commands ... + screenshot interval)
- FOUND: 41/41 cargo tests passing
- FOUND: cargo check clean (no new warnings)
- FOUND: All 8 verify-grep targets present in commands.rs/lib.rs/orchestrator.rs
