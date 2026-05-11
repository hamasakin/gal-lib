/**
 * Phase 11 — invoke wrappers for the metadata-enrichment IPC layer.
 *
 * Mirrors the 6 commands registered in `src-tauri/src/lib.rs` (Phase 11):
 *   - `list_persons_for_game(game_id)` — staff + voice for a single game
 *   - `list_games_for_person(person_id, role?)` — backlinks for `/persons/:id`
 *   - `list_official_tags_for_game(game_id)` — Bangumi/VNDB tag list
 *   - `get_filter_options()` — distinct facet options for FilterPanel
 *   - `backfill_metadata_enrichment()` — async batch enrichment for already-bound games
 *   - `open_external_url(url)` — opens default browser via shell start (http(s) only)
 *
 * Field names use snake_case to match Rust serde-deserialized payloads
 * (Tauri arg-name conversion only handles top-level invoke args, not
 * nested response fields).
 */

import { invoke } from "@tauri-apps/api/core";
import type { Game } from "./games";

/** Locked 4-role enum mirroring `StaffRole` in `src-tauri/src/metadata/types.rs`. */
export type StaffRole = "scenario" | "artist" | "voice" | "music";

/** Phase 13 (PER-01) — attribution for one underlying persons row that
 * contributed to a merged GameStaffRow. */
export interface PersonSourceRef {
  source: "bangumi" | "vndb";
  source_id: string;
}

/** A row from `persons` joined with role/character_name from `game_staff`.
 *
 * Phase 13 (PER-01): same person on Bangumi+VNDB (matched by name + role +
 * character_name) is folded into a single row by the Rust query layer.
 * `sources` lists every source that contributed; `person_ids` lists every
 * underlying `persons.id`. The top-level `source` / `source_id` / `person_id`
 * are the representative (Bangumi-preferred) attribution.
 */
export interface GameStaffRow {
  person_id: number;
  name: string;
  name_cn: string | null;
  source: "bangumi" | "vndb";
  source_id: string;
  role: StaffRole;
  /** Voice-only; null for non-voice roles. */
  character_name: string | null;
  /** All (source, source_id) pairs covered by this merged row. */
  sources: PersonSourceRef[];
  /** All underlying persons.id values covered by this merged row. */
  person_ids: number[];
}

/** A row from `game_official_tags` (Bangumi/VNDB official tag list). */
export interface OfficialTagRow {
  tag_name: string;
  source: "bangumi" | "vndb";
  /** Bangumi user-tag count, or VNDB rating × 100 (rounded). Higher = stronger tag. */
  weight: number;
}

/** Distinct person option for FilterPanel facet (per role). */
export interface PersonOption {
  id: number;
  name: string;
  name_cn: string | null;
  /** Number of distinct games this person participated in (for display). */
  count: number;
}

/** Distinct tag option for FilterPanel facet. */
export interface TagOption {
  name: string;
  /** Number of distinct games carrying this tag. */
  count: number;
}

/**
 * Aggregate facet payload for the multi-dim FilterPanel.
 * Each list is sorted by `count` descending so the UI shows the most-
 * frequently-used options first.
 */
export interface FilterOptions {
  brands: Array<{ name: string; count: number }>;
  scenarios: PersonOption[];
  artists: PersonOption[];
  voices: PersonOption[];
  music: PersonOption[];
  official_tags: TagOption[];
}

export async function listPersonsForGame(gameId: number): Promise<GameStaffRow[]> {
  return invoke<GameStaffRow[]>("list_persons_for_game", { gameId });
}

export async function listGamesForPerson(
  personId: number,
  role?: StaffRole,
): Promise<Game[]> {
  return invoke<Game[]>("list_games_for_person", {
    personId,
    role: role ?? null,
  });
}

export async function listOfficialTagsForGame(
  gameId: number,
): Promise<OfficialTagRow[]> {
  return invoke<OfficialTagRow[]>("list_official_tags_for_game", { gameId });
}

/**
 * Phase 13 (PER-03) — co-staff strip payload row. `coshare` is how many of
 * the target person's games this person also worked on; `role_hint` is the
 * role they most often held across those shared games (frontend tag).
 */
export interface CoStaffRow {
  person_id: number;
  name: string;
  name_cn: string | null;
  source: "bangumi" | "vndb";
  source_id: string;
  coshare: number;
  role_hint: StaffRole | null;
}

export async function listCoStaffForPerson(
  personId: number,
  limit?: number,
): Promise<CoStaffRow[]> {
  return invoke<CoStaffRow[]>("list_co_staff_for_person", {
    personId,
    limit: limit ?? null,
  });
}

export async function getFilterOptions(): Promise<FilterOptions> {
  return invoke<FilterOptions>("get_filter_options");
}

/**
 * Trigger backfill enrichment for all games with a bound source-id but no
 * `game_staff` rows. Fire-and-forget — progress is reported through the
 * existing `meta-fetch-progress` event channel (subscribed in main.tsx).
 * Bangumi's 1req/s limiter caps real-world throughput at ~3 games/sec
 * (3 endpoints per game) so a 200-game library takes ≈10 minutes.
 */
export async function backfillMetadataEnrichment(): Promise<void> {
  await invoke("backfill_metadata_enrichment");
}

/**
 * Open an external http(s) URL in the user's default browser via
 * `cmd /C start` (Windows-only; project is Windows-locked per CLAUDE.md).
 * Backend rejects non-http(s) schemes for safety.
 */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

/**
 * Helper — build the canonical Bangumi subject URL for a game given its
 * `bangumi_id`. Lives here (not in `lib/games.ts`) because it's a
 * Phase-11 concern and only used by the Detail "在 Bangumi 看 ↗" button.
 */
export function bangumiSubjectUrl(bangumiId: string): string {
  return `https://bgm.tv/subject/${bangumiId}`;
}

/**
 * Helper — build the canonical VNDB visual-novel URL given a `vndb_id`
 * (already includes the `v` prefix, e.g. "v1234").
 */
export function vndbVnUrl(vndbId: string): string {
  return `https://vndb.org/${vndbId}`;
}
