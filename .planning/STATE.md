---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: Defining requirements
stopped_at: "Completed 05-05e-PLAN.md (Phase 5 wave 5/5 FINAL — Detail page extensions: ScreenshotsTab + SavesTab + 截图间隔 select in 设置 tab); 29/29 plans done. **v1 milestone complete.**"
last_updated: "2026-05-08T15:57:01.703Z"
last_activity: 2026-05-09 — Completed quick task 20260509: display fallbacks + clickable BGM/VNDB links + name-search buttons
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 1
  completed_plans: 5
  percent: 100
---

# Project State

## Deferred Items

Items acknowledged and deferred at v1.0 milestone close on 2026-05-08:

| Category | Item | Status |
|----------|------|--------|
| verification | Phase 01 GUI/interaction items (drag/buttons/tooltip) | human_needed |
| verification | Phase 02 GUI/network items (real Bangumi/VNDB, virtualization perf) | human_needed |
| verification | Phase 03 LE-integration items (real LE install + galgame) | human_needed |
| verification | Phase 04 GUI items (search/sort/filter/tags interactions) | human_needed |
| verification | Phase 05 GUI/integration items (live charts, screenshots, save backup) | human_needed |

**Resolution path:** These deferrals are by design per autonomous-mode policy — they require a human-driven QA pass on a clean Win10/Win11 environment with Locale Emulator + a real galgame library installed. Each phase's `*-VERIFICATION.md` lists the specific manual checklist items.

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆
**Current focus:** Phase 2 — library ingest

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-08 — Milestone v1.1 started

## Performance Metrics

**Velocity:**

- Total plans completed: 29 (Phase 1: 6 + Phase 2: 02a-02f + Phase 3: 03a-03f + Phase 4: 04a-04f + Phase 5: 05a-05e)
- Average duration: ~19min/plan
- Total execution time: ~9.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation | 6 | ~3h | ~30min |
| 2. Library Ingest | 6 | ~3.5h | ~35min |
| 3. Launch & Playtime | 6/6 | ~41min | ~6.8min |
| 4. Library Polish | 6/6 | ~68min | ~11.3min |
| 5. Stats & Media | 5/5 | ~70min | ~14min |

**Recent Trend:**

- Last 6 plans: 04f → 05a → 05b → 05c → 05d → 05e
- Trend: Phase 5 wave-5 FINAL (05e) Detail page extensions — ScreenshotsTab + SavesTab tabs + 截图间隔 select in 设置 tab. New `src/components/library/ScreenshotsTab.tsx` (~280 lines): mount calls `getScreenshots(gameId)` → `useLibraryStore.screenshotsByGame[gameId]` cache; 3-col CSS Grid aspect-square tiles with `convertFileSrc(dataDir + '/' + path)` asset:// thumbnails + `<ImageOff>` fallback; hover overlay (group-hover:opacity-100, black/40 backdrop) reveals 2 icon "buttons" (`<span role="button">` to avoid nested-button warning since tile is a `<button>` for click-to-lightbox) — Download → `plugin-dialog.save({filters:[PNG]})` → `exportScreenshot(id, target)`, Trash2 → AlertDialog `确定删除这张截图？` → `deleteScreenshot(id)` + refetch + `已删除截图` toast; lightbox = shadcn `<Dialog>` `max-w-[80vw]` + `<img max-h-[85vh] object-contain>` + sr-only `<DialogTitle>`; loaded flag prevents empty-state flash during initial fetch. New `src/components/library/SavesTab.tsx` (~330 lines): mount fetches `getSavePath(gameId)` (Rule 2 reader) and `listSaveBackups(gameId)` in parallel; readonly Input + 选择... Button → `plugin-dialog.open({directory:true})` → `setSavePath(gameId, picked)` + `已设置存档目录` toast; `备份当前存档` Button (disabled when savePath empty) → AlertDialog `确定备份？将复制存档目录到 data/saves/{game_id}/{timestamp}/` → `createSaveBackup(gameId, null)` + refetch; 4-col table (时间/文件数/大小/操作) with locale timestamp + B/KB/MB/GB formatter; per-row 恢复 button → AlertDialog `确定恢复此备份？将覆盖当前存档目录` → `restoreSaveBackup(id)` + `已恢复存档` toast; per-row 删除 button → AlertDialog `确定删除此备份？此操作不可恢复` → `deleteSaveBackup(id)` + refetch; empty state `还没有存档备份 — 配置存档目录后点上方按钮开始备份`. Detail.tsx changes: TabsList 5→7 triggers (added 截图 + 存档), 2 new TabsContent rendering the components, 设置 tab gains a 截图间隔 Select (60s/5min/10min/30min/关闭=0) bound to screenshotInterval state — hydrated on mount via `getScreenshotSettings(gameId)`, onValueChange fires `setScreenshotInterval(gameId, Number(v))` + `已设置截图间隔` toast; SCREENSHOT_INTERVAL_OPTIONS const declared module-scope. Backend (Rule 2 deviation): added `get_save_path(game_id) -> Option<String>` command in commands.rs (~22 lines) + registered in lib.rs invoke_handler — symmetric reader for existing `set_save_path` writer; without it, SavesTab Input would render empty after every restart even though `games.save_path` is correctly persisted; alternative (extending row_to_game with save_path/screenshot_interval_sec) rejected because it would broaden public Game type unnecessarily. `src/lib/saves.ts` gains `getSavePath` wrapper. pnpm typecheck + vite build green; cargo check green (4 pre-existing dead-code warnings on unrelated modules). 1 deviation (Rule-2 get_save_path reader). 1 commit (1d172c1). **Phase 5 complete; v1 milestone complete.**
- Trend (prev): Phase 5 wave-4 (05d) Stats route + Sidebar 统计 nav.
- Trend (prev): Phase 5 wave-3 (05c) frontend invoke layer.
- Trend (prev): Phase 5 wave-2 (05b) backend stats + screenshots + saves. New `src-tauri/src/screenshot.rs` with `capture_to_disk(data_dir, game_id)` — `Screen::all()` → primary monitor → `capture()` → raw RGBA bytes streamed via `png::Encoder` (BufWriter<File>) directly to `data/screenshots/<game_id>/<unix_ts>.png` (skips `image::write_to` because screenshots 0.8 internally re-exports image v0.24 vs project's v0.25 — incompatible RgbaImage types; encoding via `png` crate avoids the cross-version friction). New `src-tauri/src/save_backup.rs` with `create_backup` (walkdir recursive copy → `data/saves/<game_id>/<ts>/` → BackupResult{file_count, total_size_bytes}), `restore_backup`, `delete_backup_dir` + 3 unit tests (round-trip + 2 missing-source). `launch::orchestrator::launch_game` now reads `games.screenshot_interval_sec` and spawns a parallel `tokio::time::interval(period.max(60s))` task that calls capture_to_disk + INSERTs into screenshots table; the wait-for-exit task and screenshot task share an `Arc<AtomicBool>` cancel flag flipped at every terminal transition (end_session/mark_failed/launch-failed) — replaces the plan's "use existing flag" assumption (no flag existed prior). 12 new Tauri commands in `commands.rs`: `get_playtime_trend(period, days)` (strftime daily/weekly/monthly bucketing + `datetime('now', '-N days')` window over sessions in completed/cancelled status), `get_top_games(limit ∈ 1..=50)`, `get_screenshots/delete_screenshot/export_screenshot`, `set_screenshot_interval/get_screenshot_settings`, `set_save_path/list_save_backups/create_save_backup/restore_save_backup/delete_save_backup`. lib.rs registers all 12 in `generate_handler!` (43 commands total = 31 prior + 12 new + get_data_dir). cargo check + cargo test --lib green (41/41 = 38 prior + 3 new save_backup). 4 deviations: Rule-1 fix for `RgbaImage::to_png` API mismatch (plan's example called a method that doesn't exist on screenshots-0.8 RgbaImage — switched to png-crate streaming), Rule-2 fix to introduce the missing AtomicBool cancel flag, Rule-1 fix for SaveError::NotConfigured dead-code warning (added allow + reserved-future-use doc), and one note about plan's "44 entries" claim being off-by-one vs actual 43 (plan likely double-counted get_data_dir). 2 commits (a90eb88, 365051e).
- Trend (prev): Phase 5 wave-1 (05a) lockup. schema v5 migration (games +screenshot_interval_sec/+save_path; new screenshots + save_backups tables w/ FK CASCADE + 2 indexes; bump schema_version → 5). Rust crates `screenshots = 0.8.10` (cross-platform desktop capture, Windows DXGI/GDI fallback) + `png = 0.17` (pure-Rust encoder; no libpng) for 05b SHOT-01. npm `recharts` pinned to ^2.12 → 2.15.4 (initial `pnpm add recharts` resolved to 3.8.1, re-ran with explicit ^2.12 to honor plan must_haves). db.rs registers V5 via 5th `Migration` entry; new unit test `migrations_v5_adds_screenshots_and_saves` (38/38 lib tests pass = 37 prior + 1 new). v4 test relaxed `len == 4` → `len >= 4` so v5 registration doesn't break it. Smoke: pnpm tauri dev triggered migration; `app_meta.schema_version=5` confirmed via sqlite3. Three Rule-1 deviations (test assertion bugs caught + fixed iteratively before commit). 1 commit (af7b91a).
- Trend (prev): Phase 4 wave-6 FINAL (04f) Settings page polish. Two new components in src/components/settings/: <TagManager> (full tag CRUD — list rows with colored dot + inline-edit row [Input + 8-color preset swatch picker + 保存/取消] + delete with AlertDialog confirm "确定删除标签『{name}』？已打的游戏会保留，但失去此标签关联"; single editing-state slot prevents parallel-edit UX confusion; "添加标签" button opens dashed-border draft row with id:null sentinel reusing the same commit code path; mutation refetch via listTags()→useLibraryStore.setTags so sidebar reflects new state; 8 preset colors slate/blue/emerald/amber/rose/violet/orange/pink as Tailwind v3 *-500 hex stored in tags.color) and <UIPreferences> (default-sort Select with same 5 SortBy options as SortSelect, persisted to localStorage 'gal-lib:default-sort' via exported loadDefaultSort/saveDefaultSort helpers with whitelist validation against the SortBy enum; theme row rendered as opacity-60 hint span "暗色（深浅色切换将在 Phase 5 加入）" since shadcn Switch isn't installed and disabled Toggle would visually imply togglable surface). Settings.tsx appends both sections after existing P2/P3 sections (扫描根目录 / Locale Emulator / 扫描操作 untouched). pnpm typecheck + vite build green. 1 commit (e282e1a). Phase 4 complete.

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
| Phase 04 P04a | 15min | 2 tasks | 9 files (6 new + 3 modified) |
| Phase 04 P04b | 4min | 1 task | 2 files (0 new + 2 modified) |
| Phase 04 P04c | 3min | 1 task | 4 files (2 new + 2 modified) |
| Phase 04 P04d | 12min | 2 tasks | 8 files (3 new + 5 modified) |
| Phase 04 P04e | 22min | 2 tasks | 3 files (2 new + 1 modified) |
| Phase 04 P04f | 12min | 1 task | 3 files (2 new + 1 modified) |
| Phase 05 P05a | 10min | 1 task | 6 files (1 new + 5 modified) |
| Phase 05 P05b | 25min | 2 tasks | 5 files (2 new + 3 modified) |
| Phase 05 P05c | 8min | 1 task | 4 files (3 new + 1 modified) |
| Phase 05 P05d | 5min | 1 task | 3 files (1 new + 2 modified) |
| Phase 05 P05e | 22min | 1 task | 6 files (2 new + 4 modified) |

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
- **04a**: Schema v4 = 3 ALTER TABLE games ADD COLUMN (brand TEXT / release_year INTEGER / is_favorite INTEGER NOT NULL DEFAULT 0) + UPDATE app_meta schema_version='4'; v4 test loosened v3 `len == 3` to `len >= 3` for forward growth, pins exact `len == 4` and `ADD COLUMN count == 3`
- **04a**: shadcn `command` block now ships as composite with `input-group` (treated as vendored asset, committed alongside command.tsx); CLI overwrite prompts must be answered via stdin pipe (`printf 'n\n…'`) since `--yes` doesn't auto-default the per-file overwrite prompt
- **04a**: Plan-script `<verify>` `grep -q "schema_version = '4'"` literal-form does not match OUTLINE SQL `WHERE key = 'schema_version' … value = '4'` — verified equivalently with split-grep (`grep schema_version` AND `grep "'4'"`); future schema-bump plans should use the same split assertion
- **04b**: search_games dynamic SQL — `sort_by` is a hard whitelist (last_played | created_at | name | playtime | rating; unknown → Err); `filter.status` whitelisted defensively (DB CHECK already covers); `filter.tag_id` (i64) and `filter.year_decade` (i32) interpolated as integer literals (type-coerced upstream so no injection); query LIKE %?% bound 4 times for name/name_cn/path/tag.name placeholders; `last_played_at IS NULL, last_played_at DESC` produces NULLS-LAST behavior on a non-true-NULLS-LAST SQLite
- **04b**: get_sidebar_categories returns 4 lists + 1 scalar (tags w/ count via LEFT JOIN game_tags so 0-count tags still appear; per-status counts via GROUP BY status; distinct brands w/ count excluding NULL/empty; decade buckets via `(release_year / 10) * 10` excluding NULL; favorite_count single SELECT). Sidebar populates without an extra round-trip
- **04b**: set_game_tags is transactional via `pool.begin()` + `tx.commit()` with `INSERT OR IGNORE` (composite PK protects against intra-input duplicates without rolling back the whole assignment); list_games extended to serialize brand/release_year/is_favorite via shared `row_to_game(&SqliteRow)` helper used by both list_games and search_games (single source of column wiring)
- **04b**: update_game_brand_year intentionally uses bind-NULL = SQL NULL (overwrite-with-NULL when args None) — different from update_game_launch_config's COALESCE(?, col) keep-on-None pattern, because the metadata refresh pipeline needs the ability to *clear* brand/year when a re-fetch returns nothing matched
- **04b**: Tauri command count = 32 (19 prior + 13 new); is_favorite serialized as JS bool via Rust `bool` field but stored as i64 0/1 (Tauri/serde renders bool → JSON true/false; row_to_game converts via `try_get::<i64,_>(...) != 0`)
- **04c**: Frontend invoke layer = 2 new files (`src/lib/search.ts` + `src/lib/tags.ts`) + 2 extended files (`src/lib/games.ts` + `src/store/library.ts`); 13 backend commands wired 1:1 as TS invoke wrappers; `Tag` interface single source of truth in tags.ts (search.ts imports via `import type { Tag }`); `SearchFilter` keeps snake_case inner field names (tag_id, year_decade) because those go through serde, not Tauri's outer-arg-name camelCase converter
- **04c**: Game type extended with v4 fields (brand: string|null, release_year: number|null, is_favorite: boolean — JS-side boolean because row_to_game converts i64 0/1 → bool before serde); 5 update helpers added (updateGameStatus / updateGameFavorite / updateGameRating / updateGameNotes / updateGameBrandYear); store mutations remain non-optimistic (callers re-fetch via searchGames + getSidebarCategories — same source-of-truth rule already in store/library.ts)
- **04c**: 5 new store slices (searchQuery default "", sortBy default "last_played", filter default {} via EMPTY_FILTER sentinel, tags default [], sidebar default null) + 5 paired setters; sidebar=null = "render skeleton/empty"; filter={} chosen over null so UI can access individual fields without null-guards (backend treats all-undefined as no clauses)
- **04c**: updateGameFavorite(gameId, favorite) function arg uses terse `favorite` name; the Tauri invoke arg renames to `isFavorite` at the call site (`{ gameId, isFavorite: favorite }`) to match Rust's snake_case `is_favorite` via Tauri auto-conversion — clean JS API, single rename touch point
- **04d**: SearchBar 200ms debounced commit pattern — local useState mirrors store.searchQuery; only the debounced setTimeout commits to the store. Avoids per-keystroke grid re-render (Zustand subscribers fire synchronously); store stays the single source of truth for the (query, sort, filter) triple consumed by Library.tsx's useEffect
- **04d**: Library.tsx is the SINGLE caller of searchGames. Sidebar / FilterChip / SearchBar only mutate the store; one useEffect subscribes to (searchQuery, sortBy, filter) and re-issues the invoke. Mutation refetch flows: GameCard.onMutated → GameGrid.onChildMutation → Library.refetchGrid + refreshSidebar. Source-of-truth-is-DB rule from 04c preserved (no optimistic updates anywhere)
- **04d**: Sidebar single-axis activation rule — clicking a leaf REPLACES store.filter with one slice (clearing the others); FilterChip × is the per-slice clear affordance for multi-axis composition. "全部" leaf resets BOTH filter AND searchQuery. Collapsible groups use native <details>/<summary> + Tailwind group-open: variants (no shadcn Accordion dependency)
- **04d**: GameCard right-click menu extended with 收藏 toggle (label flips on game.is_favorite) + 通关状态 submenu (4 items, current status disabled as visual cue); new optional onMutated callback flows up to GameGrid → Library so the post-mutation refetch knows the active search/sort/filter triple. STATUS_SUBMENU array at module scope keeps locked Chinese copy auditable
- **04d**: MetadataPicker.onApply + GameGrid.onRefreshCover migrated from listGames to searchGames-with-current-store-snapshot (Rule 1 — 04d-induced regression fix); without this, applying metadata or refreshing cover while a filter was active would silently replace the grid with the unfiltered set. MetadataPicker also now refreshes getSidebarCategories() because new metadata can introduce previously unseen brand / release_year buckets
- **04d**: New "无匹配结果" empty state for filter-narrowed-to-zero (Rule 2 — missing critical UX); existing empty states (noScanYet / scanFinishedZeroResults) gated on `!hasActiveSearch && !hasActiveFilter` so they only fire in their genuine case
- **04e**: StarRating half-precision via pure pointer geometry (`(starIndex * 2) + (clientX < rect.width/2 ? 1 : 2)` → 1..=10) — no precomputed half-zones; readonly when `onChange` omitted; click on current value clears for inline undo (idempotent UX without forcing × button click)
- **04e**: TagPicker staged-commit model — local `Set<number>` tracks selection while popover is open; closing the popover commits diff via `setGameTags(gameId, ids)` ONCE. Avoids one round-trip per checkbox toggle. "创建新标签" path immediately persists so Esc-close doesn't lose the new tag id even before the explicit popover-close commit
- **04e**: Detail Tabs `defaultValue="summary"` with `variant="line"` indicator (5 triggers); status Select moved to hero (daily-use path), 设置 tab owns config-only saves with explicit '保存' button (split out from P3's bundled save+launch). 简介 markdown synthesizer (`buildSummaryMarkdown(game)`) is a placeholder — replace with `game.summary` when META phase adds the column to schema
- **04e**: Notes autosave debounce 800ms via `useEffect [notes]` setTimeout cleanup; `notesHydratedRef` flag suppresses the autosave that would otherwise fire once after `listGames` hydrate (initial load isn't a user edit). "已保存 N 秒前" label driven by 1Hz `setInterval` ticking `nowTick: number` (not stored as a string per-second — keeps re-renders cheap). Sessions list auto-refetches via `prevActiveRef` when activeSession→null for THIS game so just-completed row appears without manual reload (Rule 2)
- **04f**: TagManager single editing-state slot pattern (`editing: EditState | null`) — only one row enters edit mode at a time; "添加标签" button opens draft row with `id: null` sentinel that flows through the SAME commit code path (createTag if id===null else updateTag). Avoids two concurrent draft rows that would confuse cancel/save semantics
- **04f**: 8 preset Tailwind-named hues stored as hex literal in tags.color: slate/blue/emerald/amber/rose/violet/orange/pink (v3 *-500 shades). ColorSwatchPicker is a stateless `role="radiogroup"` of round buttons with `aria-checked` + ring-on-active styling — matches the eventual sidebar dot rendering 1:1 (visual consistency between Settings → sidebar)
- **04f**: Default-sort persistence via localStorage key `gal-lib:default-sort` with `loadDefaultSort()` exported helper that whitelist-validates against the SortBy enum (defends against corrupt writes / future schema changes). Plan permitted localStorage-OR-config.json; chose localStorage to avoid adding new Tauri commands for a UI-only preference. Theme row rendered as disabled hint span (`opacity-60`) rather than disabled Switch because shadcn install lacks Switch and a disabled Toggle would visually imply a togglable surface that misleads users about Phase-5 deferral
- **04f**: All Phase 4 plans (04a–04f) green; full REQ-ID coverage LIB-03/04/05/07 + TAG-01..04 + STAT-01..04. Settings.tsx final layout: 4 sections (扫描根目录 / Locale Emulator / 扫描操作 / 标签管理 / UI 偏好) under shared `<ScrollArea>` + `max-w-[720px]` + `space-y-8` container. Existing P2/P3 sections untouched per plan guardrail
- **05a**: Schema v5 = 2 ALTER TABLE games ADD COLUMN (screenshot_interval_sec INTEGER NOT NULL DEFAULT 300 / save_path TEXT) + 2 CREATE TABLE (screenshots / save_backups, both with FK ON DELETE CASCADE on game_id) + 2 CREATE INDEX on game_id + UPDATE app_meta schema_version='5'; v5 migration test counts non-comment ADD-COLUMN/CASCADE lines (mirroring v3/v4 pattern) — protects against the migration's own header doc-comment polluting substring counts
- **05a**: Phase 5 dep lockup once at foundation step — Rust `screenshots = 0.8` (Windows DXGI/GDI fallback for desktop capture, 05b SHOT-01) + `png = 0.17` (pure-Rust encoder, no external libpng, 05b frame encode) + npm `recharts ^2.12` (resolved 2.15.4 — explicit pin to ^2.12 because default `pnpm add recharts` pulled v3.8.1, plan must_haves spec wins, 05d STATS-01/02 charts)
- **05a**: schema-bump test pattern lock-in — `m{N}.sql.contains("schema_version") && m{N}.sql.contains("'{N}'")` (split-grep) NOT `contains("schema_version = '{N}'")` because actual SQL is `UPDATE app_meta SET value = '{N}' WHERE key = 'schema_version';` (key/value on opposite sides of clause). v4 test was using the equivalent split form; v5 test now mirrors it. Three Rule-1 test-assertion bugs caught & fixed iteratively before final commit (cascade count off-by-one, schema_version assertion form, prior-version `len == N` exact-equal blocking growth)
- **05b**: PNG encoding via `png` crate directly (NOT `image::ImageBuffer::write_to`) — `screenshots = 0.8.10` re-exports `image = 0.24` internally, project root pulls `image = 0.25`; the two image versions ship distinct `RgbaImage` types so cross-version method calls don't compile. Streaming `raw RGBA → BufWriter<File> → png::Encoder` (Rgba color, Eight bit-depth) avoids the conversion entirely and is more memory-efficient (4K frame: ~32MB raw → ~5MB encoded; no intermediate Vec<u8> for either)
- **05b**: Shared `Arc<AtomicBool>` cancel flag between paired tokio tasks (wait-for-exit + screenshot-interval). Flag flips ONCE per session at every terminal transition (end_session/mark_failed/launch-failed); screenshot loop checks via Relaxed-load at each interval tick and breaks out. AtomicBool over watch::channel/Notify because: flip-once gate, no async surface required at the read side, single-instruction load on the consumer. Documented trade-off: `JoinHandle::abort()` from end_active_session may leave one stale capture before the screenshot task notices (worst case 5min for default settings) — accepted; alternative cost is +50 bytes per session and serial-mutex contention
- **05b**: Screenshot interval lower-bound clamp (60s) lives in orchestrator (`interval_sec.max(60)`), NOT in the `set_screenshot_interval` validator. Rationale: keep the user-facing setting freely settable; clamp at the consumer so future per-game UI doesn't have to know about the floor. 0 still means 'disabled' and skips the task spawn entirely (no wasted runtime)
- **05b**: `get_playtime_trend(period, days)` whitelists strftime format string (daily=`%Y-%m-%d`, weekly=`%Y-W%W` ISO-ish, monthly=`%Y-%m`) — never interpolates user input. SQL window via `datetime('now', '-N days')` modifier (parameter-bound). Filters `status IN ('completed','cancelled')` (the only states with non-zero duration_sec); skips 'starting' and 'launch_failed' to keep GROUP BY result smaller on big libraries
- **05b**: Filesystem+DB dual-write protocol — DELETE (screenshot/backup): row first, then best-effort fs::remove_file/fs::remove_dir_all (orphan files preferred to orphan rows; DB is source of truth). CREATE (backup): filesystem first, then INSERT (so half-written tree never gets a row). Restore: overwrites live save dir without auto-backup-first (frontend confirm dialog is the consent gate; CONTEXT § Save Backup explicitly OK'd 'warn 用户' approach)
- **05b**: Tauri command count = 43 (31 prior + get_data_dir + 12 new in 05b). Plan's must_haves stated "44 (32 prior + 12 new)" — off-by-one in the prior count (likely included a non-handler `manage` registration). Functional correctness criterion (all 12 new commands wired) verified via grep; the count discrepancy is a plan-level artifact, not a functional gap
- **05c**: Frontend invoke layer for Phase 5 = 3 new files (`src/lib/stats.ts` / `src/lib/screenshots.ts` / `src/lib/saves.ts`) wrapping all 12 backend commands as typed `invoke<T>` calls; TS shape mirrors Rust struct serialization (snake_case preserved, no `rename_all`); Zustand store extended with 4 new slices (trend / topGames / screenshotsByGame / saveBackupsByGame) + setters following existing `setSessionsForGame`-style per-game keyed Records; setters NOT auto-fetching (purely state-holding store, UI owns lifecycle — matches 03/04 conventions)
- **05d**: Stats route at `/stats` is the FIRST consumer of the `trend` + `topGames` store slices wired in 05c; renders period select (每日/每周/每月) + AreaChart trend + horizontal BarChart top-15. Read-only page, only side-effect = the two stats invokes on period change. Period→days mapping locked: daily=30, weekly=84, monthly=365 (chosen so each bucket renders ~12-30 readable points). Recharts color tokens centralized via CSS vars (hsl(var(--ring)) for series + hsl(var(--muted-foreground)) for axes + hsl(var(--card)) for tooltip bg) — coherent with shell theme. Sidebar 统计 nav rendered as sibling button (NOT NavLink) above 设置 with identical class composition — keeps shadcn-free convention used elsewhere in Sidebar; order locked by 05-CONTEXT §Stats Page
- **05e**: 7-tab Detail (rejected the 5-tab + sub-tab option from 05-CONTEXT; the 7 tabs all carry direct domain meaning, none are utility tabs that would benefit from grouping) — shadcn TabsList variant="line" renders 7 triggers cleanly within the existing 960px max-width. ScreenshotsTab uses `<span role="button">` for hover-overlay action buttons (NOT nested `<button>`) because the parent thumbnail tile is itself a `<button>` for click-to-lightbox — avoids React's "button cannot be a descendant of button" warning while preserving keyboard parity (tabIndex/aria-label/onKeyDown for Enter/Space). Lightbox is a single shadcn Dialog (no carousel / keyboard nav per 05-CONTEXT P5-simplified decision; carousel deferred to Phase 6+). Tauri plugin-dialog directional API: open({directory:true}) for save_path picker; save({filters:[PNG]}) for screenshot export — both return null on user-cancel and are null-checked before invoke. screenshot interval Select binds to STRINGIFIED seconds (Radix v1 Select only accepts string values); options 60/300/600/1800/0=关闭 with 0 mapping to backend's "disabled" sentinel handled inside set_screenshot_interval. Filesystem-derived metadata (file_count, total_size_bytes) NEVER recomputed in frontend — backend stores them at backup time and SavesTab reads from the row, so the table doesn't re-walk the dir on every render. **Rule-2 reader** `get_save_path(game_id)` added (~22 lines): plan said "no backend changes" but `set_save_path` had no symmetric reader — without it, SavesTab Input would render empty after every restart despite `games.save_path` being correctly persisted; the alternative (extending row_to_game with save_path/screenshot_interval_sec) was rejected to keep the public Game type lean and avoid downstream type changes. **Phase 5 / v1 milestone complete.**

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 20260509 | display fallbacks + clickable BGM/VNDB links + name-search buttons (incl. precursor commit dropping the hero band 1a59fdc) | 2026-05-09 | 1d54c27 | [20260509-display-fallbacks-and-source-links](./quick/20260509-display-fallbacks-and-source-links/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| CSS warning | D-04a-1: vite/postcss `@import './styles/titlebar.css'` order warning in `src/index.css:72` (pre-existing P1/P3 carryover; full notes in `.planning/phases/04-library-polish/deferred-items.md`) | Open | 04a |

## Session Continuity

Last session: 2026-05-08T00:00:00Z
Stopped at: Completed 05-05e-PLAN.md (Phase 5 wave 5/5 FINAL — Detail page extensions: ScreenshotsTab + SavesTab + 截图间隔 select in 设置 tab); 29/29 plans done. **v1 milestone complete.**
Resume file: None
