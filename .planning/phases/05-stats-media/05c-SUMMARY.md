---
phase: 05-stats-media
plan: 05c
subsystem: frontend-invoke-layer
tags: [tauri-invoke, typescript, zustand, types]
requires: ["05b (12 backend commands wired in commands.rs + lib.rs)"]
provides:
  - "src/lib/stats.ts — getPlaytimeTrend / getTopGames + TrendPeriod / TrendPoint / TopGame types"
  - "src/lib/screenshots.ts — getScreenshots / deleteScreenshot / exportScreenshot / setScreenshotInterval / getScreenshotSettings + Screenshot type"
  - "src/lib/saves.ts — setSavePath / listSaveBackups / createSaveBackup / restoreSaveBackup / deleteSaveBackup + SaveBackup type"
  - "useLibraryStore: trend / topGames / screenshotsByGame / saveBackupsByGame slices + setters"
affects:
  - src/lib/stats.ts (new)
  - src/lib/screenshots.ts (new)
  - src/lib/saves.ts (new)
  - src/store/library.ts (extended)
tech-stack:
  added: []  # No new deps — pure invoke wrappers + Zustand slice extension
  patterns:
    - "Snake_case wire shape: Rust structs serialize without rename_all; TS interfaces mirror snake_case verbatim (matches launch.ts / games.ts)"
    - "camelCase invoke args: JS callers pass camelCase keys; Tauri 2 auto-converts to snake_case Rust params"
    - "Lazy per-game caches: screenshotsByGame / saveBackupsByGame keyed by game.id, hydrated on Detail page mount; never auto-evicted (bounded library size)"
    - "Backend-authoritative refresh: no optimistic updates — mutations are followed by re-calling the relevant list*() invoke (avoids stale derived fields like file_count / total_size_bytes)"
    - "Empty array sentinel for trend / topGames: pure state-holding slices, no auto-fetch on store mount; consumers fetch on page mount and re-fetch when filters change"
key-files:
  created:
    - "src/lib/stats.ts (~80 lines) — 2 invoke wrappers + 3 type exports"
    - "src/lib/screenshots.ts (~85 lines) — 5 invoke wrappers + 1 type export"
    - "src/lib/saves.ts (~100 lines) — 5 invoke wrappers + 1 type export"
  modified:
    - "src/store/library.ts — +4 type imports, +4 state fields, +4 setters; default values added to create() initializer"
decisions:
  - "Path-relativity contract preserved in JSDoc: Screenshot.path and SaveBackup.backup_dir are RELATIVE to data_dir (per backend convention from 05b); savePath in setSavePath is ABSOLUTE (game's real save dir); targetPath in exportScreenshot is ABSOLUTE (user-chosen via dialog plugin)"
  - "TrendPeriod as a literal union (\"daily\" | \"weekly\" | \"monthly\") matches backend whitelist exactly — type system prevents bad inputs at compile time, backend still validates as defence-in-depth"
  - "Zustand setters mirror existing setSessionsForGame pattern (per-key spread into Record<number, T[]>): keeps the store API uniform for Detail-page consumers in 05d/05e"
  - "Setters NOT wired to invoke calls inside the store — store is purely state-holding; UI components own the fetch lifecycle (matches 03/04 conventions, simplifies testing)"
metrics:
  duration_min: 8
  completed: 2026-05-08
---

# Phase 5 Plan 05c: Frontend invoke layer + store extensions Summary

Three new TypeScript modules under `src/lib/` (`stats.ts`, `screenshots.ts`, `saves.ts`) wrap the 12 backend commands wired in 05b with typed `invoke()` calls and exported result-shape interfaces; `src/store/library.ts` was extended with four Zustand slices (`trend`, `topGames`, `screenshotsByGame`, `saveBackupsByGame`) plus matching setters so future UI components in 05d/05e can read/write cached data without prop-drilling.

## What Changed

### New: `src/lib/stats.ts`

- `TrendPeriod` literal union — exactly matches the backend whitelist
- `TrendPoint` / `TopGame` interfaces — mirror `commands.rs::TrendPoint` / `TopGame` (snake_case preserved over the wire)
- `getPlaytimeTrend(period, days)` and `getTopGames(limit)` — thin `invoke<T>()` wrappers with no client-side logic

### New: `src/lib/screenshots.ts`

- `Screenshot` interface — `path` documented as RELATIVE to `data_dir`
- `getScreenshots(gameId)` / `deleteScreenshot(id)` / `exportScreenshot(id, targetPath)` / `setScreenshotInterval(gameId, intervalSec)` / `getScreenshotSettings(gameId)` — all camelCase JS args; Tauri auto-converts to snake_case

### New: `src/lib/saves.ts`

- `SaveBackup` interface — `backup_dir` documented as RELATIVE to `data_dir`; `note` nullable
- `setSavePath(gameId, savePath | null)` / `listSaveBackups(gameId)` / `createSaveBackup(gameId, note | null)` / `restoreSaveBackup(id)` / `deleteSaveBackup(id)` — `createSaveBackup` returns the new row's id

### Extended: `src/store/library.ts`

- Imports: `TopGame`, `TrendPoint` from `@/lib/stats`; `Screenshot` from `@/lib/screenshots`; `SaveBackup` from `@/lib/saves`
- New state fields: `trend: TrendPoint[]`, `topGames: TopGame[]`, `screenshotsByGame: Record<number, Screenshot[]>`, `saveBackupsByGame: Record<number, SaveBackup[]>`
- New setters: `setTrend`, `setTopGames`, `setScreenshotsForGame(gameId, screenshots)`, `setSaveBackupsForGame(gameId, backups)`
- Initializer defaults: `trend: []`, `topGames: []`, both records `{}`

## Verification

| Check                                                  | Result |
| ------------------------------------------------------ | ------ |
| `src/lib/stats.ts` exists                              | PASS   |
| `src/lib/screenshots.ts` exists                        | PASS   |
| `src/lib/saves.ts` exists                              | PASS   |
| `getPlaytimeTrend` / `getTopGames` exported            | PASS   |
| `deleteScreenshot` exported                            | PASS   |
| `createSaveBackup` / `restoreSaveBackup` exported      | PASS   |
| `trend:` / `screenshotsByGame` / `saveBackupsByGame` in store | PASS |
| `pnpm typecheck`                                       | PASS (exit 0, clean) |

## Deviations from Plan

None — plan executed exactly as written. The plan's `<read_first>` block (commands.rs, library.ts) was honoured; the action block's 5 sub-steps were each implemented verbatim with the field names, signatures, and slice shapes specified.

## Decisions Made

- **Snake_case TS interfaces** (e.g. `name_cn`, `total_playtime_sec`, `game_id`, `captured_at`, `backup_dir`, `total_size_bytes`, `created_at`): matches the backend's no-`rename_all` serialization and the convention already established by `launch.ts::SessionRow` and `games.ts::Game`. Frontend consumers will read these fields directly without a transform layer.
- **camelCase invoke args** (e.g. `gameId`, `intervalSec`, `targetPath`, `savePath`): per the Tauri 2 auto-conversion convention documented in the project's existing wrappers; verified by typecheck against the existing pattern.
- **Path-relativity documented in JSDoc, not enforced in types**: TypeScript can't statically distinguish "relative path" from "absolute path" without a branded-type machinery that would leak into every consumer. The doc comments call out the convention so future Detail-page renderers know to resolve `Screenshot.path` against the data dir before loading.
- **Store as pure state-holder**: setters don't fetch — UI components own the lifecycle. Mirrors the 03/04 convention; keeps the store testable in isolation and avoids having mutations trigger N+1 invoke storms during bulk operations.

## Threat Flags

None — this plan adds no new attack surface. All wrappers are 1:1 passthroughs to backend commands that 05b already authorized; no new IPC entry points, no new file/network access, no new auth paths.

## Self-Check: PASSED

- src/lib/stats.ts: FOUND
- src/lib/screenshots.ts: FOUND
- src/lib/saves.ts: FOUND
- src/store/library.ts: MODIFIED (4 new slices + 4 setters)
- Commit 4220833: FOUND in `git log`
- typecheck: exit 0
