/**
 * Tauri invoke wrappers for tag CRUD + per-game tag wiring.
 *
 * Wraps the 6 tag-related commands registered by 04b
 * (`list_tags` / `create_tag` / `update_tag` / `delete_tag` /
 * `set_game_tags` / `list_game_tags`).
 *
 * Type shapes mirror `src-tauri/src/commands.rs::Tag` 1:1; SQLite stores
 * `color` as nullable TEXT (HEX like "#ff8800" or null).
 *
 * Tauri 2.x invoke arg-name convention: Rust params use snake_case, JS
 * passes camelCase keys, Tauri auto-converts (e.g. `set_game_tags(game_id,
 * tag_ids)` accepts JS `{ gameId, tagIds }`).
 *
 * Mutations here are NOT optimistically applied to the Zustand store —
 * callers should re-fetch via `listTags()` / `getSidebarCategories()` after
 * a successful command (matches the source-of-truth rule documented in
 * `src/store/library.ts`).
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * One row from the `tags` table. `name` is UNIQUE in the DB; `color` is an
 * optional CSS-friendly hex string (no validation enforced backend-side
 * beyond TEXT — the UI is the source of validity).
 */
export interface Tag {
  id: number;
  name: string;
  /** Hex color string (e.g. "#ff8800") or null when unspecified. */
  color: string | null;
}

// ── tag CRUD ────────────────────────────────────────────────────────────────

/**
 * List every tag, sorted by name (case-insensitive). Used by the sidebar's
 * "Tags" section AND the detail-page tag-picker dropdown.
 */
export async function listTags(): Promise<Tag[]> {
  return invoke<Tag[]>("list_tags");
}

/**
 * Create a new tag. Backend trims `name` and rejects empty strings with a
 * `String` error; UNIQUE constraint surfaces as a sqlx error string ("UNIQUE
 * constraint failed: tags.name"). Returns the new rowid.
 */
export async function createTag(name: string, color: string | null): Promise<number> {
  return invoke<number>("create_tag", { name, color });
}

/**
 * Update both `name` and `color` for an existing tag id. Same validation
 * rules as `createTag` (non-empty name, UNIQUE name).
 */
export async function updateTag(id: number, name: string, color: string | null): Promise<void> {
  await invoke("update_tag", { id, name, color });
}

/**
 * Delete a tag. ON DELETE CASCADE on `game_tags.tag_id` automatically
 * removes the per-game association rows — callers do NOT need to clean up
 * `game_tags` first.
 */
export async function deleteTag(id: number): Promise<void> {
  await invoke("delete_tag", { id });
}

// ── per-game tag wiring ────────────────────────────────────────────────────

/**
 * Replace the FULL tag set on `gameId` with `tagIds` (transactional on the
 * backend). Pass `[]` to clear all tags from a game. Existing rows for tags
 * not in the new set are deleted.
 */
export async function setGameTags(gameId: number, tagIds: number[]): Promise<void> {
  await invoke("set_game_tags", { gameId, tagIds });
}

/**
 * List the tags currently attached to `gameId`. Returns sorted by tag name
 * (matching `listTags()` ordering) so the detail page can render in stable
 * order without re-sorting.
 */
export async function listGameTags(gameId: number): Promise<Tag[]> {
  return invoke<Tag[]>("list_game_tags", { gameId });
}
