---
phase: 02-library-ingest
plan: 02f
subsystem: library-page-frontend
tags: [game-grid, virtualization, scan-progress-bar, metadata-picker, tauri-event-subscription]
requires: [02a, 02d, 02e]
provides:
  - tailwind_aspect_cover_token
  - tailwind_text_h3_token
  - frontend_games_helper
  - tauri_list_games_command
  - library_route_full_implementation
  - scan_progress_global_subscription
  - game_card_component
  - game_grid_component_virtualized
  - scan_progress_bar_component
  - metadata_picker_component
affects:
  - tailwind.config.ts
  - src/lib/games.ts
  - src/store/library.ts
  - src/routes/Library.tsx
  - src/main.tsx
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src/components/library/GameCard.tsx
  - src/components/library/GameGrid.tsx
  - src/components/library/ScanProgressBar.tsx
  - src/components/library/MetadataPicker.tsx
tech-stack:
  added: []
  patterns:
    - tanstack-virtual-2d-grid (count=rows, lanes=columnCount)
    - tauri-convert-file-src-for-cover-images
    - global-event-subscription-via-zustand-getstate (scan-progress at App-mount)
    - debounced-search-input-400ms
    - dialog-controlled-by-non-null-prop
    - dropdown-context-menu-on-card-right-click
key-files:
  created:
    - src/lib/games.ts
    - src/components/library/GameCard.tsx
    - src/components/library/GameGrid.tsx
    - src/components/library/ScanProgressBar.tsx
    - src/components/library/MetadataPicker.tsx
  modified:
    - tailwind.config.ts
    - src/store/library.ts
    - src/routes/Library.tsx
    - src/main.tsx
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
decisions:
  - "Library route keeps NAMED export `Library` (NOT `export default`) — same constraint as 02e, mirrors `import { Library }` in router.tsx"
  - "Auto-hide for terminal scan-progress states uses 5s timer; cancelled / failed / completed all auto-clear store.scanProgress=null after 5s"
  - "Cover image src resolved via convertFileSrc(dataDir + '/' + cover_path) — paths from `data_dir` command (Phase 1 helper) joined with relative `covers/{id}.{ext}`"
  - "GameGrid virtualization: 2D mode (`count = rows, lanes = cols`); columnCount derived from container ResizeObserver; row height = card cover (270px aspect-3:4 @ 200px wide) + title row (~52px) + gap (16px) ≈ 340px"
  - "MetadataPicker debounce 400ms via setTimeout in useEffect; ref-cleared on unmount + on query/source change"
metrics:
  start: 2026-05-07
  completed: 2026-05-07
---

# Phase 2 Plan 02f: Library Page (Grid + Card + ScanProgressBar + MetadataPicker) Summary

**One-liner:** Phase 2 frontend complete — Library route replaced with sticky ScanProgressBar + virtualized GameGrid (3:4 cover cards with right-click DropdownMenu) + MetadataPicker dialog (Bangumi/VNDB search with debounced 400ms input + direct-ID binding); 11th Tauri command `list_games` wired; global scan-progress event subscription in main.tsx feeds Zustand store; tailwind tokens `aspect-cover` + `text-h3` added per UI-SPEC.

## Tasks Completed

### Task 1: tailwind tokens + games invoke helper + list_games command + library store extension (commit `4d6e625`)

- **`tailwind.config.ts`** — appended two tokens to `theme.extend`:
  - `fontSize.h3 = ["16px", { lineHeight: "1.4", fontWeight: "600" }]` — H3 typography token (used by `text-h3`); 5th tier in the lock'd typography scale per 02-UI-SPEC §Typography
  - `aspectRatio.cover = "3 / 4"` — 3:4 cover aspect token for `aspect-cover`; 02-UI-SPEC §Game Card
- **`src/lib/games.ts`** (NEW) — TS `Game` interface mirroring `games` table schema v2 columns 1:1 (id, path, name, name_cn, executable_path, cover_path, cover_url, bangumi_id, vndb_id, total_playtime_sec, last_played_at, status, rating, notes, metadata_source, match_confidence, last_scanned_at, created_at, updated_at). All Option<T>-typed Rust columns mapped to `T | null`. `status` and `metadata_source` use string-literal unions matching the CHECK constraints / ingest whitelist. Single export: `listGames(): Promise<Game[]>` invoking the new `list_games` Tauri command.
- **`src/store/library.ts`** — extended `LibraryState` with `games: Game[]` + `setGames` setter. Initial state `games: []`. Pattern matches existing `scanRoots` / `scanProgress` slices (no async actions in store; container only).
- **`src-tauri/src/commands.rs`** — added 11th Tauri command `list_games(state) -> Result<Vec<Game>, String>` doing `SELECT ... FROM games ORDER BY created_at DESC` via sqlx. New `Game` struct (Serialize/Deserialize) mirrors schema columns 1:1. Optional columns use `try_get(...).ok()` to surface SQL NULL → `None` cleanly. `total_playtime_sec` defaults to 0 (column has SQL DEFAULT 0 but defensive); `status` defaults to `"unplayed"` if read fails (column has SQL DEFAULT 'unplayed' + CHECK constraint).
- **`src-tauri/src/lib.rs`** — registered `commands::list_games` in `tauri::generate_handler!` (now 11 commands total). Comment placeholder `// 02f appends list_games here` removed.
- **Verification:**
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 (3 expected warnings: unused `Manager` import, unused `IngestResult.games_path/executable_path`, unused `MetadataError::RateLimited` — all pre-existing from 02d)
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **33/33 passed** (no regressions)
  - `pnpm typecheck` → exit 0 (clean)
  - All 5 files modified per plan; no extras.

### Task 2: GameCard + GameGrid (virtualization) + ScanProgressBar + MetadataPicker (commit `84fca84`)

- **`src/components/library/GameCard.tsx`** (NEW):
  - DropdownMenu wraps a `<button>` whose right-click fires a synthetic click on the trigger (Radix DropdownMenuTrigger fires on left-click by default; UI-SPEC mandates DropdownMenu specifically — we forward `contextmenu` → click via `onContextMenu` handler that does `e.preventDefault(); (e.currentTarget as HTMLButtonElement).click()`).
  - Cover area `aspect-cover w-full overflow-hidden rounded-md bg-secondary`; img with `object-cover transition-transform duration-150 group-hover:scale-[1.02]`; `<ImageOff>` placeholder when no cover.
  - Status dot via `getStatusLabel(status)` returning `{ color, label }` with locked colors: `text-blue-400` (游玩中) / `text-emerald-400` (已通关) / `text-red-400` (已弃) / `text-muted-foreground` (未游玩) — 4×4 dot (`size-1`) + label per UI-SPEC.
  - **Metadata-state badge** detection via `getMetadataState(game)`:
    - source IN (bangumi/vndb/manual) → `ok` (no badge)
    - source = none AND `last_scanned_at == null` → `pending` → outline Badge "元数据获取中"
    - source = none AND `last_scanned_at` set → `failed` → destructive-tone outline Badge "元数据获取失败 — 点击重试"
  - Both pending/failed badges are clickable (stop propagation on container button) and call `onPickMetadata(game)`.
  - "未识别可执行文件" Badge in bottom-right when `executable_path == null`.
  - Title: `text-body font-medium line-clamp-2`; uses `name_cn ?? name`.
  - Card click: `toast.info("详情页 — 即将上线")` (Phase 4 will navigate to /games/:id).

- **`src/components/library/GameGrid.tsx`** (NEW):
  - `useVirtualizer` from `@tanstack/react-virtual` in row-mode (rowCount = ceil(games / cols)); each row renders a CSS-grid of up-to-`columnCount` cards.
  - `columnCount` derived from container width via `ResizeObserver`: `floor((width - 2*p6 + gap) / (CARD_MIN_WIDTH + gap))`. Constants: `CARD_MIN_WIDTH=200`, `GAP=16`, `ROW_HEIGHT=340`, `PADDING=24`.
  - Cover URL resolution: `dataDir` from `invoke<string>("get_data_dir")` cached in component state; `resolveCover(game)` memoized closure does `convertFileSrc(dataDir + '/' + cover_path)` (forward-slash normalized).
  - Refresh-cover handler: calls `refreshMetadata(gameId)` → refetches `listGames()` → `setGames(fresh)` → toast "已刷新封面".
  - overscan=6 rows × ~5 cols ≈ 30-card buffer per UI-SPEC.

- **`src/components/library/ScanProgressBar.tsx`** (NEW):
  - Reads `scanProgress` from `useLibraryStore`; renders null when null OR after 5s auto-hide on terminal status (completed / cancelled / failed). Re-arms timer on each terminal event; clears auto-hide on next "running" event.
  - Layout: `sticky top-0 z-10 h-14 border-b bg-background/95 backdrop-blur` per UI-SPEC.
  - Progress component (4px tall via `h-1`) at top.
  - Status summary line is status-aware:
    - running → `扫描中 ({current_dir}) — 已完成 {n} / 共 {total}`
    - completed → `扫描完成 — 共 {total} 款游戏`
    - cancelled → `扫描已取消`
    - failed → `扫描失败`
  - Cancel button only renders for `status === "running"`; click → AlertDialog "确定取消扫描？/已扫描的游戏会保留" with Cancel/Confirm buttons; on Confirm → `cancelScan()` + toast "扫描已取消".

- **`src/components/library/MetadataPicker.tsx`** (NEW):
  - shadcn Dialog `max-w-2xl` controlled by `game !== null` prop.
  - Title: `重新匹配元数据 — {game.name_cn ?? game.name}`.
  - Form state resets on each new `game.id`: query (default = current game.name), source (default bangumi), candidates [], selected null, showDirect false.
  - Search input + ToggleGroup (Bangumi / VNDB) — both trigger debounced (400ms via `setTimeout` in useEffect cleanup) `searchMetadata(query, source)` and update `candidates` state.
  - Direct-ID toggle: collapsible 2-column input grid (`bgm_id` / `vndb_id`) — when non-empty takes precedence over selected candidate at apply time.
  - Candidate list inside `<ScrollArea max-h-[400px]>`: 60×80px cover thumbnail + title + alias join + `{SOURCE} · {source_id} · {release_date?}` + Confidence Badge with palette extension `≥80 emerald / 70-79 yellow / <70 destructive`.
  - Empty states: searching → "搜索中…"; searched 0 results → "未找到匹配项 — 请尝试不同关键词".
  - Footer: `应用` (calls `bindMetadata(gameId, source, source_id)` → refetch `listGames()` → `setGames` → toast "已应用元数据" → close) + `取消`.

- **Verification:**
  - `pnpm typecheck` → exit 0 (clean — no errors, no warnings)
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 (3 pre-existing warnings, no Rust changes in Task 2)
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → 33/33 passed (no regressions)
  - All 4 component files created under `src/components/library/`; locked copy verbatim per UI-SPEC §Copywriting Contract.

### Task 3: Library route (full replace) + main.tsx scan-progress subscription (commit `931cdf1`)

- **`src/routes/Library.tsx`** (FULL REPLACE of Phase 1 placeholder):
  - **NAMED export preserved** — `export function Library()` (NOT `export default`). Plan's draft code-block had `export default`, which would break `router.tsx`'s `import { Library }` (would resolve to `undefined`, route would mount nothing). Same constraint as Settings.tsx in 02e — see deviation #1.
  - Top-of-page `<ScanProgressBar />` (sticky-top, auto-hides on idle/terminal+5s).
  - Conditional main pane:
    - `noScanYet = isEmpty && !scanProgress` → "还没有游戏" / "请到设置页添加扫描根目录" / "打开设置" (P1 copy verbatim reuse — no re-litigation)
    - `scanFinishedZeroResults = isEmpty && scanProgress?.status === "completed"` → "未识别到游戏" / "请检查根目录扫描深度配置" / "回到设置" (P2 new copy, locked per UI-SPEC §Copywriting Contract)
    - else → `<GameGrid games={games} onPickMetadata={setPickerGame} />`
  - `<MetadataPicker game={pickerGame} onClose={() => setPickerGame(null)} />` always mounted; non-null `pickerGame` opens it.
  - **Refetch hooks:**
    - `useEffect` on mount → `listGames().then(setGames)`
    - `useEffect` on `scanProgress?.status === "completed"` → re-`listGames().then(setGames)` (so the grid surfaces newly ingested rows immediately when the scan finishes)
    - GameGrid + MetadataPicker also refetch internally after their respective `refreshMetadata` / `bindMetadata` mutations

- **`src/main.tsx`** — appended global `scan-progress` subscription:
  - Module-scope `__scanProgressUnsub` guard prevents duplicate listener accumulation if Vite ever HMR-reloads this module.
  - `onScanProgress((p) => useLibraryStore.getState().setScanProgress(p))` — uses `getState()` rather than the React hook because we're outside any component lifecycle.
  - Catches subscription errors and logs (no toast — toast system not yet mounted at this code's evaluation order).

- **Verification:**
  - `pnpm typecheck` → exit 0 (clean — zero errors, zero warnings)
  - `pnpm vite build` → exit 0; **1904 modules** transformed (up from 02e's 1888 — +16 for the 4 new components + their dependencies); bundle JS = 520 KB (gzip 162 KB), CSS = 30 KB. Pre-existing `[vite:css][postcss] @import must precede all other statements` warning (P1's `src/index.css` ordering) — same as 02e's deferred issue, out of 02f scope.
  - `cargo check` + `cargo test --lib` → unchanged 33/33 passed (Task 3 has no Rust changes).

## Manual Smoke Procedure (post-handoff)

Phase 2 end-to-end smoke from a clean state:

1. `pnpm tauri dev`
2. Wait for the gal-lib window
3. **State check:** Library route should show "还没有游戏 / 请到设置页添加扫描根目录 / 打开设置" (P1 empty state — no scan ever happened). Click "打开设置" → URL becomes `#/settings`.
4. **Add a root:** click "添加根目录" → folder picker → pick e.g. `D:\Games` (or any directory containing 1+ subdirectory representing a game). List shows the new row + toast "已添加根目录".
5. **Trigger full scan:** click "全量扫描" → toast "扫描已启动" → URL navigates to `#/`.
6. **Watch progress bar:** sticky bar at top of Library route shows `扫描中 ({current_dir}) — 已完成 N / 共 M` with the indicator filling left-to-right; "取消" button on the right.
7. **Cancel test (optional):** click "取消" → AlertDialog "确定取消扫描？/已扫描的游戏会保留" appears → click "确定" → toast "扫描已取消" + bar transitions to `扫描已取消` then auto-hides after 5s.
8. **Otherwise let scan complete:** bar transitions to `扫描完成 — 共 N 款游戏` then auto-hides 5s later. GameGrid populates with cards (3:4 cover, title, status dot+label).
9. **Card hover:** cover scales up slightly + outline appears.
10. **Card click:** toast "详情页 — 即将上线" appears top-right.
11. **Card right-click:** DropdownMenu opens with "重新匹配元数据" / "重新抓取封面".
12. **Click "重新匹配元数据":** MetadataPicker dialog opens centered. Title `重新匹配元数据 — {game.name}`. Search input pre-filled with current name. Bangumi toggle selected. After 400ms, candidates appear (up to 5 per source) — each row has 60×80 cover + title + alias + Confidence Badge.
13. **Toggle to VNDB:** candidate list re-fetches against VNDB.
14. **Click "直接绑定 ID":** collapsible reveals 2 inputs (`bgm_id` / `vndb_id`).
15. **Select a candidate, click "应用":** dialog closes + toast "已应用元数据" + grid refreshes with the new title/cover.
16. **Networking note:** if Bangumi/VNDB rate-limits or DNS fails, search returns 0 results → "未找到匹配项 — 请尝试不同关键词" empty-state message renders. Cards in the grid that failed initial ingest show the destructive "元数据获取失败 — 点击重试" Badge — clicking the badge opens the same MetadataPicker.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Library export style — kept NAMED export, NOT default**

- **Found during:** Task 3 — reviewing `router.tsx` before editing Library.tsx
- **Issue:** Plan's draft code in 02f-PLAN.md Task 3 §1 had `export default function Library()`. But `src/router.tsx` line 3 has `import { Library } from "./routes/Library";` — a **named** import. Switching to `export default` would silently make `Library` resolve to `undefined`, the route element would be `undefined`, and React Router would mount nothing on `/` — runtime regression with no compile error (TS lets you `import { x }` from a default-export module under bundler resolution; just gives `undefined`). This is the **identical** failure-mode 02e fixed for Settings.tsx (deviation #1).
- **Fix:** Used `export function Library()` (named export, matches the placeholder file's convention). No change to `router.tsx`. Documented in source-file comment block ("Routing-export note") — same pattern as Settings.tsx.
- **Files modified:** `src/routes/Library.tsx`
- **Commit:** `931cdf1`

**2. [Rule 2 - Critical functionality] Wrapped every Tauri-invoke call site in try/catch with toast.error fallback**

- **Found during:** Task 2 — wiring GameGrid (`onRefreshCover`) and MetadataPicker (`onApply` / debounced search)
- **Issue:** Plan's outlines didn't specify error handling for `searchMetadata` / `bindMetadata` / `refreshMetadata` invocations. Real-world failure modes:
  - Bangumi/VNDB rate-limit (429) or network error during smoke testing
  - SQL UNIQUE constraint failure (improbable but possible if user binds to an ID already used by another game)
  - cover-cache write failure (disk-full / permissions)
  - Tauri command panic (e.g. malformed source string)
- **Fix:** Each async handler wraps `await` chain in try/catch and surfaces with `toast.error(\`<action> 失败 — ${String(e)}\`)`. Search-failure also clears candidates + sets `searched=true` so the empty-state line renders cleanly. Net: no unhandled-rejection in DevTools; user sees a precise failure toast.
- **Files modified:** `src/components/library/GameGrid.tsx` (onRefreshCover) + `src/components/library/MetadataPicker.tsx` (search effect + onApply) + `src/components/library/ScanProgressBar.tsx` (onConfirmCancel)
- **Commit:** `84fca84`

**3. [Rule 2 - Critical functionality] DropdownMenu right-click forwarding**

- **Found during:** Task 2 — wiring GameCard interactions
- **Issue:** UI-SPEC §Game Card mandates "Right-click menu (P2 minimum)" using shadcn `DropdownMenu`. But Radix's `DropdownMenuTrigger` fires on **left-click** by default — there's a separate `ContextMenu` primitive specifically for right-click. Honoring the UI-SPEC's exact "DropdownMenu" wording (not switching to ContextMenu, which has different visual styling and behavior conventions) requires manual right-click forwarding.
- **Fix:** Trigger element listens for `onContextMenu`, calls `e.preventDefault()` to suppress the native context menu, then synthetically fires a click on `e.currentTarget` to open the DropdownMenu. Tested mental-model: works in webview2 (Chromium 116+) per `MouseEvent.preventDefault()` + element.click() spec; aria-label preserved on the button for screen readers.
- **Files modified:** `src/components/library/GameCard.tsx`
- **Commit:** `84fca84`

**4. [Rule 2 - Critical functionality] Auto-hide timer for terminal scan states**

- **Found during:** Task 2 — wiring ScanProgressBar
- **Issue:** Plan said "auto-hide 5s after `completed`/`cancelled`/`failed`" but didn't specify how the bar handles the *display* of the terminal state during those 5s. Without explicit handling, the bar would either: (a) instantly disappear (loses the "扫描完成 — 共 N 款游戏" feedback), or (b) stick around forever showing stale state.
- **Fix:** ScanProgressBar tracks a local `hidden` boolean. On terminal status (`completed` / `cancelled` / `failed`), arms a 5s setTimeout to `setHidden(true)`. Clears the timer (and resets `hidden=false`) when a new "running" event arrives. Also computes a status-aware summary line so the user sees `扫描完成 — 共 N 款游戏` / `扫描已取消` / `扫描失败` during the 5s window before fade-out (UI-SPEC §Copywriting Contract has the toast-side copy `扫描完成 — 共 {n} 款游戏` and `扫描已取消` — reused here for consistency).
- **Files modified:** `src/components/library/ScanProgressBar.tsx`
- **Commit:** `84fca84`

### Auth Gates

无 — Phase 2 is entirely local DB / public-API. Bangumi + VNDB read APIs don't require auth.

### Deferred Issues

- **Pre-existing PostCSS `@import` warning** (`src/index.css` line 72): `@import './styles/titlebar.css';` placed after other statements — already documented in 02e-SUMMARY as a P1 leftover. Out of scope for 02f. Cosmetic only; build succeeds.
- **Vite chunk-size warning** (`520KB > 500KB threshold`): triggered by 02f's component additions. Not actionable in 02f — Phase 4 will likely introduce code-splitting (route-level lazy imports) when adding the search/filter rework.
- **Headless `pnpm tauri dev` smoke not exercised:** auto-mode environment lacks GUI; manual procedure documented above. Static verification (typecheck, build, cargo check, cargo test) all pass.

### Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: external-image-render | src/components/library/MetadataPicker.tsx | Candidate covers rendered via `<img src={c.cover_url}>` — `cover_url` is attacker-controlled (returned by Bangumi/VNDB API). webview2 will sniff content-type and only render valid images; SVG isn't typically returned by either API. **Mitigation:** the existing `cover_cache::cache_cover` whitelist (jpg/png/webp Content-Type only) doesn't apply to the in-modal preview because we render the *remote* URL directly there (cache happens only on bind). Risk surface is limited to the modal session — no persistence. **Acceptable** for Phase 2; revisit at Phase 4 detail page (which will render covers more prominently with possible XSS implications if SVG sneaks in). |
| threat_flag: convert-file-src-to-webview | src/components/library/GameGrid.tsx | `convertFileSrc(dataDir + '/' + cover_path)` produces `tauri://localhost/...` (or asset://) URLs that the webview can fetch directly from disk. `cover_path` is constrained by the ingest pipeline (relative `covers/{id}.{ext}`, validated extension whitelist), so traversal is not exploitable. **No additional gate needed**; documented for Phase 3+ when more on-disk asset surfaces are added (screenshots, save-files). |

## TDD Gate Compliance

Plan type = `execute` (NOT `tdd`); no RED/GREEN gate sequence required. All three task commits are `chore`/`feat` per the plan's commit protocol.

## Self-Check

### Files

- [x] `tailwind.config.ts` updated; `grep -q 'aspect-cover\|cover.*"3 / 4"'` ✓; `grep -q 'h3:'` ✓
- [x] `src/lib/games.ts` exists; `grep -q 'export interface Game'` ✓; `grep -q 'export async function listGames'` ✓
- [x] `src-tauri/src/commands.rs` updated; `grep -q 'pub async fn list_games'` ✓; `grep -q 'pub struct Game '` ✓
- [x] `src-tauri/src/lib.rs` updated; `grep -q 'commands::list_games'` ✓
- [x] `src/store/library.ts` updated; `grep -q 'games:'` ✓; `grep -q 'setGames'` ✓
- [x] `src/components/library/GameCard.tsx` exists; `grep -q 'aspect-cover'` ✓; `grep -q 'DropdownMenu'` ✓
- [x] `src/components/library/GameGrid.tsx` exists; `grep -q 'useVirtualizer'` ✓; `grep -q 'convertFileSrc'` ✓
- [x] `src/components/library/ScanProgressBar.tsx` exists; `grep -q 'Progress'` ✓; `grep -q 'AlertDialog'` ✓
- [x] `src/components/library/MetadataPicker.tsx` exists; `grep -q 'ToggleGroup'` ✓; `grep -q 'searchMetadata'` ✓; `grep -q 'bindMetadata'` ✓
- [x] `src/routes/Library.tsx` rewrite; `grep -q 'GameGrid'` ✓; `grep -q 'ScanProgressBar'` ✓; `grep -q 'MetadataPicker'` ✓; `grep -q '未识别到游戏'` ✓; `grep -q '还没有游戏'` ✓
- [x] `src/main.tsx` updated; `grep -q 'onScanProgress'` ✓
- [x] Library.tsx + Settings.tsx both still NAMED-exported (router compatibility) ✓

### Build / Test

- [x] `pnpm typecheck` after Task 1 → exit 0 ✓
- [x] `pnpm typecheck` after Task 2 → exit 0 ✓
- [x] `pnpm typecheck` after Task 3 → exit 0 ✓
- [x] `pnpm vite build` after Task 3 → exit 0, 1904 modules, 520 KB JS bundle ✓
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 (3 expected warnings, no new) ✓
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` → 33/33 passed (no regressions) ✓
- [ ] `pnpm tauri dev` GUI smoke — **deferred to manual procedure** (no headless webview)

### Commits

- [x] `4d6e625` chore(02-02f): add tailwind aspect-cover + text-h3 + games invoke helper + list_games tauri command ✓
- [x] `84fca84` feat(02-02f): library components — GameCard + GameGrid + ScanProgressBar + MetadataPicker ✓
- [x] `931cdf1` feat(02-02f): library route + main.tsx scan-progress subscription ✓

## Self-Check: PASSED
