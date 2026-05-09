/**
 * Library-domain Zustand store — scan roots cache + live scan progress + games
 * + Phase 3 active session + per-game session history.
 *
 * Mirrors the pattern of `src/store/app.ts` (single `create()` invocation
 * with shallow setters; no slice/middleware).
 *
 * Phase 2 scope:
 *   - `scanRoots`: cached read-through of `scan_roots` table
 *   - `scanProgress`: latest `scan-progress` event payload (null when idle)
 *   - `games`: cached read-through of `games` table
 *
 * Phase 3 (03f) additions:
 *   - `activeSession`: latest payload of `active-session-changed` event
 *     (null when nothing is running). Hydrated from `getActiveSession()` on
 *     app boot, kept fresh by the module-scope subscription in `main.tsx`.
 *   - `sessionsByGame`: per-game session-history cache. Keyed by `game.id`,
 *     populated by the Detail page on mount via `listSessions(gameId)`. We
 *     keep this in the global store rather than per-route state so a future
 *     "totals across all games" view can subscribe without prop-drilling.
 *
 * Source-of-truth rule: backend (SQLite + Tauri events) owns these
 * collections; frontend cache is reconciled by re-calling the relevant
 * `list*()` invoke after a mutation, and updated by event listeners
 * subscribed at module scope. Avoids the optimistic-update vs. real-state
 * divergence trap.
 */

import { create } from "zustand";
import type { ScanProgress, ScanRoot } from "@/lib/scan";
import type { Game } from "@/lib/games";
import type { ActiveSession, SessionRow } from "@/lib/launch";
import type { SearchFilter, SidebarCategories, SortBy } from "@/lib/search";
import type { Tag } from "@/lib/tags";
import type { TopGame, TrendPoint } from "@/lib/stats";
import type { Screenshot } from "@/lib/screenshots";
import type { SaveBackup } from "@/lib/saves";

/**
 * Default sort key for the library grid. Matches the "show me what I played
 * recently" mental model — the ORDER BY in the backend places NULLS LAST,
 * so unplayed games still appear, just sorted to the bottom.
 */
const DEFAULT_SORT_BY: SortBy = "last_played";

/**
 * Empty-but-typed filter sentinel. We DO NOT use `null` for the filter slice
 * because the UI binds individual fields (e.g. `filter.status`) and would
 * have to null-guard every field access. Equivalent semantically: the
 * backend treats an all-undefined filter as "no clauses applied".
 */
const EMPTY_FILTER: SearchFilter = {};

interface LibraryState {
  /** Full list of scan_roots rows; refreshed after add/remove. */
  scanRoots: ScanRoot[];
  /**
   * Most recent scan-progress event payload, or `null` when no scan is or
   * has been active in this session. UI components null-check before
   * rendering the progress bar.
   */
  scanProgress: ScanProgress | null;
  /**
   * Full list of games (rendered as the cover grid). Refreshed after every
   * scan completion + after every metadata bind/refresh. Empty array means
   * either "no scans yet" OR "scanned but zero hits" — the consumer
   * disambiguates via `scanProgress.status`.
   */
  games: Game[];

  /**
   * 20260509f — Set of `game.id`s currently being fetched (started → finished
   * pair on the backend `meta-fetch-progress` event). Modeled as
   * `Record<number, true>` rather than `Set<number>` so:
   *   - zustand's shallow equality detects mutations (Set identity rarely changes)
   *   - JSON-friendly (devtools / persistence-ready if we ever hydrate it)
   *
   * Maintained by the module-scope `meta-fetch-progress` listener in main.tsx
   * (started → addFetchingMetaId / finished → removeFetchingMetaId).
   * Also bulk-cleared by the `scan-progress` listener on terminal status
   * (completed / cancelled / failed) to defend against any missed
   * finished-emit (e.g. backend panic mid-iteration).
   *
   * Consumed by `<GameCard />` via a per-card boolean selector
   * `(s) => s.fetchingMetaIds[game.id] === true` so a card only re-renders
   * when its own id transitions in/out of the set (zustand referential check).
   */
  fetchingMetaIds: Record<number, true>;

  /**
   * Currently-running game session, or null. Driven by the
   * `active-session-changed` event subscription in `main.tsx`. Used by:
   *   - `<ActiveSessionBar />` (sticky-top bar; null hides it)
   *   - `<GameCard />` (toggles 启动 ↔ 强制结束 button visibility)
   *   - `<Detail />` (disables the launch button on the active game's page)
   */
  activeSession: ActiveSession | null;
  /**
   * Per-game session history cache. Keyed by `game.id`; populated lazily by
   * the Detail page on mount. Not auto-evicted (typical libraries are
   * 50-500 games × ≤100 sessions = bounded memory).
   */
  sessionsByGame: Record<number, SessionRow[]>;

  // ── Phase 4 / 04c: search / sort / filter / tags / sidebar slices ─────────

  /**
   * Free-form search query. Empty string means "no LIKE clause" — the
   * `searchGames(query, ...)` invoke wrapper still passes `null` in that
   * case (it trims and converts empty → null), so the store uses `""` as
   * the controlled-input sentinel for the search box.
   */
  searchQuery: string;
  /**
   * Active sort key for the library grid. Defaults to "last_played" so the
   * boot view surfaces recent plays first. Mutating this triggers a
   * `searchGames()` re-fetch in the consuming component (the store does
   * NOT re-fetch automatically — keeps this layer purely state-holding).
   */
  sortBy: SortBy;
  /**
   * Active filter clauses. UI mutates individual fields (e.g.
   * `setFilter({ ...filter, status: "playing" })`); pass `EMPTY_FILTER`
   * sentinel via `setFilter({})` to clear. Empty filter is sent to the
   * backend as-is (backend treats all-undefined as "no clauses").
   */
  filter: SearchFilter;
  /**
   * Cached tag list (read-through of `listTags()`). Refreshed after every
   * tag CRUD mutation AND on app boot. Sorted by name (matches backend
   * ORDER BY in `list_tags`).
   */
  tags: Tag[];
  /**
   * Cached sidebar aggregate counts (read-through of
   * `getSidebarCategories()`). `null` until first fetch completes — the
   * sidebar component should render skeleton/empty state on `null`. Refresh
   * after any mutation that affects games or tags (status/favorite/brand/
   * year/tag CRUD/scan completion).
   */
  sidebar: SidebarCategories | null;

  // ── Phase 5 / 05c: stats / screenshots / saves slices ────────────────────

  /**
   * Cached playtime-trend chart series (read-through of `getPlaytimeTrend()`).
   * Empty array means either "no fetch yet" OR "no terminal sessions in
   * window" — the consumer disambiguates via a separate loaded flag if
   * needed (we keep this slice purely state-holding, no auto-refresh).
   *
   * Re-fetched whenever the user changes period/days on the stats page; the
   * cache is shared across remounts so navigation back to the page is instant.
   */
  trend: TrendPoint[];
  /**
   * Cached top-N games list (read-through of `getTopGames()`). Sorted by
   * `total_playtime_sec DESC` (mirror of the backend ORDER BY). Refreshed
   * after any session ends (since `total_playtime_sec` advances) and on
   * stats-page mount.
   */
  topGames: TopGame[];

  /**
   * Per-game screenshot cache, keyed by `game.id`. Populated lazily by the
   * Detail page / screenshots gallery on mount via `getScreenshots(gameId)`.
   * Same eviction philosophy as `sessionsByGame`: not auto-evicted (typical
   * libraries are 50-500 games × ≤a few hundred screenshots, bounded enough).
   *
   * Re-set after any screenshot mutation (delete/auto-capture event) by
   * re-calling `getScreenshots(gameId)` and replacing the per-game array.
   */
  screenshotsByGame: Record<number, Screenshot[]>;

  /**
   * Per-game save-backup cache, keyed by `game.id`. Populated lazily by the
   * Detail page's "存档备份" tab on mount via `listSaveBackups(gameId)`.
   * Re-set after create/restore/delete by re-calling the list invoke; we
   * deliberately don't optimistic-update so DB-derived fields like
   * `file_count` / `total_size_bytes` are always backend-authoritative.
   */
  saveBackupsByGame: Record<number, SaveBackup[]>;

  setScanRoots: (rs: ScanRoot[]) => void;
  setScanProgress: (p: ScanProgress | null) => void;
  setGames: (gs: Game[]) => void;
  addFetchingMetaId: (id: number) => void;
  removeFetchingMetaId: (id: number) => void;
  clearFetchingMetaIds: () => void;
  setActiveSession: (s: ActiveSession | null) => void;
  setSessionsForGame: (gameId: number, sessions: SessionRow[]) => void;
  setSearchQuery: (q: string) => void;
  setSortBy: (s: SortBy) => void;
  setFilter: (f: SearchFilter) => void;
  setTags: (ts: Tag[]) => void;
  setSidebar: (s: SidebarCategories | null) => void;
  setTrend: (t: TrendPoint[]) => void;
  setTopGames: (gs: TopGame[]) => void;
  setScreenshotsForGame: (gameId: number, screenshots: Screenshot[]) => void;
  setSaveBackupsForGame: (gameId: number, backups: SaveBackup[]) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  scanRoots: [],
  scanProgress: null,
  games: [],
  fetchingMetaIds: {},
  activeSession: null,
  sessionsByGame: {},
  searchQuery: "",
  sortBy: DEFAULT_SORT_BY,
  filter: EMPTY_FILTER,
  tags: [],
  sidebar: null,
  trend: [],
  topGames: [],
  screenshotsByGame: {},
  saveBackupsByGame: {},
  setScanRoots: (rs) => set({ scanRoots: rs }),
  setScanProgress: (p) => set({ scanProgress: p }),
  setGames: (gs) => set({ games: gs }),
  addFetchingMetaId: (id) =>
    set((st) => ({ fetchingMetaIds: { ...st.fetchingMetaIds, [id]: true } })),
  removeFetchingMetaId: (id) =>
    set((st) => {
      // Skip the spread when the id wasn't tracked (avoids a no-op object
      // identity bump that would invalidate every fetchingMetaIds-subscriber).
      if (st.fetchingMetaIds[id] !== true) return st;
      const next = { ...st.fetchingMetaIds };
      delete next[id];
      return { fetchingMetaIds: next };
    }),
  clearFetchingMetaIds: () =>
    set((st) =>
      // Object.keys length check — clearing an already-empty record would
      // still produce a new {} reference and invalidate subscribers.
      Object.keys(st.fetchingMetaIds).length === 0
        ? st
        : { fetchingMetaIds: {} },
    ),
  setActiveSession: (s) => set({ activeSession: s }),
  setSessionsForGame: (gameId, sessions) =>
    set((st) => ({
      sessionsByGame: { ...st.sessionsByGame, [gameId]: sessions },
    })),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortBy: (s) => set({ sortBy: s }),
  setFilter: (f) => set({ filter: f }),
  setTags: (ts) => set({ tags: ts }),
  setSidebar: (s) => set({ sidebar: s }),
  setTrend: (t) => set({ trend: t }),
  setTopGames: (gs) => set({ topGames: gs }),
  setScreenshotsForGame: (gameId, screenshots) =>
    set((st) => ({
      screenshotsByGame: { ...st.screenshotsByGame, [gameId]: screenshots },
    })),
  setSaveBackupsForGame: (gameId, backups) =>
    set((st) => ({
      saveBackupsByGame: { ...st.saveBackupsByGame, [gameId]: backups },
    })),
}));
