/**
 * Library route ("/") — v1.1 redesign.
 *
 * Layout (top → bottom):
 *   <ScanProgressBar/>          — sticky top, auto-hides on idle/terminal
 *   <PageHeader>                — breadcrumb · serif H1 · sub · actions
 *   <ActiveSessionBar/>         — present iff active session
 *   <Toolbar row>               — StatusFilterChips · FilterChip
 *                                 · spacer · SearchBar · DensityToggle · SortSelect
 *   <GameGrid/> | <empty>       — uniform density grid (--card-w driven)
 *   <MetadataPicker/>           — controlled dialog
 *
 * Functional logic preserved from v1.0:
 *   - Single useEffect subscribed to (searchQuery, sortBy, filter) issues
 *     searchGames; sidebar / chip / chips / search-bar all just mutate the store.
 *   - Empty-state classification: noScanYet / scanFinishedZeroResults / filterFoundNothing.
 *
 * Routing-export note: router.tsx uses `import { Library }` — keep NAMED export.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { toastScanFinished } from "@/lib/toast";
import { useLibraryStore } from "@/store/library";
import {
  getSidebarCategories,
  searchGames,
  type SearchFilter,
} from "@/lib/search";
import type { Game } from "@/lib/games";
import { deleteGame } from "@/lib/games";
import { onGamesChanged, startScan, listScanRoots } from "@/lib/scan";
import { GameGrid } from "@/components/library/GameGrid";
import { GameList } from "@/components/library/GameList";
import { ViewToggle } from "@/components/library/ViewToggle";
import { FilterPanel } from "@/components/library/FilterPanel";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { BackfillProgressBar } from "@/components/library/BackfillProgressBar";
import { ActiveSessionBar } from "@/components/library/ActiveSessionBar";
import { MetadataPicker } from "@/components/library/MetadataPicker";
import {
  SubdirSplitDialog,
  gameHasUserData,
} from "@/components/library/SubdirSplitDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SearchBar } from "@/components/library/SearchBar";
import { SortSelect } from "@/components/library/SortSelect";
import { FilterChip } from "@/components/library/FilterChip";
import { StatusFilterChips } from "@/components/library/StatusFilterChips";
import { DensityToggle } from "@/components/library/DensityToggle";
import { PageHeader } from "@/components/library/PageHeader";
import { usePreferencesStore } from "@/store/preferences";
import {
  type AdvancedFilter,
  applyAdvancedFilter,
  EMPTY_ADV_FILTER,
  isAdvFilterActive,
} from "@/lib/advancedFilter";
import { getFilterOptions, type FilterOptions } from "@/lib/persons";
import { addGamesToView, createCustomView } from "@/lib/customViews";
import {
  ViewNameDialog,
  type ViewNameDialogMode,
} from "@/components/library/ViewNameDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RefreshCw,
  FolderPlus,
  Library as LibraryIcon,
  SearchX,
  AlertCircle,
  CheckSquare,
  Bookmark,
  Plus,
  X,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmoothWheel } from "@/hooks/useSmoothWheel";

function isFilterEmpty(f: SearchFilter): boolean {
  return (
    f.tag_id == null &&
    f.status == null &&
    !f.favorite &&
    f.brand == null &&
    f.year_decade == null &&
    f.custom_view_id == null &&
    (f.brands == null || f.brands.length === 0) &&
    (f.staff_ids == null || f.staff_ids.length === 0) &&
    (f.official_tags == null || f.official_tags.length === 0)
  );
}

const TOOLBAR_BTN =
  "inline-flex h-8 items-center gap-2 border border-line bg-bg-1 px-3.5 text-[12.5px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0";

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
  // Quick 260516-vs4 — scroll-position restore. Only the setter is taken
  // reactively; the saved value is read imperatively via getState() inside
  // the restore effect so a position change never triggers a re-render.
  const setLibraryScrollTop = useLibraryStore((s) => s.setLibraryScrollTop);

  const [pickerGame, setPickerGame] = useState<Game | null>(null);
  // Quick 260516-q3y —「整理子目录」拆分对话框 + 用户数据删除确认。
  // splitGame 打开 SubdirSplitDialog；splitCandidate 是「有用户数据，待确认」
  // 的中间态，确认后才转交给 splitGame。
  const [splitGame, setSplitGame] = useState<Game | null>(null);
  const [splitCandidate, setSplitCandidate] = useState<Game | null>(null);
  // Quick 260517-qnn —「删除条目」确认对话框的待删游戏。GameCard 右键菜单的
  // 删除项通过 onRequestDelete 把游戏写入这里，确认后才真正删库。
  const [deleteCandidate, setDeleteCandidate] = useState<Game | null>(null);
  const [advFilter, setAdvFilter] = useState<AdvancedFilter>(EMPTY_ADV_FILTER);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const navigate = useNavigate();
  const viewMode = usePreferencesStore((s) => s.viewMode);

  // Quick 20260510b — batch select mode + selection set. selectedIds is a
  // Set so identity changes drive a re-render; a setter that always
  // creates a new Set keeps zustand-style shallow equality consistent.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const sidebar = useLibraryStore((s) => s.sidebar);
  const customViews = sidebar?.custom_views ?? [];

  // Quick 20260512f — 批量选择→新建视图 走正经 Dialog，不再 window.prompt。
  // 打开时把当前选中 ids 暂存，提交后 createCustomView + addGamesToView 一气呵成。
  const [createViewDialog, setCreateViewDialog] =
    useState<ViewNameDialogMode | null>(null);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleGames.map((g) => g.id)));
  }

  async function onAddToView(viewId: number, viewName: string) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const inserted = await addGamesToView(viewId, ids);
      const skipped = ids.length - inserted;
      toast.success(
        skipped > 0
          ? `已加入「${viewName}」(${inserted} 部，${skipped} 部已存在)`
          : `已加入「${viewName}」(${inserted} 部)`,
      );
      await refreshSidebar();
      exitSelectMode();
    } catch (e: unknown) {
      toast.error(`添加失败 — ${String(e)}`);
    }
  }

  function onCreateAndAdd() {
    if (selectedIds.size === 0) return;
    setCreateViewDialog({ kind: "create" });
  }

  async function handleCreateViewSubmit(name: string) {
    // 提交时再快照一次 selectedIds，防止开 dialog 期间用户改动选择。
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const newId = await createCustomView(name);
      const inserted = await addGamesToView(newId, ids);
      toast.success(`已创建视图「${name}」并加入 ${inserted} 部`);
      await refreshSidebar();
      exitSelectMode();
    } catch (e: unknown) {
      toast.error(`创建视图失败 — ${String(e)}`);
    }
  }

  // 20260509g — 滚动容器 ref，下放到 GameGrid 给 useVirtualizer 的
  // getScrollElement 用。Library 持有这个 ref 是因为 scroll 区是 toolbar
  // 之外的 flex-1 那一层（见 line ~258），它不在 GameGrid 内部。
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Wheel inertia — Windows wheel ticks are discrete (~100px each); lerp the
  // target scrollTop frame-by-frame for smooth motion. react-virtual stays
  // compatible because we still write to native scrollTop.
  useSmoothWheel(scrollContainerRef);

  // Quick 260516-vs4 — snapshot the scroll position on unmount.
  //
  // Library and Detail are sibling HashRouter routes, so navigating into a
  // game's detail page fully unmounts this component. The cleanup runs at
  // exactly that moment: it reads the live `scrollTop` once and writes it to
  // the global store, which survives the unmount. A cleanup is used instead
  // of a `scroll` event listener on purpose — listening would write to the
  // store on every frame of a high-frequency scroll; we only need the single
  // value captured the instant the user leaves the page.
  useEffect(() => {
    return () => {
      const top = scrollContainerRef.current?.scrollTop;
      if (top != null) setLibraryScrollTop(top);
    };
  }, [setLibraryScrollTop]);

  // Quick 260516-vs4 — restore the scroll position on mount.
  //
  // Read the saved value imperatively (getState) so we don't subscribe to
  // it. `saved <= 0` means "first visit / never scrolled" — leave the page
  // at the top.
  //
  // The write is deferred behind two nested requestAnimationFrame calls:
  // the grid view is virtualized (@tanstack/react-virtual row mode), and on
  // the first render the container's `scrollHeight` is still small because
  // GameGrid's ResizeObserver hasn't measured columnCount/cardWidth and the
  // virtualizer hasn't computed totalHeight yet. Writing `scrollTop` too
  // early would be clamped by the browser to the (insufficient) scrollHeight.
  // Frame 1 lets layout + measurement settle; frame 2 writes the position
  // once the content has grown tall enough.
  //
  // This does not fight useSmoothWheel: that hook lazily initializes its
  // `target` from `el.scrollTop` inside its effect and only re-aligns to the
  // live `scrollTop` on the first wheel event (when `raf == null`). As long
  // as the restore happens before the user's first wheel tick — which it
  // does, both run on mount — the smooth-scroll target picks up the restored
  // position cleanly.
  useEffect(() => {
    const saved = useLibraryStore.getState().libraryScrollTop;
    if (saved <= 0) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop = saved;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const refetchGrid = useCallback(async () => {
    const trimmedQuery = searchQuery.trim();
    const queryArg = trimmedQuery === "" ? null : trimmedQuery;
    // Multi-dim facets that MUST go server-side: staff & official tags don't
    // ride on the Game row (no client-side fan-out is feasible). Brand can
    // be filtered either side; we send it to the server too so the row
    // count badge in PageHeader reflects the same intent (note: the legacy
    // sidebar `filter.brand` single-axis still works independently and is
    // ANDed with `brands` server-side).
    const merged: SearchFilter = {
      ...filter,
      brands: advFilter.brands.size > 0 ? Array.from(advFilter.brands) : undefined,
      staff_ids:
        advFilter.staffIds.size > 0 ? Array.from(advFilter.staffIds) : undefined,
      official_tags:
        advFilter.officialTags.size > 0
          ? Array.from(advFilter.officialTags)
          : undefined,
    };
    const filterArg = isFilterEmpty(merged) ? null : merged;
    try {
      const rows = await searchGames(queryArg, sortBy, filterArg);
      setGames(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] searchGames failed:", e);
    }
  }, [searchQuery, sortBy, filter, advFilter, setGames]);

  // Phase 11 multi-dim facet payload — fetch once on mount, then re-fetch
  // after each scan completes (the option set may shift if new brands /
  // persons / tags landed). The payload is small (a few KB even for
  // hundreds of games), so over-fetching is cheap; under-fetching produces
  // confusing UX (stale chips that filter out everything).
  const refreshFilterOptions = useCallback(async () => {
    try {
      const opts = await getFilterOptions();
      setFilterOptions(opts);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] getFilterOptions failed:", e);
    }
  }, []);

  const refreshSidebar = useCallback(async () => {
    try {
      const cats = await getSidebarCategories();
      setSidebar(cats);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] getSidebarCategories failed:", e);
    }
  }, [setSidebar]);

  useEffect(() => {
    void refetchGrid();
  }, [refetchGrid]);

  // Bootstrap fetch of multi-dim facet options on mount.
  useEffect(() => {
    void refreshFilterOptions();
  }, [refreshFilterOptions]);

  // Quick 260515-prog — progressive refresh during an active scan.
  //
  // Backend emits a `games-changed` pulse per placeholder INSERT and per
  // enrich completion. We throttle to one refetch per 600ms so a 500-game
  // rescan triggers ≤ a few network round-trips per second instead of one
  // per row. Trailing call ensures the final `games-changed` (right before
  // `scan-progress.completed`) still lands even if it falls inside the
  // throttle window.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let lastRun = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const THROTTLE_MS = 600;

    const fire = () => {
      lastRun = Date.now();
      trailing = null;
      void refetchGrid();
      void refreshSidebar();
    };

    const onPulse = () => {
      const since = Date.now() - lastRun;
      if (since >= THROTTLE_MS) {
        fire();
      } else if (trailing == null) {
        trailing = setTimeout(fire, THROTTLE_MS - since);
      }
    };

    void onGamesChanged(onPulse)
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Library] failed to subscribe to games-changed:", e);
      });

    return () => {
      if (trailing != null) clearTimeout(trailing);
      unlisten?.();
    };
  }, [refetchGrid, refreshSidebar]);

  // Detect the running → completed edge once and fire the rich scan-finished
  // toast post-refresh. The ref guard prevents double-fires when refetchGrid
  // identity changes (deps below) while scanProgress is still in 'completed'.
  const prevScanStatus = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevScanStatus.current;
    const next = scanProgress?.status ?? null;
    prevScanStatus.current = next;
    if (prev !== "completed" && next === "completed") {
      const total = scanProgress?.total ?? 0;
      void (async () => {
        await refetchGrid();
        await refreshSidebar();
        await refreshFilterOptions();
        // Post-refresh read — refetchGrid setGames-through means the store
        // snapshot now carries the freshly inserted/updated rows.
        const latest = useLibraryStore.getState().games;
        const pending = latest.filter(
          (g) => g.match_confidence != null && g.match_confidence < 80,
        ).length;
        toastScanFinished(total, total - pending, pending);
      })();
    }
  }, [
    scanProgress?.status,
    scanProgress?.total,
    refetchGrid,
    refreshSidebar,
    refreshFilterOptions,
  ]);

  const onChildMutation = useCallback(() => {
    void refetchGrid();
    void refreshSidebar();
  }, [refetchGrid, refreshSidebar]);

  // Quick 260516-q3y —「整理子目录」入口回调. 带用户数据的条目先弹删除确认
  // AlertDialog，无用户数据直接打开 SubdirSplitDialog。
  const onSplitSubdirs = useCallback((game: Game) => {
    if (gameHasUserData(game)) {
      setSplitCandidate(game);
    } else {
      setSplitGame(game);
    }
  }, []);

  // Quick 260517-qnn —「删除条目」入口回调. 卡片右键菜单的删除项把游戏丢进
  // deleteCandidate，由下方的 AlertDialog 二次确认后真正删库。
  const onRequestDelete = useCallback((game: Game) => {
    setDeleteCandidate(game);
  }, []);

  // Quick 260517-qnn — 确认删除：删库记录后刷新网格 + 侧边栏。磁盘文件不动。
  const onConfirmDelete = useCallback(async () => {
    const g = deleteCandidate;
    if (!g) return;
    setDeleteCandidate(null);
    try {
      await deleteGame(g.id);
      void refetchGrid();
      void refreshSidebar();
      toast.success("已删除条目");
    } catch (e: unknown) {
      toast.error(`删除失败 — ${String(e)}`);
    }
  }, [deleteCandidate, refetchGrid, refreshSidebar]);

  // Server-fetched array (already narrowed by backend SearchFilter +
  // sort + searchQuery). The advanced FilterPanel runs as a client-side
  // post-filter on top of this — keeps all complex multi-axis logic out
  // of the SQL builder.
  const filteredGames = applyAdvancedFilter(games, advFilter);

  // Subscribed so the reconcile effect below re-runs whenever a card
  // transitions in/out of the in-flight set.
  const fetchingMetaIds = useLibraryStore((s) => s.fetchingMetaIds);

  // Quick 260515-loading-phase-sort — reconcile fetchingMetaIds against the
  // freshly refetched `games` array. Only entries with phase
  // "awaiting_refetch" (backend has emitted `finished`) are eligible for
  // removal; entries still in "in_flight" stay no matter what the row
  // looks like.
  //
  // Why the phase gate matters: `refresh_metadata_smart` iterates already-
  // bound rows, so `games[id]` is bound the moment `started` fires. A
  // bound-only reconcile (the old behavior) would wipe the loading visual
  // instantly after addFetchingMetaId — symptom: "first batch of loading
  // cards finishes, then no new loading state appears".
  //
  // The loading-persist intent from #260515-loading-persist is preserved:
  // after `finished` we keep the loading visual until the row has actually
  // transitioned to a terminal state (bound / manual / failed with
  // last_scanned_at set). That guarantees the loading state lasts until
  // cover + metadata are both visible to the user.
  useEffect(() => {
    const ids = Object.keys(fetchingMetaIds);
    if (ids.length === 0) return;
    const byId = new Map(games.map((g) => [g.id, g]));
    const st = useLibraryStore.getState();
    for (const idStr of ids) {
      const id = Number(idStr);
      if (fetchingMetaIds[id] !== "awaiting_refetch") continue;
      const g = byId.get(id);
      if (!g) continue;
      const bound =
        g.metadata_source === "bangumi" ||
        g.metadata_source === "vndb" ||
        g.metadata_source === "manual";
      const failedTerminal =
        g.metadata_source === "none" && g.last_scanned_at != null;
      if (bound || failedTerminal) {
        st.removeFetchingMetaId(id);
      }
    }
  }, [games, fetchingMetaIds]);
  // Quick 260515-loading-phase-sort (round-4) — NO reordering during
  // scan/refresh. Per user decision: cards must stay in their grid position
  // so the loading state (pending pulse → fetching spinner → done) is
  // visible IN-PLACE on every card the backend touches.
  //
  // Earlier rounds floated in-flight cards to the top (phase-rank sort /
  // loading-first partition). That pinned all loading visuals to the first
  // ~4 grid slots: whichever cards the backend processed were yanked to the
  // top, so every card the user was actually looking at appeared to never
  // load. Removing the reorder entirely fixes that and makes loading-time
  // order identical to post-loading order (the user's standing requirement).
  //
  // Grid order is now purely server sort + advanced filter; loading is
  // communicated solely by per-card visuals (GameCard / GameList read
  // fetchingMetaIds + metaTouchedIds + metaRefreshActive directly).
  const visibleGames = filteredGames;

  const isEmpty = visibleGames.length === 0;
  const hasActiveSearch = searchQuery.trim() !== "";
  const hasActiveFilter = !isFilterEmpty(filter) || isAdvFilterActive(advFilter);
  const scanCompleted = scanProgress?.status === "completed";
  const noScanYet =
    isEmpty && !scanProgress && !hasActiveSearch && !hasActiveFilter;
  const scanFinishedZeroResults =
    isEmpty && scanCompleted && !hasActiveSearch && !hasActiveFilter;
  const filterFoundNothing = isEmpty && (hasActiveSearch || hasActiveFilter);
  const scanRunning = scanProgress?.status === "running";

  function clearAllFilters() {
    setFilter({});
    setSearchQuery("");
    setAdvFilter(EMPTY_ADV_FILTER);
  }

  async function onRescan() {
    if (scanRunning) return;
    try {
      const roots = await listScanRoots();
      if (roots.length === 0) {
        toast.error("还没有扫描根目录 — 请先到设置页添加");
        navigate("/settings");
        return;
      }
      await startScan("incremental");
      toast.info("已开始扫描");
    } catch (e: unknown) {
      toast.error(`扫描失败 — ${String(e)}`);
    }
  }

  // Page-header sub line — derive from latest game's last_scanned_at when
  // available; otherwise show a neutral message.
  const latestScan = games.reduce<string | null>((acc, g) => {
    if (!g.last_scanned_at) return acc;
    if (!acc || g.last_scanned_at > acc) return g.last_scanned_at;
    return acc;
  }, null);
  const subLine = latestScan
    ? `最近一次扫描 · ${new Date(latestScan).toLocaleString("zh-CN")} · ${games.length} 部作品`
    : games.length > 0
      ? `共 ${games.length} 部作品`
      : "尚未扫描";

  return (
    <div className="flex h-full w-full flex-col">
      <ScanProgressBar />

      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          crumb="图书馆"
          badge={
            isAdvFilterActive(advFilter)
              ? `${visibleGames.length} / ${games.length} 部`
              : `${games.length} 部作品`
          }
          title={
            <>
              本月你的<span className="text-brand italic">箱庭</span>
            </>
          }
          sub={subLine}
          actions={
            <>
              <button
                type="button"
                onClick={() => void onRescan()}
                disabled={scanRunning}
                className={cn(
                  TOOLBAR_BTN,
                  scanRunning && "cursor-not-allowed opacity-60",
                )}
                style={{ borderRadius: "var(--r-md)" }}
              >
                <RefreshCw size={14} strokeWidth={1.7} />
                <span>重新扫描</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className={TOOLBAR_BTN}
                style={{ borderRadius: "var(--r-md)" }}
              >
                <FolderPlus size={14} strokeWidth={1.7} />
                <span>添加根目录</span>
              </button>
            </>
          }
        />

        <BackfillProgressBar />

        <ActiveSessionBar />

        {/* Toolbar row — chips · filters | searchbar · density · sort */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3.5">
          <StatusFilterChips />
          <FilterChip />
          <span className="flex-1" />
          <FilterPanel
            games={games}
            filter={advFilter}
            onChange={setAdvFilter}
            options={filterOptions}
          />
          {/* Quick 20260510b — toggle batch selection mode. Available only
              in grid view; list view's row-click model would need a
              separate affordance. */}
          {viewMode === "grid" && (
            <button
              type="button"
              onClick={() =>
                selectMode ? exitSelectMode() : setSelectMode(true)
              }
              className={cn(
                "inline-flex h-8 items-center gap-1.5 border px-3 font-mono text-[11px] transition-colors",
                selectMode
                  ? "border-brand bg-brand-soft text-ink-0"
                  : "border-line bg-bg-1 text-ink-1 hover:border-line-strong hover:bg-bg-2 hover:text-ink-0",
              )}
              style={{ borderRadius: "9999px" }}
              title={selectMode ? "退出选择" : "批量选择"}
            >
              <CheckSquare size={12} strokeWidth={1.7} />
              <span>{selectMode ? `选择中 ${selectedIds.size}` : "批量选择"}</span>
            </button>
          )}
          <SearchBar />
          <ViewToggle />
          {viewMode === "grid" && <DensityToggle />}
          <SortSelect />
        </div>

        {/* Grid + empty states — only this region scrolls; header/toolbar stay fixed above */}
        <div
          ref={scrollContainerRef}
          className="flex min-h-0 flex-1 flex-col overflow-auto"
        >
        {noScanYet && (
          <EmptyPanel
            icon={LibraryIcon}
            title="你的箱庭还是空的"
            sub="添加一个根目录，让箱庭把那一堆乱糟糟的文件夹整理成你的私人书架。"
            actionLabel="+ 添加根目录"
            onAction={() => navigate("/settings")}
            hint="也可以稍后从设置页随时新增"
          />
        )}

        {scanFinishedZeroResults && (
          <EmptyPanel
            icon={AlertCircle}
            accent="#ffd166"
            title="扫描完成 · 未识别到游戏"
            sub="该根目录下没有符合深度规则的子文件夹。可能扫描深度不对，或目录里其实没有游戏。"
            actionLabel="回到设置调整"
            onAction={() => navigate("/settings")}
            hint="多数情况是把深度从「扁平」改成「按品牌分层」就能找到"
          />
        )}

        {filterFoundNothing && (
          <EmptyPanel
            icon={SearchX}
            title="没有匹配的游戏"
            sub="当前筛选条件一个都没匹配上。要不试试放宽条件，或者直接清除全部筛选。"
            actionLabel="清除筛选"
            onAction={clearAllFilters}
            hint={`已扫描 ${searchQuery ? "搜索词" : "筛选条件"}：尝试调整后重试`}
          />
        )}

        {!isEmpty && viewMode === "grid" && (
          <GameGrid
            games={visibleGames}
            onPickMetadata={setPickerGame}
            onSplitSubdirs={onSplitSubdirs}
            onRequestDelete={onRequestDelete}
            onChildMutation={onChildMutation}
            scrollContainerRef={scrollContainerRef}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
          />
        )}
        {!isEmpty && viewMode === "list" && <GameList games={visibleGames} />}
        </div>
      </div>

      {/* Quick 20260510b — floating selection action bar. Pinned bottom-center
          while selectMode is active; mirrors ActiveSessionBar's surface but
          stacks above it (z-50) so an active game session doesn't hide it. */}
      {selectMode && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 border border-line-strong bg-bg-1 px-4 py-2.5 shadow-lift">
            <span className="font-mono text-[11px] text-ink-1">
              已选 <span className="text-ink-0">{selectedIds.size}</span> 部
            </span>
            <span className="h-4 w-px bg-line" />
            <button
              type="button"
              onClick={selectAllVisible}
              className="font-mono text-[11px] text-ink-2 hover:text-ink-0"
            >
              全选当前网格
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={selectedIds.size === 0}
              className={cn(
                "font-mono text-[11px]",
                selectedIds.size === 0
                  ? "cursor-not-allowed text-ink-3"
                  : "text-ink-2 hover:text-ink-0",
              )}
            >
              清空
            </button>
            <span className="h-4 w-px bg-line" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={selectedIds.size === 0}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 border px-3 text-[12px]",
                    selectedIds.size === 0
                      ? "cursor-not-allowed border-line bg-bg-2 text-ink-3"
                      : "border-brand bg-brand text-[var(--accent-on)] hover:bg-brand-deep",
                  )}
                  style={{ borderRadius: "var(--r-md)" }}
                >
                  <Bookmark size={12} strokeWidth={1.7} />
                  添加到视图
                  <ChevronDown size={12} strokeWidth={1.7} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {customViews.length === 0 && (
                  <DropdownMenuItem disabled>
                    <span className="text-ink-3">尚无视图</span>
                  </DropdownMenuItem>
                )}
                {customViews.map((cv) => (
                  <DropdownMenuItem
                    key={cv.id}
                    onClick={() => void onAddToView(cv.id, cv.name)}
                  >
                    <Bookmark size={13} className="mr-2" />
                    {cv.name}
                    <span className="ml-auto font-mono text-[10px] text-ink-3">
                      {cv.count}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onCreateAndAdd}>
                  <Plus size={13} className="mr-2" />
                  新建视图…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={exitSelectMode}
              className="grid h-8 w-8 place-items-center text-ink-2 hover:bg-bg-2 hover:text-ink-0"
              title="取消"
              aria-label="取消"
              style={{ borderRadius: "var(--r-md)" }}
            >
              <X size={14} strokeWidth={1.7} />
            </button>
          </div>
        </div>
      )}

      <MetadataPicker game={pickerGame} onClose={() => setPickerGame(null)} />

      {/* Quick 260516-q3y —「整理子目录」拆分对话框 */}
      <SubdirSplitDialog
        game={splitGame}
        onClose={() => setSplitGame(null)}
        onSplit={() => {
          setSplitGame(null);
          void refetchGrid();
          void refreshSidebar();
        }}
      />

      {/* Quick 260516-q3y — 带用户数据条目的拆分前删除确认 */}
      <AlertDialog
        open={splitCandidate != null}
        onOpenChange={(o) => {
          if (!o) setSplitCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>拆分会删除原条目</AlertDialogTitle>
            <AlertDialogDescription>
              该条目带有游玩时长 / 笔记 / 评分 / 收藏 / 通关状态等数据。
              拆分会删除原条目并丢失这些数据，子目录将作为新条目重新匹配元数据。
              确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSplitCandidate(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const g = splitCandidate;
                setSplitCandidate(null);
                if (g) setSplitGame(g);
              }}
            >
              继续拆分
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Quick 260517-qnn —「删除条目」二次确认 */}
      <AlertDialog
        open={deleteCandidate != null}
        onOpenChange={(o) => {
          if (!o) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该条目？</AlertDialogTitle>
            <AlertDialogDescription>
              仅从图书馆移除这条记录（游玩时长 / 笔记 / 评分等数据会一并丢失）。
              磁盘上的游戏文件不会被删除，重新扫描会再次找到它。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteCandidate(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ViewNameDialog
        mode={createViewDialog}
        onClose={() => setCreateViewDialog(null)}
        onSubmit={handleCreateViewSubmit}
      />
    </div>
  );
}

interface EmptyPanelProps {
  icon: LucideIcon;
  title: string;
  sub: string;
  actionLabel: string;
  onAction: () => void;
  /** Mono-style hint shown at the bottom of the card. */
  hint?: string;
  /**
   * Optional accent color for warning/error variants. When omitted the panel
   * uses the brand accent (`var(--accent)`).
   */
  accent?: string;
}

/**
 * State card styled per supplementary §8 (StatesWall): 64px glyph badge with
 * accent ring + tinted bg, serif title, sans sub copy, primary CTA, mono hint
 * footer. Three rendered variants in this route — empty library, scan
 * finished zero-results, and filter found nothing.
 */
function EmptyPanel({
  icon: Icon,
  title,
  sub,
  actionLabel,
  onAction,
  hint,
  accent,
}: EmptyPanelProps) {
  const glyphColor = accent ?? "var(--accent)";
  const glyphBg = accent ? `${accent}20` : "var(--accent-soft)";

  return (
    <div className="flex w-full justify-center px-8 py-16">
      <div
        className="flex w-full max-w-[420px] flex-col items-center border border-line bg-bg-1 px-8 py-10 text-center"
        style={{ borderRadius: "var(--r-lg)" }}
      >
        <div
          className="mb-5 grid h-16 w-16 place-items-center"
          style={{
            background: glyphBg,
            border: `1px solid ${glyphColor}`,
            borderRadius: "var(--r-md)",
            color: glyphColor,
          }}
          aria-hidden
        >
          <Icon size={28} strokeWidth={1.6} />
        </div>
        <h2 className="font-serif text-[17px] font-medium text-ink-0">{title}</h2>
        <p className="mt-2.5 max-w-[280px] text-[12.5px] leading-[1.7] text-ink-2">
          {sub}
        </p>
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex h-9 items-center border bg-brand px-5 font-medium text-[12.5px] text-[var(--accent-on)] transition-colors hover:bg-brand-deep hover:text-white"
          style={{ borderRadius: "var(--r-md)", borderColor: "var(--accent)" }}
        >
          {actionLabel}
        </button>
        {hint && (
          <p className="mt-4 font-mono text-[10.5px] tracking-[0.04em] text-ink-3">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
