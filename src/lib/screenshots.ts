/**
 * Tauri invoke wrappers for the Phase 5 screenshots subsystem (05a).
 *
 * Wraps the 5 screenshot commands wired in 05b:
 *   - `get_screenshots(game_id)`            — list rows for a game (newest first)
 *   - `delete_screenshot(id)`               — remove DB row + on-disk file
 *   - `export_screenshot(id, target_path)`  — copy file out to user-chosen path
 *   - `set_screenshot_interval(game_id, interval_sec)` — per-game cadence
 *   - `get_screenshot_settings(game_id)`    — read current `interval_sec`
 *
 * Shape source of truth:
 *   - `Screenshot` ↔ `src-tauri/src/commands.rs::ScreenshotRow`
 *
 * The Rust struct serializes without `rename_all`, so snake_case is preserved
 * over the wire (matches the rest of the invoke layer).
 *
 * Path semantics: `path` in the DB is RELATIVE to `data_dir`; the consumer
 * (image renderer) is expected to resolve it against the app data dir before
 * loading. `targetPath` for `exportScreenshot` is ABSOLUTE — passed straight
 * to `std::fs::copy` on the backend.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * One row from the `screenshots` table. `path` is stored relative to the app
 * `data_dir` (so backups/portable installs survive a path move).
 */
export interface Screenshot {
  id: number;
  game_id: number;
  /** Path RELATIVE to `data_dir` (e.g. `screenshots/<gameId>/<uuid>.png`). */
  path: string;
  /** RFC3339 UTC capture timestamp. */
  captured_at: string;
}

/**
 * List screenshots for a game, newest first (`ORDER BY captured_at DESC`).
 * Returns `[]` when the game has none — never throws on missing rows.
 */
export async function getScreenshots(gameId: number): Promise<Screenshot[]> {
  return invoke<Screenshot[]>("get_screenshots", { gameId });
}

/**
 * Delete a screenshot: remove the DB row AND the on-disk file. Idempotent
 * w.r.t. already-deleted file (best-effort unlink); throws when the DB row
 * is missing (consumer should refresh its cache after the call).
 */
export async function deleteScreenshot(id: number): Promise<void> {
  await invoke("delete_screenshot", { id });
}

/**
 * Copy a screenshot file out to a user-chosen destination. `targetPath` must
 * be an ABSOLUTE path (typically obtained via `@tauri-apps/plugin-dialog`'s
 * `save()` picker). Throws when the source row is missing or the destination
 * is unwritable.
 */
export async function exportScreenshot(
  id: number,
  targetPath: string,
): Promise<void> {
  await invoke("export_screenshot", { id, targetPath });
}

/**
 * Set per-game auto-screenshot cadence in seconds. `0` disables auto-capture
 * for the game (backend treats 0 as "off"; negative values are rejected).
 */
export async function setScreenshotInterval(
  gameId: number,
  intervalSec: number,
): Promise<void> {
  await invoke("set_screenshot_interval", { gameId, intervalSec });
}

/**
 * Read the current `screenshot_interval_sec` for a game. Returns `0` when
 * auto-capture is disabled. Throws when the game row is missing.
 */
export async function getScreenshotSettings(gameId: number): Promise<number> {
  return invoke<number>("get_screenshot_settings", { gameId });
}
