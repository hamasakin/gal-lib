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
