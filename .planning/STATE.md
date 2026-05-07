---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 03-03a-PLAN.md (Phase 3 schema v3 + winreg/sysinfo/windows-rs lockup; ready for 03b LE detector)
last_updated: "2026-05-07T14:07:32.000Z"
last_activity: 2026-05-07 -- Phase 3 plan 03a executed (schema v3 migration + Phase 3 Rust crates locked)
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 18
  completed_plans: 13
  percent: 72
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆
**Current focus:** Phase 2 — library ingest

## Current Position

Phase: 3 (launch-playtime) — IN PROGRESS
Plan: 1 of 6 complete (03a done — schema v3 + Rust crate lockup); next is 03b (LE detector)
Status: Ready to execute 03b
Last activity: 2026-05-07 -- Phase 3 plan 03a executed

Progress: [█████████░] 72% (13/18 plans complete; Phase 3 wave 1/6 done)

## Performance Metrics

**Velocity:**

- Total plans completed: 13 (Phase 1: 6 + Phase 2: 02a-02f + Phase 3: 03a)
- Average duration: ~30min/plan
- Total execution time: ~6.6 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation | 6 | ~3h | ~30min |
| 2. Library Ingest | 6 | ~3.5h | ~35min |
| 3. Launch & Playtime | 1/6 | ~6min so far | ~6min |

**Recent Trend:**

- Last 6 plans: 02b → 02c → 02d → 02e → 02f → 03a
- Trend: 03a was a fast foundation lockup (1 task, 1 atomic commit, 1 Rule-1 fix for over-strict ADD-COLUMN substring count, 1 Rule-1 fix for v2 test's len-equality assertion that would have flipped under v3)

*Updated after each plan completion*
| Phase 02 P02d | 75min | 3 tasks | 5 files |
| Phase 02 P02e | 30min | 2 tasks | 4 files |
| Phase 02 P02f | 35min | 3 tasks | 11 files (5 new + 6 modified) |
| Phase 03 P03a | 6min | 1 task | 4 files (1 new + 3 modified) |

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

Last session: 2026-05-07T14:07:32.000Z
Stopped at: Completed 03-03a-PLAN.md (Phase 3 wave 1/6 — schema v3 migration + winreg/sysinfo/windows-rs Cargo lockup)
Resume file: None
