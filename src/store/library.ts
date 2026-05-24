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
import { type AdvancedFilter, EMPTY_ADV_FILTER } from "@/lib/advancedFilter";
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
   * 20260509f — `game.id` → phase map of in-flight metadata fetches.
   *
   * Phase semantics (quick 260515-loading-phase-sort):
   *   - "in_flight"        : backend has emitted `started`, not yet `finished`.
   *                          Loading visual MUST stay regardless of row state —
   *                          for `refresh_metadata_smart` the row is already
   *                          bound before processing, so a bound-only check
   *                          would wipe the loading visual the instant it was
   *                          added.
   *   - "awaiting_refetch" : backend emitted `finished` but the throttled
   *                          `games-changed` refetch hasn't landed yet. Keep
   *                          the loading visual until Library's reconcile
   *                          effect confirms the row is bound (or terminally
   *                          failed). This preserves the loading-persist
   *                          intent from `quick 260515-loading-persist`.
   *
   * Maintained by the `meta-fetch-progress` listener in main.tsx
   *   started  → addFetchingMetaId(id)          ("in_flight")
   *   finished → markFetchingMetaFinished(id)   ("awaiting_refetch")
   * Bulk-cleared by the `scan-progress` listener on terminal status
   * (completed / cancelled / failed).
   *
   * Consumed by `<GameCard />` via a per-card selector
   * `(s) => s.fetchingMetaIds[game.id] != null` so a card only re-renders
   * when its own id enters or leaves the set.
   */
  fetchingMetaIds: Record<number, "in_flight" | "awaiting_refetch">;

  /**
   * Quick 260515-loading-phase-sort (round-3) — `game.id`s that have received
   * a `started` event since the current scan/refresh run began.
   *
   * Purpose: distinguish "queued — not yet processed this run" from "already
   * processed". During `refresh_metadata_smart` every row is already bound,
   * so without this set only the ~4 in-flight cards have any loading visual
   * and the rest of the library looks frozen. A card NOT in this set while a
   * scan is running is rendered with the "pending" pulse (mirrors the
   * placeholder pulse during a fresh start_scan).
   *
   * Lifecycle: added by `addFetchingMetaId` (alongside fetchingMetaIds);
   * bulk-cleared by `clearFetchingMetaIds` on terminal scan-progress so the
   * next run starts empty. `removeFetchingMetaId` does NOT clear it — a card
   * that finished stays "touched" (= done, not queued).
   */
  metaTouchedIds: Record<number, true>;

  /**
   * Quick 260515-loading-phase-sort (round-3) — true while a full-library
   * `refresh_metadata_smart` run is in progress.
   *
   * Needed because `scanProgress.status === "running"` alone cannot tell a
   * full refresh apart from an incremental `start_scan`: an incremental scan
   * never re-enriches already-bound games, so those rows would never receive
   * a `started` event and would pulse as "queued" forever. The queued-card
   * (isPendingRefresh) visual is gated on THIS flag, not on scanRunning, so
   * it only lights up when every visible row really is in scope.
   *
   * Set true by Settings' onRefreshMetadata before invoking the IPC;
   * cleared on terminal scan-progress (completed / cancelled / failed).
   */
  metaRefreshActive: boolean;

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
   * Quick 260524-dlr — multi-dim advanced filter (brands / staffIds /
   * officialTags / statuses / years / rating / duration / reviewOnly).
   *
   * Lifted from Library.tsx local useState to the store so other routes
   * (Detail tag chips, future sidebar entries, SearchBar prefix-typed
   * autocomplete) can set facet selections and `navigate('/')` and have
   * Library pick them up on mount. Library subscribes for re-fetch;
   * FilterPanel clones into a local draft on open.
   */
  advFilter: AdvancedFilter;
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

  /**
   * Quick 260516-vs4 — persisted `scrollTop` of the Library route's scroll
   * container. Defaults to 0.
   *
   * Why this lives in the global store and not in component state: Library
   * and Detail are sibling HashRouter routes, so navigating into a game's
   * detail page fully unmounts `<Library/>` — any in-component `useState`/
   * `useRef` (including the scroll position) is destroyed. Snapshotting the
   * value here lets it survive the unmount so the route can restore the
   * grid/list scroll position when the user navigates back.
   *
   * Session-scoped on purpose: NOT persisted to disk (no `persist`
   * middleware) — a fresh app launch resets the library to the top, which
   * is the expected "start at the top of my shelf" behavior.
   */
  libraryScrollTop: number;

  setScanRoots: (rs: ScanRoot[]) => void;
  setScanProgress: (p: ScanProgress | null) => void;
  setGames: (gs: Game[]) => void;
  /**
   * Merge a single updated game row into the cached `games` array.
   * - If an entry with the same `id` already exists, replace it in place.
   * - Otherwise no-op (we don't want Detail's mutation to suddenly inject a
   *   game the Library list hasn't fetched yet — that breaks the
   *   single-source-of-truth invariant when filters/searches change the
   *   visible set).
   *
   * Detail's `refreshGame` calls this after each mutation so Library doesn't
   * see stale rows (BL-02 in 260524 review).
   */
  upsertGame: (g: Game) => void;
  addFetchingMetaId: (id: number) => void;
  markFetchingMetaFinished: (id: number) => void;
  removeFetchingMetaId: (id: number) => void;
  clearFetchingMetaIds: () => void;
  setMetaRefreshActive: (v: boolean) => void;
  setActiveSession: (s: ActiveSession | null) => void;
  setSessionsForGame: (gameId: number, sessions: SessionRow[]) => void;
  setSearchQuery: (q: string) => void;
  setSortBy: (s: SortBy) => void;
  setFilter: (f: SearchFilter) => void;
  setAdvFilter: (f: AdvancedFilter) => void;
  setTags: (ts: Tag[]) => void;
  setSidebar: (s: SidebarCategories | null) => void;
  setTrend: (t: TrendPoint[]) => void;
  setTopGames: (gs: TopGame[]) => void;
  setScreenshotsForGame: (gameId: number, screenshots: Screenshot[]) => void;
  setSaveBackupsForGame: (gameId: number, backups: SaveBackup[]) => void;
  setLibraryScrollTop: (top: number) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  scanRoots: [],
  scanProgress: null,
  games: [],
  fetchingMetaIds: {},
  metaTouchedIds: {},
  metaRefreshActive: false,
  activeSession: null,
  sessionsByGame: {},
  searchQuery: "",
  sortBy: DEFAULT_SORT_BY,
  filter: EMPTY_FILTER,
  advFilter: EMPTY_ADV_FILTER,
  tags: [],
  sidebar: null,
  trend: [],
  topGames: [],
  screenshotsByGame: {},
  saveBackupsByGame: {},
  libraryScrollTop: 0,
  setScanRoots: (rs) => set({ scanRoots: rs }),
  setScanProgress: (p) => set({ scanProgress: p }),
  setGames: (gs) => set({ games: gs }),
  upsertGame: (g) =>
    set((st) => {
      const idx = st.games.findIndex((x) => x.id === g.id);
      if (idx < 0) return st;
      const next = st.games.slice();
      next[idx] = g;
      return { games: next };
    }),
  addFetchingMetaId: (id) =>
    set((st) => {
      // `started` does two things: marks the id in_flight (loading visual)
      // AND records it as "touched this run" (so it's no longer rendered as
      // a queued/pending card). Skip the spread for whichever map is already
      // in the target state to avoid invalidating unrelated subscribers.
      const alreadyInFlight = st.fetchingMetaIds[id] === "in_flight";
      const alreadyTouched = st.metaTouchedIds[id] === true;
      if (alreadyInFlight && alreadyTouched) return st;
      return {
        fetchingMetaIds: alreadyInFlight
          ? st.fetchingMetaIds
          : { ...st.fetchingMetaIds, [id]: "in_flight" },
        metaTouchedIds: alreadyTouched
          ? st.metaTouchedIds
          : { ...st.metaTouchedIds, [id]: true },
      };
    }),
  markFetchingMetaFinished: (id) =>
    set((st) => {
      const prev = st.fetchingMetaIds[id];
      if (prev == null) {
        // Defensive: backend emitted `finished` without a preceding `started`
        // (unlikely, but possible in a panic-on-start path). Track it so the
        // Library reconcile effect can still resolve the loading visual once
        // the row is bound.
        return {
          fetchingMetaIds: { ...st.fetchingMetaIds, [id]: "awaiting_refetch" },
        };
      }
      if (prev === "awaiting_refetch") return st;
      return {
        fetchingMetaIds: { ...st.fetchingMetaIds, [id]: "awaiting_refetch" },
      };
    }),
  removeFetchingMetaId: (id) =>
    set((st) => {
      // Skip the spread when the id wasn't tracked (avoids a no-op object
      // identity bump that would invalidate every fetchingMetaIds-subscriber).
      if (st.fetchingMetaIds[id] == null) return st;
      const next = { ...st.fetchingMetaIds };
      delete next[id];
      return { fetchingMetaIds: next };
    }),
  clearFetchingMetaIds: () =>
    set((st) =>
      // Object.keys length check — clearing already-empty records would
      // still produce new {} references and invalidate subscribers.
      // Clears fetchingMetaIds + metaTouchedIds + metaRefreshActive so the
      // next scan/refresh run starts with a clean "queued" baseline. Called
      // on terminal scan-progress (completed / cancelled / failed).
      Object.keys(st.fetchingMetaIds).length === 0 &&
      Object.keys(st.metaTouchedIds).length === 0 &&
      !st.metaRefreshActive
        ? st
        : { fetchingMetaIds: {}, metaTouchedIds: {}, metaRefreshActive: false },
    ),
  setMetaRefreshActive: (v) =>
    set((st) => (st.metaRefreshActive === v ? st : { metaRefreshActive: v })),
  setActiveSession: (s) => set({ activeSession: s }),
  setSessionsForGame: (gameId, sessions) =>
    set((st) => ({
      sessionsByGame: { ...st.sessionsByGame, [gameId]: sessions },
    })),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortBy: (s) => set({ sortBy: s }),
  setFilter: (f) => set({ filter: f }),
  setAdvFilter: (f) => set({ advFilter: f }),
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
  setLibraryScrollTop: (top) => set({ libraryScrollTop: top }),
}));
