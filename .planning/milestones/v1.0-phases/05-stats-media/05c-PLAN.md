---
phase: 05-stats-media
plan: 05c
type: execute
wave: 3
depends_on: [05a, 05b]
files_modified:
  - src/lib/stats.ts
  - src/lib/screenshots.ts
  - src/lib/saves.ts
  - src/store/library.ts
autonomous: true
requirements: [STATS-01, SHOT-02, SAVE-03]
must_haves:
  truths:
    - "src/lib/stats.ts: getPlaytimeTrend + getTopGames"
    - "src/lib/screenshots.ts: getScreenshots + deleteScreenshot + exportScreenshot + setScreenshotInterval + getScreenshotSettings"
    - "src/lib/saves.ts: setSavePath + listSaveBackups + createSaveBackup + restoreSaveBackup + deleteSaveBackup"
    - "src/store/library.ts: stats slice (trend / topGames) + screenshotsByGame slice + saveBackupsByGame slice"
    - "pnpm typecheck 退出 0"
---

# Plan 05c — Frontend invoke layer + store extensions

## Tasks

<task name="Task 1: invoke wrappers + types + store">

<read_first>
- D:\project\gal-lib\src-tauri\src\commands.rs (12 new commands signatures)
- D:\project\gal-lib\src/store/library.ts (existing — extend with stats / screenshots / saves slices)
</read_first>

<action>

1. **`src/lib/stats.ts`**:
```ts
import { invoke } from "@tauri-apps/api/core";
export type TrendPeriod = "daily" | "weekly" | "monthly";
export interface TrendPoint { bucket: string; hours: number }
export interface TopGame { id: number; name: string; name_cn: string | null; total_playtime_sec: number }
export async function getPlaytimeTrend(period: TrendPeriod, days: number): Promise<TrendPoint[]>;
export async function getTopGames(limit: number): Promise<TopGame[]>;
```

2. **`src/lib/screenshots.ts`**:
```ts
export interface Screenshot { id: number; game_id: number; path: string; captured_at: string }
export async function getScreenshots(gameId: number): Promise<Screenshot[]>;
export async function deleteScreenshot(id: number): Promise<void>;
export async function exportScreenshot(id: number, targetPath: string): Promise<void>;
export async function setScreenshotInterval(gameId: number, intervalSec: number): Promise<void>;
export async function getScreenshotSettings(gameId: number): Promise<number>;
```

3. **`src/lib/saves.ts`**:
```ts
export interface SaveBackup { id: number; game_id: number; backup_dir: string; file_count: number; total_size_bytes: number; created_at: string; note: string | null }
export async function setSavePath(gameId: number, savePath: string | null): Promise<void>;
export async function listSaveBackups(gameId: number): Promise<SaveBackup[]>;
export async function createSaveBackup(gameId: number, note: string | null): Promise<number>;
export async function restoreSaveBackup(id: number): Promise<void>;
export async function deleteSaveBackup(id: number): Promise<void>;
```

4. **`src/store/library.ts`** extend with:
- `trend: TrendPoint[]; topGames: TopGame[]; setTrend; setTopGames`
- `screenshotsByGame: Record<number, Screenshot[]>; setScreenshotsForGame`
- `saveBackupsByGame: Record<number, SaveBackup[]>; setSaveBackupsForGame`

5. pnpm typecheck green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/lib/stats.ts && \
test -f src/lib/screenshots.ts && \
test -f src/lib/saves.ts && \
grep -q "getPlaytimeTrend" src/lib/stats.ts && \
grep -q "getTopGames" src/lib/stats.ts && \
grep -q "deleteScreenshot" src/lib/screenshots.ts && \
grep -q "createSaveBackup" src/lib/saves.ts && \
grep -q "restoreSaveBackup" src/lib/saves.ts && \
grep -q "trend:" src/store/library.ts && \
grep -q "screenshotsByGame" src/store/library.ts && \
grep -q "saveBackupsByGame" src/store/library.ts && \
pnpm typecheck
</automated>
</verify>

</task>

## Commit

`feat(05-05c): frontend invoke layer (stats/screenshots/saves) + store extensions`
