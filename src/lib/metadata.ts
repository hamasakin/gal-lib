/**
 * Tauri invoke wrappers for the metadata subsystem (Bangumi + VNDB).
 *
 * Wraps the 3 metadata commands registered by 02d
 * (`search_metadata` / `bind_metadata` / `refresh_metadata`).
 *
 * Type shapes mirror `src-tauri/src/metadata.rs::Candidate`. Keep this file
 * as the single TS-side source of truth — UI components import these types
 * (NOT the legacy free-form objects) so any backend shape change surfaces
 * as a typecheck failure.
 *
 * `MetadataSource` includes `"manual"` and `"none"` in addition to the two
 * remote sources because a row in `games` may have `metadata_source` set
 * either by user-driven `bind_metadata` (= `"bangumi" | "vndb"` with
 * confidence=100) or by the auto-ingest pipeline producing no match
 * (= `"none"`). `"manual"` is reserved for Phase 4 hand-edits.
 */

import { invoke } from "@tauri-apps/api/core";

export type MetadataSource = "bangumi" | "vndb" | "manual" | "none";

/** Search-result candidate row (UI displays as a list with confidence pill). */
export interface Candidate {
  source: MetadataSource;
  source_id: string;
  title: string;
  /** 中文名（镜像后端 Option<String>）；无中文时 null，候选卡按 title_cn ?? title 展示。 */
  title_cn: string | null;
  alias: string[];
  cover_url: string | null;
  release_date: string | null;
  summary: string | null;
  /** 0-100 — derived by metadata::match_score; ≥80 auto-binds in ingest. */
  confidence: number;
}

/** Search both sources independently — caller picks (or shows toggle UI). */
export async function searchMetadata(
  query: string,
  source: "bangumi" | "vndb",
): Promise<Candidate[]> {
  return invoke<Candidate[]>("search_metadata", { query, source });
}

/**
 * Bind a specific source candidate to a game row.
 * Backend writes confidence=100 (manual bind = full confidence) and
 * preserves prior cover_path via COALESCE if cover-cache fails.
 */
export async function bindMetadata(
  gameId: number,
  source: "bangumi" | "vndb",
  sourceId: string,
): Promise<void> {
  await invoke("bind_metadata", { gameId, source, sourceId });
}

/**
 * Re-run the metadata pipeline for a game using its current `name` as the
 * search query (= "rebind to whatever the auto-ingest finds now"). Used by
 * the card-level retry button when initial ingest produced metadata_source
 * = "none" or low confidence.
 */
export async function refreshMetadata(gameId: number): Promise<void> {
  await invoke("refresh_metadata", { gameId });
}
