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

export interface AdvancedFilter {
  /** Multi-status include set; empty = no constraint. */
  statuses: Set<Game["status"]>;
  /**
   * Inclusive lower bound on the (now sole) rating axis. null = no lower bound.
   * Quick 260526-0bi — switched from local `rating` (1..10 int) to
   * `external_rating` (0..=10 float); UI field name kept for compatibility.
   */
  ratingMin: number | null;
  /**
   * Inclusive upper bound on the (now sole) rating axis. null = no upper bound.
   * Quick 260526-0bi — see ratingMin doc.
   */
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
    f.officialTags.size > 0
  );
}

/**
 * 累计「已选条目」总数（不是活跃维度数）—— 多选维度按 Set.size 计入，
 * 单值维度（rating range / reviewOnly）作为 1 计入。
 *
 * Quick 260524-dlr：用户期望搜索栏选了 3 个品牌 + 2 个声优时，筛选按钮
 * 角标显示 5。旧实现按「活跃维度数」算只显示 2，与直觉不符。
 */
export function countActiveSlices(f: AdvancedFilter): number {
  let n = 0;
  n += f.statuses.size;
  if (f.ratingMin != null || f.ratingMax != null) n += 1;
  n += f.years.size;
  n += f.durations.size;
  if (f.reviewOnly) n += 1;
  n += f.brands.size;
  n += f.staffIds.size;
  n += f.officialTags.size;
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
      if (g.external_rating == null || g.external_rating < f.ratingMin) return false;
    }
    if (f.ratingMax != null) {
      if (g.external_rating == null || g.external_rating > f.ratingMax) return false;
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
    return true;
  });
}
