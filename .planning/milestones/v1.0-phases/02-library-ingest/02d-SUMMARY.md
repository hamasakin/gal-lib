---
phase: 02-library-ingest
plan: 02d
subsystem: ingest-pipeline
tags: [cover-cache, ingest-orchestrator, tauri-commands, plugin-registration]
requires: [02a, 02b, 02c]
provides:
  - cover_cache_module
  - ingest_orchestrator
  - tauri_commands_phase2
  - tauri_plugin_dialog_registered
  - tauri_plugin_http_registered
affects:
  - src-tauri/src/cover_cache.rs
  - src-tauri/src/ingest.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src-tauri/Cargo.toml
tech-stack:
  added: []
  patterns:
    - relative-cover-path-persistence (covers/{game_id}.{ext})
    - bangumi-then-vndb-fallback (≥80 confidence threshold)
    - tokio-spawn-scan-with-emit-callback
    - sqlx-pool-in-app-state (stash Arc<SqlitePool> in AppPaths)
key-files:
  created:
    - src-tauri/src/cover_cache.rs
    - (Task 2) src-tauri/src/ingest.rs
    - (Task 3) src-tauri/src/commands.rs
  modified:
    - src-tauri/src/lib.rs
    - src-tauri/Cargo.toml
decisions:
  - "cover_cache returns RELATIVE path covers/{game_id}.{ext}; absolute resolution at render via existing get_data_dir command"
  - "Cover URL gate: only http(s); file:// rejected to avoid local-FS exfiltration via crafted metadata"
  - "Content-Type → extension mapping is case-insensitive substring match (jpeg/png/webp); other types rejected"
metrics:
  start: 2026-05-07
  completed: TBD (incremental)
---

# Phase 2 Plan 02d: Cover Cache + Ingest Orchestrator + 9 Tauri Commands Summary

**One-liner:** TBD — written incrementally; full one-liner appended after Task 3 lands.

## Tasks Completed

### Task 1: cover_cache.rs (commit `49fb52d`)

- **`src-tauri/src/cover_cache.rs`** (NEW) — `pub async fn cache_cover(data_dir: &Path, game_id: i64, url: &str) -> Result<PathBuf, CacheError>`:
  - Validates URL scheme (`http://` / `https://` only — rejects `file://` etc.)
  - Builds `reqwest::Client` with custom UA `gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)` (Bangumi cover hosts also gate on UA) + 30s timeout
  - Sends GET; `error_for_status()` propagates 4xx/5xx as `CacheError::Http`
  - Maps `Content-Type` (case-insensitive substring) → extension: `image/jpeg|jpg` → `jpg`, `image/png` → `png`, `image/webp` → `webp`; other types → `CacheError::UnsupportedType`
  - Creates `data_dir/covers/` if missing; writes bytes verbatim to `covers/{game_id}.{ext}`
  - **Returns relative path** `covers/{game_id}.{ext}` so 02d's ingest can write directly into `games.cover_path` (frontend resolves via existing `get_data_dir` command)
- **`CacheError` thiserror enum** — `Http(#[from] reqwest::Error)` / `Io(#[from] std::io::Error)` / `InvalidUrl(String)` / `UnsupportedType(String)`
- **`src-tauri/src/lib.rs`** — added `mod cover_cache;` (alphabetical placement: cover_cache / data_dir / db / metadata / scan / title_clean) so `cargo check` passes ahead of Task 3's full lib.rs rewrite. Mirrors 02c's pattern of registering modules incrementally to satisfy Rust's crate-level module system.
- **2 unit tests passing:**
  - `rejects_non_http_url` — `cache_cover(_, 1, "file:///etc/passwd")` returns `Err(CacheError::InvalidUrl(_))`
  - `module_compiles` — presence assertion for the public surface
- **Verification:**
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 (51 expected dead-code warnings — fns awaiting Task 2/3/02e/02f callers)
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib cover_cache` → 2/2 passed

### Task 2: ingest.rs orchestrator (commit `5ce0a12`)

- **`src-tauri/src/ingest.rs`** (NEW) — `pub async fn process_game(game_id_for_cover: i64, data_dir: &Path, discovered: &DiscoveredGame) -> IngestResult`:
  1. Default `name = clean_name` (or `raw_name` if blank — preserves disk truth for pathological titles)
  2. Bangumi search via `metadata::bangumi::search(&clean_name)`; pick max-confidence hit; if `>= 80` → auto-bind
  3. Else VNDB fallback `metadata::vndb::search(&clean_name)`; same threshold
  4. If chosen, write `cover_url` + `bangumi_id|vndb_id` + `metadata_source` + `match_confidence`; best-effort `cover_cache::cache_cover`; failure leaves `cover_path` NULL (UI shows placeholder)
  5. Return `IngestResult` — caller does the SQL `UPDATE games SET ...`
- **`IngestResult` struct** — fields named 1:1 to `games` row columns: `games_path`, `name`, `name_cn`, `executable_path`, `cover_path`, `cover_url`, `bangumi_id`, `vndb_id`, `metadata_source` (string `"bangumi"|"vndb"|"none"|"manual"`), `match_confidence` (`Option<u8>`)
- **`AUTO_BIND_THRESHOLD = 80`** — locked in 02-CONTEXT § Metadata Match Pipeline
- **`refresh_for_query()` helper** — command-layer one-liner to refresh an already-bound game (synthesizes a `DiscoveredGame` from `games_path` + a query string, then calls `process_game`)
- **Defensive empty-query guard** — empty `clean_name` skips metadata search entirely (avoids Bangumi 4xx on blank query); raw_name preserved as fallback display
- **2 unit tests passing:**
  - `empty_clean_name_skips_search` — empty `clean_name` → `metadata_source = "none"`, `name = raw_name`, no bangumi/vndb id, no cover_path
  - `module_compiles` — public surface assertion (live API tests deferred to dev smoke)
- **Verification:**
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 (55 expected dead-code warnings — Task 3 callers pending)
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **33/33 passed** (4 既有 + 6 title_clean + 6 metadata + 13 scan + 2 cover_cache + 2 ingest)

### Task 3: commands.rs (9 commands) + lib.rs full rewrite (commit pending — single atomic commit per protocol)

- **`src-tauri/src/commands.rs`** (NEW) — 9 `#[tauri::command]` async functions, each `Result<T, String>` (Tauri error contract):
  1. `add_scan_root(path, depth, state)` → `i64` — gates `depth ∈ [1,3]`, `INSERT INTO scan_roots`, returns `last_insert_rowid`
  2. `remove_scan_root(id, state)` → `()` — `DELETE FROM scan_roots WHERE id=?`
  3. `list_scan_roots(state)` → `Vec<ScanRoot>` — `SELECT id, path, depth, created_at FROM scan_roots ORDER BY id ASC`
  4. `start_scan(mode, app, state, scan_state)` → `()` — gates `mode ∈ {"full","incremental"}`; reads scan_roots from DB; reads `existing_paths` set if incremental; **spawns** `tokio::spawn` task that runs `scan::run_scan(...)` with closure emitting `app.emit("scan-progress", payload)`; per `DiscoveredGame`: UPSERT `games` row → `ingest::process_game` → UPDATE row with `IngestResult` fields + `last_scanned_at = datetime('now')`. Returns immediately (non-blocking).
  5. `cancel_scan(scan_state)` → `()` — flips `Arc<AtomicBool>` cancel flag in current `ScanContext`
  6. `mark_skip_dir(path, scan_state)` → `()` — adds path to `Arc<Mutex<HashSet<PathBuf>>>` skip set in current `ScanContext`
  7. `search_metadata(query, source)` → `Vec<Candidate>` — dispatches to `bangumi::search` or `vndb::search`
  8. `bind_metadata(game_id, source, source_id, state)` → `()` — `fetch_detail` → cache cover (best-effort) → UPDATE games with `match_confidence = 100` (manual bind = full confidence)
  9. `refresh_metadata(game_id, state)` → `()` — SELECT current `name` + `executable_path` → `ingest::refresh_for_query` → UPDATE games preserving cover_path/cover_url via `COALESCE` if refresh has no new value
- **`commands::ScanState` struct** — `Mutex<Option<Arc<scan::ScanContext>>>`; `start_scan` REPLACES the inner ctx (fresh cancel flag per scan); `cancel_scan` / `mark_skip_dir` no-op when `None`
- **`commands::ScanRoot` struct** — Serialize/Deserialize for the `list_scan_roots` JSON return
- **`src-tauri/Cargo.toml`** — added explicit `sqlx = "0.8"` dependency (`sqlite + runtime-tokio + macros`); commands need direct sqlx access and Rust forbids referencing transitive deps. Pinned to 0.8 to share the single sqlx crate `tauri-plugin-sql 2.4.0` already pulls in (verified by `cargo tree -i sqlx` → single 0.8.6 version).
- **`src-tauri/src/lib.rs`** — full rewrite per plan:
  - `mod commands;` + `mod cover_cache;` + `mod ingest;` (alongside data_dir/db/metadata/scan/title_clean — all alphabetical)
  - `AppPaths` extended: `pool: tokio::sync::OnceCell<Arc<SqlitePool>>` (lazy, runtime-aware initialization — see deviation #1)
  - `AppPaths::pool(&self)` async helper — `get_or_try_init` builds `SqlitePoolOptions::new().max_connections(5).connect_lazy(&db_url)` on first call, returns cached `Arc` thereafter
  - **3 plugin registrations** (in plan-mandated order): `tauri_plugin_sql` (with migrations) → `tauri_plugin_dialog::init()` → `tauri_plugin_http::init()`
  - `.manage(AppPaths { ..., pool: OnceCell::new() })` + `.manage(commands::ScanState::new())`
  - `tauri::generate_handler!` registers **10** commands: `get_data_dir` (Phase 1) + 9 new + comment placeholder `// 02f appends list_games here`
- **Verification:**
  - `cargo check` → exit 0 (3 expected warnings: unused `MetadataDetail`/`MetadataError` re-exports, unused `IngestResult.games_path/executable_path` fields, unused `MetadataError::RateLimited` variant — all consumed by 02e/02f frontend or kept for completeness)
  - `cargo test --lib` → **33/33 passed** (no regressions)
  - `cargo build --bin gal-lib` → exit 0 (`gal-lib.exe` linked successfully)
  - **Dev smoke** (`pnpm tauri dev`):
    - First attempt: `connect_lazy` panic at startup — `this functionality requires a Tokio context` (see deviation #1)
    - After OnceCell rework: gal-lib.exe (PID 28968) launched cleanly; `[gal-lib] portable data_dir = ...` + `[gal-lib] sqlite url = ...` printed; no panic; process taskkilled after 30s
    - `sqlite3 .../app.db "SELECT value FROM app_meta WHERE key='schema_version'"` → `2` (Phase 2 schema persisted across restarts)
    - `SELECT count(*) FROM scan_roots` → `0` (clean state ready for first invoke)
  - **NOT verified by automation** (no headless webview in this run): the actual `await __TAURI__.core.invoke('add_scan_root', ...)` call in browser devtools — see Manual smoke procedure below.

## Manual Smoke Procedure (post-handoff)

Per orchestrator's "best-effort, document if dev tools won't open" guidance, here's the exact procedure for a developer to validate end-to-end invoke flow:

1. `pnpm tauri dev`
2. Wait for the gal-lib window to appear
3. Right-click → Inspect → DevTools Console
4. Paste:
   ```js
   const id = await window.__TAURI__.core.invoke('add_scan_root', { path: 'D:\\Games', depth: 1 });
   console.log('new root id:', id);
   const roots = await window.__TAURI__.core.invoke('list_scan_roots');
   console.log('roots:', roots);
   ```
5. Expected: `id` is a positive integer; `roots` contains one `{ id, path: "D:\\Games", depth: 1, created_at: "..." }` row

If any error appears, document arg-shape mismatch (camelCase vs snake_case) — Tauri 2.x defaults to snake_case for command arg names, matching our function signatures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] sqlx 0.8 `connect_lazy` requires Tokio context — moved pool init from `Builder::default()` body to `OnceCell` lazy init**

- **Found during:** Task 3 dev smoke
- **Issue:** Plan suggested "stash an Arc<SqlitePool> in AppPaths during setup hook (cleaner)". First implementation built the pool inline before `tauri::Builder::default()`, then moved it into `setup` closure. Both approaches panicked at startup with `this functionality requires a Tokio context (sqlx-core/src/pool/inner.rs:529)` — sqlx 0.8 `connect_lazy` performs a `tokio::spawn` for an internal connection task, which fails outside a Tokio runtime. Tauri 2.x's `Builder::default()` and its `.setup()` hook both run synchronously on the main thread, before any async runtime is established for the call site.
- **Fix:** Switched `AppPaths.pool` to `tokio::sync::OnceCell<Arc<SqlitePool>>` + added `AppPaths::pool(&self) -> Result<Arc<SqlitePool>, sqlx::Error>` async helper using `get_or_try_init`. The first command that actually queries the DB (i.e. inside Tauri's async command runtime, where Tokio context is guaranteed) builds the pool; subsequent commands clone the cached `Arc`. Net: same single-pool semantics, but initialization is deferred from build-time to first-query-time. Trade-off: each command async call pays one `OnceCell::get_or_try_init` lookup (atomic load), negligible vs the await on the actual SQL.
- **Files modified:** `src-tauri/src/lib.rs` (AppPaths struct + pool() helper), `src-tauri/src/commands.rs` (replaced `state.pool.clone()` → `state.pool().await.map_err(err_str)?` in all 7 DB-touching commands)

**2. [Rule 2 - Critical functionality] Explicit sqlx dependency in Cargo.toml**

- **Found during:** Task 3 implementation
- **Issue:** Plan assumed sqlx is "already a transitive dep of tauri-plugin-sql" — true, but Rust's strict crate-level visibility forbids referencing transitive deps via `use sqlx::...`. Without an explicit `sqlx = "0.8"` declaration in our Cargo.toml, `commands.rs` would fail to compile.
- **Fix:** Added `sqlx = { version = "0.8", default-features = false, features = ["sqlite", "runtime-tokio", "macros"] }` to `[dependencies]`. Verified via `cargo tree -i sqlx` that the workspace still resolves to a **single** sqlx 0.8.6 (matching the version pulled by tauri-plugin-sql 2.4.0). Features mirror what tauri-plugin-sql enables, so no extra compiled artifact.

**3. [Rule 2 - Critical functionality] UPSERT in `start_scan` ingest loop**

- **Found during:** Task 3 implementation
- **Issue:** Plan said "for each DiscoveredGame, INSERT INTO games (path, name, executable_path) RETURNING id". But for incremental scans where a game's directory was previously scanned (still in `existing_paths` filter), the row already exists with `path UNIQUE` constraint — a plain INSERT would fail with `UNIQUE constraint failed: games.path`.
- **Fix:** Used `INSERT ... ON CONFLICT(path) DO UPDATE SET name=excluded.name, executable_path=excluded.executable_path`. After UPSERT, `last_insert_rowid()` returns 0 on the UPDATE branch, so we fall through to a `SELECT id FROM games WHERE path = ?` to recover the rowid. This makes the start_scan path safe for re-scanning the same root in `mode="full"` (e.g. user manually wipes metadata and wants to re-fetch).
- **Files modified:** `src-tauri/src/commands.rs` (start_scan tokio::spawn body)

**4. [Rule 2 - Critical functionality] `bind_metadata` and `refresh_metadata` use `COALESCE(?, existing_col)` to preserve old values**

- **Found during:** Task 3 implementation
- **Issue:** If a metadata refresh fails to fetch a new cover or returns NULL fields, plain UPDATE would WIPE the previous good cover_path / cover_url / bangumi_id / vndb_id — destructive. Plan didn't specify the SQL but the natural `UPDATE games SET cover_path = ?` would silently destroy data.
- **Fix:** Both `bind_metadata` and `refresh_metadata` UPDATE clauses use `COALESCE(?, cover_path)` / `COALESCE(?, cover_url)` / `COALESCE(?, bangumi_id)` / `COALESCE(?, vndb_id)` to preserve previous values when the bound parameter is NULL. Authoritative source-of-truth fields (`name`, `name_cn`, `metadata_source`, `match_confidence`, `last_scanned_at`) are always overwritten — those are the explicit user-action signals.

**5. [Rule 2 - Critical functionality] depth gate in `add_scan_root`**

- **Found during:** Task 3 implementation
- **Issue:** schema-v2 migration enforces `CHECK(depth IN (1,2,3))`. A frontend bug or hand-crafted invoke could pass `depth=0` or `depth=4`, which would be rejected by SQLite with a generic constraint error, surfacing as an opaque `error: 19` to the user.
- **Fix:** Pre-flight `if !(1..=3).contains(&depth) { return Err(format!("depth must be 1..=3 (got {})", depth)); }` — gives the caller a precise message before hitting the DB.

**6. [Rule 1 - Bug] mod registration order constraint violation**

- **Found during:** Task 1 (cover_cache) and Task 2 (ingest)
- **Issue:** Plan put the `mod cover_cache;` / `mod ingest;` declarations under Task 3 (full lib.rs rewrite), but tasks 1 and 2 each include `cargo check` in their `<verify>` blocks — without the mod declaration, Rust returns "file not found for module" and the verify step fails. This is the same Rust crate-level module system constraint 02c hit (deviation #1 in 02c-SUMMARY).
- **Fix:** Added `mod cover_cache;` to lib.rs in Task 1 commit (`49fb52d`) and `mod ingest;` in Task 2 commit (`5ce0a12`), placing both alphabetically. Task 3's full lib.rs rewrite preserves both. Net: lib.rs gets touched in all three commits but never with conflicting changes — pure additive.

### Auth Gates

无（Phase 2 commands are all unauthenticated DB / FS / public-API operations).

### Deferred Issues

无 — all auto-fixes applied within scope.

### Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: file-write-by-untrusted-input | src/cover_cache.rs | `cache_cover` writes to `data_dir.join("covers").join(format!("{game_id}.{ext}"))` where `game_id` comes from SQLite ROWID (safe) and `ext` is one of {jpg, png, webp} (whitelisted). URL is gated to http(s) at the top, so file:// + javascript: + data: are rejected. Bytes are written verbatim (no transcoding) — a malicious JPEG cannot escape the covers dir, but the file content is attacker-controlled. Frontend treats covers as `<img src>` only (no eval); browser sniffing on jpg/png/webp is well-tested. **Mitigation already in place**, flagging for Phase 5 review when screenshot/save support is added (broader file-write surface). |
| threat_flag: shell-injection-via-path | src/commands.rs (start_scan) | `roots` from `scan_roots` table flow into walkdir which uses safe Rust path traversal — no shell exec. **Not a current threat**, but flagging as a reminder for Phase 3 (Locale Emulator launch) which WILL exec child processes; the LE launcher must use `Command::new` with arg-list, never string-concat into a shell. |

## Self-Check

### Files

- [x] `src-tauri/src/cover_cache.rs` exists; contains `pub async fn cache_cover` ✓
- [x] `src-tauri/src/ingest.rs` exists; contains `pub async fn process_game` ✓
- [x] `src-tauri/src/commands.rs` exists; contains `tauri::command` (9 occurrences) ✓
- [x] `src-tauri/src/lib.rs` updated; contains `tauri_plugin_dialog::init()` + `tauri_plugin_http::init()` + 9 command registrations + `// 02f appends list_games here` placeholder ✓
- [x] `src-tauri/Cargo.toml` updated; contains explicit `sqlx = "0.8"` dependency ✓

### Build / Test

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 ✓ (3 expected warnings)
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **33/33 passed** ✓
  - 4 既有 (data_dir × 2 + db v1/v2)
  - 6 title_clean
  - 5 metadata::match_score + 1 metadata::bangumi
  - 4 scan::exe_score + 5 scan::walker + 4 scan::tests
  - **2 cover_cache** (NEW: rejects_non_http_url, module_compiles)
  - **2 ingest** (NEW: empty_clean_name_skips_search, module_compiles)
- [x] `cargo build --bin gal-lib` → exit 0 (`gal-lib.exe` produced) ✓
- [x] `pnpm tauri dev` smoke → process started cleanly (PID 28968), schema_version=2 persisted, no panic ✓
- [ ] Frontend `invoke('add_scan_root', ...)` round-trip — **deferred to manual procedure** (no headless webview in this CI; documented above)

### Commits

- [x] `49fb52d` feat(02-02d): add cover_cache module ✓
- [x] `5ce0a12` feat(02-02d): add ingest orchestrator (bangumi -> vndb fallback -> cover) ✓
- [x] (Task 3 — pending commit) feat(02-02d): wire 9 tauri commands + register plugins in lib.rs

## Self-Check: PASSED
