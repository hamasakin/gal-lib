/**
 * Display helpers — game-name fallback rules and data-source URL builders.
 *
 * The on-disk directory basename is the user's source of truth for an
 * unmatched library entry — `clean_title` strips paren content / version
 * trails / common prefixes, which can leave a stub the user no longer
 * recognises. We keep the cleaned title in `games.name` (it's the right
 * input for upstream search), but display falls back to the raw basename
 * whenever the entry has no metadata source bound.
 *
 * Source-URL helpers target the canonical short hosts:
 *   - Bangumi:  https://bgm.tv/subject/{id} ; search = subject_search?cat=4
 *   - VNDB:     https://vndb.org/{vid}      ; search = /v?sq=
 *
 * `openExternal` reuses the existing `window.open(_, '_blank')` pattern
 * already present in `src/routes/Detail.tsx` for cover_url. No new tauri
 * plugin / capability is added.
 */
import type { Game } from "./games";

/**
 * Last non-empty path segment, handling both POSIX `/` and Windows `\\`.
 * Falls back to the input string when no separator is present.
 */
export function basenameFromPath(path: string): string {
  if (!path) return "";
  const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

/**
 * Pick the user-facing name for a game.
 *
 * - `name_cn` wins when present (localised title from upstream).
 * - `name` is used when metadata is bound (bangumi / vndb / manual).
 * - Otherwise (none / null) → directory basename so the user can map the
 *   row back to what they see in Explorer.
 */
export function displayGameName(
  game: Pick<Game, "name" | "name_cn" | "metadata_source" | "path">,
): string {
  if (game.name_cn && game.name_cn.length > 0) return game.name_cn;
  const bound =
    game.metadata_source === "bangumi" ||
    game.metadata_source === "vndb" ||
    game.metadata_source === "manual";
  if (bound && game.name && game.name.length > 0) return game.name;
  const base = basenameFromPath(game.path);
  if (base.length > 0) return base;
  return game.name && game.name.length > 0 ? game.name : "(未命名)";
}

/** Bangumi subject page (e.g. https://bgm.tv/subject/12345). */
export function bangumiPageUrl(id: string): string {
  return `https://bgm.tv/subject/${encodeURIComponent(id)}`;
}

/** VNDB visual-novel page (id already includes the `v` prefix, e.g. v123). */
export function vndbPageUrl(id: string): string {
  return `https://vndb.org/${encodeURIComponent(id)}`;
}

/** Bangumi search restricted to the `游戏` category (cat=4). */
export function bangumiSearchUrl(query: string): string {
  return `https://bgm.tv/subject_search/${encodeURIComponent(query)}?cat=4`;
}

/** VNDB visual-novel search (canonical search-box query param). */
export function vndbSearchUrl(query: string): string {
  return `https://vndb.org/v?sq=${encodeURIComponent(query)}`;
}

/** Open a URL in the user's default browser via the webview's `window.open`. */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
