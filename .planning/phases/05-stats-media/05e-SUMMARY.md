---
phase: 05-stats-media
plan: 05e
subsystem: frontend-detail-screenshots-saves-tabs
tags: [react, tauri, plugin-dialog, shadcn, zustand, screenshots, save-backup, alert-dialog, lightbox]
requires:
  - "05a (screenshot + save-backup commands in commands.rs)"
  - "05b (12 commands registered in lib.rs)"
  - "05c (src/lib/screenshots.ts + src/lib/saves.ts invoke wrappers + screenshotsByGame/saveBackupsByGame store slices)"
  - "P4 / 04e (Detail.tsx 5-tab layout — extended in-place to 7 tabs)"
provides:
  - "src/components/library/ScreenshotsTab.tsx — 3-col thumbnail grid + lightbox Dialog + hover export/delete"
  - "src/components/library/SavesTab.tsx — save_path picker + backup/restore/delete with confirm AlertDialogs + sized table"
  - "Detail.tsx 7-tab layout (简介/标签/笔记/会话历史/截图/存档/设置) + 截图间隔 Select in 设置 tab"
  - "Backend get_save_path command (Rule 2 deviation — symmetric reader for set_save_path so SavesTab can hydrate the read-only path Input on mount)"
  - "src/lib/saves.ts: getSavePath() invoke wrapper"
affects:
  - src/components/library/ScreenshotsTab.tsx (new, ~280 lines)
  - src/components/library/SavesTab.tsx (new, ~330 lines)
  - src/routes/Detail.tsx (+~80 lines: 2 imports + interval-options const + state + 2 effect lines + handler + 2 TabsTrigger + 2 TabsContent + 截图间隔 label/Select)
  - src-tauri/src/commands.rs (+~22 lines: get_save_path command)
  - src-tauri/src/lib.rs (+1 line: get_save_path registered in invoke_handler)
  - src/lib/saves.ts (+~13 lines: getSavePath wrapper)
tech-stack:
  added: []  # @tauri-apps/plugin-dialog ^2.7.1 already in package.json from earlier phases
  patterns:
    - "Tab component split by domain: ScreenshotsTab + SavesTab as standalone files in components/library/, mounted from Detail's TabsContent (mirrors P4 TagPicker/StarRating co-location)"
    - "Per-game store cache: screenshots/backups read from useLibraryStore.{screenshotsByGame,saveBackupsByGame} (05c slices); refetch helpers re-issue the list invoke after every mutation rather than optimistic-update — backend stays source of truth for file_count/total_size_bytes"
    - "Tauri plugin-dialog directional API: open({ directory: true }) for save_path picker; save({ filters: [PNG] }) for screenshot export — both return null on user cancel, null-checked before invoke"
    - "convertFileSrc(dataDir + relPath) for asset:// thumbnail src; backslash → forward-slash normalization for Windows paths (mirrors Detail.tsx hero cover pattern)"
    - "Hover-revealed action overlay: absolute inset-0 + group-hover:opacity-100 + e.stopPropagation() on action buttons so click-outside-button opens lightbox; role/tabIndex/aria-label on the inner span for keyboard parity"
    - "AlertDialog with asChild Button slot: shadcn AlertDialogAction wraps a typed Button (variant=destructive for delete; default for restore/backup) — onClick fires the mutation, AlertDialog auto-closes via onOpenChange null-set"
    - "Locked Chinese copy compliance: 截图 / 存档 / 还没有截图 — 启动游戏后将自动捕获 / 确定删除这张截图？/ 已删除截图 / 存档目录 / 选择... / 备份当前存档 / 确定备份？将复制存档目录到 data/saves/{game_id}/{timestamp}/ / 确定恢复此备份？将覆盖当前存档目录 / 已恢复存档 / 确定删除此备份？此操作不可恢复 / 还没有存档备份 — 配置存档目录后点上方按钮开始备份 / 截图间隔 / 60 秒 / 5 分钟 / 10 分钟 / 30 分钟 / 关闭 / 已设置截图间隔 / 已设置存档目录 — strings used verbatim per UI-SPEC contract"
    - "Screenshot interval Select binds to stringified seconds (Radix only takes string values); options 60/300/600/1800/0=关闭 with 0 mapping to backend's 'disabled' sentinel (clamped/handled inside set_screenshot_interval)"
    - "Bytes formatter (B/KB/MB/GB) inline in SavesTab — total_size_bytes is backend-computed at backup time so the table doesn't re-walk the dir for every render"
    - "save_path Input is readonly + paired with 选择... button; backed by getSavePath fetch on mount so users see their previously-configured path after a restart (Rule 2)"
key-files:
  created:
    - "src/components/library/ScreenshotsTab.tsx (~280 lines) — gallery + lightbox + hover actions + delete confirm"
    - "src/components/library/SavesTab.tsx (~330 lines) — path picker + backup-now button + 4-col table + 3 confirm dialogs"
  modified:
    - "src/routes/Detail.tsx — TabsList 5→7 + 2 new TabsContent + screenshot-interval Select in 设置 + getScreenshotSettings hydration + onSetScreenshotInterval handler + SCREENSHOT_INTERVAL_OPTIONS const"
    - "src-tauri/src/commands.rs — added get_save_path command (~22 lines, Rule 2 deviation)"
    - "src-tauri/src/lib.rs — registered get_save_path in invoke_handler"
    - "src/lib/saves.ts — added getSavePath() wrapper"
decisions:
  - "Rule 2 — added minimal `get_save_path` backend command. Plan said 'no backend changes but verify cargo check'; without a reader, the SavesTab's read-only path Input would be empty after every restart even though `games.save_path` is correctly persisted. The reader is the symmetric companion to the existing `set_save_path` writer (which already exists in 05a). Alternative considered: extend `row_to_game` in commands.rs to include save_path + screenshot_interval_sec — rejected because it would broaden the public Game type unnecessarily and require frontend type changes."
  - "Used 7 separate tabs (rejected the 5-tab + sub-tab option floated in 05-CONTEXT). Reason: the 7 tabs all have direct domain meaning (none are 'utility' tabs that would benefit from grouping), and shadcn TabsList variant='line' renders 7 triggers cleanly within 960px max-width — same width as P4."
  - "Lightbox is a single shadcn Dialog (no carousel / keyboard nav). Matches 05-CONTEXT 'P5 simplified — lightbox' decision; carousel deferred to Phase 6+."
  - "Hover-overlay action buttons use <span role='button'> rather than nested <button> to avoid React's 'button cannot be a descendant of button' validation warning (the parent thumbnail tile is itself a <button> for click-to-lightbox)."
  - "save-path picker uses plugin-dialog open({directory:true}). screenshot-export picker uses plugin-dialog save({filters:[PNG]}). Both wrappers null-check the user-cancel return per the v2 plugin-dialog typedef."
metrics:
  duration: "~22 min"
  tasks_completed: 1
  files_created: 2
  files_modified: 4
  completed_date: "2026-05-08"
---

# Phase 5 Plan 05e: Detail page extensions (Screenshots + Saves Tabs) Summary

**One-liner:** Extended Detail.tsx from 5 to 7 tabs by adding ScreenshotsTab (3-col thumbnail grid + click-to-lightbox + hover export/delete) and SavesTab (save_path picker + backup-now + restorable backup table), plus a 截图间隔 Select in the 设置 tab.

## What Got Built

### ScreenshotsTab.tsx (new, ~280 lines)

- **Mount:** calls `getScreenshots(gameId)` → caches into `useLibraryStore.screenshotsByGame[gameId]`. Loaded flag prevents empty-state flash during initial fetch.
- **Layout:** 3-col CSS Grid, aspect-square tiles, `convertFileSrc(dataDir + '/' + path)` for asset:// thumbnails; `<ImageOff>` fallback when `dataDir` not yet hydrated.
- **Hover overlay:** semi-transparent black/40 backdrop + 2 icon "buttons" (download for export, trash2 for delete) revealed on `group-hover` / `group-focus-visible`. Click events `stopPropagation()` so they don't trigger lightbox.
- **Lightbox:** shadcn `Dialog` with `max-w-[80vw]`, `<img>` at `max-h-[85vh] object-contain`. `DialogTitle` is `sr-only` for a11y.
- **Export:** `plugin-dialog.save({ filters: [PNG] })` → `exportScreenshot(id, target)` + toast.
- **Delete:** AlertDialog `确定删除这张截图？` → `deleteScreenshot(id)` + refetch + `已删除截图` toast.

### SavesTab.tsx (new, ~330 lines)

- **Mount:** calls `getSavePath(gameId)` (Rule 2 reader) and `listSaveBackups(gameId)` in parallel.
- **Top row:** readonly Input (binds to `savePath` local state) + `选择...` Button → `plugin-dialog.open({ directory: true })` → `setSavePath(gameId, picked)` + `已设置存档目录` toast.
- **备份当前存档** Button: disabled when `savePath` is empty; click opens AlertDialog `确定备份？将复制存档目录到 data/saves/{game_id}/{timestamp}/` → `createSaveBackup(gameId, null)` + refetch + `已备份存档` toast. Backend errors (e.g., "save path not configured") surface via `String(err)` in toast.
- **Backup table:** 4 cols (时间/文件数/大小/操作) with locale-formatted timestamp + bytes formatter (B/KB/MB/GB). Per-row 恢复 / 删除 buttons each open dedicated AlertDialogs:
  - 恢复 confirm `确定恢复此备份？将覆盖当前存档目录` → `restoreSaveBackup(id)` + `已恢复存档` toast (no list refetch — restore doesn't change rowset).
  - 删除 confirm `确定删除此备份？此操作不可恢复` → `deleteSaveBackup(id)` + refetch.
- **Empty state:** `还没有存档备份 — 配置存档目录后点上方按钮开始备份`.

### Detail.tsx changes

- **+2 TabsTrigger** (`截图`, `存档`) + **+2 TabsContent** rendering `<ScreenshotsTab />` and `<SavesTab game={game} dataDir={dataDir} />` between 会话历史 and 设置.
- **设置 tab gain:** added a **截图间隔** label + `Select` (60s / 5min / 10min / 30min / 关闭=0) bound to `screenshotInterval` state. Hydrated on mount via `getScreenshotSettings(gameId)`. `onValueChange` calls `setScreenshotInterval(gameId, Number(v))` + `已设置截图间隔` toast.
- **SCREENSHOT_INTERVAL_OPTIONS** const declared module-scope alongside existing `LE_PROFILES` / `STATUS_OPTIONS` for consistency.

### Backend (Rule 2 deviation — see "Deviations")

- **`get_save_path(game_id)`** command in commands.rs (~22 lines): SELECT `save_path` FROM games WHERE id = ?, returns `Option<String>`.
- Registered in `lib.rs` invoke_handler list.
- **`getSavePath(gameId)`** wrapper in `src/lib/saves.ts` (~13 lines).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added `get_save_path` backend command + frontend wrapper**

- **Found during:** Task 1 (planning the SavesTab data hydration)
- **Issue:** Plan said "no backend changes but verify cargo check". But `set_save_path` was the only command exposed in 05a/05b — no symmetric reader. `row_to_game` (in commands.rs) intentionally does NOT include `save_path` to keep the public `Game` type lean. Without a reader, the SavesTab's read-only path Input would always render empty after a restart, even though `games.save_path` is correctly persisted by `set_save_path`. Users would have to re-pick their save dir on every app launch — clearly a regression vs. expected functionality.
- **Fix:** Added a minimal `get_save_path(game_id) -> Option<String>` command (22 lines incl. doc comment), registered it in `lib.rs`, and added a `getSavePath` wrapper in `src/lib/saves.ts`. Symmetrical with the existing `set_save_path` writer; no schema or storage change.
- **Files modified:** `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/lib/saves.ts`
- **Commit:** `1d172c1` (single combined commit per plan)

## Verification

```bash
$ pnpm typecheck
> tsc --noEmit                                      ✓ green

$ pnpm vite build
✓ 2797 modules transformed.
✓ built in 5.56s                                    ✓ green
(pre-existing PostCSS @import warning unrelated to 05e)

$ cargo check
warning: gal-lib (lib) generated 4 warnings        ✓ green
Finished `dev` profile [unoptimized + debuginfo]   (warnings all pre-existing dead-code on unrelated modules)

$ <plan-verify-grep-suite>
files exist
screenshots ok
saves ok
detail ok                                           ✓ all 9 grep checks pass
```

## Self-Check: PASSED

- `D:\project\gal-lib\src\components\library\ScreenshotsTab.tsx` — FOUND
- `D:\project\gal-lib\src\components\library\SavesTab.tsx` — FOUND
- `D:\project\gal-lib\src\routes\Detail.tsx` — modified (TabsList 5→7 + interval Select)
- `D:\project\gal-lib\src-tauri\src\commands.rs` — modified (+ get_save_path)
- `D:\project\gal-lib\src-tauri\src\lib.rs` — modified (+ get_save_path registration)
- `D:\project\gal-lib\src\lib\saves.ts` — modified (+ getSavePath wrapper)
- Commit `1d172c1` — FOUND in `git log --oneline`

---

## Phase 5 Completeness Recap (and Milestone Close)

Phase 5 closed all 7 stats-media requirements across 5 waves:

| Wave | Plan | Subsystem | Requirements |
|------|------|-----------|--------------|
| 1 | 05a | Backend (sqlx aggregations + screenshot/save-backup helpers + 12 commands) | STATS-01, STATS-02, SHOT-01, SHOT-02, SAVE-01, SAVE-02, SAVE-03 |
| 2 | 05b | Backend (orchestrator screenshot timer + 12 commands wired in lib.rs) | SHOT-01 |
| 3 | 05c | Frontend lib + store (5 invoke wrappers per domain + 4 zustand slices) | (plumbing) |
| 4 | 05d | Frontend route (`/stats` page: AreaChart trend + horizontal BarChart top 15 + sidebar nav) | STATS-01, STATS-02 |
| 5 | 05e | Frontend Detail extensions (ScreenshotsTab + SavesTab + 截图间隔 select) | SHOT-02, SAVE-01, SAVE-03 |

**Milestone:** This is the FINAL wave of the FINAL phase of the v1 milestone. With 05e merged, the gal-lib v1 feature surface is complete: scan → metadata → launch (LE) → playtime tracking → search/filter/tags/notes/rating/favorite → stats → screenshots → save backup. Single-exe Tauri build is unchanged (no new npm/Rust deps required by 05e — `@tauri-apps/plugin-dialog` was already pinned at 2.7.1 in package.json).

**Followups deferred to Phase 6+:**
- Lightbox carousel + keyboard navigation
- Save-backup zip compression
- Auto-cleanup of screenshots older than N days
- Screenshot thumbnail cache (currently webview-rescaled per render)
- Stats: cross-year comparison, weekly heatmap

## Threat Flags

None — the only new backend surface (`get_save_path`) is a read-only single-row SELECT, no new file I/O / network / auth path. Frontend remains within the existing Tauri-asset-protocol scope (uses `convertFileSrc` already in use by the cover-image renderer since P2).
