/**
 * Client-side post-filter layer applied on top of the server-side `searchGames`
 * result. The backend `SearchFilter` is single-axis (single tag, single status,
 * single brand, single decade); the supplementary §6 filter panel needs
 * multi-status, rating range, year multi-select, and duration bucket — all of
 * which we can compute purely from the `Game` rows we already have in memory.
 *
 * Tag include/exclude is intentionally NOT here: the `Game` row doesn't carry
 * its tag membership, and fanning out N `list_game_tags` calls per game is the
 * wrong scaling shape. When the backend grows a multi-tag filter, this layer
 * stays — both can coexist (server-side narrows; client-side trims further).
 */

import type { Game } from "./games";

export type DurationBucket =
  | "none"
  | "lt1h"
  | "h1to10"
  | "h10to50"
  | "h50plus";

/** Quick 20260510b — slice value for the age-rating section. "unknown" matches `age_rating == null`. */
export type AgeRatingSlice = "r18" | "all_ages" | "unknown";

export interface AdvancedFilter {
  /** Multi-status include set; empty = no constraint. */
  statuses: Set<Game["status"]>;
  /** Inclusive lower bound on `rating` (1..10). null = no lower bound. */
  ratingMin: number | null;
  /** Inclusive upper bound on `rating` (1..10). null = no upper bound. */
  ratingMax: number | null;
  /** Year-set include; empty = no constraint. Uses `release_year` directly
   *  (backend's single-decade filter is sidebar-driven and stays separate). */
  years: Set<number>;
  /** Multi-select duration buckets; empty = no constraint. */
  durations: Set<DurationBucket>;
  /** Only games with `match_confidence < 80`. */
  reviewOnly: boolean;
  // ── Phase 11 multi-dim facets ──
  /** Brand set; empty = no constraint. Server-side filtered via `SearchFilter.brands`. */
  brands: Set<string>;
  /**
   * Staff person-id set; empty = no constraint. Server-side filtered via
   * `SearchFilter.staff_ids` (any role). Frontend tracks the role only for
   * grouping in the panel UI.
   */
  staffIds: Set<number>;
  /** Official tag-name set; empty = no constraint. */
  officialTags: Set<string>;
  /** Quick 20260510b — age-rating multi-select; empty = no constraint. */
  ageRatings: Set<AgeRatingSlice>;
}

export const EMPTY_ADV_FILTER: AdvancedFilter = {
  statuses: new Set(),
  ratingMin: null,
  ratingMax: null,
  years: new Set(),
  durations: new Set(),
  reviewOnly: false,
  brands: new Set(),
  staffIds: new Set(),
  officialTags: new Set(),
  ageRatings: new Set(),
};

/** True iff the filter would narrow the input set. */
export function isAdvFilterActive(f: AdvancedFilter): boolean {
  return (
    f.statuses.size > 0 ||
    f.ratingMin != null ||
    f.ratingMax != null ||
    f.years.size > 0 ||
    f.durations.size > 0 ||
    f.reviewOnly ||
    f.brands.size > 0 ||
    f.staffIds.size > 0 ||
    f.officialTags.size > 0 ||
    f.ageRatings.size > 0
  );
}

/** Number of independent slices currently constraining the result. */
export function countActiveSlices(f: AdvancedFilter): number {
  let n = 0;
  if (f.statuses.size > 0) n++;
  if (f.ratingMin != null || f.ratingMax != null) n++;
  if (f.years.size > 0) n++;
  if (f.durations.size > 0) n++;
  if (f.reviewOnly) n++;
  if (f.brands.size > 0) n++;
  if (f.staffIds.size > 0) n++;
  if (f.officialTags.size > 0) n++;
  if (f.ageRatings.size > 0) n++;
  return n;
}

/** True if the game's playtime falls inside *any* selected bucket. */
function durationMatches(seconds: number, buckets: Set<DurationBucket>): boolean {
  const hours = seconds / 3600;
  if (buckets.has("none") && seconds === 0) return true;
  if (buckets.has("lt1h") && seconds > 0 && hours < 1) return true;
  if (buckets.has("h1to10") && hours >= 1 && hours < 10) return true;
  if (buckets.has("h10to50") && hours >= 10 && hours < 50) return true;
  if (buckets.has("h50plus") && hours >= 50) return true;
  return false;
}

/** Apply the advanced filter to the input array. Returns a new array. */
export function applyAdvancedFilter(
  games: Game[],
  f: AdvancedFilter,
): Game[] {
  if (!isAdvFilterActive(f)) return games;
  return games.filter((g) => {
    if (f.statuses.size > 0 && !f.statuses.has(g.status)) return false;
    if (f.ratingMin != null) {
      if (g.rating == null || g.rating < f.ratingMin) return false;
    }
    if (f.ratingMax != null) {
      if (g.rating == null || g.rating > f.ratingMax) return false;
    }
    if (f.years.size > 0) {
      if (g.release_year == null || !f.years.has(g.release_year)) return false;
    }
    if (f.durations.size > 0 && !durationMatches(g.total_playtime_sec, f.durations))
      return false;
    if (f.reviewOnly) {
      if (g.match_confidence == null || g.match_confidence >= 80) return false;
    }
    // Brand is client-side filterable (Game row carries `brand`); staffIds
    // and officialTags are NOT — those go through SearchFilter and are
    // already narrowed server-side by the time we get here.
    if (f.brands.size > 0) {
      if (g.brand == null || !f.brands.has(g.brand)) return false;
    }
    // Quick 20260510b — age_rating is on the Game row, so we can filter
    // client-side. "unknown" is the sentinel for `age_rating == null`.
    if (f.ageRatings.size > 0) {
      const slice: AgeRatingSlice = g.age_rating ?? "unknown";
      if (!f.ageRatings.has(slice)) return false;
    }
    return true;
  });
}
