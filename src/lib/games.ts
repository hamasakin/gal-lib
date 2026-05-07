/**
 * Tauri invoke wrapper for the `games` table read API.
 *
 * Phase 2's Library route reads the full `games` rowset to render the cover
 * grid. Mutations to `games` flow through the dedicated commands wired in
 * 02d (`bind_metadata` / `refresh_metadata`) and the scan ingest pipeline
 * (`start_scan` UPSERTs + UPDATEs); this file only exposes the read path.
 *
 * Type shape mirrors `src-tauri/migrations/0002_*.sql` `games` columns 1:1.
 * Optional columns are typed as `T | null` (sqlx returns `NULL` as `null`
 * over JSON; never `undefined`). Column ordering here matches the schema's
 * declaration order so manual diffs against the migration stay readable.
 *
 * `status` and `metadata_source` are typed as string-literal unions even
 * though SQLite stores them as TEXT — the Rust ingest path is the only
 * writer for `metadata_source` (whitelisted to "bangumi"|"vndb"|"none"|
 * "manual") and the schema's CHECK constraint enforces `status` to one of
 * the four locked values.
 */

import { invoke } from "@tauri-apps/api/core";

/** Row from the `games` table (Phase 2 schema v2). */
export interface Game {
  id: number;
  /** Absolute filesystem path of the game directory (UNIQUE in DB). */
  path: string;
  /** Authoritative title — bound from Bangumi/VNDB or cleaned from disk name. */
  name: string;
  /** Localized (Chinese) title from the metadata source, when available. */
  name_cn: string | null;
  /** Best-scored .exe within the game directory, or null if none qualified. */
  executable_path: string | null;
  /** Relative cover path under data_dir (e.g. `covers/42.jpg`); resolved
   *  via `convertFileSrc(dataDir + '/' + cover_path)` for `<img>` use. */
  cover_path: string | null;
  /** Remote cover URL (used for retry / re-cache; not rendered directly). */
  cover_url: string | null;
  /** Bangumi numeric subject id, stringified. */
  bangumi_id: string | null;
  /** VNDB id (e.g. "v1234"). */
  vndb_id: string | null;
  /** Cumulative play time across all sessions (Phase 3 will populate). */
  total_playtime_sec: number;
  last_played_at: string | null;
  status: "unplayed" | "playing" | "cleared" | "dropped";
  rating: number | null;
  notes: string | null;
  metadata_source: "bangumi" | "vndb" | "manual" | "none" | null;
  /** 0..=100; `null` until ingest runs. ≥80 = auto-bind, <80 = needs review. */
  match_confidence: number | null;
  last_scanned_at: string | null;
  // ── Phase 4 / schema v4 fields ──
  /**
   * Brand / publisher / circle name from the metadata source. Filled by the
   * Phase-4 metadata-fetch pipeline (META) and surfaced as a sidebar
   * auto-category (`get_sidebar_categories().brands`).
   */
  brand: string | null;
  /**
   * Release year (4 digits, e.g. 2018). Bucketed into decade categories on
   * the sidebar (`get_sidebar_categories().year_decades`).
   */
  release_year: number | null;
  /**
   * Favorite flag. SQLite stores as INTEGER 0/1; Rust `serde` serializes
   * the Tauri command output as a real JS boolean (see `row_to_game` in
   * `src-tauri/src/commands.rs` — `is_favorite = ... != 0`), so consumers
   * can rely on `=== true` / `=== false`.
   */
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch all games, newest first.
 *
 * Phase 2 has no pagination because typical libraries are 50-500 entries —
 * within virtualization-safe range. If a user reports 5k+ entries, the
 * Phase 4 search/filter rework is the right place to introduce server-side
 * paging (the current shape is a strict subset of any future paginated API).
 */
export async function listGames(): Promise<Game[]> {
  return invoke<Game[]>("list_games");
}

// ── Phase 4 / 04b: per-game property updates ─────────────────────────────────
//
// Each helper wraps a dedicated `update_game_*` Tauri command that issues a
// single targeted UPDATE on the `games` row + bumps `updated_at`. Mutations
// here are NOT optimistically applied to the Zustand store — callers should
// re-fetch via `searchGames()` / `listGames()` (and `getSidebarCategories()`
// when status/favorite/brand/year change, since those affect sidebar counts)
// after a successful command, matching the source-of-truth rule documented
// in `src/store/library.ts`.

/**
 * Set a game's status. Backend enforces the 4-value enum and returns a
 * precise `String` error for invalid input (the games.status CHECK
 * constraint is also a backstop).
 */
export async function updateGameStatus(
  gameId: number,
  status: "unplayed" | "playing" | "cleared" | "dropped",
): Promise<void> {
  await invoke("update_game_status", { gameId, status });
}

/**
 * Toggle the favorite flag. Backend stores INTEGER 0/1; the wire arg is a
 * real JS boolean (Rust `serde` deserializes it as `bool`).
 */
export async function updateGameFavorite(gameId: number, favorite: boolean): Promise<void> {
  await invoke("update_game_favorite", { gameId, isFavorite: favorite });
}

/**
 * Set or clear the rating. Backend enforces `1..=10` when `rating` is
 * non-null; pass `null` to clear. The games.rating column allows NULL and
 * has no CHECK on the value range — validation lives only in the command.
 */
export async function updateGameRating(gameId: number, rating: number | null): Promise<void> {
  await invoke("update_game_rating", { gameId, rating });
}

/**
 * Set or clear the free-form notes column. Pass `null` to clear; pass the
 * empty string to keep an empty-but-present value (backend writes both
 * faithfully — only `null` becomes SQL NULL).
 */
export async function updateGameNotes(gameId: number, notes: string | null): Promise<void> {
  await invoke("update_game_notes", { gameId, notes });
}

/**
 * Atomically update `brand` + `release_year` together. Each arg is
 * independently nullable; passing `null` for either CLEARS that column
 * (overwrite-with-NULL semantics — matches what the Phase-4 metadata
 * refresh pipeline needs when the source returns no brand).
 */
export async function updateGameBrandYear(
  gameId: number,
  brand: string | null,
  releaseYear: number | null,
): Promise<void> {
  await invoke("update_game_brand_year", { gameId, brand, releaseYear });
}
