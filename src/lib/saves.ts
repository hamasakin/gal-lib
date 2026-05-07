/**
 * Tauri invoke wrappers for the Phase 5 save-backup subsystem (05a).
 *
 * Wraps the 5 save-backup commands wired in 05b:
 *   - `set_save_path(game_id, save_path)`   — set/clear `games.save_path`
 *   - `list_save_backups(game_id)`          — list rows for a game (newest first)
 *   - `create_save_backup(game_id, note)`   — snapshot save_path → backup_dir
 *   - `restore_save_backup(id)`             — copy backup_dir → save_path
 *   - `delete_save_backup(id)`              — remove DB row + on-disk dir
 *
 * Shape source of truth:
 *   - `SaveBackup` ↔ `src-tauri/src/commands.rs::SaveBackupRow`
 *
 * The Rust struct serializes without `rename_all`, so snake_case is preserved
 * over the wire (matches the rest of the invoke layer).
 *
 * Path semantics:
 *   - `savePath` (set_save_path) is ABSOLUTE — it's a real OS directory
 *     containing the game's save files; backend stores it verbatim.
 *   - `backup_dir` in the row is RELATIVE to `data_dir` so portable installs
 *     survive a folder move (mirror of the screenshots-path convention).
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * One row from the `save_backups` table. Backups are full directory copies;
 * `file_count` and `total_size_bytes` are computed at backup time so the UI
 * can show "12 files / 4.3 MB" without re-walking the directory.
 */
export interface SaveBackup {
  id: number;
  game_id: number;
  /** Path RELATIVE to `data_dir` (e.g. `save_backups/<gameId>/<timestamp>/`). */
  backup_dir: string;
  file_count: number;
  total_size_bytes: number;
  /** RFC3339 UTC creation timestamp. */
  created_at: string;
  /** Optional user-supplied label (e.g. "before route choice"). */
  note: string | null;
}

/**
 * Set (or clear) `games.save_path`. Pass `null` to clear — useful when the
 * user moves their saves directory or wants to disable backups for a game.
 *
 * The path is NOT validated here (backend stores verbatim); callers that need
 * a directory picker should use `@tauri-apps/plugin-dialog`'s `open()`.
 */
export async function setSavePath(
  gameId: number,
  savePath: string | null,
): Promise<void> {
  await invoke("set_save_path", { gameId, savePath });
}

/**
 * List save-backup rows for a game, newest first
 * (`ORDER BY created_at DESC`). Returns `[]` when the game has none.
 */
export async function listSaveBackups(gameId: number): Promise<SaveBackup[]> {
  return invoke<SaveBackup[]>("list_save_backups", { gameId });
}

/**
 * Snapshot the game's `save_path` into a new backup directory under
 * `data_dir`. Returns the new backup's ID.
 *
 * Throws when:
 *   - the game has no `save_path` set (backend bails before walking)
 *   - the source directory is missing / unreadable
 */
export async function createSaveBackup(
  gameId: number,
  note: string | null,
): Promise<number> {
  return invoke<number>("create_save_backup", { gameId, note });
}

/**
 * Restore a backup by copying its `backup_dir` over the game's current
 * `save_path`. The destructive part (overwriting current saves) is the
 * backend's responsibility — the consumer should confirm with the user
 * BEFORE calling this.
 *
 * Throws when the backup row is missing or the game's `save_path` is unset.
 */
export async function restoreSaveBackup(id: number): Promise<void> {
  await invoke("restore_save_backup", { id });
}

/**
 * Delete a backup: remove the DB row AND the on-disk `backup_dir` (recursive).
 * Throws when the DB row is missing; on-disk removal is best-effort.
 */
export async function deleteSaveBackup(id: number): Promise<void> {
  await invoke("delete_save_backup", { id });
}
