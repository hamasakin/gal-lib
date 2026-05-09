/**
 * Tauri invoke wrappers for the scan + scan_roots subsystem.
 *
 * Wraps the 6 scan-related commands registered by 02d
 * (`add_scan_root` / `remove_scan_root` / `list_scan_roots` / `start_scan` /
 * `cancel_scan` / `mark_skip_dir`) plus the `scan-progress` event stream
 * emitted from the Rust-side `tokio::spawn` task.
 *
 * Type shapes mirror `src-tauri/src/commands.rs::ScanRoot` and
 * `src-tauri/src/scan.rs::ScanProgress` (kept in sync via this single source).
 *
 * Tauri 2.x `invoke` arg-name convention: command function params use
 * `snake_case` in Rust; we pass `camelCase` keys here and Tauri auto-converts.
 * (Verified: `add_scan_root(path, depth)` accepts JS `{ path, depth }`.)
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Row in the `scan_roots` table. `depth` is 1, 2, or 3 (CHECK-constrained). */
export interface ScanRoot {
  id: number;
  path: string;
  depth: 1 | 2 | 3;
  created_at: string;
}

/** Live progress payload emitted by Rust during an active scan. */
export interface ScanProgress {
  current_dir: string;
  completed: number;
  total: number;
  status: "running" | "completed" | "cancelled" | "failed";
}

// ── scan_roots CRUD ─────────────────────────────────────────────────────────

export async function addScanRoot(path: string, depth: 1 | 2 | 3): Promise<number> {
  return invoke<number>("add_scan_root", { path, depth });
}

export async function removeScanRoot(id: number): Promise<void> {
  await invoke("remove_scan_root", { id });
}

export async function listScanRoots(): Promise<ScanRoot[]> {
  return invoke<ScanRoot[]>("list_scan_roots");
}

// ── scan lifecycle ──────────────────────────────────────────────────────────

export async function startScan(mode: "full" | "incremental"): Promise<void> {
  await invoke("start_scan", { mode });
}

export async function cancelScan(): Promise<void> {
  await invoke("cancel_scan");
}

export async function markSkipDir(path: string): Promise<void> {
  await invoke("mark_skip_dir", { path });
}

/**
 * Add a single game directory directly (bypasses scan_roots + bulk scan).
 * Returns the new `games.id`. Frontend should refresh the games grid +
 * sidebar after success.
 */
export async function addGame(dirPath: string): Promise<number> {
  return invoke<number>("add_game", { dirPath });
}

/**
 * Bulk version of `refresh_metadata` — re-runs the Bangumi+VNDB search
 * for every game in the library, including already-bound rows. Reuses
 * the `scan-progress` event stream so the existing progress bar UI
 * surfaces progress without extra wiring. Resolves immediately after
 * spawning the worker task on the Rust side.
 */
export async function refreshAllMetadata(): Promise<void> {
  await invoke("refresh_all_metadata");
}

/**
 * Debug-only: wipe all games, scan_roots, sessions, screenshots, save
 * backups, and the on-disk cover/screenshot/save directories. Tags
 * definitions and LE path are preserved.
 */
export async function clearAllData(): Promise<void> {
  await invoke("clear_all_data");
}

/**
 * Subscribe to the `scan-progress` event stream.
 *
 * Returns an `UnlistenFn` — caller MUST invoke on cleanup (e.g. inside a
 * React `useEffect` cleanup) to detach the listener; otherwise duplicate
 * handlers accumulate across mount/unmount cycles.
 *
 * Backend currently emits ~per-directory (no debounce); 02-CONTEXT
 * recommends 100ms throttle on the consumer side. The store layer
 * (src/store/library.ts) is the right place to throttle if jank emerges.
 */
export async function onScanProgress(
  cb: (p: ScanProgress) => void,
): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan-progress", (e) => cb(e.payload));
}
