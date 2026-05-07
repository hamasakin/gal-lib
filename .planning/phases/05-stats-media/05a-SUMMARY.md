---
phase: 05-stats-media
plan: 05a
subsystem: db-schema + deps-lockup
tags: [schema, migration, sqlite, rust-crates, npm]
requires: []
provides:
  - "schema v5 (screenshots + save_backups tables; games +2 cols)"
  - "Rust crates screenshots = 0.8 + png = 0.17"
  - "npm recharts (locked ^2.12 → 2.15.4)"
affects: [src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/src/db.rs, package.json, pnpm-lock.yaml]
tech-stack:
  added:
    - "Rust crate `screenshots` v0.8.10 (cross-platform desktop capture; Windows DXGI/GDI fallback) — for 05b SHOT-01"
    - "Rust crate `png` v0.17 (pure-Rust PNG encoder; no libpng) — for 05b SHOT-01 frame encode"
    - "npm `recharts` v2.15.4 (locked ^2.12 per plan must_haves) — for 05d STATS-01/02 charts"
  patterns:
    - "Migration registry append (db.rs): new const V{N}_SQL include_str! + push Migration{ version=N, ... } + add unit test asserting SQL contents"
    - "SQLite schema bump idempotency: every migration ends with `UPDATE app_meta SET value = '{N}' WHERE key = 'schema_version';`"
    - "FK ON DELETE CASCADE on game_id columns of all per-game child tables (sessions/game_tags/screenshots/save_backups) — fan-out delete on game removal"
key-files:
  created:
    - "src-tauri/migrations/0005_add_screenshots_and_saves.sql (33 lines) — schema v5 diff: 2 ADD COLUMN, 2 CREATE TABLE, 2 CREATE INDEX, schema_version → 5"
  modified:
    - "src-tauri/Cargo.toml — append `screenshots = 0.8` + `png = 0.17` under [dependencies]"
    - "src-tauri/src/db.rs — V5_SQL include_str!, migrations() vec push v5, add `migrations_v5_adds_screenshots_and_saves` unit test, relax v4 length assertion (==4 → >=4)"
    - "package.json — `recharts: ^2.15.4` under dependencies (resolved from ^2.12 spec)"
    - "src-tauri/Cargo.lock + pnpm-lock.yaml — auto-updated"
decisions:
  - "recharts version: pnpm initially resolved to 3.8.1; explicitly pinned to ^2.12 per plan must_haves (final: 2.15.4). Rationale: respect plan's declared lockup spec."
  - "FK strategy: chose ON DELETE CASCADE (not RESTRICT) on screenshots.game_id and save_backups.game_id — matches existing sessions/game_tags pattern; deleting a game deterministically cleans child rows in one statement."
  - "Default screenshot_interval_sec = 300 (5 min): conservative middle ground between disk pressure and capture frequency. Per-game override possible via the new column. (Default chosen at schema layer; user override UI lands in 05e.)"
metrics:
  duration_minutes: ~10
  tasks_completed: 1
  files_created: 1
  files_modified: 5
  tests_added: 1 (migrations_v5_adds_screenshots_and_saves)
  total_lib_tests: 38 (37 prior + 1 new, all green)
  completed: 2026-05-08
---

# Phase 5 Plan 05a: Schema v5 + crates + recharts Summary

**One-liner:** Land Phase 5 lockup — SQLite schema v5 (2 game columns + screenshots/save_backups tables w/ CASCADE FK), Rust capture/encode crates (screenshots 0.8, png 0.17), and recharts 2.15.4 — so 05b/05d/05e can implement stats, screenshot capture, and save backups without further dep churn.

## What Shipped

1. **Migration 0005 (schema v5).** Adds `screenshot_interval_sec INTEGER NOT NULL DEFAULT 300` and `save_path TEXT` to `games`. Creates `screenshots` (game_id FK CASCADE, path, captured_at) + `save_backups` (game_id FK CASCADE, backup_dir, file_count, total_size_bytes, created_at, note) with `idx_screenshots_game_id` + `idx_save_backups_game_id`. Bumps `app_meta.schema_version` from `'4'` to `'5'`.

2. **db.rs registry append.** Added `V5_SQL` const + `Migration { version: 5, description: "add_screenshots_and_saves", ... }` push. New unit test `migrations_v5_adds_screenshots_and_saves` asserts 2 ADD COLUMN, both CREATE TABLE statements, both CREATE INDEX statements, both ON DELETE CASCADE clauses (skipping comment lines), and the schema_version bump. Also relaxed the v4 test's `assert_eq!(m.len(), 4)` to `assert!(m.len() >= 4)` so adding v5 doesn't break it.

3. **Cargo deps.** Appended `screenshots = "0.8"` (resolved 0.8.10) and `png = "0.17"` to `src-tauri/Cargo.toml [dependencies]`. Build + clippy clean (only pre-existing warnings unrelated to 05a).

4. **npm dep.** `pnpm add recharts@^2.12` — resolved to `2.15.4`. (First `pnpm add recharts` without spec pulled 3.8.1; re-ran with explicit `^2.12` to honor plan's must_haves spec.)

## Verification

| Gate | Command | Result |
|---|---|---|
| Cargo build | `cargo check --manifest-path src-tauri/Cargo.toml` | OK (4 pre-existing warnings, 0 new) |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **38/38 pass** (37 prior + 1 new v5) |
| TS typecheck | `pnpm typecheck` | OK |
| Smoke (tauri dev) | Polled `app.db` `schema_version` until `=5` | **schema_version=5** ✅ |
| Schema sanity | `sqlite3 app.db ".schema screenshots"` + `".schema save_backups"` | Tables + indexes present, FK CASCADE wired |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unit test `ON DELETE CASCADE` count off-by-one**
- **Found during:** Task 1 verification (cargo test)
- **Issue:** First version of `migrations_v5_adds_screenshots_and_saves` used naive `m5.sql.matches("ON DELETE CASCADE").count() == 2`. The migration's header doc-comment also names the clause, yielding 3 matches and a test fail.
- **Fix:** Filter to non-comment lines (mirroring the v3/v4 ADD COLUMN counter pattern in this same file), then assert ==2.
- **Files modified:** src-tauri/src/db.rs (test only)
- **Commit:** af7b91a

**2. [Rule 1 - Bug] Schema-version assertion didn't match SQL formatting**
- **Found during:** Task 1 verification (cargo test, second iteration)
- **Issue:** Initial assertion was `m5.sql.contains("schema_version = '5'")` — but the SQL is `UPDATE app_meta SET value = '5' WHERE key = 'schema_version';` so `schema_version` and `'5'` aren't adjacent.
- **Fix:** Match v4's pattern: `m5.sql.contains("schema_version") && m5.sql.contains("'5'")`.
- **Files modified:** src-tauri/src/db.rs (test only)
- **Commit:** af7b91a

**3. [Rule 3 - Blocking] v4 test length assertion blocked v5 registration**
- **Found during:** Task 1 (when adding v5 to the migrations vec)
- **Issue:** v4's pre-existing test had `assert_eq!(m.len(), 4, "v4: exactly four migrations registered")`. Adding v5 made `m.len() == 5`, failing the v4 test.
- **Fix:** Relaxed to `assert!(m.len() >= 4, "at least four migrations registered")` — matches v1/v2/v3 test style. Doesn't weaken v4's actual schema assertions.
- **Files modified:** src-tauri/src/db.rs (test only)
- **Commit:** af7b91a

### Other Deviations

**4. [recharts version reconciliation]** First `pnpm add recharts` (no spec) installed 3.8.1; plan's `must_haves` requires `^2.12`. Re-ran with explicit `^2.12` → got 2.15.4. Documented as a Decision (not a "fix" per se — plan honored).

## Threat Flags

None. This plan only adds local SQLite schema + dependency entries; no new network endpoints, auth paths, or trust boundaries are introduced. The 05b plan that consumes these crates (screenshot capture, save-file copy) will be the threat-relevant surface.

## Known Stubs

None. 05a is pure infrastructure — no UI rendering paths or data flows touched.

## Self-Check: PASSED

- FOUND: src-tauri/migrations/0005_add_screenshots_and_saves.sql
- FOUND: commit af7b91a (chore(05-05a): schema v5...)
- FOUND: schema_version=5 in src-tauri/target/debug/data/app.db
- FOUND: 38/38 cargo tests passing
- FOUND: pnpm typecheck clean
