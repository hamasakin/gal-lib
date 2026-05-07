---
phase: 03-launch-playtime
plan: 03d
subsystem: launch
tags: [tauri-commands, orchestrator, sessions, le-path]
dependency-graph:
  requires: [03a, 03b, 03c]
  provides: [orchestrator, tauri-launch-commands, active-session-state, session-events]
  affects: [src-tauri/src/lib.rs, src-tauri/src/commands.rs, src-tauri/src/launch/mod.rs]
tech-stack:
  added: []
  patterns:
    - "tokio::spawn detached task with JoinHandle stored in app state for end-active-session abort"
    - "AbortHandle held in std::sync::Mutex (short-lived locks) — sync mutex okay since command bodies never hold across await"
    - "active-session-changed Tauri event with Option<ActiveSession> payload (null = no session)"
    - "post-task watcher: secondary tokio::spawn awaits the launch JoinHandle then clears state + emits null"
    - "COALESCE-style update_game_launch_config — NULL field = don't change"
key-files:
  created:
    - src-tauri/src/launch/orchestrator.rs
  modified:
    - src-tauri/src/launch/mod.rs
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
decisions:
  - "ActiveSessionState wraps std::sync::Mutex<Option<ActiveSessionEntry>>: short-lived locks during command bodies; never held across await points (lock-then-clone-or-take pattern)"
  - "ActiveSessionEntry holds the AbortHandle (not the JoinHandle) — abort-only API surface is what end_active_session needs; the JoinHandle is consumed by the watcher task"
  - "launch_game spawns a secondary watcher task that .awaits the join then flips state to None + emits null — keeps the active-session lifecycle self-contained without polling"
  - "session-row ID is the single source of truth for end_active_session DB cleanup; we cancel via session_id even if the AbortHandle has already fired"
metrics:
  duration: ~3m
  completed: 2026-05-07
  task-count: 2
  file-count: 4
---

# Phase 3 Plan 03d: Launch Orchestrator + Tauri Commands Summary

End-to-end launch glue + 7 new Tauri commands wiring the launch subsystem (03a-03c) to the frontend, with Active Session state management and `active-session-changed` event emission.

## Tasks Completed

### Task 1: launch/orchestrator.rs end-to-end glue

Added `src-tauri/src/launch/orchestrator.rs` providing:

- `ActiveSession { session_id, game_id, game_name, started_at }` — serializable payload for the `active-session-changed` event.
- `OrchError` — unified error enum (Db / Le / Process / Session / Io / NotFound / NoExecutable / AlreadyActive).
- `LaunchInputs { data_dir, pool, game_id }` — single struct for command-layer call.
- `prepare_launch(&LaunchInputs)` — synchronous prep step: reads name/exe/profile/args/cwd from `games`, resolves LE path. Returns 6-tuple consumed by `launch_game`. Splits out so missing-exe / missing-LE fail BEFORE a `sessions` row is created.
- `launch_game(LaunchInputs) -> (session_id, ActiveSession, JoinHandle<Result<(), OrchError>>)` — orchestrates the full flow:
  1. `prepare_launch` (DB + LE)
  2. `session::start_session` (status='starting')
  3. `process_track::spawn_le` (synchronous; LEProc fork)
  4. tokio::spawn task: `find_game_pid` → `mark_running` → `wait_for_exit` → `end_session`
  5. Failure paths: spawn fail / PID timeout → `mark_failed`; wait error → `end_session(_, -1)`

Module registered via `pub mod orchestrator;` in `launch/mod.rs`.

**Verify:** `cargo check + cargo test --lib` → 36 passed, 0 failed; only pre-existing dead_code warnings (resolved in Task 2).

**Commit:** 585215d

### Task 2: 7 new Tauri commands + lib.rs registration

Appended to `src-tauri/src/commands.rs` (preserved all 11 prior commands):

| Command                       | Kind          | Returns                          | Notes                                                                                  |
| ----------------------------- | ------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `launch_game(game_id)`        | async         | `ActiveSession`                  | Refuses if session active; spawns watcher to clear state + emit null on exit/abort     |
| `get_active_session()`        | sync          | `Option<ActiveSession>`          | Frontend rehydrate after reload                                                        |
| `end_active_session()`        | async         | `()`                             | Aborts wait task + `session::cancel_session` (credits playtime); idempotent            |
| `list_sessions(game_id)`      | async         | `Vec<SessionRow>`                | Newest 100; rename_all="snake_case" matches DB columns                                 |
| `update_game_launch_config`   | async         | `()`                             | COALESCE-style update (None = no change, Some("") = clear)                             |
| `get_le_path()`                | sync          | `Option<String>`                 | Reads `data/config.json::le_path` with stale-path filter (Path::exists check)          |
| `set_le_path(path)`            | sync          | `()`                             | Delegates to `le::set_le_path` (validates exists, returns InvalidPath on miss)         |

**Tauri state additions:**
- `ActiveSessionState(Mutex<Option<ActiveSessionEntry>>)` — registered via `.manage(...)` in `lib.rs::run`.
- `ActiveSessionEntry { session, task: AbortHandle }` — `task` is the JoinHandle's abort handle (NOT the JoinHandle itself; the watcher owns the JoinHandle).
- `ACTIVE_SESSION_EVENT` constant = `"active-session-changed"` — payload `Option<ActiveSession>`.

**lib.rs `generate_handler!` extension:** appended 7 new `commands::*` items after the 11 existing ones (total 18 + `get_data_dir` = 19 handlers registered).

**Verify:** `cargo check + cargo test --lib` → 36 passed, 0 failed.

**Commit:** bcb76cb

## Architecture Notes

### ActiveSession Lifecycle (frontend's view)

```text
User clicks "启动 [game]"
   │
   ├─→ invoke('launch_game', {game_id})
   │       ├─→ orchestrator::launch_game (sync part)
   │       │     • DB read (games row) + LE resolve
   │       │     • session::start_session (status='starting')
   │       │     • process_track::spawn_le (LEProc fork)
   │       │
   │       ├─→ store ActiveSessionEntry in ActiveSessionState
   │       ├─→ emit 'active-session-changed' (Some(ActiveSession))
   │       └─→ tokio::spawn watcher → awaits launch task → clears state + emits null
   │
   ├─→ Frontend listens for 'active-session-changed':
   │     • Some(s) → render top sticky bar (cover + elapsed timer + force-end button)
   │     • None    → hide bar
   │
   ├─→ Game runs (potentially hours; webview can close, watcher persists)
   │
   ├─→ Game exits naturally:
   │     • orchestrator's tokio task: wait_for_exit returns → end_session →
   │       JoinHandle resolves → watcher fires → state None → emit null
   │
   OR User clicks "强制结束":
        • invoke('end_active_session')
        • take() entry from state, abort the AbortHandle, cancel_session in DB
        • watcher observes JoinError::is_cancelled → emit null (harmless duplicate
          since end_active_session also explicitly emits null)
```

### Lock Discipline for ActiveSessionState

`std::sync::Mutex` was chosen deliberately over `tokio::sync::Mutex`. Justification:
- All 4 commands that touch the state hold the lock for ≤ 5 instructions.
- No command holds the lock across an `await` point (verified by inspection):
  - `launch_game`: lock → check is_some → unlock; later: lock → assign → unlock; emit AFTER unlock.
  - `get_active_session`: pure read, no async at all (sync command).
  - `end_active_session`: lock → take → unlock; THEN await DB.
  - Watcher task: lock → assign None → unlock.
- Sync mutex is dramatically simpler (no `await` on lock acquisition) and avoids the
  `Send` bound that tokio::sync::Mutex would impose on the future state.

### Preserving Existing Commands

The plan's hard guardrail was "preserve the existing 11 commands". Verified post-edit:
- `lib.rs::generate_handler!` retains all of `get_data_dir, add_scan_root, remove_scan_root, list_scan_roots, start_scan, cancel_scan, mark_skip_dir, search_metadata, bind_metadata, refresh_metadata, list_games` (count: 11; new commands appended after the comment marker `// 03d — launch + sessions + LE path`).
- `commands.rs` `_retain_manager_import` and ScanState helpers all preserved.

## Frontend Integration Surface (next: 03e/03f)

Tauri commands now available to TypeScript via `invoke()`:

| TS-side helper (to add in `src/lib/launch.ts`) | invoke target               | Argument shape                                                                       | Returns                  |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
| `launchGame(gameId)`                          | `launch_game`               | `{ gameId: number }`                                                                 | `ActiveSession`          |
| `getActiveSession()`                          | `get_active_session`        | `{}`                                                                                 | `ActiveSession \| null`  |
| `endActiveSession()`                          | `end_active_session`        | `{}`                                                                                 | `void`                   |
| `listSessions(gameId)`                        | `list_sessions`             | `{ gameId: number }`                                                                 | `SessionRow[]`           |
| `updateGameLaunchConfig(...)`                 | `update_game_launch_config` | `{ gameId, leProfile?, launchArgs?, cwd?, executablePath? }`                         | `void`                   |
| `getLePath()`                                 | `get_le_path`               | `{}`                                                                                 | `string \| null`         |
| `setLePath(path)`                             | `set_le_path`               | `{ path: string }`                                                                   | `void`                   |

Frontend should subscribe to `active-session-changed` via `listen()` from `@tauri-apps/api/event` for live updates.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Watcher task can't move `State<'_, ActiveSessionState>` into spawn**

- **Found during:** Task 2, writing the `launch_game` watcher.
- **Issue:** `State<'_, T>` is a non-`'static` borrow guard from Tauri; `tokio::spawn` requires the future to be `'static`. We can't move the State guard into the spawned task.
- **Fix:** Capture `app: AppHandle` (which is `'static + Send + Clone`) and look up the state inside the watcher via `app.try_state::<ActiveSessionState>()`. Cleaner than channel-based hand-off and matches Tauri 2.x's published pattern for state-touching detached tasks.
- **Files modified:** `src-tauri/src/commands.rs` (launch_game watcher block)
- **Commit:** bcb76cb

**2. [Rule 2 - Critical functionality] `get_le_path` filters stale paths**

- **Found during:** Task 2.
- **Issue:** Plan said "read config.json le_path" — but if the user manually deletes LE after first detection, the persisted path becomes stale and the Settings UI would mislabel as "configured". Per 03 CONTEXT § Locale Emulator Detection, stale paths must trigger a manual-override prompt.
- **Fix:** Wrap the read in `.filter(|s| Path::new(s).exists())` so callers see `None` for stale entries and can re-detect or prompt the user.
- **Files modified:** `src-tauri/src/commands.rs` (get_le_path body)
- **Commit:** bcb76cb

**3. [Rule 2 - Idempotency] `end_active_session` is no-op when no session active**

- **Found during:** Task 2.
- **Issue:** Plan didn't specify behavior when called twice in a row (UI race: user clicks force-end while watcher is also clearing state). Without idempotency, second call would either panic on missing state or double-cancel the DB row.
- **Fix:** `g.take()` (rather than expect-Some); early-return Ok(()) when None. Matches the watcher's race condition (which also calls `*g = None`).
- **Files modified:** `src-tauri/src/commands.rs` (end_active_session body)
- **Commit:** bcb76cb

## Decisions Made

1. **AbortHandle, not JoinHandle, in state** — The state only needs cancellation; the watcher consumes the JoinHandle to detect natural exit.
2. **Watcher pattern over polling** — A dedicated `tokio::spawn(async { join.await; clear_state(); emit_null(); })` is simpler than a Tauri-side timer that polls the JoinHandle.
3. **Belt-and-braces null emit in `end_active_session`** — Both the abort path and the watcher emit null. Frontend treats duplicate null events as harmless (same as no-op).
4. **`session_id` is the source of truth, not the in-memory state** — `end_active_session` calls `session::cancel_session(session_id)` even if the watcher has already raced to clear state. The DB row determines playtime accounting.
5. **Sync `std::sync::Mutex`** — locks never held across `await`; sync mutex is simpler and avoids `Send` bound on futures.

## Files Created / Modified

**Created:**
- `src-tauri/src/launch/orchestrator.rs` (179 lines)

**Modified:**
- `src-tauri/src/launch/mod.rs` (+1 line, registered orchestrator)
- `src-tauri/src/commands.rs` (+247 lines, 7 commands + ActiveSessionState struct)
- `src-tauri/src/lib.rs` (+9 lines, .manage call + 7 handler entries)

## Verification Results

- ✅ `cargo check`: clean (4 pre-existing warnings, all out-of-scope per Scope Boundary rule)
- ✅ `cargo test --lib`: 36 passed, 0 failed
- ✅ All plan grep checks pass:
  - `pub async fn launch_game` in orchestrator.rs ✓
  - `ActiveSession` in orchestrator.rs ✓
  - `pub mod orchestrator` in mod.rs ✓
  - `launch_game / get_active_session / end_active_session / list_sessions / update_game_launch_config / get_le_path / set_le_path / ActiveSessionState` all present in commands.rs ✓
  - `commands::launch_game / commands::list_sessions` in lib.rs ✓
- ✅ All 11 prior commands preserved in lib.rs handler list

## Self-Check: PASSED

- src-tauri/src/launch/orchestrator.rs — FOUND
- src-tauri/src/launch/mod.rs (orchestrator registered) — FOUND
- src-tauri/src/commands.rs (ActiveSessionState + 7 commands) — FOUND
- src-tauri/src/lib.rs (.manage + handler entries) — FOUND
- Commit 585215d (Task 1) — verified in git log
- Commit bcb76cb (Task 2) — verified in git log
