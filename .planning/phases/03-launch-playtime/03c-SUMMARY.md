---
phase: 03-launch-playtime
plan: 03c
subsystem: launch.process_track + launch.session
tags: [rust, win32, sysinfo, sqlx, chrono, async, lifecycle]
requires:
  - 03a   # sysinfo + windows crates (Cargo.toml lockup); sqlx pool ready in AppPaths; schema v3 sessions.status + exit_code
  - 03b   # launch::le sibling module; mod.rs already created
provides:
  - launch::process_track::spawn_le
  - launch::process_track::find_game_pid
  - launch::process_track::wait_for_exit
  - launch::process_track::kill_pid
  - launch::process_track::ProcessError
  - launch::session::start_session
  - launch::session::mark_running
  - launch::session::end_session
  - launch::session::mark_failed
  - launch::session::cancel_session
  - launch::session::SessionError
affects:
  - 03d   # commands.rs will compose process_track + session into `launch_game` / `cancel_session` Tauri commands
  - 03e   # tray-aware backgrounding relies on session lifecycle continuing past window close
tech-stack:
  added:
    - chrono@0.4 (features=["serde"]) — RFC3339 timestamps + elapsed-second math
  patterns:
    - "tokio::task::spawn_blocking around blocking Win32 WaitForSingleObject"
    - "sysinfo polling loop with grace + interval + max-attempts (1.5s + 60×500ms)"
    - "SQLite session state machine (starting → running → {completed, cancelled, launch_failed})"
    - "elapsed-time clamp via .max(0) defends against clock skew"
    - "library-pure module; no Tauri command registration (deferred to 03d)"
key-files:
  created:
    - src-tauri/src/launch/process_track.rs
    - src-tauri/src/launch/session.rs
  modified:
    - src-tauri/src/launch/mod.rs    # `pub mod process_track;` + `pub mod session;`
    - src-tauri/Cargo.toml            # chrono = { version = "0.4", features = ["serde"] }
    - src-tauri/Cargo.lock            # auto-updated by cargo (chrono + transitives)
decisions:
  - "find_game_pid: 1.5s grace before first scan (LE-fork race), then 60×500ms = 30s budget; basename match (case-insensitive) with stem-prefix fallback for versioned binaries."
  - "wait_for_exit: WaitForSingleObject with INFINITE timeout inside spawn_blocking; GetExitCodeProcess best-effort (returns -1 if it fails — exit itself is the canonical signal)."
  - "kill_pid: sysinfo Process::kill (TerminateProcess on Windows); 'PID not found' surfaces as ProcessError::Timeout for caller terminal-state simplicity."
  - "session.end_session and session.cancel_session BOTH credit elapsed time to games.total_playtime_sec; only mark_failed zeroes duration (failed launches must not pollute totals)."
  - "Elapsed seconds computed in Rust (chrono parse + clamp ≥ 0) rather than SQL julianday — cheaper and clamps clock skew/NTP jumps deterministically."
  - "Two separate UPDATEs (sessions, then games) instead of an explicit transaction — SQLite WAL serializes writes anyway; partial failure leaves a correct sessions row that future reconciliation could pick up."
metrics:
  duration: ~5min
  completed: 2026-05-07T14:30:00Z
  tasks: 2
  files: 5
  tests-added: 0  # platform-specific Win32 + DB lifecycle deferred to 03d integration tests
  commits: 2
requirements: [LAUNCH-02, TIME-01, TIME-02, TIME-03]
---

# Phase 03 Plan 03c: Process Tracking + Session Lifecycle Summary

**One-liner:** Win32-async process watcher (`spawn_le` / `find_game_pid` / `wait_for_exit` / `kill_pid`) + SQLite session state machine (`start → running → {completed, cancelled, launch_failed}`) — provides the playtime accounting primitives 03d will compose into `launch_game`.

## What Was Built

Two new sibling modules under `src-tauri/src/launch/`. Both are library-pure (no Tauri runtime), so the wider crate still compiles and unit-tests with `cargo check` / `cargo test --lib` without a webview.

### `launch/process_track.rs`

The Win32-side of the launch flow. Four public functions + one error type, all designed to be composed by 03d's `launch_game` command:

- **`spawn_le(le_path, profile, game_exe, args, cwd) -> io::Result<u32>`** — synchronous. Builds `LEProc.exe -runas <profile> <game_exe> [args]` with the configured working directory, calls `Command::spawn`, returns LEProc's PID. Note: this is **not** the game's PID — LEProc is a launcher and exits after spawning the real process.
- **`find_game_pid(game_exe) -> Result<u32, ProcessError>`** — async. Sleeps 1.5s (the `LE_GRACE_MS` window so LE has time to fork), then enters a polling loop: refreshes the process table via `sysinfo`, looks for any process whose `name()` matches `game_exe.file_name()` case-insensitively (with a stem-prefix fallback for versioned/aliased binaries like `game-1.0.exe`). 60 iterations × 500ms = 30s total budget; on timeout returns `ProcessError::Timeout`.
- **`wait_for_exit(pid) -> Result<i32, ProcessError>`** — async. Wraps a `spawn_blocking` task that calls `OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, …)`, `WaitForSingleObject(handle, INFINITE)`, then `GetExitCodeProcess`. Best-effort exit code: if `GetExitCodeProcess` fails we return `-1` because the *exit itself* is the canonical signal that the session should close. Handle is closed in all paths.
- **`kill_pid(pid) -> Result<(), ProcessError>`** — synchronous. Looks up PID in `sysinfo`, calls `Process::kill` (which is `TerminateProcess` on Windows). PID-not-found returns `ProcessError::Timeout` (semantic reuse: "we couldn't find the PID" is terminal for the caller in the same way a timeout is).
- **`ProcessError`** — `thiserror` enum with `Io`, `Timeout`, `Win32(String)` variants.

Win32 imports come exclusively from the `windows` 0.58 features locked in 03a (`Win32_System_Threading` + `Win32_Foundation`); no new feature flags needed.

### `launch/session.rs`

The DB-side of the launch flow. Five public lifecycle functions + one error type, operating on the existing schema-v3 `sessions` table (`status` CHECK enum + `exit_code` column added in 03a):

- **`start_session(pool, game_id) -> Result<i64, _>`** — INSERT with `status='starting'`, `started_at=now`, `duration_sec=0`. Returns the new row id.
- **`mark_running(pool, session_id)`** — UPDATE `status='running'`. Called after `find_game_pid` succeeds (we know the launch reached the user).
- **`end_session(pool, session_id, exit_code)`** — terminal transition for clean exits. Reads `started_at`, computes `(now - started)` seconds (clamped ≥ 0), UPDATEs `status='completed'` + `ended_at` + `duration_sec` + `exit_code`, then folds the duration into `games.total_playtime_sec` (`+= dur_sec`) and refreshes `games.last_played_at`.
- **`mark_failed(pool, session_id)`** — terminal transition for `find_game_pid` timeouts. UPDATE `status='launch_failed'` with `duration_sec=0` and `ended_at=now`. **Does not** touch `games.total_playtime_sec` — failed launches must not pollute totals.
- **`cancel_session(pool, session_id)`** — terminal transition for the user-initiated "强制结束" button. Same accounting as `end_session` (the time was real even if the user killed it), but `status='cancelled'` and no `exit_code`.
- **`elapsed_since_start(pool, session_id) -> Result<i64, _>`** (private helper) — reads `started_at`, parses RFC3339 via `chrono::DateTime::parse_from_rfc3339`, returns `(now - started).num_seconds().max(0)`. The `.max(0)` is the defense against NTP jumps and manual clock changes — without it, a backwards clock skip during a session could decrement the total playtime column.

`SessionError` is a `thiserror` newtype around `sqlx::Error`.

### `launch/mod.rs` change

Two new lines: `pub mod process_track;` and `pub mod session;`. Removed the placeholder comment from 03b (`// 03c will add pub mod process_track;`).

### `Cargo.toml` change

```toml
chrono = { version = "0.4", features = ["serde"] }
```

Pinned to 0.4 (the same major sqlx already targets transitively); `serde` feature is added for forward compatibility with 03d/03e where lifecycle timestamps may be serialized to the frontend.

## Key Decisions

1. **`find_game_pid` polling, not parent-PID hooking.** LE's parent-child relationship is unreliable post-LEProc-exit (the OS will have repointed the parent to System or whatever inherits orphans depending on Windows version). Basename-match polling is dumber but more robust, especially across LE versions. Acceptable tradeoff: launching two binaries with the same basename simultaneously would race — but the project is explicit single-active-session (CONTEXT.md "多游戏同时启动 — Out of Scope for v1").
2. **`WaitForSingleObject` inside `spawn_blocking`.** Using the async-friendly `INFINITE` timeout would block a tokio worker thread; isolating it to a blocking pool keeps the runtime responsive for the rest of the app (tray, window, background scan).
3. **`end_session` + `cancel_session` both credit playtime; only `mark_failed` zeros.** The user expectation is "I closed/killed the game after playing N minutes — those N minutes count." Only when the launch *never started* (process never identified within 30s) does the session contribute zero. This matches the TIME-01..03 contract.
4. **Two-statement update (sessions then games), no explicit transaction.** sqlx 0.8's `Pool` already serializes writes for SQLite. A failure mode where the second UPDATE fails leaves a correct `sessions` row that aggregate-reconciliation jobs (deferred to a future phase if ever needed) can roll up. Wrapping in a transaction would add complexity for a failure mode that essentially can't happen on a healthy local SQLite file.
5. **Compile-only test in `session.rs`.** Lifecycle behavior depends on a real `SqlitePool` against the schema-v3 migration; that integration test belongs at the 03d Tauri-command surface where the pool is bootstrapped. The compile-only `_signatures_compile` reference exists so signature drift breaks the build immediately, not at the 03d wire-up step.
6. **No new feature flags on `windows` crate.** All Win32 calls (`OpenProcess`, `WaitForSingleObject`, `GetExitCodeProcess`, `CloseHandle`) are already covered by the 03a lockup (`Win32_System_Threading` + `Win32_Foundation`).

## Tests Added

None in this plan. Justifications:

- **`process_track`**: every public fn ultimately invokes Win32 syscalls (`Command::spawn`, `OpenProcess`, `TerminateProcess`) that require a live OS process to be meaningful. No portable mocking layer; integration tests at 03d (which can spawn `cmd.exe /c timeout 1` as a fake game) are the right place.
- **`session`**: every public fn is a SQLite mutation against the schema-v3 sessions table. A pool fixture is plumbed in 03d; the compile-only `_signatures_compile` here ensures signature stability without dragging the migration runner into `cargo test --lib`.

The plan's `must_haves.truths` explicitly carries `"cargo check + cargo test --lib 全绿"` rather than asking for new unit tests, so this stays within spec.

## Verification

```
cargo check --manifest-path src-tauri/Cargo.toml      → finished, 0 errors
cargo test  --manifest-path src-tauri/Cargo.toml --lib
  → running 36 tests
    test result: ok. 36 passed; 0 failed; 0 ignored
```

`grep` checks against the plan's `<verify>` block:
- `src-tauri/src/launch/process_track.rs` exists ✓
- contains `WaitForSingleObject` ✓
- contains `pub async fn find_game_pid` ✓
- contains `pub async fn wait_for_exit` ✓
- contains `pub fn spawn_le` ✓
- contains `pub fn kill_pid` ✓
- `src-tauri/src/launch/session.rs` exists ✓
- contains `pub async fn start_session` ✓
- contains `pub async fn end_session` ✓
- contains `pub async fn cancel_session` ✓
- `Cargo.toml` contains `chrono` ✓
- `mod.rs` contains `pub mod process_track` ✓
- `mod.rs` contains `pub mod session` ✓

Compile-time dead-code warnings on the new public fns are **expected** and identical in shape to the 03b lockup — they will all be consumed by 03d when commands.rs wires `launch_game` / `end_active_session` / `cancel_active_session` Tauri commands. Plan-by-plan compilation drives this; not a deviation.

## Deviations from Plan

None — plan executed exactly as written. Three small editorial choices that stay within the plan's spec:

- **Renamed `pid_u32` shadow in `wait_for_exit`.** The plan snippet introduced an intermediate `let pid_u32 = pid;` that served no purpose (the move into `spawn_blocking` already takes `pid` by value). Removed for clarity. Behavior identical.
- **`GetExitCodeProcess` failure now maps to `-1` instead of being silently ignored.** The plan snippet did `let _ = GetExitCodeProcess(...)` and unconditionally returned `exit_code as i32` — which on a failed call would expose uninitialized memory (well, the zero-init we set, so technically safe, but misleading). Now the `Result` is matched explicitly and `-1` is returned on failure. This is a Rule 1 micro-fix (incorrect behavior → corrected) and is documented inline.
- **`elapsed_since_start` extracted as a private helper.** The plan snippet duplicated the same 5-line "read started_at, parse, compute delta, clamp" block in both `end_session` and `cancel_session`. Pulled out to one place to remove the duplication; semantics identical. Rule 1-adjacent (factoring out a copy-paste reduces drift risk).

None of the above changes the public API surface or the on-disk SQL/schema contract.

## Auth Gates

None.

## Threat Flags

None — no new network surface, no new auth path, no shell argument expansion (LE invocation uses `Command::arg()` per-arg, not a shell string). Win32 calls are scoped to the current user (no `PROCESS_ALL_ACCESS`, only `SYNCHRONIZE | QUERY_LIMITED_INFORMATION` for `wait_for_exit`, and `sysinfo`'s standard enumeration for `find_game_pid` / `kill_pid`).

## Known Stubs

None. Both modules are fully implemented; "stubs" in the dead-code sense (signatures awaiting 03d wire-up) are intentional and tracked in the dependency graph (`affects: [03d]`).

## Commits

| # | Hash      | Type | Message                                                                       |
|---|-----------|------|-------------------------------------------------------------------------------|
| 1 | `3d5c51f` | feat | feat(03-03c): add process_track module (sysinfo polling + Win32 wait)         |
| 2 | `1e1f2e7` | feat | feat(03-03c): add session module (DB lifecycle for playtime)                  |

## Next Up

- **03d** — `commands.rs` Tauri wrappers: `launch_game(game_id)` composes `resolve_le_path` + `start_session` + `spawn_le` + `find_game_pid` + `mark_running` + `wait_for_exit` + `end_session`; `cancel_active_session()` invokes `kill_pid` + `cancel_session`. Plus `list_sessions(game_id)` for the detail page.
- **03e** — Detail page (minimal: cover + title + total playtime + sessions list) + Settings LE-path section.
- **03f** — System tray + close-to-tray + background timing.

## Self-Check: PASSED

Verified:
- `[FOUND] src-tauri/src/launch/process_track.rs`
- `[FOUND] src-tauri/src/launch/session.rs`
- `[FOUND] pub mod process_track + pub mod session in src-tauri/src/launch/mod.rs`
- `[FOUND] chrono = { version = "0.4", features = ["serde"] } in src-tauri/Cargo.toml`
- `[FOUND] WaitForSingleObject in process_track.rs`
- `[FOUND] pub async fn start_session in session.rs`
- `[FOUND] commit 3d5c51f`
- `[FOUND] commit 1e1f2e7`
- `[PASS] cargo check (0 errors, expected dead-code warnings only)`
- `[PASS] cargo test --lib (36 passed)`
