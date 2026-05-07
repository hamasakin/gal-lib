/**
 * Tauri invoke wrappers for the Phase 5 statistics subsystem (05a).
 *
 * Wraps the 2 stats commands wired in 05b:
 *   - `get_playtime_trend(period, days)` — bucketed playtime histogram
 *   - `get_top_games(limit)` — top-N by total_playtime_sec
 *
 * Shape sources of truth:
 *   - `TrendPoint` ↔ `src-tauri/src/commands.rs::TrendPoint`
 *   - `TopGame`    ↔ `src-tauri/src/commands.rs::TopGame`
 *
 * Both Rust structs serialize without `rename_all`, so snake_case is preserved
 * over the wire (matches the convention used in `launch.ts`).
 *
 * Invoke arg convention: snake_case Rust params; we pass camelCase JS keys
 * here and Tauri 2 auto-converts (verified across the existing 03/04 wrappers).
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Period bucket key for `get_playtime_trend`. Backend whitelists exactly
 * these three values — anything else returns an error from the command.
 *   - `daily`   → bucket `YYYY-MM-DD`     (strftime '%Y-%m-%d')
 *   - `weekly`  → bucket `YYYY-W##`       (strftime '%Y-W%W', Mon-start)
 *   - `monthly` → bucket `YYYY-MM`        (strftime '%Y-%m')
 */
export type TrendPeriod = "daily" | "weekly" | "monthly";

/**
 * One point on the playtime trend chart. `hours` is `SUM(duration_sec) / 3600.0`
 * for sessions in terminal status `completed | cancelled` (the only ones that
 * carry real playtime).
 */
export interface TrendPoint {
  /** Bucket label whose format depends on the requested `TrendPeriod`. */
  bucket: string;
  /** Total hours played within the bucket (float; may be 0 for sparse weeks). */
  hours: number;
}

/**
 * Top-played game row. `name_cn` is nullable because Bangumi/VNDB don't always
 * provide a Chinese title (consumer should fall back to `name` for display).
 */
export interface TopGame {
  id: number;
  name: string;
  name_cn: string | null;
  /** Lifetime total seconds played (mirror of `games.total_playtime_sec`). */
  total_playtime_sec: number;
}

/**
 * Bucketed playtime trend over the last `days` days.
 *
 * Backend filters `sessions` to terminal statuses (`completed`, `cancelled`)
 * and groups by the strftime bucket key. Empty buckets are NOT padded — the
 * chart component is responsible for filling gaps if a continuous x-axis is
 * required.
 *
 * @param period  Bucket granularity. Must be one of `TrendPeriod`.
 * @param days    Lookback window in days (e.g. 30 for "last month"). Backend
 *                injects `datetime('now', '-N days')` as the lower bound.
 * @throws        When `period` is not in the whitelist (defensive — the type
 *                system already prevents this from TS callers).
 */
export async function getPlaytimeTrend(
  period: TrendPeriod,
  days: number,
): Promise<TrendPoint[]> {
  return invoke<TrendPoint[]>("get_playtime_trend", { period, days });
}

/**
 * Top-N games by lifetime `total_playtime_sec`, descending. Zero-playtime
 * rows are excluded by the backend so empty libraries don't render
 * meaningless rows. `limit` must be in `1..=50` (backend rejects out-of-range).
 */
export async function getTopGames(limit: number): Promise<TopGame[]> {
  return invoke<TopGame[]>("get_top_games", { limit });
}
