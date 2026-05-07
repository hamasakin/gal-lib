---
phase: 03-launch-playtime
plan: 03a
subsystem: data-layer
tags: [rust, tauri, sqlite, migration, schema-v3, dependencies]
requires:
  - schema_v2_present
provides:
  - schema_v3_migration
  - rust_crate_winreg_0_52
  - rust_crate_sysinfo_0_32
  - rust_crate_windows_0_58
  - games_le_profile_column
  - games_launch_args_column
  - games_cwd_column
  - sessions_status_column
  - sessions_exit_code_column
affects:
  - src-tauri/Cargo.toml
  - src-tauri/Cargo.lock
  - src-tauri/migrations/0003_add_launch_and_session_status.sql
  - src-tauri/src/db.rs
tech-stack:
  added:
    - "winreg 0.52 — Windows registry read for HKEY_CURRENT_USER\\Software\\LocaleEmulator (LE detection in 03b)"
    - "sysinfo 0.32 — cross-process enumeration for LE-spawned game tracking (03c)"
    - "windows 0.58 (features: Win32_System_Threading, Win32_System_ProcessStatus, Win32_Foundation, Win32_System_Diagnostics_ToolHelp) — OpenProcess + WaitForSingleObject + ToolHelp32 process snapshot for low-overhead exit watcher (03c)"
  patterns:
    - "Migration registry pattern preserved: each schema bump = new file in `src-tauri/migrations/` + new entry in `db::migrations()`; file embedded via include_str! so it ships in the exe"
    - "Idempotent ALTER TABLE ADD COLUMN only (SQLite < 3.35 cannot DROP/RENAME without table-rebuild dance); CHECK constraint inlined directly in ADD COLUMN"
    - "Unit test asserts both column-add count and exact CHECK constraint string to lock the contract that downstream plans (03c session lifecycle) depend on"
key-files:
  created:
    - src-tauri/migrations/0003_add_launch_and_session_status.sql
  modified:
    - src-tauri/Cargo.toml
    - src-tauri/Cargo.lock
    - src-tauri/src/db.rs
decisions:
  - "Use ALTER TABLE ADD COLUMN only (no DROP/RENAME) — fits SQLite limitations and keeps migration cheap on existing user DBs"
  - "Lock session.status CHECK constraint members to exactly ('starting','running','completed','launch_failed','cancelled') — these become the contract for 03c lifecycle transitions"
  - "Default sessions.status = 'completed' so historical rows from schema v1/v2 (where status didn't exist) read sensibly without a backfill"
  - "Default games.le_profile = 'Japanese' aligns with the most common galgame use case; users override per-game in 03f Detail page"
  - "Include winreg + sysinfo + windows-rs in 03a (not 03b/03c) so the cargo-resolve cost (sysinfo + windows compile) is paid once at the foundation step rather than mid-feature"
  - "Test counts non-comment ADD COLUMN lines (not raw substring) to avoid false positives from the SQL header comment that documents 'ADD COLUMN' as the migration mechanism"
metrics:
  tasks_completed: 1
  tasks_total: 1
  duration_minutes: 6
  files_created: 1
  files_modified: 3
  completed: 2026-05-07
---

# Phase 3 Plan 03a: Schema v3 + Rust Crate Lockup Summary

One-shot foundation for Phase 3: bumps SQLite schema to v3 (3 launch-config columns on games + 2 status columns on sessions) and locks the three Windows-specific Rust crates (winreg / sysinfo / windows-rs) that 03b–03e will consume.

## Tasks Executed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Cargo deps + 0003 migration + db.rs registration & test | `a4e6b21` | `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/migrations/0003_add_launch_and_session_status.sql` (new), `src-tauri/src/db.rs` |

## What Was Built

### `src-tauri/Cargo.toml` — Phase 3 dependency block
Appended after the Phase 2 sqlx pin:
- `winreg = "0.52"` — Windows registry reader (used by 03b's LE detector to probe `HKEY_CURRENT_USER\Software\LocaleEmulator`).
- `sysinfo = "0.32"` — cross-platform process enumeration (used by 03c to find the LE-spawned game process by exe basename + cwd matching).
- `windows = { version = "0.58", features = ["Win32_System_Threading", "Win32_System_ProcessStatus", "Win32_Foundation", "Win32_System_Diagnostics_ToolHelp"] }` — `OpenProcess` + `WaitForSingleObject` for the exit watcher loop, plus ToolHelp32 snapshot APIs as a fallback for parent-PID lookups.

The `tray-icon` feature on `tauri` is intentionally NOT added here — that lives in 03e per the plan-outline cross-cutting constraints.

### `src-tauri/migrations/0003_add_launch_and_session_status.sql` (new)
Five `ALTER TABLE ADD COLUMN` statements + one `UPDATE app_meta` row:

```sql
ALTER TABLE games ADD COLUMN le_profile TEXT NOT NULL DEFAULT 'Japanese';
ALTER TABLE games ADD COLUMN launch_args TEXT;
ALTER TABLE games ADD COLUMN cwd TEXT;

ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('starting','running','completed','launch_failed','cancelled'));
ALTER TABLE sessions ADD COLUMN exit_code INTEGER;

UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
```

The `sessions.status` CHECK constraint members are the locked contract for 03c's session lifecycle (starting → running → completed | launch_failed | cancelled).

### `src-tauri/src/db.rs`
- Added `const V3_SQL` via `include_str!` so the new migration ships embedded in the exe.
- Pushed Migration v3 entry into `migrations()` between v2 and the future v4+ slot.
- Added unit test `migrations_v3_adds_launch_columns_and_session_status` that:
  - Asserts exactly 5 non-comment `ADD COLUMN` lines.
  - Asserts the new column names: `le_profile`, `launch_args`, `cwd`, `exit_code`.
  - Asserts the exact `CHECK(status IN (...))` constraint string (so downstream plans cannot silently drift from the locked status set).
  - Asserts `schema_version` is bumped to `'3'`.
- Loosened the v2 test's `assert_eq!(m.len(), 2, ...)` to `assert!(m.len() >= 2, ...)` so the v2 contract test stays green as future migrations are appended.

## Verification

| Check | Result |
|-------|--------|
| `cargo check --manifest-path src-tauri/Cargo.toml` | green (only 3 pre-existing P2 warnings: unused `MetadataDetail` / `MetadataError` import, `IngestResult` dead fields, `MetadataError::RateLimited` variant — all out of scope per Scope Boundary) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 34/34 passing (33 pre-existing + 1 new v3 test) |
| `pnpm tauri dev` smoke (started, polled until migration applied, killed) | `sqlite3 ... "SELECT value FROM app_meta WHERE key='schema_version'"` returned `3` |
| `PRAGMA table_info(games)` post-migration | columns 19/20/21 = `le_profile` (NOT NULL DEFAULT 'Japanese'), `launch_args`, `cwd` |
| `PRAGMA table_info(sessions)` post-migration | columns 5/6 = `status` (NOT NULL DEFAULT 'completed'), `exit_code` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 – Bug] Test assertion counted `ADD COLUMN` substring inside SQL comment**
- **Found during:** Task 1 verification (`cargo test --lib`)
- **Issue:** First version of the unit test did `m3.sql.matches("ADD COLUMN").count()` and asserted `== 5`. Got 6 because the migration's documentation comment (`-- SQLite ALTER TABLE supports only ADD COLUMN ...`) contains the substring "ADD COLUMN" — comments shouldn't count toward the contract.
- **Fix:** Rewrote the count to filter `lines()` and skip those where `trim_start().starts_with("--")` before checking for `ADD COLUMN`. The assertion now reflects the real ALTER count regardless of comment wording.
- **Files modified:** `src-tauri/src/db.rs`
- **Commit:** rolled into `a4e6b21` (single Task-1 commit, before any push)

**2. [Rule 1 – Bug] v2 test's strict `assert_eq!(m.len(), 2, ...)` would have failed once v3 was added**
- **Found during:** Adding v3 entry to `migrations()`
- **Issue:** The pre-existing `migrations_v2_adds_scan_roots_and_columns` test asserted `m.len() == 2`. Adding v3 brings the vec to 3 entries — that test would have flipped red as collateral damage even though v2's actual contract is unchanged.
- **Fix:** Loosened to `assert!(m.len() >= 2, "at least two migrations registered")`. The v2-specific column assertions remain unchanged. The new v3 test owns the `len == 3` exact assertion so the registry-size invariant is still locked in one place.
- **Files modified:** `src-tauri/src/db.rs`
- **Commit:** rolled into `a4e6b21`

### Authentication Gates
None — fully autonomous local Cargo + SQLite work.

### Architectural Decisions Pending
None.

## Authentication / Manual Steps
None — the `pnpm tauri dev` smoke test was fully scripted (start in background → poll sqlite3 until `schema_version='3'` → `taskkill /F /IM gal-lib.exe`).

## Known Stubs
None. This plan only touches schema and dependency declarations — no UI surfaces, no commands, no rendered placeholder data. The new columns sit dormant until 03c–03f wire them.

## Threat Flags
None. New columns are local-DB-only; no new network endpoints, no auth path changes, no file-system trust boundary crossings.

## Downstream Notes for 03b–03f

- **03b** (LE detector): `winreg = "0.52"` already pulled — import as `use winreg::enums::*; use winreg::RegKey;`.
- **03c** (process tracking): `sysinfo = "0.32"` and `windows = "0.58"` already pulled with the four required Win32 features. Use `windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject}` + `WAIT_OBJECT_0` + `WAIT_TIMEOUT` constants from `Win32::Foundation`.
- **03c** (session lifecycle): when writing session rows, the locked `status` enum is exactly `'starting' | 'running' | 'completed' | 'launch_failed' | 'cancelled'` — any string not in this set will be rejected by the CHECK constraint at INSERT time.
- **03d** (commands): when adding new SELECT/UPDATE statements against `games`, remember the three new nullable-or-default columns: `le_profile` (NOT NULL DEFAULT 'Japanese'), `launch_args` (NULL), `cwd` (NULL).
- **03e** (tray): no Cargo changes needed; `tauri-plugin-positioner` was rejected per CONTEXT, use core `tauri::tray::TrayIconBuilder`. Confirm `tray-icon` feature gets added to `tauri = { version = "2", features = [...] }` line in 03e (not in 03a).
- **03f** (frontend): expose the three games-table launch columns through whatever read DTO `commands.rs` returns (probably extend `GameRow` in 03d).

## Self-Check: PASSED

- `src-tauri/migrations/0003_add_launch_and_session_status.sql` — FOUND
- `src-tauri/Cargo.toml` contains `winreg` / `sysinfo` / `windows.*0.58` — FOUND
- `src-tauri/src/db.rs` contains `version: 3` + new test — FOUND
- Commit `a4e6b21` — FOUND in `git log`
- Live SQLite `app.db` reports `schema_version = 3` and shows `le_profile` / `launch_args` / `cwd` / `status` / `exit_code` columns — VERIFIED
