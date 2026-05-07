---
phase: 04-library-polish
plan: 04b
subsystem: backend-commands
tags: [tauri-commands, sql, search, filter, tag-crud, game-properties]
requires: [phase-04 schema v4 (04a), phase-1 tags + game_tags tables]
provides:
  - tauri-cmd-search-games
  - tauri-cmd-get-sidebar-categories
  - tauri-cmd-tag-crud (list/create/update/delete + set/list game tags)
  - tauri-cmd-game-property-updates (status/favorite/rating/notes/brand-year)
  - shared-helper-row-to-game
  - extended-game-struct (brand + release_year + is_favorite)
affects: [04c, 04d, 04e, 04f]
tech-stack:
  added: []
  patterns:
    - "dynamic SQL builder with sort_by whitelist + bound parameters for filter clauses"
    - "transactional set_game_tags via pool.begin() + tx.commit()"
    - "shared row_to_game helper to avoid drift between list_games and search_games"
    - "Tauri Result<T, String> contract preserved across all 13 new commands"
key-files:
  created: []
  modified:
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
decisions:
  - "sort_by is a hard whitelist (last_played | created_at | name | playtime | rating); unknown values return Err — never interpolated as a string"
  - "filter.status, filter.brand, filter.year_decade are inlined as literal SQL (filter.status whitelisted; filter.year_decade is i32; filter.tag_id is i64) — no injection surface; query LIKE arg is the only bound %?% parameter (4 placeholders for name/name_cn/path/tag.name)"
  - "set_game_tags uses INSERT OR IGNORE (game_tags has composite PK (game_id, tag_id)); DELETE-all-then-INSERT-each within a sqlx transaction"
  - "update_game_brand_year overwrites with NULL when args are None (matches metadata-pipeline 'refresh returned no brand' semantics) — different from update_game_launch_config's COALESCE(?, col) keep-on-None pattern, intentional for re-fetch use case"
  - "is_favorite serialized as bool (Game struct field) but stored as i64 0/1 in DB — i64::try_get → != 0 conversion in row_to_game"
  - "list_games extended with brand+release_year+is_favorite columns instead of leaving frontend to call search_games(query=None) — shared row_to_game keeps both code paths in sync"
metrics:
  duration_minutes: ~4
  completed_at: 2026-05-07T15:28:08Z
  commits: 1
  files_created: 0
  files_modified: 2
  cargo_tests_passed: 37
  commands_added: 13
  total_commands_after_04b: 32
---

# Phase 4 Plan 04b: Backend search/sort/filter + tag CRUD + game property update commands Summary

**One-liner:** Add 13 Tauri commands (search/sort/filter, tag CRUD, per-property game updates) and extend `Game` struct + `list_games` to serialize schema-v4 columns (brand, release_year, is_favorite); commands grow 19 → 32, all 37 lib tests still green.

## Tasks Completed

### Task 1 — implement 13 commands in commands.rs + register in lib.rs (commit `32d6b65`)

All 13 commands wired as `Result<T, String>` per existing pattern. Single commit covers:

**Search & Sort:**
- `search_games(query, sort_by, filter, state)` — dynamic SQL: optional LIKE clause covers `name + name_cn + path + tag.name` (via subquery into `game_tags JOIN tags`); filter clauses for `tag_id / status / favorite / brand / year_decade` ANDed; ORDER BY from `sort_by` whitelist (`last_played | created_at | name | playtime | rating`) with `IS NULL, ... DESC` for NULLS-LAST behavior on `last_played_at` and `rating`.
- `get_sidebar_categories(state)` — 4 SELECTs + 1 scalar: tags w/ count (LEFT JOIN game_tags so 0-count tags still appear), per-status counts, distinct brands w/ count, decade buckets via `(release_year / 10) * 10`, favorite_count.

**Tag CRUD:**
- `list_tags`, `create_tag`, `update_tag`, `delete_tag` (cascade via existing FK), `set_game_tags` (transactional DELETE+INSERT OR IGNORE within `pool.begin()` / `tx.commit()`), `list_game_tags`.

**Game property updates:**
- `update_game_status` (CHECK enum whitelisted client-side too), `update_game_favorite` (bool → i64 0/1), `update_game_rating` (1..=10 or null), `update_game_notes`, `update_game_brand_year` (bind-NULL = SQL NULL, intentional overwrite-with-NULL).

**Game struct extension:**
- Added 3 fields to `Game`: `brand: Option<String>`, `release_year: Option<i64>`, `is_favorite: bool`.
- Extracted `row_to_game(&SqliteRow) -> Result<Game, String>` helper; `list_games` and `search_games` both use it. is_favorite reads via `try_get::<i64, _>` then `!= 0`.

**lib.rs:**
- `generate_handler!` grows by 13 entries appended after the 03d block. Total: 32 commands.

## Plan Verify (Plan 04b `<verify>` block)

| Check                                                              | Status |
|--------------------------------------------------------------------|--------|
| `commands.rs` contains `search_games`                              | ✓      |
| `commands.rs` contains `list_tags`                                 | ✓      |
| `commands.rs` contains `set_game_tags`                             | ✓      |
| `commands.rs` contains `get_sidebar_categories`                    | ✓      |
| `commands.rs` contains `update_game_status`                        | ✓      |
| `commands.rs` contains `update_game_favorite`                      | ✓      |
| `commands.rs` contains `update_game_rating`                        | ✓      |
| `commands.rs` contains `update_game_notes`                         | ✓      |
| `lib.rs` contains `commands::search_games`                         | ✓      |
| `lib.rs` contains `commands::list_tags`                            | ✓      |
| `lib.rs` contains `commands::set_game_tags`                        | ✓      |
| `lib.rs` contains `commands::update_game_favorite`                 | ✓      |
| `cargo check --manifest-path src-tauri/Cargo.toml`                 | ✓      |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (37 pass)  | ✓      |

All other 9 new commands (`create_tag`, `update_tag`, `delete_tag`, `list_game_tags`, `update_game_rating`, `update_game_notes`, `update_game_brand_year`, plus `commands::create_tag`/`update_tag`/`delete_tag`/`list_game_tags`/`update_game_rating`/`update_game_notes`/`update_game_brand_year`/`update_game_status`/`get_sidebar_categories` in lib.rs) verified by direct grep of the file post-commit (see Grep output captured during execution).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing] `list_games` did not serialize new schema-v4 columns**

- **Found during:** Task 1 implementation, while wiring the `Game` struct's new fields (brand / release_year / is_favorite).
- **Issue:** Plan summary noted "list_games (existing) should be UPDATED to also serialize is_favorite + brand + release_year (the Game struct's new fields)" — but the existing `list_games` SQL only selected the original 19 columns. If `Game` had the new fields and `list_games` didn't fill them, every existing call site (Library grid initial render) would silently get default values (0 / None / false), defeating the schema migration.
- **Fix:** Added `brand`, `release_year`, `is_favorite` to the SELECT list in `list_games`; introduced shared `row_to_game(&SqliteRow) -> Result<Game, String>` helper used by both `list_games` and the new `search_games`. Both paths now produce identical `Game` payloads.
- **Files modified:** `src-tauri/src/commands.rs` (already inside the same task; no separate commit).
- **Commit:** Folded into `32d6b65` (the 04b feat commit).

**2. [Rule 2 — Defensive] `update_game_status` whitelists CHECK enum twice**

- **Found during:** Implementation of `update_game_status`.
- **Issue:** Plan said "(CHECK enum: unplayed/playing/cleared/dropped)". The DB CHECK constraint already enforces this and would surface a sqlx generic constraint-failure error to the frontend. That's correct behavior but produces an opaque error string.
- **Fix:** Added a Rust-side match-and-return-Err whitelist before the UPDATE so the frontend gets a clean, predictable error message ("status must be unplayed|playing|cleared|dropped (got '...')") instead of relying on SQLite's CHECK error format. Same defensive whitelist applied to `filter.status` in `search_games`.
- **Files modified:** `src-tauri/src/commands.rs`.
- **Commit:** Folded into `32d6b65`.

**3. [Rule 2 — Defensive] `set_game_tags` uses `INSERT OR IGNORE` not `INSERT`**

- **Found during:** Implementation of `set_game_tags`.
- **Issue:** `game_tags` has a composite PRIMARY KEY `(game_id, tag_id)`. If the `tag_ids: Vec<i64>` arg ever contains duplicates (frontend bug), a plain INSERT would fail mid-transaction with a UNIQUE constraint violation, rolling back the entire tag-set assignment.
- **Fix:** Used `INSERT OR IGNORE` so duplicate tag_ids in the input are silently deduplicated. The "DELETE all + INSERT each" semantic stays correct (after the DELETE, no rows exist, so OR IGNORE only no-ops on intra-input duplicates, never on legitimate reassignments).
- **Files modified:** `src-tauri/src/commands.rs`.
- **Commit:** Folded into `32d6b65`.

## Authentication Gates

None.

## Tech Stack Additions

None — purely additive Rust code, no new dependencies.

## Schema Touch (read-only / write-only summary)

**Read-only:**
- `tags` (id, name, color) — list_tags, list_game_tags via JOIN, get_sidebar_categories
- `game_tags` (game_id, tag_id) — get_sidebar_categories LEFT JOIN, search_games subquery
- `games.*` — search_games, list_games (extended)

**Write paths:**
- `tags` — create_tag (INSERT), update_tag (UPDATE), delete_tag (DELETE; cascades into game_tags via FK)
- `game_tags` — set_game_tags (DELETE-WHERE + INSERT OR IGNORE within transaction)
- `games` — update_game_status (status), update_game_favorite (is_favorite), update_game_rating (rating), update_game_notes (notes), update_game_brand_year (brand + release_year). All five also bump `updated_at = datetime('now')`.

No new migrations. No CHECK / UNIQUE / FK changes.

## Decisions Made

1. **Whitelist over interpolation for sort_by + filter.status** — both are user-facing string inputs reaching SQL; whitelisted matches return clean Err strings instead of letting SQL fail with generic constraint errors.
2. **Shared `row_to_game` helper** — `list_games` and `search_games` produce byte-identical `Game` payloads; future column additions touch one helper, not two SELECTs.
3. **`update_game_brand_year` overwrite-with-NULL semantics** — different from `update_game_launch_config`'s COALESCE-keep-on-None pattern. The metadata refresh pipeline needs to be able to *clear* brand/year when a re-fetch returns nothing matched.
4. **`set_game_tags` transactional + INSERT OR IGNORE** — atomicity guarantees the DELETE+INSERT pair never leaves the game with a partial tag set; OR IGNORE makes the operation tolerant of accidental input duplicates.
5. **`is_favorite` exposed as bool to JS** but stored as i64 0/1 — Tauri/serde renders Rust bool as JSON true/false, which the frontend needs; the i64 storage is mandated by the schema-v4 migration's `INTEGER NOT NULL DEFAULT 0`.

## Known Stubs

None — all 13 commands have functional implementations against the live schema; nothing returns hardcoded empty/mock data.

## Threat Flags

None — no new network endpoints, no auth surface change, no file-access pattern. Search query is parameterized via sqlx `.bind()` (4 LIKE placeholders); filter integers (tag_id, year_decade) are i64/i32 literals interpolated only after type coercion through the Rust deserializer; filter.status is whitelisted before SQL emission.

## Deferred Items

None added by 04b. Pre-existing `D-04a-1` (vite/postcss @import order warning) still in `deferred-items.md`.

## Self-Check: PASSED

Verified:
- `src-tauri/src/commands.rs` modified — FOUND (13 new `pub async fn` definitions at lines 902–1413, plus `Tag`, `SearchFilter`, `SidebarCategories`, `TagWithCount`, `StatusCount`, `BrandCount`, `DecadeCount` structs)
- `src-tauri/src/lib.rs` modified — FOUND (13 new `commands::*` entries at lines 148–160 inside `generate_handler!`)
- `Game` struct gained `brand`, `release_year`, `is_favorite` fields — FOUND
- `list_games` SQL extended to select the 3 new columns — FOUND
- `row_to_game` shared helper — FOUND (used by `list_games` and `search_games`)
- Commit `32d6b65` (feat 04-04b backend commands) — FOUND in `git log`
- `cargo check` clean (4 pre-existing dead-code warnings unrelated to this plan) — verified
- `cargo test --lib` 37 / 37 passed — verified
