---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 03-03f-PLAN.md (Phase 3 wave 6/6 — frontend launch UI + Detail page + Settings LE + tray toast). PHASE 3 COMPLETE.
last_updated: "2026-05-07T15:06:27.227Z"
last_activity: 2026-05-07 -- Phase 4 planning complete
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 24
  completed_plans: 18
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆
**Current focus:** Phase 2 — library ingest

## Current Position

Phase: 3 (launch-playtime) — COMPLETE
Plan: 6 of 6 complete (03f done — launch UI + Detail page + Settings LE + tray toast)
Status: Ready to execute
Last activity: 2026-05-07 -- Phase 4 planning complete

Progress: [████████████████████] 100% (18/18 plans complete; Phase 3 fully wrapped)

## Performance Metrics

**Velocity:**

- Total plans completed: 18 (Phase 1: 6 + Phase 2: 02a-02f + Phase 3: 03a-03f) — ALL plans through Phase 3 done
- Average duration: ~25min/plan
- Total execution time: ~7.25 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation | 6 | ~3h | ~30min |
| 2. Library Ingest | 6 | ~3.5h | ~35min |
| 3. Launch & Playtime | 6/6 | ~41min | ~6.8min |

**Recent Trend:**

- Last 6 plans: 03a → 03b → 03c → 03d → 03e → 03f
- Trend: Phase 3 closed in 41min cumulative wall time (smallest plan velocity in project) — backend (03a-03e) was tightly scoped, 03f frontend wired everything via existing typed invoke + Zustand patterns. 03f added 7 invoke helpers + 2 event subs + ActiveSessionBar + Detail page + GameCard launch overlay + Settings LE section + first-time tray toast with localStorage gate. 5 Rule 2/3 auto-fixes (boot-time hydration, no-exe inline callout, single-session UI lock, no-exe badge reposition, unused import). pnpm typecheck + vite build + cargo check all exit 0.

*Updated after each plan completion*
| Phase 02 P02d | 75min | 3 tasks | 5 files |
| Phase 02 P02e | 30min | 2 tasks | 4 files |
| Phase 02 P02f | 35min | 3 tasks | 11 files (5 new + 6 modified) |
| Phase 03 P03a | 6min | 1 task | 4 files (1 new + 3 modified) |
| Phase 03 P03b | 3min | 1 task | 5 files (2 new + 3 modified) |
| Phase 03 P03c | 5min | 2 tasks | 5 files (2 new + 3 modified) |
| Phase 03 P03d | 3min | 2 tasks | 4 files (1 new + 3 modified) |
| Phase 03 P03e | 12min | 1 task | 4 files (1 new + 3 modified) |
| Phase 03 P03f | 12min | 2 tasks | 9 files (3 new + 6 modified) |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Tauri + React + Tailwind 技术栈（包小、Rust 后端适合进程/文件 I/O）
- Portable 模式：所有数据放 exe 同目录 `data/`
- 仅支持 Locale Emulator，不做通用启动器抽象
- Bangumi 优先 + VNDB 兜底的双元数据源策略
- 仅进程存活计时，不做焦点/闲置检测
- **02b**: Title cleaning = 5-step regex pipeline (paren / noise / prefix / trail-date / whitespace) via once_cell::Lazy
- **02b**: Bangumi UA = `gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)`（默认 UA 返 403）
- **02b**: VNDB endpoint = `api.vndb.org/kana/vn` (Kana API, POST with filters/fields)
- **02b**: Rate limiters = governor token-bucket per-source singleton (Bangumi 1 req/s, VNDB 100 req/min)
- **02b**: Retry strategy = exp-backoff [1s, 2s, 4s] x 3 for 5xx/429/network; 4xx (except 429) immediate fail
- **02b**: Confidence score = exact (100) > containment (70-99 by short/long ratio) > Levenshtein normalized (sim>=0.8 → 70-99 ; sim<0.8 → 0-69 cap)
- **02c**: Game-boundary via `walkdir::min_depth==max_depth==N` — single iterator pass, no manual depth tracking
- **02c**: `pick_best_exe` rejects all-negative-score candidates → returns `None` so UI can render "无可识别 exe" badge per SCAN-05
- **02c**: Tie-break on mtime (newest wins); per-entry walkdir errors swallowed via `filter_map(Result::ok)` — single permission-denied dir doesn't abort the scan
- **02c**: `run_scan` takes `Fn(ScanProgress)+Send+Sync+'static` callback — module is unit-testable without Tauri AppHandle; 02d wires `app.emit("scan-progress", ...)`
- **02c**: `ScanContext` bundles cancel (`Arc<AtomicBool>`) + skip (`Arc<Mutex<HashSet<PathBuf>>>`) — single shared handle for all scan-related Tauri State
- [Phase ?]: AppPaths.pool uses tokio::sync::OnceCell<Arc<SqlitePool>> with async pool() helper — sqlx 0.8 connect_lazy panics outside Tokio context, init must defer to first command invoke
- [Phase ?]: Cover cache returns relative path covers/{game_id}.{ext}; URL gated to http(s) only; Content-Type → ext mapping (jpg/png/webp); other types rejected
- [Phase ?]: Ingest pipeline: Bangumi → VNDB fallback at ≥80 confidence threshold (per 02-CONTEXT lock); UPSERT in start_scan to allow re-scanning; COALESCE in bind/refresh to preserve existing cover/IDs on partial refresh
- [Phase ?]: Tauri commands count = 10 (1 inherited + 9 new); 02f appends list_games as 11th; ScanState wraps Mutex<Option<Arc<ScanContext>>> so cancel/skip can reach in-flight scan from a different command
- **02e**: Frontend invoke layer = thin per-domain helper files (scan.ts / metadata.ts) — no class wrapper, no client object; just typed `invoke<T>` calls + literal-typed unions for Tauri arg shapes (camelCase JS → snake_case Rust auto-converted)
- **02e**: Library Zustand store mirrors src/store/app.ts (single create() + setters; no actions/middleware) — keeps room for Phase 4 to add games/filters/sort slices the same way
- **02e**: Settings page = source-of-truth refresh after every mutation (no optimistic updates) — DB is canonical; depth change implemented as remove+re-add (no UPDATE command needed in 02d)
- **02e**: Settings.tsx keeps NAMED export to match router.tsx import; section heading uses `text-base font-semibold` (16/600) since `text-h3` token addition is deferred to 02f's tailwind.config.ts work
- **02f**: Tailwind tokens `aspect-cover` (3/4) + `text-h3` (16/600/1.4) added to theme.extend (Phase 2 NEW per UI-SPEC); 11th Tauri command `list_games` returning Vec<Game> ordered by created_at DESC
- **02f**: GameGrid uses @tanstack/react-virtual in row-mode with manual lane indexing (count = ceil(games/cols)); columnCount derived from ResizeObserver; cover URLs resolved via `convertFileSrc(dataDir + cover_path)` from `@tauri-apps/api/core`
- **02f**: GameCard uses DropdownMenu with manual right-click forwarding (e.preventDefault + currentTarget.click) — Radix DropdownMenuTrigger fires on left-click by default, but UI-SPEC mandates DropdownMenu specifically (not ContextMenu); metadata-state badges (pending/failed/no-exe) overlay the cover; click → toast.info "详情页 — 即将上线"
- **02f**: ScanProgressBar 5s auto-hide timer for terminal states; status-aware summary line (扫描完成 / 扫描已取消 / 扫描失败) reuses UI-SPEC toast copy; sticky top-0 z-10 above main content
- **02f**: MetadataPicker debounce 400ms via setTimeout in useEffect cleanup; direct-ID inputs take precedence over selected candidate at apply time; confidence Badge palette (≥80 emerald / 70-79 yellow / <70 destructive)
- **02f**: Library.tsx kept NAMED export (mirrors Settings.tsx 02e fix); main.tsx adds module-scope `__scanProgressUnsub` guard before subscribing to Tauri scan-progress event into useLibraryStore.getState().setScanProgress
- **03a**: schema v3 migration adds 3 launch-config cols on games (le_profile NOT NULL DEFAULT 'Japanese' / launch_args / cwd) + 2 status cols on sessions (status with locked CHECK('starting','running','completed','launch_failed','cancelled') DEFAULT 'completed' + exit_code); contract is asserted in db.rs unit test
- **03a**: Phase 3 Rust crates locked once at foundation step — winreg 0.52 (registry, 03b), sysinfo 0.32 (process listing, 03c), windows 0.58 with [Win32_System_Threading, Win32_System_ProcessStatus, Win32_Foundation, Win32_System_Diagnostics_ToolHelp] features (OpenProcess + WaitForSingleObject + ToolHelp32, 03c); tray-icon Tauri feature deferred to 03e
- **03a**: Migration test counts non-comment ADD-COLUMN lines (filter `!line.trim_start().starts_with("--")`) instead of raw substring matches — protects against future doc comments that mention "ADD COLUMN"
- **03b**: LE detection 3-tier strategy (registry HKCU\Software\LocaleEmulator → 4 common paths incl. %LOCALAPPDATA%/Program Files{x64,x86}/D:\ → PATH scan); cache-first resolver in `data/config.json::le_path` with stale-path fallback to re-detect (resilient to LE uninstall/move between sessions)
- **03b**: `launch/` is library-pure (no Tauri command registration here — that's 03d); keeps `cargo test --lib` green without dragging the Tauri runtime into unit tests; `tempfile = "3"` added to [dev-dependencies] only (release binary size unchanged)
- **03b**: `expand_env` is intentionally minimal — substitutes only `%LOCALAPPDATA%` (the only token used in COMMON_PATHS); broader expansion would invite unintended substitutions in user-supplied paths
- **03b**: `set_le_path` validates `path.exists()` before persisting → never write a path the launcher will fail on later (LeError::InvalidPath)
- **03c**: `find_game_pid` strategy = 1.5s LE-fork grace + 60×500ms basename-match polling (case-insensitive, with stem-prefix fallback for versioned binaries); 30s total budget, returns ProcessError::Timeout on miss; basename-match chosen over parent-PID hooking because LE's parent-child link is unreliable post-LEProc-exit
- **03c**: `wait_for_exit` blocks `WaitForSingleObject(handle, INFINITE)` inside `tokio::task::spawn_blocking` so it doesn't park a tokio worker; `GetExitCodeProcess` is best-effort (returns -1 on failure) — exit itself is the canonical signal
- **03c**: Session state machine `starting → running → {completed, cancelled, launch_failed}`; `end_session` AND `cancel_session` BOTH credit elapsed time to `games.total_playtime_sec`, only `mark_failed` zeros (the user expectation: "I closed/killed after playing N min — those count")
- **03c**: Elapsed seconds computed in Rust (chrono RFC3339 parse + `.max(0)` clamp) rather than SQL `julianday` — defends deterministically against NTP jumps/clock skew
- **03c**: Two-statement update (sessions then games), no explicit transaction — sqlx 0.8 Pool serializes SQLite writes; partial failure leaves a correct sessions row that future reconciliation could pick up
- **03c**: `chrono = "0.4"` with `serde` feature added to Cargo.toml (forward-compat for 03d/03e where lifecycle timestamps may serialize to frontend); `windows` crate features unchanged (03a lockup already covers all calls)
- **03d**: `launch::orchestrator::launch_game(LaunchInputs) → (session_id, ActiveSession, JoinHandle)` is the single entry-point; `prepare_launch` is split out so missing-exe / missing-LE fail BEFORE a sessions row is created
- **03d**: `ActiveSessionState(Mutex<Option<ActiveSessionEntry>>)` uses `std::sync::Mutex` (NOT tokio::sync) — locks held only briefly inside command bodies, never across `await`; lock-then-clone-or-take pattern enforced by inspection
- **03d**: `ActiveSessionEntry` holds the `AbortHandle` (not the JoinHandle) — the JoinHandle is consumed by a watcher task spawned in `launch_game` that awaits → clears state → emits null `active-session-changed`
- **03d**: `app.try_state::<ActiveSessionState>()` from inside watcher task — `State<'_, T>` is non-`'static` so we can't move it; AppHandle is `'static + Clone + Send`. Cleaner than channel hand-off
- **03d**: `end_active_session` aborts the wait task FIRST then `session::cancel_session(session_id)` — DB row is the source of truth (session_id is canonical), AbortHandle abort + DB cancel are independently idempotent; emits null event belt-and-braces
- **03d**: `update_game_launch_config` uses `COALESCE(?, col)` for each field — None bind = SQL NULL = keep existing; Some("") = clear (intentional, lets user wipe launch_args)
- **03d**: `get_le_path` filters stale paths via `Path::exists()` so Settings UI doesn't display non-existent location as configured (Rule 2 deviation; matches CONTEXT § LE Detection re-detect-on-stale)
- **03d**: Tauri commands count = 19 (1 inherited + 11 from P02 + 7 new in 03d); `active-session-changed` event payload = `Option<ActiveSession>` (None = no session, Some = active)
- **03e**: Tauri 2 `TrayIconBuilder::with_id("main")` registered in Builder.setup closure (NOT in run prelude — needs &AppHandle); 2-item menu `show` / `quit` + tooltip "gal-lib"; left-click = same as `show`. cargo `tauri` features += `"tray-icon"` (was empty)
- **03e**: Close-to-tray = `WindowEvent::CloseRequested` → `api.prevent_close()` + `window.hide()` + `app.emit("close-to-tray", ())`; main thread continues running, all tokio session-watcher tasks live independently of webview window so playtime keeps counting
- **03e**: Tray quit path uses `tauri::async_runtime::block_on` (not spawn) — runs on main thread from menu callback, must complete `cancel_session(pool, sid)` BEFORE `app.exit(0)` (otherwise process dies mid-write); pool accessed via new `commands::get_pool_blocking` (sync `.get()` on OnceCell, no await)
- **03e**: `AppPaths.pool` visibility lifted from private to `pub(crate)` so the sync helper can read the OnceCell directly; existing async `pool()` accessor unchanged
- **03e**: `capabilities/default.json` untouched — `core:default` already covers `core:tray:default` and `core:app:default` in Tauri 2.x (verified by clean cargo check + release build)
- **03e**: `update_tray_tooltip(app, text)` exposed as pub but `#[allow(dead_code)]` — stable extension point for "currently playing X" tooltip in later phases (out of scope for P3)
- **03f**: `src/lib/launch.ts` mirrors backend wire format 1:1 — ActiveSession (no rename_all → snake_case fields preserved) and SessionRow (explicit serde rename_all = "snake_case" both directions); 7 invoke wrappers + 2 event subs (`active-session-changed` payload `Option<ActiveSession>`, `close-to-tray` no payload)
- **03f**: `useLibraryStore.activeSession` is single source of truth for both ActiveSessionBar (visibility) and GameCard (launch button state) — module-scope subscription in main.tsx + boot-time `getActiveSession()` hydration before listener attaches (survives webview reload mid-session)
- **03f**: GameCard launch button uses 3-state visibility logic — not active OR no session → opacity-0 group-hover:opacity-100 default Play; this card is active → opacity-100 destructive Square (强制结束); some other card is active → entirely hidden (single-session UI lock mirrors backend rejection)
- **03f**: Detail page (`/games/:id`) bundles "save config + launch" into a single 启动 button (separate 保存配置 button deferred to Phase 4 when more fields land); cwd empty-string sent as undefined (preserves NULL = "use default") while launch_args empty-string is sent verbatim (lets user clear)
- **03f**: Settings LE path section uses aliased import `setLePath as applyLePath` to avoid name clash with React local state setter `setLePath` (TS would reject the shadowing inside the same function scope)
- **03f**: Close-to-tray toast uses localStorage flag `gal-lib:tray-toast-dismissed` (purely UI affordance, doesn't need to survive uninstall, sync writes from action handler) — backend continues to emit on every close, frontend filters
- **03f**: ActiveSessionBar 1Hz tick via setInterval driven by useEffect dep on activeSession — interval auto-cleans when activeSession→null (component returns null and effect cleanup fires); no separate auto-hide timer like ScanProgressBar (session lifecycle is binary in store)

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-05-07T15:00:00.000Z
Stopped at: Completed 03-03f-PLAN.md (Phase 3 wave 6/6 — frontend launch UI + Detail page + Settings LE + tray toast). PHASE 3 COMPLETE.
Resume file: None
