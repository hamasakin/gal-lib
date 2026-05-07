/**
 * Library route ("/") — Phase 4 (04d) implementation.
 *
 * Builds on the Phase 2/3 layout (ScanProgressBar + ActiveSessionBar +
 * GameGrid + MetadataPicker) and adds the Phase-4 search/sort/filter top
 * bar. The grid is now driven by `searchGames(query, sortBy, filter)` —
 * sort/filter come from the Zustand store, search comes from the
 * SearchBar's debounced commit into the same store.
 *
 * Rendering tree (top → bottom):
 *   1. <ScanProgressBar />            — sticky top, auto-hides when idle
 *   2. <ActiveSessionBar />           — sticky top below scan bar
 *   3. <Top bar>                      — SearchBar (flex-1) + FilterChip + SortSelect (w-40)
 *   4. <GameGrid />                   — virtualized cover grid (or empty states)
 *   5. <MetadataPicker />             — controlled dialog
 *
 * Empty-state handling: pre-Phase-4 the grid was hidden when `games.length
 * === 0`. We preserve the same UX but distinguish more carefully:
 *   - 0 games + no scan ever          → "还没有游戏" (P1/P2 reuse)
 *   - 0 games + scan completed        → "未识别到游戏" (P2 reuse)
 *   - 0 games + active search/filter  → "无匹配结果" (P4 new)
 *   - games > 0                       → <GameGrid />
 *
 * Search/sort/filter loop (the heart of 04d):
 *   - Single useEffect subscribes to (searchQuery, sortBy, filter) from
 *     the store and calls `searchGames(...)`. This is the ONLY place that
 *     issues the search invoke — sidebar / chip / search-bar all just
 *     mutate the store, never call searchGames directly.
 *   - Initial load also runs through this effect (first render with
 *     defaults → searchGames(null, "last_played", null)).
 *   - Scan completion still triggers an extra refetch (covers the case
 *     where a scan ends while no search/filter is active and we want the
 *     newly ingested rows to appear without user input).
 *
 * Routing-export note: `router.tsx` uses `import { Library }` — keep
 * NAMED export.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useLibraryStore } from "@/store/library";
import {
  getSidebarCategories,
  searchGames,
  type SearchFilter,
} from "@/lib/search";
import type { Game } from "@/lib/games";
import { GameGrid } from "@/components/library/GameGrid";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { ActiveSessionBar } from "@/components/library/ActiveSessionBar";
import { MetadataPicker } from "@/components/library/MetadataPicker";
import { SearchBar } from "@/components/library/SearchBar";
import { SortSelect } from "@/components/library/SortSelect";
import { FilterChip } from "@/components/library/FilterChip";

/**
 * "Empty filter" detection — a SearchFilter is empty when none of its
 * slice fields are populated AND favorite is not explicitly true. Used to
 * disambiguate "library is genuinely empty" vs. "filter narrowed to zero".
 */
function isFilterEmpty(f: SearchFilter): boolean {
  return (
    f.tag_id == null &&
    f.status == null &&
    !f.favorite &&
    f.brand == null &&
    f.year_decade == null
  );
}

export function Library() {
  const games = useLibraryStore((s) => s.games);
  const setGames = useLibraryStore((s) => s.setGames);
  const setSidebar = useLibraryStore((s) => s.setSidebar);
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);

  const [pickerGame, setPickerGame] = useState<Game | null>(null);
  const navigate = useNavigate();

  /**
   * Single re-fetch path: builds the (query, sort, filter) triple from the
   * store and calls searchGames. Empty searchQuery becomes `null` per the
   * `searchGames` wrapper contract (no LIKE clause). Empty filter object
   * is forwarded as-is — backend treats all-undefined as "no clauses".
   */
  const refetchGrid = useCallback(async () => {
    const trimmedQuery = searchQuery.trim();
    const queryArg = trimmedQuery === "" ? null : trimmedQuery;
    const filterArg = isFilterEmpty(filter) ? null : filter;
    try {
      const rows = await searchGames(queryArg, sortBy, filterArg);
      setGames(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] searchGames failed:", e);
    }
  }, [searchQuery, sortBy, filter, setGames]);

  /**
   * Sidebar refresh — called after mutations that change the aggregate
   * counts (favorite toggle / status update / scan completion / metadata
   * refresh). We KEEP the sidebar fetch separate from refetchGrid because
   * search/sort/filter changes do NOT change the underlying counts (just
   * which subset is shown).
   */
  const refreshSidebar = useCallback(async () => {
    try {
      const cats = await getSidebarCategories();
      setSidebar(cats);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] getSidebarCategories failed:", e);
    }
  }, [setSidebar]);

  // Re-run searchGames whenever the (query, sort, filter) triple changes.
  // Initial render uses store defaults → searchGames(null, "last_played",
  // null), giving the same boot output as the pre-04d listGames() call.
  useEffect(() => {
    void refetchGrid();
  }, [refetchGrid]);

  // Refetch grid + sidebar after a scan finishes — newly ingested rows
  // surface in the grid AND the sidebar counts update (new brands / years).
  useEffect(() => {
    if (scanProgress?.status === "completed") {
      void refetchGrid();
      void refreshSidebar();
    }
  }, [scanProgress?.status, refetchGrid, refreshSidebar]);

  /**
   * Mutation hook handed to GameGrid — fired when a card-level toggle
   * (favorite / status) succeeds. Re-fetch BOTH the grid (search/filter
   * may now exclude the row) AND the sidebar (counts shift).
   */
  const onChildMutation = useCallback(() => {
    void refetchGrid();
    void refreshSidebar();
  }, [refetchGrid, refreshSidebar]);

  // Empty-state classification. We treat "filter or search active" as a
  // stronger signal than "scan ever ran" — if the user is actively
  // narrowing and got zero hits, they want to see "无匹配结果", not the
  // scan-onboarding placeholder.
  const isEmpty = games.length === 0;
  const hasActiveSearch = searchQuery.trim() !== "";
  const hasActiveFilter = !isFilterEmpty(filter);
  const scanCompleted = scanProgress?.status === "completed";
  const noScanYet = isEmpty && !scanProgress && !hasActiveSearch && !hasActiveFilter;
  const scanFinishedZeroResults =
    isEmpty && scanCompleted && !hasActiveSearch && !hasActiveFilter;
  const filterFoundNothing = isEmpty && (hasActiveSearch || hasActiveFilter);

  /** Reset both axes to recover from a "no results" filter state. */
  function clearAllFilters() {
    setFilter({});
    setSearchQuery("");
  }

  return (
    <div className="flex h-full w-full flex-col">
      <ScanProgressBar />
      {/* 03f: ActiveSessionBar renders below ScanProgressBar; both are
          sticky top-0 inside the same flex column, so when both are visible
          simultaneously (rare) ScanProgressBar wins the top slot and
          ActiveSessionBar stacks below it. ActiveSessionBar self-hides
          when activeSession is null. */}
      <ActiveSessionBar />

      {/* 04d top bar: SearchBar (flex-1) + FilterChip + SortSelect (w-40). */}
      <div className="flex items-center gap-3 px-6 pt-4 pb-3">
        <SearchBar />
        <FilterChip />
        <SortSelect />
      </div>

      <div className="flex-1 overflow-hidden">
        {noScanYet && (
          <ScrollArea className="h-full w-full">
            <div className="flex h-full min-h-full w-full items-center justify-center px-8 py-12">
              <div className="flex flex-col items-center gap-6 text-center">
                <h2 className="text-h2 text-foreground">还没有游戏</h2>
                <p className="text-body text-muted-foreground">
                  请到设置页添加扫描根目录
                </p>
                <Button variant="ghost" onClick={() => navigate("/settings")}>
                  打开设置
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}

        {scanFinishedZeroResults && (
          <ScrollArea className="h-full w-full">
            <div className="flex h-full min-h-full w-full items-center justify-center px-8 py-12">
              <div className="flex flex-col items-center gap-6 text-center">
                <h2 className="text-h2 text-foreground">未识别到游戏</h2>
                <p className="text-body text-muted-foreground">
                  请检查根目录扫描深度配置
                </p>
                <Button variant="ghost" onClick={() => navigate("/settings")}>
                  回到设置
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}

        {filterFoundNothing && (
          <ScrollArea className="h-full w-full">
            <div className="flex h-full min-h-full w-full items-center justify-center px-8 py-12">
              <div className="flex flex-col items-center gap-6 text-center">
                <h2 className="text-h2 text-foreground">无匹配结果</h2>
                <p className="text-body text-muted-foreground">
                  尝试调整搜索或清除筛选条件
                </p>
                <Button variant="ghost" onClick={clearAllFilters}>
                  清除筛选
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}

        {!isEmpty && (
          <GameGrid
            games={games}
            onPickMetadata={setPickerGame}
            onChildMutation={onChildMutation}
          />
        )}
      </div>

      <MetadataPicker game={pickerGame} onClose={() => setPickerGame(null)} />
    </div>
  );
}
