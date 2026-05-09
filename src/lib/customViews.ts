/**
 * Tauri invoke wrappers for custom-views CRUD (Quick 20260510b).
 *
 * Mirrors the 6 commands registered in `src-tauri/src/lib.rs`:
 *   - list_custom_views
 *   - create_custom_view
 *   - rename_custom_view
 *   - delete_custom_view
 *   - add_games_to_view
 *   - remove_game_from_view
 *
 * Field names use snake_case to match Rust serde-deserialized payloads.
 * `count` is computed server-side via LEFT JOIN so empty views are present
 * with `count = 0` (lets users see a freshly-created empty view).
 */

import { invoke } from "@tauri-apps/api/core";

export interface CustomViewRow {
  id: number;
  name: string;
  /** Number of games currently in this view (0 for empty). */
  count: number;
  created_at: string;
}

export async function listCustomViews(): Promise<CustomViewRow[]> {
  return invoke<CustomViewRow[]>("list_custom_views");
}

export async function createCustomView(name: string): Promise<number> {
  return invoke<number>("create_custom_view", { name });
}

export async function renameCustomView(viewId: number, name: string): Promise<void> {
  await invoke("rename_custom_view", { viewId, name });
}

export async function deleteCustomView(viewId: number): Promise<void> {
  await invoke("delete_custom_view", { viewId });
}

/** Returns the number of rows actually inserted (duplicates skipped). */
export async function addGamesToView(
  viewId: number,
  gameIds: number[],
): Promise<number> {
  return invoke<number>("add_games_to_view", { viewId, gameIds });
}

export async function removeGameFromView(viewId: number, gameId: number): Promise<void> {
  await invoke("remove_game_from_view", { viewId, gameId });
}
