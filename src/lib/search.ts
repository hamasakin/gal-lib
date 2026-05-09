/**
 * Tauri invoke wrappers for the search/sort/filter + sidebar-categories API.
 *
 * Wraps the 2 commands registered by 04b:
 *   - `search_games(query, sort_by, filter)` — server-side search + sort +
 *     filter against the `games` table; returns `Game[]`.
 *   - `get_sidebar_categories()` — aggregate counts powering the sidebar's
 *     auto-derived sections (tags, statuses, brands, decade buckets, fav
 *     count).
 *
 * Type shapes mirror `src-tauri/src/commands.rs` 1:1
 * (`SearchFilter`, `SidebarCategories`, and the four `*Count` structs).
 * `Tag` is re-imported from `./tags` to avoid a duplicate definition; both
 * sides ultimately reference the same Rust struct.
 *
 * Tauri 2.x invoke arg-name convention: Rust params use snake_case, JS
 * passes camelCase keys, Tauri auto-converts (e.g. `search_games(query,
 * sort_by, filter)` accepts JS `{ query, sortBy, filter }`). The `filter`
 * object's inner field names (`tag_id`, `year_decade`) stay snake_case —
 * those are deserialized by serde directly from the JSON payload, NOT by
 * the Tauri arg-name converter, so they MUST match the Rust struct field
 * names verbatim.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Game } from "./games";
import type { Tag } from "./tags";

/**
 * Optional filter clauses passed to `search_games`. All fields are optional
 * and ANDed on the backend. Field names use snake_case to match the Rust
 * `SearchFilter` struct (serde deserialization, not Tauri arg-name
 * conversion — see file header).
 *
 * - `tag_id`: only games tagged with this tag id.
 * - `status`: one of {unplayed, playing, cleared, dropped}.
 * - `favorite`: when `true`, only `is_favorite = 1` rows. `false` and
 *   `undefined` are equivalent (no filter applied).
 * - `brand`: exact match against `games.brand` (single-brand sidebar nav).
 *   NULL brands never match.
 * - `year_decade`: anchor year (e.g. 2020) → matches release_year in
 *   [year_decade, year_decade + 9].
 *
 * Phase 11 multi-dim facets (FilterPanel uses these instead of the legacy
 * single-axis `brand`/`tag_id`):
 * - `brands`: OR within — games whose brand matches any of these strings.
 * - `staff_ids`: OR within — games where any of these `persons.id` rows
 *   appear in `game_staff` (any role). For role-specific filtering, the UI
 *   selects persons of that role from `getFilterOptions()` and passes
 *   their ids; the backend doesn't filter by role here.
 * - `official_tags`: OR within — games carrying any of these tag_name
 *   strings in `game_official_tags`.
 *
 * Cross-axis combination is AND (intersect), within-axis is OR (union).
 * This matches the FilterPanel intuition: "any of these brands AND any of
 * these tags AND any of these staff".
 */
export interface SearchFilter {
  tag_id?: number;
  status?: "unplayed" | "playing" | "cleared" | "dropped";
  favorite?: boolean;
  brand?: string;
  year_decade?: number;
  // Phase 11 multi-dim filters
  brands?: string[];
  staff_ids?: number[];
  official_tags?: string[];
}

/**
 * Sort key whitelist enforced by the backend. Mapping (per 04b commands.rs):
 *   - last_played → `last_played_at IS NULL, last_played_at DESC` (NULLS LAST)
 *   - created_at  → `created_at DESC`
 *   - name        → `name COLLATE NOCASE ASC`
 *   - playtime    → `total_playtime_sec DESC`
 *   - rating      → `rating IS NULL, rating DESC` (NULLS LAST)
 *
 * Unknown values surface as a `String` error from the command; treat the
 * default sort as `last_played` (the sensible "what did I play recently"
 * default for the library grid).
 */
export type SortBy = "last_played" | "created_at" | "name" | "playtime" | "rating";

// ── sidebar aggregate shapes ────────────────────────────────────────────────

/** One tag + the count of games attached to it. */
export interface TagCount {
  tag: Tag;
  count: number;
}

/** Count of games grouped by `status` value. */
export interface StatusCount {
  status: "unplayed" | "playing" | "cleared" | "dropped";
  count: number;
}

/** Count of games per distinct `brand` (NULL/empty brands excluded). */
export interface BrandCount {
  brand: string;
  count: number;
}

/**
 * Count of games per release-year decade. `decade` is the anchor year
 * (e.g. 2020 covers 2020-2029). NULL `release_year` rows excluded.
 */
export interface DecadeCount {
  decade: number;
  count: number;
}

/**
 * Aggregate payload powering the sidebar's auto-derived sections. Computed
 * server-side with 4 SELECTs + 1 scalar COUNT (see `get_sidebar_categories`
 * in commands.rs). Refresh after any mutation that affects games or tags.
 */
export interface SidebarCategories {
  tags: TagCount[];
  statuses: StatusCount[];
  brands: BrandCount[];
  year_decades: DecadeCount[];
  favorite_count: number;
}

// ── invoke wrappers ─────────────────────────────────────────────────────────

/**
 * Search + sort + filter the games library. Pass `null` for `query` to
 * skip the LIKE clause (returns the full sorted/filtered set). Pass `null`
 * for `filter` to skip all WHERE clauses other than the search query.
 *
 * The backend builds a single dynamic SQL statement; sort_by is whitelisted
 * (no string interpolation of user input) and filter clauses bind via
 * parameters where possible. Response shape matches `listGames()` —
 * frontend `Game[]` consumers can be reused directly.
 */
export async function searchGames(
  query: string | null,
  sortBy: SortBy,
  filter: SearchFilter | null,
): Promise<Game[]> {
  return invoke<Game[]>("search_games", { query, sortBy, filter });
}

/**
 * Fetch the sidebar aggregate counts. Cheap (5 small SELECTs against the
 * games + tags tables). Call on app boot AND after any mutation that
 * could shift the counts (tag CRUD, status update, favorite toggle, brand
 * /year update via metadata refresh, scan completion).
 */
export async function getSidebarCategories(): Promise<SidebarCategories> {
  return invoke<SidebarCategories>("get_sidebar_categories");
}
