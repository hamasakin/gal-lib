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

/**
 * Sub-phase of an active scan. `discovering` = filesystem walk; `enriching` =
 * placeholder INSERT + per-game metadata pipeline. Terminal events carry the
 * last active phase (frontend only switches copy on `running`).
 */
export type ScanPhase = "discovering" | "enriching";

/** Live progress payload emitted by Rust during an active scan. */
export interface ScanProgress {
  current_dir: string;
  completed: number;
  total: number;
  status: "running" | "completed" | "cancelled" | "failed";
  phase: ScanPhase;
}

/**
 * Phase 12 — KPI snapshot for the `/scan` page header strip. 4 COUNT
 * queries combined into one round-trip on the Rust side. Frontend refetches
 * on mount + after every scan / bind / dismiss / accept event.
 */
export interface ScanKpis {
  total: number;
  bound: number;
  review_pending: number;
  unmatched: number;
}

export async function getScanKpis(): Promise<ScanKpis> {
  return invoke<ScanKpis>("get_scan_kpis");
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
 * Quick 260513-3df — 统一刷新元数据入口。对未绑定行做模糊匹配（用
 * `games.name` 当 query），对已绑定行按 source_id 直拉
 * `fetch_detail` / `fetch_persons` / `fetch_characters`（不重做匹配，
 * manual 安全）。共享 `scan-progress` + `meta-fetch-progress` 事件通道；
 * 可被 `cancelScan` 中止。Resolves immediately after spawning the worker
 * task on the Rust side.
 */
export async function refreshMetadataSmart(): Promise<void> {
  await invoke("refresh_metadata_smart");
}

/**
 * Debug-only: wipe all games, scan_roots, sessions, screenshots, save
 * backups, and the on-disk cover/screenshot/save directories. Tags
 * definitions and LE path are preserved.
 */
export async function clearAllData(): Promise<void> {
  await invoke("clear_all_data");
}

// ── Quick 260516-q3y — subdir split ─────────────────────────────────────────

/**
 * One direct child directory of a path being inspected for subdir-split.
 * Mirrors `src-tauri/src/commands.rs::SubdirEntry` (serde snake_case).
 */
export interface SubdirEntry {
  /** Directory basename. */
  name: string;
  /** Absolute path to the child directory. */
  path: string;
  /** `clean_title(name)` — search-friendly title preview. */
  clean_title: string;
  /** Best executable found under the child directory, or null. */
  exe: string | null;
}

/**
 * List the direct child directories of `path` for the「整理子目录」dialog.
 * Each entry carries a cleaned-title preview + detected best executable.
 */
export async function listSubdirs(path: string): Promise<SubdirEntry[]> {
  return invoke<SubdirEntry[]>("list_subdirs", { path });
}

/**
 * Split a mis-scanned brand parent directory (`gameId`) into N independent
 * game entries — one per path in `paths`. Each new entry auto-runs metadata
 * matching; the original parent entry is deleted and its path persisted to
 * `scan_skip_dirs` so a full scan never re-discovers it. Returns the ids of
 * the newly created entries.
 */
export async function splitGameIntoSubdirs(
  gameId: number,
  paths: string[],
): Promise<number[]> {
  return invoke<number[]>("split_game_into_subdirs", { gameId, paths });
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

// ── 20260509f: meta-fetch-progress (per-game pulse highlight) ───────────────

/**
 * Backend payload for the `meta-fetch-progress` event — emitted in pairs
 * (started/finished) around each per-game metadata fetch.
 *
 * Sources (Rust commands.rs):
 *   - `start_scan` ingest loop (per-game)
 *   - `refresh_all_metadata` loop (per-game)
 *   - `refresh_metadata` (single game)
 *   - `bind_metadata` (single game; happy + error paths via inner async block)
 *
 * Tauri serializes Rust `serde_json::json!({...})` snake_case as-is, so the
 * field names below match the Rust emit literals 1:1.
 */
export interface MetaFetchProgress {
  game_id: number;
  phase: "started" | "finished";
}

/**
 * Subscribe to the per-game `meta-fetch-progress` event stream.
 *
 * Pair-based: each `started` is followed by exactly one `finished` on the
 * happy path. Backend wraps the inner work in an async block so even on
 * error the `finished` emit still runs — but consumers should still pair
 * this listener with a `scan-progress` terminal-status fallback that calls
 * `clearFetchingMetaIds()` (see `src/main.tsx`) to defend against panics
 * or missed events from non-scan-progress paths (bind/single-refresh).
 *
 * Returns an `UnlistenFn` — caller MUST invoke on cleanup. The canonical
 * owner is the module-scope subscription in `src/main.tsx`.
 */
export async function onMetaFetchProgress(
  cb: (p: MetaFetchProgress) => void,
): Promise<UnlistenFn> {
  return listen<MetaFetchProgress>("meta-fetch-progress", (e) => cb(e.payload));
}

/**
 * Quick 260515-prog — subscribe to `games-changed`, a fire-and-forget pulse
 * emitted by `start_scan` (per placeholder INSERT, per enrich completion) and
 * `refresh_metadata_smart` (per UPDATE). Payload is empty `()` — consumers
 * should throttle and call `searchGames` themselves to re-read the grid.
 *
 * Returns an `UnlistenFn` — caller MUST invoke on cleanup.
 */
export async function onGamesChanged(
  cb: () => void,
): Promise<UnlistenFn> {
  return listen<unknown>("games-changed", () => cb());
}
