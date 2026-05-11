/**
 * Phase 12 — Tauri invoke wrappers for the persistent scan review queue.
 *
 * Backed by `scan_review_queue` (schema v9). Rows are written by
 * `apply_ingest_result` whenever `metadata_source = 'none'` OR
 * `match_confidence < 80`, and cleared by `bind_metadata` /
 * `accept_review_candidate` / `dismiss_review_item`.
 *
 * `accept_review_candidate` is a semantic alias over `bindMetadata` — the
 * frontend uses this name when the user clicks "采用 Bangumi" / "采用 VNDB"
 * from the ReviewQueue UI; functionally identical to a direct bindMetadata.
 */

import { invoke } from "@tauri-apps/api/core";
import { type Candidate } from "./metadata";

/** One row in the review queue, joined with `games` so the UI can show the
 *  current display name + cover thumbnail without a second round-trip. */
export interface ReviewItem {
  game_id: number;
  game_path: string;
  /** Current `games.name`; null if the game row was deleted but the queue
   *  row hadn't been cleaned up yet (defensive — FK CASCADE should prevent
   *  this in practice). */
  name: string | null;
  /** Current `games.cover_path`; render via `convertFileSrc` + cache-buster. */
  cover_path: string | null;
  /** Snapshot of `games.match_confidence` at the time the queue row was
   *  written (0..=100). 0 indicates `metadata_source='none'`. */
  current_confidence: number;
  /** Current `games.metadata_source`. */
  current_source: string | null;
  /** Current `games.bangumi_id` or `games.vndb_id` depending on
   *  current_source (NULL when current_source is 'none'). */
  current_source_id: string | null;
  /** Source the auto-ingest picked (NULL when ingest found nothing at all). */
  suggested_source: string | null;
  /** Source id the auto-ingest picked (NULL when ingest found nothing). */
  suggested_id: string | null;
  /** ISO8601 strftime — when the row was enqueued. ORDER BY DESC means
   *  newest entries at the top of the list. */
  created_at: string;
}

/** Side-by-side Bangumi vs VNDB top-1 candidates for the compare card. Either
 *  side may be null (source failed or returned 0 hits). */
export interface ReviewCandidates {
  bangumi: Candidate | null;
  vndb: Candidate | null;
}

export async function listScanReviewQueue(): Promise<ReviewItem[]> {
  return invoke<ReviewItem[]>("list_scan_review_queue");
}

export async function dismissReviewItem(gameId: number): Promise<void> {
  await invoke("dismiss_review_item", { gameId });
}

export async function acceptReviewCandidate(
  gameId: number,
  source: "bangumi" | "vndb",
  sourceId: string,
): Promise<void> {
  await invoke("accept_review_candidate", { gameId, source, sourceId });
}

export async function fetchReviewCandidates(
  gameId: number,
): Promise<ReviewCandidates> {
  return invoke<ReviewCandidates>("fetch_review_candidates", { gameId });
}
