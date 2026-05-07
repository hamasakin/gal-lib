---
phase: 03-launch-playtime
plan: 03b
subsystem: launch.le
tags: [rust, locale-emulator, registry, config-persistence, win32]
requires:
  - 03a   # winreg + thiserror in Cargo.toml; serde_json available
  - 01    # data_dir::resolve_data_dir + config.json bootstrap
provides:
  - launch::le::detect_le_path
  - launch::le::resolve_le_path
  - launch::le::set_le_path
  - launch::le::LeError
affects:
  - 03d   # commands.rs will wrap resolve_le_path / set_le_path in Tauri commands
  - 03c   # launch::process_track will be added as a sibling module
tech-stack:
  added:
    - tempfile@3 (dev-dependencies; TempDir for set_le_path test)
  patterns:
    - "3-tier OS resource detection: registry → common paths → PATH"
    - "cache-first resolve with write-back to config.json"
    - "thiserror enum for typed module errors (LeError)"
    - "library-pure Rust module (no Tauri runtime; cargo test --lib green)"
key-files:
  created:
    - src-tauri/src/launch/mod.rs
    - src-tauri/src/launch/le.rs
  modified:
    - src-tauri/src/lib.rs            # `mod launch;`
    - src-tauri/Cargo.toml            # [dev-dependencies] tempfile = "3"
    - src-tauri/Cargo.lock            # auto-updated by cargo (tempfile + transitives)
decisions:
  - "Cache hit requires both le_path key AND on-disk existence; stale paths fall through to re-detect rather than erroring (resilient to LE uninstall/move)."
  - "expand_env limited to %LOCALAPPDATA% only — broader expansion would invite unintended substitutions (no other tokens used by COMMON_PATHS)."
  - "PATH scan skips empty segments (Windows splits on ';' and trailing ';' yields empty strings)."
  - "set_le_path validates existence before writing — never persist a path the launcher will fail on."
metrics:
  duration: ~3m
  completed: 2026-05-07T14:14:25Z
  tasks: 1
  files: 5
  tests-added: 2
  commits: 1
requirements: [LAUNCH-01]
---

# Phase 03 Plan 03b: LE Detector + le_path Resolver Summary

**One-liner:** Locale Emulator path discovery (registry → common paths → PATH) with config.json-backed persistence — provides `detect_le_path`, `resolve_le_path`, and `set_le_path` for 03d's command layer.

## What Was Built

A new Rust subsystem `src-tauri/src/launch/` housing the **LE path resolver** — the foundation for Phase 3 launch flow. The module is library-pure (no Tauri runtime dependency) so unit tests run under `cargo test --lib` without spinning up a webview.

### `launch/mod.rs`
Subsystem entry. Currently exposes only `pub mod le`; a future 03c plan adds `pub mod process_track` as a sibling.

### `launch/le.rs`
- **`detect_le_path() -> Option<PathBuf>`** — 3-tier discovery:
  1. **Registry:** opens `HKEY_CURRENT_USER\Software\LocaleEmulator` and reads the `Path` value (LE installer writes this when run with admin). Joins `LEProc.exe` and validates existence.
  2. **Common paths (4):** `%LOCALAPPDATA%\LocaleEmulator\LEProc.exe`, `C:\Program Files\LocaleEmulator\LEProc.exe`, `C:\Program Files (x86)\LocaleEmulator\LEProc.exe`, `D:\Program Files\LocaleEmulator\LEProc.exe`. `%LOCALAPPDATA%` is expanded via the local `expand_env` helper.
  3. **PATH scan:** splits `PATH` on `;`, joins `LEProc.exe`, skips empty segments.
- **`resolve_le_path(data_dir) -> Result<PathBuf, LeError>`** — cache-first entry point. Reads `data/config.json::le_path`; if present and on-disk-existent, returns it. Otherwise falls back to `detect_le_path`, writes the result back to config.json (pretty-printed), and returns it. Stale-path resilience: a config-recorded path that no longer exists triggers re-detect rather than erroring.
- **`set_le_path(data_dir, path)`** — manual override (Settings page in 03e). Validates `path.exists()` first; errors with `LeError::InvalidPath` otherwise. Writes to `config.json::le_path`.
- **`LeError`** — `thiserror` enum with `Io`, `NotFound`, `InvalidPath` variants.

### `lib.rs` change
Added `mod launch;` to the module list. **Intentionally did not register any Tauri commands** — that lives in 03d per the plan's wave separation.

### `Cargo.toml` change
Added `[dev-dependencies]` section with `tempfile = "3"` so the `set_le_path_writes_to_config` test can build an isolated `TempDir` fixture for `data/config.json`.

## Key Decisions

1. **Cache hit must include disk-existence check.** A `le_path` recorded in config.json but no longer pointing at a real file is treated as a miss and triggers re-detection. Rationale: LE could be uninstalled/moved between sessions; stale config should self-heal rather than block launch.
2. **`expand_env` is intentionally minimal.** It only substitutes `%LOCALAPPDATA%` because that's the only token used in `COMMON_PATHS`. A general environment-expansion routine would risk substituting tokens that happen to appear in user-supplied paths.
3. **No Tauri command registration here.** 03d owns `commands.rs` extensions; this plan stays library-only so unit tests don't need a Tauri test harness.
4. **Tempfile in dev-dependencies (not main).** `set_le_path` test needs an isolated config.json fixture; pulling tempfile only at test-time keeps release binary size unchanged.
5. **`LeError` variants typed for downstream UI.** `NotFound` (3-tier all missed → Settings page prompts manual override) vs. `InvalidPath` (user gave us a bad path → toast "路径不存在") vs. `Io` (filesystem error → generic toast). 03d/03e will route these to appropriate UI feedback.

## Tests Added

`src-tauri/src/launch/le.rs#tests`:
1. **`expand_env_resolves_localappdata`** — sets `LOCALAPPDATA` deterministically, asserts `%LOCALAPPDATA%` is substituted and the resolved string starts with the env value.
2. **`set_le_path_writes_to_config`** — uses `TempDir`, writes a dummy `LEProc.exe`, calls `set_le_path`, parses resulting `config.json`, asserts `le_path` matches the dummy path. Negative case: a non-existent path yields `LeError::InvalidPath`.

`detect_le_path` itself is **not unit-tested** — its 3-tier strategy depends on host machine state (registry, install paths, PATH) that's deliberately not mockable here. It will be exercised end-to-end by 03d's integration test once the Tauri command surface exists.

## Verification

```
cargo check --manifest-path src-tauri/Cargo.toml      → finished, 0 errors
cargo test  --manifest-path src-tauri/Cargo.toml --lib launch::le::tests
  → running 2 tests
    test launch::le::tests::expand_env_resolves_localappdata ... ok
    test launch::le::tests::set_le_path_writes_to_config ... ok
    test result: ok. 2 passed; 0 failed
```

Compile-time warnings on `detect_le_path`/`resolve_le_path`/`set_le_path`/`LeError`/`COMMON_PATHS` are **expected** — these are dead-code warnings until 03d wires the command handlers. Plan-by-plan compilation drives this; not a deviation.

## Deviations from Plan

None — plan executed exactly as written. Two minor enhancements that stay within the plan's spec:

- Added `env::set_var("LOCALAPPDATA", &v)` inside the `expand_env_resolves_localappdata` test to make it deterministic on hosts where `LOCALAPPDATA` is empty (e.g. some CI containers). The original snippet only had `unwrap_or_else` on the read; without an explicit set, the fallback string wouldn't actually drive `expand_env`'s substitution. Treated as a Rule 1 micro-fix to ensure the test asserts what its name claims.
- Added a negative assertion (`InvalidPath` on bogus path) inside `set_le_path_writes_to_config` to lock in the existence-validation contract. Single test, two cases — minor expansion of test coverage, no plan deviation.

## Auth Gates

None.

## Threat Flags

None — no new network surface, no new auth path. `winreg` reads HKCU only (current-user scope, no elevation). `config.json` read/write is local-disk only and stays within the existing `data_dir` trust boundary.

## Known Stubs

None.

## Commits

| # | Hash      | Type | Message                                                                                  |
|---|-----------|------|------------------------------------------------------------------------------------------|
| 1 | `95042d0` | feat | feat(03-03b): add LE detector + le_path resolver (registry + common paths + PATH search) |

## Next Up

- **03c** — `launch::process_track` (sysinfo + windows crates → identify LE-spawned game PID after LEProc exits, watch via `WaitForSingleObject`).
- **03d** — `commands.rs` Tauri wrappers: `detect_le()`, `set_le()`, `launch_game()` invoking this module.

## Self-Check: PASSED

Verified:
- `[FOUND] src-tauri/src/launch/mod.rs`
- `[FOUND] src-tauri/src/launch/le.rs`
- `[FOUND] mod launch in src-tauri/src/lib.rs`
- `[FOUND] tempfile in src-tauri/Cargo.toml`
- `[FOUND] commit 95042d0`
- `[PASS] cargo check`
- `[PASS] cargo test --lib launch::le::tests (2 passed)`
